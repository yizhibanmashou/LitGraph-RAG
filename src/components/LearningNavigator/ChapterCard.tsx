import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { SearchFormula } from '../../types/formula';
import type { ChapterLearningEntry } from '../../types/learning';
import { rawFormulaNumber } from '../../utils/constants';
import { inferChapterTitleFromSearchIndex } from '../../utils/learningNavigator';
import { DEFAULT_LANGUAGE, formatChapterLabel, getUiCopy } from '../../utils/uiCopy';

interface ChapterCardProps {
  chapter: ChapterLearningEntry;
  searchIndex: SearchFormula[];
}

export function ChapterCard({ chapter, searchIndex }: ChapterCardProps) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const copy = getUiCopy(DEFAULT_LANGUAGE).navigator;
  const first = chapter.backbone_formula_ids[0] || chapter.full_formula_ids[0];
  const chapterTitle = chapter.description_zh || chapter.section_hint || inferChapterTitleFromSearchIndex(chapter.chapter, searchIndex) || chapter.title_zh || chapter.title_en;

  return (
    <article className={`learning-card ${open ? 'learning-card--open' : ''}`}>
      <button type="button" className="learning-card__summary" onClick={() => setOpen((value) => !value)}>
        <span className="learning-card__eyebrow">{formatChapterLabel(chapter.chapter_id, chapter.chapter)}</span>
        <strong>{chapter.title_zh || chapter.title_en.replace(' Formula Navigator', '')}</strong>
        <span>{chapter.backbone_formula_ids.length} {copy.roots} · {chapter.full_formula_ids.length} {copy.formulas}</span>
      </button>
      {open ? (
        <div className="learning-card__preview">
          <p>{chapterTitle}</p>
          <div className="learning-card__sequence">
            {chapter.representative_formula_ids.map((id) => (
              <span key={id}>{rawFormulaNumber(id)}</span>
            ))}
          </div>
          <button type="button" disabled={!first} onClick={() => navigate(`/chapter/${chapter.chapter_id}`)}>
            {copy.enterChapter}
          </button>
        </div>
      ) : null}
    </article>
  );
}
