import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  callPreferredModel,
  callResponseComposer,
  callSemanticSupervisor,
  callSemanticReviewer,
  OPENAI_SEMANTIC_PRIMARY_MODEL,
  OPENAI_SEMANTIC_REVIEW_MODEL,
} from '../netlify/functions/_thongthai-model-provider';

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status });
}

test('Human Conversation Recovery: provider is OpenAI-only and primary semantic model is Terra', async () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-openai-key';

  const urls:string[] = [];
  const bodies:any[] = [];
  global.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    urls.push(String(url));
    bodies.push(JSON.parse(String(init?.body ?? '{}')));
    return jsonResponse({ output_text:'{"ok":true}' }, 200);
  }) as typeof fetch;

  try {
    assert.equal(await callSemanticSupervisor('system', [{role:'user',content:'hi'}]), '{"ok":true}');
    assert.equal(urls.length, 1);
    assert.match(urls[0]!, /api\.openai\.com\/v1\/responses/);
    assert.equal(bodies[0].model, OPENAI_SEMANTIC_PRIMARY_MODEL);
    assert.equal(OPENAI_SEMANTIC_PRIMARY_MODEL, 'gpt-5.6-terra');
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalKey;
  }
});

test('Human Conversation Recovery: bounded reviewer uses Sol only when explicitly called', async () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-openai-key';

  const models:string[] = [];
  global.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    models.push(JSON.parse(String(init?.body ?? '{}')).model);
    return jsonResponse({ output_text:'{"ok":true}' }, 200);
  }) as typeof fetch;

  try {
    await callSemanticReviewer('system', [{role:'user',content:'review'}]);
    assert.deepEqual(models, [OPENAI_SEMANTIC_REVIEW_MODEL]);
    assert.equal(OPENAI_SEMANTIC_REVIEW_MODEL, 'gpt-5.6-sol');
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalKey;
  }
});

// This test previously asserted the composer was pinned to Sol. Sol's
// worst-case reservation does not fit a second composed turn inside the
// owner's 2 THB conversation ceiling, so the default moved to the primary
// model and the Sol behavior became an env-only rollback. Both directions
// are asserted here so neither can regress silently.
test('Quality-first final response composer defaults to Terra and reverts to Sol by env alone', async () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.OPENAI_API_KEY;
  const originalComposerModel = process.env.THONGTHAI_RESPONSE_COMPOSER_MODEL;
  process.env.OPENAI_API_KEY = 'test-openai-key';
  delete process.env.THONGTHAI_RESPONSE_COMPOSER_MODEL;

  const models:string[] = [];
  global.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    models.push(JSON.parse(String(init?.body ?? '{}')).model);
    return jsonResponse({ output_text:'{"message":"ตอบแบบมนุษย์ครับ","usedFactKeys":[]}' }, 200);
  }) as typeof fetch;

  try {
    await callResponseComposer('system', [{role:'user',content:'compose'}], 'grounded-response-composition');
    assert.deepEqual(models, [OPENAI_SEMANTIC_PRIMARY_MODEL]);
    assert.equal(OPENAI_SEMANTIC_PRIMARY_MODEL, 'gpt-5.6-terra');

    process.env.THONGTHAI_RESPONSE_COMPOSER_MODEL = 'gpt-5.6-sol';
    await callResponseComposer('system', [{role:'user',content:'compose'}], 'grounded-response-composition');
    assert.deepEqual(models, [OPENAI_SEMANTIC_PRIMARY_MODEL, 'gpt-5.6-sol']);
    assert.equal(OPENAI_SEMANTIC_REVIEW_MODEL, 'gpt-5.6-sol');
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalKey;
    if (originalComposerModel === undefined) delete process.env.THONGTHAI_RESPONSE_COMPOSER_MODEL;
    else process.env.THONGTHAI_RESPONSE_COMPOSER_MODEL = originalComposerModel;
  }
});

test('Human Conversation Recovery: backward-compatible provider entrypoint no longer calls Gemini', async () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-openai-key';
  const urls:string[] = [];

  global.fetch = (async (url: RequestInfo | URL) => {
    urls.push(String(url));
    return jsonResponse({ output_text:'{"ok":true}' }, 200);
  }) as typeof fetch;

  try {
    assert.equal(await callPreferredModel('system', [{role:'user',content:'hi'}], 'test'), '{"ok":true}');
    assert.equal(urls.length, 1);
    assert.ok(urls.every(url => url.includes('api.openai.com')));
    assert.ok(urls.every(url => !url.includes('googleapis.com')));
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalKey;
  }
});