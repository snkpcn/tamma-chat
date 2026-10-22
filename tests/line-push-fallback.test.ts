import test from 'node:test';
import assert from 'node:assert/strict';
import { withHarness } from './helpers/canonical-core-harness';
import { deliverLineTexts } from './helpers/line-channel';

// A reply token LINE no longer accepts (400: expired, or spent by an earlier
// delivery) used to leave the customer with no answer at all. The same
// answer is now pushed once, with a per-turn retry key so LINE itself
// refuses a second push for the same turn.

const pushes = (calls: Array<{ endpoint: string }>) => calls.filter(c => c.endpoint === 'message/push');

test('LINE: a rejected reply token gets the same answer pushed once, with a retry key', async () => {
  await withHarness(async harness => {
    const result = await deliverLineTexts(harness, { userId: 'U-push-1', texts: ['สวัสดีครับ'], replyStatus: 400 });
    const reply = result.calls.find(c => c.endpoint === 'message/reply');
    const pushed = pushes(result.calls);
    assert.equal(pushed.length, 1, 'exactly one push');
    assert.equal(pushed[0]!.body.to, 'U-push-1');
    assert.deepEqual(pushed[0]!.body.messages, reply!.body.messages, 'the same answer');
    assert.match(pushed[0]!.headers!.get('x-line-retry-key') ?? '', /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/u);
  });
});

test('LINE: one retry key per turn, and a redelivery of the same event never pushes again', async () => {
  await withHarness(async harness => {
    const first = await deliverLineTexts(harness, { userId: 'U-push-2', texts: ['เปิดกี่โมง'], replyStatus: 400 });
    const firstKey = pushes(first.calls)[0]?.headers?.get('x-line-retry-key');
    const other = await deliverLineTexts(harness, { userId: 'U-push-2', texts: ['มีอะไรให้ทำบ้าง'], replyStatus: 400 });
    const otherKey = pushes(other.calls)[0]?.headers?.get('x-line-retry-key');
    assert.ok(firstKey && otherKey);
    assert.notEqual(firstKey, otherKey, 'one key per turn');
    // A redelivery is skipped by the turn claim before any reply or push.
    const again = await deliverLineTexts(harness, { userId: 'U-push-2', texts: [], rawBody: first.rawBody, replyStatus: 400 });
    assert.equal(pushes(again.calls).length, 0);
  });
});

test('LINE: an accepted reply never pushes; a refused push (409) is not retried', async () => {
  await withHarness(async harness => {
    const ok = await deliverLineTexts(harness, { userId: 'U-push-3', texts: ['สวัสดีครับ'] });
    assert.equal(pushes(ok.calls).length, 0);
    const conflict = await deliverLineTexts(harness, { userId: 'U-push-4', texts: ['สวัสดีครับ'], replyStatus: 400, pushStatus: 409 });
    assert.equal(pushes(conflict.calls).length, 1);
    assert.equal(conflict.status, 200);
  });
});

test('LINE: a reply that fails for another reason (500) is not pushed -- it may have been delivered', async () => {
  await withHarness(async harness => {
    const result = await deliverLineTexts(harness, { userId: 'U-push-5', texts: ['สวัสดีครับ'], replyStatus: 500 });
    assert.equal(pushes(result.calls).length, 0);
  });
});

test('LINE: a group batch with a rejected customer reply never pushes into the group', async () => {
  await withHarness(async harness => {
    const result = await deliverLineTexts(harness, { userId: 'U-push-6', texts: ['สวัสดีครับ'], replyStatus: 400, withGroup: true });
    for (const push of pushes(result.calls)) assert.equal(push.body.to, 'U-push-6');
  });
});

