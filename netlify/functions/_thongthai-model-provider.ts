// Neutral model-provider module (Phase B.1 hardening -- see THONGTHAI_HANDOFF.md).
//
// This module owns ONLY the concern of calling an LLM provider: which providers,
// in what order, with what timeouts, and how a raw text response gets extracted
// from a code-fenced JSON reply. It contains zero semantic/business logic and
// must never import from _thongthai-brain-v3.ts or _semantic-interpreter.ts (or
// anything that imports them) -- both of those import FROM here instead. This
// breaks what would otherwise become a circular dependency once the Brain
// eventually consumes the Semantic Interpreter's output (Brain -> Semantic
// Interpreter -> Brain, if both had kept importing the provider calls from
// _thongthai-brain-v3.ts). See tests/model-provider-no-cycle.test.ts for the
// static proof that no cycle exists.

export type ChatTurn = { role: 'user' | 'assistant'; content: string };

// Phase P — safe, structured attempt trail. Provider/model/outcome/status/
// latency ONLY: never a prompt, never model output, never a header or key.
// Attached to the errors below so a caller that ultimately fails can report
// exactly what each provider attempt actually did, without needing raw log
// access to find out.
export type ProviderAttemptOutcome =
  | 'success'
  | 'timeout'
  | 'rate_limited'
  | 'server_error'
  | 'network_error'
  | 'request_error'
  | 'not_configured';

export type ProviderAttemptDiagnostic = {
  provider: 'gemini' | 'openai';
  model: string;
  outcome: ProviderAttemptOutcome;
  httpStatus?: number;
  elapsedMs: number;
};

