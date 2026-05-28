import React, { MouseEvent, useCallback, useMemo, useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import { Handle, Position } from '@xyflow/react';
import type { FormulaNodeData } from '../../types/graph';
import type { FormulaPrerequisite } from '../../types/formula';
import { chapterColor, chapterRank, rawFormulaNumber } from '../../utils/constants';
import { buildFormulaSymbolPrerequisites } from '../../utils/formulaInfo';
import { isFocusAnnotationLabel, resolveSymbolShortLabel } from '../../utils/symbolAnnotation';
import { DEFAULT_LANGUAGE, formatChapterLabel, getUiCopy } from '../../utils/uiCopy';
import { MathFormula, type MathAnnotation } from '../common/MathFormula';

function compareSymbolExplanations(a?: FormulaNodeData['symbolExplanations'], b?: FormulaNodeData['symbolExplanations']): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  return a.every((item, index) => {
    const other = b[index];
    return (
      item.symbol === other.symbol &&
      item.type === other.type &&
      item.target_id === other.target_id &&
      item.confidence === other.confidence &&
      item.shortLabel === other.shortLabel &&
      item.llmText === other.llmText &&
      item.llmStatus === other.llmStatus
    );
  });
}

type SymbolNote = FormulaPrerequisite & {
  shortLabel?: string;
  llmText?: string;
  llmStatus?: 'loading' | 'ready' | 'error';
};

