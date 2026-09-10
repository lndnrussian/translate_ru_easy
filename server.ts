import express from "express";
import path from "path";
import crypto from "crypto";
import dotenv from "dotenv";
import { rateLimit } from "express-rate-limit";
import { GoogleGenAI, Type } from "@google/genai";
import { createServer as createViteServer } from "vite";
import {
  buildTranslatePrompt,
  buildReviewPrompt,
  buildWordAlternativesPrompt,
} from "./src/prompts";

dotenv.config();

// Ensure master password is configured in the environment
const rawAppPassword = process.env.APP_PASSWORD?.trim();
if (!rawAppPassword) {
  console.error("APP_PASSWORD не задан в .env — сервер не может стартовать без пароля");
  process.exit(1);
}
const MASTER_PASSWORD: string = rawAppPassword;

// Maximum allowed input text lengths for Gemini API requests
const MAX_TRANSLATE_TEXT_LENGTH = 20000;
const MAX_REVIEW_TEXT_LENGTH = 20000;
const MAX_WORD_ALTERNATIVES_TEXT_LENGTH = 5000;

const app = express();
const PORT = 3000;

// Enable trust proxy because the app runs behind Cloud Run / reverse proxies.
// This allows express-rate-limit and req.ip to accurately identify clients from X-Forwarded-For headers.
app.set("trust proxy", 1);

app.use(express.json({ limit: "10mb" }));

// Lazy/safe initialization of GoogleGenAI
function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is missing.");
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

// Helper to parse Gemini errors into human-friendly messages and appropriate HTTP status codes
function parseGeminiError(error: any): { statusCode: number; userMessage: string } {
  let code: number | undefined = undefined;
  let status: string = "";
  let innerMsg: string = "";
  let resolvedStructured = false;

  // 1) First check if the error object has direct structured fields from @google/genai SDK
  if (error && typeof error === "object") {
    if (typeof error.status === "number") {
      code = error.status;
      resolvedStructured = true;
    } else if (typeof error.statusCode === "number") {
      code = error.statusCode;
      resolvedStructured = true;
    } else if (typeof error.code === "number") {
      code = error.code;
      resolvedStructured = true;
    } else if (typeof error.status === "string" && error.status.trim().length > 0) {
      status = error.status.trim();
      resolvedStructured = true;
    }

    if (error.error && typeof error.error === "object") {
      if (typeof error.error.code === "number") {
        code = error.error.code;
        resolvedStructured = true;
      }
      if (typeof error.error.status === "string") {
        status = error.error.status;
        resolvedStructured = true;
      }
      if (typeof error.error.message === "string") {
        innerMsg = error.error.message;
        resolvedStructured = true;
      }
    }

    if (!innerMsg && typeof error.message === "string") {
      innerMsg = error.message;
      if (!resolvedStructured && (code !== undefined || status)) {
        resolvedStructured = true;
      }
    }
  }

  // 2) Fallback: try parsing JSON embedded in raw message via regex if structured fields weren't found
  const rawMsg = typeof error?.message === "string" ? error.message : String(error || "");
  if (!resolvedStructured) {
    try {
      const jsonMatch = rawMsg.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed?.error) {
          if (typeof parsed.error.code === "number") code = parsed.error.code;
          if (typeof parsed.error.status === "string") status = parsed.error.status;
          if (typeof parsed.error.message === "string") innerMsg = parsed.error.message;
          resolvedStructured = true;
        }
      }
    } catch {
      // Ignore JSON parsing errors
    }
  }

  const effectiveCode = code ?? 500;
  const effectiveStatus = status;
  const effectiveMsg = innerMsg || rawMsg;

  // Check 503 / Service Unavailable / High demand
  if (
    effectiveCode === 503 ||
    effectiveStatus === "UNAVAILABLE" ||
    effectiveMsg.includes("high demand") ||
    effectiveMsg.includes("overloaded") ||
    effectiveMsg.includes("temporary")
  ) {
    return {
      statusCode: 503,
      userMessage:
        "Модель в настоящий момент испытывает временный пик нагрузки (503 Service Unavailable / High Demand). Пожалуйста, повторите запрос через несколько секунд или переключите модель на Gemini 3.1 Flash-Lite.",
    };
  }

  // Check 429 / Rate Limit / Resource Exhausted
  if (
    effectiveCode === 429 ||
    effectiveStatus === "RESOURCE_EXHAUSTED" ||
    effectiveMsg.includes("RESOURCE_EXHAUSTED") ||
    effectiveMsg.includes("quota")
  ) {
    return {
      statusCode: 429,
      userMessage:
        "Превышен лимит запросов к модели (429 Rate Limit / Resource Exhausted). Пожалуйста, подождите несколько секунд и попробуйте снова.",
    };
  }

  // Check 400 / Invalid Argument
  if (effectiveCode === 400 || effectiveStatus === "INVALID_ARGUMENT") {
    return {
      statusCode: 400,
      userMessage: innerMsg
        ? `Некорректный запрос к модели: ${innerMsg}`
        : "Некорректный запрос к модели.",
    };
  }

  // 3) If neither structured parsing nor regex identified a known status/message, return 500 with user-friendly text
  if (!resolvedStructured) {
    return {
      statusCode: 500,
      userMessage: "Не удалось обработать ответ модели. Попробуйте повторить запрос.",
    };
  }

  return {
    statusCode: typeof effectiveCode === "number" && effectiveCode >= 400 && effectiveCode < 600 ? effectiveCode : 500,
    userMessage: innerMsg
      ? (innerMsg.length > 250 ? `${innerMsg.slice(0, 250)}...` : innerMsg)
      : "Не удалось обработать ответ модели. Попробуйте повторить запрос.",
  };
}

