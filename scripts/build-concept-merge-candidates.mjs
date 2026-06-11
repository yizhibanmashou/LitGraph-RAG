#!/usr/bin/env node

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const DEFAULT_INPUT_DIR = path.resolve(ROOT, 'tmp/concept-review');
const DEFAULT_OUTPUT_PATH = path.resolve(DEFAULT_INPUT_DIR, 'concept_merge_candidates.json');
const SYMBOL_CONCEPT_MAP_SUFFIX = '_symbol_concept_map.json';

const DEFAULT_SIMILARITY_THRESHOLD = 0.82;
const DEFAULT_EMBEDDING_THRESHOLD = 0.88;

const STOP_TOKENS = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'by',
  'for',
  'from',
  'in',
  'into',
  'of',
  'on',
  'or',
  'per',
  'the',
  'to',
  'with',
]);

const TOKEN_SYNONYMS = new Map([
  ['average', 'mean'],
  ['averaged', 'mean'],
  ['expectation', 'expected'],
  ['expected', 'expected'],
  ['frequency', 'freq'],
  ['frequencies', 'freq'],
  ['probability', 'prob'],
  ['probabilities', 'prob'],
  ['parameter', 'param'],
  ['parameters', 'param'],
  ['coefficient', 'coef'],
  ['coefficients', 'coef'],
  ['estimate', 'estimator'],
  ['estimated', 'estimator'],
  ['estimation', 'estimator'],
]);

const GENERIC_NAMES = new Set([
  'coefficient',
  'count',
  'function',
  'index',
  'mean',
  'parameter',
  'probability',
  'rate',
  'time',
  'value',
  'variable',
  'variance',
]);

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const inputDir = path.resolve(ROOT, options.inputDir || DEFAULT_INPUT_DIR);
  const outputPath = path.resolve(ROOT, options.output || DEFAULT_OUTPUT_PATH);
  const lexicalThreshold = finiteOrDefault(options.similarityThreshold, DEFAULT_SIMILARITY_THRESHOLD);
  const embeddingThreshold = finiteOrDefault(options.embeddingThreshold, DEFAULT_EMBEDDING_THRESHOLD);
  const embeddingById = options.embeddingFile ? await readEmbeddings(path.resolve(ROOT, options.embeddingFile)) : new Map();

  const files = (await readdir(inputDir))
    .filter((file) => file.endsWith(SYMBOL_CONCEPT_MAP_SUFFIX))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' }));

  const chapters = {};
  let totalGroups = 0;
  let totalMembers = 0;

  for (const file of files) {
    const payload = JSON.parse(await readFile(path.join(inputDir, file), 'utf8'));
    const chapter = buildChapterCandidates(payload, {
      lexicalThreshold,
      embeddingThreshold,
      embeddingById,
    });
    chapters[payload.chapter_id] = chapter;
    totalGroups += chapter.summary.candidate_groups;
    totalMembers += chapter.summary.candidate_members;
  }

  const output = {
    version: 1,
    generated_at: utcNow(),
    source: {
      symbol_concept_maps: `${relative(inputDir)}/*_symbol_concept_map.json`,
      method: 'lexical, synonym, alias, and optional embedding similarity over reviewable symbol-concept maps',
      embedding_file: options.embeddingFile || null,
      lexical_similarity_threshold: lexicalThreshold,
      embedding_similarity_threshold: embeddingThreshold,
    },
    summary: {
      chapters: files.length,
      candidate_groups: totalGroups,
      candidate_members: totalMembers,
      embedding_status: options.embeddingFile ? 'provided' : 'not_provided',
    },
    chapters,
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(`Generated ${totalGroups} concept merge candidate groups -> ${relative(outputPath)}`);
}

