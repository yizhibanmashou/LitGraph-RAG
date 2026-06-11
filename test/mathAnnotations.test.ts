import assert from 'node:assert/strict';
import { test } from 'node:test';
import { __testing } from '../src/components/common/mathAnnotations.ts';
import { latexToMathTokens, latexToReadableCandidates } from '../src/utils/mathSymbolMatching.ts';

class FakeMathElement {
  textContent: string;
  className: string;
  children: FakeMathElement[] = [];
  parentElement: FakeMathElement | null = null;
  previousElementSibling: FakeMathElement | null = null;
  nextElementSibling: FakeMathElement | null = null;
  classList: { contains: (name: string) => boolean };

  constructor(textContent: string, className = '') {
    this.textContent = textContent;
    this.className = className;
    this.classList = {
      contains: (name: string) => this.className.split(/\s+/).includes(name),
    };
  }

  querySelector() {
    return null;
  }

  closest() {
    return null;
  }
}

function appendChildren(parent: FakeMathElement, children: FakeMathElement[]) {
  parent.children = children;
  children.forEach((child, index) => {
    child.parentElement = parent;
    child.previousElementSibling = children[index - 1] || null;
    child.nextElementSibling = children[index + 1] || null;
  });
}

function compoundAnnotation(symbol: string) {
  return {
    symbol,
    note: 'compound note',
    kind: 'compound' as const,
    candidates: latexToReadableCandidates(symbol),
    tokens: latexToMathTokens(symbol),
    fractionProfile: null,
    requiresOverline: false,
  };
}

function formulaRowWithTarget(target: FakeMathElement) {
  const row = new FakeMathElement('Ht=H0(1-1/2N)t', 'base');
  const equals = new FakeMathElement('=', 'mrel');
  const h0 = new FakeMathElement('H0', 'mord');
  const factor = new FakeMathElement('(1-1/2N)t', 'minner');
  const root = new FakeMathElement(row.textContent, 'katex-html');

  appendChildren(row, [target, equals, h0, factor]);
  appendChildren(root, [row]);

  return { target, factor };
}

function scriptedSymbol(text: string) {
  const element = new FakeMathElement(text, 'mord');
  appendChildren(element, [
    new FakeMathElement(text[0] || '', 'mathnormal'),
    new FakeMathElement(text.slice(1), 'msupsub'),
  ]);
  return element;
}

test('compound powered groups do not bind to nearby scripted symbols', () => {
  const annotation = compoundAnnotation('(1-\\frac{1}{2N})^t');
  const ht = formulaRowWithTarget(scriptedSymbol('Ht')).target;
  const h0 = formulaRowWithTarget(scriptedSymbol('H0')).target;
  const factor = formulaRowWithTarget(scriptedSymbol('Ht')).factor;

  assert.equal(__testing.annotationMatchesElement(ht as unknown as HTMLElement, annotation), false);
  assert.equal(__testing.annotationMatchesElement(h0 as unknown as HTMLElement, annotation), false);
  assert.equal(__testing.annotationMatchesElement(factor as unknown as HTMLElement, annotation), true);
});
