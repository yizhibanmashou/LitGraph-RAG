#!/usr/bin/env node

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONCEPT_GRAPH_DIR = path.join(ROOT, 'tmp', 'concept-review');
const DEPENDENCY_DIR = path.join(ROOT, 'data', 'frontend', 'dependency');
const PROMPT_DIR = path.join(CONCEPT_GRAPH_DIR, 'llm_prompts');
const RESULT_DIR = path.join(CONCEPT_GRAPH_DIR, 'llm_results');

const CONCEPT_TYPES = new Set([
  'quantity_concept',
  'math_concept',
  'domain_concept',
  'theorem_or_principle',
  'operator_or_function',
  'unknown',
]);

const REVIEW_STATUSES = new Set(['unreviewed', 'approved', 'rejected', 'edited', 'ambiguous', 'needs_revision', 'reviewed']);

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const options = parseArgs(args);
  if (!command || options.help) {
    printHelp();
    return;
  }

  if (command === 'export-prompts') {
    await exportPrompts(options);
    return;
  }

  if (command === 'import-results') {
    await importResults(options);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

async function exportPrompts(options) {
  await mkdir(PROMPT_DIR, { recursive: true });
  const chapters = await loadSelectedChapters(options.chapter);
  let total = 0;

  for (const chapter of chapters) {
    const records = buildPromptRecords(chapter, options);
    const outputPath = options.output && chapters.length === 1
      ? path.resolve(ROOT, options.output)
      : path.join(PROMPT_DIR, `${chapter.chapterId}.jsonl`);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, records.map((record) => JSON.stringify(record)).join('\n') + '\n', 'utf8');
    total += records.length;
    console.log(`exported ${String(records.length).padStart(5)} prompts -> ${relative(outputPath)}`);
  }

  console.log(`done: ${chapters.length} chapters, ${total} symbol-concept prompts`);
}

async function importResults(options) {
  const chapters = await loadSelectedChapters(options.chapter);
  await mkdir(RESULT_DIR, { recursive: true });

  for (const chapter of chapters) {
    const inputPath = options.input && chapters.length === 1
      ? path.resolve(ROOT, options.input)
      : path.join(RESULT_DIR, `${chapter.chapterId}.raw.json`);
    const raw = await readRawResults(inputPath);
    const patch = normalizeResultsToPatch(chapter, raw, options);
    const outputPath = options.output && chapters.length === 1
      ? path.resolve(ROOT, options.output)
      : path.join(RESULT_DIR, `${chapter.chapterId}_symbol_concept_review_patch.json`);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeJson(outputPath, patch);
    console.log(`imported ${String(patch.entries.length).padStart(5)} results -> ${relative(outputPath)}`);
    if (patch.issues.length) {
      for (const issue of patch.issues.slice(0, 20)) {
        console.warn(`[${chapter.chapterId}] ${issue.stable_key || issue.formula_id || 'unknown'}: ${issue.message}`);
      }
      if (patch.issues.length > 20) console.warn(`[${chapter.chapterId}] ... ${patch.issues.length - 20} more issues`);
      if (options.strict !== false) {
        throw new Error(`Import failed for ${chapter.chapterId}: ${patch.issues.length} validation issues.`);
      }
    }
  }
}

function buildPromptRecords(chapter, options) {
  const status = options.status || 'all';
  const quality = options.quality || 'all';
  const limit = Number.isFinite(options.limit) ? options.limit : Infinity;
  const records = [];

  for (const concept of chapter.symbolConceptMap.symbol_concepts) {
    if (status !== 'all' && (concept.review_status || 'unreviewed') !== status) continue;
    if (quality === 'low-confidence' && concept.confidence >= 0.72) continue;
    if (quality === 'flagged' && !concept.review_flags?.length) continue;
    const formula = chapter.formulaById.get(concept.formula_id);
    if (!formula) continue;
    const dependency = chapter.dependencyById.get(concept.formula_id);
    const input = {
      chapter_id: chapter.chapterId,
      formula_id: concept.formula_id,
      formula_label: concept.formula_label,
      formula_latex: formula.latex,
      formula_section: formula.section,
      formula_subsection: formula.subsection,
      symbol: concept.symbol,
      symbol_role: concept.role,
      current_candidate: {
        concept_id: concept.concept_id,
        concept_name: concept.concept_name,
        concept_type: concept.concept_type,
        definition: concept.definition,
        definition_zh: concept.definition_zh,
        confidence: concept.confidence,
        review_flags: concept.review_flags || [],
      },
      formula_symbols: {
        symbols_defined: formula.symbols_defined || [],
        symbols_used: formula.symbols_used || [],
      },
      formula_dependencies: (dependency?.prerequisites || [])
        .filter((item) => item.type === 'formula' && item.target_id && !item.cross_chapter)
        .map((item) => ({
          formula_id: item.target_id,
          via_symbol: item.via_symbol,
          confidence: item.confidence,
          relation: item.relation,
        })),
      evidence: concept.evidence || [],
      nearby_text: formula.context_text || '',
    };
    records.push({
      task_id: stableKey(concept),
      input,
      output_schema: symbolConceptOutputSchema(),
      prompt: buildPromptText(input),
    });
    if (records.length >= limit) break;
  }

  return records;
}

