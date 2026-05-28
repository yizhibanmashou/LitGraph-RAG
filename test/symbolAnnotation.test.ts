import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  compressTextToShortLabel,
  isFocusAnnotationLabel,
  isGenericAnnotationLabel,
  resolveSymbolShortLabel,
} from '../src/utils/symbolAnnotation.ts';

test('resolveSymbolShortLabel prefers explicit shortLabel', () => {
  const label = resolveSymbolShortLabel(
    { type: 'variable_definition', symbol: 'N_e', confidence: 0.9 },
    { shortLabel: '有效种群大小', llmText: '有效种群大小决定中性多态性的尺度。' },
  );
  assert.equal(label, '有效种群大小');
});

test('resolveSymbolShortLabel compresses llmText when shortLabel is missing', () => {
  const label = resolveSymbolShortLabel(
    { type: 'variable_definition', symbol: '\\sigma_w^2', confidence: 0.9 },
    { llmText: '家系间适合度方差会放大抽样方差，从而降低有效种群大小。' },
  );
  assert.match(label, /^家系间适合度方差会放大抽样/);
  assert.ok(label.length <= 16);
});

test('resolveSymbolShortLabel falls back to prerequisite meaning', () => {
  const label = resolveSymbolShortLabel({
    type: 'variable_definition',
    symbol: 'D',
    meaning: '群体间分化量',
    confidence: 0.8,
  });
  assert.equal(label, '群体间分化量');
});

test('isFocusAnnotationLabel rejects generic placeholder copy', () => {
  assert.equal(isFocusAnnotationLabel('有效种群大小'), true);
  assert.equal(isFocusAnnotationLabel('是这个公式直接使用的符号'), false);
  assert.equal(isFocusAnnotationLabel('当前公式中的关键符号'), false);
});

test('compressTextToShortLabel keeps short phrases intact', () => {
  assert.equal(compressTextToShortLabel('实际繁殖个体数'), '实际繁殖个体数');
});

test('isGenericAnnotationLabel detects template-like labels', () => {
  assert.equal(isGenericAnnotationLabel('关键符号'), true);
  assert.equal(isGenericAnnotationLabel('选择梯度'), false);
});
