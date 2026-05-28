import { useEffect, useMemo, useRef } from 'react';
import katex, { type KatexOptions } from 'katex';
import { DEFAULT_LANGUAGE, getUiCopy } from '../../utils/uiCopy';

export interface MathAnnotation {
  symbol: string;
  note: string;
}

interface MathFormulaProps {
  latex?: string;
  className?: string;
  inline?: boolean;
  annotations?: MathAnnotation[];
  onAnnotationChange?: (annotation: MathAnnotation | null, anchorRect?: DOMRect) => void;
}

interface RenderedFormula {
  html: string;
  displayMode: boolean;
  failed: boolean;
}

const DISPLAY_ENV_RE = /\\begin\{(?:align\*?|aligned|alignedat|gather\*?|split|array|matrix|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix|cases)\}/;
const RAW_LATEX_RE = /\\(?:begin|end|quad|qquad|over|frac|dfrac|tfrac|sqrt|left|right|operatorname|mathrm|mathbb|mathbf|boldsymbol)\b/;

const KATEX_OPTIONS: KatexOptions = {
  displayMode: true,
  errorColor: '#b91c1c',
  output: 'html',
  strict: false,
  throwOnError: true,
  trust: false,
};

function stripMathDelimiters(value: string): string {
  let next = value.trim();
  const wrappers: Array<[RegExp, string]> = [
    [/^\$\$([\s\S]*)\$\$$/, '$1'],
    [/^\\\[([\s\S]*)\\\]$/, '$1'],
    [/^\\\(([\s\S]*)\\\)$/, '$1'],
  ];

  for (const [pattern, replacement] of wrappers) {
    const stripped = next.replace(pattern, replacement).trim();
    if (stripped !== next) next = stripped;
  }

  return next;
}

function normalizeLatex(input: string): string {
  return stripMathDelimiters(input)
    .replace(/\r?\n/g, ' ')
    .replace(/\\begin\{align\*?\}/g, '\\begin{aligned}')
    .replace(/\\end\{align\*?\}/g, '\\end{aligned}')
    .replace(/\\begin\{gather\*?\}/g, '\\begin{aligned}')
    .replace(/\\end\{gather\*?\}/g, '\\end{aligned}')
    .replace(/\\begin\{split\}/g, '\\begin{aligned}')
    .replace(/\\end\{split\}/g, '\\end{aligned}')
    .replace(/\\notag|\\nonumber/g, '')
    .replace(/\{\\rm\s+([^{}]+)\}/g, (_, text: string) => `\\mathrm{${text.trim()}}`)
    .replace(/\s+/g, ' ')
    .trim();
}

function withoutUnsupportedEnvironments(input: string): string {
  return input
    .replace(/\\begin\{(?:aligned|alignedat|gather\*?|split)\}/g, '')
    .replace(/\\end\{(?:aligned|alignedat|gather\*?|split)\}/g, '')
    .replace(/&/g, '')
    .trim();
}

function needsDisplayMode(latex: string, inline: boolean): boolean {
  if (inline && !DISPLAY_ENV_RE.test(latex) && !/\\\\/.test(latex)) return false;
  return DISPLAY_ENV_RE.test(latex) || /\\\\/.test(latex) || latex.length > 72;
}

function fallbackHtml(): string {
  return `<span class="math-formula__fallback">${getUiCopy(DEFAULT_LANGUAGE).app.formulaUnavailable}</span>`;
}

function compactMathText(value: string): string {
  return value.replace(/[\s\u200b]/g, '').replace(/[{}]/g, '').trim();
}

