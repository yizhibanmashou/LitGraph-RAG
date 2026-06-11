import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';

const execFileAsync = promisify(execFile);

test('audit-product-release passes clean product data and fails review leakage', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'product-release-audit-'));
  const publicDir = path.join(tempDir, 'public');
  const internalDir = path.join(tempDir, 'internal');
  const outputPath = path.join(tempDir, 'product_release_audit.json');
    await seedPublicData(publicDir, { leakReviewStatus: false, conceptName: 'Fitness' });
  await mkdir(internalDir, { recursive: true });

  try {
    await execFileAsync(process.execPath, [
      path.resolve('scripts/audit-product-release.mjs'),
      '--public-dir',
      publicDir,
      '--internal-dir',
      internalDir,
      '--output',
      outputPath,
    ]);
    const passedReport = JSON.parse(await readFile(outputPath, 'utf8'));
    assert.equal(passedReport.release_gate.passed, true);
    assert.deepEqual(passedReport.release_gate.blockers, []);
    assert.equal(passedReport.concept_graph.concept_views, 1);
    const mirroredReport = JSON.parse(await readFile(path.join(publicDir, 'product_release_audit.json'), 'utf8'));
    assert.equal(mirroredReport.release_gate.passed, true);
    assert.equal(mirroredReport.concept_graph.concept_views, 1);

    await execFileAsync(process.execPath, [
      path.resolve('scripts/audit-product-release.mjs'),
      '--public-dir',
      publicDir,
      '--internal-dir',
      internalDir,
      '--output',
      outputPath,
    ]);
    const noInternalReviewReport = JSON.parse(await readFile(outputPath, 'utf8'));
    assert.equal(noInternalReviewReport.release_gate.passed, true);
    assert.equal(noInternalReviewReport.internal_review, undefined);

    await seedPublicData(publicDir, {
      leakReviewStatus: true,
      conceptName: 'Count',
      definitionZh: 'Count 是由当前支撑公式引入的局部数学量。',
    });
    await assert.rejects(
      execFileAsync(process.execPath, [
        path.resolve('scripts/audit-product-release.mjs'),
        '--public-dir',
        publicDir,
        '--internal-dir',
        internalDir,
        '--output',
        outputPath,
      ]),
      (error: { code?: number }) => error.code === 1,
    );
    const failedReport = JSON.parse(await readFile(outputPath, 'utf8'));
    assert.equal(failedReport.release_gate.passed, false);
    assert.ok(failedReport.release_gate.blockers.some((item: string) => item.includes('Internal review key leaked')));
    assert.ok(failedReport.release_gate.blockers.some((item: string) => item.includes('Unsafe or generic public concept name')));
    assert.ok(failedReport.release_gate.blockers.some((item: string) => item.includes('Unsafe generated concept copy')));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

async function seedPublicData(
  publicDir: string,
  options: { leakReviewStatus: boolean; conceptName: string; definitionZh?: string },
) {
  const conceptDir = path.join(publicDir, 'concept_graph');
  await mkdir(conceptDir, { recursive: true });
  for (const file of [
    'chapter_navigator.json',
    'featured_formulas.json',
    'formula_learning_copy.json',
    'formula_search_index.json',
    'learning_paths.json',
    'llm_cache.json',
    'storylines.json',
  ]) {
    await writeJson(path.join(publicDir, file), {});
  }

  const conceptView = {
    chapter_id: 'chapter_test',
    concept_id: 'concept_chapter_test_formula_1_defined_w',
    name: options.conceptName,
    definition: `${options.conceptName} definition.`,
    definition_zh: options.definitionZh || `${options.conceptName} 概念解读。`,
    concept_type: 'quantity_concept',
    defined_by_formula_id: 'formula_1',
    defined_symbol: 'w',
    supporting_formula_label: 'Formula 1',
    supporting_formula_latex: 'w',
    confidence: 0.92,
    evidence: [],
    prerequisite_concepts: [],
    introduced_concepts: [],
    edges: [],
    ...(options.leakReviewStatus ? { review_status: 'approved' } : {}),
  };
  await writeJson(path.join(conceptDir, 'chapter_test_concept_graph.json'), {
    chapter_id: 'chapter_test',
    version: 1,
    generated_at: '2026-06-11T00:00:00.000Z',
    source: { method: 'test' },
    summary: {
      chapter_id: 'chapter_test',
      formulas_processed: 1,
      concept_views: 1,
      prerequisite_edges: 0,
      introduced_edges: 0,
      formula_edges_used: 0,
    },
    views: [conceptView],
  });
  await writeJson(path.join(conceptDir, 'concept_graph_index.json'), {
    version: 1,
    generated_at: '2026-06-11T00:00:00.000Z',
    chapters: [{
      chapter_id: 'chapter_test',
      file: 'chapter_test_concept_graph.json',
      formulas_processed: 1,
      concept_views: 1,
      prerequisite_edges: 0,
      introduced_edges: 0,
      formula_edges_used: 0,
    }],
    summary: {
      chapters: 1,
      formulas_processed: 1,
      concept_views: 1,
      prerequisite_edges: 0,
      introduced_edges: 0,
    },
  });
  await writeJson(path.join(conceptDir, 'concept_search_index.json'), {
    version: 1,
    generated_at: '2026-06-11T00:00:00.000Z',
    items: [{
      resultType: 'concept',
      id: 'concept:concept_chapter_test_formula_1_defined_w',
      concept_id: 'concept_chapter_test_formula_1_defined_w',
      chapter_id: 'chapter_test',
      formula_id: 'formula_1',
      title: options.conceptName,
      context: `${options.conceptName} definition.`,
      symbol: 'w',
      formula_label: 'Formula 1',
      aliases: [options.conceptName],
    }],
  });
}

async function writeJson(filePath: string, payload: unknown) {
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}
