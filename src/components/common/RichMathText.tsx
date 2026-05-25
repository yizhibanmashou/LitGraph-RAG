import { Fragment, useMemo } from 'react';
import { renderMathToHtml } from './MathFormula';

interface RichMathTextProps {
  text?: string | null;
  className?: string;
}

type RichTextPart =
  | { type: 'text'; value: string }
  | { type: 'math'; value: string };

const INLINE_MATH_RE = /(\\\([\s\S]+?\\\)|\$[^$\n]+?\$)/g;

function stripInlineMathDelimiters(value: string): string {
  return value
    .replace(/^\\\(([\s\S]+)\\\)$/, '$1')
    .replace(/^\$([\s\S]+)\$$/, '$1')
    .trim();
}

export function splitRichMathText(text = ''): RichTextPart[] {
  const parts: RichTextPart[] = [];
  let cursor = 0;

  for (const match of text.matchAll(INLINE_MATH_RE)) {
    const raw = match[0];
    const index = match.index ?? 0;
    if (index > cursor) parts.push({ type: 'text', value: text.slice(cursor, index) });
    parts.push({ type: 'math', value: stripInlineMathDelimiters(raw) });
    cursor = index + raw.length;
  }

  if (cursor < text.length) parts.push({ type: 'text', value: text.slice(cursor) });
  return parts.filter((part) => part.value.length > 0);
}

export function RichMathText({ text = '', className = '' }: RichMathTextProps) {
  const safeText = text || '';
  const parts = useMemo(() => splitRichMathText(safeText), [safeText]);

  return (
    <span className={`rich-math-text ${className}`}>
      {parts.map((part, index) => {
        if (part.type === 'text') return <Fragment key={`${index}-text`}>{part.value}</Fragment>;
        const rendered = renderMathToHtml(part.value, true);
        return (
          <span
            key={`${index}-math`}
            className={`rich-math-text__formula ${rendered.failed ? 'rich-math-text__formula--failed' : ''}`}
            dangerouslySetInnerHTML={{ __html: rendered.html }}
          />
        );
      })}
    </span>
  );
}
