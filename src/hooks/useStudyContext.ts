import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ChapterLayer, ChapterNavigatorPayload, StudyContext, ThemeRoute } from '../types/learning';
import { getChapterById, getChapterByNumber } from '../utils/learningNavigator';

interface UseStudyContextInput {
  chapterNavigator: ChapterNavigatorPayload;
  themeRoutes: ThemeRoute[];
}

export function useStudyContext({ chapterNavigator, themeRoutes }: UseStudyContextInput): StudyContext {
  const [params] = useSearchParams();

  return useMemo(() => {
    const study = params.get('study');
    if (study === 'chapter') {
      const chapterNumber = Number(params.get('chapter'));
      const chapterId = params.get('chapterId');
      const chapter = chapterId ? getChapterById(chapterNavigator, chapterId) : getChapterByNumber(chapterNavigator, chapterNumber);
      const layer = params.get('layer') === 'full' ? 'full' : 'backbone';
      if (chapter) return { type: 'chapter', chapter, layer: layer as ChapterLayer };
    }
    if (study === 'theme') {
      const routeId = params.get('route');
      const route = themeRoutes.find((item) => item.id === routeId);
      if (route) return { type: 'theme', route };
    }
    return { type: 'free' };
  }, [chapterNavigator, params, themeRoutes]);
}
