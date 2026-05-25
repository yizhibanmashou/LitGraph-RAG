import type { FormulaPrerequisite, StorylineEntry, StorylineStep } from '../types/formula';
import type { LanguageCode } from '../types/learning';

const LLM_ENDPOINT = '/api/llm';
const DEFAULT_MODEL = 'deepseek-chat';
const DEFAULT_TIMEOUT_MS = 12000;
const requestCache = new Map<string, Promise<unknown>>();

export interface FormulaNoteRequest {
  formulaId: string;
  latex: string;
  context: string;
  section?: string;
  prerequisites?: FormulaPrerequisite[];
  language: LanguageCode;
}

export interface FormulaNoteResponse {
  plainMeaning: string;
  inThisChapter: string;
}

export interface VariableDetailRequest {
  formulaId: string;
  latex: string;
  context?: string;
  symbol: string;
  prerequisite?: FormulaPrerequisite;
  language: LanguageCode;
}

export interface StorylineNarrativeRequest {
  storyline: StorylineEntry;
  selectedStep: StorylineStep;
  previousStep?: StorylineStep | null;
  nextStep?: StorylineStep | null;
  formula: {
    id: string;
    latex: string;
    context: string;
    section?: string;
    label?: string;
  };
  formulaCopy?: FormulaNoteResponse | null;
  language: LanguageCode;
}

export interface StorylineNarrativeResponse {
  role: string;
  transition: string;
  next: string;
}

interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature: number;
  response_format: { type: 'json_object' };
}

function prerequisiteSummary(prerequisites: FormulaPrerequisite[] = []): string {
  return prerequisites
    .slice(0, 12)
    .map((item) =>
      [
        item.type,
        item.target_id ? `target=${item.target_id}` : '',
        item.symbol ? `symbol=${item.symbol}` : '',
        item.via_symbol ? `via=${item.via_symbol}` : '',
        item.edge_evidence ? `evidence=${item.edge_evidence}` : '',
        item.meaning || item.definition || item.reason || item.source_excerpt || '',
      ]
        .filter(Boolean)
        .join('; '),
    )
    .join('\n');
}

export function buildFormulaNotesChatRequest(input: FormulaNoteRequest): ChatCompletionRequest {
  const zh = input.language === 'zh';
  return {
    model: DEFAULT_MODEL,
    temperature: 0.25,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          zh
            ? '你是一名严谨、具体、会带本科生读教材的科学助教。只返回 JSON，不要 Markdown。解释必须紧扣给定公式、章节、上下文和依赖关系；不要写“这个公式很重要”一类空话，不要编造教材外事实。'
            : 'You are a rigorous science teaching assistant. Return JSON only, no Markdown. Ground the explanation in the given formula, section, context, and accepted prerequisites; avoid generic filler and do not invent facts outside the evidence.',
      },
      {
        role: 'user',
        content: JSON.stringify(
          {
            task: 'formula_notes',
            language: input.language,
            output_schema: {
              plainMeaning: zh
                ? '用中文解释这个公式具体在计算/连接什么量，1-2 句；必须点名公式中的关键符号。'
                : 'Explain what the formula specifically computes or connects in 1-2 sentences; name the key symbols.',
              inThisChapter: zh
                ? '结合章节上下文说明它为什么出现在这里、为后续推导铺垫什么，1-2 句。'
                : 'Explain why it appears in this section and what later argument it supports in 1-2 sentences.',
            },
            formula_id: input.formulaId,
            latex: input.latex,
            section: input.section || '',
            context: input.context || '',
            accepted_prerequisites: prerequisiteSummary(input.prerequisites),
          },
          null,
          2,
        ),
      },
    ],
  };
}

export function buildVariableDetailsChatRequest(input: VariableDetailRequest): ChatCompletionRequest {
  const zh = input.language === 'zh';
  return {
    model: DEFAULT_MODEL,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          zh
            ? '你解释数学公式里的变量和符号。只返回 JSON，不要 Markdown。解释必须贴合当前公式和给定上下文，说明这个符号在本式中承担什么角色；不要把同形符号强行说成同一个含义。'
            : 'Explain symbols in mathematical formulas. Return JSON only, no Markdown. Ground the explanation in this formula and context, and state the symbol role in this formula.',
      },
      {
        role: 'user',
        content: JSON.stringify(
          {
            task: 'variable_details',
            language: input.language,
            output_schema: {
              text: zh
                ? '解释这个符号在当前公式中的含义和作用，1-2 句；不要只复述符号名。'
                : 'Explain the symbol meaning and role in this formula in 1-2 sentences; do not merely restate the symbol name.',
            },
            formula_id: input.formulaId,
            latex: input.latex,
            context: input.context || '',
            symbol: input.symbol,
            prerequisite: input.prerequisite || null,
          },
          null,
          2,
        ),
      },
    ],
  };
}

