import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildFormulaBrief,
  buildFormulaLearningCopy,
  buildFormulaSymbolPrerequisites,
  conciseVariablePrerequisite,
  compactContext,
  describeFormulaSymbol,
  explainPrerequisite,
  extractKeySymbols,
  standaloneGraphCopy,
} from '../src/utils/formulaInfo.ts';
import type { ChapterFormula, FormulaDependency } from '../src/types/formula.ts';

test('compactContext normalizes whitespace and truncates at a word boundary', () => {
  const context = '  This   formula compares polymorphism and divergence across loci for neutrality testing.  ';

  assert.equal(compactContext(context, 48), 'This formula compares polymorphism and…');
  assert.equal(compactContext('', 48), '这条公式暂时没有可用的教材上下文。');
});

test('extractKeySymbols combines defined, used, and prerequisite symbols without duplicates', () => {
  const formula: ChapterFormula = {
    id: 'formula_10.1a',
    latex: 'D/P',
    label: 'Formula 10.1a',
    section: 'Neutrality tests',
    subsection: 'HKA',
    position: 1,
    context_text: 'Context text',
    symbols_used: ['D', 'P', 'D'],
    symbols_defined: ['H'],
  };

  const symbols = extractKeySymbols(formula, [
    { type: 'formula', target_id: 'formula_8.1', via_symbol: 'P', confidence: 0.9 },
    { type: 'variable_definition', symbol: 'N_e', definition: 'effective population size', confidence: 0.8 },
  ]);

  assert.deepEqual(symbols, ['H', 'D', 'P', 'N_e']);
});

test('buildFormulaBrief prefers rich searchable metadata and summarizes prerequisites', () => {
  const dependency: FormulaDependency = {
    dependent_id: 'formula_10.1a',
    prerequisites: [
      { type: 'formula', target_id: 'formula_8.1', via_symbol: 'P', confidence: 0.9 },
      { type: 'variable_definition', symbol: 'D', definition: 'divergence', confidence: 0.8 },
    ],
  };

  const brief = buildFormulaBrief({
    id: 'formula_10.1a',
    search: {
      id: 'formula_10.1a',
      number: '10.1a',
      chapter: 10,
      section: 'Neutrality tests',
      label: 'HKA test statistic',
      latex_preview: 'H = D/P',
      context: 'The HKA test compares polymorphism and divergence to evaluate neutral expectations.',
      keywords: ['HKA', 'neutrality'],
    },
    dependency,
  });

  assert.equal(brief.number, '10.1a');
  assert.equal(brief.title, 'HKA test statistic');
  assert.equal(brief.chapter, 10);
  assert.equal(brief.latex, 'H = D/P');
  assert.equal(brief.prerequisiteCount, 2);
  assert.equal(brief.formulaPrerequisiteCount, 1);
  assert.equal(brief.variablePrerequisiteCount, 1);
  assert.match(brief.shortContext, /HKA test compares/);
});

test('explainPrerequisite produces learner-readable dependency copy', () => {
  assert.equal(
    explainPrerequisite({ type: 'formula', target_id: 'formula_8.1', via_symbol: 'P', cross_chapter: true, confidence: 0.9 }),
    '这条前置公式支撑了当前公式，连接符号是 P，它来自其他章节。',
  );
  assert.equal(
    explainPrerequisite({ type: 'variable_definition', symbol: 'D', definition: 'divergence between lineages', confidence: 0.8 }),
    'D 在这里很关键，因为当前公式依赖它的含义：divergence between lineages',
  );
});

test('buildFormulaLearningCopy prefers cached English copy', () => {
  const copy = buildFormulaLearningCopy({
    formulaId: 'formula_10.1a',
    language: 'en',
    cache: {
      'formula_10.1a': {
        en: {
          plainMeaning: 'Cached English meaning.',
          inThisChapter: 'Cached English chapter role.',
        },
      },
    },
    context: 'Raw context should not be used.',
    chapterTitle: 'Tests of Neutrality',
    formulaLabel: 'Formula 10.1a',
    formulaNumber: '10.1a',
  });

  assert.equal(copy.plainMeaning, 'Cached English meaning.');
  assert.equal(copy.inThisChapter, 'Cached English chapter role.');
});

test('buildFormulaLearningCopy prefers cached Chinese copy', () => {
  const copy = buildFormulaLearningCopy({
    formulaId: 'formula_2.1',
    language: 'zh',
    cache: {
      'formula_2.1': {
        zh: {
          plainMeaning: '缓存中文通俗解释。',
          inThisChapter: '缓存中文本章作用。',
        },
      },
    },
    context: 'qual to j follows the binomial distribution.',
    chapterTitle: 'Neutral Evolution',
    formulaLabel: 'Formula 2.1',
    formulaNumber: '2.1',
  });

  assert.equal(copy.plainMeaning, '缓存中文通俗解释。');
  assert.equal(copy.inThisChapter, '缓存中文本章作用。');
});

