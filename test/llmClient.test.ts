import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  __llmClientTestUtils,
  buildFormulaNotesChatRequest,
  buildStorylineNarrativeChatRequest,
  buildVariableDetailsChatRequest,
  generateFormulaNotes,
} from '../src/services/llmClient.ts';

test('formula notes request uses chat-completions JSON contract', () => {
  const request = buildFormulaNotesChatRequest({
    formulaId: 'formula_2.1',
    latex: 'P_{ij}=...',
    context: 'Wright-Fisher transition probability.',
    section: 'Neutral evolution',
    prerequisites: [{ type: 'variable_definition', symbol: 'N', definition: 'population size', confidence: 0.9 }],
    language: 'zh',
  });

  assert.equal(request.model, 'deepseek-chat');
  assert.equal(request.response_format.type, 'json_object');
  assert.equal(request.messages[0].role, 'system');
  assert.match(request.messages[0].content, /只返回 JSON/);
  const payload = JSON.parse(request.messages[1].content);
  assert.equal(payload.task, 'formula_notes');
  assert.equal(payload.formula_id, 'formula_2.1');
  assert.match(payload.accepted_prerequisites, /symbol=N/);
});

test('variable details request carries the current formula and symbol', () => {
  const request = buildVariableDetailsChatRequest({
    formulaId: 'formula_6.5a',
    latex: '\\sum_i \\Delta q_i z_i',
    context: 'Price equation context',
    symbol: 'z_i',
    prerequisite: { type: 'variable_definition', symbol: 'z_i', meaning: 'trait value', confidence: 0.8 },
    language: 'zh',
  });
  const payload = JSON.parse(request.messages[1].content);

  assert.equal(payload.task, 'variable_details');
  assert.equal(payload.formula_id, 'formula_6.5a');
  assert.equal(payload.context, 'Price equation context');
  assert.equal(payload.symbol, 'z_i');
  assert.equal(payload.prerequisite.meaning, 'trait value');
  assert.match(payload.output_schema.shortLabel, /4-16/);
});

test('variable details parser accepts shortLabel and text', async () => {
  const result = await __llmClientTestUtils.postChatCompletion(
    buildVariableDetailsChatRequest({
      formulaId: 'formula_3.1',
      latex: 'N_e = N/(1+\\sigma_w^2)',
      context: 'Selection reduces Ne.',
      symbol: 'N_e',
      language: 'zh',
    }),
    __llmClientTestUtils.validateVariableDetails,
    async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '{"shortLabel":"有效种群大小","text":"N_e 表示经漂变与选择修正后的有效繁殖群体大小。"}',
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
  );

  assert.equal(result.shortLabel, '有效种群大小');
  assert.match(result.text, /有效繁殖群体大小/);
});

test('storyline narrative request defaults to Chinese formula-grounded narrative', () => {
  const request = buildStorylineNarrativeChatRequest({
    storyline: {
      id: 'allele-frequency',
      title_en: 'Allele frequency',
      title_zh: '等位基因频率',
      symbol: 'p',
      intro_en: 'Follow p.',
      intro_zh: '跟着 p 读。',
      steps: [],
    },
    selectedStep: { formula_id: 'formula_2.1', title: 'Formula 2.1', transition_en: '', transition_zh: '', support_formula_ids: [] },
    previousStep: null,
    nextStep: null,
    formula: { id: 'formula_2.1', latex: 'p', context: 'context', section: 'section', label: 'Formula 2.1' },
    formulaCopy: { plainMeaning: '含义', inThisChapter: '作用' },
    language: 'zh',
  });
  const payload = JSON.parse(request.messages[1].content);

  assert.equal(payload.task, 'storyline_narrative');
  assert.equal(payload.language, 'zh');
  assert.equal(payload.storyline.title, '等位基因频率');
  assert.match(request.messages[0].content, /不要编造教材外剧情/);
});

test('chat-completions parser extracts JSON content', async () => {
  const result = await __llmClientTestUtils.postChatCompletion(
    buildFormulaNotesChatRequest({
      formulaId: 'formula_2.1',
      latex: 'p',
      context: '',
      language: 'zh',
    }),
    __llmClientTestUtils.validateFormulaNotes,
    async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"plainMeaning":"一个含义","inThisChapter":"一个作用"}' } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
  );

  assert.deepEqual(result, { plainMeaning: '一个含义', inThisChapter: '一个作用' });
});

test('chat-completions parser rejects non-JSON content', async () => {
  await assert.rejects(
    __llmClientTestUtils.postChatCompletion(
      buildFormulaNotesChatRequest({
        formulaId: 'formula_2.1',
        latex: 'p',
        context: '',
        language: 'zh',
      }),
      __llmClientTestUtils.validateFormulaNotes,
      async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: 'plain text only' } }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    ),
    /did not contain JSON/,
  );
});

test('chat-completions request times out with a learner-safe error', async () => {
  await assert.rejects(
    __llmClientTestUtils.postChatCompletion(
      buildFormulaNotesChatRequest({
        formulaId: 'formula_2.1',
        latex: 'p',
        context: '',
        language: 'zh',
      }),
      __llmClientTestUtils.validateFormulaNotes,
      async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
      1,
    ),
    /timed out/,
  );
});

test('chat-completions request surfaces proxy JSON errors', async () => {
  await assert.rejects(
    __llmClientTestUtils.postChatCompletion(
      buildFormulaNotesChatRequest({
        formulaId: 'formula_2.1',
        latex: 'p',
        context: '',
        language: 'zh',
      }),
      __llmClientTestUtils.validateFormulaNotes,
      async () =>
        new Response(JSON.stringify({ error: 'LLM proxy is not configured.' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
    ),
    /proxy is not configured/,
  );
});

test('public LLM methods dedupe repeated requests by formula and language', async () => {
  __llmClientTestUtils.requestCache.clear();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: '{"plainMeaning":"去重含义","inThisChapter":"去重作用"}' } }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as typeof fetch;

  try {
    const input = {
      formulaId: 'formula_2.1',
      latex: 'p',
      context: '',
      language: 'zh' as const,
    };
    const [first, second] = await Promise.all([generateFormulaNotes(input), generateFormulaNotes(input)]);
    assert.equal(calls, 1);
    assert.equal(first.plainMeaning, '去重含义');
    assert.deepEqual(first, second);
  } finally {
    globalThis.fetch = originalFetch;
    __llmClientTestUtils.requestCache.clear();
  }
});
