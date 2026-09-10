import express from "express";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";
import { createServer as createViteServer } from "vite";

dotenv.config();

const app = express();
const PORT = 3000;

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
  const rawMsg = error?.message || String(error || "");
  let errorObj: any = null;
  try {
    const jsonMatch = rawMsg.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      errorObj = JSON.parse(jsonMatch[0]);
    }
  } catch {
    // Ignore JSON parsing errors
  }

  const code = errorObj?.error?.code || error?.status || error?.statusCode || 500;
  const status = errorObj?.error?.status || "";
  const innerMsg = errorObj?.error?.message || rawMsg;

  if (
    code === 503 ||
    status === "UNAVAILABLE" ||
    innerMsg.includes("high demand") ||
    innerMsg.includes("overloaded") ||
    innerMsg.includes("temporary")
  ) {
    return {
      statusCode: 503,
      userMessage:
        "Модель в настоящий момент испытывает временный пик нагрузки (503 Service Unavailable / High Demand). Пожалуйста, повторите запрос через несколько секунд или переключите модель на Gemini 3.1 Flash-Lite.",
    };
  }

  if (code === 429 || status === "RESOURCE_EXHAUSTED" || innerMsg.includes("RESOURCE_EXHAUSTED")) {
    return {
      statusCode: 429,
      userMessage:
        "Превышен лимит запросов к модели (429 Rate Limit / Resource Exhausted). Пожалуйста, подождите несколько секунд и попробуйте снова.",
    };
  }

  if (code === 400 || status === "INVALID_ARGUMENT") {
    return {
      statusCode: 400,
      userMessage: `Некорректный запрос к модели: ${innerMsg}`,
    };
  }

  return {
    statusCode: typeof code === "number" && code >= 400 && code < 600 ? code : 500,
    userMessage: innerMsg.length > 250 ? `${innerMsg.slice(0, 250)}...` : innerMsg,
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

// Master password configuration for single-user security
const MASTER_PASSWORD = process.env.APP_PASSWORD?.trim() || "london2026";

// Auth Verification Middleware
function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : (req.headers["x-app-password"] as string);

  if (!token || token !== MASTER_PASSWORD) {
    return res.status(401).json({
      error: "Доступ ограничен. Требуется авторизация персонального переводчика.",
      requiresAuth: true,
    });
  }
  next();
}

