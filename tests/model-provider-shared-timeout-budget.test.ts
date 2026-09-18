import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callPreferredModel } from '../netlify/functions/_thongthai-model-provider';

// Phase P root cause (confirmed via the build-time diagnostic: an isolated
// call succeeded in 6.75s while real production requests on the heavier
// legacy-brain path failed near-universally) -- the old per-attempt
// timeouts were each independent (10s per Gemini model, 8s for OpenAI),
// so a full retry/fallback chain could take up to ~28s wall-clock: far
// longer than a serverless Function's execution ceiling, especially once
// the caller's own earlier work (Supabase loads, prompt building) has
// already spent part of that budget. These tests lock in that the total
// operation -- every attempt, across both providers -- now stays bounded
// to one shared wall-clock deadline, so this can never regress back to an
// unbounded worst case.

function hangingFetchUntilAborted(): typeof fetch {
  return (async (_url: unknown, init?: RequestInit) => {
    return new Promise((_resolve, reject) => {
      const signal = init?.signal as AbortSignal | undefined;
      signal?.addEventListener('abort', () => {
        const error = new Error('The operation was aborted');
        error.name = 'AbortError';
        reject(error);
      });
    });
  }) as typeof fetch;
}

test('callPreferredModel bounds total worst-case latency to one shared budget, not the sum of independent per-attempt timeouts', async () => {
  const originalFetch = global.fetch;
  const originalGemini = process.env.GEMINI_API_KEY;
  const originalOpenAI = process.env.OPENAI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  process.env.OPENAI_API_KEY = 'test-openai-key';
  global.fetch = hangingFetchUntilAborted();

  try {
    const startedAt = Date.now();
    await assert.rejects(() => callPreferredModel('system prompt', [{ role: 'user', content: 'hi' }], 'test'));
    const elapsedMs = Date.now() - startedAt;
    // Old behavior: up to ~28s (10s + 10s Gemini + 8s OpenAI, all independent).
    // New behavior: every attempt shares one ~7s budget, so total is bounded
    // well under that old worst case regardless of how many attempts occur.
    assert.ok(elapsedMs < 9_000, `expected bounded total latency under the shared budget, got ${elapsedMs}ms`);
  } finally {
    global.fetch = originalFetch;
    if (originalGemini === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = originalGemini;
    if (originalOpenAI === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalOpenAI;
  }
});

test('a fast successful first attempt is unaffected by the shared budget', async () => {
  const originalFetch = global.fetch;
  const originalGemini = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  global.fetch = (async () => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }],
  }), { status: 200 })) as typeof fetch;

  try {
    const startedAt = Date.now();
    const result = await callPreferredModel('system prompt', [{ role: 'user', content: 'hi' }], 'test');
    const elapsedMs = Date.now() - startedAt;
    assert.equal(result, '{"ok":true}');
    assert.ok(elapsedMs < 1_000, `expected a fast successful call to stay fast, got ${elapsedMs}ms`);
  } finally {
    global.fetch = originalFetch;
    if (originalGemini === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = originalGemini;
  }
});
