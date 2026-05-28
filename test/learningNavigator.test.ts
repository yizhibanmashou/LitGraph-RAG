import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  getChapterByNumber,
  getStudyFormulaIds,
  getText,
  getThemeRouteById,
  inferChapterTitleFromSearchIndex,
  resolveRecommendedChapterFormulaId,
} from '../src/utils/learningNavigator.ts';
import type { SearchFormula } from '../src/types/formula.ts';
import type { ChapterNavigatorPayload, ThemeRoutesPayload } from '../src/types/learning.ts';

const chapterPayload: ChapterNavigatorPayload = {
  groups: [
    {
      id: 'population-genetics',
      title_en: 'Population Genetics',
      title_zh: '群体遗传学',
      chapters: [
        {
          chapter: 2,
          chapter_id: 'chapter2',
          title_en: 'Foundations of Population Genetics',
          title_zh: '群体遗传学基础',
          description_en: 'Core allele-frequency formulas.',
          description_zh: '核心等位基因频率公式。',
          backbone_formula_ids: ['formula_2.1', 'formula_2.2a'],
          full_formula_ids: ['formula_2.1', 'formula_2.2a', 'formula_2.2b'],
          representative_formula_ids: ['formula_2.1'],
          difficulty: 'introductory',
        },
      ],
    },
  ],
};

const themePayload: ThemeRoutesPayload = {
  paths: [
    {
      id: 'selection-detection',
      title_en: 'Selection Detection Methods',
      title_zh: '选择检测方法',
      description_en: 'Use polymorphism and divergence to detect selection.',
      description_zh: '利用多态性和分化检测选择。',
      formula_ids: ['formula_9.21a', 'formula_10.1a'],
      step_notes: [
        {
          formula_id: 'formula_10.1a',
          note_en: 'Connect neutrality-test intuition to HKA.',
          note_zh: '把中性检验直觉连接到 HKA。',
        },
      ],
      tags: ['selection', 'molecular evolution'],
      difficulty: 'intermediate',
      coverage: { chapter_count: 2, formula_count: 2 },
    },
  ],
};

test('getChapterByNumber finds chapters inside grouped navigator data', () => {
  const chapter = getChapterByNumber(chapterPayload, 2);
  assert.equal(chapter?.title_en, 'Foundations of Population Genetics');
});

test('getStudyFormulaIds returns backbone or full sequence for a chapter', () => {
  const chapter = getChapterByNumber(chapterPayload, 2)!;
  assert.deepEqual(getStudyFormulaIds({ type: 'chapter', chapter, layer: 'backbone' }), ['formula_2.1', 'formula_2.2a']);
  assert.deepEqual(getStudyFormulaIds({ type: 'chapter', chapter, layer: 'full' }), ['formula_2.1', 'formula_2.2a', 'formula_2.2b']);
});

test('getThemeRouteById returns richer theme route data', () => {
  const route = getThemeRouteById(themePayload, 'selection-detection');
  assert.equal(route?.title_en, 'Selection Detection Methods');
  assert.equal(route?.step_notes[0].note_zh, '把中性检验直觉连接到 HKA。');
});

test('inferChapterTitleFromSearchIndex uses formula section instead of navigator placeholders', () => {
  const searchIndex: SearchFormula[] = [
    {
      id: 'formula_2.1',
      number: '2.1',
      chapter: 2,
      chapter_id: 'chapter2',
      section: 'Neutral Evolution in One- and Two-Locus Systems: Introduction',
      label: 'Formula 2.1',
      latex_preview: 'P_{ij}',
      context: 'This formula introduces the chapter.',
      keywords: [],
    },
  ];

  assert.equal(inferChapterTitleFromSearchIndex(2, searchIndex), 'Neutral Evolution in One- and Two-Locus Systems: Introduction');
});

test('getText returns requested language with English fallback', () => {
  assert.equal(getText({ en: 'Selection Detection Methods', zh: '选择检测方法' }, 'zh'), '选择检测方法');
  assert.equal(getText({ en: 'Selection Detection Methods' }, 'zh'), 'Selection Detection Methods');
});

test('resolveRecommendedChapterFormulaId prefers available representative formulas', () => {
  const chapter = getChapterByNumber(chapterPayload, 2)!;
  const searchIndex: SearchFormula[] = [
    {
      id: 'formula_2.1',
      number: '2.1',
      chapter: 2,
      chapter_id: 'chapter2',
      section: 'Neutral Evolution',
      label: 'Formula 2.1',
      latex_preview: 'p',
      context: '',
      keywords: [],
    },
  ];

  assert.equal(resolveRecommendedChapterFormulaId(chapter, searchIndex), 'formula_2.1');
});

test('resolveRecommendedChapterFormulaId falls back through backbone, full, then search index', () => {
  const chapter = {
    ...getChapterByNumber(chapterPayload, 2)!,
    representative_formula_ids: ['formula_2.missing'],
    backbone_formula_ids: ['formula_2.backbone'],
    full_formula_ids: ['formula_2.full'],
  };
  const searchIndex: SearchFormula[] = [
    {
      id: 'formula_2.full',
      number: '2.full',
      chapter: 2,
      chapter_id: 'chapter2',
      section: 'Fallback',
      label: 'Formula 2.full',
      latex_preview: 'x',
      context: '',
      keywords: [],
    },
  ];

  assert.equal(resolveRecommendedChapterFormulaId(chapter, searchIndex), 'formula_2.full');
  assert.equal(resolveRecommendedChapterFormulaId({ ...chapter, full_formula_ids: ['formula_2.missingFull'] }, searchIndex), 'formula_2.full');
});

test('resolveRecommendedChapterFormulaId returns null when a chapter has no available formulas', () => {
  const chapter = getChapterByNumber(chapterPayload, 2)!;
  assert.equal(resolveRecommendedChapterFormulaId(chapter, []), null);
});
