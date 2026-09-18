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

async function callGemini(systemPrompt: string, messages: ChatTurn[], callerLabel: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new ProviderNotConfiguredError([{ provider: 'gemini', model: 'n/a', outcome: 'not_configured', elapsedMs: 0 }]);
  const contents = messages.map(message => ({
    role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.content }],
  }));
  let lastAvailabilityError = '';
  const attempts: ProviderAttemptDiagnostic[] = [];
  for (const model of GEMINI_MODELS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
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

async function callOpenAI(systemPrompt: string, messages: ChatTurn[]): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new LLMAvailabilityError('OpenAI fallback not configured', [{ provider: 'openai', model: OPENAI_MODEL, outcome: 'not_configured', elapsedMs: 0 }]);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
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
 * Phase P: does not change provider selection/order/timeout behavior at all.
 * It only accumulates a ProviderAttemptDiagnostic per attempt (Gemini's two
 * models, then OpenAI if reached) and attaches the FULL combined trail to
 * whichever error ultimately propagates, so a caller that fails can report
 * exactly what happened at each step.
 */
export async function callPreferredModel(systemPrompt: string, messages: ChatTurn[], callerLabel = 'unknown'): Promise<string> {
  try { return await callGemini(systemPrompt, messages, callerLabel); }
  catch (geminiError) {
    if (!shouldFallbackToSecondaryProvider(geminiError)) throw geminiError;
    console.log('THONGTHAI_MODEL_PROVIDER_FALLBACK', callerLabel, 'gemini', 'openai');
    const geminiAttempts = geminiError instanceof LLMRequestError || geminiError instanceof ProviderNotConfiguredError
      ? geminiError.attempts : [];
    try {
      return await callOpenAI(systemPrompt, messages);
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
