import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  callPreferredModel,
  LLMAvailabilityError,
} from '../netlify/functions/_thongthai-model-provider';

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status });
}

test('OpenAI-only provider: 429 fails boundedly without hidden Gemini retry', async () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-openai-key';
  let calls = 0;
  global.fetch = (async () => {
    calls += 1;
    return jsonResponse({}, 429);
  }) as typeof fetch;

  try {
    await assert.rejects(
      () => callPreferredModel('system', [{role:'user',content:'hi'}], 'test'),
      (error:unknown) => error instanceof LLMAvailabilityError,
    );
    assert.equal(calls, 1, 'no second provider or Gemini model retry is allowed');
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalKey;
  }
});

test('OpenAI-only provider: missing key fails before any network call', async () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  let calls = 0;
  global.fetch = (async () => {
    calls += 1;
    return jsonResponse({}, 200);
  }) as typeof fetch;

  try {
    await assert.rejects(() => callPreferredModel('system', [{role:'user',content:'hi'}], 'test'));
    assert.equal(calls, 0);
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalKey;
  }
});