function buildPromptText(input) {
  return [
    '你是一名数学教材知识工程师。请只根据给定公式、符号、上下文和证据，判断该符号对应的人可读概念。',
    '不要生成概念图边；概念边会由公式依赖图继承。你只负责 symbol -> concept。',
    '同一个符号在不同 formula_id 或 role 中可以对应不同概念，不要做全局单值映射。',
    '输出必须是单个 JSON object，并严格符合 output_schema。definition 要短、清楚，适合初学者。',
    '输入:',
    JSON.stringify(input, null, 2),
  ].join('\n\n');
}

function symbolConceptOutputSchema() {
  return {
    type: 'object',
    required: ['formula_id', 'symbol', 'role', 'concept_name', 'concept_type', 'definition', 'confidence', 'evidence'],
    properties: {
      formula_id: { type: 'string' },
      symbol: { type: 'string' },
      role: { enum: ['defined', 'used'] },
      concept_name: { type: 'string' },
      concept_type: { enum: [...CONCEPT_TYPES] },
      definition: { type: 'string' },
      definition_zh: { type: 'string' },
      aliases: { type: 'array', items: { type: 'string' } },
      evidence: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            chunk_id: { type: 'string' },
            block_index: { type: 'number' },
            block_type: { type: 'string' },
            sentence: { type: 'string' },
          },
        },
      },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      review_notes: { type: 'string' },
    },
  };
}

function normalizeResultsToPatch(chapter, raw, options) {
  const rawItems = extractResultItems(raw);
  const conceptByKey = new Map(chapter.symbolConceptMap.symbol_concepts.map((concept) => [stableKey(concept), concept]));
  const issues = [];
  const entries = [];

  for (const item of rawItems) {
    const normalized = normalizeResultItem(item, conceptByKey, issues, options);
    if (normalized) entries.push(normalized);
  }

  return {
    chapter_id: chapter.chapterId,
    generated_at: utcNow(),
    source: {
      method: 'llm_structured_symbol_concept_extraction',
      input: 'data/frontend/concept_graph/llm_prompts',
      strict: options.strict !== false,
    },
    entries,
    issues,
  };
}

function normalizeResultItem(raw, conceptByKey, issues, options) {
  if (!isRecord(raw)) {
    issues.push({ message: 'Result item must be an object.' });
    return null;
  }
  const key = asString(raw.stable_key) || asString(raw.task_id) || [raw.chapter_id, raw.formula_id, raw.role, raw.symbol].map(asString).join('::');
  const original = conceptByKey.get(key);
  if (!original) {
    issues.push({ stable_key: key, message: 'No matching symbol-concept map entry.' });
    return null;
  }

  const conceptName = asString(raw.concept_name).trim();
  const definition = asString(raw.definition).trim();
  const conceptType = asString(raw.concept_type);
  const confidence = clampConfidence(raw.confidence);
  const reviewStatus = asString(raw.review_status) || 'unreviewed';

  if (!conceptName) issues.push({ stable_key: key, message: 'Missing concept_name.' });
  if (!definition) issues.push({ stable_key: key, message: 'Missing definition.' });
  if (!CONCEPT_TYPES.has(conceptType)) issues.push({ stable_key: key, message: `Invalid concept_type "${conceptType}".` });
  if (!REVIEW_STATUSES.has(reviewStatus)) issues.push({ stable_key: key, message: `Invalid review_status "${reviewStatus}".` });

  const reviewFlags = new Set(Array.isArray(raw.review_flags) ? raw.review_flags.filter((item) => typeof item === 'string') : []);
  reviewFlags.add('llm_candidate');
  if (confidence < 0.72) reviewFlags.add('needs_review');

  return {
    stable_key: key,
    chapter_id: original.chapter_id,
    formula_id: original.formula_id,
    symbol: original.symbol,
    role: original.role,
    concept_name: conceptName || original.concept_name,
    concept_type: CONCEPT_TYPES.has(conceptType) ? conceptType : original.concept_type,
    definition: definition || original.definition,
    definition_zh: asString(raw.definition_zh) || original.definition_zh,
    aliases: Array.isArray(raw.aliases) ? raw.aliases.filter((item) => typeof item === 'string') : original.aliases,
    evidence: Array.isArray(raw.evidence) ? raw.evidence.filter(isRecord) : original.evidence,
    confidence,
    review_status: REVIEW_STATUSES.has(reviewStatus) ? reviewStatus : 'unreviewed',
    review_flags: [...reviewFlags],
    review_notes: asString(raw.review_notes),
    extraction_model: asString(raw.extraction_model) || options.model || 'llm_structured_symbol_concept_extractor',
  };
}

