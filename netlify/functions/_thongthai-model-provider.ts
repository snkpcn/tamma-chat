import { aiCostPolicy, type AiUsage } from './_ai-cost-policy';
import { remainingTurnAnswerMs } from './_turn-writes';
import { CUSTOMER_RESPONSE_COMPLETION_RESERVE_MS } from './_customer-turn-budget';
import {
  AiBudgetBlockedError,
  finalizeAiCall,
  reserveAiCall,
  type AiCallContext,
  type AiCallReservation,
} from './_ai-cost-ledger';

// OpenAI-only model provider for Thongthai Human Conversation Recovery.
//
// Architecture contract:
// - OpenAI is the LANGUAGE SUPERVISOR. It interprets customer language into
//   structured semantic state.
// - It is NOT the source of mutable business truth and is NOT authorized to
//   execute bookings/orders/payments.
// - Normal semantic turns use GPT-5.6 Terra. GPT-5.6 Sol is reserved for
//   bounded semantic review when the primary interpretation is genuinely
//   uncertain or structurally inconsistent.
// - Gemini has no runtime path in this provider.

export type ChatTurn = { role: 'user' | 'assistant'; content: string };

export type ProviderAttemptOutcome =
  | 'success'
  | 'timeout'
  | 'rate_limited'
  | 'server_error'
  | 'network_error'
  | 'request_error'
  | 'not_configured';

export type ProviderAttemptDiagnostic = {
  provider: 'openai';
  model: string;
  outcome: ProviderAttemptOutcome;
  httpStatus?: number;
  elapsedMs: number;
};

export class ProviderNotConfiguredError extends Error {
  attempts: ProviderAttemptDiagnostic[];
  constructor(attempts: ProviderAttemptDiagnostic[] = []) {
    super('OPENAI_API_KEY is not set.');
    this.name = 'ProviderNotConfiguredError';
    this.attempts = attempts;
  }
}

export class LLMRequestError extends Error {
  attempts: ProviderAttemptDiagnostic[];
  constructor(message: string, attempts: ProviderAttemptDiagnostic[] = []) {
    super(message);
    this.name = 'LLMRequestError';
    this.attempts = attempts;
  }
}

export class LLMAvailabilityError extends LLMRequestError {
  constructor(message: string, attempts: ProviderAttemptDiagnostic[] = []) {
    super(message, attempts);
    this.name = 'LLMAvailabilityError';
  }
}

/** A call the cost guard refused BEFORE any request left the process.
 *
 *  Deliberately still an LLMAvailabilityError so every existing
 *  `instanceof LLMAvailabilityError` handler keeps behaving exactly as
 *  before. It only adds the structured reason, so a caller can tell
 *  "we ran out of budget" apart from "OpenAI timed out" without parsing an
 *  error message -- the two have completely different operator responses and
 *  must not share one log line. */
export class LLMBudgetBlockedError extends LLMAvailabilityError {
  budgetReason: string;
  constructor(budgetReason: string, attempts: ProviderAttemptDiagnostic[] = []) {
    super(`OpenAI blocked by cost guard: ${budgetReason}`, attempts);
    this.name = 'LLMBudgetBlockedError';
    this.budgetReason = budgetReason;
  }
}

export const OPENAI_SEMANTIC_PRIMARY_MODEL =
  process.env.THONGTHAI_SEMANTIC_MODEL?.trim() || 'gpt-5.6-terra';
export const OPENAI_SEMANTIC_REVIEW_MODEL =
  process.env.THONGTHAI_SEMANTIC_REVIEW_MODEL?.trim() || 'gpt-5.6-sol';

/** Model used to phrase ALREADY-VERIFIED facts in Thongthai's voice.
 *
 *  Defaults to the primary model rather than the review model. The composer
 *  reserves its worst case up front, and on the review model that worst case
 *  leaves no room for a second composed turn inside the 2 THB conversation
 *  ceiling. The primary model fits roughly twice as many composed turns per
 *  conversation at the same ceiling.
 *
 *  Read per call (not a module constant) so the rollback is a pure
 *  environment change: set THONGTHAI_RESPONSE_COMPOSER_MODEL=gpt-5.6-sol to
 *  restore the previous behavior without a deploy. */
export function responseComposerModel(): string {
  return process.env.THONGTHAI_RESPONSE_COMPOSER_MODEL?.trim() || OPENAI_SEMANTIC_PRIMARY_MODEL;
}

