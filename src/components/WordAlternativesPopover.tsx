import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, X, ArrowRight, RefreshCw, Check, CornerDownLeft, FileText } from 'lucide-react';
import { WordAlternativesResponse, WordAlternativeItem } from '../types';

interface WordAlternativesPopoverProps {
  word: string;
  sentence: string;
  position: { x: number; y: number };
  containerRect?: DOMRect | null;
  isLoading: boolean;
  data: WordAlternativesResponse | null;
  error: string | null;
  onSelectAlternative: (replacement: string) => void;
  onSelectSentenceRephrasing: (rephrased: string) => void;
  onCustomReplace: (customWord: string) => void;
  onRetry: () => void;
  onClose: () => void;
}

const TAG_COLOR_MAP: Record<string, string> = {
  'Нейтрально': 'bg-slate-100 text-slate-800 border-slate-200',
  'Более формально': 'bg-blue-50 text-blue-800 border-blue-200',
  'Книжное': 'bg-purple-50 text-purple-800 border-purple-200',
  'Разговорное': 'bg-emerald-50 text-emerald-800 border-emerald-200',
  'Деловое': 'bg-indigo-50 text-indigo-800 border-indigo-200',
  'Литературное': 'bg-amber-50 text-amber-800 border-amber-200',
  'Лаконично': 'bg-cyan-50 text-cyan-800 border-cyan-200',
  'Более точное': 'bg-teal-50 text-teal-800 border-teal-200',
  'Экспрессивное': 'bg-rose-50 text-rose-800 border-rose-200',
};

