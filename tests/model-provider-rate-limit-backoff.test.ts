import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callPreferredModel } from '../netlify/functions/_thongthai-model-provider';

// Phase P confirmed root cause (production diagnostic artifact, both a
// semantic-interpret call and a legacy-brain call, same reproduction turn):
// every single attempt across Gemini AND OpenAI came back 429 rate_limited,
// each rejected in a few hundred ms. The old retry loop moved to the next
// model with ZERO delay, so a retry against the same still-exhausted quota
// window was guaranteed to fail identically every time. These tests lock in
// that a 429 now gets a real backoff before the next attempt (honoring
// Retry-After when the provider sends one), so a quota window has an actual
// chance to roll over instead of being hammered instantly.

function jsonResponse(body: unknown, status: number, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

test('a 429 from the first Gemini model is followed by a real backoff before retrying the second model', async () => {
  const originalFetch = global.fetch;
  const originalGemini = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  let callCount = 0;
  const callTimestamps: number[] = [];
  global.fetch = (async () => {
    callTimestamps.push(Date.now());
    callCount += 1;
    if (callCount === 1) return jsonResponse({}, 429);
    return jsonResponse({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }, 200);
  }) as typeof fetch;

  try {
    const result = await callPreferredModel('system', [{ role: 'user', content: 'hi' }], 'test');
    assert.equal(result, '{"ok":true}');
    assert.equal(callTimestamps.length, 2, 'expected exactly two Gemini attempts (429 then success)');
    const gapMs = callTimestamps[1] - callTimestamps[0];
    // Old behavior retried with ~0ms gap. A real backoff must be a
    // meaningful, measurable delay -- not an instant retry.
    assert.ok(gapMs >= 300, `expected a real backoff before the retry, got ${gapMs}ms gap`);
  } finally {
    global.fetch = originalFetch;
    if (originalGemini === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = originalGemini;
  }
});

test('a 429 with a Retry-After header is honored (capped) instead of the default backoff', async () => {
  const originalFetch = global.fetch;
  const originalGemini = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  const callTimestamps: number[] = [];
  let callCount = 0;
  global.fetch = (async () => {
    callTimestamps.push(Date.now());
    callCount += 1;
    if (callCount === 1) return jsonResponse({}, 429, { 'retry-after': '1' });
    return jsonResponse({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }, 200);
  }) as typeof fetch;

  try {
    await callPreferredModel('system', [{ role: 'user', content: 'hi' }], 'test');
    const gapMs = callTimestamps[1] - callTimestamps[0];
    // Retry-After: 1 means ~1000ms; capped at MAX_RATE_LIMIT_BACKOFF_MS (2000ms).
    assert.ok(gapMs >= 800 && gapMs <= 2_500, `expected a ~1s backoff honoring Retry-After, got ${gapMs}ms`);
  } finally {
    global.fetch = originalFetch;
    if (originalGemini === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = originalGemini;
  }
});

test('repeated 429s still resolve within the shared timeout budget, never regressing to unbounded retries', async () => {
  const originalFetch = global.fetch;
  const originalGemini = process.env.GEMINI_API_KEY;
  const originalOpenAI = process.env.OPENAI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  process.env.OPENAI_API_KEY = 'test-openai-key';
  global.fetch = (async () => jsonResponse({}, 429)) as typeof fetch;

  try {
    const startedAt = Date.now();
    await assert.rejects(() => callPreferredModel('system', [{ role: 'user', content: 'hi' }], 'test'));
    const elapsedMs = Date.now() - startedAt;
    assert.ok(elapsedMs < 9_000, `expected the shared budget to still bound total latency even with 429 backoffs, got ${elapsedMs}ms`);
  } finally {
    global.fetch = originalFetch;
    if (originalGemini === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = originalGemini;
    if (originalOpenAI === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalOpenAI;
  }
});
