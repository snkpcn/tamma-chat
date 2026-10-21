import test from 'node:test';
import assert from 'node:assert/strict';
import { withHarness } from './helpers/canonical-core-harness';
import { deliverLineTexts } from './helpers/line-channel';

// LINE's loading animation (POST /v2/bot/chat/loading/start): one-on-one
// chats only, loadingSeconds in 5..60 steps of 5, it stops when the account
// sends a message. It must be sent before the reply -- a late request would
// show "typing" after the answer -- and it must never cost the reply.

const endpoints = (calls: Array<{ endpoint: string }>) => calls.map(call => call.endpoint);

test('a customer text turn starts the animation for that user, before the reply', async () => {
  await withHarness(async harness => {
    const result = await deliverLineTexts(harness, { userId: 'U-loading', texts: ['เปิดกี่โมง'] });
    assert.deepEqual(endpoints(result.calls), ['chat/loading/start', 'message/reply']);
    const loading = result.calls[0]!.body;
    assert.equal(loading.chatId, 'U-loading');
    assert.ok(Number.isInteger(loading.loadingSeconds) && Number(loading.loadingSeconds) % 5 === 0
      && Number(loading.loadingSeconds) >= 5 && Number(loading.loadingSeconds) <= 60);
    assert.match(result.replies[0]?.texts.join('\n') ?? '', /06:00–18:00/u);
  });
});

test('no animation for a group, nor for a redelivered turn', async () => {
  await withHarness(async harness => {
    const group = await deliverLineTexts(harness, { userId: 'U-unused', texts: [], withGroup: true });
    assert.ok(!endpoints(group.calls).includes('chat/loading/start'), 'groups cannot show it (LINE returns 400)');
    const first = await deliverLineTexts(harness, { userId: 'U-loading-again', texts: ['เปิดกี่โมง'] });
    const again = await deliverLineTexts(harness, { userId: 'U-loading-again', texts: [], rawBody: first.rawBody });
    assert.deepEqual(endpoints(again.calls), [], 'a duplicate delivery is skipped entirely');
  });
});

test('a failing or hanging animation request never costs the reply', async () => {
  await withHarness(async harness => {
    const failing = await deliverLineTexts(harness, { userId: 'U-loading-400', texts: ['เปิดกี่โมง'], loadingStatus: 400 });
    assert.match(failing.replies[0]?.texts.join('\n') ?? '', /06:00–18:00/u);
    const started = Date.now();
    const hanging = await deliverLineTexts(harness, { userId: 'U-loading-slow', texts: ['เปิดกี่โมง'], loadingDelayMs: 20_000 });
    assert.match(hanging.replies[0]?.texts.join('\n') ?? '', /06:00–18:00/u);
    assert.ok(Date.now() - started < 4_000, 'the animation request is cut off quickly');
  });
});
