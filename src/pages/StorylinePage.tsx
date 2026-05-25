import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Network } from 'lucide-react';
import type { FormulaDataState } from '../hooks/useFormulaData';
import type { ChapterDependencies, ChapterFormula, StorylineStep } from '../types/formula';
import { MathFormula } from '../components/common/MathFormula';
import { RichMathText } from '../components/common/RichMathText';
import { generateStorylineNarrative, type StorylineNarrativeResponse } from '../services/llmClient';
import { formulaChapter, rawFormulaNumber } from '../utils/constants';
import { buildFormulaLearningCopy } from '../utils/formulaInfo';
import { loadJSON } from '../utils/loadJSON';
import { DEFAULT_LANGUAGE, formatChapterLabel, getUiCopy } from '../utils/uiCopy';
import './StorylinePage.css';

interface StorylinePageProps {
  data: FormulaDataState;
}

interface FormulaRelations {
  chapter: ChapterDependencies | null;
  formula: ChapterFormula | null;
}

interface NarrativeState {
  key: string;
  status: 'idle' | 'loading' | 'ready' | 'error';
  value: StorylineNarrativeResponse | null;
}

const EMPTY_RELATIONS: FormulaRelations = {
  chapter: null,
  formula: null,
};

export function StorylinePage({ data }: StorylinePageProps) {
  const copy = getUiCopy(DEFAULT_LANGUAGE).storyline;
  const { storylineId = '' } = useParams();
  const navigate = useNavigate();
  const storyline = useMemo(() => data.storylines.find((item) => item.id === storylineId), [data.storylines, storylineId]);
  const searchLookup = useMemo(() => new Map(data.searchIndex.map((item) => [item.id, item])), [data.searchIndex]);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [relations, setRelations] = useState<FormulaRelations>(EMPTY_RELATIONS);
  const [narrativeState, setNarrativeState] = useState<NarrativeState>({ key: '', status: 'idle', value: null });

  useEffect(() => {
    setSelectedId(storyline?.steps[0]?.formula_id || '');
  }, [storyline]);

  useEffect(() => {
    if (!selectedId) {
      setRelations(EMPTY_RELATIONS);
      return;
    }
    let cancelled = false;
    const chapterId = searchLookup.get(selectedId)?.chapter_id || formulaChapter(selectedId);
    loadJSON<ChapterDependencies>(`/data/dependency/${chapterId}_dependencies.json`)
      .then((chapter) => {
        if (cancelled) return;
        const formula = chapter.formulas.find((item) => item.id === selectedId) || null;
        setRelations({ chapter, formula });
      })
      .catch(() => {
        if (!cancelled) setRelations(EMPTY_RELATIONS);
      });
    return () => {
      cancelled = true;
    };
  }, [searchLookup, selectedId]);

  const selectedStep = storyline?.steps.find((step) => step.formula_id === selectedId) || storyline?.steps[0];
  const selectedIndex = storyline && selectedStep ? storyline.steps.findIndex((step) => step.formula_id === selectedStep.formula_id) : -1;
  const previousStep = selectedIndex > 0 ? storyline?.steps[selectedIndex - 1] : null;
  const nextStep = storyline && selectedIndex >= 0 ? storyline.steps[selectedIndex + 1] || null : null;
  const selectedSearch = selectedStep ? searchLookup.get(selectedStep.formula_id) : undefined;
  const selectedFormula = relations.formula;
  const selectedChapterId = selectedSearch?.chapter_id || selectedFormula?.chapter_id || (selectedStep ? formulaChapter(selectedStep.formula_id) : '');
  const selectedLatex = selectedFormula?.latex || selectedSearch?.latex_preview || '';
  const selectedCopy = useMemo(
    () =>
      selectedStep
        ? buildFormulaLearningCopy({
            formulaId: selectedStep.formula_id,
            language: 'zh',
            cache: data.formulaLearningCopy,
            context: selectedSearch?.context,
            latex: selectedLatex,
            chapterTitle: selectedChapterId ? formatChapterLabel(selectedChapterId, selectedSearch?.chapter) : selectedSearch?.section,
            formulaLabel: selectedSearch?.label || selectedStep.title,
            formulaNumber: rawFormulaNumber(selectedStep.formula_id),
            section: selectedSearch?.section,
          })
        : null,
    [data.formulaLearningCopy, selectedChapterId, selectedLatex, selectedSearch?.chapter, selectedSearch?.context, selectedSearch?.label, selectedSearch?.section, selectedStep],
  );

  const fallbackNarrative = useMemo(() => {
    if (!storyline || !selectedStep) return null;
    const selectedContext = selectedSearch?.context || selectedFormula?.context_text || '';
    return {
      role: buildRoleText({
        steps: storyline.steps,
        selected: selectedStep,
        symbol: storyline.symbol,
        plainMeaning: selectedCopy?.plainMeaning,
        chapterLabel: formatChapterLabel(selectedChapterId, selectedSearch?.chapter),
        formulaLabel: selectedSearch?.label || selectedStep.title,
        context: selectedContext,
      }),
      transition: buildTransitionText({
        steps: storyline.steps,
        selected: selectedStep,
        transition: selectedStep.transition_zh || selectedStep.transition_en,
        chapterCopy: selectedCopy?.inThisChapter,
        previousTitle: previousStep?.title,
        context: selectedContext,
      }),
      next: buildNextStepText(storyline.steps, selectedStep, searchLookup),
    };
  }, [previousStep?.title, searchLookup, selectedChapterId, selectedCopy?.inThisChapter, selectedCopy?.plainMeaning, selectedFormula?.context_text, selectedSearch?.chapter, selectedSearch?.context, selectedSearch?.label, selectedStep, storyline]);
  const isCuratedNarrative = storyline?.id === 'allele-frequency';
  const narrative = isCuratedNarrative ? fallbackNarrative : narrativeState.value || fallbackNarrative;
  const narrativeBridge = narrative ? [narrative.transition, narrative.next].filter(Boolean).join('\n\n') : '';

  useEffect(() => {
    const timeline = timelineRef.current;
    if (!timeline || selectedIndex < 0) return;
    const selectedCard = timeline.querySelector<HTMLElement>('.storyline-step--selected');
    if (!selectedCard) return;
    const targetLeft = selectedCard.offsetLeft - (timeline.clientWidth - selectedCard.clientWidth) / 2;
    const maxLeft = timeline.scrollWidth - timeline.clientWidth;
    timeline.scrollTo({
      left: Math.max(0, Math.min(targetLeft, maxLeft)),
      behavior: 'smooth',
    });
  }, [selectedIndex]);

  useEffect(() => {
    if (!storyline || !selectedStep) {
      setNarrativeState({ key: '', status: 'idle', value: null });
      return;
    }
    const key = `${storyline.id}:${selectedStep.formula_id}:zh:storyline`;
    let cancelled = false;
    setNarrativeState((current) => ({
      key,
      status: 'loading',
      value: current.key === key ? current.value : null,
    }));
    generateStorylineNarrative({
      storyline,
      selectedStep,
      previousStep,
      nextStep,
      formula: {
        id: selectedStep.formula_id,
        latex: selectedLatex,
        context: selectedSearch?.context || selectedFormula?.context_text || '',
        section: selectedSearch?.section || selectedFormula?.section,
        label: selectedSearch?.label || selectedStep.title,
      },
      formulaCopy: selectedCopy,
      language: 'zh',
    })
      .then((value) => {
        if (!cancelled) setNarrativeState({ key, status: 'ready', value });
      })
      .catch(() => {
        if (!cancelled) setNarrativeState({ key, status: 'error', value: null });
      });
    return () => {
      cancelled = true;
    };
  }, [nextStep, previousStep, selectedCopy, selectedFormula?.context_text, selectedFormula?.section, selectedLatex, selectedSearch?.context, selectedSearch?.label, selectedSearch?.section, selectedStep, storyline]);

  const openGraph = (formulaId = selectedStep?.formula_id) => {
    if (!formulaId || !storyline) return;
    const chapterId = searchLookup.get(formulaId)?.chapter_id || formulaChapter(formulaId);
    navigate(`/graph/${formulaId}?from=storyline&storyline=${storyline.id}&chapterId=${chapterId}`);
  };

  const cleanSymbol = storyline?.symbol.replace(/\\/g, '') || '';
  const identityTitle = storyline?.id === 'allele-frequency' ? '等位基因频率' : storyline?.title_zh || storyline?.title_en || '';
  const identitySubtitle = storyline?.id === 'allele-frequency' ? '从计数到进化变化' : '';

  if (!storyline && data.loading) {
    return (
      <section className="storyline-page storyline-page--empty">
        <div className="storyline-empty">
          <p>{copy.loading}</p>
          <h1>{copy.preparing}</h1>
          <span className="storyline-empty__note">{copy.loadingNote}</span>
        </div>
      </section>
    );
  }

  if (!storyline) {
    return (
      <section className="storyline-page storyline-page--empty">
        <div className="storyline-empty">
          <p>{copy.missing}</p>
          <h1>{copy.missingTitle}</h1>
          <Link to="/">{copy.backHome}</Link>
        </div>
      </section>
    );
  }

  return (
    <section className="storyline-page">
      <aside className="storyline-rail">
        <Link to="/" className="storyline-back">
          <ArrowLeft size={16} />
          {copy.backHome}
        </Link>

        <div className="storyline-identity">
          <div className="storyline-identity__meta">
            <div className="storyline-identity__symbol-card">
              <span>故事线主题</span>
              <MathFormula latex={storyline.symbol} inline className="storyline-identity__symbol" />
            </div>
            <p>{cleanSymbol} 的 {storyline.steps.length} 步旅程</p>
          </div>
          <h1>
            <span>{identityTitle}</span>
            {identitySubtitle ? <strong>{identitySubtitle}</strong> : null}
          </h1>
          <span>{storyline.intro_zh || storyline.intro_en}</span>
        </div>

        {selectedStep ? (
          <div className="storyline-selection">
            <p className="storyline-selection__eyebrow">{copy.selectedFormula}</p>
            <h2>{selectedSearch?.label || selectedStep.title}</h2>
            <div className="storyline-selection__math">
              <MathFormula latex={selectedLatex} />
            </div>
            <div className="storyline-selection__copy">
              <span>通俗解释</span>
              <p><RichMathText text={selectedCopy?.plainMeaning} /></p>
            </div>
            <div className="storyline-selection__copy">
              <span>本章作用</span>
              <p><RichMathText text={selectedCopy?.inThisChapter} /></p>
            </div>
            <div className="storyline-symbols">
              {(selectedFormula?.symbols_defined?.length ? selectedFormula.symbols_defined : selectedFormula?.symbols_used || []).slice(0, 6).map((symbol) => (
                <MathFormula key={symbol} latex={symbol} inline />
              ))}
            </div>
            <button type="button" className="storyline-open-graph" onClick={() => openGraph()}>
              <Network size={16} />
              {copy.openGraph}
            </button>
          </div>
        ) : null}
      </aside>

      <main className="storyline-main">
        <div className="storyline-main__header">
          <div>
            <p>{copy.routeEyebrow}</p>
            <h2>{copy.routeTitle}</h2>
          </div>
          <button type="button" className="storyline-collapse" onClick={() => openGraph()}>
            <Network size={16} />
            {copy.openCurrentGraph}
          </button>
        </div>

        <div ref={timelineRef} className="storyline-timeline" role="list" aria-label={`${storyline.title_zh || storyline.title_en} 叙事步骤`}>
          {storyline.steps.map((step, index) => {
            const formula = searchLookup.get(step.formula_id);
            const isSelected = step.formula_id === selectedStep?.formula_id;
            return (
              <article
                key={step.formula_id}
                role="listitem"
                className={`storyline-step ${isSelected ? 'storyline-step--selected' : ''} animate-[fadeSlideUp_0.6s_ease_both]`}
                style={{ animationDelay: `${0.1 + index * 0.08}s` } as any}
                onClick={() => setSelectedId(step.formula_id)}
                onDoubleClick={() => openGraph(step.formula_id)}
              >
                <div className="storyline-step__index">{String(index + 1).padStart(2, '0')}</div>
                <div className="storyline-step__body">
                  <div className="storyline-step__meta">
                    <strong>{rawFormulaNumber(step.formula_id)}</strong>
                  </div>
                  <MathFormula latex={formula?.latex_preview || ''} className="storyline-step__math" />
                  <p>{buildStepPreview(storyline.id, step, formula?.label)}</p>
                </div>
                <ArrowRight className="storyline-step__arrow" size={16} />
              </article>
            );
          })}
        </div>

        {selectedStep && narrative ? (
          <section className="storyline-narrative" aria-label="当前公式故事">
            <div className="storyline-narrative__card storyline-narrative__card--primary animate-[fadeSlideUp_0.8s_ease_0.2s_both]">
              <span>{copy.role}</span>
              {!isCuratedNarrative && narrativeState.status === 'loading' ? <small className="block mb-2 text-cyan-500/60 text-[10px] font-bold tracking-widest">{copy.generating}</small> : null}
              {!isCuratedNarrative && narrativeState.status === 'error' ? <small className="block mb-2 text-cyan-500/60 text-[10px] uppercase font-bold tracking-widest">{copy.localNarrative}</small> : null}
              <p><RichMathText text={narrative.role} /></p>
            </div>
            <div className="storyline-narrative__card storyline-narrative__card--bridge animate-[fadeSlideUp_0.8s_ease_0.35s_both]">
              <span>{copy.storyBridge || '故事串联'}</span>
              <p><RichMathText text={narrativeBridge} /></p>
            </div>
          </section>
        ) : null}
      </main>
    </section>
  );
}

