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
// Zero-cost-quota architecture superseded the original fix (a sleep-then-
// retry-in-place backoff) with a bounded in-process circuit breaker: a 429
// opens the circuit immediately and the turn fails FAST (no sleep, no
// retrying a second model against the same exhausted quota), so the caller
// can degrade deterministically right away instead of burning request
// latency on a doomed retry. These tests lock in that behavior, and that the
// circuit's cooldown honors (and bounds) the provider's Retry-After header.

function jsonResponse(body: unknown, status: number, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

test('a 429 from the first Gemini model opens the circuit and fails the turn fast, without retrying the second model', async () => {
  const originalFetch = global.fetch;
  const originalGemini = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  resetGeminiCircuitForTests();
  let callCount = 0;
  global.fetch = (async () => {
    callCount += 1;
    // If the circuit breaker failed to stop the retry, this would let a
    // second attempt "succeed" -- callCount staying at 1 proves it was
    // skipped instead of actually retried against the same exhausted quota.
    if (callCount === 1) return jsonResponse({}, 429);
    return jsonResponse({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }, 200);
  }) as typeof fetch;

  try {
    const startedAt = Date.now();
    await assert.rejects(() => callPreferredModel('system', [{ role: 'user', content: 'hi' }], 'test'));
    const elapsedMs = Date.now() - startedAt;
    assert.equal(callCount, 1, 'the second Gemini model should be skipped via the open circuit, not retried');
    assert.ok(elapsedMs < 500, `expected a fast fail with no backoff sleep, got ${elapsedMs}ms`);
    assert.ok(isGeminiCircuitOpen(), 'circuit should be open immediately after a 429');
  } finally {
    global.fetch = originalFetch;
    resetGeminiCircuitForTests();
    if (originalGemini === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = originalGemini;
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
