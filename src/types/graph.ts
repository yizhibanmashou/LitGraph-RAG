import type { FormulaPrerequisite, ChapterFormula } from './formula';

export type FormulaExpansionIntent = 'auto' | 'prerequisites' | 'successors';

export interface FormulaNodeData {
  formula: ChapterFormula;
  focused: boolean;
  loading?: boolean;
  role?: 'focus' | 'prerequisite' | 'expanded' | 'successor';
  mode?: 'guided' | 'focus' | 'explore';
  locked?: boolean;
  lockedReason?: string;
  learned?: boolean;
  chapterGraph?: boolean;
  symbolExplanations?: Array<
    FormulaPrerequisite & {
      shortLabel?: string;
      llmText?: string;
      llmStatus?: 'loading' | 'ready' | 'error';
    }
  >;
  onExpand: (formulaId: string, intent?: FormulaExpansionIntent) => void;
}

export interface VariableNodeData {
  prerequisite: FormulaPrerequisite;
  formulaId?: string;
  formulaLatex?: string;
}

export interface DependencyEdgeData {
  via: string;
  crossChapter: boolean;
  confidence: number;
  explanation?: string;
  active?: boolean;
  dimmed?: boolean;
  labelVisible?: boolean;
}