export class ProviderNotConfiguredError extends Error {
  attempts: ProviderAttemptDiagnostic[];
  constructor(attempts: ProviderAttemptDiagnostic[] = []) {
    super('GEMINI_API_KEY is not set.');
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

const GEMINI_MODELS = ['gemini-3.6-flash', 'gemini-3.5-flash'] as const;
const OPENAI_MODEL = 'gpt-5.6-luna';

// Phase P root cause: the old per-attempt timeouts (10s per Gemini model,
// 8s for OpenAI) were each independent, so a full retry/fallback chain
// could take up to ~28s -- comfortably longer than a serverless Function's
// execution ceiling, especially after the caller's own earlier work
// (Supabase loads, prompt building) already spent part of that budget. A
// single isolated call (e.g. at build time, with no competing pipeline
// steps) stays well clear of this and misleadingly looks healthy, while
// real requests on the heavier legacy-brain path do not. These constants
// now bound the ENTIRE callPreferredModel operation -- every attempt
// across both providers -- to one shared wall-clock budget, so worst-case
// total latency can never regress back past a safe ceiling regardless of
// how many attempts are made.
const TOTAL_PROVIDER_BUDGET_MS = 7_000;
const PER_ATTEMPT_CAP_MS = 6_000;
const MIN_ATTEMPT_BUDGET_MS = 1_200;

// Phase P confirmed root cause: production 429s on EVERY attempt, Gemini and
// OpenAI alike, each rejected in a few hundred ms -- a real rate-limit
// condition, not a timeout. The old retry loop re-tried instantly with zero
// delay, so a retry against the same still-exhausted quota window was
// guaranteed to fail the same way every time. This backoff gives a
// rate-limited quota window a real chance to roll over before the next
// attempt, honoring the provider's own Retry-After header when given.
const DEFAULT_RATE_LIMIT_BACKOFF_MS = 800;
const MAX_RATE_LIMIT_BACKOFF_MS = 2_000;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseRetryAfterMs(response: Response): number | null {
  const header = response.headers.get('retry-after');
  if (!header) return null;
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return seconds * 1000;
}

export function isAvailabilityHttpStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function classifyHttpOutcome(status: number): ProviderAttemptOutcome {
  if (status === 429) return 'rate_limited';
  if (isAvailabilityHttpStatus(status)) return 'server_error';
  return 'request_error';
}

export function shouldFallbackToSecondaryProvider(error: unknown): boolean {
  return error instanceof LLMAvailabilityError || error instanceof ProviderNotConfiguredError;
}

async function callGemini(systemPrompt: string, messages: ChatTurn[], callerLabel: string, deadlineAt: number): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new ProviderNotConfiguredError([{ provider: 'gemini', model: 'n/a', outcome: 'not_configured', elapsedMs: 0 }]);
  const contents = messages.map(message => ({
    role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.content }],
  }));
  let lastAvailabilityError = '';
  const attempts: ProviderAttemptDiagnostic[] = [];
  for (const model of GEMINI_MODELS) {
    const remainingMs = deadlineAt - Date.now();
    if (remainingMs < MIN_ATTEMPT_BUDGET_MS) {
      lastAvailabilityError = 'Gemini shared timeout budget exhausted';
      attempts.push({ provider: 'gemini', model, outcome: 'timeout', elapsedMs: 0 });
      continue;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.min(PER_ATTEMPT_CAP_MS, remainingMs));
    const startedAt = Date.now();
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] }, contents,
          generationConfig: { responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'low' }, maxOutputTokens: 4096 },
        }),
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        const elapsedMs = Date.now() - startedAt;
        if (isAvailabilityHttpStatus(response.status)) {
          lastAvailabilityError = `Gemini ${response.status}`;
          attempts.push({ provider: 'gemini', model, outcome: classifyHttpOutcome(response.status), httpStatus: response.status, elapsedMs });
          if (response.status === 429) {
            const remainingAfterAttempt = deadlineAt - Date.now();
            const backoffMs = Math.min(
              parseRetryAfterMs(response) ?? DEFAULT_RATE_LIMIT_BACKOFF_MS,
              MAX_RATE_LIMIT_BACKOFF_MS,
              remainingAfterAttempt - MIN_ATTEMPT_BUDGET_MS,
            );
            if (backoffMs > 0) await sleep(backoffMs);
          }
          continue;
        }
        attempts.push({ provider: 'gemini', model, outcome: 'request_error', httpStatus: response.status, elapsedMs });
        throw new LLMRequestError(`Gemini ${response.status}: ${body.slice(0, 240)}`, attempts);
      }
      const data = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; promptFeedback?: { blockReason?: string } };
      const elapsedMs = Date.now() - startedAt;
      if (data.promptFeedback?.blockReason) {
        attempts.push({ provider: 'gemini', model, outcome: 'request_error', elapsedMs });
        throw new LLMRequestError(`Gemini blocked: ${data.promptFeedback.blockReason}`, attempts);
      }
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        attempts.push({ provider: 'gemini', model, outcome: 'request_error', elapsedMs });
        throw new LLMRequestError('Gemini returned no text', attempts);
      }
      attempts.push({ provider: 'gemini', model, outcome: 'success', elapsedMs });
      console.log('THONGTHAI_MODEL_PROVIDER_SUCCESS', callerLabel, model);
      return text;
    } catch (error) {
      const elapsedMs = Date.now() - startedAt;
      if ((error as Error).name === 'AbortError') {
        lastAvailabilityError = 'Gemini timeout';
        attempts.push({ provider: 'gemini', model, outcome: 'timeout', elapsedMs });
        continue;
      }
      if (error instanceof LLMRequestError) throw error;
      lastAvailabilityError = `Gemini network error: ${(error as Error).message}`;
      attempts.push({ provider: 'gemini', model, outcome: 'network_error', elapsedMs });
      continue;
    } finally { clearTimeout(timeout); }
  }
  throw new LLMAvailabilityError(lastAvailabilityError || 'Gemini unavailable', attempts);
}