// In-memory tracking for models with exhausted quotas to avoid repeating failing calls
const modelQuotaCooldowns = new Map<string, number>();

function isModelInCooldown(modelName: string): boolean {
  const expires = modelQuotaCooldowns.get(modelName);
  if (!expires) return false;
  if (Date.now() > expires) {
    modelQuotaCooldowns.delete(modelName);
    return false;
  }
  return true;
}

function setModelCooldown(modelName: string, durationMs = 5 * 60 * 1000) {
  modelQuotaCooldowns.set(modelName, Date.now() + durationMs);
}

// Call Gemini with automated retry, exponential backoff, and fallback models on 503/429
async function generateContentWithRetryAndFallback(
  ai: GoogleGenAI,
  params: {
    contents: any;
    config: any;
  },
  primaryModel: string,
  maxRetriesPerModel = 1
) {
  const modelsToTry: string[] = [];

  // If primary model has recently exhausted its quota, route directly to the active fallback first
  if (isModelInCooldown(primaryModel)) {
    console.log(`[Model Route] Primary model ${primaryModel} is in cooldown (quota limit). Routing directly to fallback.`);
    if (primaryModel === "gemini-3.8-flash") {
      modelsToTry.push("gemini-3.1-flash-lite");
    } else if (primaryModel === "gemini-3.1-pro-preview") {
      modelsToTry.push("gemini-3.1-flash-lite");
    } else {
      modelsToTry.push("gemini-3.1-flash-lite");
    }
  } else {
    modelsToTry.push(primaryModel);
    if (primaryModel === "gemini-3.8-flash") {
      modelsToTry.push("gemini-3.1-flash-lite");
    } else if (primaryModel === "gemini-3.1-pro-preview") {
      modelsToTry.push("gemini-3.1-flash-lite", "gemini-3.8-flash");
    } else if (primaryModel === "gemini-3.1-flash-lite") {
      modelsToTry.push("gemini-3.8-flash");
    }
  }

  let lastError: any = null;

  for (const currentModel of modelsToTry) {
    for (let attempt = 0; attempt <= maxRetriesPerModel; attempt++) {
      try {
        if (attempt > 0) {
          const delay = Math.min(800 * Math.pow(2, attempt - 1) + Math.random() * 200, 2000);
          console.log(
            `[Gemini Retry] Retrying ${currentModel} (attempt ${attempt + 1}/${maxRetriesPerModel + 1}) after ${Math.round(delay)}ms...`
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        }

        const response = await ai.models.generateContent({
          ...params,
          model: currentModel,
        });

        return {
          response,
          usedModel: currentModel,
          wasFallback: currentModel !== primaryModel,
        };
      } catch (err: any) {
        lastError = err;
        const errStr = err?.message || String(err);
        const isTransient =
          errStr.includes("503") ||
          errStr.includes("UNAVAILABLE") ||
          errStr.includes("high demand") ||
          errStr.includes("429") ||
          errStr.includes("RESOURCE_EXHAUSTED") ||
          errStr.includes("quota");

        if (!isTransient) {
          // Do not retry on non-transient errors (e.g. 400 schema error)
          throw err;
        }

        const isQuotaExceeded =
          errStr.includes("exceeded your current quota") ||
          errStr.includes("RESOURCE_EXHAUSTED") ||
          errStr.includes("429");

        if (isQuotaExceeded) {
          // Put model on cooldown for 5 minutes so subsequent requests won't fail
          setModelCooldown(currentModel, 5 * 60 * 1000);
          console.log(
            `[Gemini Fallback] Model ${currentModel} reached quota limit. Switching seamlessly to fallback model...`
          );
          break; // Switch to next model immediately without waiting or hammering the exhausted model
        } else {
          console.log(
            `[Gemini Fallback] Model ${currentModel} unavailable (503/high demand). Attempting retry or fallback...`
          );
        }
      }
    }
  }

  throw lastError;
}

// Timing-safe password comparison helper using crypto.timingSafeEqual
function safePasswordCompare(inputCandidate?: string): boolean {
  if (!inputCandidate || typeof inputCandidate !== "string") {
    return false;
  }
  const candidateBuf = Buffer.from(inputCandidate, "utf-8");
  const masterBuf = Buffer.from(MASTER_PASSWORD, "utf-8");

  if (candidateBuf.length !== masterBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(candidateBuf, masterBuf);
}

// Rate limiter for authentication endpoints: max 5 failed attempts per 15 min per IP.
// Successful requests are not counted against the limit.
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 failed attempts per window
  skipSuccessfulRequests: true, // Successful logins are not counted against the quota
  standardHeaders: true,
  legacyHeaders: false,
  validate: {
    trustProxy: true,
    forwardedHeader: false, // Prevents warning when running behind proxies providing both Forwarded and X-Forwarded-For
  },
  handler: (_req, res) => {
    res.status(429).json({
      error: "Слишком много попыток входа. Попробуйте позже.",
      statusCode: 429,
    });
  },
});

