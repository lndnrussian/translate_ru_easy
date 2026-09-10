import { HistoryItem, GlossaryItem, TranslationSettings } from '../types';

const HISTORY_KEY = 'pro_trans_history_v1';
const GLOSSARY_KEY = 'pro_trans_glossary_v1';
const SETTINGS_KEY = 'pro_trans_settings_v1';

export const DEFAULT_SETTINGS: TranslationSettings = {
  direction: 'auto',
  register: 'neutral',
  targetAudience: 'general',
  literality: 3,
  speakerGender: 'unspecified',
  addresseeGender: 'unspecified',
  formalityAddress: 'neutral',
  preserveFormatting: true,
  typography: {
    useRussianQuotes: true,
    useEmDash: true,
    useNonBreakingSpaces: true,
    correctPunctuationOrder: true,
  },
  explainDecisions: true,
  provideAlternatives: true,
  selfCorrection: true,
  model: 'gemini-3.1-flash-lite',
};

export const PRESET_GLOSSARIES: Record<string, { name: string; items: Omit<GlossaryItem, 'id'>[] }> = {
  tech: {
    name: 'IT & Software Development',
    items: [
      { source: 'deployment', target: 'развёртывание', comment: 'Не "деплоймент"' },
      { source: 'pipeline', target: 'конвейер / пайплайн', comment: 'В зависимости от стиля' },
      { source: 'rate limit', target: 'лимит частоты запросов', comment: 'API термин' },
      { source: 'endpoint', target: 'конечная точка API', comment: 'Техническая документация' },
      { source: 'legacy code', target: 'унаследованный код', comment: 'Не "легаси"' },
      { source: 'pull request', target: 'запрос на слияние', comment: 'GitHub / GitLab' },
    ],
  },
  business: {
    name: 'Бизнес и Юриспруденция',
    items: [
      { source: 'indemnification', target: 'возмещение убытков', comment: 'Юридический термин' },
      { source: 'due diligence', target: 'комплексная юридическая проверка', comment: 'Финансы' },
      { source: 'non-disclosure agreement', target: 'соглашение о неразглашении конфиденциальной информации', comment: 'NDA' },
      { source: 'force majeure', target: 'обстоятельства непреодолимой силы', comment: 'Договоры' },
      { source: 'stakeholder', target: 'заинтересованная сторона', comment: 'Менеджмент' },
    ],
  },
  marketing: {
    name: 'Маркетинг и Копирайтинг',
    items: [
      { source: 'value proposition', target: 'ценностное предложение', comment: 'Маркетинг' },
      { source: 'call to action', target: 'призыв к действию', comment: 'CTA' },
      { source: 'brand awareness', target: 'узнаваемость бренда', comment: 'Брендинг' },
      { source: 'lead magnet', target: 'лид-магнит', comment: 'Воронка' },
      { source: 'retention rate', target: 'коэффициент удержания', comment: 'Метрики' },
    ],
  },
};

export function getHistory(): HistoryItem[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (e) {
    console.error('Failed to load history', e);
    return [];
  }
}

export function saveHistoryItem(item: HistoryItem): void {
  try {
    // Sanitize item and settingsSnapshot to ensure clean serialization without circular refs
    const cleanSnapshot: Partial<TranslationSettings> = item.settingsSnapshot ? {
      direction: item.settingsSnapshot.direction,
      register: item.settingsSnapshot.register,
      targetAudience: item.settingsSnapshot.targetAudience,
      literality: item.settingsSnapshot.literality,
      speakerGender: item.settingsSnapshot.speakerGender,
      addresseeGender: item.settingsSnapshot.addresseeGender,
      formalityAddress: item.settingsSnapshot.formalityAddress,
      preserveFormatting: item.settingsSnapshot.preserveFormatting,
      selfCorrection: item.settingsSnapshot.selfCorrection ?? true,
      model: item.settingsSnapshot.model,
    } : {};

    const cleanItem: HistoryItem = {
      id: String(item.id),
      timestamp: typeof item.timestamp === 'number' ? item.timestamp : Date.now(),
      sourceText: String(item.sourceText || ''),
      translatedText: String(item.translatedText || ''),
      direction: item.direction || 'auto',
      detectedDirection: item.detectedDirection,
      register: item.register || 'neutral',
      literality: typeof item.literality === 'number' ? item.literality : 3,
      decisionsCount: typeof item.decisionsCount === 'number' ? item.decisionsCount : 0,
      starred: Boolean(item.starred),
      settingsSnapshot: cleanSnapshot,
    };

    const history = getHistory();
    // Prepend, cap at 60 items
    const updated = [cleanItem, ...history.filter(h => h.id !== cleanItem.id)].slice(0, 60);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
  } catch (e) {
    console.error('Failed to save history item', e);
  }
}