async function callOpenAI(systemPrompt: string, messages: ChatTurn[], deadlineAt: number): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new LLMAvailabilityError('OpenAI fallback not configured', [{ provider: 'openai', model: OPENAI_MODEL, outcome: 'not_configured', elapsedMs: 0 }]);
  const remainingMs = deadlineAt - Date.now();
  if (remainingMs < MIN_ATTEMPT_BUDGET_MS) {
    throw new LLMAvailabilityError('OpenAI shared timeout budget exhausted', [{ provider: 'openai', model: OPENAI_MODEL, outcome: 'timeout', elapsedMs: 0 }]);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(PER_ATTEMPT_CAP_MS, remainingMs));
  const startedAt = Date.now();
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: OPENAI_MODEL, instructions: systemPrompt,
        input: messages.map(message => ({ role: message.role, content: [{ type: message.role === 'assistant' ? 'output_text' : 'input_text', text: message.content }] })),
        reasoning: { effort: 'none' }, max_output_tokens: 4096,
        text: { format: { type: 'json_schema', name: 'thongthai_brain_response', strict: false, schema: { type: 'object' } } },
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const elapsedMs = Date.now() - startedAt;
      if (isAvailabilityHttpStatus(response.status)) {
        throw new LLMAvailabilityError(`OpenAI ${response.status}`, [{ provider: 'openai', model: OPENAI_MODEL, outcome: classifyHttpOutcome(response.status), httpStatus: response.status, elapsedMs }]);
      }
      throw new LLMRequestError(`OpenAI ${response.status}: ${body.slice(0, 240)}`, [{ provider: 'openai', model: OPENAI_MODEL, outcome: 'request_error', httpStatus: response.status, elapsedMs }]);
    }
    const data = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
    let text = data.output_text ?? '';
    if (!text) for (const item of data.output ?? []) for (const content of item.content ?? []) if (content.type === 'output_text' && content.text) text += content.text;
    const elapsedMs = Date.now() - startedAt;
    if (!text) throw new LLMRequestError('OpenAI returned no text', [{ provider: 'openai', model: OPENAI_MODEL, outcome: 'request_error', elapsedMs }]);
    return text;
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    if ((error as Error).name === 'AbortError') {
      throw new LLMAvailabilityError('OpenAI timeout', [{ provider: 'openai', model: OPENAI_MODEL, outcome: 'timeout', elapsedMs }]);
    }
    if (error instanceof LLMRequestError) throw error;
    // Preserve the exact original behavior: an unrecognized/network-level
    // error rethrows AS-IS, unwrapped (not LLMAvailabilityError), so
    // provider-selection/fallback semantics are unchanged. Only attach a
    // best-effort diagnostic entry for the temporary evidence endpoint to
    // read if present; nothing reads or requires this field otherwise.
    if (error && typeof error === 'object') {
      (error as { attempts?: ProviderAttemptDiagnostic[] }).attempts =
        [{ provider: 'openai', model: OPENAI_MODEL, outcome: 'network_error', elapsedMs }];
    }
    throw error;
  } finally { clearTimeout(timeout); }
}

/**
 * Gemini first, OpenAI fallback on availability-class failure OR when Gemini
 * is not configured (a bad request/blocked/parse-failure from Gemini is NOT
 * retried against OpenAI --
 * same behavior as before this extraction). `callerLabel` is purely for log
 * correlation (e.g. 'thongthai-brain-v3', 'semantic-interpreter') and carries
 * no behavioral meaning -- this keeps the provider module ignorant of which
 * caller is using it.
 *
 * Phase P: accumulates a ProviderAttemptDiagnostic per attempt (Gemini's two
 * models, then OpenAI if reached) and attaches the FULL combined trail to
 * whichever error ultimately propagates, so a caller that fails can report
 * exactly what happened at each step. It also bounds the ENTIRE operation
 * (every attempt, across both providers) to one shared TOTAL_PROVIDER_BUDGET_MS
 * wall-clock deadline -- see the comment above that constant for why: the old
 * independent per-attempt timeouts could sum to ~28s worst case, comfortably
 * exceeding a serverless Function's execution ceiling.
 */
export async function callPreferredModel(systemPrompt: string, messages: ChatTurn[], callerLabel = 'unknown'): Promise<string> {
  const deadlineAt = Date.now() + TOTAL_PROVIDER_BUDGET_MS;
  try { return await callGemini(systemPrompt, messages, callerLabel, deadlineAt); }
  catch (geminiError) {
    if (!shouldFallbackToSecondaryProvider(geminiError)) throw geminiError;
    console.log('THONGTHAI_MODEL_PROVIDER_FALLBACK', callerLabel, 'gemini', 'openai');
    const geminiAttempts = geminiError instanceof LLMRequestError || geminiError instanceof ProviderNotConfiguredError
      ? geminiError.attempts : [];
    try {
      return await callOpenAI(systemPrompt, messages, deadlineAt);
    } catch (openaiError) {
      if (openaiError instanceof LLMRequestError) {
        openaiError.attempts = [...geminiAttempts, ...openaiError.attempts];
      }
      throw openaiError;
    }
  }
}

export function stripCodeFences(text: string): string {
  return text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
}
