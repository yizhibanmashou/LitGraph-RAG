import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_LANGUAGE, formatChapterLabel, getUiCopy, joinMeta } from '../src/utils/uiCopy.ts';

test('ui copy defaults to Chinese learner-facing labels', () => {
  const copy = getUiCopy(DEFAULT_LANGUAGE);

  assert.equal(copy.app.searchPlaceholder, '搜索公式、章节或主题');
  assert.equal(copy.graph.modes.guided.label, 'Guided');
  assert.equal(copy.graph.node.start, '起点');
  assert.equal(copy.storyline.localNarrative, '正在使用本地叙事');
});

test('formatChapterLabel localizes chapter and appendix ids', () => {
  assert.equal(formatChapterLabel('chapter2'), '第 2 章');
  assert.equal(formatChapterLabel('appendix3'), '附录 3');
  assert.equal(formatChapterLabel('chapter2', 2, 'en'), 'Chapter 2');
});

test('joinMeta removes empty values and uses dot separators', () => {
  assert.equal(joinMeta(['2.1', '', undefined, '第 2 章']), '2.1 · 第 2 章');
});