// Auth Verification Middleware
function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : (req.headers["x-app-password"] as string);

  if (!token || !safePasswordCompare(token)) {
    return res.status(401).json({
      error: "Доступ ограничен. Требуется авторизация персонального переводчика.",
      requiresAuth: true,
    });
  }
  next();
}

// Auth status & login verification endpoint (Protected against brute-force)
app.post("/api/auth/verify", authRateLimiter, (req, res) => {
  const { password } = req.body || {};
  if (!password || !safePasswordCompare(password)) {
    return res.status(401).json({
      success: false,
      error: "Неверный пароль доступа.",
    });
  }
  return res.json({
    success: true,
    message: "Авторизация успешна.",
  });
});

// Quick check if password is required and valid (Protected against brute-force)
app.get("/api/auth/status", authRateLimiter, (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : (req.headers["x-app-password"] as string);
  const isAuthenticated = safePasswordCompare(token);
  if (!isAuthenticated && token) {
    // If an invalid token was supplied in the request, respond with 401 so rateLimit registers it as a failed attempt
    return res.status(401).json({
      protected: true,
      authenticated: false,
      error: "Недействительный токен.",
    });
  }
  res.json({
    protected: true,
    authenticated: isAuthenticated,
  });
});

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Translation Endpoint (Protected)
app.post("/api/translate", requireAuth, async (req, res) => {
  const startTime = Date.now();
  try {
    const {
      text,
      direction = "auto",
      register = "neutral",
      targetAudience = "general",
      literality = 3,
      speakerGender = "unspecified",
      addresseeGender = "unspecified",
      formalityAddress = "neutral",
      preserveFormatting = true,
      typography = {
        useRussianQuotes: true,
        useEmDash: true,
        useNonBreakingSpaces: true,
        correctPunctuationOrder: true,
      },
      glossary = [],
      explainDecisions = true,
      provideAlternatives = true,
      selfCorrection = true,
      model = "gemini-3.1-flash-lite",
    } = req.body;

    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return res.status(400).json({ error: "Input text is required." });
    }

    if (text.length > MAX_TRANSLATE_TEXT_LENGTH) {
      return res.status(400).json({
        error: `Текст слишком длинный. Максимум ${MAX_TRANSLATE_TEXT_LENGTH} символов за один запрос.`,
      });
    }

    const ai = getGeminiClient();

    // Model selection validation
    const allowedModels = ["gemini-3.8-flash", "gemini-3.1-flash-lite", "gemini-3.1-pro-preview"];
    const chosenModel = allowedModels.includes(model) ? model : "gemini-3.1-flash-lite";

    // Build system instructions for professional translator using centralized prompt builder
    const systemInstruction = buildTranslatePrompt({
      direction,
      register,
      targetAudience,
      literality,
      speakerGender,
      addresseeGender,
      formalityAddress,
      glossary,
      preserveFormatting,
      selfCorrection,
      explainDecisions,
      provideAlternatives,
    });

    const prompt = `Translate the following source text:\n\n${text}`;

    const { response, usedModel, wasFallback } = await generateContentWithRetryAndFallback(
      ai,
      {
        contents: prompt,
        config: {
          systemInstruction,
          temperature: literality >= 4 ? 0.6 : 0.2,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              detectedDirection: {
                type: Type.STRING,
                description: "The detected translation direction: either 'ru-en' or 'en-ru'",
              },
              translation: {
                type: Type.STRING,
                description: "The finalized, editor-polished high-quality translation.",
              },
              selfCorrection: {
                type: Type.OBJECT,
                description: "Two-pass critique and refinement data.",
                properties: {
                  enabled: { type: Type.BOOLEAN },
                  draftTranslation: { type: Type.STRING, description: "Preliminary unpolished draft before editorial critique" },
                  editorSummary: { type: Type.STRING, description: "Summary of editorial critique and refinements in Russian" },
                  refinements: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        aspect: {
                          type: Type.STRING,
                          description: "One of: syntax_calque, false_friend, rhythm_cadence, natural_flow, terminology, tone_consistency",
                        },
                        issue: { type: Type.STRING, description: "What was detected or improved from draft" },
                        resolution: { type: Type.STRING, description: "How it was refined in the final translation" },
                      },
                      required: ["aspect", "issue", "resolution"],
                    },
                  },
                },
              },
              decisions: {
                type: Type.ARRAY,
                description: "Explanations of key translation decisions, idioms, or cultural adaptations.",
                items: {
                  type: Type.OBJECT,
                  properties: {
                    sourceSegment: { type: Type.STRING },
                    targetSegment: { type: Type.STRING },
                    category: {
                      type: Type.STRING,
                      description: "One of: idiom, cultural, wordplay, syntax, false_friend, terminology, tone",
                    },
                    explanation: { type: Type.STRING, description: "Clear explanation in Russian for the translator" },
                  },
                  required: ["sourceSegment", "targetSegment", "category", "explanation"],
                },
              },
              alternatives: {
                type: Type.ARRAY,
                description: "Alternative renderings for specific phrases with nuance explanations.",
                items: {
                  type: Type.OBJECT,
                  properties: {
                    originalFragment: { type: Type.STRING },
                    currentChoice: { type: Type.STRING },
                    variants: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          text: { type: Type.STRING },
                          nuance: { type: Type.STRING, description: "Brief description of the nuance/style" },
                        },
                        required: ["text", "nuance"],
                      },
                    },
                  },
                  required: ["originalFragment", "currentChoice", "variants"],
                },
              },
              generalNotes: {
                type: Type.STRING,
                description: "Optional overarching translator commentary or cultural notes.",
              },
            },
            required: ["detectedDirection", "translation", "decisions", "alternatives"],
          },
        },
      },
      chosenModel
    );

    const parsed = JSON.parse(response.text || "{}");
    const processingTimeMs = Date.now() - startTime;

    res.json({
      ...parsed,
      usedModel,
      wasFallback,
      processingTimeMs,
    });
  } catch (error: any) {
    console.error("Translation error:", error);
    const { statusCode, userMessage } = parseGeminiError(error);
    res.status(statusCode).json({
      error: userMessage,
      statusCode,
    });
  }
});

