import React, { useState } from 'react';
import { 
  Sparkles, 
  GitBranch, 
  HelpCircle, 
  Check, 
  Layers, 
  ChevronRight,
  BookOpen,
  ArrowRight,
  CheckCircle2,
  FileText,
  Eye,
  EyeOff
} from 'lucide-react';
import { TranslationDecision, AlternativeVariant, SelfCorrectionData } from '../types';

interface DecisionsAndAlternativesProps {
  decisions: TranslationDecision[];
  alternatives: AlternativeVariant[];
  selfCorrection?: SelfCorrectionData;
  generalNotes?: string;
  onApplyAlternative: (originalFragment: string, replacement: string) => void;
}

const CATEGORY_MAP: Record<string, { label: string; color: string }> = {
  idiom: { label: 'Идиома / Фразеологизм', color: 'bg-amber-50 text-amber-800 border-amber-200' },
  cultural: { label: 'Культурная реалия', color: 'bg-purple-50 text-purple-800 border-purple-200' },
  wordplay: { label: 'Игра слов / Каламбур', color: 'bg-pink-50 text-pink-800 border-pink-200' },
  syntax: { label: 'Синтаксический сдвиг', color: 'bg-blue-50 text-blue-800 border-blue-200' },
  false_friend: { label: 'Ложные друзья переводчика', color: 'bg-rose-50 text-rose-800 border-rose-200' },
  terminology: { label: 'Терминология', color: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  tone: { label: 'Регистр и коннотация', color: 'bg-indigo-50 text-indigo-800 border-indigo-200' },
};

const ASPECT_MAP: Record<string, { label: string; color: string }> = {
  syntax_calque: { label: 'Синтаксическая калька', color: 'bg-blue-50 text-blue-800 border-blue-200' },
  false_friend: { label: 'Ложные друзья переводчика', color: 'bg-rose-50 text-rose-800 border-rose-200' },
  rhythm_cadence: { label: 'Ритмика и строй фразы', color: 'bg-purple-50 text-purple-800 border-purple-200' },
  natural_flow: { label: 'Естественность речи', color: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  terminology: { label: 'Точность терминологии', color: 'bg-amber-50 text-amber-800 border-amber-200' },
  tone_consistency: { label: 'Выдержанность регистра', color: 'bg-indigo-50 text-indigo-800 border-indigo-200' },
};

export const DecisionsAndAlternatives: React.FC<DecisionsAndAlternativesProps> = ({
  decisions,
  alternatives,
  selfCorrection,
  generalNotes,
  onApplyAlternative,
}) => {
  const hasSelfCorrection = Boolean(
    selfCorrection?.enabled && 
    ((selfCorrection.refinements && selfCorrection.refinements.length > 0) || selfCorrection.editorSummary || selfCorrection.draftTranslation)
  );
  const hasDecisions = decisions && decisions.length > 0;
  const hasAlternatives = alternatives && alternatives.length > 0;

  const [activeTab, setActiveTab] = useState<'critique' | 'decisions' | 'alternatives'>(
    hasSelfCorrection ? 'critique' : 'decisions'
  );
  const [showDraftComparison, setShowDraftComparison] = useState(false);
  const [appliedVariantKey, setAppliedVariantKey] = useState<string | null>(null);

  if (!hasDecisions && !hasAlternatives && !hasSelfCorrection && !generalNotes) {
    return null;
  }

  const handleApply = (orig: string, replacement: string, key: string) => {
    onApplyAlternative(orig, replacement);
    setAppliedVariantKey(key);
    setTimeout(() => setAppliedVariantKey(null), 2500);
  };

  return (
    <div className="bg-white rounded border border-[#d1d5db] shadow-2xs overflow-hidden">
      
      {/* Tab Navigation Header */}
      <div className="h-10 px-4 bg-[#f9fafb] border-b border-[#e5e7eb] flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          {hasSelfCorrection && (
            <button
              type="button"
              onClick={() => setActiveTab('critique')}
              className={`flex items-center gap-1.5 py-1 px-2.5 rounded text-xs font-medium transition-all ${
                activeTab === 'critique'
                  ? 'bg-[#1a1a1a] text-white shadow-xs'
                  : 'text-[#4b5563] hover:text-[#1a1a1a]'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 text-[#3b82f6]" />
              <span>Самокоррекция & Редактура</span>
              {selfCorrection?.refinements && selfCorrection.refinements.length > 0 && (
                <span className={`ml-1 px-1.5 py-0.2 rounded text-[10px] font-mono ${
                  activeTab === 'critique' ? 'bg-neutral-800 text-neutral-200' : 'bg-[#e5e7eb] text-[#4b5563]'
                }`}>
                  {selfCorrection.refinements.length}
                </span>
              )}
            </button>
          )}

          {hasDecisions && (
            <button
              type="button"
              onClick={() => setActiveTab('decisions')}
              className={`flex items-center gap-1.5 py-1 px-2.5 rounded text-xs font-medium transition-all ${
                activeTab === 'decisions'
                  ? 'bg-[#1a1a1a] text-white shadow-xs'
                  : 'text-[#4b5563] hover:text-[#1a1a1a]'
              }`}
            >
              <Layers className="w-3.5 h-3.5 text-[#3b82f6]" />
              <span>Объяснение решений</span>
              <span className={`ml-1 px-1.5 py-0.2 rounded text-[10px] font-mono ${
                activeTab === 'decisions' ? 'bg-neutral-800 text-neutral-200' : 'bg-[#e5e7eb] text-[#4b5563]'
              }`}>
                {decisions.length}
              </span>
            </button>
          )}

          {hasAlternatives && (
            <button
              type="button"
              onClick={() => setActiveTab('alternatives')}
              className={`flex items-center gap-1.5 py-1 px-2.5 rounded text-xs font-medium transition-all ${
                activeTab === 'alternatives'
                  ? 'bg-[#1a1a1a] text-white shadow-xs'
                  : 'text-[#4b5563] hover:text-[#1a1a1a]'
              }`}
            >
              <GitBranch className="w-3.5 h-3.5 text-[#3b82f6]" />
              <span>Альтернативные варианты</span>
              <span className={`ml-1 px-1.5 py-0.2 rounded text-[10px] font-mono ${
                activeTab === 'alternatives' ? 'bg-neutral-800 text-neutral-200' : 'bg-[#e5e7eb] text-[#4b5563]'
              }`}>
                {alternatives.length}
              </span>
            </button>
          )}
        </div>

        <span className="text-[10px] font-mono text-[#6b7280] uppercase tracking-wider hidden sm:inline">
          Linguistic Refinements & Alternatives
        </span>
      </div>

      {/* General Notes Banner */}
      {generalNotes && (
        <div className="bg-[#fff5f5] border-b border-[#fecaca] px-4 py-2 text-xs text-[#7f1d1d] flex items-start gap-2">
          <BookOpen className="w-3.5 h-3.5 text-[#ef4444] shrink-0 mt-0.5" />
          <p className="leading-relaxed text-[11px]">{generalNotes}</p>
        </div>
      )}

      {/* Tab 0: Self-Correction & Critique */}
      {activeTab === 'critique' && selfCorrection && (
        <div className="p-4 space-y-4">
          {/* Editorial Summary Banner */}
          {selfCorrection.editorSummary && (
            <div className="bg-[#eff6ff] border border-[#bfdbfe] rounded p-3 text-xs text-[#1e3a8a] flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-[#2563eb] shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <span className="font-bold text-[11px] uppercase tracking-wider block text-[#1d4ed8]">
                  Вердикт лингвистической редактуры (Pass 2):
                </span>
                <p className="leading-relaxed text-xs text-[#1e3a8a]">{selfCorrection.editorSummary}</p>
              </div>
            </div>
          )}

          {/* Draft vs Polished toggle comparison */}
          {selfCorrection.draftTranslation && (
            <div className="bg-[#f9fafb] border border-[#e5e7eb] rounded overflow-hidden text-xs">
              <div className="px-3 py-2 bg-white border-b border-[#e5e7eb] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="w-3.5 h-3.5 text-[#6b7280]" />
                  <span className="font-semibold text-[#1a1a1a]">
                    Сравнение: первичный черновик (Pass 1) vs финальный результат
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowDraftComparison(!showDraftComparison)}
                  className="flex items-center gap-1 text-[11px] text-[#2563eb] hover:underline font-medium"
                >
                  {showDraftComparison ? (
                    <>
                      <EyeOff className="w-3 h-3" />
                      <span>Скрыть черновик</span>
                    </>
                  ) : (
                    <>
                      <Eye className="w-3 h-3" />
                      <span>Показать черновик</span>
                    </>
                  )}
                </button>
              </div>

              {showDraftComparison && (
                <div className="p-3 bg-[#fcfcfc] border-t border-[#e5e7eb] animate-in fade-in duration-150 space-y-2">
                  <div className="text-[10px] uppercase font-bold text-[#6b7280]">
                    Первоначальный черновик (до устранения калек и шлифовки):
                  </div>
                  <div className="p-2.5 bg-white rounded border border-[#d1d5db] font-mono text-xs text-[#4b5563] whitespace-pre-wrap leading-relaxed">
                    {selfCorrection.draftTranslation}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Refinements List */}
          {selfCorrection.refinements && selfCorrection.refinements.length > 0 ? (
            <div className="space-y-3">
              <span className="text-[10px] font-bold text-[#6b7280] uppercase tracking-wider block">
                Устранённые замечания и стилистические правки ({selfCorrection.refinements.length}):
              </span>

              <div className="space-y-2.5">
                {selfCorrection.refinements.map((ref, rIdx) => {
                  const aspectInfo = ASPECT_MAP[ref.aspect] || {
                    label: ref.aspect,
                    color: 'bg-neutral-100 text-neutral-800 border-neutral-200',
                  };

                  return (
                    <div
                      key={rIdx}
                      className="bg-white rounded border border-[#d1d5db] p-3 text-xs space-y-2 hover:border-[#93c5fd] transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold border ${aspectInfo.color}`}>
                          {aspectInfo.label}
                        </span>
                        <span className="text-[10px] text-[#6b7280] font-mono">
                          Правка #{rIdx + 1}
                        </span>
                      </div>

                      <div className="space-y-1.5 pt-0.5">
                        <div className="text-[#4b5563] bg-[#f9fafb] p-2 rounded border border-[#e5e7eb]">
                          <span className="text-[10px] text-[#dc2626] font-bold uppercase block mb-0.5">
                            Замечено в черновом варианте:
                          </span>
                          <span className="text-xs text-[#374151]">{ref.issue}</span>
                        </div>

                        <div className="text-[#1a1a1a] bg-[#ecfdf5] p-2 rounded border border-[#a7f3d0]">
                          <span className="text-[10px] text-[#059669] font-bold uppercase block mb-0.5">
                            Редакторское исправление:
                          </span>
                          <span className="text-xs text-[#065f46] font-medium">{ref.resolution}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="text-xs text-[#6b7280] py-2">
              Черновой вариант не потребовал глубоких перестроек: синтаксис и лексика сразу соответствовали стандартам качества.
            </div>
          )}
        </div>
      )}

      {/* Tab 1: Decisions & Explanations */}
      {activeTab === 'decisions' && (
        <div className="p-4 divide-y divide-[#e5e7eb] space-y-3">
          {decisions.map((dec, idx) => {
            const catInfo = CATEGORY_MAP[dec.category] || {
              label: dec.category,
              color: 'bg-neutral-100 text-neutral-800 border-neutral-200',
            };

            return (
              <div key={idx} className={idx > 0 ? 'pt-3 space-y-2' : 'space-y-2'}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold border ${catInfo.color}`}>
                    {catInfo.label}
                  </span>
                  <span className="text-[10px] text-[#6b7280] font-mono">
                    Segment #{idx + 1}
                  </span>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center gap-2 text-xs bg-[#f9fafb] p-2.5 rounded border border-[#e5e7eb]">
                  <div className="font-mono text-[#4b5563] sm:w-1/2">
                    <span className="text-[10px] text-[#9ca3af] block font-sans uppercase">Оригинал:</span>
                    «{dec.sourceSegment}»
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 text-[#9ca3af] hidden sm:block shrink-0" />
                  <div className="font-semibold text-[#1a1a1a] sm:w-1/2">
                    <span className="text-[10px] text-[#3b82f6] block font-sans uppercase">Выбранный перевод:</span>
                    «{dec.targetSegment}»
                  </div>
                </div>

                <div className="bg-[#fff5f5] border border-[#fecaca] rounded p-2.5 text-xs text-[#7f1d1d] space-y-1">
                  <span className="text-[10px] font-bold text-[#ef4444] uppercase tracking-wider block">
                    Обоснование решения:
                  </span>
                  <p className="leading-relaxed text-[11px] text-[#7f1d1d]">
                    {dec.explanation}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Tab 2: Interactive Alternative Variants */}
      {activeTab === 'alternatives' && (
        <div className="p-4 space-y-4">
          <p className="text-[11px] text-[#6b7280]">
            Нажмите «Подставить», чтобы мгновенно заменить фрагмент в рабочем редакторе:
          </p>

          <div className="space-y-3">
            {alternatives.map((alt, altIdx) => (
              <div
                key={altIdx}
                className="bg-[#f9fafb] rounded border border-[#e5e7eb] p-3 space-y-2.5"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  <div className="bg-white p-2 rounded border border-[#d1d5db]">
                    <span className="text-[10px] font-bold text-[#6b7280] uppercase block">Оригинал:</span>
                    <span className="font-mono text-xs text-[#1a1a1a]">«{alt.originalFragment}»</span>
                  </div>
                  <div className="bg-[#eff6ff] p-2 rounded border border-[#bfdbfe]">
                    <span className="text-[10px] font-bold text-[#1d4ed8] uppercase block">Текущий выбор:</span>
                    <span className="font-semibold text-xs text-[#1e3a8a]">«{alt.currentChoice}»</span>
                  </div>
                </div>

                <div className="space-y-1.5 pt-1">
                  <span className="text-[10px] font-bold text-[#6b7280] uppercase tracking-wider block">
                    Доступные альтернативы:
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {alt.variants.map((v, vIdx) => {
                      const vKey = `${altIdx}_${vIdx}`;
                      const isApplied = appliedVariantKey === vKey;

                      return (
                        <div
                          key={vIdx}
                          className="bg-white p-2.5 rounded border border-[#d1d5db] hover:border-[#3b82f6] transition-all flex flex-col justify-between space-y-2"
                        >
                          <div>
                            <div className="text-xs font-semibold text-[#1a1a1a] font-mono">
                              alt: «{v.text}»
                            </div>
                            <div className="text-[11px] text-[#6b7280] mt-1">
                              {v.nuance}
                            </div>
                          </div>

                          <div className="pt-1 flex justify-end">
                            <button
                              type="button"
                              onClick={() => handleApply(alt.currentChoice, v.text, vKey)}
                              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors border ${
                                isApplied
                                  ? 'bg-[#ecfdf5] text-[#065f46] border-[#a7f3d0]'
                                  : 'bg-white text-[#1a1a1a] border-[#d1d5db] hover:bg-[#f9fafb]'
                              }`}
                            >
                              {isApplied ? (
                                <>
                                  <Check className="w-3 h-3 text-[#10b981]" />
                                  <span>Подставлено</span>
                                </>
                              ) : (
                                <>
                                  <span>Подставить</span>
                                  <ChevronRight className="w-3 h-3 text-[#6b7280]" />
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
};