const TOTAL_PROVIDER_BUDGET_MS = 7_000;
const PER_ATTEMPT_CAP_MS = 6_000;
const SEMANTIC_CERT_TOTAL_PROVIDER_BUDGET_MS = 30_000;
const SEMANTIC_CERT_PER_ATTEMPT_CAP_MS = 25_000;
const MIN_ATTEMPT_BUDGET_MS = 1_000;

export function providerTimingPolicyForCaller(callerLabel: string): {
  totalBudgetMs: number;
  perAttemptCapMs: number;
} {
  if (callerLabel.startsWith('semantic-certification-')) {
    return {
      totalBudgetMs: SEMANTIC_CERT_TOTAL_PROVIDER_BUDGET_MS,
      perAttemptCapMs: SEMANTIC_CERT_PER_ATTEMPT_CAP_MS,
    };
  }
  // Web's required interpretation gets the available turn time first.
  // A fixed 6s cutoff discarded valid first interpretations before the
  // 22s parent deadline; optional phrasing now yields to completion instead.
  if (callerLabel === 'semantic-interpreter' && Number.isFinite(remainingTurnAnswerMs())) {
    return { totalBudgetMs:12_000, perAttemptCapMs:12_000 };
  }
  return {
    totalBudgetMs: TOTAL_PROVIDER_BUDGET_MS,
    perAttemptCapMs: PER_ATTEMPT_CAP_MS,
  };
}

export function isAvailabilityHttpStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function classifyHttpOutcome(status: number): ProviderAttemptOutcome {
  if (status === 429) return 'rate_limited';
  if (isAvailabilityHttpStatus(status)) return 'server_error';
  return 'request_error';
}

// Compatibility exports for older diagnostics/tests. Gemini is intentionally
// absent from runtime and these always report closed/no-op.
export function isGeminiCircuitOpen(): boolean { return false; }
export function resetGeminiCircuitForTests(): void {}

export function shouldFallbackToSecondaryProvider(error: unknown): boolean {
  return error instanceof LLMAvailabilityError || error instanceof ProviderNotConfiguredError;
}

function extractResponseText(data: {
  output_text?: string;
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
}): string {
  let text = data.output_text ?? '';
  if (!text) {
    for (const item of data.output ?? []) {
      for (const part of item.content ?? []) {
        if (part.type === 'output_text' && part.text) text += part.text;
      }
    }
  }
  return text;
}

export type ModelResponseSchema = {
  name: string;
  schema: Record<string, unknown>;
};

const SEMANTIC_SUPERVISOR_RESPONSE_SCHEMA: ModelResponseSchema = {
  name:'thongthai_semantic_supervisor',
  schema:{
    type:'object',
    properties:{
      normalizedMeaning:{type:'string',maxLength:360},
      speechAct:{type:'string',enum:['question','statement','preference_update','correction','selection','request','transaction_request','incident_report','complaint','request_help','social','unknown']},
      domain:{type:'string',enum:['ecosystem','restaurant','stay','activity','promotion','membership','otop','cafe','journey','payment','support','general','local','incident','unknown']},
      intent:{type:'string',maxLength:80},
      action:{type:'string',enum:['ask','discover','recommend','compare','book','order','modify','cancel','confirm','status','provide_information','correct_previous','unknown']},
      informationNeed:{type:'string',enum:['none','availability','price','schedule','inventory','catalog','recommendation','ingredients','policy','transaction_status']},
      taskDirective:{type:['string','null'],enum:['cancel_active','suspend_active','resume_suspended',null]},
      entities:{type:'object'},
      references:{
        type:'array',maxItems:10,
        items:{
          type:'object',
          properties:{
            type:{type:'string',maxLength:80},
            value:{type:['string','null'],maxLength:180},
            refersToPriorContext:{type:'boolean'},
          },
          required:['type','refersToPriorContext'],
        },
      },
      constraints:{type:'array',maxItems:12,items:{type:'string',maxLength:100}},
      confidence:{type:'number',minimum:0,maximum:1},
      needsClarification:{type:'boolean'},
      clarificationReason:{type:['string','null'],maxLength:180},
    },
    required:['domain','intent','action','entities','references','constraints','confidence','needsClarification'],
  },
};

// Grounded response composition (see _response-composer.ts's
// buildResponseComposerPrompt): a SEPARATE, much smaller output shape --
// only a customer-facing message plus which supplied fact keys it actually
// used. Never reuses the semantic supervisor's structured-understanding
// schema, which has nothing to do with this call's job.
export const RESPONSE_COMPOSER_MAX_OUTPUT_TOKENS = 900;

