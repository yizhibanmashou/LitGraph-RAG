import { useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, ChevronLeft } from 'lucide-react';
import type { FormulaDataState } from '../features/learning/useFormulaData';
import { SearchBar } from '../features/search/SearchBar';
import { StarField } from '../features/starfield/StarField';
import { buildConceptStarNodes, buildFormulaStarNodes, type StarNode } from '../features/starfield/starNavigation';
import { getChapterById } from '../features/learning/learningNavigator';
import { buildReadableFormulaCopy } from '../features/graph/formulaInfo';
import { MathFormula } from '../shared/components/MathFormula';
import { DEFAULT_LANGUAGE, formatChapterDescription, formatChapterLabel, formatChapterTitle, formatConceptTitle, formatFormulaReferenceLabel, getUiCopy } from '../shared/utils/uiCopy';

function formulaEntryDescription(node: StarNode): string {
  const copy = buildReadableFormulaCopy({
    formulaId: node.id,
    language: DEFAULT_LANGUAGE,
    context: node.context,
    latex: node.latex,
    formulaLabel: node.fullLabel || node.title,
    formulaNumber: node.label,
    section: node.section,
  });
  return copy.takeaway || copy.plainMeaning || node.context || node.subtitle;
}

function conceptEntryDescription(node: StarNode): string {
  const text = (node.context || node.subtitle || '').replace(/\s+/g, ' ').trim();
  if (!text) return '从这个概念进入本章术语地图，再回到相关公式理解它的用法。';
  return text.endsWith('。') || text.endsWith('.') ? text : `${text}。`;
}

interface ChapterPageProps {
  data: FormulaDataState;
}

