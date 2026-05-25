import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type XYPosition,
} from '@xyflow/react';
import { ArrowLeft, MousePointerClick, RefreshCcw } from 'lucide-react';
import type { ChapterFormula, FormulaDependency, FormulaPrerequisite, SearchFormula, StorylineEntry } from '../../types/formula';
import type { DependencyEdgeData, FormulaExpansionIntent, FormulaNodeData, VariableNodeData } from '../../types/graph';
import type { StudyContext } from '../../types/learning';
import { useDependencyGraph } from '../../hooks/useDependencyGraph';
import { useGraphStore } from '../../stores/graphStore';
import { generateVariableDetails } from '../../services/llmClient';
import { chapterColor, chapterRank, rawFormulaNumber } from '../../utils/constants';
import { buildFormulaSymbolPrerequisites, explainPrerequisite, standaloneGraphCopy } from '../../utils/formulaInfo';
import { DEFAULT_LANGUAGE, formatChapterLabel, getUiCopy } from '../../utils/uiCopy';
import { DependencyEdge } from './DependencyEdge';
import { FormulaNode } from './FormulaNode';
import { chapterGraphBounds, layoutChapterGraph, layoutSuccessors, layoutPrerequisites } from './graphLayout';
import type { GraphStudyMode } from './GraphModeControls';
import { VariableDefNode } from './VariableDefNode';
import './GraphView.css';

interface GraphCanvasProps {
  searchIndex: SearchFormula[];
  mode?: GraphStudyMode;
  studyContext: StudyContext;
  storylines: StorylineEntry[];
  toolbar?: ReactNode;
}

const nodeTypes = {
  formula: FormulaNode,
  variableDefinition: VariableDefNode,
};

const edgeTypes = {
  dependency: DependencyEdge,
};

const NON_TEACHING_SYMBOLS = new Set(['\\pi', '\\infty']);
const MAX_VISIBLE_SUCCESSORS = 5;
const MAX_STARTER_VARIABLES = 4;
type GuidedExpansionStage = 'none' | 'concepts' | 'successors';

function isTeachingVariableSymbol(symbol?: string): boolean {
  return Boolean(symbol) && !NON_TEACHING_SYMBOLS.has(String(symbol));
}

function shouldRenderVariablePrerequisite(prereq: FormulaPrerequisite): boolean {
  return prereq.type === 'variable_definition' && (prereq.edge_status ?? 'accepted') === 'accepted' && isTeachingVariableSymbol(prereq.symbol);
}

function shouldRenderFormulaPrerequisite(prereq: FormulaPrerequisite): boolean {
  return prereq.type === 'formula' && (prereq.edge_status ?? 'accepted') === 'accepted';
}

function hasSameChapterFormulaPrerequisite(dependency: FormulaDependency | null): boolean {
  return Boolean(
    dependency?.prerequisites.some(
      (prereq) => shouldRenderFormulaPrerequisite(prereq) && !prereq.cross_chapter,
    ),
  );
}

function isChapterStarterFormula(formula: ChapterFormula, dependency: FormulaDependency | null): boolean {
  return Number(formula.depth ?? 0) <= 0 && !hasSameChapterFormulaPrerequisite(dependency);
}

function chapterIdForFormula(formulaId: string, searchLookup: Map<string, SearchFormula>): string {
  return searchLookup.get(formulaId)?.chapter_id || '';
}

