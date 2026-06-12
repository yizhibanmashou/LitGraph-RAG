import type { StarNode } from '../starfield/starNavigation';
import type { ConceptReference, ConceptView } from '../../shared/types/conceptGraph';
import { DEFAULT_LANGUAGE, formatConceptTitle, formatFormulaReferenceLabel } from '../../shared/utils/uiCopy.ts';

export type ConceptLearningSource = 'adjacent' | 'chapter_sequence' | 'chapter_loop';

export interface ConceptLearningStep {
  node: StarNode;
  index: number;
  total: number;
  progressLabel: string;
  conceptId: string;
  formulaId: string;
  title: string;
  formulaLabel?: string;
  source: ConceptLearningSource;
}

export interface ConceptLearningTarget {
  node?: StarNode;
  conceptId: string;
  formulaId: string;
  title: string;
  formulaLabel?: string;
  progressLabel: string;
  source: ConceptLearningSource;
}

export interface ConceptLearningNav {
  current: ConceptLearningStep | null;
  next: ConceptLearningStep | null;
  nextFromCurrent: ConceptLearningTarget | null;
  steps: ConceptLearningStep[];
  chapterId: string;
}

export function createConceptLearningStep(node: StarNode, index: number, total: number, source: ConceptLearningSource = 'chapter_sequence'): ConceptLearningStep {
  return {
    node,
    index,
    total,
    progressLabel: `概念 ${index + 1} / ${total}`,
    conceptId: node.conceptId || '',
    formulaId: node.formulaId || '',
    title: formatConceptTitle(node.title, node.symbol, DEFAULT_LANGUAGE),
    formulaLabel: formatFormulaReferenceLabel(node.formulaLabel, DEFAULT_LANGUAGE),
    source,
  };
}

function targetFromStep(step: ConceptLearningStep, source: ConceptLearningSource): ConceptLearningTarget | null {
  if (!step.conceptId || !step.formulaId) return null;
  return {
    node: step.node,
    conceptId: step.conceptId,
    formulaId: step.formulaId,
    title: step.title,
    formulaLabel: step.formulaLabel,
    progressLabel: step.progressLabel,
    source,
  };
}

function targetFromReference(reference: ConceptReference, currentView: ConceptView): ConceptLearningTarget | null {
  if (!reference.concept_id || reference.concept_id === currentView.concept_id || reference.clickable === false) return null;
  const formulaId = reference.defined_by_formula_id || reference.from_formula_id || currentView.defined_by_formula_id;
  if (!formulaId) return null;
  return {
    conceptId: reference.concept_id,
    formulaId,
    title: formatConceptTitle(reference.name || reference.symbol || reference.concept_id, reference.symbol || reference.via_symbol, DEFAULT_LANGUAGE),
    formulaLabel: formatFormulaReferenceLabel(reference.formula_label || currentView.supporting_formula_label, DEFAULT_LANGUAGE),
    progressLabel: '相邻概念',
    source: 'adjacent',
  };
}

function firstAdjacentTarget(currentView: ConceptView | null | undefined): ConceptLearningTarget | null {
  if (!currentView) return null;
  for (const reference of currentView.prerequisite_concepts) {
    const target = targetFromReference(reference, currentView);
    if (target) return target;
  }
  for (const reference of currentView.introduced_concepts) {
    const target = targetFromReference(reference, currentView);
    if (target) return target;
  }
  return null;
}

export function buildConceptLearningNav(input: {
  chapterId: string;
  nodes: StarNode[];
  routeConceptId?: string | null;
  selectedFormulaId?: string | null;
  currentView?: ConceptView | null;
}): ConceptLearningNav | null {
  if (!input.chapterId || !input.nodes.length) return null;
  const currentIndex = input.nodes.findIndex((node) =>
    Boolean(input.routeConceptId && node.conceptId === input.routeConceptId) ||
    Boolean(!input.routeConceptId && input.selectedFormulaId && node.formulaId === input.selectedFormulaId)
  );
  const steps = input.nodes.map((node, index) => createConceptLearningStep(node, index, input.nodes.length));
  const current = currentIndex >= 0 ? steps[currentIndex] : null;
  const next = currentIndex >= 0 && currentIndex + 1 < steps.length ? steps[currentIndex + 1] : null;
  return {
    current,
    next,
    nextFromCurrent: resolveNextConceptFromCurrent({
      currentView: input.currentView,
      current,
      next,
      chapterSteps: steps,
      routeConceptId: input.routeConceptId,
    }),
    steps,
    chapterId: input.chapterId,
  };
}

export function resolveNextConceptFromCurrent(input: {
  currentView?: ConceptView | null;
  current?: ConceptLearningStep | null;
  next?: ConceptLearningStep | null;
  chapterSteps: ConceptLearningStep[];
  routeConceptId?: string | null;
}): ConceptLearningTarget | null {
  const adjacent = firstAdjacentTarget(input.currentView);
  if (adjacent) return adjacent;

  const currentConceptId = input.currentView?.concept_id || input.current?.conceptId || input.routeConceptId || '';
  if (input.next && input.next.conceptId !== currentConceptId) {
    return targetFromStep(input.next, 'chapter_sequence');
  }

  const loopStep = input.chapterSteps.find((step) => Boolean(step.conceptId && step.formulaId && step.conceptId !== currentConceptId));
  return loopStep ? targetFromStep(loopStep, 'chapter_loop') : null;
}