export function ChapterPage({ data }: ChapterPageProps) {
  const { chapterId = '' } = useParams();
  const navigate = useNavigate();
  const copy = getUiCopy(DEFAULT_LANGUAGE);
  const chapter = useMemo(() => getChapterById(data.chapterNavigator, chapterId), [chapterId, data.chapterNavigator]);
  const formulaNodes = useMemo(
    () => (chapter ? buildFormulaStarNodes({ chapter, searchIndex: data.searchIndex, featured: data.featured }) : []),
    [chapter, data.featured, data.searchIndex],
  );
  const conceptNodes = useMemo(
    () => (chapter ? buildConceptStarNodes({ chapter, conceptIndex: data.conceptIndex }) : []),
    [chapter, data.conceptIndex],
  );
  const starNodes = useMemo(() => [...formulaNodes, ...conceptNodes], [conceptNodes, formulaNodes]);
  const startingFormulaNodes = useMemo(() => formulaNodes.filter((node) => node.isBackbone), [formulaNodes]);
  const startingConceptNodes = conceptNodes;
  const entryCount = startingConceptNodes.length + startingFormulaNodes.length;
  const chapterTitle = chapter
    ? formatChapterTitle({
        chapterId: chapter.chapter_id,
        chapter: chapter.chapter,
        titleEn: chapter.title_en,
        titleZh: chapter.title_zh,
      })
    : copy.chapter.fallbackTitle;
  const chapterDescription = chapter
    ? formatChapterDescription({
        chapterId: chapter.chapter_id,
        chapter: chapter.chapter,
        descriptionEn: chapter.description_en,
        descriptionZh: chapter.description_zh,
        formulaCount: chapter.full_formula_ids.length,
        sectionHint: chapter.section_hint,
      })
    : copy.chapter.fallbackDescription;

  const enterNode = (node: StarNode) => {
    if (node.kind === 'formula') {
      const entry = node.isBackbone ? '&entry=chapter' : '';
      navigate(`/graph/${node.id}?mode=guided&study=chapter&chapterId=${chapterId}&layer=backbone${entry}`);
    }
    if (node.kind === 'concept' && node.formulaId && node.conceptId) {
      navigate(`/graph/${node.formulaId}?chapterId=${node.chapterId || chapterId}&conceptId=${node.conceptId}&selected=${node.formulaId}`);
    }
  };
  const entryPanel = chapter ? (
    <>
      <div className="chapter-entry-panel__header">
        <p>{copy.chapter.entryPoints}</p>
        <span>{entryCount} {copy.chapter.roots}</span>
      </div>
      <div className="chapter-entry-panel__list">
        {startingConceptNodes.length ? (
          <div className="chapter-entry-panel__section-label">
            <span>概念起点</span>
            <small>{startingConceptNodes.length}</small>
          </div>
        ) : null}
        {startingConceptNodes.map((node, index) => (
          <button key={node.id} type="button" onClick={() => enterNode(node)} className="chapter-entry-panel__item chapter-entry-panel__item--concept">
            <span className="chapter-entry-panel__number">{String(index + 1).padStart(2, '0')}</span>
            <div className="chapter-entry-panel__content chapter-entry-panel__content--concept">
              <div className="chapter-entry-panel__concept-head">
                <strong>{formatConceptTitle(node.title, node.symbol)}</strong>
                {node.formulaLabel ? <span className="chapter-entry-panel__source-chip">{formatFormulaReferenceLabel(node.formulaLabel)}</span> : null}
              </div>
              <em>{conceptEntryDescription(node)}</em>
              <div className="chapter-entry-panel__concept-meta">
                {node.symbol ? (
                  <div className="chapter-entry-panel__symbol-chip">
                    <MathFormula latex={node.symbol} inline />
                  </div>
                ) : null}
                <span>概念图谱</span>
              </div>
            </div>
            <ArrowRight size={16} className="chapter-entry-panel__arrow chapter-entry-panel__arrow--concept" />
          </button>
        ))}
        {startingFormulaNodes.length ? (
          <div className="chapter-entry-panel__section-label">
            <span>公式起点</span>
            <small>{startingFormulaNodes.length}</small>
          </div>
        ) : null}
        {startingFormulaNodes.map((node, index) => (
          <button key={node.id} type="button" onClick={() => enterNode(node)} className="chapter-entry-panel__item">
            <span className="chapter-entry-panel__number">{String(index + 1).padStart(2, '0')}</span>
            <span className="chapter-entry-panel__content">
              <strong>{node.label}</strong>
              <span>{formatFormulaReferenceLabel(node.title)}</span>
              <em>{formulaEntryDescription(node)}</em>
            </span>
            <ArrowRight size={16} className="text-cyan-500/40" />
          </button>
        ))}
      </div>
    </>
  ) : null;

  return (
    <section className="chapter-shell relative min-h-screen w-full overflow-y-auto overflow-x-hidden bg-[#02040a] text-white font-['Space_Grotesk'] lg:h-screen lg:overflow-hidden">
      <StarField nodes={starNodes} visible={Boolean(chapter)} onEnterNode={enterNode} rightReserveClassName="chapter-starfield-reserve" />

      {/* HUD Elements */}
      <div className="pointer-events-none absolute inset-0 z-20 border-[24px] border-white/[0.01]" />
      <div className="pointer-events-none absolute left-10 top-10 z-20 h-4 w-4 border-l-2 border-t-2 border-cyan-500/30" />
      <div className="pointer-events-none absolute right-10 top-10 z-20 h-4 w-4 border-r-2 border-t-2 border-cyan-500/30" />
      <div className="pointer-events-none absolute bottom-10 left-10 z-20 h-4 w-4 border-b-2 border-l-2 border-cyan-500/30" />
      <div className="pointer-events-none absolute bottom-10 right-10 z-20 h-4 w-4 border-b-2 border-r-2 border-cyan-500/30" />

      <div className="pointer-events-none absolute inset-0 z-10 bg-[linear-gradient(90deg,rgba(2,4,10,0.78)_0%,transparent_42%,rgba(2,4,10,0.18)_100%),linear-gradient(180deg,rgba(2,4,10,0.2)_0%,transparent_40%,rgba(2,4,10,0.8)_100%)]" />

      <div className="chapter-topbar absolute left-10 top-10 z-40 flex items-center gap-6 animate-[fadeSlideUp_0.8s_ease_both]">
        <Link to="/" className="chapter-back-button" aria-label={copy.chapter.backToHome}>
          <ChevronLeft size={22} />
        </Link>
        <div className="chapter-topbar__search w-[320px]">
          <SearchBar searchIndex={data.searchIndex} conceptIndex={data.conceptIndex} chapterNavigator={data.chapterNavigator} size="compact" />
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-12 left-10 z-20 max-w-2xl pr-6 md:left-14 md:bottom-14">
        <div className="flex items-center gap-3 mb-4 animate-[fadeSlideUp_0.7s_ease_0.1s_both]">
          <span className="h-[1px] w-8 bg-cyan-500/50" />
          <p className="text-xs font-bold uppercase tracking-[0.25em] text-cyan-400/80">
            {chapter ? formatChapterLabel(chapter.chapter_id, chapter.chapter) : copy.chapter.fallbackTitle}
          </p>
        </div>
        <h1 className="text-balance text-5xl font-bold leading-[1.1] tracking-tight text-white md:text-7xl animate-[fadeSlideUp_0.7s_ease_0.25s_both]">
          {chapterTitle}
        </h1>
        <p className="mt-7 max-w-lg text-lg leading-relaxed text-slate-400 animate-[fadeSlideUp_0.7s_ease_0.45s_both]">
          {chapterDescription}
        </p>
        {chapter ? (
          <div className="mt-10 flex flex-wrap gap-4 text-xs font-bold tracking-widest uppercase text-slate-500 animate-[fadeSlideUp_0.7s_ease_0.65s_both]">
            <div className="flex items-center gap-2 px-4 py-2 rounded-full border border-white/5 bg-white/[0.03] backdrop-blur-md">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.6)]" />
              <span>{formulaNodes.length} {copy.chapter.nodesDiscovered}</span>
            </div>
            {conceptNodes.length ? (
              <div className="flex items-center gap-2 px-4 py-2 rounded-full border border-teal-400/10 bg-teal-400/[0.035] text-teal-300/90 backdrop-blur-md">
                <span className="h-1.5 w-1.5 rounded-full bg-teal-300 shadow-[0_0_8px_rgba(45,212,191,0.6)]" />
                <span>{conceptNodes.length} 个概念起点</span>
              </div>
            ) : null}
            <div className="flex items-center gap-2 px-4 py-2 rounded-full border border-cyan-500/10 bg-cyan-500/[0.03] text-cyan-400/90 backdrop-blur-md">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.6)]" />
              <span>{startingFormulaNodes.length} {copy.chapter.backboneRoots}</span>
            </div>
          </div>
        ) : null}
      </div>

      {chapter ? (
        <aside className="chapter-entry-panel absolute right-10 top-10 z-30 hidden w-[380px] lg:block animate-[fadeSlideUp_0.8s_ease_both]">
          {entryPanel}
        </aside>
      ) : null}

      {chapter ? (
        <aside className="chapter-entry-panel chapter-entry-panel--mobile relative z-30 mx-4 mb-6 mt-[760px] lg:hidden">
          {entryPanel}
        </aside>
      ) : null}
    </section>
  );
}