function buildChapterCandidates(payload, options) {
  const concepts = (payload.symbol_concepts || [])
    .filter((concept) => concept.review_status !== 'rejected')
    .map((concept, index) => summarizeConcept(concept, index, options.embeddingById));

  const unionFind = new UnionFind(concepts.length);
  const edges = [];
  const connect = (left, right, reason, score) => {
    if (left === right) return;
    unionFind.union(left, right);
    edges.push({ left, right, reason, score });
  };

  connectByKey(concepts, (concept) => concept.normalized_name, 'exact_normalized_name', 1, connect);
  connectByKey(concepts, (concept) => concept.synonym_name, 'synonym_normalized_name', 0.96, connect);
  connectByAlias(concepts, connect);
  connectByLexicalSimilarity(concepts, options.lexicalThreshold, connect);
  connectByEmbeddingSimilarity(concepts, options.embeddingThreshold, connect);

  const groupsByRoot = new Map();
  for (const concept of concepts) {
    const root = unionFind.find(concept.index);
    const group = groupsByRoot.get(root) || [];
    group.push(concept);
    groupsByRoot.set(root, group);
  }

  const candidateGroups = [...groupsByRoot.values()]
    .filter((members) => members.length > 1)
    .map((members) => buildCandidateGroup(payload.chapter_id, members, edges, unionFind))
    .filter(Boolean)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.canonical_candidate.concept_name.localeCompare(right.canonical_candidate.concept_name);
    })
    .map((group, index) => ({
      ...group,
      group_id: `${payload.chapter_id}_merge_${String(index + 1).padStart(4, '0')}`,
    }));

  return {
    chapter_id: payload.chapter_id,
    summary: {
      symbol_concept_entries: concepts.length,
      candidate_groups: candidateGroups.length,
      candidate_members: candidateGroups.reduce((sum, group) => sum + group.members.length, 0),
    },
    groups: candidateGroups,
  };
}

function connectByKey(concepts, keyFor, reason, score, connect) {
  const byKey = new Map();
  for (const concept of concepts) {
    const key = keyFor(concept);
    if (!isUsefulKey(key)) continue;
    const group = byKey.get(key) || [];
    group.push(concept.index);
    byKey.set(key, group);
  }

  for (const indexes of byKey.values()) {
    if (indexes.length < 2) continue;
    for (let index = 1; index < indexes.length; index += 1) {
      connect(indexes[0], indexes[index], reason, score);
    }
  }
}

function connectByAlias(concepts, connect) {
  const byAlias = new Map();
  for (const concept of concepts) {
    for (const alias of concept.alias_keys) {
      if (!isUsefulKey(alias)) continue;
      const group = byAlias.get(alias) || [];
      group.push(concept.index);
      byAlias.set(alias, group);
    }
  }

  for (const indexes of byAlias.values()) {
    if (indexes.length < 2) continue;
    for (let index = 1; index < indexes.length; index += 1) {
      connect(indexes[0], indexes[index], 'alias_overlap', 0.94);
    }
  }
}

function connectByLexicalSimilarity(concepts, threshold, connect) {
  const byName = new Map();
  for (const concept of concepts) {
    if (!isUsefulKey(concept.normalized_name)) continue;
    const group = byName.get(concept.normalized_name) || [];
    group.push(concept.index);
    byName.set(concept.normalized_name, group);
  }

  const names = [...byName.keys()].map((name) => ({
    name,
    synonymName: synonymizeName(name),
    index: byName.get(name)[0],
  }));

  for (let left = 0; left < names.length; left += 1) {
    for (let right = left + 1; right < names.length; right += 1) {
      const score = Math.max(
        lexicalSimilarity(names[left].name, names[right].name),
        lexicalSimilarity(names[left].synonymName, names[right].synonymName),
      );
      if (score >= threshold) {
        connect(names[left].index, names[right].index, 'lexical_similarity', score);
      }
    }
  }
}

function connectByEmbeddingSimilarity(concepts, threshold, connect) {
  const withEmbeddings = concepts.filter((concept) => Array.isArray(concept.embedding));
  for (let left = 0; left < withEmbeddings.length; left += 1) {
    for (let right = left + 1; right < withEmbeddings.length; right += 1) {
      const score = cosineSimilarity(withEmbeddings[left].embedding, withEmbeddings[right].embedding);
      if (score >= threshold) {
        connect(withEmbeddings[left].index, withEmbeddings[right].index, 'embedding_similarity', score);
      }
    }
  }
}

function buildCandidateGroup(chapterId, members, edges, unionFind) {
  const roots = new Set(members.map((member) => unionFind.find(member.index)));
  const groupEdges = edges.filter((edge) => roots.has(unionFind.find(edge.left)) && roots.has(unionFind.find(edge.right)));
  const reasons = [...new Set(groupEdges.map((edge) => edge.reason))].sort();
  const score = groupEdges.length ? Math.max(...groupEdges.map((edge) => edge.score)) : 0;
  const sortedMembers = [...members].sort((left, right) => candidateRank(right) - candidateRank(left));
  const canonical = sortedMembers[0];

  if (!canonical) return null;

  return {
    group_id: '',
    chapter_id: chapterId,
    reasons,
    score: Number(score.toFixed(3)),
    review_priority: reviewPriority(sortedMembers, reasons, score),
    canonical_candidate: canonicalCandidate(canonical),
    member_keys: sortedMembers.map((member) => member.stable_key),
    embedding_status: sortedMembers.some((member) => Array.isArray(member.embedding)) ? 'provided' : 'not_provided',
    members: sortedMembers.map(memberForOutput),
  };
}

