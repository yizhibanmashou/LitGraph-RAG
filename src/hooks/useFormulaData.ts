import { useEffect, useState } from 'react';
import type { FeaturedFormula, FormulaLearningCopyPayload, SearchFormula, StorylineEntry, StorylinePayload } from '../types/formula';
import type { ChapterNavigatorPayload, ThemeRoutesPayload } from '../types/learning';
import { loadJSON } from '../utils/loadJSON';

export interface FormulaDataState {
  featured: FeaturedFormula[];
  searchIndex: SearchFormula[];
  formulaLearningCopy: FormulaLearningCopyPayload['items'];
  storylines: StorylineEntry[];
  chapterNavigator: ChapterNavigatorPayload;
  themeRoutes: ThemeRoutesPayload['paths'];
  loading: boolean;
  error: string | null;
}

export function useFormulaData(): FormulaDataState {
  const [state, setState] = useState<FormulaDataState>({
    featured: [],
    searchIndex: [],
    formulaLearningCopy: {},
    storylines: [],
    chapterNavigator: { groups: [] },
    themeRoutes: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      loadJSON<{ featured: FeaturedFormula[] }>('/data/featured_formulas.json', controller.signal),
      loadJSON<SearchFormula[]>('/data/formula_search_index.json', controller.signal),
      loadJSON<FormulaLearningCopyPayload>('/data/formula_learning_copy.json', controller.signal),
      loadJSON<ChapterNavigatorPayload>('/data/chapter_navigator.json', controller.signal),
      loadJSON<ThemeRoutesPayload>('/data/learning_paths.json', controller.signal),
      loadJSON<StorylinePayload>('/data/storylines.json', controller.signal),
    ])
      .then(([featuredPayload, searchIndex, learningCopyPayload, chapterNavigator, themeRoutesPayload, storylinePayload]) => {
        setState({
          featured: featuredPayload.featured,
          searchIndex,
          formulaLearningCopy: learningCopyPayload.items,
          storylines: storylinePayload.items,
          chapterNavigator,
          themeRoutes: themeRoutesPayload.paths,
          loading: false,
          error: null,
        });
      })
      .catch((error: Error) => {
        if (controller.signal.aborted) return;
        setState((current) => ({ ...current, loading: false, error: error.message }));
      });
    return () => controller.abort();
  }, []);

  return state;
}
