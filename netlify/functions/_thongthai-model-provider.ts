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

export const OPENAI_SEMANTIC_PRIMARY_MODEL =
  process.env.THONGTHAI_SEMANTIC_MODEL?.trim() || 'gpt-5.6-terra';
export const OPENAI_SEMANTIC_REVIEW_MODEL =
  process.env.THONGTHAI_SEMANTIC_REVIEW_MODEL?.trim() || 'gpt-5.6-sol';

const TOTAL_PROVIDER_BUDGET_MS = 7_000;
const PER_ATTEMPT_CAP_MS = 6_000;
const SEMANTIC_CERT_TOTAL_PROVIDER_BUDGET_MS = 30_000;
const SEMANTIC_CERT_PER_ATTEMPT_CAP_MS = 25_000;
const MIN_ATTEMPT_BUDGET_MS = 1_000;

export function providerTimingPolicyForCaller(callerLabel: string): {
  totalBudgetMs: number;
  perAttemptCapMs: number;
} {
  if (callerLabel === 'semantic-certification-group') {
    return {
      totalBudgetMs: SEMANTIC_CERT_TOTAL_PROVIDER_BUDGET_MS,
      perAttemptCapMs: SEMANTIC_CERT_PER_ATTEMPT_CAP_MS,
    };
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

async function callOpenAIModel(
  model: string,
  systemPrompt: string,
  messages: ChatTurn[],
  callerLabel: string,
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new ProviderNotConfiguredError([
      { provider:'openai', model, outcome:'not_configured', elapsedMs:0 },
    ]);
  }

  const timing = providerTimingPolicyForCaller(callerLabel);
  const deadlineAt = Date.now() + timing.totalBudgetMs;
  const remainingMs = deadlineAt - Date.now();
  if (remainingMs < MIN_ATTEMPT_BUDGET_MS) {
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
        max_output_tokens:1600,
        text:{
          format:{
            type:'json_schema',
            name:'thongthai_semantic_supervisor',
            strict:false,
            schema:{ type:'object' },
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
    };
    const text = extractResponseText(data);
    const elapsedMs = Date.now() - startedAt;
    if (!text) {
      throw new LLMRequestError('OpenAI returned no text', [
        { provider:'openai', model, outcome:'request_error', elapsedMs },
      ]);
    }

    console.log('THONGTHAI_MODEL_PROVIDER_SUCCESS', callerLabel, model);
    return text;
  } catch (error) {
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

/** Primary language-supervisor call. Never executes a business action. */
export function callSemanticSupervisor(
  systemPrompt:string,
  messages:ChatTurn[],
  callerLabel='semantic-interpreter',
):Promise<string> {
  return callOpenAIModel(OPENAI_SEMANTIC_PRIMARY_MODEL, systemPrompt, messages, callerLabel);
}

/** Expensive second opinion. Call only behind a semantic-review gate. */
export function callSemanticReviewer(
  systemPrompt:string,
  messages:ChatTurn[],
  callerLabel='semantic-reviewer',
):Promise<string> {
  return callOpenAIModel(OPENAI_SEMANTIC_REVIEW_MODEL, systemPrompt, messages, callerLabel);
}

/** Backward-compatible entrypoint. Runtime provider is OpenAI-only now. */
export function callPreferredModel(
  systemPrompt:string,
  messages:ChatTurn[],
  callerLabel='unknown',
):Promise<string> {
  return callOpenAIModel(OPENAI_SEMANTIC_PRIMARY_MODEL, systemPrompt, messages, callerLabel);
}

export function stripCodeFences(text:string):string {
  return text
    .replace(/^\`\`\`json\s*/i, '')
    .replace(/^\`\`\`\s*/i, '')
    .replace(/\`\`\`\s*$/i, '')
    .trim();
}