function extractResultItems(raw) {
  if (Array.isArray(raw)) return raw;
  if (isRecord(raw) && Array.isArray(raw.results)) return raw.results;
  if (isRecord(raw) && Array.isArray(raw.entries)) return raw.entries;
  return [];
}

async function loadSelectedChapters(chapterId) {
  const mapFiles = await conceptMapFiles();
  const selected = chapterId
    ? mapFiles.filter((file) => path.basename(file) === `${chapterId}_symbol_concept_map.json`)
    : mapFiles;
  if (!selected.length) throw new Error(chapterId ? `No symbol-concept map for ${chapterId}.` : 'No symbol-concept maps found.');

  const chapters = [];
  for (const mapPath of selected) {
    const symbolConceptMap = await readJson(mapPath);
    const dependencyPath = path.join(DEPENDENCY_DIR, `${symbolConceptMap.chapter_id}_dependencies.json`);
    const dependency = await readJson(dependencyPath);
    chapters.push({
      chapterId: symbolConceptMap.chapter_id,
      symbolConceptMap,
      formulaById: new Map((dependency.formulas || []).map((formula) => [formula.id, formula])),
      dependencyById: new Map((dependency.dependencies || []).map((item) => [item.dependent_id, item])),
    });
  }
  return chapters.sort((a, b) => sortChapterId(a.chapterId).localeCompare(sortChapterId(b.chapterId)));
}

async function conceptMapFiles() {
  const files = await readdir(CONCEPT_GRAPH_DIR);
  return files
    .filter((file) => file.endsWith('_symbol_concept_map.json'))
    .map((file) => path.join(CONCEPT_GRAPH_DIR, file));
}

async function readRawResults(inputPath) {
  const text = await readFile(inputPath, 'utf8');
  if (inputPath.endsWith('.jsonl')) {
    return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  }
  return JSON.parse(text);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function parseArgs(args) {
  const options = { strict: true };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--chapter') options.chapter = args[++index];
    else if (arg === '--status') options.status = args[++index];
    else if (arg === '--quality') options.quality = args[++index];
    else if (arg === '--limit') options.limit = Number(args[++index]);
    else if (arg === '--input') options.input = args[++index];
    else if (arg === '--output') options.output = args[++index];
    else if (arg === '--model') options.model = args[++index];
    else if (arg === '--no-strict') options.strict = false;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function stableKey(concept) {
  return [concept.chapter_id, concept.formula_id, concept.role, concept.symbol].join('::');
}

function sortChapterId(chapterId) {
  const match = /^(chapter|appendix)(\d+)$/i.exec(chapterId);
  if (!match) return chapterId;
  const prefix = match[1].toLowerCase() === 'chapter' ? '0' : '1';
  return `${prefix}-${match[2].padStart(3, '0')}`;
}

function clampConfidence(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

function asString(value) {
  return typeof value === 'string' ? value : '';
}

function isRecord(value) {
  return typeof value === 'object' && value !== null;
}

function relative(targetPath) {
  return path.relative(ROOT, targetPath).replaceAll(path.sep, '/');
}

function utcNow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function printHelp() {
  console.log(`Concept extraction pipeline

Usage:
  node scripts/concept_extraction/cli.mjs export-prompts [--chapter chapter6] [--quality low-confidence] [--limit 100]
  node scripts/concept_extraction/cli.mjs import-results --chapter chapter6 [--input path/to/raw.json]

Notes:
  export-prompts writes JSONL records to tmp/concept-review/llm_prompts/.
  import-results validates LLM JSON and writes review patches to tmp/concept-review/llm_results/.
  Apply generated patches with: npm run concept:review:apply -- <patch.json>
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