export const WordAlternativesPopover: React.FC<WordAlternativesPopoverProps> = ({
  word,
  sentence,
  position,
  isLoading,
  data,
  error,
  onSelectAlternative,
  onSelectSentenceRephrasing,
  onCustomReplace,
  onRetry,
  onClose,
}) => {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [customInput, setCustomInput] = useState('');
  const [showSentenceTab, setShowSentenceTab] = useState(false);

  // Close on outside click or Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    // Timeout prevents immediate trigger from the click that opened the popover
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 50);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
      clearTimeout(timer);
    };
  }, [onClose]);

  // Handle custom submit
  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (customInput.trim()) {
      onCustomReplace(customInput.trim());
      setCustomInput('');
    }
  };

  // Calculate adjusted style within view
  const popoverStyle: React.CSSProperties = {
    top: `${position.y + 8}px`,
    left: `${Math.max(12, Math.min(position.x - 20, window.innerWidth - 380))}px`,
  };

  return (
    <div
      ref={popoverRef}
      style={popoverStyle}
      className="absolute z-50 w-80 sm:w-96 bg-white rounded-lg shadow-xl border border-[#d1d5db] overflow-hidden text-xs animate-in fade-in zoom-in-95 duration-150"
    >
      {/* Header */}
      <div className="px-3 py-2 bg-[#f9fafb] border-b border-[#e5e7eb] flex items-center justify-between">
        <div className="flex items-center gap-1.5 min-w-0">
          <Sparkles className="w-3.5 h-3.5 text-[#2563eb] shrink-0" />
          <span className="font-bold text-[#1a1a1a] truncate font-mono text-[11px]">
            «{word}»
          </span>
          <span className="text-[10px] text-[#6b7280] font-sans">
            — варианты замены (DeepL)
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 text-[#9ca3af] hover:text-[#4b5563] rounded hover:bg-[#e5e7eb] transition-colors"
          title="Закрыть (Esc)"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Tabs / Segment control if sentence rephrasings are available */}
      {data?.sentenceRephrasings && data.sentenceRephrasings.length > 0 && (
        <div className="flex border-b border-[#e5e7eb] bg-[#fcfcfc] text-[11px]">
          <button
            type="button"
            onClick={() => setShowSentenceTab(false)}
            className={`flex-1 py-1.5 px-3 font-medium text-center transition-colors border-b-2 ${
              !showSentenceTab
                ? 'border-[#2563eb] text-[#2563eb] bg-white font-semibold'
                : 'border-transparent text-[#6b7280] hover:text-[#1a1a1a]'
            }`}
          >
            Синонимы слова ({data.alternatives?.length || 0})
          </button>
          <button
            type="button"
            onClick={() => setShowSentenceTab(true)}
            className={`flex-1 py-1.5 px-3 font-medium text-center transition-colors border-b-2 flex items-center justify-center gap-1 ${
              showSentenceTab
                ? 'border-[#2563eb] text-[#2563eb] bg-white font-semibold'
                : 'border-transparent text-[#6b7280] hover:text-[#1a1a1a]'
            }`}
          >
            <FileText className="w-3 h-3" />
            <span>Вся фраза ({data.sentenceRephrasings.length})</span>
          </button>
        </div>
      )}

      {/* Body Content */}
      <div className="max-h-72 overflow-y-auto p-2">
        {isLoading ? (
          <div className="py-6 px-4 flex flex-col items-center justify-center gap-2 text-center text-[#6b7280]">
            <RefreshCw className="w-5 h-5 text-[#2563eb] animate-spin" />
            <span className="text-xs font-medium">Подбираем контекстные синонимы с учётом грамматики...</span>
            <span className="text-[10px] text-[#9ca3af]">Анализ падежа, рода и регистра фразы</span>
          </div>
        ) : error ? (
          <div className="p-3 text-center space-y-2">
            <p className="text-xs text-[#dc2626]">{error}</p>
            <button
              type="button"
              onClick={onRetry}
              className="px-2.5 py-1 bg-[#eff6ff] text-[#1d4ed8] hover:bg-[#dbeafe] rounded font-medium text-xs transition-colors"
            >
              Попробовать снова
            </button>
          </div>
        ) : showSentenceTab && data?.sentenceRephrasings ? (
          /* Whole sentence rephrasings */
          <div className="space-y-1.5">
            <div className="px-1 text-[10px] font-bold text-[#6b7280] uppercase tracking-wider">
              Перефразировать предложение целиком:
            </div>
            {data.sentenceRephrasings.map((rephrase, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => onSelectSentenceRephrasing(rephrase)}
                className="w-full text-left p-2.5 rounded border border-[#e5e7eb] hover:border-[#2563eb] hover:bg-[#eff6ff] transition-all group"
              >
                <div className="text-xs text-[#1a1a1a] group-hover:text-[#1e40af] font-medium leading-relaxed">
                  {rephrase}
                </div>
                <div className="mt-1 flex items-center justify-end text-[10px] text-[#2563eb] font-semibold opacity-0 group-hover:opacity-100 transition-opacity">
                  <span>Заменить предложение</span>
                  <ArrowRight className="w-3 h-3 ml-0.5" />
                </div>
              </button>
            ))}
          </div>
        ) : (
          /* Word Alternatives List */
          <div className="space-y-1">
            {data?.alternatives && data.alternatives.length > 0 ? (
              data.alternatives.map((item: WordAlternativeItem, idx: number) => {
                const tagClass = TAG_COLOR_MAP[item.tag] || 'bg-neutral-100 text-neutral-800 border-neutral-200';
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => onSelectAlternative(item.text)}
                    className="w-full text-left p-2 rounded hover:bg-[#eff6ff] hover:border-[#bfdbfe] border border-transparent transition-all group flex flex-col gap-0.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-xs text-[#1a1a1a] group-hover:text-[#1e40af] font-mono">
                        {item.text}
                      </span>
                      {item.tag && (
                        <span className={`px-1.5 py-0.2 rounded text-[9px] font-semibold border ${tagClass}`}>
                          {item.tag}
                        </span>
                      )}
                    </div>
                    {item.explanation && (
                      <p className="text-[11px] text-[#6b7280] group-hover:text-[#4b5563] leading-snug">
                        {item.explanation}
                      </p>
                    )}
                  </button>
                );
              })
            ) : (
              <div className="py-4 text-center text-xs text-[#6b7280]">
                Нет альтернатив для этого слова
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer: Custom manual input replacement */}
      <form
        onSubmit={handleCustomSubmit}
        className="p-2 bg-[#f9fafb] border-t border-[#e5e7eb] flex items-center gap-1.5"
      >
        <input
          type="text"
          value={customInput}
          onChange={(e) => setCustomInput(e.target.value)}
          placeholder="Или введите своё слово..."
          className="flex-1 px-2.5 py-1 text-xs border border-[#d1d5db] rounded bg-white focus:outline-none focus:border-[#2563eb]"
        />
        <button
          type="submit"
          disabled={!customInput.trim()}
          className="px-2.5 py-1 bg-[#1a1a1a] hover:bg-[#333] disabled:opacity-40 text-white rounded font-medium text-xs flex items-center gap-1 shrink-0 transition-colors"
          title="Заменить на своё слово"
        >
          <span>Заменить</span>
          <CornerDownLeft className="w-3 h-3" />
        </button>
      </form>
    </div>
  );
};
