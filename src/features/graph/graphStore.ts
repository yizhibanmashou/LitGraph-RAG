import { create } from 'zustand';

export interface ConceptGraphViewportSnapshot {
  x: number;
  y: number;
  zoom: number;
}

export interface ConceptViewSnapshot {
  chapterId: string;
  formulaId: string;
  conceptId: string;
  revealedGroups: {
    prerequisites?: boolean;
    introduced?: boolean;
  };
  expandedReferenceKeys: string[];
  evidenceOpen: boolean;
  viewport?: ConceptGraphViewportSnapshot;
}

interface GraphState {
  expandedNodeIds: Set<string>;
  highlightedIds: Set<string>;
  learnedByChapter: Record<string, Set<string>>;
  conceptSnapshots: Record<string, ConceptViewSnapshot>;
  markExpanded: (id: string) => void;
  setHighlightedIds: (ids: Set<string>) => void;
  markLearned: (chapterId: string, formulaId: string) => void;
  saveConceptSnapshot: (key: string, snapshot: ConceptViewSnapshot) => void;
  getConceptSnapshot: (key: string) => ConceptViewSnapshot | undefined;
  resetGraph: () => void;
}

export const useGraphStore = create<GraphState>((set, get) => ({
  expandedNodeIds: new Set(),
  highlightedIds: new Set(),
  learnedByChapter: {},
  conceptSnapshots: {},
  markExpanded: (id) =>
    set((state) => {
      const expandedNodeIds = new Set(state.expandedNodeIds);
      expandedNodeIds.add(id);
      return { expandedNodeIds };
    }),
  setHighlightedIds: (highlightedIds) => set({ highlightedIds }),
  markLearned: (chapterId, formulaId) =>
    set((state) => {
      const learnedByChapter = { ...state.learnedByChapter };
      const learned = new Set(learnedByChapter[chapterId] || []);
      learned.add(formulaId);
      learnedByChapter[chapterId] = learned;
      return { learnedByChapter };
    }),
  saveConceptSnapshot: (key, snapshot) =>
    set((state) => ({
      conceptSnapshots: {
        ...state.conceptSnapshots,
        [key]: snapshot,
      },
    })),
  getConceptSnapshot: (key) => get().conceptSnapshots[key],
  resetGraph: () => set({ expandedNodeIds: new Set(), highlightedIds: new Set(), learnedByChapter: {}, conceptSnapshots: {} }),
}));
