import { TranslationSettings, GlossaryItem, TranslationResult, ReviewResult, WordAlternativesResponse } from '../types';
import { getSavedAuthToken, saveAuthToken } from '../utils/storage';

export function getAuthHeaders(): Record<string, string> {
  const token = getSavedAuthToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function verifyMasterPassword(password: string): Promise<boolean> {
  const response = await fetch('/api/auth/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Неверный пароль доступа.');
  }

  saveAuthToken(password);
  return true;
}

export async function checkAuthStatus(): Promise<boolean> {
  const token = getSavedAuthToken();
  if (!token) return false;

  try {
    const response = await fetch('/api/auth/status', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return false;
    const data = await response.json();
    return Boolean(data.authenticated);
  } catch {
    return false;
  }
}

export interface TranslateApiPayload {
  text: string;
  direction: string;
  register: string;
  targetAudience: string;
  literality: number;
  speakerGender: string;
  addresseeGender: string;
  formalityAddress: string;
  preserveFormatting: boolean;
  typography: any;
  glossary: GlossaryItem[];
  explainDecisions: boolean;
  provideAlternatives: boolean;
  selfCorrection: boolean;
  model: string;
}

export interface WordAlternativesPayload {
  word: string;
  sentence: string;
  sourceText?: string;
  direction?: string;
  register?: string;
  model?: string;
}

export interface ReviewApiPayload {
  sourceText: string;
  draftText: string;
  direction: string;
  register: string;
  targetAudience: string;
  glossary: GlossaryItem[];
  model: string;
}

export async function requestTranslation(
  text: string,
  settings: TranslationSettings,
  glossary: GlossaryItem[]
): Promise<TranslationResult> {
  const payload: TranslateApiPayload = {
    text,
    direction: settings.direction,
    register: settings.register,
    targetAudience: settings.targetAudience,
    literality: settings.literality,
    speakerGender: settings.speakerGender,
    addresseeGender: settings.addresseeGender,
    formalityAddress: settings.formalityAddress,
    preserveFormatting: settings.preserveFormatting,
    typography: settings.typography,
    glossary,
    explainDecisions: settings.explainDecisions,
    provideAlternatives: settings.provideAlternatives,
    selfCorrection: settings.selfCorrection ?? true,
    model: settings.model,
  };

  const response = await fetch('/api/translate', {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Ошибка сервера: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

export async function requestReview(
  sourceText: string,
  draftText: string,
  settings: TranslationSettings,
  glossary: GlossaryItem[]
): Promise<ReviewResult> {
  const payload: ReviewApiPayload = {
    sourceText,
    draftText,
    direction: settings.direction === 'auto' ? 'ru-en' : settings.direction,
    register: settings.register,
    targetAudience: settings.targetAudience,
    glossary,
    model: settings.model,
  };

  const response = await fetch('/api/review', {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Ошибка сервера: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

export async function requestWordAlternatives(
  payload: WordAlternativesPayload
): Promise<WordAlternativesResponse> {
  const response = await fetch('/api/word-alternatives', {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Ошибка получения альтернатив: ${response.status} ${response.statusText}`);
  }

  return response.json();
}
