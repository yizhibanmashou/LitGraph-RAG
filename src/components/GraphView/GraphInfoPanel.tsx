import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import type { FormulaLearningCopyPayload, FormulaPrerequisite, SearchFormula, StorylineEntry } from '../../types/formula';
import type { LanguageCode, StudyContext } from '../../types/learning';
import { useDependencyGraph } from '../../hooks/useDependencyGraph';
import { generateFormulaNotes, type FormulaNoteResponse } from '../../services/llmClient';
import { rawFormulaNumber } from '../../utils/constants';
import { buildFormulaLearningCopy } from '../../utils/formulaInfo';
import { DEFAULT_LANGUAGE, formatChapterLabel, getUiCopy, joinMeta } from '../../utils/uiCopy';
import { RichMathText } from '../common/RichMathText';

interface GraphInfoPanelProps {
  searchIndex: SearchFormula[];
  formulaLearningCopy: FormulaLearningCopyPayload['items'];
  studyContext: StudyContext;
  storylines: StorylineEntry[];
}

interface LlmFormulaState {
  key: string;
  status: 'idle' | 'loading' | 'ready' | 'error';
  value: FormulaNoteResponse | null;
}

function getStudyContextText(studyContext: StudyContext, language: LanguageCode) {
  if (studyContext.type === 'chapter') {
    return {
      title: language === 'zh' ? studyContext.chapter.title_zh : studyContext.chapter.title_en,
      description: language === 'zh' ? studyContext.chapter.description_zh : studyContext.chapter.description_en,
    };
  }
  if (studyContext.type === 'theme') {
    return {
      title: language === 'zh' ? studyContext.route.title_zh : studyContext.route.title_en,
      description: language === 'zh' ? studyContext.route.description_zh : studyContext.route.description_en,
    };
  }
  return null;
}

