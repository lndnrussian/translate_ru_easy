import React, { useState, useRef, useEffect, useMemo } from 'react';
import { 
  Copy, 
  Check, 
  Trash2, 
  ClipboardPaste, 
  Type, 
  Download, 
  Sparkles, 
  ArrowRight,
  RefreshCw,
  Edit3,
  BookOpen,
  MousePointerClick
} from 'lucide-react';
import { formatRussianTypography, formatEnglishTypography, detectLanguage } from '../utils/typography';
import { TranslationSettings, SelfCorrectionData, AlternativeVariant, WordAlternativesResponse } from '../types';
import { WordAlternativesPopover } from './WordAlternativesPopover';
import { requestWordAlternatives } from '../services/api';

interface TranslationWorkspaceProps {
  sourceText: string;
  onChangeSourceText: (text: string) => void;
  translatedText: string;
  onChangeTranslatedText: (text: string) => void;
  onTranslate: () => void;
  isLoading: boolean;
  settings: TranslationSettings;
  processingTimeMs?: number;
  detectedDirection?: 'ru-en' | 'en-ru';
  usedModel?: string;
  wasFallback?: boolean;
  selfCorrection?: SelfCorrectionData;
  existingAlternatives?: AlternativeVariant[];
}

interface TextToken {
  id: number;
  text: string;
  isWord: boolean;
  start: number;
  end: number;
}

