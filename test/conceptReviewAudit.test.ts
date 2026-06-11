import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';

const execFileAsync = promisify(execFile);

test('audit-concept-review reports open review work and can fail the gate', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'concept-review-audit-'));
  const inputDir = path.join(tempDir, 'input');
  const outputPath = path.join(tempDir, 'concept_review_audit.json');
  await mkdir(inputDir, { recursive: true });
  await writeFile(
    path.join(inputDir, 'chapter_test_symbol_concept_map.json'),
    JSON.stringify({
      chapter_id: 'chapter_test',
      symbol_concepts: [
        concept('formula_1', 'defined', 'S', 'Selection Differential', 0.92, 'approved', []),
        concept('formula_2', 'used', 'w', 'Fitness', 0.61, 'unreviewed', ['needs_review']),
        concept('formula_3', 'used', 'z', 'Trait Value', 0.88, 'ambiguous', ['ambiguous']),
      ],
    }),
    'utf8',
  );
  await writeFile(
    path.join(inputDir, 'concept_merge_candidates.json'),
    JSON.stringify({
      summary: { candidate_groups: 1, candidate_members: 2 },
      chapters: {
        chapter_test: {
          groups: [
            {
              group_id: 'chapter_test_merge_0001',
              member_keys: ['chapter_test::formula_2::used::w'],
              canonical_candidate: { concept_name: 'Fitness' },
            },
          ],
        },
      },
    }),
    'utf8',
  );

  try {
    await execFileAsync(process.execPath, [
      path.resolve('scripts/audit-concept-review.mjs'),
      '--input-dir',
      inputDir,
      '--output',
      outputPath,
    ]);
    const report = JSON.parse(await readFile(outputPath, 'utf8'));
    assert.equal(report.summary.total_entries, 3);
    assert.equal(report.summary.reviewed_entries, 2);
    assert.equal(report.summary.open_review_entries, 2);
    assert.equal(report.completion_gate.passed, false);
    assert.match(report.completion_gate.blockers.join('\n'), /1 unreviewed entries/);
    assert.ok(report.review_queue.some((item: { review_status: string }) => item.review_status === 'ambiguous'));
    assert.ok(report.review_queue.some((item: { reasons: string[] }) => item.reasons.includes('merge_candidate')));

    await assert.rejects(
      execFileAsync(process.execPath, [
        path.resolve('scripts/audit-concept-review.mjs'),
        '--input-dir',
        inputDir,
        '--output',
        outputPath,
        '--fail-on-open',
      ]),
      (error: { code?: number }) => error.code === 1,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

function concept(
  formulaId: string,
  role: 'defined' | 'used',
  symbol: string,
  conceptName: string,
  confidence: number,
  reviewStatus: string,
  reviewFlags: string[],
) {
  return {
    chapter_id: 'chapter_test',
    formula_id: formulaId,
    formula_label: formulaId.replace('_', ' '),
    symbol,
    role,
    concept_id: `concept_${formulaId}_${role}`,
    concept_name: conceptName,
    concept_type: 'quantity_concept',
    definition: `${conceptName} definition.`,
    aliases: [],
    evidence: [],
    confidence,
    review_status: reviewStatus,
    review_flags: reviewFlags,
    extraction_model: 'test',
  };
}
