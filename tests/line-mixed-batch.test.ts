import test from 'node:test';
import assert from 'node:assert/strict';
import { withHarness } from './helpers/canonical-core-harness';
import { deliverLineTexts } from './helpers/line-channel';

const PRICE = 'ขี่ม้าราคาเท่าไหร่';
const PRICE_ANSWER = /ขี่ม้ามี 30 นาที 300 บาท/u;
const groupRouted = (calls: Array<{ endpoint: string; body: Record<string, unknown> }>) =>
  calls.some(call => call.endpoint === 'snk-money' && JSON.stringify(call.body).includes('C-test-group'));

test('a mixed batch: slow group work past the hard deadline no longer costs the customer their answer', async () => {
  await withHarness(async harness => {
    const started = Date.now();
    // 9.5 s is past the 9 s hard deadline: before, the reply was skipped.
    const result = await deliverLineTexts(harness, { userId: 'U-mixed-slow', texts: [PRICE], withGroup: true, opsDelayMs: 9_500 });
    assert.equal(result.status, 200);
    assert.match(result.replies[0]?.texts.join('\n') ?? '', PRICE_ANSWER, 'the customer gets the real answer');
    const reply = result.calls.find(call => call.endpoint === 'message/reply');
    assert.ok(reply, 'the reply was sent');
    assert.ok(groupRouted(result.calls), 'the group message still reached the ops router');
    assert.ok(Date.now() - started >= 9_500);
  });
});

test('a mixed batch: when the ops router is down the customer is answered, and the batch stays retryable for ops', async () => {
  await withHarness(async harness => {
    const first = await deliverLineTexts(harness, { userId: 'U-mixed-down', texts: [PRICE], withGroup: true, opsStatus: 500 });
    assert.equal(first.status, 503, 'LINE must redeliver: the ops message was not handled');
    assert.match(first.replies[0]?.texts.join('\n') ?? '', PRICE_ANSWER);

    // LINE redelivers the same batch once the router is back.
    const again = await deliverLineTexts(harness, { userId: 'U-mixed-down', texts: [], rawBody: first.rawBody });
    assert.equal(again.status, 200);
    assert.ok(groupRouted(again.calls), 'the ops message is handled on redelivery');
    assert.equal(again.calls.filter(call => call.endpoint === 'message/reply').length, 0, 'the customer is not answered twice');
  });
});

test('single-kind batches keep their path: group-only reaches only the router, customer-only never calls it', async () => {
  await withHarness(async harness => {
    const groupOnly = await deliverLineTexts(harness, { userId: 'U-unused', texts: [], withGroup: true });
    assert.equal(groupOnly.status, 200);
    assert.ok(groupRouted(groupOnly.calls));
    assert.equal(groupOnly.calls.filter(call => call.endpoint === 'message/reply').length, 0);

    const groupDown = await deliverLineTexts(harness, { userId: 'U-unused', texts: [], withGroup: true, opsStatus: 500 });
    assert.equal(groupDown.status, 503);

    const customerOnly = await deliverLineTexts(harness, { userId: 'U-customer-only', texts: [PRICE] });
    assert.equal(customerOnly.status, 200);
    assert.match(customerOnly.replies[0]?.texts.join('\n') ?? '', PRICE_ANSWER);
    assert.equal(customerOnly.calls.filter(call => call.endpoint === 'snk-money').length, 0);
  });
});