// Auth status & login verification endpoint
app.post("/api/auth/verify", (req, res) => {
  const { password } = req.body || {};
  if (!password || password !== MASTER_PASSWORD) {
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

// Quick check if password is required and valid
app.get("/api/auth/status", (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : (req.headers["x-app-password"] as string);
  const isAuthenticated = Boolean(token && token === MASTER_PASSWORD);
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

    const ai = getGeminiClient();

    // Model selection validation
    const allowedModels = ["gemini-3.8-flash", "gemini-3.1-flash-lite", "gemini-3.1-pro-preview"];
    const chosenModel = allowedModels.includes(model) ? model : "gemini-3.1-flash-lite";

    // Build system instructions for professional translator
    const systemInstruction = `You are a World-Class Master Senior Translator, Literary Editor, and Localizer specializing exclusively in Russian and English translations (in both directions).
Your task is to produce a high-caliber professional translation that meets rigorous publishing, localization, and copywriting standards.

TRANSLATION DIRECTIVES & CONSTRAINTS:

1. DIRECTION:
- User selected direction: "${direction}". If "auto", inspect the text: if predominantly Russian Cyrillic, translate to English (ru-en); if predominantly English Latin, translate to Russian (en-ru).

2. REGISTER & TONE:
- Current Register: "${register}".
  * formal: Официально-деловой, строгий протокол, юридическая и дипломатическая выверенность, отсутствие разговорных элементов.
  * neutral: Нейтрально-литературный, взвешенный, ясный, чистый современный литературный язык.
  * conversational: Живая естественная речь носителя языка, естественные коллокации и фразеологизмы, отсутствие механического калькирования.
  * literary: Художественный стиль: внимание к ритмике фразы, полифонии, образности, метафорам и аллюзиям.
  * marketing: Убедительный копирайтинг: броскость, вовлечение, динамичность, адаптация культурных триггеров (транскреация).
  * technical: Предельная точность терминов, однозначность синтаксиса, стандартная отраслевая номенклатура.

3. TARGET AUDIENCE:
- Target Audience: "${targetAudience}".
  * general: Понятный широкому кругу читателей без узкого жаргона.
  * professional: Экспертный уровень владения профессиональной лексикой.
  * youth: Молодежная аудитория, живой современный сленг/интернет-лексикон при уместности.
  * executive: Управленческий уровень, фокус на ценность, стратегичность и лаконичность.
  * kids: Простые, добрые, образные конструкции, доступные детям.

4. LITERALITY LEVEL (1 to 5):
- Level: ${literality} / 5.
  * 1 (Verbatim/Literal): Максимально точное следование синтаксису и порядку слов оригинала, насколько допускают правила целевого языка.
  * 2 (Close/Faithful): Близко к тексту с минимальной перестройкой структуры.
  * 3 (Balanced/Professional): Золотой стандарт качественного перевода — передача точного смысла естественными средствами языка перевода.
  * 4 (Idiomatic/Free): Свободное идиоматическое изложение, приоритет благозвучия и естественности на целевом языке.
  * 5 (Transcreation): Творческая адаптация духа, настроения и коммуникативного эффекта; свободная переработка формулировок под культурный контекст.

5. GENDER & FORMALITY SPECIFICATIONS (Crucial when translating into Russian):
- Speaker Gender: "${speakerGender}".
  * If "male": use masculine past tense and adjectives for first-person (e.g., «я сказал», «я сделал», «я был уверен»).
  * If "female": use feminine past tense and adjectives for first-person (e.g., «я сказала», «я сделала», «я была уверена»).
- Addressee Gender: "${addresseeGender}".
  * If "male": use masculine forms for second-person (e.g., «ты сказал», «ты готов»).
  * If "female": use feminine forms for second-person (e.g., «ты сказала», «ты готова»).
- Formality / Address: "${formalityAddress}".
  * If "formal_vy": use respectful «Вы / Вам / Ваш».
  * If "informal_ty": use informal «ты / тебе / твой».

6. MANDATORY GLOSSARY:
${
  glossary.length > 0
    ? `The following term correspondences MUST be strictly adhered to:\n` +
      glossary
        .map((g: any) => `- "${g.source}" => "${g.target}"${g.comment ? ` (Note: ${g.comment})` : ""}`)
        .join("\n")
    : "No custom glossary provided. Use standard industry terms."
}

7. FORMATTING:
- Preserve formatting: ${preserveFormatting ? "YES" : "NO"}.
${preserveFormatting ? "Strictly preserve all Markdown markup (headers, bold/italics, bullet points, links, code blocks) and HTML tags intact without altering tags." : "Output plain text."}

8. TYPOGRAPHIC CONVENTIONS & PUNCTUATION (Russian Academic Standard / D.E. Rosenthal):
- Russian quotes: Use «ёлочки» for outer quotes and „лапки“ for nested quotes (never plain straight ASCII quotes in Russian).
- Dash: Use em-dash (—) with a preceding non-breaking space for Russian clauses, dialogues, and definitions.
- Punctuation with quotes (Rosenthal standard):
  * When a quoted phrase, term, or sentence is integrated into the larger sentence, the closing punctuation mark (period or comma) belongs to the overall sentence and is placed STRICTLY AFTER the closing quote:
    - Правильно: Он охарактеризовал это как «очередной провал». (НЕ «...провал.»)
    - Правильно: В статье «Кризис идей», опубликованной вчера, автор затронул... (НЕ «...идей,» автор)
  * Never copy the American quotation convention ("word," "word.") into Russian: commas and periods placed before the closing quote are considered a typographic calque defect in Russian.
  * If the quoted passage is a self-contained sentence ending with its own exclamation mark, question mark, or ellipsis, that mark remains INSIDE the quotes, and NO trailing period is added after the closing quote:
    - Правильно: Он резко выкрикнул: «Берегись!» (без точки после кавычки)
    - Правильно: Возник закономерный вопрос: «Что делать дальше?» (без точки после кавычки)

9. TWO-PASS CRITIQUE & REFINE ENGINE (Self-Correction Protocol):
${
  selfCorrection
    ? `You MUST execute a disciplined Two-Pass Linguistic Refinement:
  - Phase 1 (Draft Translation): First construct a preliminary translation capturing all source information.
  - Phase 2 (Editorial Self-Correction Audit): Act as a ruthless Senior Chief Editor and inspect the preliminary draft:
    * Identify any word-for-word calques (синтаксические кальки и неестественный порядок слов).
    * Detect false friends of the translator (ложные друзья переводчика) and inappropriate literal idioms.
    * Check rhythm, cadence, and theme-rheme word order (актуальное членение предложения).
    * Eliminate wooden phrasing, robotic nominalizations, or passive voice overuse in Russian.
    * Verify glossary compliance and register consistency.
  - Phase 3 (Final Master Translation): Rewrite and polish the draft into the finalized master text ("translation") integrating all critique points.
  - Populate "selfCorrection" with:
    * "enabled": true
    * "draftTranslation": the preliminary draft
    * "refinements": list of specific improvements made (aspect: syntax_calque, false_friend, rhythm_cadence, natural_flow, terminology, tone_consistency; issue; resolution)
    * "editorSummary": brief 1-2 sentence editorial verdict in Russian summarizing the polished improvements.`
    : `Self-correction is disabled. Directly produce the final translation.`
}

10. EXPLANATIONS & ALTERNATIVES:
${explainDecisions ? "- In the decisions field, briefly explain key translation choices (idioms, cultural adaptations, wordplay, false friends, syntax shifts)." : "- You may keep decisions minimal."}
${provideAlternatives ? "- In the alternatives field, provide 2 to 3 alternative translations for 1 to 3 nuanced phrases in the text, highlighting what tone or nuance each variant carries." : "- Keep alternatives empty if not requested."}

Return the response strictly conforming to the JSON schema.`;

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

    const ai = getGeminiClient();
    const systemInstruction = `You are a Senior Translation Lead and Chief Quality Editor for RU ↔ EN translations.
Analyze the provided draft translation against the original source text.

Evaluation criteria:
1. Accuracy & completeness: any omissions, additions, or distortions of meaning.
2. Register & Style: how well it adheres to register "${register}" and audience "${targetAudience}".
3. Idiomaticity & Fluency: natural collocations, avoidance of calques/mechanical translation.
4. Typography & Punctuation: Russian quotes (« »), em-dash (—), punctuation placement according to Rosenthal academic standard (period/comma strictly after closing quotes, no English-style calques with period/comma inside quotes).
5. Glossary: Check if any of the following terms were violated:
${glossary.map((g: any) => `- "${g.source}" => "${g.target}"`).join("\n") || "None"}

Provide an overall rating out of 10, list key strengths, identify specific issues with actionable suggestions, and provide an improved professional revision.
All reasons and summaries should be written in Russian.`;

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

    const ai = getGeminiClient();
    const systemInstruction = `You are an elite DeepL-style contextual vocabulary assistant for Russian and English translations.
The user clicked the word or phrase "${word}" in the following translated sentence:
"${sentence || word}"
${sourceText ? `Original source text for context: "${sourceText}"` : ""}
Language direction: ${direction}. Register target: ${register}.

Your task:
1. Provide 4 to 6 grammatically aligned contextual alternatives/synonyms for "${word}".
   - CRITICAL: The alternatives MUST match the exact grammatical form (case, gender, number, tense, aspect, person) required by the sentence structure so the word can be swapped in directly without syntax errors.
   - Categorize each alternative with a concise Russian tag (e.g., "Нейтрально", "Более формально", "Книжное", "Разговорное", "Деловое", "Литературное", "Лаконично", "Более точное").
   - Give a concise explanation (in Russian, max 10 words) of the nuance or nuance shift.
2. Provide 2 alternative rephrasings of the entire sentence ("sentenceRephrasings") showing how the sentence can be rewritten more idiomatically or with different cadence.`;

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
