#!/usr/bin/env node

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const DEFAULT_CONCEPT_GRAPH_DIR = path.resolve(ROOT, 'tmp/concept-review');
const DEFAULT_OUTPUT_PATH = path.resolve(DEFAULT_CONCEPT_GRAPH_DIR, 'concept_review_audit.json');
const SYMBOL_CONCEPT_MAP_SUFFIX = '_symbol_concept_map.json';
const DEFAULT_QUEUE_LIMIT = 500;
const OPEN_REVIEW_STATUSES = new Set(['unreviewed', 'ambiguous', 'needs_revision']);

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const conceptGraphDir = path.resolve(ROOT, options.inputDir || DEFAULT_CONCEPT_GRAPH_DIR);
  const outputPath = path.resolve(ROOT, options.output || DEFAULT_OUTPUT_PATH);
  const queueLimit = finiteOrDefault(options.limit, DEFAULT_QUEUE_LIMIT);
  const chapterFilter = options.chapter || null;
  const mergeCandidates = await readJsonIfExists(path.join(conceptGraphDir, 'concept_merge_candidates.json'));
  const mergeByStableKey = buildMergeLookup(mergeCandidates);

  const mapFiles = (await readdir(conceptGraphDir))
    .filter((file) => file.endsWith(SYMBOL_CONCEPT_MAP_SUFFIX))
    .filter((file) => !chapterFilter || file === `${chapterFilter}${SYMBOL_CONCEPT_MAP_SUFFIX}`)
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' }));

  if (!mapFiles.length) {
    throw new Error(chapterFilter ? `No symbol-concept map found for ${chapterFilter}.` : 'No symbol-concept maps found.');
  }

  const chapters = [];
  const reviewQueue = [];

  for (const file of mapFiles) {
    const payload = JSON.parse(await readFile(path.join(conceptGraphDir, file), 'utf8'));
    const chapterAudit = auditChapter(payload, mergeByStableKey);
    chapters.push(chapterAudit.summary);
    reviewQueue.push(...chapterAudit.queue);
  }

  reviewQueue.sort((left, right) => {
    if (right.priority_score !== left.priority_score) return right.priority_score - left.priority_score;
    return left.stable_key.localeCompare(right.stable_key);
  });

  const summary = summarizeChapters(chapters, mergeCandidates, reviewQueue.length);
  const report = {
    version: 1,
    generated_at: utcNow(),
    source: {
      symbol_concept_maps: `${relative(conceptGraphDir)}/*${SYMBOL_CONCEPT_MAP_SUFFIX}`,
      merge_candidates: mergeCandidates ? `${relative(conceptGraphDir)}/concept_merge_candidates.json` : null,
      method: 'review status audit and prioritized human review queue',
    },
    completion_gate: completionGate(summary),
    summary,
    chapters,
    review_queue: reviewQueue.slice(0, queueLimit),
    review_queue_limit: queueLimit,
    review_queue_truncated: reviewQueue.length > queueLimit,
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  printSummary(report, outputPath);

  if (options.failOnOpen && !report.completion_gate.passed) {
    process.exitCode = 1;
  }
}

function auditChapter(payload, mergeByStableKey) {
  const statusCounts = {};
  const typeCounts = {};
  let reviewedEntries = 0;
  let openReviewEntries = 0;
  let lowConfidenceEntries = 0;
  let flaggedEntries = 0;
  let mergeCandidateEntries = 0;
  const queue = [];

  for (const concept of payload.symbol_concepts || []) {
    const status = concept.review_status || 'unreviewed';
    const flags = Array.isArray(concept.review_flags) ? concept.review_flags : [];
    const stableKey = stableKeyFor(concept);
    const mergeGroups = mergeByStableKey.get(stableKey) || [];
    statusCounts[status] = (statusCounts[status] || 0) + 1;
    typeCounts[concept.concept_type || 'unknown'] = (typeCounts[concept.concept_type || 'unknown'] || 0) + 1;
    if (status !== 'unreviewed') reviewedEntries += 1;
    if (OPEN_REVIEW_STATUSES.has(status)) openReviewEntries += 1;
    if (Number(concept.confidence || 0) < 0.72) lowConfidenceEntries += 1;
    if (flags.length) flaggedEntries += 1;
    if (mergeGroups.length) mergeCandidateEntries += 1;

    const queueItem = reviewQueueItem(concept, mergeGroups);
    if (queueItem) queue.push(queueItem);
  }

  const totalEntries = payload.symbol_concepts?.length || 0;
  return {
    summary: {
      chapter_id: payload.chapter_id,
      total_entries: totalEntries,
      reviewed_entries: reviewedEntries,
      unreviewed_entries: totalEntries - reviewedEntries,
      open_review_entries: openReviewEntries,
      low_confidence_entries: lowConfidenceEntries,
      flagged_entries: flaggedEntries,
      merge_candidate_entries: mergeCandidateEntries,
      review_completion_ratio: ratio(reviewedEntries, totalEntries),
      status_counts: statusCounts,
      concept_type_counts: typeCounts,
    },
    queue,
  };
}

