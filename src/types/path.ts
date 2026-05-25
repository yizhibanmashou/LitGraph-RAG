import type { Difficulty } from './learning';

export interface ThemeRouteStepNote {
  formula_id: string;
  note_en: string;
  note_zh: string;
}

export interface ThemeRoute {
  id: string;
  title_en: string;
  title_zh: string;
  description_en: string;
  description_zh: string;
  formula_ids: string[];
  step_notes: ThemeRouteStepNote[];
  tags: string[];
  difficulty: Difficulty;
  coverage: {
    chapter_count: number;
    formula_count: number;
  };
}

export interface ThemeRoutesPayload {
  paths: ThemeRoute[];
}