function buildRoleText(input: {
  steps: StorylineStep[];
  selected: StorylineStep;
  symbol: string;
  plainMeaning?: string;
  chapterLabel?: string;
  formulaLabel?: string;
  context?: string;
}): string {
  const { steps, selected, symbol, plainMeaning = '', chapterLabel = '当前章节', formulaLabel = selected.title, context = '' } = input;
  const index = steps.findIndex((step) => step.formula_id === selected.formula_id);
  const symbolText = symbol.replace(/\\/g, '');
  const contextHint = summarizeStoryContext(context);
  if (selected.formula_id === 'formula_2.1' && symbolText === 'p') {
    return '这一站先把主角 p 推到舞台中央：它不再只是“群体里 B 占多少”的静态摘要，而是 Wright-Fisher 抽样真正使用的概率旋钮。当群体里有 i 个 B 拷贝时，p=i/2N 决定下一代会抽到多少个 B，于是 p 成了随机漂变故事的发动机。';
  }
  if (selected.formula_id === 'formula_2.2a' && symbolText === 'p') {
    return 'Formula 2.2a 把 p 的单步命运装进一台机器里：每一个可能的拷贝数都是一个状态，P_{ij} 是状态之间的通道，向量 x(t) 记录群体此刻落在各个状态的概率。p 在这里不再只回答“现在是多少”，而是开始推动整群体的概率分布向下一代移动。';
  }
  if (selected.formula_id === 'formula_2.3' && symbolText === 'p') {
    return '走到 Formula 2.3，p 的故事开始拉长时间尺度：前面每一代的小小抽样偏差会不断累积，最终把等位基因推向固定或丢失。这里关心的不只是下一步会去哪，而是这条漂变路线迟早会把群体带到怎样的结局。';
  }
  if (index <= 0) {
    return `${formulaLabel} 是这条路线的起点，它先把 ${symbolText} 放进 ${chapterLabel} 的具体模型里。${plainMeaning || contextHint || '先把本式里的符号和概率/响应对象读清楚，再看后面的模型如何改写它。'}`;
  }
  if (index === steps.length - 1) {
    return `${formulaLabel} 是这条路线的阶段性收束点：${symbolText} 已经积累了前面步骤的语境，可以支撑后续论证。${plainMeaning || contextHint}`.trim();
  }
  return `${formulaLabel} 是一个桥接步骤。它把 ${symbolText} 放回 ${chapterLabel} 的具体问题中，帮助你比较同一个量在不同模型里到底回答什么。${plainMeaning || contextHint}`.trim();
}