// Translation Review / Comparison Endpoint (Protected)
app.post("/api/review", requireAuth, async (req, res) => {
  const startTime = Date.now();
  try {
    const {
      sourceText,
      draftText,
      direction = "ru-en",
      register = "neutral",
      targetAudience = "general",
      glossary = [],
      model = "gemini-3.8-flash",
    } = req.body;

    if (!sourceText || !draftText) {
      return res.status(400).json({ error: "Both source text and draft translation are required for comparison." });
    }

    if (sourceText.length > MAX_REVIEW_TEXT_LENGTH || draftText.length > MAX_REVIEW_TEXT_LENGTH) {
      return res.status(400).json({
        error: `Текст слишком длинный. Максимум ${MAX_REVIEW_TEXT_LENGTH} символов за один запрос.`,
      });
    }

    const ai = getGeminiClient();
    const systemInstruction = buildReviewPrompt({
      register,
      targetAudience,
      glossary,
    });

    const prompt = `SOURCE TEXT:\n${sourceText}\n\nDRAFT TRANSLATION TO REVIEW:\n${draftText}`;

    // Model selection validation
    const allowedModels = ["gemini-3.8-flash", "gemini-3.1-flash-lite", "gemini-3.1-pro-preview"];
    const chosenModel = allowedModels.includes(model) ? model : "gemini-3.8-flash";

    const { response, usedModel, wasFallback } = await generateContentWithRetryAndFallback(
      ai,
      {
        contents: prompt,
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              overallScore: {
                type: Type.NUMBER,
                description: "Quality score from 1 to 10",
              },
              summary: {
                type: Type.STRING,
                description: "Overall editorial assessment in Russian",
              },
              strengths: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "Notable strengths of the draft",
              },
              issues: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    original: { type: Type.STRING },
                    draft: { type: Type.STRING },
                    suggested: { type: Type.STRING },
                    reason: { type: Type.STRING },
                    severity: {
                      type: Type.STRING,
                      description: "'minor', 'medium', or 'critical'",
                    },
                  },
                  required: ["original", "draft", "suggested", "reason", "severity"],
                },
              },
              improvedTranslation: {
                type: Type.STRING,
                description: "Refined, polished version of the translation",
              },
            },
            required: ["overallScore", "summary", "strengths", "issues", "improvedTranslation"],
          },
        },
      },
      chosenModel
    );

    const parsed = JSON.parse(response.text || "{}");
    const processingTimeMs = Date.now() - startTime;

    res.json({
      ...parsed,
      usedModel,
      wasFallback,
      processingTimeMs,
    });
  } catch (error: any) {
    console.error("Review error:", error);
    const { statusCode, userMessage } = parseGeminiError(error);
    res.status(statusCode).json({
      error: userMessage,
      statusCode,
    });
  }
});