export const RESPONSE_COMPOSER_RESPONSE_SCHEMA: ModelResponseSchema = {
  name:'thongthai_response_composer',
  schema:{
    type:'object',
    properties:{
      message:{type:'string',maxLength:4000},
      usedFactKeys:{type:'array',maxItems:100,items:{type:'string',maxLength:200}},
    },
    required:['message','usedFactKeys'],
  },
};

async function callOpenAIModel(
  model: string,
  systemPrompt: string,
  messages: ChatTurn[],
  callerLabel: string,
  costContext?: AiCallContext,
  responseSchema: ModelResponseSchema = SEMANTIC_SUPERVISOR_RESPONSE_SCHEMA,
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new ProviderNotConfiguredError([
      { provider:'openai', model, outcome:'not_configured', elapsedMs:0 },
    ]);
  }

  const certificationMode = process.env.THONGTHAI_SEMANTIC_CERTIFICATION_MODE === '1'
    && callerLabel.includes('certification');
  const networkFreeUnitTestMode = Boolean(process.env.NODE_TEST_CONTEXT);
  if (!costContext && !certificationMode && !networkFreeUnitTestMode) {
    throw new LLMAvailabilityError('OpenAI cost context is required in customer production', [
      { provider:'openai', model, outcome:'request_error', elapsedMs:0 },
    ]);
  }

  if (remainingTurnAnswerMs() - CUSTOMER_RESPONSE_COMPLETION_RESERVE_MS < MIN_ATTEMPT_BUDGET_MS) {
    throw new LLMAvailabilityError('Customer answer deadline leaves no time for another model call', [
      { provider:'openai', model, outcome:'timeout', elapsedMs:0 },
    ]);
  }
  const policy = aiCostPolicy();
  const maxOutputTokens = responseSchema.name === 'thongthai_visitor_question' ? 160
    : responseSchema.name === RESPONSE_COMPOSER_RESPONSE_SCHEMA.name
    ? RESPONSE_COMPOSER_MAX_OUTPUT_TOKENS
    : policy.semanticMaxOutputTokens;
  let reservation:AiCallReservation | null = null;
  if (costContext) {
    const guardedContext:AiCallContext = { ...costContext, callerLabel };
    try {
      const guarded = await reserveAiCall(
        guardedContext,
        model,
        [systemPrompt, ...messages.map(message => message.content)],
        maxOutputTokens,
      );
      if (guarded.kind === 'replay') return guarded.output;
      reservation = guarded;
    } catch (error) {
      if (error instanceof AiBudgetBlockedError) {
        throw new LLMBudgetBlockedError(error.reason, [
          { provider:'openai', model, outcome:'request_error', elapsedMs:0 },
        ]);
      }
      throw error;
    }
  }

  const timing = providerTimingPolicyForCaller(callerLabel);
  const deadlineAt = Date.now() + Math.min(timing.totalBudgetMs,
    Math.max(0, remainingTurnAnswerMs() - CUSTOMER_RESPONSE_COMPLETION_RESERVE_MS));
  const remainingMs = deadlineAt - Date.now();
  if (remainingMs < MIN_ATTEMPT_BUDGET_MS) {
    // Reservation itself used the remaining time. No provider request was
    // sent, so release it with known zero usage rather than leaking a hold.
    if (reservation) await finalizeAiCall(reservation,
      {inputTokens:0,cachedInputTokens:0,outputTokens:0}, null, false);
    throw new LLMAvailabilityError('OpenAI shared timeout budget exhausted', [
      { provider:'openai', model, outcome:'timeout', elapsedMs:0 },
    ]);
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.min(timing.perAttemptCapMs, remainingMs),
  );
  const startedAt = Date.now();

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        Authorization:`Bearer ${apiKey}`,
      },
      signal:controller.signal,
      body:JSON.stringify({
        model,
        instructions:systemPrompt,
        input:messages.map(message => ({
          role:message.role,
          content:[{
            type:message.role === 'assistant' ? 'output_text' : 'input_text',
            text:message.content,
          }],
        })),
        reasoning:{ effort:'low' },
        max_output_tokens:maxOutputTokens,
        text:{
          format:{
            type:'json_schema',
            name:responseSchema.name,
            strict:false,
            schema:responseSchema.schema,
          },
        },
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const elapsedMs = Date.now() - startedAt;
      const diagnostic:ProviderAttemptDiagnostic = {
        provider:'openai',
        model,
        outcome:classifyHttpOutcome(response.status),
        httpStatus:response.status,
        elapsedMs,
      };
      if (isAvailabilityHttpStatus(response.status)) {
        throw new LLMAvailabilityError(`OpenAI ${response.status}`, [diagnostic]);
      }
      throw new LLMRequestError(`OpenAI ${response.status}: ${body.slice(0, 240)}`, [diagnostic]);
    }

    const data = await response.json() as {
      output_text?: string;
      output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        input_tokens_details?: { cached_tokens?: number };
      };
    };
    const text = extractResponseText(data);
    const elapsedMs = Date.now() - startedAt;
    if (!text) {
      throw new LLMRequestError('OpenAI returned no text', [
        { provider:'openai', model, outcome:'request_error', elapsedMs },
      ]);
    }

    const usage:AiUsage | null = data.usage ? {
      inputTokens:Number(data.usage.input_tokens) || 0,
      cachedInputTokens:Number(data.usage.input_tokens_details?.cached_tokens) || 0,
      outputTokens:Number(data.usage.output_tokens) || 0,
    } : null;
    if (reservation) await finalizeAiCall(reservation, usage, text, true);
    console.log('THONGTHAI_MODEL_PROVIDER_SUCCESS', callerLabel, model);
    return text;
  } catch (error) {
    if (reservation) await finalizeAiCall(reservation, null, null, false).catch(() => undefined);
    const elapsedMs = Date.now() - startedAt;
    if ((error as Error).name === 'AbortError') {
      throw new LLMAvailabilityError('OpenAI timeout', [
        { provider:'openai', model, outcome:'timeout', elapsedMs },
      ]);
    }
    if (error instanceof LLMRequestError || error instanceof ProviderNotConfiguredError) throw error;

    const wrapped = new LLMAvailabilityError(
      `OpenAI network error: ${error instanceof Error ? error.message : 'unknown'}`,
      [{ provider:'openai', model, outcome:'network_error', elapsedMs }],
    );
    throw wrapped;
  } finally {
    clearTimeout(timeout);
  }
}

