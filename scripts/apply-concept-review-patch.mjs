import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const CONCEPT_GRAPH_DIR = resolve(ROOT, 'tmp/concept-review');

const REVIEW_STATUSES = ['unreviewed', 'approved', 'rejected', 'edited', 'ambiguous', 'needs_revision', 'reviewed'];

function stableKey(concept) {
  return [concept.chapter_id, concept.formula_id, concept.role, concept.symbol].join('::');
}

function summaryFor(chapterId, concepts) {
  const status_counts = concepts.reduce((counts, concept) => {
    const status = REVIEW_STATUSES.includes(concept.review_status) ? concept.review_status : 'unreviewed';
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});
  const reviewed_entries = concepts.filter((concept) => (concept.review_status || 'unreviewed') !== 'unreviewed').length;
  return {
    chapter_id: chapterId,
    symbol_concept_entries: concepts.length,
    unique_concepts: new Set(concepts.map((concept) => concept.concept_id)).size,
    low_confidence_entries: concepts.filter((concept) => concept.confidence < 0.72).length,
    reviewed_entries,
    unreviewed_entries: concepts.length - reviewed_entries,
    status_counts,
  };
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeJson(filePath, payload) {
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function targetMapPath(chapterId) {
  return resolve(CONCEPT_GRAPH_DIR, `${chapterId}_symbol_concept_map.json`);
}

function applyPatch(mapPayload, patchPayload) {
  const byKey = new Map(mapPayload.symbol_concepts.map((concept, index) => [stableKey(concept), index]));
  let applied = 0;

  for (const entry of patchPayload.entries || []) {
    const key = entry.stable_key || [entry.chapter_id, entry.formula_id, entry.role, entry.symbol].join('::');
    const index = byKey.get(key);
    if (index === undefined) continue;
    const {
      stable_key: _stableKey,
      chapter_id: _chapterId,
      formula_id: _formulaId,
      symbol: _symbol,
      role: _role,
      ...updates
    } = entry;
    mapPayload.symbol_concepts[index] = {
      ...mapPayload.symbol_concepts[index],
      ...updates,
    };
    applied += 1;
  }

  mapPayload.summary = summaryFor(mapPayload.chapter_id, mapPayload.symbol_concepts);
  mapPayload.review_updated_at = new Date().toISOString();
  return applied;
}

async function applyReviewFile(reviewPath) {
  const payload = await readJson(reviewPath);
  const chapterId = payload.chapter_id;
  if (!chapterId) throw new Error(`Review file is missing chapter_id: ${reviewPath}`);

  if (Array.isArray(payload.symbol_concepts)) {
    payload.summary = summaryFor(chapterId, payload.symbol_concepts);
    payload.review_updated_at = new Date().toISOString();
    await writeJson(targetMapPath(chapterId), payload);
    return { chapterId, applied: payload.symbol_concepts.length, mode: 'full-map' };
  }

  const mapPath = targetMapPath(chapterId);
  const mapPayload = await readJson(mapPath);
  const applied = applyPatch(mapPayload, payload);
  await writeJson(mapPath, mapPayload);
  return { chapterId, applied, mode: 'patch' };
}

async function main() {
  const reviewFiles = process.argv.slice(2).map((item) => resolve(process.cwd(), item));
  if (!reviewFiles.length) {
    console.error('Usage: node scripts/apply-concept-review-patch.mjs <review-patch-or-map.json> [...]');
    process.exitCode = 1;
    return;
  }

  for (const reviewFile of reviewFiles) {
    const result = await applyReviewFile(reviewFile);
    console.log(`Applied ${result.applied} ${result.mode} entries for ${result.chapterId} from ${reviewFile}`);
  }
  console.log(`Updated maps in ${dirname(targetMapPath('chapterX'))}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
