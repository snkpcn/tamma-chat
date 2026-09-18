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

export class ProviderNotConfiguredError extends Error {
  constructor() { super('GEMINI_API_KEY is not set.'); this.name = 'ProviderNotConfiguredError'; }
}
export class LLMRequestError extends Error {
  constructor(message: string) { super(message); this.name = 'LLMRequestError'; }
}
export class LLMAvailabilityError extends LLMRequestError {
  constructor(message: string) { super(message); this.name = 'LLMAvailabilityError'; }
}

const GEMINI_MODELS = ['gemini-3.6-flash', 'gemini-3.5-flash'] as const;
const OPENAI_MODEL = 'gpt-5.6-luna';

export function isAvailabilityHttpStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

export function shouldFallbackToSecondaryProvider(error: unknown): boolean {
  return error instanceof LLMAvailabilityError || error instanceof ProviderNotConfiguredError;
}

async function callGemini(systemPrompt: string, messages: ChatTurn[], callerLabel: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new ProviderNotConfiguredError();
  const contents = messages.map(message => ({
    role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.content }],
  }));
  let lastAvailabilityError = '';
  for (const model of GEMINI_MODELS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
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
        if (isAvailabilityHttpStatus(response.status)) {
          lastAvailabilityError = `Gemini ${response.status}`;
          continue;
        }
        throw new LLMRequestError(`Gemini ${response.status}: ${body.slice(0, 240)}`);
      }
      const data = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; promptFeedback?: { blockReason?: string } };
      if (data.promptFeedback?.blockReason) throw new LLMRequestError(`Gemini blocked: ${data.promptFeedback.blockReason}`);
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new LLMRequestError('Gemini returned no text');
      console.log('THONGTHAI_MODEL_PROVIDER_SUCCESS', callerLabel, model);
      return text;
    } catch (error) {
      if ((error as Error).name === 'AbortError') { lastAvailabilityError = 'Gemini timeout'; continue; }
      if (error instanceof LLMRequestError) throw error;
      lastAvailabilityError = `Gemini network error: ${(error as Error).message}`;
      continue;
    } finally { clearTimeout(timeout); }
  }
  throw new LLMAvailabilityError(lastAvailabilityError || 'Gemini unavailable');
}

async function callOpenAI(systemPrompt: string, messages: ChatTurn[]): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new LLMAvailabilityError('OpenAI fallback not configured');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
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
      if (isAvailabilityHttpStatus(response.status)) throw new LLMAvailabilityError(`OpenAI ${response.status}`);
      throw new LLMRequestError(`OpenAI ${response.status}: ${body.slice(0, 240)}`);
    }
    const data = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
    let text = data.output_text ?? '';
    if (!text) for (const item of data.output ?? []) for (const content of item.content ?? []) if (content.type === 'output_text' && content.text) text += content.text;
    if (!text) throw new LLMRequestError('OpenAI returned no text');
    return text;
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw new LLMAvailabilityError('OpenAI timeout');
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
 */
export async function callPreferredModel(systemPrompt: string, messages: ChatTurn[], callerLabel = 'unknown'): Promise<string> {
  try { return await callGemini(systemPrompt, messages, callerLabel); }
  catch (error) {
    if (!shouldFallbackToSecondaryProvider(error)) throw error;
    console.log('THONGTHAI_MODEL_PROVIDER_FALLBACK', callerLabel, 'gemini', 'openai');
    return callOpenAI(systemPrompt, messages);
  }
}

export function stripCodeFences(text: string): string {
  return text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
}