export function buildStorylineNarrativeChatRequest(input: StorylineNarrativeRequest): ChatCompletionRequest {
  const zh = input.language === 'zh';
  return {
    model: DEFAULT_MODEL,
    temperature: 0.45,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          zh
            ? '你是一名会把教材公式串成学习线索的科学写作者。只返回 JSON，不要 Markdown。故事必须围绕公式、符号、前后步骤和教材上下文展开；避免“符号外形延续”“承担新任务”这类空泛模板句，不要编造教材外剧情。'
            : 'You write formula-grounded scientific learning narratives. Return JSON only, no Markdown. Ground the narrative in formulas, symbols, neighboring steps, and textbook context; avoid generic template phrases and do not invent facts.',
      },
      {
        role: 'user',
        content: JSON.stringify(
          {
            task: 'storyline_narrative',
            language: input.language,
            output_schema: {
              role: zh
                ? '当前公式在这条故事线里的具体角色，2-3 句；必须结合公式本身和故事线符号。'
                : 'The selected formula role in this storyline, 2-3 sentences; ground it in the formula and storyline symbol.',
              transition: zh
                ? '从上一个公式到当前公式，数学对象、模型语境或问题焦点发生了什么具体变化，2-3 句。'
                : 'Describe the concrete change in mathematical object, model context, or question focus from the previous step, 2-3 sentences.',
              next: zh
                ? '下一步为什么自然发生，1-2 句；要点名下一公式或下一问题。'
                : 'Explain why the next step follows naturally in 1-2 sentences; name the next formula or question.',
            },
            story_bridge_rules: zh
              ? [
                  'transition 和 next 会在界面合并为“故事串联”，因此两段必须前后连贯。',
                  'transition 必须说明上一公式留下什么问题，以及当前公式如何接住这个问题。',
                  'next 必须说明下一公式或下一问题为什么自然出现。',
                  '不要写“符号外形延续”“承担新任务”等模板句。',
                ]
              : [
                  'transition and next are displayed together as one story bridge, so they must read coherently.',
                  'transition must state what question the previous formula left and how the current formula takes it up.',
                  'next must explain why the next formula or next question naturally appears.',
                  'Avoid template phrases such as visual identity or new job.',
                ],
            storyline: {
              id: input.storyline.id,
              title: input.storyline.title_zh || input.storyline.title_en,
              symbol: input.storyline.symbol,
              intro: input.storyline.intro_zh || input.storyline.intro_en,
            },
            selected_step: input.selectedStep,
            previous_step: input.previousStep || null,
            next_step: input.nextStep || null,
            formula: input.formula,
            formula_copy: input.formulaCopy || null,
          },
          null,
          2,
        ),
      },
    ],
  };
}

function parseJsonObject(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('LLM response did not contain JSON.');
    return JSON.parse(match[0]);
  }
}

async function postChatCompletion<T>(
  request: ChatCompletionRequest,
  validate: (value: unknown) => T,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(LLM_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw new Error('LLM request timed out.');
    throw new Error('LLM request could not reach the proxy.');
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
  if (!response.ok) {
    let message = `LLM request failed with ${response.status}`;
    try {
      const errorPayload = await response.json();
      if (typeof errorPayload?.error === 'string') message = errorPayload.error;
    } catch {
      // Keep the status-based message when the proxy does not return JSON.
    }
    throw new Error(message);
  }
  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('LLM response did not include message content.');
  return validate(parseJsonObject(content));
}

function requireStringField(value: unknown, field: string): string {
  if (!value || typeof value !== 'object') throw new Error('LLM JSON response was not an object.');
  const fieldValue = (value as Record<string, unknown>)[field];
  if (typeof fieldValue !== 'string' || !fieldValue.trim()) throw new Error(`LLM JSON response missing ${field}.`);
  return fieldValue.trim();
}

function validateFormulaNotes(value: unknown): FormulaNoteResponse {
  return {
    plainMeaning: requireStringField(value, 'plainMeaning'),
    inThisChapter: requireStringField(value, 'inThisChapter'),
  };
}

function validateVariableDetails(value: unknown): { text: string } {
  return { text: requireStringField(value, 'text') };
}

function validateStorylineNarrative(value: unknown): StorylineNarrativeResponse {
  return {
    role: requireStringField(value, 'role'),
    transition: requireStringField(value, 'transition'),
    next: requireStringField(value, 'next'),
  };
}

export async function generateFormulaNotes(request: FormulaNoteRequest): Promise<FormulaNoteResponse> {
  return cachedRequest(`formula-notes:${request.formulaId}:${request.language}`, () =>
    postChatCompletion(buildFormulaNotesChatRequest(request), validateFormulaNotes),
  );
}

export async function generateVariableDetails(request: VariableDetailRequest): Promise<{ text: string }> {
  return cachedRequest(`variable-details:${request.formulaId}:${request.symbol}:${request.language}`, () =>
    postChatCompletion(buildVariableDetailsChatRequest(request), validateVariableDetails),
  );
}

export async function generateStorylineNarrative(request: StorylineNarrativeRequest): Promise<StorylineNarrativeResponse> {
  return cachedRequest(`storyline:${request.storyline.id}:${request.selectedStep.formula_id}:${request.language}`, () =>
    postChatCompletion(buildStorylineNarrativeChatRequest(request), validateStorylineNarrative),
  );
}

function cachedRequest<T>(key: string, factory: () => Promise<T>): Promise<T> {
  const existing = requestCache.get(key);
  if (existing) return existing as Promise<T>;
  const promise = factory().catch((error) => {
    requestCache.delete(key);
    throw error;
  });
  requestCache.set(key, promise);
  return promise;
}

export const __llmClientTestUtils = {
  postChatCompletion,
  validateFormulaNotes,
  validateVariableDetails,
  validateStorylineNarrative,
  requestCache,
  DEFAULT_TIMEOUT_MS,
};
