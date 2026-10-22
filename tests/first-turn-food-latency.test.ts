import test from 'node:test';
import assert from 'node:assert/strict';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';
import { brainRequest, guestId, withHarness } from './helpers/canonical-core-harness';

for (const channel of ['web', 'line'] as const) {
  test(`${channel}: the first bare food request answers without waiting for a model or unrelated catalogs`, async () => {
    await withHarness(async harness => {
      const inner = harness.fetchMock;
      const unrelatedReads: string[] = [];
      let modelCalls = 0;
      global.fetch = (async (url, init = {}) => {
        const text = String(url);
        if (/api\.openai\.com|generativelanguage\.googleapis\.com/.test(text)) {
          modelCalls++;
          throw new Error('Model unavailable on first request');
        }
        if (/\/rest\/v1\/(?:activity_|service_resources|restaurant_menu|otop_|community_offerings|world_facts)/.test(text)) {
          unrelatedReads.push(text);
        }
        if (channel === 'web' && text.includes('/rest/v1/')) {
          await new Promise(resolve => setTimeout(resolve, 350));
        }
        return inner(url, init);
      }) as typeof fetch;
      const id = guestId(`first-food-${channel}`);
      const started = Date.now();
      const result = await processThongthaiChatCore(brainRequest('อยากกิน', id, channel), 'first-food');
      assert.ok(Date.now() - started < 8_000, 'a first food question must finish inside the old timeout too');
      assert.equal(result.statusCode, 200);
      assert.match(String(result.payload.message), /เผ็ด.*แพ้อาหาร/u);
      assert.doesNotMatch(String(result.payload.message), /ตอบไม่ทัน|ส่งข้อความเดิม/u);
      assert.equal(modelCalls, 0);
      assert.deepEqual(unrelatedReads, [], 'a preference question needs no business inventory');
      assert.equal(harness.postsTo('bookings').length, 0);
      assert.ok(harness.postsTo('ai_response_turns').length > 0, 'keep response telemetry');
    });
  });
}