function summarizeConcept(concept, index, embeddingById) {
  const stableKey = stableKeyFor(concept);
  const normalizedName = normalizeName(concept.concept_name);
  const aliasKeys = unique([
    ...(concept.aliases || []),
    concept.concept_name,
  ].map(normalizeName)).filter((alias) => alias && alias !== normalizedName);
  const embeddingId = `${concept.chapter_id}::${concept.concept_id}`;

  return {
    index,
    stable_key: stableKey,
    embedding_id: embeddingId,
    chapter_id: concept.chapter_id,
    formula_id: concept.formula_id,
    formula_label: concept.formula_label,
    symbol: concept.symbol,
    role: concept.role,
    concept_id: concept.concept_id,
    concept_name: concept.concept_name,
    concept_type: concept.concept_type,
    definition: concept.definition || '',
    definition_zh: concept.definition_zh || '',
    aliases: concept.aliases || [],
    confidence: Number(concept.confidence || 0),
    review_status: concept.review_status || 'unreviewed',
    review_flags: concept.review_flags || [],
    normalized_name: normalizedName,
    synonym_name: synonymizeName(normalizedName),
    alias_keys: aliasKeys,
    embedding_text: embeddingText(concept),
    embedding: embeddingById.get(embeddingId) || embeddingById.get(stableKey),
  };
}

function canonicalCandidate(concept) {
  return {
    stable_key: concept.stable_key,
    concept_id: concept.concept_id,
    concept_name: concept.concept_name,
    concept_type: concept.concept_type,
    definition: concept.definition,
    definition_zh: concept.definition_zh,
    confidence: concept.confidence,
    review_status: concept.review_status,
  };
}

function memberForOutput(concept) {
  return {
    stable_key: concept.stable_key,
    concept_id: concept.concept_id,
    concept_name: concept.concept_name,
    concept_type: concept.concept_type,
    formula_id: concept.formula_id,
    formula_label: concept.formula_label,
    symbol: concept.symbol,
    role: concept.role,
    confidence: concept.confidence,
    review_status: concept.review_status,
    review_flags: concept.review_flags,
  };
}

function candidateRank(concept) {
  const statusBonus = ['approved', 'reviewed'].includes(concept.review_status)
    ? 0.2
    : concept.review_status === 'edited'
      ? 0.12
      : 0;
  const roleBonus = concept.role === 'defined' ? 0.04 : 0;
  const flagPenalty = Math.min(0.16, concept.review_flags.length * 0.04);
  const genericPenalty = GENERIC_NAMES.has(concept.normalized_name) ? 0.08 : 0;
  const definitionBonus = concept.definition ? 0.03 : 0;
  return concept.confidence + statusBonus + roleBonus + definitionBonus - flagPenalty - genericPenalty;
}

function reviewPriority(members, reasons, score) {
  if (reasons.includes('embedding_similarity') && score >= 0.92) return 'high';
  if (reasons.includes('exact_normalized_name') || reasons.includes('alias_overlap')) return 'high';
  if (members.some((member) => member.confidence < 0.72 || member.review_flags.length)) return 'medium';
  return 'low';
}