function buildTransitionText(input: {
  steps: StorylineStep[];
  selected: StorylineStep;
  transition: string;
  chapterCopy?: string;
  previousTitle?: string;
  context?: string;
}): string {
  const { steps, selected, transition, chapterCopy = '', previousTitle, context = '' } = input;
  const index = steps.findIndex((step) => step.formula_id === selected.formula_id);
  const templateLikeTransition = !transition || /符号的外形延续下来|new job|visual identity/i.test(transition);
  const contextHint = summarizeStoryContext(context);
  if (selected.formula_id === 'formula_2.1') {
    return '故事从一个很朴素的问题开始：如果这一代有 i 个 B 拷贝，下一代会变成 j 个的机会有多大？p=i/2N 给出抽样成功概率，P_{ij} 把这个机会写成二项分布；从这一刻起，p 已经从“计数结果”变成“下一代怎么发生”的规则。';
  }
  if (selected.formula_id === 'formula_2.2a') {
    return '上一站只告诉我们一次抽样如何从 i 走到 j，但漂变真正有意思的地方在于它会一代接一代发生。Formula 2.2a 把所有 i 到 j 的可能通道排成矩阵 P，再让分布向量 x(t) 乘上这张通道图；于是 p 的随机游走不再是零散事件，而变成可以连续播放的群体轨迹。';
  }
  if (selected.formula_id === 'formula_2.3') {
    return '当矩阵更新可以反复进行，新的悬念就出现了：如果一直播放下去，p 会在中间徘徊，还是被边界吸走？Formula 2.3 接住这个问题，把注意力从“下一代概率”推向“长期结局”：固定、丢失，以及到达这些结局需要多久。';
  }
  if (index <= 0) {
    return `${templateLikeTransition ? '这一步先建立可追踪的数学对象。' : transition} ${contextHint || '后续步骤会沿着这个对象继续追问它如何随模型假设改变。'}`;
  }
  const bridge = previousTitle ? `它接在 ${previousTitle} 之后，重点不只是复用符号，而是改变符号回答的问题。` : '到这里，本章语境很重要：公式不是被简单复用，而是在新的问题里被重新解释。';
  return `${templateLikeTransition ? bridge : transition} ${chapterCopy || contextHint}`.trim();
}