test('failed push returns 503; redelivery sends the stored answer with the same retry key and no core work', async () => {
  await withHarness(async harness => {
    const first = await deliverLineTexts(harness, { userId: 'U-push-retry', texts: ['เปิดกี่โมง'], replyStatus: 400, pushStatus: 503 });
    assert.equal(first.status, 503);
    const original = pushes(first.calls)[0]!;
    const before = harness.modelCallCount();
    const inner = harness.fetchMock;
    const backendCalls: string[] = [];
    harness.fetchMock = (async (url, init) => { backendCalls.push(String(url)); return inner(url, init); }) as typeof fetch;
    const second = await deliverLineTexts(harness, { userId: 'U-push-retry', texts: [], rawBody: first.rawBody });
    assert.equal(second.status, 200);
    const replay = pushes(second.calls)[0]!;
    assert.deepEqual(replay.body, original.body);
    assert.equal(replay.headers!.get('x-line-retry-key'), original.headers!.get('x-line-retry-key'));
    assert.equal(second.calls.filter(c => c.endpoint === 'message/reply').length, 0);
    assert.equal(harness.modelCallCount(), before);
    assert.ok(!backendCalls.some(url => /guest_agent_state|ai_api_cost_events|restaurant_preorders/u.test(url)), 'delivery retry must not run the brain or business writes');
    const third = await deliverLineTexts(harness, { userId: 'U-push-retry', texts: [], rawBody: first.rawBody });
    assert.equal(third.calls.length, 0, 'delivered answer is not sent again');
  });
});

test('a retry-key conflict after an uncertain push is marked delivered', async () => {
  await withHarness(async harness => {
    const first = await deliverLineTexts(harness, { userId: 'U-push-409-retry', texts: ['สวัสดีครับ'], replyStatus: 400, pushStatus: 503 });
    const second = await deliverLineTexts(harness, { userId: 'U-push-409-retry', texts: [], rawBody: first.rawBody, pushStatus: 409 });
    assert.equal(second.status, 200);
    const third = await deliverLineTexts(harness, { userId: 'U-push-409-retry', texts: [], rawBody: first.rawBody });
    assert.equal(third.calls.length, 0);
  });
});

test('a failed initial reply stays retryable without running the brain again', async () => {
  await withHarness(async harness => {
    const first = await deliverLineTexts(harness, { userId: 'U-reply-retry', texts: ['เปิดกี่โมง'], replyStatus: 500 });
    assert.equal(first.status, 503);
    const before = harness.modelCallCount();
    const second = await deliverLineTexts(harness, { userId: 'U-reply-retry', texts: [], rawBody: first.rawBody });
    assert.equal(second.status, 200);
    assert.deepEqual(second.replies[0]?.texts, first.replies[0]?.texts);
    assert.equal(harness.modelCallCount(), before);
    assert.equal(pushes(second.calls).length, 0);
  });
});

test('a later 400 after an uncertain reply never triggers a duplicate push', async () => {
  await withHarness(async harness => {
    const first = await deliverLineTexts(harness, { userId: 'U-reply-uncertain', texts: ['เปิดกี่โมง'], replyStatus: 500 });
    const before = harness.modelCallCount();
    const second = await deliverLineTexts(harness, { userId: 'U-reply-uncertain', texts: [], rawBody: first.rawBody, replyStatus: 400 });
    assert.equal(second.status, 503);
    assert.equal(pushes(second.calls).length, 0);
    assert.equal(harness.modelCallCount(), before);
  });
});

test('outbox outage before processing stays retryable while the claim is live', async () => {
  await withHarness(async harness => {
    const inner = harness.fetchMock;
    harness.fetchMock = (async (url, init) => String(url).includes('/line_customer_deliveries')
      ? new Response('store unavailable', { status: 503 }) : inner(url, init)) as typeof fetch;
    const first = await deliverLineTexts(harness, { userId: 'U-outbox-outage', texts: ['เปิดกี่โมง'] });
    assert.equal(first.status, 503);
    assert.equal(first.calls.length, 0);
    harness.fetchMock = inner;
    const second = await deliverLineTexts(harness, { userId: 'U-outbox-outage', texts: [], rawBody: first.rawBody });
    assert.equal(second.status, 503, 'a processing claim with no answer cannot acknowledge delivery');
    assert.equal(second.calls.length, 0);
    assert.equal(harness.modelCallCount(), 0);
  });
});
