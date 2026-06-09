import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DEFAULT_CONCEPT_DIRS = [
  resolve(ROOT, 'data/frontend/concept_graph'),
  resolve(ROOT, 'public/data/concept_graph'),
];

function unique(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const next = String(value || '').trim();
    if (!next || seen.has(next.toLowerCase())) continue;
    seen.add(next.toLowerCase());
    result.push(next);
  }
  return result;
}

function buildAliasLookup(symbolConcepts = []) {
  const lookup = new Map();
  for (const item of symbolConcepts) {
    const current = lookup.get(item.concept_id) || [];
    lookup.set(item.concept_id, [
      ...current,
      item.concept_name,
      item.concept_type,
      item.symbol,
      ...(item.aliases || []),
    ]);
  }
  return lookup;
}

function buildSearchItems(payload) {
  const aliasLookup = buildAliasLookup(payload.symbol_concepts);
  return (payload.views || []).map((view) => {
    const aliases = unique([
      ...(aliasLookup.get(view.concept_id) || []),
      view.name,
      view.concept_type,
      view.formula_subsection,
      view.source_sentence,
    ]);
    return {
      resultType: 'concept',
      id: `concept:${view.concept_id}`,
      concept_id: view.concept_id,
      chapter_id: view.chapter_id,
      formula_id: view.defined_by_formula_id,
      title: view.name,
      context: view.definition_zh || view.definition || view.source_sentence || '',
      symbol: view.defined_symbol || '',
      formula_label: view.supporting_formula_label || '',
      formula_section: view.formula_section || '',
      aliases,
    };
  });
}

async function directoryExists(dir) {
  try {
    await readdir(dir);
    return true;
  } catch {
    return false;
  }
}

async function buildConceptSearchIndex(conceptDir) {
  const files = (await readdir(conceptDir))
    .filter((file) => file.endsWith('_concept_graph.json'))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' }));
  const items = [];
  for (const file of files) {
    const payload = JSON.parse(await readFile(resolve(conceptDir, file), 'utf8'));
    items.push(...buildSearchItems(payload));
  }
  const index = {
    version: 1,
    generated_at: new Date().toISOString(),
    source: 'concept_graph/*.json',
    items,
  };
  await mkdir(conceptDir, { recursive: true });
  await writeFile(resolve(conceptDir, 'concept_search_index.json'), `${JSON.stringify(index, null, 2)}\n`, 'utf8');
  console.log(`Generated ${items.length} concept search entries in ${conceptDir}`);
}

const inputDirs = process.argv.slice(2);
const conceptDirs = inputDirs.length ? inputDirs.map((dir) => resolve(ROOT, dir)) : DEFAULT_CONCEPT_DIRS;

for (const conceptDir of conceptDirs) {
  if (await directoryExists(conceptDir)) {
    await buildConceptSearchIndex(conceptDir);
  }
}
