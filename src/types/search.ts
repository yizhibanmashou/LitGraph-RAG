import type { SearchFormula } from './formula';

export type FormulaSearchResult = SearchFormula & {
  resultType?: 'formula';
};

export interface ChapterSearchResult {
  resultType: 'chapter';
  id: string;
  chapter_id: string;
  chapter: number;
  label: string;
  title: string;
  context: string;
  formula_count: number;
}

export type SearchResult = FormulaSearchResult | ChapterSearchResult;