export function GraphInfoPanel({ searchIndex, formulaLearningCopy, studyContext, storylines }: GraphInfoPanelProps) {
  const { focusFormulaId = '', chapterId: routeChapterId = '' } = useParams();
  const [params] = useSearchParams();
  const { loadChapter } = useDependencyGraph();
  const [language, setLanguage] = useState<LanguageCode>(DEFAULT_LANGUAGE);
  const [selectedFormulaId, setSelectedFormulaId] = useState(focusFormulaId);
  const [prerequisites, setPrerequisites] = useState<FormulaPrerequisite[]>([]);
  const [llmState, setLlmState] = useState<LlmFormulaState>({ key: '', status: 'idle', value: null });
  const lookup = useMemo(() => new Map(searchIndex.map((item) => [item.id, item])), [searchIndex]);

  useEffect(() => {
    setSelectedFormulaId(focusFormulaId);
  }, [focusFormulaId]);

  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ formulaId?: string }>).detail;
      if (detail?.formulaId) setSelectedFormulaId(detail.formulaId);
    };
    window.addEventListener('litgraph:formula-details', listener);
    return () => window.removeEventListener('litgraph:formula-details', listener);
  }, []);

  const formula = lookup.get(selectedFormulaId) || lookup.get(focusFormulaId);
  const formulaNumber = rawFormulaNumber(formula?.id || focusFormulaId);
  const copy = getUiCopy(language).graph.info;
  const studyContextText = getStudyContextText(studyContext, language);
  const isChapterGraph = Boolean(routeChapterId && !focusFormulaId);
  const fallbackCopy = buildFormulaLearningCopy({
    formulaId: formula?.id,
    language,
    cache: formulaLearningCopy,
    context: formula?.context,
    latex: formula?.latex_preview,
    chapterTitle:
      studyContext.type === 'chapter'
        ? language === 'zh'
          ? studyContext.chapter.title_zh
          : studyContext.chapter.title_en
        : formatChapterLabel(formula?.chapter_id, formula?.chapter, language),
    formulaLabel: formula?.label,
    formulaNumber: formula?.number || formulaNumber,
    section: formula?.section,
  });
  const learningCopy = llmState.value || fallbackCopy;
  const story = params.get('storyline');
  const storyTitle = useMemo(() => {
    const storyline = storylines.find((item) => item.id === story);
    return storyline?.title_zh || storyline?.title_en || story;
  }, [story, storylines]);

  useEffect(() => {
    if (!formula?.id || isChapterGraph) {
      setPrerequisites([]);
      return;
    }
    let cancelled = false;
    loadChapter(formula.chapter_id)
      .then((chapter) => {
        if (cancelled) return;
        const dependency = chapter?.dependencies.find((item) => item.dependent_id === formula.id);
        setPrerequisites(dependency?.prerequisites || []);
      })
      .catch(() => {
        if (!cancelled) setPrerequisites([]);
      });
    return () => {
      cancelled = true;
    };
  }, [formula?.chapter_id, formula?.id, isChapterGraph, loadChapter]);

  useEffect(() => {
    if (!formula?.id || isChapterGraph) {
      setLlmState({ key: '', status: 'idle', value: null });
      return;
    }
    const key = `${formula.id}:${language}:formula-notes`;
    let cancelled = false;
    setLlmState((current) => ({
      key,
      status: 'loading',
      value: current.key === key ? current.value : null,
    }));
    generateFormulaNotes({
      formulaId: formula.id,
      latex: formula.latex_preview,
      context: formula.context,
      section: formula.section,
      prerequisites,
      language,
    })
      .then((value) => {
        if (!cancelled) setLlmState({ key, status: 'ready', value });
      })
      .catch(() => {
        if (!cancelled) setLlmState({ key, status: 'error', value: null });
      });
    return () => {
      cancelled = true;
    };
  }, [formula?.context, formula?.id, formula?.latex_preview, formula?.section, isChapterGraph, language, prerequisites]);

  return (
    <div className="graph-info-panel">
      <div className="graph-info-panel__hero graph-info-panel__hero--learning-card">
        <p className="graph-info-panel__eyebrow">{isChapterGraph ? copy.chapterGraph : copy.eyebrow}</p>
        <h1>{isChapterGraph ? studyContextText?.title || formatChapterLabel(routeChapterId, undefined, language) : formula?.label || `Formula ${formulaNumber}`}</h1>
        <p className="graph-info-panel__meta">
          {formula ? joinMeta([formula.number, formatChapterLabel(formula.chapter_id, formula.chapter, language), formula.section]) : `Formula ${formulaNumber}`}
        </p>
        {story ? <p className="graph-info-panel__origin">来自故事线：{storyTitle}</p> : null}
        <div className="graph-info-panel__metadata-row">
          <div className="graph-info-panel__language-toggle" aria-label="公式旁注语言">
            <button type="button" className={language === 'en' ? 'active' : ''} onClick={() => setLanguage('en')}>
              {copy.languageEnglish}
            </button>
            <button type="button" className={language === 'zh' ? 'active' : ''} onClick={() => setLanguage('zh')}>
              {copy.languageChinese}
            </button>
          </div>
        </div>
      </div>

      {!isChapterGraph ? (
        <section className="graph-info-panel__section graph-info-panel__section--primary graph-info-panel__section--what-it-says">
          <h2>{copy.selected}</h2>
          <div className="graph-info-panel__copy-block">
            <div className="graph-info-panel__copy-heading">
              <span>{copy.plain}</span>
              {llmState.status === 'loading' ? <small>{copy.loading}</small> : null}
              {llmState.status === 'ready' ? <small>{copy.source}</small> : null}
              {llmState.status === 'error' ? <small>{copy.fallback}</small> : null}
            </div>
            <p><RichMathText text={learningCopy.plainMeaning} /></p>
          </div>
          <div className="graph-info-panel__copy-block">
            <div className="graph-info-panel__copy-heading">
              <span>{copy.chapter}</span>
            </div>
            <p><RichMathText text={learningCopy.inThisChapter} /></p>
          </div>
        </section>
      ) : null}

      {studyContextText ? (
        <section className="graph-info-panel__section graph-info-panel__section--study-context">
          <h2>{copy.context}</h2>
          <p>
            <strong>{studyContextText.title}</strong>
          </p>
          <p><RichMathText text={studyContextText.description} /></p>
        </section>
      ) : null}
    </div>
  );
}
