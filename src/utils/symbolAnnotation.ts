import type { FormulaPrerequisite } from '../types/formula';
import { conciseVariablePrerequisite } from './formulaInfo.ts';

export interface SymbolAnnotationOptions {
  shortLabel?: string;
  llmText?: string;
}

const GENERIC_LABEL_PATTERNS = [
  /直接使用的符号/,
  /关键符号/,
  /当前公式中的关键符号/,
  /^是这个公式/,
  /^出现在当前公式附近/,
];

export function isGenericAnnotationLabel(value: string): boolean {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return true;
  return GENERIC_LABEL_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function compressTextToShortLabel(text: string, maxLength = 16): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';

  const firstClause = cleaned.split(/[。；;.!?]/)[0]?.trim() || cleaned;
  const withoutTrailingDetail = firstClause.replace(/[，,][^，,]+$/, '').trim();
  const candidate = withoutTrailingDetail || firstClause;

  if (candidate.length <= maxLength) return candidate;
  const trimmed = candidate.slice(0, maxLength).replace(/\s+\S*$/, '').trim();
  return trimmed || candidate.slice(0, maxLength);
}

export function resolveSymbolShortLabel(prereq: FormulaPrerequisite, options: SymbolAnnotationOptions = {}): string {
  const explicit = options.shortLabel?.trim();
  if (explicit && !isGenericAnnotationLabel(explicit)) return explicit;

  const llmText = options.llmText?.trim();
  if (llmText) {
    const fromLlm = compressTextToShortLabel(llmText);
    if (fromLlm && !isGenericAnnotationLabel(fromLlm)) return fromLlm;
  }

  const meaning = prereq.meaning?.trim() || prereq.definition?.trim();
  if (meaning) {
    const fromMeaning = compressTextToShortLabel(meaning);
    if (fromMeaning && !isGenericAnnotationLabel(fromMeaning)) return fromMeaning;
  }

  const fallback = conciseVariablePrerequisite(prereq);
  return isGenericAnnotationLabel(fallback) ? '' : fallback;
}

export function resolveSymbolMeaning(prereq: FormulaPrerequisite, options: SymbolAnnotationOptions = {}): string {
  return options.llmText?.trim() || prereq.meaning?.trim() || prereq.definition?.trim() || conciseVariablePrerequisite(prereq);
}

export function isFocusAnnotationLabel(note: string): boolean {
  return Boolean(note.trim()) && !isGenericAnnotationLabel(note);
}
