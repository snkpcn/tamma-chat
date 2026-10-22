import test from 'node:test';
import assert from 'node:assert/strict';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';
import { brainRequest, guestId, withHarness } from './helpers/canonical-core-harness';

test('a web turn with real-world database latency returns its answer after eight seconds, with bookkeeping drained', async () => {
  await withHarness(async harness => {
    const inner = harness.fetchMock;
    let modelCalls = 0;
    let identityLanded = false;
    global.fetch = (async (url, init = {}) => {
      const text = String(url);
      if (text.includes('api.openai.com')) modelCalls++;
      if (text.includes('/rest/v1/')) await new Promise(resolve => setTimeout(resolve, 950));
      const response = await inner(url, init);
      if (text.includes('/guest_identities') && init.method === 'POST') identityLanded = true;
      return response;
    }) as typeof fetch;
    const started = Date.now();
    const result = await processThongthaiChatCore(brainRequest('เปิดกี่โมง', guestId('web-real-latency'), 'web'), 'web-real-latency');
    const elapsed = Date.now() - started;
    assert.ok(elapsed >= 8_000, `regression must cross the old deadline: ${elapsed}ms`);
    assert.ok(elapsed < 25_000, `reply exceeded the browser-safe deadline: ${elapsed}ms`);
    assert.match(String(result.payload.message), /06:00–18:00/);
    assert.doesNotMatch(String(result.payload.message), /ตอบไม่ทัน/);
    assert.equal(identityLanded, true, 'bookkeeping is completed before the reply');
    assert.equal(modelCalls, 0, 'regular hours remain grounded without a new model call');
  });
});