function tokenizeText(text: string): TextToken[] {
  const tokens: TextToken[] = [];
  // Match words (including unicode letters, apostrophes, hyphens within words) or non-words
  const regex = /([\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*|[^\p{L}\p{N}\s]+|\s+)/gu;
  let match;
  let id = 0;
  while ((match = regex.exec(text)) !== null) {
    const matchedText = match[0];
    const isWord = /^[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*$/u.test(matchedText);
    tokens.push({
      id: id++,
      text: matchedText,
      isWord,
      start: match.index,
      end: match.index + matchedText.length,
    });
  }
  return tokens;
}

function extractSentence(text: string, charIndex: number): { sentence: string; start: number; end: number } {
  const before = text.slice(0, charIndex);
  const after = text.slice(charIndex);

  let start = 0;
  const sentenceEndRegex = /[.!?\n]+/g;
  let match;
  while ((match = sentenceEndRegex.exec(before)) !== null) {
    start = match.index + match[0].length;
  }

  let end = text.length;
  const nextEndMatch = /[.!?\n]/.exec(after);
  if (nextEndMatch) {
    end = charIndex + nextEndMatch.index + 1;
  }

  const sentence = text.slice(start, end).trim();
  return { sentence: sentence || text, start, end };
}

function matchCasing(original: string, replacement: string): string {
  if (!original || !replacement) return replacement;
  if (original === original.toUpperCase() && original.length > 1) {
    return replacement.toUpperCase();
  }
  if (original[0] === original[0].toUpperCase() && original.slice(1) === original.slice(1).toLowerCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement.charAt(0).toLowerCase() + replacement.slice(1);
}

const SAMPLE_TEXTS: Array<{ label: string; text: string; dir: 'ru-en' | 'en-ru' }> = [
  {
    label: 'Художественная проза (RU → EN)',
    dir: 'ru-en',
    text: 'Вечерний Петербург дышал сыростью и холодным гранитом. Он стоял на набережной, чувствуя, как время утекает сквозь пальцы, словно невская вода, и думал о том, что всё произошедшее было не случайностью, а неизбежной платой за гордость.',
  },
  {
    label: 'Идиомы и реалии (EN → RU)',
    dir: 'en-ru',
    text: 'Let\'s not beat around the bush — our competitor just pulled a rabbit out of a hat with their new product release. We need to bite the bullet, burn the midnight oil, and hit the ground running tomorrow morning.',
  },
  {
    label: 'Маркетинг и копирайтинг (RU → EN)',
    dir: 'ru-en',
    text: 'Мы создаем инструменты, которые не просто экономят ваше время, а возвращают радость чистого творчества. Никакой рутины — только безупречный результат с первого клика.',
  },
  {
    label: 'Деловые переговоры (EN → RU)',
    dir: 'en-ru',
    text: 'Pursuant to our prior discussion, we would like to reiterate our commitment to the proposed partnership, subject to mutually agreeable indemnification clauses and due diligence findings.',
  },
];

export const TranslationWorkspace: React.FC<TranslationWorkspaceProps> = ({
  sourceText,
  onChangeSourceText,
  translatedText,
  onChangeTranslatedText,
  onTranslate,
  isLoading,
  settings,
  processingTimeMs,
  detectedDirection,
  usedModel,
  wasFallback,
  selfCorrection,
  existingAlternatives,
}) => {
  const [copied, setCopied] = useState(false);
  const [typographyApplied, setTypographyApplied] = useState(false);
  const sourceTextareaRef = useRef<HTMLTextAreaElement>(null);
  const outputPanelRef = useRef<HTMLDivElement>(null);

  // DeepL Interactive Word Replacement Mode
  const [outputMode, setOutputMode] = useState<'deepl' | 'raw'>('deepl');
  const [activeToken, setActiveToken] = useState<TextToken | null>(null);
  const [activeSentence, setActiveSentence] = useState<{ text: string; start: number; end: number } | null>(null);
  const [popoverPosition, setPopoverPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [popoverData, setPopoverData] = useState<WordAlternativesResponse | null>(null);
  const [popoverLoading, setPopoverLoading] = useState(false);
  const [popoverError, setPopoverError] = useState<string | null>(null);
  const [alternativesCache, setAlternativesCache] = useState<Record<string, WordAlternativesResponse>>({});
  const [lastReplacedInfo, setLastReplacedInfo] = useState<string | null>(null);

  // Tokenize translated text when in interactive mode
  const textTokens = useMemo(() => {
    if (!translatedText) return [];
    return tokenizeText(translatedText);
  }, [translatedText]);

  // Auto-detect language
  const detectedLang = detectLanguage(sourceText);

  // Ctrl/Cmd + Enter to trigger translation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        if (!isLoading && sourceText.trim()) {
          onTranslate();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isLoading, sourceText, onTranslate]);

  const handleCopy = () => {
    if (!translatedText) return;
    navigator.clipboard.writeText(translatedText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        onChangeSourceText(text);
      }
    } catch {
      // Fallback
    }
  };

  const handleApplyTypography = () => {
    if (!translatedText) return;
    // Determine whether target is Russian or English
    const targetIsRu = detectedDirection === 'en-ru' || settings.direction === 'en-ru';
    const formatted = targetIsRu
      ? formatRussianTypography(translatedText, settings.typography)
      : formatEnglishTypography(translatedText);

    onChangeTranslatedText(formatted);
    setTypographyApplied(true);
    setTimeout(() => setTypographyApplied(false), 2000);
  };

  const handleDownload = () => {
    if (!translatedText) return;
    const blob = new Blob([translatedText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `translation_${Date.now()}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const sourceWords = sourceText.trim() ? sourceText.trim().split(/\s+/).length : 0;
  const targetWords = translatedText.trim() ? translatedText.trim().split(/\s+/).length : 0;

  // DeepL Interactive Word Replacement Handlers
  const handleWordClick = async (token: TextToken, e: React.MouseEvent<HTMLSpanElement>) => {
    e.stopPropagation();
    setActiveToken(token);

    const { sentence, start: sStart, end: sEnd } = extractSentence(translatedText, token.start);
    setActiveSentence({ text: sentence, start: sStart, end: sEnd });

    if (outputPanelRef.current) {
      const rect = e.currentTarget.getBoundingClientRect();
      const parentRect = outputPanelRef.current.getBoundingClientRect();
      setPopoverPosition({
        x: Math.max(10, rect.left - parentRect.left),
        y: rect.bottom - parentRect.top,
      });
    }

    const cacheKey = `${token.text.toLowerCase()}__${sentence.slice(0, 40)}`;
    if (alternativesCache[cacheKey]) {
      setPopoverData(alternativesCache[cacheKey]);
      setPopoverLoading(false);
      setPopoverError(null);
      return;
    }

    // Pre-populate if matching existing translation alternatives
    if (existingAlternatives && existingAlternatives.length > 0) {
      const match = existingAlternatives.find(
        (a) =>
          a.currentChoice.toLowerCase().includes(token.text.toLowerCase()) ||
          token.text.toLowerCase().includes(a.currentChoice.toLowerCase())
      );
      if (match && match.variants && match.variants.length > 0) {
        const precomputed: WordAlternativesResponse = {
          word: token.text,
          sentence,
          alternatives: match.variants.map((v) => ({
            text: v.text,
            tag: 'Вариант перевода',
            explanation: v.nuance || '',
          })),
          sentenceRephrasings: [],
        };
        setPopoverData(precomputed);
        setAlternativesCache((prev) => ({ ...prev, [cacheKey]: precomputed }));
        setPopoverLoading(false);
        setPopoverError(null);
        return;
      }
    }

    setPopoverLoading(true);
    setPopoverError(null);
    setPopoverData(null);

    try {
      const res = await requestWordAlternatives({
        word: token.text,
        sentence,
        sourceText,
        direction: detectedDirection || (settings.direction === 'auto' ? 'ru-en' : settings.direction),
        register: settings.register,
        model: settings.model,
      });
      setPopoverData(res);
      setAlternativesCache((prev) => ({ ...prev, [cacheKey]: res }));
    } catch (err: any) {
      setPopoverError(err?.message || 'Не удалось загрузить варианты синонимов.');
    } finally {
      setPopoverLoading(false);
    }
  };

  const handleSelectAlternative = (replacement: string) => {
    if (!activeToken) return;
    const originalWord = activeToken.text;
    const formatted = matchCasing(originalWord, replacement);
    const newText =
      translatedText.slice(0, activeToken.start) +
      formatted +
      translatedText.slice(activeToken.end);
    onChangeTranslatedText(newText);
    setLastReplacedInfo(`Заменено: «${originalWord}» → «${formatted}»`);
    setTimeout(() => setLastReplacedInfo(null), 2500);
    setActiveToken(null);
  };

  const handleSelectSentenceRephrasing = (rephrased: string) => {
    if (!activeSentence) return;
    const newText =
      translatedText.slice(0, activeSentence.start) +
      rephrased +
      translatedText.slice(activeSentence.end);
    onChangeTranslatedText(newText);
    setLastReplacedInfo(`Фраза перефразирована`);
    setTimeout(() => setLastReplacedInfo(null), 2500);
    setActiveToken(null);
  };

  const handleCustomReplace = (customWord: string) => {
    if (!activeToken) return;
    const originalWord = activeToken.text;
    const formatted = matchCasing(originalWord, customWord);
    const newText =
      translatedText.slice(0, activeToken.start) +
      formatted +
      translatedText.slice(activeToken.end);
    onChangeTranslatedText(newText);
    setLastReplacedInfo(`Заменено: «${originalWord}» → «${formatted}»`);
    setTimeout(() => setLastReplacedInfo(null), 2500);
    setActiveToken(null);
  };

  const handleRetryFetchAlternatives = () => {
    if (activeToken && activeSentence) {
      setPopoverLoading(true);
      setPopoverError(null);
      requestWordAlternatives({
        word: activeToken.text,
        sentence: activeSentence.text,
        sourceText,
        direction: detectedDirection || (settings.direction === 'auto' ? 'ru-en' : settings.direction),
        register: settings.register,
        model: settings.model,
      })
        .then((res) => {
          const cacheKey = `${activeToken.text.toLowerCase()}__${activeSentence.text.slice(0, 40)}`;
          setPopoverData(res);
          setAlternativesCache((prev) => ({ ...prev, [cacheKey]: res }));
        })
        .catch((err) => {
          setPopoverError(err?.message || 'Не удалось загрузить варианты синонимов.');
        })
        .finally(() => {
          setPopoverLoading(false);
        });
    }
  };

  return (
    <div className="space-y-3">
      
      {/* Sample text bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2 text-[#6b7280]">
          <BookOpen className="w-3.5 h-3.5 text-[#3b82f6]" />
          <span className="text-[10px] font-bold uppercase tracking-wider">Примеры:</span>
          <div className="flex flex-wrap gap-1">
            {SAMPLE_TEXTS.map((sample, idx) => (
              <button
                key={idx}
                onClick={() => onChangeSourceText(sample.text)}
                className="px-2 py-0.5 bg-white hover:bg-[#f3f4f6] text-[#4b5563] border border-[#d1d5db] rounded text-[11px] font-medium transition-colors"
              >
                {sample.label.split(' (')[0]}
              </button>
            ))}
          </div>
        </div>

        <div className="text-[#6b7280] font-mono text-[11px] hidden sm:flex items-center gap-1.5">
          <span className="opacity-70">Клавиши:</span>
          <kbd className="px-1.5 py-0.5 bg-white border border-[#d1d5db] rounded text-[10px] text-[#1a1a1a] font-semibold">
            ⌘ / Ctrl + Enter
          </kbd>
        </div>
      </div>

      {/* Main Dual Editor Data Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        
        {/* Source Text Panel */}
        <div className="bg-white rounded border border-[#d1d5db] shadow-2xs flex flex-col min-h-[380px] sm:min-h-[420px] focus-within:border-[#1a1a1a] transition-all">
          
          {/* Source Header */}
          <div className="h-10 bg-[#f9fafb] border-b border-[#e5e7eb] flex items-center justify-between px-4 shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-[#6b7280] uppercase tracking-wide">
                Исходный текст ({detectedLang === 'ru' ? 'RU' : detectedLang === 'en' ? 'EN' : 'AUTO'})
              </span>
              {detectedLang !== 'unknown' && (
                <span className="px-1.5 py-0.2 bg-[#eff6ff] text-[#1d4ed8] border border-[#bfdbfe] rounded text-[10px] font-mono font-medium">
                  {detectedLang === 'ru' ? 'Кириллица' : 'Latin'}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5 text-[#6b7280]">
              <button
                onClick={handlePaste}
                className="flex items-center gap-1 px-2 py-1 hover:bg-white border border-transparent hover:border-[#d1d5db] rounded transition-colors text-xs text-[#1a1a1a]"
                title="Вставить из буфера"
              >
                <ClipboardPaste className="w-3 h-3 text-[#6b7280]" />
                <span className="text-[11px]">Вставить</span>
              </button>
              {sourceText && (
                <button
                  onClick={() => onChangeSourceText('')}
                  className="flex items-center gap-1 px-2 py-1 hover:bg-white border border-transparent hover:border-[#d1d5db] rounded transition-colors text-xs text-[#ef4444]"
                  title="Очистить поле"
                >
                  <Trash2 className="w-3 h-3" />
                  <span className="text-[11px]">Очистить</span>
                </button>
              )}
            </div>
          </div>

          {/* Source Textarea */}
          <textarea
            ref={sourceTextareaRef}
            id="source-text-input"
            value={sourceText}
            onChange={(e) => onChangeSourceText(e.target.value)}
            placeholder="Введите текст для перевода..."
            className="flex-1 w-full p-5 text-sm text-[#1a1a1a] placeholder:text-[#9ca3af] resize-none focus:outline-none font-sans leading-relaxed"
          />

          {/* Source Footer Stats & Translate CTA */}
          <div className="h-11 px-4 bg-[#f9fafb] border-t border-[#e5e7eb] flex items-center justify-between text-xs text-[#6b7280] shrink-0">
            <div className="flex items-center gap-3 font-mono text-[11px]">
              <span>{sourceText.length} chars</span>
              <span>•</span>
              <span>{sourceWords} words</span>
            </div>

            <button
              id="submit-translate-btn"
              onClick={() => onTranslate()}
              disabled={isLoading || !sourceText.trim()}
              className={`flex items-center gap-2 px-4 py-1.5 rounded text-xs font-semibold shadow-xs transition-all ${
                isLoading || !sourceText.trim()
                  ? 'bg-[#e5e7eb] text-[#9ca3af] cursor-not-allowed'
                  : 'bg-[#1a1a1a] hover:bg-black text-white active:scale-[0.98]'
              }`}
            >
              {isLoading ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#3b82f6]" />
                  <span>Обработка...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5 text-[#3b82f6]" />
                  <span>Перевести</span>
                </>
              )}
            </button>
          </div>

        </div>

        {/* Translation Output Panel (In-place editable & DeepL word replacement) */}
        <div 
          ref={outputPanelRef}
          className="bg-[#fcfcfc] rounded border border-[#d1d5db] shadow-2xs flex flex-col min-h-[380px] sm:min-h-[420px] focus-within:border-[#1a1a1a] transition-all relative"
        >
          {/* Output Header */}
          <div className="h-10 bg-[#f9fafb] border-b border-[#e5e7eb] flex items-center justify-between px-3 sm:px-4 shrink-0 gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[10px] font-bold text-[#6b7280] uppercase tracking-wide truncate">
                Результат
              </span>
              {detectedDirection && (
                <span className="px-1.5 py-0.2 bg-[#eff6ff] text-[#1d4ed8] border border-[#bfdbfe] font-mono font-medium rounded text-[10px] uppercase shrink-0">
                  {detectedDirection}
                </span>
              )}

              {/* View Mode Toggle: DeepL Interactive vs Raw Textarea */}
              <div className="flex items-center bg-[#e5e7eb] p-0.5 rounded text-xs ml-1 shrink-0">
                <button
                  type="button"
                  onClick={() => setOutputMode('deepl')}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-all ${
                    outputMode === 'deepl'
                      ? 'bg-white text-[#1a1a1a] shadow-2xs font-semibold'
                      : 'text-[#6b7280] hover:text-[#1a1a1a]'
                  }`}
                  title="Интерактивный режим: клик по любому слову открывает контекстные синонимы для быстрой замены"
                >
                  <MousePointerClick className="w-3 h-3 text-[#2563eb]" />
                  <span className="hidden sm:inline">Замена слов (DeepL)</span>
                  <span className="sm:hidden">DeepL</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOutputMode('raw');
                    setActiveToken(null);
                  }}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-all ${
                    outputMode === 'raw'
                      ? 'bg-white text-[#1a1a1a] shadow-2xs font-semibold'
                      : 'text-[#6b7280] hover:text-[#1a1a1a]'
                  }`}
                  title="Обычный текстовый редактор"
                >
                  <Edit3 className="w-3 h-3 text-[#6b7280]" />
                  <span>Текст</span>
                </button>
              </div>
            </div>

            {/* Output Tools */}
            <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
              <button
                onClick={handleApplyTypography}
                disabled={!translatedText}
                className={`flex items-center gap-1 px-2 py-0.5 border border-[#d1d5db] rounded text-xs transition-colors bg-white ${
                  typographyApplied
                    ? 'bg-[#ecfdf5] text-[#065f46] border-[#a7f3d0]'
                    : 'text-[#4b5563] hover:bg-[#f9fafb]'
                }`}
                title="Применить русскую типографику"
              >
                <Type className="w-3 h-3 text-[#3b82f6]" />
                <span className="text-[11px] font-medium hidden sm:inline">
                  {typographyApplied ? 'Типографика OK' : 'Типографика'}
                </span>
              </button>

              <button
                onClick={handleCopy}
                disabled={!translatedText}
                className={`flex items-center gap-1 px-2.5 py-0.5 border border-[#d1d5db] rounded text-xs transition-colors bg-white ${
                  copied
                    ? 'bg-[#ecfdf5] text-[#065f46] border-[#a7f3d0]'
                    : 'text-[#1a1a1a] hover:bg-[#f9fafb]'
                }`}
                title="Скопировать перевод"
              >
                {copied ? <Check className="w-3 h-3 text-[#10b981]" /> : <Copy className="w-3 h-3 text-[#6b7280]" />}
                <span className="text-[11px] font-medium">{copied ? 'Готово' : 'Копия'}</span>
              </button>

              <button
                onClick={handleDownload}
                disabled={!translatedText}
                className="p-1 border border-[#d1d5db] bg-white hover:bg-[#f9fafb] rounded text-[#4b5563] transition-colors"
                title="Скачать .txt"
              >
                <Download className="w-3 h-3" />
              </button>
            </div>
          </div>

          {/* Replacement Toast Notification */}
          {lastReplacedInfo && (
            <div className="absolute top-12 right-4 z-40 px-2.5 py-1 bg-[#10b981] text-white text-[11px] font-medium rounded shadow-md flex items-center gap-1 animate-in fade-in slide-in-from-top-2 duration-150">
              <Check className="w-3 h-3" />
              <span>{lastReplacedInfo}</span>
            </div>
          )}

          {/* Main Output Body */}
          <div className="flex-1 flex flex-col relative bg-[#fcfcfc] overflow-hidden">
            {outputMode === 'deepl' ? (
              /* DeepL Interactive Words Click Mode */
              <div className="flex-1 flex flex-col relative">
                {translatedText ? (
                  <>
                    {/* DeepL Info Banner */}
                    <div className="px-4 py-1.5 bg-[#eff6ff] border-b border-[#dbeafe] flex items-center justify-between text-[11px] text-[#1e40af] select-none">
                      <div className="flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-[#2563eb] shrink-0" />
                        <span>Кликните на любое слово для вызова синонимов и вариантов замены</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setOutputMode('raw')}
                        className="text-[#2563eb] hover:underline font-medium text-[10px] hidden sm:inline"
                      >
                        Редактировать вручную →
                      </button>
                    </div>

                    {/* Interactive Text Canvas */}
                    <div 
                      className="flex-1 p-5 text-sm text-[#1a1a1a] font-sans leading-relaxed whitespace-pre-wrap overflow-y-auto select-text relative"
                      onClick={() => setActiveToken(null)}
                    >
                      {textTokens.map((token) => {
                        if (!token.isWord) {
                          return <span key={token.id}>{token.text}</span>;
                        }

                        const isActive = activeToken?.id === token.id;

                        return (
                          <span
                            key={token.id}
                            onClick={(e) => handleWordClick(token, e)}
                            className={`cursor-pointer rounded px-0.5 py-0.2 transition-all inline-block ${
                              isActive
                                ? 'bg-[#2563eb] text-white shadow-xs scale-105'
                                : 'hover:bg-[#dbeafe] hover:text-[#1e40af] hover:underline decoration-[#3b82f6] decoration-1 underline-offset-2'
                            }`}
                            title="Кликните для выбора синонима (DeepL)"
                          >
                            {token.text}
                          </span>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  /* Empty state */
                  <div className="flex-1 p-5 text-sm text-[#9ca3af] flex flex-col items-center justify-center text-center gap-2">
                    {isLoading ? (
                      <>
                        <RefreshCw className="w-6 h-6 text-[#2563eb] animate-spin mb-1" />
                        <span className="font-medium text-[#4b5563]">Выполняется перевод текста...</span>
                        <span className="text-xs text-[#9ca3af]">Скоро здесь появятся интерактивные слова для клика</span>
                      </>
                    ) : (
                      <>
                        <MousePointerClick className="w-6 h-6 text-[#d1d5db] mb-1" />
                        <span className="font-medium text-[#6b7280]">
                          Здесь появится перевод с возможностью клика по словам для выбора синонимов
                        </span>
                        <span className="text-xs text-[#9ca3af] max-w-sm">
                          Как в DeepL: любое слово можно заменить на контекстный синоним с автоматическим согласованием формы и падежа
                        </span>
                      </>
                    )}
                  </div>
                )}

                {/* Popover anchored to clicked word */}
                {activeToken && activeSentence && (
                  <WordAlternativesPopover
                    word={activeToken.text}
                    sentence={activeSentence.text}
                    position={popoverPosition}
                    isLoading={popoverLoading}
                    data={popoverData}
                    error={popoverError}
                    onSelectAlternative={handleSelectAlternative}
                    onSelectSentenceRephrasing={handleSelectSentenceRephrasing}
                    onCustomReplace={handleCustomReplace}
                    onRetry={handleRetryFetchAlternatives}
                    onClose={() => setActiveToken(null)}
                  />
                )}
              </div>
            ) : (
              /* Raw Textarea Editor Mode */
              <div className="flex-1 flex flex-col relative">
                <textarea
                  id="translated-text-output"
                  value={translatedText}
                  onChange={(e) => onChangeTranslatedText(e.target.value)}
                  placeholder={isLoading ? "Выполняется перевод с учётом всех параметров..." : "Здесь появится перевод (поле доступно для ручной правки)..."}
                  className="flex-1 w-full p-5 text-sm text-[#1a1a1a] placeholder:text-[#9ca3af] resize-none focus:outline-none font-sans leading-relaxed bg-transparent"
                />
              </div>
            )}
          </div>

          {/* Output Footer Stats */}
          <div className="h-11 px-4 bg-[#f9fafb] border-t border-[#e5e7eb] flex items-center justify-between text-xs text-[#6b7280] shrink-0">
            <div className="flex items-center gap-3 font-mono text-[11px]">
              <span>{translatedText.length} chars</span>
              <span>•</span>
              <span>{targetWords} words</span>
            </div>

            <div className="flex items-center gap-2.5">
              {selfCorrection?.enabled && (
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#eff6ff] text-[#1e40af] border border-[#bfdbfe] text-[10px] font-medium"
                  title={selfCorrection.editorSummary || 'Выполнен 2-проходный перевод с лингвистической самокоррекцией'}
                >
                  <Sparkles className="w-2.5 h-2.5 text-[#2563eb]" />
                  <span>2-проходная правка{selfCorrection.refinements?.length ? ` (${selfCorrection.refinements.length})` : ''}</span>
                </span>
              )}

              {usedModel && (
                wasFallback ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#fef3c7] text-[#92400e] border border-[#fde68a] text-[10px] font-mono font-medium shadow-2xs" title="Основная модель была временно перегружена, использована резервная модель">
                    ⚠ Резервная модель: {usedModel}
                  </span>
                ) : (
                  <span className="text-[#6b7280] font-mono text-[11px]">
                    Модель: {usedModel}
                  </span>
                )
              )}

              {processingTimeMs && processingTimeMs > 0 && (
                <span className="text-[#6b7280] font-mono text-[11px]">
                  Latency: {(processingTimeMs / 1000).toFixed(2)}s
                </span>
              )}
            </div>
          </div>

        </div>

      </div>

    </div>
  );
};
