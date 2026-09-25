import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  callPreferredModel,
  isGeminiCircuitOpen,
  resetGeminiCircuitForTests,
} from '../netlify/functions/_thongthai-model-provider';

// Phase P confirmed root cause (production diagnostic artifact, both a
// semantic-interpret call and a legacy-brain call, same reproduction turn):
// every single attempt across Gemini AND OpenAI came back 429 rate_limited,
// each rejected in a few hundred ms. The old retry loop moved to the next
// model with ZERO delay, so a retry against the same still-exhausted quota
// window was guaranteed to fail identically every time.
//
// Phase 5.4 corrects one over-broad assumption in that architecture:
// Gemini quotas are model-specific within the project. A 429 now opens the
// circuit for THAT model only and falls through immediately to another FREE
// Gemini model inside the same shared latency budget. Paid OpenAI remains
// opt-in only. These tests lock in the per-model circuit behavior and the
// bounded Retry-After cooldown.

function jsonResponse(body: unknown, status: number, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

test('a 429 from the first Gemini model opens only that model circuit and falls through fast to another free Gemini model', async () => {
  const originalFetch = global.fetch;
  const originalGemini = process.env.GEMINI_API_KEY;
  const originalOpenAI = process.env.OPENAI_API_KEY;
  const originalPaidFallback = process.env.THONGTHAI_ALLOW_PAID_FALLBACK;
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  process.env.OPENAI_API_KEY = 'test-openai-key';
  delete process.env.THONGTHAI_ALLOW_PAID_FALLBACK;
  resetGeminiCircuitForTests();

  let callCount = 0;
  const urls: string[] = [];
  global.fetch = (async (url: RequestInfo | URL) => {
    callCount += 1;
    urls.push(String(url));
    if (callCount === 1) return jsonResponse({}, 429);
    return jsonResponse({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }, 200);
  }) as typeof fetch;

  try {
    const startedAt = Date.now();
    const result = await callPreferredModel('system', [{ role: 'user', content: 'hi' }], 'test');
    const elapsedMs = Date.now() - startedAt;
    assert.equal(result, '{"ok":true}');
    assert.equal(callCount, 2, 'the next free Gemini model should be attempted immediately');
    assert.notEqual(urls[0], urls[1], 'fallback must use a different Gemini model');
    assert.ok(!urls.some(url => url.includes('api.openai.com')), 'paid OpenAI must remain disabled');
    assert.ok(elapsedMs < 1_000, `expected fast free-model fallback with no sleep, got ${elapsedMs}ms`);
    assert.ok(isGeminiCircuitOpen(), 'aggregate health should report that one model circuit is open');
  } finally {
    global.fetch = originalFetch;
    resetGeminiCircuitForTests();
    if (originalGemini === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = originalGemini;
    if (originalOpenAI === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalOpenAI;
    if (originalPaidFallback === undefined) delete process.env.THONGTHAI_ALLOW_PAID_FALLBACK; else process.env.THONGTHAI_ALLOW_PAID_FALLBACK = originalPaidFallback;
  }
});

test('a 429 with a Retry-After header sets the circuit cooldown to that value (bounded)', async () => {
  const originalFetch = global.fetch;
  const originalGemini = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  resetGeminiCircuitForTests();
  global.fetch = (async () => jsonResponse({}, 429, { 'retry-after': '10' })) as typeof fetch;

  try {
    const startedAt = Date.now();
    await assert.rejects(() => callPreferredModel('system', [{ role: 'user', content: 'hi' }], 'test'));
    assert.ok(isGeminiCircuitOpen(startedAt + 9_000), 'circuit should still be open before the honored 10s Retry-After elapses');
    assert.ok(!isGeminiCircuitOpen(startedAt + 10_500), 'circuit should close again once the honored Retry-After window elapses');
  } finally {
    global.fetch = originalFetch;
    resetGeminiCircuitForTests();
    if (originalGemini === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = originalGemini;
  }
});

test('repeated 429s still resolve fast, never regressing to unbounded retries or a paid OpenAI fallback', async () => {
  const originalFetch = global.fetch;
  const originalGemini = process.env.GEMINI_API_KEY;
  const originalOpenAI = process.env.OPENAI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  // An OpenAI key being present must not matter: without the explicit
  // THONGTHAI_ALLOW_PAID_FALLBACK opt-in, zero-cost policy forbids spending
  // it as a fallback.
  process.env.OPENAI_API_KEY = 'test-openai-key';
  resetGeminiCircuitForTests();
  global.fetch = (async () => jsonResponse({}, 429)) as typeof fetch;

  try {
    const startedAt = Date.now();
    await assert.rejects(() => callPreferredModel('system', [{ role: 'user', content: 'hi' }], 'test'));
    const elapsedMs = Date.now() - startedAt;
    assert.ok(elapsedMs < 500, `expected the circuit breaker to fail fast with no retries, got ${elapsedMs}ms`);
  } finally {
    global.fetch = originalFetch;
    resetGeminiCircuitForTests();
    if (originalGemini === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = originalGemini;
    if (originalOpenAI === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalOpenAI;
  }
});
