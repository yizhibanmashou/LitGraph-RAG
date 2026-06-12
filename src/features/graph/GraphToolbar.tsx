import type { ReactNode } from 'react';
import { ArrowLeft, ArrowRight, MousePointerClick, RefreshCcw } from 'lucide-react';
import type { GraphStudyMode } from './GraphModeControls';
import type { getUiCopy } from '../../shared/utils/uiCopy';
import type { ConceptLearningNav } from './conceptLearning';

interface GraphToolbarProps {
  copy: ReturnType<typeof getUiCopy>['graph'];
  mode: GraphStudyMode;
  toolbar?: ReactNode;
  conceptBackLabel?: string | null;
  conceptLearningNav?: ConceptLearningNav | null;
  storylineId: string | null;
  storylineTitle?: string | null;
  isChapterGraph: boolean;
  showHint: boolean;
  onBackToConcept?: () => void;
  onBackToStoryline: () => void;
  onHome: () => void;
  onOpenNextConcept?: () => void;
  onExpand: () => void;
  onDismissHint: () => void;
}

export function GraphToolbar({
  copy,
  mode,
  toolbar,
  conceptBackLabel,
  conceptLearningNav,
  storylineId,
  storylineTitle,
  isChapterGraph,
  showHint,
  onBackToConcept,
  onBackToStoryline,
  onHome,
  onOpenNextConcept,
  onExpand,
  onDismissHint,
}: GraphToolbarProps) {
  const nextConcept = conceptLearningNav?.nextFromCurrent;
  return (
    <div className="graph-toolbar absolute left-[22px] right-5 top-4 z-20 flex flex-wrap items-center gap-2">
      {storylineId ? (
        <button
          type="button"
          onClick={onBackToStoryline}
          className="graph-toolbar-button inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold"
          title={`${copy.fromStoryline}${storylineTitle || ''}`}
        >
          <ArrowLeft size={16} />
          Storyline
        </button>
      ) : null}
      <button type="button" onClick={onHome} className="graph-toolbar-button inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold">
        {copy.home}
      </button>
      {!isChapterGraph && conceptBackLabel && onBackToConcept ? (
        <button
          type="button"
          onClick={onBackToConcept}
          className="graph-toolbar-button graph-toolbar-button--concept-nav inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold"
          title={conceptBackLabel}
        >
          <ArrowLeft size={16} />
          <span>Back to concept</span>
        </button>
      ) : null}
      {mode === 'concept' && nextConcept && onOpenNextConcept ? (
        <button
          type="button"
          onClick={onOpenNextConcept}
          className="graph-toolbar-button graph-toolbar-button--concept-nav inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold"
          title={`${nextConcept.title}${nextConcept.formulaLabel ? ` · ${nextConcept.formulaLabel}` : ''}`}
        >
          <span>Next concept</span>
          <ArrowRight size={16} />
        </button>
      ) : null}
      {toolbar}
      {!isChapterGraph && mode !== 'concept' ? (
        <button type="button" onClick={onExpand} className="graph-toolbar-button inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold">
          <RefreshCcw size={16} />
          {copy.expand}
        </button>
      ) : null}
      {showHint ? (
        <div className="graph-onboarding-hint animate-[fadeSlideUp_0.5s_ease_0.6s_both]" role="status">
          <MousePointerClick size={16} className="graph-onboarding-hint__icon shrink-0" />
          <span>{copy.hints[mode]}</span>
          <button type="button" onClick={onDismissHint} aria-label={copy.dismissHint}>
            x
          </button>
        </div>
      ) : null}
    </div>
  );
}