function latexToReadableCandidates(symbol: string): string[] {
  const hasGreekCommand = /\\(?:sigma|Delta|mu|pi|beta|alpha|theta|rho|phi)(?=[\s_^{]|$)/.test(symbol);
  const normalized = compactMathText(symbol)
    .replace(/\\mathrm/g, '')
    .replace(/\\overline/g, '')
    .replace(/\\bar/g, '')
    .replace(/\\hat/g, '')
    .replace(/\\tilde/g, '')
    .replace(/\\prime/g, "'")
    .replace(/\\sigma/g, 'σ')
    .replace(/\\Delta/g, 'Δ')
    .replace(/\\mu/g, 'μ')
    .replace(/\\pi/g, 'π')
    .replace(/\\beta/g, 'β')
    .replace(/\\alpha/g, 'α')
    .replace(/\\theta/g, 'θ')
    .replace(/\\rho/g, 'ρ')
    .replace(/\\phi/g, 'ϕ')
    .replace(/\\Pr/g, 'Pr')
    .replace(/\\E/g, 'E')
    .replace(/\\/g, '')
    .replace(/[_^]/g, '');

  const plain = compactMathText(symbol)
    .replace(/\\[a-zA-Z]+/g, '')
    .replace(/[_^]/g, '')
    .replace(/[{}]/g, '');

  const looseCandidates = hasGreekCommand
    ? []
    : [plain, symbol.replace(/\\/g, '')]
        .map(compactMathText)
        .filter(Boolean);

  return [...new Set([normalized, ...looseCandidates].map(compactMathText).filter(Boolean))];
}

function clearAnnotations(root: HTMLElement) {
  root.querySelectorAll('.math-symbol-hotspot').forEach((node) => {
    node.classList.remove('math-symbol-hotspot');
    node.removeAttribute('data-note');
    node.removeAttribute('data-symbol');
    node.removeAttribute('tabindex');
    node.removeAttribute('aria-label');
  });
}

function annotateRenderedMath(root: HTMLElement, annotations: MathAnnotation[]) {
  clearAnnotations(root);
  const available = annotations
    .filter((item) => item.symbol && item.note)
    .map((item) => ({
      ...item,
      candidates: latexToReadableCandidates(item.symbol).sort((a, b) => b.length - a.length),
    }))
    .sort((a, b) => b.symbol.length - a.symbol.length);

  if (!available.length) return;

  const elements = [...root.querySelectorAll<HTMLElement>('.katex-html span')].filter((element) => {
    if (element.children.length > 4) return false;
    const text = compactMathText(element.textContent || '');
    return text.length >= 1 && text.length <= 8;
  });

  const used = new Set<HTMLElement>();
  for (const annotation of available) {
    const matches = elements.filter((element) => {
      if (used.has(element) || element.closest('.math-symbol-hotspot')) return false;
      const text = compactMathText(element.textContent || '');
      return annotation.candidates.some((candidate) => text === candidate || (candidate.length === 1 && text === candidate));
    }).sort((a, b) => annotationTargetScore(b) - annotationTargetScore(a));

    const targets: HTMLElement[] = [];
    for (const match of matches) {
      if (targets.some((target) => target.contains(match) || match.contains(target))) continue;
      targets.push(match);
    }
    for (const target of targets) {
      used.add(target);
      target.classList.add('math-symbol-hotspot');
      target.setAttribute('data-note', annotation.note);
      target.setAttribute('data-symbol', annotation.symbol);
      target.setAttribute('tabindex', '0');
      target.setAttribute('aria-label', `${annotation.symbol}: ${annotation.note}`);
    }
  }
}

function annotationTargetScore(element: HTMLElement): number {
  const rect = element.getBoundingClientRect();
  const className = String(element.className || '');
  let score = 0;
  if (className.includes('mord')) score += 20;
  if (className.includes('mathnormal')) score -= 8;
  if (className.includes('vlist')) score -= 10;
  if (element.children.length > 0) score += 6;
  if (rect.width >= 8) score += 4;
  if (rect.height >= 8) score += 4;
  return score;
}

export function renderMathToHtml(latex = '', inline = false): RenderedFormula {
  const normalized = normalizeLatex(latex);
  if (!normalized) {
    return { html: fallbackHtml(), displayMode: false, failed: true };
  }

  const displayMode = needsDisplayMode(normalized, inline);
  const candidates = [normalized, withoutUnsupportedEnvironments(normalized)].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const html = katex.renderToString(candidate, {
        ...KATEX_OPTIONS,
        displayMode: needsDisplayMode(candidate, inline),
      });
      return { html, displayMode: needsDisplayMode(candidate, inline), failed: false };
    } catch {
      continue;
    }
  }

  if (RAW_LATEX_RE.test(normalized)) {
    return { html: fallbackHtml(), displayMode, failed: true };
  }

  try {
    const html = katex.renderToString(normalized, {
      ...KATEX_OPTIONS,
      displayMode,
      throwOnError: false,
    });
    return { html, displayMode, failed: false };
  } catch {
    return { html: fallbackHtml(), displayMode, failed: true };
  }
}

export function MathFormula({ latex = '', className = '', inline = false, annotations = [], onAnnotationChange }: MathFormulaProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const rendered = useMemo(() => renderMathToHtml(latex, inline), [inline, latex]);
  const annotationKey = useMemo(
    () => annotations.map((item) => `${item.symbol}:${item.note}`).join('|'),
    [annotations],
  );

  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    annotateRenderedMath(root, annotations);
  }, [annotationKey, annotations, rendered.html]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !annotations.length || !onAnnotationChange) return;

    const readAnnotation = (target: Element | null, point?: { x: number; y: number }) => {
      const coordinateTarget = point ? document.elementFromPoint(point.x, point.y) : null;
      const source = coordinateTarget || target;
      const hotspot = source instanceof Element ? source.closest<HTMLElement>('.math-symbol-hotspot') : null;
      if (!hotspot) return null;
      const symbol = hotspot.dataset.symbol || '';
      const note = hotspot.dataset.note || '';
      return symbol && note ? { annotation: { symbol, note }, anchorRect: hotspot.getBoundingClientRect() } : null;
    };

    const handleMove = (event: globalThis.MouseEvent | globalThis.PointerEvent) => {
      const active = readAnnotation(event.target instanceof Element ? event.target : null, {
        x: event.clientX,
        y: event.clientY,
      });
      onAnnotationChange(active?.annotation ?? null, active?.anchorRect);
    };
    const handleFocus = (event: FocusEvent) => {
      const active = readAnnotation(event.target instanceof Element ? event.target : null);
      onAnnotationChange(active?.annotation ?? null, active?.anchorRect);
    };
    const handleLeave = () => {
      onAnnotationChange(null);
    };

    root.addEventListener('pointermove', handleMove, true);
    root.addEventListener('mousemove', handleMove, true);
    root.addEventListener('focusin', handleFocus, true);
    root.addEventListener('mouseleave', handleLeave);
    return () => {
      root.removeEventListener('pointermove', handleMove, true);
      root.removeEventListener('mousemove', handleMove, true);
      root.removeEventListener('focusin', handleFocus, true);
      root.removeEventListener('mouseleave', handleLeave);
    };
  }, [annotationKey, annotations.length, onAnnotationChange]);

  return (
    <div
      ref={rootRef}
      className={`katex-container math-formula ${inline ? 'math-formula--inline' : 'math-formula--display'} ${
        rendered.failed ? 'math-formula--failed' : ''
      } ${annotations.length ? 'math-formula--annotated' : ''} ${className}`}
      data-display-mode={rendered.displayMode}
    >
      <div className="math-formula__viewport">
        <div ref={contentRef} className="math-formula__content" dangerouslySetInnerHTML={{ __html: rendered.html }} />
      </div>
    </div>
  );
}
