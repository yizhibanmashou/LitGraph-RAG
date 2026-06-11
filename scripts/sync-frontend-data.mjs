import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const source = resolve(root, 'data/frontend');
const target = resolve(root, 'public/data');

const reviewOnlyPatterns = [
  /[/\\]concept_graph[/\\][^/\\]+_symbol_concept_map\.json$/,
  /[/\\]concept_graph[/\\]concept_merge_candidates\.json$/,
  /[/\\]concept_graph[/\\]concept_review_audit\.json$/,
  /[/\\]concept_graph[/\\]llm_prompts(?:[/\\]|$)/,
  /[/\\]concept_graph[/\\]llm_results(?:[/\\]|$)/,
  /[/\\]symbol_sense[/\\]prompts(?:[/\\]|$)/,
];

const unsafePublicCopyPatterns = [
  /由当前支撑公式引入/,
  /局部数学量/,
  /当前公式涉及/,
  /背景概念/,
  /概念定义/,
  /教材引入/,
  /待审阅/,
  /上下文线索/,
  /由邻近段落支撑/,
  /local mathematical quantity/i,
  /supporting formula/i,
  /local formula context/i,
];

const internalPublicFields = [
  'review_status',
  'review_flags',
  'reviewed_by',
  'reviewed_at',
  'review_notes',
  'symbol_concepts',
  'source_sentence',
  'teaching_move',
  'teaching_move_zh',
  'extraction_model',
];

function isProductData(filePath) {
  return !reviewOnlyPatterns.some((pattern) => pattern.test(filePath));
}

await mkdir(resolve(root, 'public'), { recursive: true });
await rm(target, { recursive: true, force: true });
await cp(source, target, {
  recursive: true,
  filter: (sourcePath) => isProductData(sourcePath),
});
await sanitizeProductConceptData(resolve(target, 'concept_graph'));

console.log(`Synced ${source} -> ${target}`);

async function sanitizeProductConceptData(conceptGraphDir) {
  let files = [];
  try {
    files = await readdir(conceptGraphDir);
  } catch {
    return;
  }

  for (const file of files) {
    const filePath = resolve(conceptGraphDir, file);
    if (file === 'concept_graph_index.json') {
      await transformJson(filePath, sanitizeConceptGraphIndex);
    } else if (file.endsWith('_concept_graph.json')) {
      await transformJson(filePath, sanitizeConceptGraphPayload);
    }
  }
}

async function transformJson(filePath, transform) {
  const payload = JSON.parse(await readFile(filePath, 'utf8'));
  await writeFile(filePath, `${JSON.stringify(transform(payload), null, 2)}\n`, 'utf8');
}

function sanitizeConceptGraphIndex(payload) {
  return {
    ...payload,
    chapters: (payload.chapters || []).map((chapter) => omitKeys(chapter, [
      'symbol_concept_map',
      'review_summary',
      'symbol_concept_entries',
      'low_confidence_entries',
    ])),
    summary: omitKeys(payload.summary || {}, [
      'symbol_concept_entries',
      'reviewed_symbol_concepts',
      'unreviewed_symbol_concepts',
    ]),
  };
}

function sanitizeConceptGraphPayload(payload) {
  return stripUndefined({
    ...payload,
    source: sanitizeConceptGraphSource(payload.source || {}),
    summary: omitKeys(payload.summary || {}, ['symbol_concept_entries', 'low_confidence_entries']),
    symbol_concepts: undefined,
    views: (payload.views || []).map(sanitizeConceptView),
  });
}

function sanitizeConceptGraphSource(source) {
  return {
    ...omitKeys(source, ['symbol_concept_map']),
    method: 'learner concept views from formula dependencies and structured evidence',
  };
}

function sanitizeConceptView(view) {
  const sanitized = omitKeys(view, internalPublicFields);
  return {
    ...sanitizePublicCopy(sanitized, view),
    evidence: sanitizeEvidence(view.evidence || []),
    prerequisite_concepts: (view.prerequisite_concepts || []).map(sanitizeConceptReference),
    introduced_concepts: (view.introduced_concepts || []).map(sanitizeConceptReference),
  };
}

function sanitizeConceptReference(reference) {
  const sanitized = omitKeys(reference, internalPublicFields);
  const copySafe = sanitizePublicCopy(sanitized, reference);
  return {
    ...copySafe,
    prerequisite_concepts: (reference.prerequisite_concepts || []).map(sanitizeConceptReference),
    introduced_concepts: (reference.introduced_concepts || []).map(sanitizeConceptReference),
  };
}

function sanitizeEvidence(evidence) {
  return evidence.map((item) => omitKeys(item, ['sentence', 'teaching_move', 'teaching_move_zh', 'source_sentence']));
}

function omitKeys(value, keys) {
  const result = { ...value };
  for (const key of keys) delete result[key];
  return result;
}

function stripUndefined(value) {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .map(([key, child]) => [key, stripUndefined(child)]),
  );
}

function isUnsafePublicCopy(value) {
  return typeof value === 'string' && unsafePublicCopyPatterns.some((pattern) => pattern.test(value));
}

function sanitizePublicCopy(item, source = item) {
  const next = { ...item };
  const name = source.name || source.concept_name || 'Concept';
  const symbol = source.symbol || source.defined_symbol || 'the symbol';
  const formulaLabel = source.formula_label || source.supporting_formula_label || source.label || 'the formula';

  if (isUnsafePublicCopy(next.definition)) {
    next.definition = `${name} is the concept represented by ${symbol} in ${formulaLabel}.`;
  }
  if (isUnsafePublicCopy(next.definition_zh)) {
    next.definition_zh = `${name} 表示 ${formulaLabel} 中符号 ${symbol} 对应的概念。`;
  }
  return stripUndefined(next);
}