// DeepL-style Contextual Word & Phrase Replacement Endpoint (Protected)
app.post("/api/word-alternatives", requireAuth, async (req, res) => {
  const startTime = Date.now();
  try {
    const {
      word,
      sentence,
      sourceText = "",
      direction = "ru-en",
      register = "neutral",
      model = "gemini-3.1-flash-lite",
    } = req.body;

    if (!word || typeof word !== "string" || word.trim().length === 0) {
      return res.status(400).json({ error: "A target word or phrase is required." });
    }

    if (
      (sentence && sentence.length > MAX_WORD_ALTERNATIVES_TEXT_LENGTH) ||
      (sourceText && sourceText.length > MAX_WORD_ALTERNATIVES_TEXT_LENGTH)
    ) {
      return res.status(400).json({
        error: `Текст слишком длинный. Максимум ${MAX_WORD_ALTERNATIVES_TEXT_LENGTH} символов за один запрос.`,
      });
    }

    const ai = getGeminiClient();
    const systemInstruction = buildWordAlternativesPrompt({
      word,
      sentence,
      sourceText,
      direction,
      register,
    });

    const prompt = `Selected word/phrase: "${word}"
Sentence context: "${sentence || word}"`;

    const allowedModels = ["gemini-3.8-flash", "gemini-3.1-flash-lite", "gemini-3.1-pro-preview"];
    const chosenModel = allowedModels.includes(model) ? model : "gemini-3.1-flash-lite";

    const { response, usedModel, wasFallback } = await generateContentWithRetryAndFallback(
      ai,
      {
        contents: prompt,
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              word: { type: Type.STRING },
              alternatives: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    text: {
                      type: Type.STRING,
                      description: "Replacement word or phrase inflected to fit into the sentence seamlessly",
                    },
                    tag: {
                      type: Type.STRING,
                      description: "Short Russian tag: 'Нейтрально', 'Более формально', 'Книжное', 'Разговорное', 'Деловое', etc.",
                    },
                    explanation: {
                      type: Type.STRING,
                      description: "Short Russian nuance description (5-10 words)",
                    },
                  },
                  required: ["text", "tag", "explanation"],
                },
              },
              sentenceRephrasings: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "Two idiomatic alternative rewrites of the whole sentence",
              },
            },
            required: ["word", "alternatives"],
          },
        },
      },
      chosenModel
    );

    const parsed = JSON.parse(response.text || "{}");
    const processingTimeMs = Date.now() - startTime;

    res.json({
      word,
      sentence,
      alternatives: parsed.alternatives || [],
      sentenceRephrasings: parsed.sentenceRephrasings || [],
      usedModel,
      wasFallback,
      processingTimeMs,
    });
  } catch (error: any) {
    console.error("Word alternatives error:", error);
    const { statusCode, userMessage } = parseGeminiError(error);
    res.status(statusCode).json({
      error: userMessage,
      statusCode,
    });
  }
});

// Vite middleware / static asset serving
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