export function deleteHistoryItem(id: string): HistoryItem[] {
  try {
    const history = getHistory().filter(h => h.id !== id);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    return history;
  } catch (e) {
    console.error('Failed to delete history item', e);
    return [];
  }
}

export function toggleStarredHistory(id: string): HistoryItem[] {
  try {
    const history = getHistory().map(h => (h.id === id ? { ...h, starred: !h.starred } : h));
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    return history;
  } catch (e) {
    console.error('Failed to toggle star', e);
    return [];
  }
}

export function clearHistory(): void {
  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch (e) {
    console.error('Failed to clear history', e);
  }
}

export function getGlossary(): GlossaryItem[] {
  try {
    const raw = localStorage.getItem(GLOSSARY_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (e) {
    console.error('Failed to load glossary', e);
    return [];
  }
}

export function saveGlossary(items: GlossaryItem[]): void {
  try {
    localStorage.setItem(GLOSSARY_KEY, JSON.stringify(items));
  } catch (e) {
    console.error('Failed to save glossary', e);
  }
}

export function getSavedSettings(): TranslationSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    // If previous session had gemini-3.8-flash (which is currently quota-capped), migrate to fast flash-lite
    const model = parsed.model === 'gemini-3.8-flash' ? 'gemini-3.1-flash-lite' : (parsed.model || DEFAULT_SETTINGS.model);
    return { ...DEFAULT_SETTINGS, ...parsed, model };
  } catch (e) {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: TranslationSettings): void {
  try {
    const cleanSettings: TranslationSettings = {
      direction: settings.direction || DEFAULT_SETTINGS.direction,
      register: settings.register || DEFAULT_SETTINGS.register,
      targetAudience: settings.targetAudience || DEFAULT_SETTINGS.targetAudience,
      literality: typeof settings.literality === 'number' ? settings.literality : DEFAULT_SETTINGS.literality,
      speakerGender: settings.speakerGender || DEFAULT_SETTINGS.speakerGender,
      addresseeGender: settings.addresseeGender || DEFAULT_SETTINGS.addresseeGender,
      formalityAddress: settings.formalityAddress || DEFAULT_SETTINGS.formalityAddress,
      preserveFormatting: typeof settings.preserveFormatting === 'boolean' ? settings.preserveFormatting : DEFAULT_SETTINGS.preserveFormatting,
      typography: {
        useRussianQuotes: settings.typography?.useRussianQuotes ?? true,
        useEmDash: settings.typography?.useEmDash ?? true,
        useNonBreakingSpaces: settings.typography?.useNonBreakingSpaces ?? true,
        correctPunctuationOrder: settings.typography?.correctPunctuationOrder ?? true,
      },
      explainDecisions: settings.explainDecisions ?? true,
      provideAlternatives: settings.provideAlternatives ?? true,
      selfCorrection: settings.selfCorrection ?? true,
      model: settings.model || DEFAULT_SETTINGS.model,
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(cleanSettings));
  } catch (e) {
    console.error('Failed to save settings', e);
  }
}

// Authentication Token Storage
const AUTH_TOKEN_KEY = 'pro_trans_auth_token_v1';

export function getSavedAuthToken(): string {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function saveAuthToken(token: string): void {
  try {
    if (token) {
      localStorage.setItem(AUTH_TOKEN_KEY, token);
    } else {
      localStorage.removeItem(AUTH_TOKEN_KEY);
    }
  } catch (e) {
    console.error('Failed to save auth token', e);
  }
}

export function clearAuthToken(): void {
  try {
    localStorage.removeItem(AUTH_TOKEN_KEY);
  } catch (e) {
    console.error('Failed to clear auth token', e);
  }
}