interface ActiveCallout {
  annotation: MathAnnotation;
  anchor: { x: number; y: number };
  box: { x: number; y: number; width: number; height: number };
  lineStart: { x: number; y: number };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function estimateCalloutBox(note: string): { width: number; height: number } {
  const length = note.trim().length;
  const width = clamp(Math.round(length * 15 + 28), 132, 220);
  const height = length > 14 ? 50 : 36;
  return { width, height };
}

function displaySymbolLabel(symbol: string): string {
  return symbol
    .replace(/\\mathrm\{([^{}]+)\}/g, '$1')
    .replace(/\\overline\{([^{}]+)\}/g, '$1̄')
    .replace(/[{}]/g, '')
    .replace(/\\/g, '')
    .trim();
}

export const FormulaNode = React.memo(
  ({ id, data, selected }: NodeProps) => {
    const nodeRef = React.useRef<HTMLDivElement | null>(null);
    const nodeData = data as unknown as FormulaNodeData;
    const formula = nodeData.formula;
    const copy = getUiCopy(DEFAULT_LANGUAGE).graph.node;
    const symbolNotes: SymbolNote[] = useMemo(
      () => (nodeData.symbolExplanations?.length ? nodeData.symbolExplanations : buildFormulaSymbolPrerequisites(formula)),
      [formula, nodeData.symbolExplanations],
    );
    const chapter = chapterRank(formula.chapter_id, Number(rawFormulaNumber(formula.id).split('.')[0]));
    const active = nodeData.focused || selected;
    const role = nodeData.role || (nodeData.focused ? 'focus' : 'prerequisite');
    const [activeCallout, setActiveCallout] = useState<ActiveCallout | null>(null);
    const annotations = useMemo(
      () =>
        nodeData.mode === 'focus'
          ? symbolNotes
              .map((prereq) => {
                const symbol = prereq.symbol || prereq.via_symbol || '';
                const note = resolveSymbolShortLabel(prereq, {
                  shortLabel: prereq.shortLabel,
                  llmText: prereq.llmText,
                });
                return { symbol, note };
              })
              .filter((item) => item.symbol && isFocusAnnotationLabel(item.note))
          : [],
      [nodeData.mode, symbolNotes],
    );

    const handleDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
      event.stopPropagation();
      if (nodeData.locked) return;
      nodeData.onExpand(id, 'auto');
    };

    const handleTriggerClick = (event: MouseEvent<HTMLButtonElement>, intent: 'prerequisites' | 'successors') => {
      event.stopPropagation();
      if (nodeData.locked) return;
      nodeData.onExpand(id, intent);
    };

    const handleAnnotationChange = useCallback((annotation: MathAnnotation | null, anchorRect?: DOMRect) => {
      if (!annotation || !anchorRect || !nodeRef.current) {
        setActiveCallout(null);
        return;
      }
      const nodeRect = nodeRef.current.getBoundingClientRect();
      const scale = nodeRect.width / (nodeRef.current.offsetWidth || nodeRect.width || 1);
      const anchor = {
        x: (anchorRect.left + anchorRect.width / 2 - nodeRect.left) / scale,
        y: (anchorRect.top + anchorRect.height / 2 - nodeRect.top) / scale,
      };
      const width = nodeRef.current.offsetWidth;
      const height = nodeRef.current.offsetHeight;
      const { width: boxWidth, height: boxHeight } = estimateCalloutBox(annotation.note);
      const placeRight = anchor.x >= width * 0.5;
      const lowerBandY = clamp(anchor.y + 46, 122, height - boxHeight - 44);
      const box = {
        x: placeRight ? clamp(anchor.x + 42, 34, width - boxWidth - 34) : clamp(anchor.x - boxWidth - 42, 34, width - boxWidth - 34),
        y: lowerBandY,
        width: boxWidth,
        height: boxHeight,
      };
      const lineStart = {
        x: placeRight ? box.x : box.x + box.width,
        y: box.y + box.height / 2,
      };

      setActiveCallout({ annotation, anchor, box, lineStart });
    }, []);

    return (
      <div
        ref={nodeRef}
        role="button"
        tabIndex={0}
        aria-disabled={nodeData.locked}
        onDoubleClick={handleDoubleClick}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            nodeData.onExpand(id, 'auto');
          }
        }}
        className={`formula-node formula-node--${role} ${nodeData.mode === 'focus' ? 'formula-node--focus-mode' : ''} ${nodeData.chapterGraph ? 'formula-node--chapter-graph' : ''} ${nodeData.focused ? 'formula-node--focused' : ''} ${selected ? 'formula-node--selected' : ''} ${nodeData.locked ? 'formula-node--locked' : ''} ${nodeData.learned ? 'formula-node--learned' : ''}`}
        style={{ '--chapter-color': chapterColor(chapter) } as React.CSSProperties}
      >
        <Handle type="target" position={Position.Left} />
        {!nodeData.locked && nodeData.mode !== 'focus' ? (
          <div className="formula-node__actions" aria-label={copy.actions}>
            <button type="button" className="formula-node__side-trigger formula-node__side-trigger--left" onClick={(e) => handleTriggerClick(e, 'prerequisites')} aria-label={copy.prerequisiteTrigger} title={copy.prerequisiteTrigger}>
              <span>{copy.prerequisiteTrigger}</span>
            </button>
            <button type="button" className="formula-node__side-trigger formula-node__side-trigger--right" onClick={(e) => handleTriggerClick(e, 'successors')} aria-label={copy.successorTrigger} title={copy.successorTrigger}>
              <span>{copy.successorTrigger}</span>
            </button>
          </div>
        ) : null}
        <div className="formula-node__chapter-bar" aria-hidden="true" />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="formula-node__label truncate">{formula.label}</div>
            <div className="formula-node__chapter-label mt-1">{formatChapterLabel(formula.chapter_id, chapter)}</div>
          </div>
          {nodeData.loading ? (
          <span className="loading-dot mt-0.5 shrink-0" aria-label="正在加载依赖关系" />
          ) : (
            <span
              className={`formula-node__status ${active ? 'formula-node__status--active' : ''}`}
            >
              {nodeData.locked ? copy.locked : (formula.depth ?? 0) <= 0 ? copy.start : copy.layer(formula.depth ?? 0)}
            </span>
          )}
        </div>
        <MathFormula
          latex={formula.latex}
          className="formula-node__math mt-3"
          annotations={annotations}
          onAnnotationChange={nodeData.mode === 'focus' ? handleAnnotationChange : undefined}
        />
        {nodeData.mode === 'focus' && activeCallout ? (
          <>
            <svg className="formula-node__callout-lines" aria-hidden="true">
              <path
                d={`M ${activeCallout.lineStart.x} ${activeCallout.lineStart.y} L ${activeCallout.anchor.x} ${activeCallout.anchor.y}`}
                vectorEffect="non-scaling-stroke"
              />
              <circle cx={activeCallout.anchor.x} cy={activeCallout.anchor.y} r="3.5" />
            </svg>
            <div
              className="formula-node__callout"
              style={{
                left: activeCallout.box.x,
                top: activeCallout.box.y,
                width: activeCallout.box.width,
                minHeight: activeCallout.box.height,
              }}
              aria-live="polite"
            >
              <span className="formula-node__callout-symbol">{displaySymbolLabel(activeCallout.annotation.symbol)}</span>
              <strong>{activeCallout.annotation.note}</strong>
            </div>
          </>
        ) : null}
        <div className="formula-node__footer mt-3 flex items-center justify-between gap-3 pt-2.5">
          <div className="min-w-0 text-left">
            <div className="formula-node__section line-clamp-2">{formula.section || formula.subsection}</div>
            {nodeData.locked && nodeData.lockedReason ? <div className="formula-node__locked-reason">{nodeData.lockedReason}</div> : null}
          </div>
          <span className="formula-node__dot" />
        </div>
        <Handle type="source" position={Position.Right} />
      </div>
    );
  },
  (prev, next) => {
    const prevData = prev.data as unknown as FormulaNodeData;
    const nextData = next.data as unknown as FormulaNodeData;
    return (
      prev.id === next.id &&
      prev.selected === next.selected &&
      prevData.formula.latex === nextData.formula.latex &&
      prevData.focused === nextData.focused &&
      prevData.loading === nextData.loading &&
      prevData.mode === nextData.mode &&
      prevData.locked === nextData.locked &&
      prevData.lockedReason === nextData.lockedReason &&
      prevData.learned === nextData.learned &&
      compareSymbolExplanations(prevData.symbolExplanations, nextData.symbolExplanations)
    );
  },
);