function GraphCanvasInner({ searchIndex, mode = 'guided', storylines, toolbar }: GraphCanvasProps) {
  const copy = getUiCopy(DEFAULT_LANGUAGE).graph;
  const { focusFormulaId = '', chapterId: routeChapterId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { loadChapter, resolveFormulaChapter, error } = useDependencyGraph();
  const reactFlow = useReactFlow();
  const markExpanded = useGraphStore((state: ReturnType<typeof useGraphStore.getState>) => state.markExpanded);
  const markLearned = useGraphStore((state: ReturnType<typeof useGraphStore.getState>) => state.markLearned);
  const learnedByChapter = useGraphStore((state: ReturnType<typeof useGraphStore.getState>) => state.learnedByChapter);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const [showHint, setShowHint] = useState(true);
  const [standaloneFocusId, setStandaloneFocusId] = useState<string | null>(null);
  const [selectedFormulaId, setSelectedFormulaId] = useState<string | null>(null);
  const [graphNotice, setGraphNotice] = useState<string | null>(null);
  const [guidedStages, setGuidedStages] = useState<Record<string, GuidedExpansionStage>>({});
  const nodesRef = useRef<Node[]>([]);
  const expandFormulaRef = useRef<(formulaId: string, intent?: FormulaExpansionIntent) => void>(() => undefined);
  const autoExpandedFocusRef = useRef<string | null>(null);
  const searchLookup = useMemo(() => new Map(searchIndex.map((item) => [item.id, item])), [searchIndex]);
  const isChapterGraph = Boolean(routeChapterId);
  const focusChapterId = routeChapterId || params.get('chapterId') || chapterIdForFormula(focusFormulaId, searchLookup) || resolveFormulaChapter(focusFormulaId);
  const guidedUnlock = params.get('entry') === 'chapter' && params.get('study') === 'chapter';
  const storylineId = params.get('storyline');
  const storylineTitle = useMemo(() => {
    const storyline = storylines.find((item) => item.id === storylineId);
    return storyline?.title_zh || storyline?.title_en || storylineId;
  }, [storylineId, storylines]);
  const chapterGraphModeClass = isChapterGraph ? `graph-canvas--chapter graph-canvas--chapter-${mode}` : '';

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  const setNodeLoading = useCallback((id: string, loading: boolean) => {
    setLoadingIds((current) => {
      const next = new Set(current);
      if (loading) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const canUseFormula = useCallback(
    (formulaId: string) => {
      if (!guidedUnlock) return true;
      if (formulaId === focusFormulaId) return true;
      if (Boolean(learnedByChapter[focusChapterId]?.has(formulaId))) return true;

      const hasLearnedPrereq = edges.some(
        (edge) => edge.target === formulaId && Boolean(learnedByChapter[focusChapterId]?.has(edge.source))
      );
      return hasLearnedPrereq;
    },
    [focusChapterId, focusFormulaId, guidedUnlock, learnedByChapter, edges],
  );

  const focusFormula = useCallback(
    (formulaId: string, intent: FormulaExpansionIntent = 'auto') => {
      if (!canUseFormula(formulaId)) return;
      setSelectedFormulaId(formulaId);
      window.dispatchEvent(new CustomEvent('litgraph:formula-details', { detail: { formulaId } }));
      expandFormulaRef.current(formulaId, intent);
    },
    [canUseFormula],
  );

  const makeStaticFormulaNode = useCallback(
    (formula: ChapterFormula, position: XYPosition, focused = false, role: FormulaNodeData['role'] = 'successor', symbolExplanations: FormulaPrerequisite[] = [], chapterGraph = false): Node => ({
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
    [mode],
  );

  const makeFormulaNode = useCallback(
    (formula: ChapterFormula, position: XYPosition, focused = false, role: FormulaNodeData['role'] = 'successor'): Node => {
      const locked = isChapterGraph ? false : !canUseFormula(formula.id);
      const learned = Boolean(learnedByChapter[focusChapterId]?.has(formula.id));
      const focusSymbolExplanations = mode === 'focus' ? buildFormulaSymbolPrerequisites(formula) : [];
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
          learned,
          symbolExplanations: focusSymbolExplanations,
          onExpand: focusFormula,
        } satisfies FormulaNodeData,
      };
    },
    [canUseFormula, focusChapterId, focusFormula, isChapterGraph, learnedByChapter, mode],
  );

  const refreshNodeData = useCallback(
    (items: Node[]) =>
      items.map((node) => {
        if (node.type !== 'formula') return node;
        const data = node.data as unknown as FormulaNodeData;
        return {
          ...node,
          data: {
            ...data,
            focused: !isChapterGraph && node.id === focusFormulaId,
            loading: loadingIds.has(node.id),
            role: !isChapterGraph && node.id === focusFormulaId ? 'focus' : data.role === 'focus' ? 'expanded' : data.role,
            mode,
            locked: isChapterGraph ? false : !canUseFormula(node.id),
            learned: Boolean(learnedByChapter[focusChapterId]?.has(node.id)),
            chapterGraph: isChapterGraph || data.chapterGraph,
            onExpand: focusFormula,
          } satisfies FormulaNodeData,
        };
      }),
    [canUseFormula, focusChapterId, focusFormula, focusFormulaId, isChapterGraph, learnedByChapter, loadingIds, mode],
  );

  const buildVariableNodes = useCallback(
    (formulaId: string, parent: Node, variables: FormulaPrerequisite[], baseNodes: Node[]) => {
      const positions = layoutPrerequisites(parent, variables, baseNodes);
      return variables.map((prereq, index) => ({
        id: `${formulaId}::var::${prereq.symbol}`,
        type: 'variableDefinition',
        position: positions[index],
        data: {
          prerequisite: prereq,
        } satisfies VariableNodeData,
        draggable: false,
        selectable: false,
      })) satisfies Node[];
    },
    [],
  );

  const buildVariableEdges = useCallback(
    (formulaId: string, variables: FormulaPrerequisite[]) =>
      variables.map((prereq) => ({
        id: `${formulaId}::var::${prereq.symbol}->${formulaId}`,
        source: `${formulaId}::var::${prereq.symbol}`,
        target: formulaId,
        type: 'dependency',
        data: {
          via: prereq.symbol || 'concept',
          crossChapter: false,
          confidence: prereq.confidence,
          explanation: explainPrerequisite(prereq),
        } satisfies DependencyEdgeData,
      })) satisfies Edge[],
    [],
  );

  const expandFormula = useCallback(
    async (formulaId: string, intent: FormulaExpansionIntent = 'auto') => {
      if (!canUseFormula(formulaId)) return;
      const initialParent = nodesRef.current.find((node) => node.id === formulaId);
      if (!initialParent) return;

      setNodeLoading(formulaId, true);
      try {
        const chapter = await loadChapter(focusChapterId);
        const dependency = chapter?.dependencies.find((dep) => dep.dependent_id === formulaId) || null;
        const currentFormula = chapter?.formulas.find((item) => item.id === formulaId);
        const variablePrerequisites = (dependency?.prerequisites || []).filter(shouldRenderVariablePrerequisite);
        const symbolPrerequisites = variablePrerequisites.length ? variablePrerequisites : buildFormulaSymbolPrerequisites(currentFormula);
        if (mode === 'focus') {
          setSelectedFormulaId(formulaId);
          const loadingSymbolNotes = symbolPrerequisites.map((item) => ({ ...item, llmStatus: 'loading' as const }));
          setNodes((currentNodes) =>
            refreshNodeData(currentNodes).map((node) => {
              if (node.id !== formulaId || node.type !== 'formula') return node;
              const data = node.data as unknown as FormulaNodeData;
              return {
                ...node,
                data: {
                  ...data,
                  symbolExplanations: loadingSymbolNotes,
                } satisfies FormulaNodeData,
              };
            }),
          );
          Promise.all(
            symbolPrerequisites.map((prereq) =>
              generateVariableDetails({
                formulaId,
                latex: currentFormula?.latex || '',
                context: currentFormula?.context_text || '',
                symbol: prereq.symbol || prereq.via_symbol || 'symbol',
                prerequisite: prereq,
                language: 'zh',
              })
                .then((value) => ({ ...prereq, llmText: value.text, llmStatus: 'ready' as const }))
                .catch(() => ({ ...prereq, llmStatus: 'error' as const })),
            ),
          ).then((symbolNotes) => {
            setNodes((currentNodes) =>
              currentNodes.map((node) => {
                if (node.id !== formulaId || node.type !== 'formula') return node;
                const data = node.data as unknown as FormulaNodeData;
                return {
                  ...node,
                  data: {
                    ...data,
                    symbolExplanations: symbolNotes,
                  } satisfies FormulaNodeData,
                };
              }),
            );
          });
          markExpanded(formulaId);
          setShowHint(false);
          window.setTimeout(() => {
            const parent = nodesRef.current.find((node) => node.id === formulaId) || initialParent;
            reactFlow.setCenter(parent.position.x + 310, parent.position.y + 220, { zoom: 0.86, duration: 420 });
          }, 20);
          return;
        }

        const dependents = (chapter?.dependencies || []).filter((dep) =>
          dep.prerequisites.some((prereq) => shouldRenderFormulaPrerequisite(prereq) && prereq.target_id === formulaId && !prereq.cross_chapter),
        );
        if (formulaId === focusFormulaId) setStandaloneFocusId(dependents.length === 0 ? formulaId : null);

        const currentStage = guidedStages[formulaId] || 'none';
        const shouldShowConcepts = intent === 'prerequisites' || (intent === 'auto' && (mode !== 'guided' || currentStage === 'none'));
        const shouldShowSuccessors = intent === 'successors' || (intent === 'auto' && (mode !== 'guided' || currentStage !== 'none'));
        const shownDependents = shouldShowSuccessors ? dependents.slice(0, MAX_VISIBLE_SUCCESSORS) : [];
        const successorFormulas = new Map<string, ChapterFormula>();
        shownDependents.forEach((dep) => {
          const formula = chapter?.formulas.find((item) => item.id === dep.dependent_id);
          if (formula) successorFormulas.set(dep.dependent_id, formula);
        });

        setNodes((currentNodes) => {
          const parent = currentNodes.find((node) => node.id === formulaId);
          if (!parent) return currentNodes;
          const nextNodes = [...currentNodes];

          if (shouldShowConcepts) {
            const allPrereqs = (dependency?.prerequisites || []).filter((item) =>
              shouldRenderVariablePrerequisite(item) || shouldRenderFormulaPrerequisite(item)
            );
            const positions = layoutPrerequisites(parent, allPrereqs, nextNodes);
            allPrereqs.forEach((prereq, index) => {
              if (prereq.type === 'variable_definition') {
                const conceptId = `${formulaId}::var::${prereq.symbol}`;
                if (!nextNodes.some((item) => item.id === conceptId)) {
                  nextNodes.push({
                    id: conceptId,
                    type: 'variableDefinition',
                    position: positions[index],
                    data: { prerequisite: prereq, formulaId, formulaLatex: currentFormula?.latex || '' } satisfies VariableNodeData,
                    draggable: false,
                    selectable: false,
                  });
                }
              } else if (prereq.type === 'formula' && prereq.target_id) {
                const prereqFormula = chapter?.formulas.find((item) => item.id === prereq.target_id);
                if (prereqFormula && !nextNodes.some((item) => item.id === prereqFormula.id)) {
                  nextNodes.push(makeFormulaNode(prereqFormula, positions[index], false, 'prerequisite'));
                }
              }
            });
          }

          const positions = layoutSuccessors(parent, successorFormulas.size, nextNodes);
          [...successorFormulas.values()].forEach((formula, index) => {
            if (nextNodes.some((node) => node.id === formula.id)) return;
            nextNodes.push(makeFormulaNode(formula, positions[index], false, 'successor'));
          });
          return refreshNodeData(nextNodes);
        });

        setEdges((currentEdges) => {
          const nextEdges = [...currentEdges];
          if (shouldShowConcepts) {
            (dependency?.prerequisites || []).forEach((prereq) => {
              if (shouldRenderVariablePrerequisite(prereq)) {
                const sourceId = `${formulaId}::var::${prereq.symbol}`;
                const edgeId = `${sourceId}->${formulaId}`;
                if (nextEdges.some((edge) => edge.id === edgeId)) return;
                nextEdges.push({
                  id: edgeId,
                  source: sourceId,
                  target: formulaId,
                  type: 'dependency',
                  data: {
                    via: prereq.symbol || 'concept',
                    crossChapter: false,
                    confidence: prereq.confidence,
                    explanation: explainPrerequisite(prereq),
                  } satisfies DependencyEdgeData,
                });
              } else if (shouldRenderFormulaPrerequisite(prereq) && prereq.target_id) {
                const edgeId = `${prereq.target_id}->${formulaId}`;
                if (nextEdges.some((edge) => edge.id === edgeId)) return;
                nextEdges.push({
                  id: edgeId,
                  source: prereq.target_id,
                  target: formulaId,
                  type: 'dependency',
                  markerEnd: { type: MarkerType.ArrowClosed, color: '#e2e8f0' },
                  data: {
                    via: prereq.via_symbol || 'uses',
                    crossChapter: Boolean(prereq.cross_chapter),
                    confidence: prereq.confidence || 0.8,
                    explanation: explainPrerequisite(prereq),
                  } satisfies DependencyEdgeData,
                });
              }
            });
          }
          shownDependents.forEach((dep) => {
            const prereq = dep.prerequisites.find((item) => shouldRenderFormulaPrerequisite(item) && item.target_id === formulaId);
            const edgeId = `${formulaId}->${dep.dependent_id}`;
            if (nextEdges.some((edge) => edge.id === edgeId)) return;
            nextEdges.push({
              id: edgeId,
              source: formulaId,
              target: dep.dependent_id,
              type: 'dependency',
              markerEnd: { type: MarkerType.ArrowClosed, color: '#e2e8f0' },
              data: {
                via: prereq?.via_symbol || 'next',
                crossChapter: false,
                confidence: prereq?.confidence || 0.8,
                explanation: prereq ? explainPrerequisite(prereq) : '这条公式接在当前公式之后，用来继续推进同一段推导。',
              } satisfies DependencyEdgeData,
            });
          });
          return nextEdges;
        });

        if (guidedUnlock) markLearned(focusChapterId, formulaId);
        if (mode === 'guided') {
          setGuidedStages((current) => ({
            ...current,
            [formulaId]: shouldShowSuccessors ? 'successors' : 'concepts',
          }));
        }
        markExpanded(formulaId);
        setShowHint(false);
        window.setTimeout(() => reactFlow.fitView({ padding: 0.28, duration: 650, maxZoom: 1.08 }), 50);
      } finally {
        setNodeLoading(formulaId, false);
      }
    },
    [
      buildVariableEdges,
      buildVariableNodes,
      canUseFormula,
      focusChapterId,
      focusFormulaId,
      guidedUnlock,
      guidedStages,
      loadChapter,
      makeFormulaNode,
      markExpanded,
      markLearned,
      mode,
      reactFlow,
      refreshNodeData,
      setNodeLoading,
    ],
  );

  useEffect(() => {
    expandFormulaRef.current = expandFormula;
  }, [expandFormula]);

  useEffect(() => {
    let cancelled = false;
    setNodes([]);
    setEdges([]);
    setGraphNotice(null);
    setGuidedStages({});
    setLoadingIds(new Set());
    setStandaloneFocusId(null);
    setSelectedFormulaId(focusFormulaId || null);
    autoExpandedFocusRef.current = null;
    if (isChapterGraph) {
      loadChapter(focusChapterId).then((chapter) => {
        if (cancelled || !chapter) return;
        if (!chapter.formulas.length) {
          setGraphNotice(`${copy.emptyChapter} ${formatChapterLabel(focusChapterId)}`);
          return;
        }
        const positions = layoutChapterGraph(chapter.formulas, chapter.dependencies);
        const formulaNodes = chapter.formulas.map((formula) => makeStaticFormulaNode(formula, positions.get(formula.id) || { x: 120, y: 96 }, false, 'expanded', [], true));
        const formulaIds = new Set(chapter.formulas.map((formula) => formula.id));
        const graphEdges: Edge[] = [];
        chapter.dependencies.forEach((dependency) => {
          dependency.prerequisites.forEach((prereq) => {
            if (!shouldRenderFormulaPrerequisite(prereq) || !prereq.target_id || !formulaIds.has(prereq.target_id) || !formulaIds.has(dependency.dependent_id)) return;
            const edgeId = `${prereq.target_id}->${dependency.dependent_id}`;
            if (graphEdges.some((edge) => edge.id === edgeId)) return;
            graphEdges.push({
              id: edgeId,
              source: prereq.target_id,
              target: dependency.dependent_id,
              type: 'dependency',
                markerEnd: { type: MarkerType.ArrowClosed, color: '#e2e8f0' },
              data: {
                via: prereq.via_symbol || 'uses',
                crossChapter: false,
                confidence: prereq.confidence || 0.8,
                explanation: explainPrerequisite(prereq),
              } satisfies DependencyEdgeData,
            });
          });
        });
        setNodes(formulaNodes);
        setEdges(graphEdges);
        setSelectedFormulaId(chapter.formulas[0]?.id || null);
        setShowHint(false);
        const firstNode = formulaNodes[0];
        window.setTimeout(() => {
          if (firstNode) {
            reactFlow.setCenter(firstNode.position.x + 134, firstNode.position.y + 78, { zoom: 0.66, duration: 650 });
          } else {
            const bounds = chapterGraphBounds(chapter.formulas.length);
            reactFlow.fitView({ padding: 0.18, duration: 650, minZoom: bounds.minZoom, maxZoom: 0.82 });
          }
        }, 80);
      });
      return () => {
        cancelled = true;
      };
    }
    if (!focusFormulaId) return;

    loadChapter(focusChapterId).then((chapter) => {
      if (!chapter) {
        if (!cancelled) setGraphNotice(`${copy.dataError} ${formatChapterLabel(focusChapterId)}`);
        return;
      }
      const formula = chapter?.formulas.find((item) => item.id === focusFormulaId);
      if (cancelled) return;
      if (!formula) {
        setGraphNotice(`${copy.missingFormula} ${rawFormulaNumber(focusFormulaId)} · ${formatChapterLabel(focusChapterId)}`);
        return;
      }
      const dependency = chapter.dependencies.find((dep) => dep.dependent_id === focusFormulaId) || null;
      const variablePrerequisites = (dependency?.prerequisites || []).filter(shouldRenderVariablePrerequisite);
      const symbolExplanations = mode === 'focus' ? (variablePrerequisites.length ? variablePrerequisites : buildFormulaSymbolPrerequisites(formula)) : [];
      const formulaNode = makeStaticFormulaNode(formula, { x: 260, y: 280 }, true, 'focus', symbolExplanations);
      if (mode !== 'focus' && isChapterStarterFormula(formula, dependency)) {
        const starterVariables = (variablePrerequisites.length ? variablePrerequisites : buildFormulaSymbolPrerequisites(formula)).slice(0, MAX_STARTER_VARIABLES);
        setNodes([formulaNode, ...buildVariableNodes(focusFormulaId, formulaNode, starterVariables, [formulaNode])]);
        setEdges(buildVariableEdges(focusFormulaId, starterVariables));
      } else {
        setNodes([formulaNode]);
        setEdges([]);
      }
      window.setTimeout(() => {
        if (mode === 'focus') {
          reactFlow.setCenter(570, 500, { zoom: 0.86, duration: 500 });
        } else {
          reactFlow.fitView({ padding: 0.35, duration: 500, maxZoom: 1.08 });
        }
      }, 60);
    });

    return () => {
      cancelled = true;
    };
  }, [buildVariableEdges, buildVariableNodes, focusChapterId, focusFormulaId, isChapterGraph, loadChapter, makeStaticFormulaNode, mode, reactFlow]);

  useEffect(() => {
    if (isChapterGraph) return;
    const autoExpandKey = `${mode}:${focusFormulaId}`;
    if (!focusFormulaId || autoExpandedFocusRef.current === autoExpandKey) return;
    if (mode === 'guided') return;
    if (!nodes.some((node) => node.id === focusFormulaId)) return;
    autoExpandedFocusRef.current = autoExpandKey;
    window.setTimeout(() => expandFormulaRef.current(focusFormulaId), 0);
  }, [focusFormulaId, isChapterGraph, mode, nodes]);

  useEffect(() => {
    setNodes((current) => refreshNodeData(current));
  }, [refreshNodeData]);

  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (node.type === 'formula') {
        const formulaId = node.id;
        if (!canUseFormula(formulaId)) return;
        setSelectedFormulaId(formulaId);
        window.dispatchEvent(new CustomEvent('litgraph:formula-details', { detail: { formulaId } }));
        if (isChapterGraph) {
          const next = new URLSearchParams(params);
          next.set('selected', formulaId);
          setParams(next, { replace: true });
        }
        if (isChapterGraph && mode === 'focus') {
          navigate(`/graph/${formulaId}?chapterId=${focusChapterId}&mode=focus`);
          return;
        }
        if (!isChapterGraph && (mode === 'guided' || mode === 'explore')) {
          expandFormulaRef.current(formulaId, 'auto');
        }
      }
    },
    [canUseFormula, focusChapterId, isChapterGraph, mode, navigate, params, setParams],
  );

  const onNodesChange = useCallback((changes: NodeChange[]) => setNodes((current) => applyNodeChanges(changes, current)), []);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => setEdges((current) => applyEdgeChanges(changes, current)), []);
  const visibleEdges = useMemo(
    () =>
      edges.map((edge) => {
        const related = Boolean(selectedFormulaId && (edge.source === selectedFormulaId || edge.target === selectedFormulaId));
        const data = edge.data as unknown as DependencyEdgeData | undefined;
        return {
          ...edge,
          animated: false,
          data: {
            ...(data || {}),
            via: data?.via || '',
            crossChapter: Boolean(data?.crossChapter),
            confidence: data?.confidence ?? 0,
            active: related,
            dimmed: Boolean(selectedFormulaId && !related),
            labelVisible: related,
          } satisfies DependencyEdgeData,
        };
      }),
    [edges, isChapterGraph, selectedFormulaId],
  );

  return (
    <div className="relative h-full w-full overflow-hidden bg-transparent">
      <div className="graph-toolbar absolute left-[22px] right-5 top-4 z-20 flex flex-wrap items-center gap-2">
        {storylineId ? (
          <button
            type="button"
            onClick={() => navigate(`/storyline/${storylineId}`)}
            className="graph-toolbar-button inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold"
            title={`${copy.fromStoryline}${storylineTitle}`}
          >
            <ArrowLeft size={16} />
            Storyline
          </button>
        ) : null}
        <button type="button" onClick={() => navigate('/')} className="graph-toolbar-button inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold">
          {copy.home}
        </button>
        {toolbar}
        {!isChapterGraph ? (
          <button type="button" onClick={() => expandFormula(selectedFormulaId || focusFormulaId)} className="graph-toolbar-button inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold">
            <RefreshCcw size={16} />
            {copy.expand}
          </button>
        ) : null}
        {showHint ? (
          <div className="graph-onboarding-hint animate-[fadeSlideUp_0.5s_ease_0.6s_both]">
            <MousePointerClick size={16} className="graph-onboarding-hint__icon shrink-0" />
            <span>{copy.hints[mode]}</span>
            <button type="button" onClick={() => setShowHint(false)} aria-label={copy.dismissHint}>
              x
            </button>
          </div>
        ) : null}
      </div>
      {error ? <div className="graph-error-card absolute right-6 top-16 z-20 max-w-sm rounded-md px-3 py-2 text-sm font-medium">{error}</div> : null}
      {graphNotice ? <div className="graph-empty-card graph-empty-card--top-notice absolute z-20 text-sm font-semibold">{graphNotice}</div> : null}
      {standaloneFocusId === focusFormulaId ? (
        <div className="graph-standalone-note absolute left-1/2 top-[128px] z-20 -translate-x-1/2" role="status">
          {standaloneGraphCopy()}
        </div>
      ) : null}
      <ReactFlow
        nodes={nodes}
        edges={visibleEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onConnect={(connection) => setEdges((current) => addEdge(connection, current))}
        fitView
        minZoom={isChapterGraph ? chapterGraphBounds(nodes.length).minZoom : 0.2}
        maxZoom={isChapterGraph ? 1.25 : 1.6}
        translateExtent={isChapterGraph ? [[-420, -420], [4200, 17000]] : undefined}
        nodeExtent={isChapterGraph ? [[-160, -160], [3900, 16000]] : undefined}
        proOptions={{ hideAttribution: true }}
        className={`bg-transparent ${chapterGraphModeClass}`}
      >
        <Panel position="bottom-right" className="graph-atlas-panel">
          <div className="graph-atlas-panel__header">
            <span>{copy.atlas}</span>
            <small>{isChapterGraph ? copy.fullChapter : formatChapterLabel(focusChapterId)}</small>
          </div>
          <MiniMap
            zoomable
            pannable
            className="graph-atlas-minimap"
            bgColor="#07101f"
            maskColor="rgba(2, 4, 10, 0.52)"
            nodeBorderRadius={6}
            nodeStrokeWidth={1.2}
            nodeStrokeColor={(node) => {
              if (node.id === selectedFormulaId) return '#38bdf8';
              if (node.type !== 'formula') return '#14b8a6';
              return 'rgba(148, 163, 184, 0.55)';
            }}
            nodeColor={(node) => {
              if (node.id === selectedFormulaId) return '#f59e0b';
              if (!isChapterGraph && node.id === focusFormulaId) return '#38bdf8';
              if (node.type !== 'formula') return '#14b8a6';
              const nodeData = node.data as unknown as FormulaNodeData | undefined;
              const depth = Number(nodeData?.formula?.depth || 0);
              if (depth <= 0) return '#60a5fa';
              if (depth <= 2) return '#38bdf8';
              return '#2563eb';
            }}
          />
          <div className="graph-atlas-panel__legend" aria-label="缩略图概览">
            <span><i className="graph-atlas-panel__legend-dot graph-atlas-panel__legend-dot--focus" />{copy.focus}</span>
            <span>{nodes.length} {copy.nodes}</span>
            <span>{edges.length} {copy.links}</span>
          </div>
        </Panel>
      </ReactFlow>
      {isChapterGraph ? (
        <div className="graph-pan-hint pointer-events-none absolute left-6 top-[74px] z-10 rounded-md px-3 py-2 text-xs font-semibold">
          拖拽浏览全章，滚轮缩放；切到 Focus 后点公式进入精读。
        </div>
      ) : null}
    </div>
  );
}

export function GraphCanvas(props: GraphCanvasProps) {
  return (
    <ReactFlowProvider>
      <GraphCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