function buildNextStepText(steps: StorylineStep[], selected: StorylineStep, searchLookup: Map<string, { label?: string }>): string {
  const index = steps.findIndex((step) => step.formula_id === selected.formula_id);
  const next = steps[index + 1];
  if (!next) return '这条路线到这里暂时收束。想检查局部数学关系，可以打开图谱查看它周围的公式邻域。';
  const nextLabel = searchLookup.get(next.formula_id)?.label || `Formula ${rawFormulaNumber(next.formula_id)}`;
  if (selected.formula_id === 'formula_2.1' && next.formula_id === 'formula_2.2a') {
    return `下一步自然进入 ${nextLabel}：它把单步转移概率 P_{ij} 组织成转移矩阵，让我们不只看“一代会怎样”，而是能迭代预测多代后的频率分布。`;
  }
  if (selected.formula_id === 'formula_2.2a' && next.formula_id === 'formula_2.3') {
    return `下一步进入 ${nextLabel}：既然 p 的分布已经能一代代更新，读者自然会追问这条轨迹最终会停在哪里，以及群体需要多久才抵达固定或丢失。`;
  }
  if (selected.formula_id === 'formula_2.3') {
    return `到这里，p 已经完成了从当下频率到长期命运的第一段旅程。后面的公式会把这条主线带进新的力量场，继续追问选择、推断或群体结构如何改变 p 的走向。`;
  }
  return `下一步读 ${nextLabel}。它会接住当前公式留下的问题，继续检查同一条概念线在新的模型条件下如何改变。`;
}

