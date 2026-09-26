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
  | 'not_configured'
  | 'circuit_open';

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

const GEMINI_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  // Stable free-tier high-volume fallback. Official Gemini docs list
  // gemini-3.1-flash-lite as a stable structured-output model with free-tier
  // pricing and low thinking support. Keep it after the newer models so it is
  // used only when their project/model quota or availability is exhausted.
  'gemini-3.1-flash-lite',
] as const;
type GeminiModel = (typeof GEMINI_MODELS)[number];
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
// condition, not a timeout. A 429 now opens the circuit breaker below
// instead of sleeping-then-retrying in place: a retry against the same
// still-exhausted quota window is guaranteed to fail the same way, so it's
// cheaper (and truer to the zero-cost mandate) to fail this turn fast and
// let the caller degrade deterministically.

function parseRetryAfterMs(response: Response): number | null {
  const header = response.headers.get('retry-after');
  if (!header) return null;
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return seconds * 1000;
}

// Zero-cost architecture (owner constraint: no paid LLM spend).
//
// IMPORTANT: Gemini rate limits are project-scoped and may differ by model.
// A 429 from one model is not proof that every other free Gemini model is
// unavailable, so runtime keeps one bounded circuit per model and may still
// try another free model inside the same shared latency budget. Certification,
// however, must pace project-wide because one project quota can affect several
// model IDs in the same burst.
const CIRCUIT_MIN_COOLDOWN_MS = 5_000;
const CIRCUIT_MAX_COOLDOWN_MS = 60_000;
const CIRCUIT_DEFAULT_COOLDOWN_MS = 15_000;

const geminiCircuitOpenUntilByModel = new Map<GeminiModel, number>();

function isGeminiModelCircuitOpen(model: GeminiModel, now: number = Date.now()): boolean {
  return now < (geminiCircuitOpenUntilByModel.get(model) ?? 0);
}

/** Backward-compatible aggregate health helper used by existing diagnostics.
 *  True means at least one Gemini model is currently cooling down; it does
 *  NOT mean the whole Gemini provider family is unavailable. */
export function isGeminiCircuitOpen(now: number = Date.now()): boolean {
  return GEMINI_MODELS.some(model => isGeminiModelCircuitOpen(model, now));
}

/** Test-only escape hatch: production circuits close themselves on expiry. */
export function resetGeminiCircuitForTests(): void {
  geminiCircuitOpenUntilByModel.clear();
}

function openGeminiCircuit(model: GeminiModel, retryAfterMs: number | null): void {
  const cooldownMs = Math.min(
    Math.max(retryAfterMs ?? CIRCUIT_DEFAULT_COOLDOWN_MS, CIRCUIT_MIN_COOLDOWN_MS),
    CIRCUIT_MAX_COOLDOWN_MS,
  );
  geminiCircuitOpenUntilByModel.set(model, Date.now() + cooldownMs);
  console.log('THONGTHAI_MODEL_PROVIDER_CIRCUIT_OPEN', model, cooldownMs);
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
    if (isGeminiModelCircuitOpen(model)) {
      lastAvailabilityError = `Gemini ${model} circuit open (recent rate limit)`;
      attempts.push({ provider: 'gemini', model, outcome: 'circuit_open', elapsedMs: 0 });
      console.log('THONGTHAI_OBSERVABILITY', JSON.stringify({ circuit_open: true, callerLabel, model }));
      continue;
    }
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
            console.log('THONGTHAI_OBSERVABILITY', JSON.stringify({ provider_429: true, callerLabel, model }));
            // Rate limits are tracked per model. Cool down ONLY the model that
            // returned 429, then continue to the next free Gemini model within
            // the same shared latency budget. Paid OpenAI remains separately
            // opt-in and is never reached merely because one free model is busy.
            openGeminiCircuit(model, parseRetryAfterMs(response));
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
 * Phase 5.4: accumulates a ProviderAttemptDiagnostic per attempt across the
 * ordered free Gemini model chain, then OpenAI only if explicitly enabled and attaches the FULL combined trail to
 * whichever error ultimately propagates, so a caller that fails can report
 * exactly what happened at each step. It also bounds the ENTIRE operation
 * (every attempt, across both providers) to one shared TOTAL_PROVIDER_BUDGET_MS
 * wall-clock deadline -- see the comment above that constant for why: the old
 * independent per-attempt timeouts could sum to ~28s worst case, comfortably
 * exceeding a serverless Function's execution ceiling.
 *
 * Zero-cost architecture (owner constraint): OpenAI is a PAID API the owner
 * will not fund, so it is no longer called by default -- Gemini's free tier
 * is the only provider in normal production operation. OpenAI is only ever
 * attempted when THONGTHAI_ALLOW_PAID_FALLBACK='1' is explicitly set (an
 * opt-in escape hatch, off by default), so no code path can spend money
 * without an explicit, deliberate configuration change. When Gemini is
 * unavailable and paid fallback is not enabled, the caller gets the SAME
 * LLMAvailabilityError it always would -- callers already have a
 * deterministic degradation path for that (see _graceful-degradation.ts).
 */
export async function callPreferredModel(systemPrompt: string, messages: ChatTurn[], callerLabel = 'unknown'): Promise<string> {
  const deadlineAt = Date.now() + TOTAL_PROVIDER_BUDGET_MS;
  try { return await callGemini(systemPrompt, messages, callerLabel, deadlineAt); }
  catch (geminiError) {
    if (!shouldFallbackToSecondaryProvider(geminiError)) throw geminiError;
    if (process.env.THONGTHAI_ALLOW_PAID_FALLBACK !== '1') throw geminiError;
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