test('buildFormulaLearningCopy defaults to Chinese readable fallback instead of chopped raw context', () => {
  const copy = buildFormulaLearningCopy({
    context: 'qual to j follows the binomial distribution.',
    chapterTitle: '中性进化',
    formulaLabel: 'Formula 2.1',
    formulaNumber: '2.1',
    section: 'Wright-Fisher 转移概率',
  });

  assert.doesNotMatch(copy.plainMeaning, /^qual to j/);
  assert.match(copy.plainMeaning, /Formula 2\.1/);
  assert.match(copy.inThisChapter, /中性进化/);
  assert.match(copy.inThisChapter, /学习检查点/);
});

test('buildFormulaLearningCopy keeps English fallback when requested', () => {
  const copy = buildFormulaLearningCopy({
    language: 'en',
    context: 'qual to j follows the binomial distribution.',
    chapterTitle: 'Neutral Evolution',
    formulaLabel: 'Formula 2.1',
    formulaNumber: '2.1',
    section: 'Wright-Fisher transition probabilities',
  });

  assert.match(copy.plainMeaning, /mathematical relationship/);
  assert.match(copy.inThisChapter, /Neutral Evolution/);
});

test('buildFormulaLearningCopy uses Chinese fallback when cached copy is missing', () => {
  const copy = buildFormulaLearningCopy({
    language: 'zh',
    context: '',
    chapterTitle: 'Population Genetics',
    formulaLabel: 'Formula 4.1',
    formulaNumber: '4.1',
  });

  assert.match(copy.plainMeaning, /Formula 4\.1/);
  assert.match(copy.inThisChapter, /Population Genetics/);
  assert.doesNotMatch(copy.plainMeaning, /Chinese explanation is not generated/);
});

test('buildFormulaLearningCopy gives formula-specific fallback for breeder equation form', () => {
  const copy = buildFormulaLearningCopy({
    language: 'zh',
    latex: 'R=\\sigma_{A}^{2}\\beta',
    context: 'Substituting S = sigma_z^2 beta into Equation 13.1 yields R=sigma_A^2 beta.',
    chapterTitle: '第 13 章',
    formulaLabel: 'Formula 13.8c',
    formulaNumber: '13.8c',
    section: "SINGLE-GENERATION RESPONSE: THE BREEDER'S EQUATION",
  });

  assert.match(copy.plainMeaning, /加性遗传方差/);
  assert.match(copy.plainMeaning, /选择梯度/);
  assert.doesNotMatch(copy.plainMeaning, /数学关系/);
});

test('buildFormulaSymbolPrerequisites creates local symbol notes when dependency graph has none', () => {
  const notes = buildFormulaSymbolPrerequisites({
    id: 'formula_2.1',
    latex: 'P_{ij}=\\binom{2N}{j}(i/2N)^{j}[1-(i/2N)]^{2N-j}',
    label: 'Formula 2.1',
    chapter_id: 'chapter2',
    section: 'Wright-Fisher',
    subsection: 'The Wright-Fisher model',
    position: 0,
    context_text: 'Assuming the Wright-Fisher model, each of the 2N sampled gametes has probability i/(2N) of being B.',
    symbols_defined: ['P_{ij}'],
    symbols_used: ['N', 'i', 'j'],
  });

  assert.deepEqual(notes.map((item) => item.symbol), ['P_{ij}', 'N', 'i', 'j']);
  assert.match(notes[0].meaning || '', /转移到下一代 j 个 B 拷贝/);
});

test('buildFormulaSymbolPrerequisites preserves formula 7.1 starter symbols', () => {
  const notes = buildFormulaSymbolPrerequisites({
    id: 'formula_7.1',
    latex: 'p^{\\prime}=p\\frac{W_{\\mathrm{a}}}{\\overline{W}}',
    label: 'Formula 7.1',
    chapter_id: 'chapter7',
    section: 'Selection and mutation',
    subsection: 'Single loci',
    position: 1,
    context_text: 'where W_a is the marginal fitness of a, and \\overline{W} is the mean fitness.',
    symbols_defined: ['p^{\\prime}'],
    symbols_used: ['W', '\\mathrm{a}', '\\overline{W}', 'a', 'p', 'p^{\\prime}'],
  });

  assert.deepEqual(notes.map((item) => item.symbol), ['p', 'p^{\\prime}', 'W_{\\mathrm{a}}', '\\overline{W}']);
  assert.match(notes[2].meaning || '', /W_a/);
});

test('describeFormulaSymbol explains selection-gradient symbols locally', () => {
  assert.match(describeFormulaSymbol('\\beta', { latex: 'R=\\sigma_{A}^{2}\\beta', context_text: '' }), /选择梯度/);
});

test('conciseVariablePrerequisite keeps hover notes short', () => {
  assert.equal(
    conciseVariablePrerequisite({
      type: 'variable_definition',
      symbol: 'N_e',
      meaning: '有效群体大小，决定中性模型下多态性水平的尺度。',
      confidence: 0.9,
    }),
    '有效种群大小',
  );
});

test('standaloneGraphCopy describes zero-prerequisite formulas without bare counts', () => {
  assert.equal(standaloneGraphCopy(), '这个公式目前在本地图谱中没有已确认的前置或后续关系。');
});