function buildStepPreview(storylineId: string, step: StorylineStep, fallbackLabel?: string): string {
  if (storylineId === 'allele-frequency') {
    if (step.formula_id === 'formula_2.1') {
      return 'p 第一次从“比例”变成抽样按钮，决定下一代会抽到多少个 B。';
    }
    if (step.formula_id === 'formula_2.2a') {
      return '把 p 的所有单步可能排成矩阵，让漂变像影片一样逐代推进。';
    }
    if (step.formula_id === 'formula_2.3') {
      return '追问 p 的旅程终点：它会走向固定、丢失，还是在中途徘徊很久。';
    }
  }
  const transition = step.transition_zh || step.transition_en || '';
  if (!transition || /符号的外形延续下来|new job|visual identity/i.test(transition)) {
    const label = fallbackLabel || `Formula ${rawFormulaNumber(step.formula_id)}`;
    return `${label} 接住上一站留下的问题，把同一个符号放进新的模型语境里。`;
  }
  return transition;
}

function summarizeStoryContext(context = ''): string {
  const cleaned = context
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/\$([^$]+)\$/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  const sentence = cleaned
    .split(/(?<=[.!?。！？])\s+/)
    .find((item) => item.length > 24) || cleaned;
  return `附近教材语境提示：${sentence.slice(0, 150).replace(/\s+\S*$/, '')}${sentence.length > 150 ? '...' : ''}`;
}
