#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildDevelopmentDependencyPayload,
  buildSymbolSensePromptRecords,
  normalizeSymbolSensePayload,
} from '../../src/utils/symbolSense.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEPENDENCY_DIR = path.join(ROOT, 'data', 'frontend', 'dependency');
const SYMBOL_SENSE_DIR = path.join(ROOT, 'data', 'frontend', 'symbol_sense');
const PROMPT_DIR = path.join(SYMBOL_SENSE_DIR, 'prompts');
const RESULT_DIR = path.join(SYMBOL_SENSE_DIR, 'results');

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

  if (command === 'convert') {
    await convertResults(options);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

async function exportPrompts(options) {
  const chapters = await loadSelectedChapters(options.chapter);
  await mkdir(PROMPT_DIR, { recursive: true });

  let total = 0;
  for (const { chapterId, payload } of chapters) {
    const records = buildSymbolSensePromptRecords(payload);
    const outputPath = path.join(PROMPT_DIR, `${chapterId}.jsonl`);
    await writeFile(outputPath, records.map((record) => JSON.stringify(record)).join('\n') + '\n', 'utf8');
    total += records.length;
    console.log(`exported ${records.length.toString().padStart(3)} prompts -> ${relative(outputPath)}`);
  }

  console.log(`done: ${chapters.length} chapters, ${total} prompts`);
}

async function importResults(options) {
  if (options.input && !options.chapter) {
    throw new Error('--input is only valid together with --chapter. Omit --input to import per-chapter files from data/frontend/symbol_sense/results/.');
  }

  const chapters = await loadSelectedChapters(options.chapter);
  await mkdir(RESULT_DIR, { recursive: true });

  for (const { chapterId, payload } of chapters) {
    const inputPath = options.input
      ? path.resolve(ROOT, options.input)
      : path.join(RESULT_DIR, `${chapterId}.raw.json`);
    const raw = JSON.parse(await readFile(inputPath, 'utf8'));
    const normalized = normalizeSymbolSensePayload(raw, { chapter: payload, generatedAt: utcNow() });
    if (normalized.issues.length > 0 && options.strict !== false) {
      printIssues(chapterId, normalized.issues);
      throw new Error(`Import failed for ${chapterId}: ${normalized.issues.length} validation issues.`);
    }
    if (!normalized.payload) {
      printIssues(chapterId, normalized.issues);
      throw new Error(`Import failed for ${chapterId}: no normalized payload.`);
    }

    const outputPath = path.join(SYMBOL_SENSE_DIR, `${chapterId}_symbol_sense.json`);
    await writeJson(outputPath, normalized.payload);
    console.log(`imported ${normalized.payload.results.length.toString().padStart(3)} results -> ${relative(outputPath)}`);
    if (normalized.issues.length > 0) {
      printIssues(chapterId, normalized.issues);
    }
  }
}

async function convertResults(options) {
  const chapters = await loadSelectedChapters(options.chapter);
  await mkdir(SYMBOL_SENSE_DIR, { recursive: true });

  for (const { chapterId, payload: chapterPayload, dependencyPath } of chapters) {
    const sensePath = path.join(SYMBOL_SENSE_DIR, `${chapterId}_symbol_sense.json`);
    const sensePayload = JSON.parse(await readFile(sensePath, 'utf8'));
    const converted = buildDevelopmentDependencyPayload(chapterPayload, sensePayload, utcNow());

    if (converted.issues.length > 0 && options.strict !== false) {
      printIssues(chapterId, converted.issues);
      throw new Error(`Convert failed for ${chapterId}: ${converted.issues.length} validation issues.`);
    }

    await writeJson(path.join(SYMBOL_SENSE_DIR, `${chapterId}_registry.json`), converted.registry);
    await writeJson(path.join(SYMBOL_SENSE_DIR, `${chapterId}_ambiguous.json`), converted.chapter.ambiguous);
    await writeJson(dependencyPath, converted.chapter);

    console.log(`converted ${chapterId} -> ${relative(dependencyPath)}`);
    if (converted.issues.length > 0) {
      printIssues(chapterId, converted.issues);
    }
  }
}

async function loadSelectedChapters(chapterOption) {
  const files = await getDependencyFiles();
  const selected = chapterOption
    ? files.filter((file) => path.basename(file) === `${chapterOption}_dependencies.json`)
    : files;

  if (selected.length === 0) {
    throw new Error(chapterOption ? `No dependency file found for ${chapterOption}.` : 'No dependency files found.');
  }

  const chapters = [];
  for (const dependencyPath of selected) {
    const payload = JSON.parse(await readFile(dependencyPath, 'utf8'));
    chapters.push({
      chapterId: payload.chapter_id,
      dependencyPath,
      payload,
    });
  }
  return chapters.sort((a, b) => sortChapterId(a.chapterId).localeCompare(sortChapterId(b.chapterId)));
}

async function getDependencyFiles() {
  const { readdir } = await import('node:fs/promises');
  const names = await readdir(DEPENDENCY_DIR);
  return names
    .filter((name) => name.endsWith('_dependencies.json'))
    .map((name) => path.join(DEPENDENCY_DIR, name));
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--chapter') {
      options.chapter = args[++index];
    } else if (arg === '--input') {
      options.input = args[++index];
    } else if (arg === '--no-strict') {
      options.strict = false;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

async function writeJson(outputPath, value) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function printIssues(chapterId, issues) {
  for (const issue of issues) {
    const formula = issue.formula_id ? ` ${issue.formula_id}` : '';
    const field = issue.field ? ` ${issue.field}` : '';
    console.warn(`[${chapterId}]${formula}${field}: ${issue.message}`);
  }
}

function sortChapterId(chapterId) {
  const match = /^(chapter|appendix)(\d+)$/i.exec(chapterId);
  if (!match) {
    return chapterId;
  }
  const prefix = match[1].toLowerCase() === 'chapter' ? '0' : '1';
  return `${prefix}-${match[2].padStart(3, '0')}`;
}

function relative(targetPath) {
  return path.relative(ROOT, targetPath).replaceAll(path.sep, '/');
}

function utcNow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function printHelp() {
  console.log(`Symbol Sense pipeline

Usage:
  node scripts/symbol_sense/cli.mjs export-prompts [--chapter chapter6]
  node scripts/symbol_sense/cli.mjs import-results --chapter chapter6 [--input path/to/raw.json]
  node scripts/symbol_sense/cli.mjs convert [--chapter chapter6]

Notes:
  export-prompts writes JSONL prompt records to data/frontend/symbol_sense/prompts/.
  import-results validates LLM JSON and writes normalized *_symbol_sense.json files.
  convert overwrites data/frontend/dependency only; it never writes public/data.
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
