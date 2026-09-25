import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  callPreferredModel,
  resetGeminiCircuitForTests,
} from '../netlify/functions/_thongthai-model-provider';

function jsonResponse(body: unknown, status: number, headers: Record<string,string> = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

test('Human Brain 5.4 RED: a 429 on one Gemini model falls through to the next FREE Gemini model instead of killing all Gemini', async () => {
  const originalFetch = global.fetch;
  const originalGemini = process.env.GEMINI_API_KEY;
  const originalOpenAI = process.env.OPENAI_API_KEY;
  const originalPaidFallback = process.env.THONGTHAI_ALLOW_PAID_FALLBACK;
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  process.env.OPENAI_API_KEY = 'test-openai-key';
  delete process.env.THONGTHAI_ALLOW_PAID_FALLBACK;
  resetGeminiCircuitForTests();

  const urls: string[] = [];
  global.fetch = (async (url: RequestInfo | URL) => {
    urls.push(String(url));
    if (urls.length === 1) return jsonResponse({}, 429, { 'retry-after': '10' });
    return jsonResponse({ candidates:[{ content:{ parts:[{ text:'{"ok":true}' }] } }] }, 200);
  }) as typeof fetch;

  try {
    const result = await callPreferredModel('system', [{ role:'user', content:'hi' }], 'test');
    assert.equal(result, '{"ok":true}');
    assert.equal(urls.length, 2, '429 on one model must not suppress the next free Gemini model');
    assert.match(urls[0], /generativelanguage\.googleapis\.com/);
    assert.match(urls[1], /generativelanguage\.googleapis\.com/);
    assert.notEqual(urls[0], urls[1], 'fallback must be a different Gemini model');
    assert.ok(!urls.some(url => url.includes('api.openai.com')), 'paid OpenAI must remain disabled');
  } finally {
    global.fetch = originalFetch;
    resetGeminiCircuitForTests();
    if (originalGemini === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = originalGemini;
    if (originalOpenAI === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalOpenAI;
    if (originalPaidFallback === undefined) delete process.env.THONGTHAI_ALLOW_PAID_FALLBACK; else process.env.THONGTHAI_ALLOW_PAID_FALLBACK = originalPaidFallback;
  }
});

test('Human Brain 5.4 RED: model-specific 429 circuit skips only that model on the next turn', async () => {
  const originalFetch = global.fetch;
  const originalGemini = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  resetGeminiCircuitForTests();

  const urls: string[] = [];
  let firstModelUrl = '';
  global.fetch = (async (url: RequestInfo | URL) => {
    const value = String(url);
    urls.push(value);
    if (!firstModelUrl) {
      firstModelUrl = value;
      return jsonResponse({}, 429, { 'retry-after':'60' });
    }
    return jsonResponse({ candidates:[{ content:{ parts:[{ text:'{"ok":true}' }] } }] }, 200);
  }) as typeof fetch;

  try {
    assert.equal(await callPreferredModel('system', [{role:'user',content:'one'}], 'test'), '{"ok":true}');
    const callsAfterFirstTurn = urls.length;
    assert.equal(await callPreferredModel('system', [{role:'user',content:'two'}], 'test'), '{"ok":true}');
    const secondTurnUrls = urls.slice(callsAfterFirstTurn);
    assert.ok(secondTurnUrls.length >= 1);
    assert.ok(!secondTurnUrls.includes(firstModelUrl), 'only the rate-limited model must stay circuit-open');
  } finally {
    global.fetch = originalFetch;
    resetGeminiCircuitForTests();
    if (originalGemini === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = originalGemini;
  }
});

test('Human Brain 5.4 RED: provider chain includes current stable Gemini 3.8 before older fallbacks', async () => {
  const originalFetch = global.fetch;
  const originalGemini = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  resetGeminiCircuitForTests();

  let firstUrl = '';
  global.fetch = (async (url: RequestInfo | URL) => {
    if (!firstUrl) firstUrl = String(url);
    return jsonResponse({ candidates:[{ content:{ parts:[{ text:'{"ok":true}' }] } }] }, 200);
  }) as typeof fetch;

  try {
    await callPreferredModel('system', [{role:'user',content:'hi'}], 'test');
    assert.match(firstUrl, /gemini-3\.8-flash/);
  } finally {
    global.fetch = originalFetch;
    resetGeminiCircuitForTests();
    if (originalGemini === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = originalGemini;
  }
});