function reviewQueueItem(concept, mergeGroups) {
  const status = concept.review_status || 'unreviewed';
  const flags = Array.isArray(concept.review_flags) ? concept.review_flags : [];
  const confidence = Number(concept.confidence || 0);
  const reasons = [];
  let score = 0;

  if (status === 'unreviewed') {
    reasons.push('unreviewed');
    score += 60;
  }
  if (status === 'ambiguous' || status === 'needs_revision') {
    reasons.push(status);
    score += 80;
  }
  if (confidence < 0.72) {
    reasons.push('low_confidence');
    score += Math.round((0.72 - confidence) * 100) + 25;
  }
  if (flags.length) {
    reasons.push('flagged');
    score += 25 + Math.min(flags.length * 5, 20);
  }
  if (mergeGroups.length) {
    reasons.push('merge_candidate');
    score += 30 + Math.min(mergeGroups.length * 5, 25);
  }
  if (concept.role === 'defined') score += 8;

  if (!reasons.length) return null;

  return {
    stable_key: stableKeyFor(concept),
    priority_score: score,
    reasons,
    chapter_id: concept.chapter_id,
    formula_id: concept.formula_id,
    formula_label: concept.formula_label,
    symbol: concept.symbol,
    role: concept.role,
    concept_id: concept.concept_id,
    concept_name: concept.concept_name,
    concept_type: concept.concept_type,
    confidence,
    review_status: status,
    review_flags: flags,
    merge_candidate_group_ids: mergeGroups.map((group) => group.group_id),
    canonical_candidate_names: unique(mergeGroups.map((group) => group.canonical_concept_name)),
  };
}

function summarizeChapters(chapters, mergeCandidates, queueSize) {
  const statusCounts = {};
  const typeCounts = {};
  for (const chapter of chapters) {
    mergeCounts(statusCounts, chapter.status_counts);
    mergeCounts(typeCounts, chapter.concept_type_counts);
  }
  const totalEntries = sum(chapters, 'total_entries');
  const reviewedEntries = sum(chapters, 'reviewed_entries');
  const openReviewEntries = sum(chapters, 'open_review_entries');

  return {
    chapters: chapters.length,
    total_entries: totalEntries,
    reviewed_entries: reviewedEntries,
    unreviewed_entries: sum(chapters, 'unreviewed_entries'),
    open_review_entries: openReviewEntries,
    low_confidence_entries: sum(chapters, 'low_confidence_entries'),
    flagged_entries: sum(chapters, 'flagged_entries'),
    merge_candidate_entries: sum(chapters, 'merge_candidate_entries'),
    merge_candidate_groups: mergeCandidates?.summary?.candidate_groups || 0,
    merge_candidate_members: mergeCandidates?.summary?.candidate_members || 0,
    review_completion_ratio: ratio(reviewedEntries, totalEntries),
    open_review_ratio: ratio(openReviewEntries, totalEntries),
    review_queue_entries: queueSize,
    status_counts: statusCounts,
    concept_type_counts: typeCounts,
  };
}

function completionGate(summary) {
  const blockers = [];
  if (summary.unreviewed_entries > 0) blockers.push(`${summary.unreviewed_entries} unreviewed entries`);
  const unresolvedEntries = (summary.status_counts.ambiguous || 0) + (summary.status_counts.needs_revision || 0);
  if (unresolvedEntries > 0) blockers.push(`${unresolvedEntries} ambiguous or needs_revision entries`);
  return {
    passed: blockers.length === 0,
    required_review_statuses: ['approved', 'edited', 'rejected', 'reviewed'],
    blockers,
  };
}

function buildMergeLookup(mergeCandidates) {
  const lookup = new Map();
  if (!mergeCandidates?.chapters) return lookup;
  for (const chapter of Object.values(mergeCandidates.chapters)) {
    for (const group of chapter.groups || []) {
      for (const key of group.member_keys || []) {
        const groups = lookup.get(key) || [];
        groups.push({
          group_id: group.group_id,
          review_priority: group.review_priority,
          score: group.score,
          canonical_concept_name: group.canonical_candidate?.concept_name,
        });
        lookup.set(key, groups);
      }
    }
  }
  return lookup;
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function stableKeyFor(concept) {
  return [concept.chapter_id, concept.formula_id, concept.role, concept.symbol].join('::');
}

function sum(items, key) {
  return items.reduce((total, item) => total + Number(item[key] || 0), 0);
}

function mergeCounts(target, source) {
  for (const [key, value] of Object.entries(source || {})) {
    target[key] = (target[key] || 0) + Number(value || 0);
  }
}

function ratio(value, total) {
  return total ? Number((value / total).toFixed(4)) : 0;
}

function unique(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const next = String(value || '').trim();
    if (!next) continue;
    const key = next.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(next);
  }
  return result;
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--input-dir') options.inputDir = args[++index];
    else if (arg === '--output') options.output = args[++index];
    else if (arg === '--chapter') options.chapter = args[++index];
    else if (arg === '--limit') options.limit = Number(args[++index]);
    else if (arg === '--fail-on-open') options.failOnOpen = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (options.help) {
    printHelp();
    process.exit(0);
  }
  return options;
}

function finiteOrDefault(value, fallback) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function printSummary(report, outputPath) {
  const summary = report.summary;
  console.log(`Concept review audit -> ${relative(outputPath)}`);
  console.log(`  reviewed: ${summary.reviewed_entries}/${summary.total_entries}`);
  console.log(`  open review entries: ${summary.open_review_entries}`);
  console.log(`  low confidence: ${summary.low_confidence_entries}`);
  console.log(`  merge candidate members: ${summary.merge_candidate_members}`);
  console.log(`  completion gate: ${report.completion_gate.passed ? 'passed' : 'failed'}`);
  if (report.completion_gate.blockers.length) {
    console.log(`  blockers: ${report.completion_gate.blockers.join('; ')}`);
  }
}

function relative(targetPath) {
  return path.relative(ROOT, targetPath).replaceAll(path.sep, '/');
}

function utcNow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function printHelp() {
  console.log(`Concept review audit

Usage:
  node scripts/audit-concept-review.mjs
  node scripts/audit-concept-review.mjs --chapter chapter6 --limit 100
  node scripts/audit-concept-review.mjs --fail-on-open

The default command writes tmp/concept-review/concept_review_audit.json.
Use --fail-on-open as a completion gate after human review patches have been applied.
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
