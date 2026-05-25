import React, { KeyboardEvent, MouseEvent } from 'react';
import type { NodeProps } from '@xyflow/react';
import { Handle, Position } from '@xyflow/react';
import type { FormulaNodeData } from '../../types/graph';
import type { FormulaPrerequisite } from '../../types/formula';
import { chapterColor, chapterRank, rawFormulaNumber } from '../../utils/constants';
import { buildFormulaSymbolPrerequisites, explainVariablePrerequisite } from '../../utils/formulaInfo';
import { DEFAULT_LANGUAGE, formatChapterLabel, getUiCopy } from '../../utils/uiCopy';
import { MathFormula } from '../common/MathFormula';
import { RichMathText } from '../common/RichMathText';

function compareSymbolExplanations(a?: any[], b?: any[]): boolean {
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
      item.llmText === other.llmText &&
      item.llmStatus === other.llmStatus
    );
  });
}

type SymbolNote = FormulaPrerequisite & { llmText?: string; llmStatus?: 'loading' | 'ready' | 'error' };

export const FormulaNode = React.memo(
  ({ id, data, selected }: NodeProps) => {
    const nodeData = data as unknown as FormulaNodeData;
    const formula = nodeData.formula;
    const copy = getUiCopy(DEFAULT_LANGUAGE).graph.node;
    const symbolNotes: SymbolNote[] = nodeData.symbolExplanations?.length ? nodeData.symbolExplanations : buildFormulaSymbolPrerequisites(formula);
    const chapter = chapterRank(formula.chapter_id, Number(rawFormulaNumber(formula.id).split('.')[0]));
    const active = nodeData.focused || selected;
    const role = nodeData.role || (nodeData.focused ? 'focus' : 'prerequisite');

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

    return (
      <div
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
        <MathFormula latex={formula.latex} className="formula-node__math mt-3" />
        {nodeData.mode === 'focus' ? (
          <div className="formula-node__symbol-strip" aria-label={copy.symbolNotes}>
            <strong>{copy.symbolNotes}</strong>
            {symbolNotes.slice(0, 6).map((prereq) => (
              <div key={prereq.symbol} className="formula-node__symbol-note">
                <MathFormula latex={prereq.symbol} inline />
                <p><RichMathText text={prereq.llmText || explainVariablePrerequisite(prereq)} /></p>
                {prereq.llmStatus === 'loading' ? <small>{copy.symbolLoading}</small> : null}
                {prereq.llmStatus === 'ready' ? <small>{copy.symbolSource}</small> : null}
                {prereq.llmStatus === 'error' ? <small>{copy.symbolFallback}</small> : null}
              </div>
            ))}
            {!symbolNotes.length ? (
              <p className="formula-node__symbol-empty">{copy.symbolEmpty}</p>
            ) : null}
          </div>
        ) : null}
        <div className="formula-node__footer mt-3 flex items-center justify-between gap-3 pt-2.5">
          <div className="formula-node__section line-clamp-2 text-left">{formula.section || formula.subsection}</div>
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
      prevData.learned === nextData.learned &&
      compareSymbolExplanations(prevData.symbolExplanations, nextData.symbolExplanations)
    );
  },
);