function normalizeName(value) {
  const tokens = String(value || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/\\[a-z]+/g, ' ')
    .replace(/[_^{}()[\],.;:/|+=*'"`~!?<>-]+/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .map((token) => singularize(token.trim()))
    .filter((token) => token && !STOP_TOKENS.has(token));
  return tokens.join(' ');
}

function synonymizeName(normalizedName) {
  return normalizedName
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => TOKEN_SYNONYMS.get(token) || token)
    .join(' ');
}

function singularize(token) {
  if (token.length > 4 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

function isUsefulKey(key) {
  if (!key || key.length < 4) return false;
  const tokens = key.split(/\s+/).filter(Boolean);
  if (!tokens.length) return false;
  if (tokens.length === 1 && GENERIC_NAMES.has(tokens[0])) return true;
  return tokens.some((token) => token.length > 3);
}

function lexicalSimilarity(left, right) {
  if (!left || !right) return 0;
  if (left === right) return 1;
  const leftTokens = left.split(/\s+/).filter(Boolean);
  const rightTokens = right.split(/\s+/).filter(Boolean);
  const subset = subsetScore(leftTokens, rightTokens);
  const jaccard = jaccardSimilarity(leftTokens, rightTokens);
  const dice = diceCoefficient(left, right);
  return Math.max(subset, jaccard, dice);
}

function subsetScore(leftTokens, rightTokens) {
  const shorter = leftTokens.length <= rightTokens.length ? leftTokens : rightTokens;
  const longer = leftTokens.length <= rightTokens.length ? rightTokens : leftTokens;
  if (shorter.length < 2) return 0;
  const longerSet = new Set(longer);
  if (!shorter.every((token) => longerSet.has(token))) return 0;
  return Math.max(0.82, 0.93 - (longer.length - shorter.length) * 0.03);
}

function jaccardSimilarity(leftTokens, rightTokens) {
  const left = new Set(leftTokens);
  const right = new Set(rightTokens);
  const intersection = [...left].filter((token) => right.has(token)).length;
  const union = new Set([...left, ...right]).size;
  return union ? intersection / union : 0;
}

function diceCoefficient(left, right) {
  const leftGrams = bigrams(left);
  const rightGrams = bigrams(right);
  if (!leftGrams.length || !rightGrams.length) return 0;
  const rightCounts = new Map();
  for (const gram of rightGrams) rightCounts.set(gram, (rightCounts.get(gram) || 0) + 1);
  let overlap = 0;
  for (const gram of leftGrams) {
    const count = rightCounts.get(gram) || 0;
    if (!count) continue;
    overlap += 1;
    rightCounts.set(gram, count - 1);
  }
  return (2 * overlap) / (leftGrams.length + rightGrams.length);
}

function bigrams(value) {
  const compact = value.replace(/\s+/g, ' ');
  const grams = [];
  for (let index = 0; index < compact.length - 1; index += 1) {
    grams.push(compact.slice(index, index + 2));
  }
  return grams;
}

function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length || !left.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const l = Number(left[index]);
    const r = Number(right[index]);
    if (!Number.isFinite(l) || !Number.isFinite(r)) return 0;
    dot += l * r;
    leftNorm += l * l;
    rightNorm += r * r;
  }
  return leftNorm && rightNorm ? dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm)) : 0;
}

async function readEmbeddings(filePath) {
  const text = await readFile(filePath, 'utf8');
  const records = filePath.endsWith('.jsonl')
    ? text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
    : normalizeEmbeddingJson(JSON.parse(text));
  const embeddings = new Map();
  for (const record of records) {
    const id = record.id || record.embedding_id || record.stable_key;
    const embedding = record.embedding || record.vector;
    if (typeof id === 'string' && Array.isArray(embedding)) {
      embeddings.set(id, embedding.map(Number));
    }
  }
  return embeddings;
}

function normalizeEmbeddingJson(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value.items)) return value.items;
  if (Array.isArray(value.data)) return value.data;
  return [];
}

function embeddingText(concept) {
  return unique([
    concept.concept_name,
    concept.concept_type,
    concept.definition,
    concept.definition_zh,
    ...(concept.aliases || []),
  ]).join(' | ');
}

function stableKeyFor(concept) {
  return [concept.chapter_id, concept.formula_id, concept.role, concept.symbol].join('::');
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

function finiteOrDefault(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--input-dir') options.inputDir = args[++index];
    else if (arg === '--output') options.output = args[++index];
    else if (arg === '--embedding-file') options.embeddingFile = args[++index];
    else if (arg === '--similarity-threshold') options.similarityThreshold = Number(args[++index]);
    else if (arg === '--embedding-threshold') options.embeddingThreshold = Number(args[++index]);
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (options.help) {
    printHelp();
    process.exit(0);
  }
  return options;
}

function relative(targetPath) {
  return path.relative(ROOT, targetPath).replaceAll(path.sep, '/');
}

function utcNow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function printHelp() {
  console.log(`Concept merge candidate builder

Usage:
  node scripts/build-concept-merge-candidates.mjs
  node scripts/build-concept-merge-candidates.mjs --embedding-file tmp/concept-review/concept_embeddings.jsonl

The embedding file is optional. Records can use either:
  { "id": "chapter6::concept_id", "embedding": [...] }
  { "stable_key": "chapter6::formula::role::symbol", "embedding": [...] }
`);
}

class UnionFind {
  constructor(size) {
    this.parent = Array.from({ length: size }, (_, index) => index);
    this.rank = Array.from({ length: size }, () => 0);
  }

  find(value) {
    if (this.parent[value] !== value) {
      this.parent[value] = this.find(this.parent[value]);
    }
    return this.parent[value];
  }

  union(left, right) {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot === rightRoot) return;
    if (this.rank[leftRoot] < this.rank[rightRoot]) {
      this.parent[leftRoot] = rightRoot;
    } else if (this.rank[leftRoot] > this.rank[rightRoot]) {
      this.parent[rightRoot] = leftRoot;
    } else {
      this.parent[rightRoot] = leftRoot;
      this.rank[leftRoot] += 1;
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
