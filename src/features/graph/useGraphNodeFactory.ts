import { useCallback, type MutableRefObject } from 'react';
import type { Node, XYPosition } from '@xyflow/react';
import type { ChapterDependencies, ChapterFormula } from '../../shared/types/formula';
import type { FormulaExpansionIntent, FormulaNodeData } from '../../shared/types/graph';
import type { FocusAnnotationNote } from './focusAnnotations';
import { buildFocusSymbolPrerequisites } from './graphCanvasModel';
import type { GraphStudyMode } from './GraphModeControls';

interface UseGraphNodeFactoryParams {
  expandFormulaRef: MutableRefObject<(formulaId: string, intent?: FormulaExpansionIntent) => void>;
  focusChapterId: string;
  focusFormula: (formulaId: string, intent?: FormulaExpansionIntent) => void;
  focusFormulaId: string;
  isChapterGraph: boolean;
  learnedByChapter: Record<string, Set<string>>;
  loadingIds: Set<string>;
  mode: GraphStudyMode;
}

export function useGraphNodeFactory({
  expandFormulaRef,
  focusChapterId,
  focusFormula,
  focusFormulaId,
  isChapterGraph,
  learnedByChapter,
  loadingIds,
  mode,
}: UseGraphNodeFactoryParams) {
  const makeStaticFormulaNode = useCallback(
    (
      formula: ChapterFormula,
      position: XYPosition,
      focused = false,
      role: FormulaNodeData['role'] = 'successor',
      symbolExplanations: FocusAnnotationNote[] = [],
      chapterGraph = false,
    ): Node => ({
      id: formula.id,
      type: 'formula',
      position,
      data: {
        formula,
        focused,
        loading: false,
        role: focused ? 'focus' : role,
        mode,
        locked: false,
        learned: false,
        chapterGraph,
        symbolExplanations,
        onExpand: (formulaId: string, intent?: FormulaExpansionIntent) => expandFormulaRef.current(formulaId, intent),
      } satisfies FormulaNodeData,
    }),
    [expandFormulaRef, mode],
  );

  const makeFormulaNode = useCallback(
    (
      formula: ChapterFormula,
      position: XYPosition,
      focused = false,
      role: FormulaNodeData['role'] = 'successor',
      chapter?: ChapterDependencies | null,
    ): Node => {
      const locked = false;
      const learned = Boolean(learnedByChapter[focusChapterId]?.has(formula.id));
      const focusSymbolExplanations = mode === 'guided' && !isChapterGraph ? buildFocusSymbolPrerequisites(formula, null) : [];
      return {
        id: formula.id,
        type: 'formula',
        position,
        data: {
          formula,
          focused,
          loading: false,
          role: focused ? 'focus' : role,
          mode,
          locked,
          lockedReason: undefined,
          lockedTargetFormulaId: undefined,
          lockedTargetLabel: undefined,
          learned,
          symbolExplanations: focusSymbolExplanations,
          onExpand: focusFormula,
        } satisfies FormulaNodeData,
      };
    },
    [
      focusChapterId,
      focusFormula,
      isChapterGraph,
      learnedByChapter,
      mode,
    ],
  );

  const refreshNodeData = useCallback(
    (items: Node[], chapter?: ChapterDependencies | null) =>
      items.map((node) => {
        if (node.type !== 'formula') return node;
        const data = node.data as unknown as FormulaNodeData;
        const locked = false;
        return {
          ...node,
          data: {
            ...data,
            focused: !isChapterGraph && node.id === focusFormulaId,
            loading: loadingIds.has(node.id),
            role: !isChapterGraph && node.id === focusFormulaId ? 'focus' : data.role === 'focus' ? 'expanded' : data.role,
            mode,
            locked,
            lockedReason: undefined,
            lockedTargetFormulaId: undefined,
            lockedTargetLabel: undefined,
            learned: Boolean(learnedByChapter[focusChapterId]?.has(node.id)),
            chapterGraph: isChapterGraph || data.chapterGraph,
            onExpand: focusFormula,
          } satisfies FormulaNodeData,
        };
      }),
    [
      focusChapterId,
      focusFormula,
      focusFormulaId,
      isChapterGraph,
      learnedByChapter,
      loadingIds,
      mode,
    ],
  );

  return {
    makeFormulaNode,
    makeStaticFormulaNode,
    refreshNodeData,
  };
}