/** Bounded visitor-topic interpretation; no business facts or actions. */
export function callVisitorQuestionInterpreter(systemPrompt:string,messages:ChatTurn[],costContext:AiCallContext):Promise<string> {
  return callOpenAIModel(OPENAI_SEMANTIC_PRIMARY_MODEL,systemPrompt,messages,'semantic-visitor-question-interpretation',costContext,{
    name:'thongthai_visitor_question',schema:{type:'object',properties:{topic:{type:'string'},scope:{type:'string'},confidence:{type:'number'}},required:['topic','scope','confidence'],additionalProperties:false},
  });
}

/** Primary language-supervisor call. Never executes a business action. */
export function callSemanticSupervisor(
  systemPrompt:string,
  messages:ChatTurn[],
  callerLabel='semantic-interpreter',
  costContext?:AiCallContext,
):Promise<string> {
  return callOpenAIModel(OPENAI_SEMANTIC_PRIMARY_MODEL, systemPrompt, messages, callerLabel, costContext);
}

/** Expensive second opinion. Call only behind a semantic-review gate. */
export function callSemanticReviewer(
  systemPrompt:string,
  messages:ChatTurn[],
  callerLabel='semantic-reviewer',
  costContext?:AiCallContext,
):Promise<string> {
  return callOpenAIModel(OPENAI_SEMANTIC_REVIEW_MODEL, systemPrompt, messages, callerLabel, costContext);
}

/** Backward-compatible entrypoint. Runtime provider is OpenAI-only now. */
export function callPreferredModel(
  systemPrompt:string,
  messages:ChatTurn[],
  callerLabel='unknown',
  costContext?:AiCallContext,
):Promise<string> {
  return callOpenAIModel(OPENAI_SEMANTIC_PRIMARY_MODEL, systemPrompt, messages, callerLabel, costContext);
}

/** Grounded response composition: phrases ALREADY-VERIFIED facts naturally
 *  in Thongthai's voice. Never used for understanding/classification -- see
 *  _response-composer.ts's buildResponseComposerPrompt for the prompt and
 *  its safety contract (usedFactKeys restricted to supplied facts, no
 *  unverified operational-success claims allowed through). */
export function callResponseComposer(
  systemPrompt:string,
  messages:ChatTurn[],
  callerLabel='grounded-response-composer',
  costContext?:AiCallContext,
):Promise<string> {
  return callOpenAIModel(
    responseComposerModel(),
    systemPrompt,
    messages,
    callerLabel,
    costContext,
    RESPONSE_COMPOSER_RESPONSE_SCHEMA,
  );
}

export function stripCodeFences(text:string):string {
  return text
    .replace(/^\`\`\`json\s*/i, '')
    .replace(/^\`\`\`\s*/i, '')
    .replace(/\`\`\`\s*$/i, '')
    .trim();
}
