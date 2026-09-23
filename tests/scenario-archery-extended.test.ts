// PROOF-FIRST SCENARIO BRAIN: archery domain 4's numbered tests from the
// owner's "Knowledge Base + Scenario Brain" request. See
// THONGTHAI_HANDOFF.md's matching entry for scope.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { withHarness, type Harness } from './helpers/canonical-core-harness';
import { handler as lineWebhookHandler } from '../netlify/functions/line-webhook';

const CHANNEL_SECRET = 'test-scenario-archery-secret';

type CapturedReply = { replyToken: string; messages: Array<{ type: string; text?: string }> };

function installLineReplyCapture(): { restore: () => void; replies: CapturedReply[] } {
  const original = global.fetch;
  const replies: CapturedReply[] = [];
  global.fetch = (async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    if (href.includes('api.line.me/v2/bot/message/reply')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as CapturedReply;
      replies.push(body);
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return original(url as never, init);
  }) as typeof fetch;
  return { restore: () => { global.fetch = original; }, replies };
}

async function callLineWebhook(events: unknown[]) {
  const body = JSON.stringify({ destination: 'test-destination', events });
  const signature = createHmac('sha256', CHANNEL_SECRET).update(body, 'utf8').digest('base64');
  return lineWebhookHandler(
    { httpMethod: 'POST', headers: { 'x-line-signature': signature }, body } as never,
    {} as never,
  );
}

function privateEvent(text: string, userId: string) {
  return {
    type: 'message',
    replyToken: `reply-${userId}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    source: { type: 'user', userId },
    message: { id: `msg-${userId}-${Math.random().toString(36).slice(2, 8)}`, type: 'text', text },
  };
}

async function withLineSecret<T>(run: () => Promise<T>): Promise<T> {
  const original = process.env.LINE_CHANNEL_SECRET;
  process.env.LINE_CHANNEL_SECRET = CHANNEL_SECRET;
  try {
    return await run();
  } finally {
    if (original === undefined) delete process.env.LINE_CHANNEL_SECRET;
    else process.env.LINE_CHANNEL_SECRET = original;
  }
}

async function withHarnessAndLine<T>(run: (harness: Harness, replies: CapturedReply[]) => Promise<T>): Promise<T> {
  return withHarness(harness => withLineSecret(async () => {
    const capture = installLineReplyCapture();
    try {
      return await run(harness, capture.replies);
    } finally {
      capture.restore();
    }
  }));
}

function text(replies: CapturedReply[], index: number): string {
  return replies[index]?.messages.map(m => m.text ?? '').join(' ') ?? '';
}

test('AR1. อยากยิงธนู ไม่เคยยิง: beginner gets basic-handling teaching, not silence', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('อยากยิงธนู ไม่เคยยิง', 'sc-ar1')]);
    const t = text(replies, 0);
    assert.match(t, /สอน|จับธนู/u);
  });
});

test('AR2. เจ็บไหล่ ยิงธนูได้ไหม: shoulder concern acknowledged (regression check)', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('เจ็บไหล่ ยิงธนูได้ไหม', 'sc-ar2')]);
    const t = text(replies, 0);
    assert.match(t, /ไหล่/u);
  });
});

test('AR3. เด็ก 7 ขวบเล่นได้ไหม (mid-flow): age parsed, guardian + team teaching, no safety guarantee', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('อยากยิงธนู ไม่เคยยิง', 'sc-ar3')]);
    await callLineWebhook([privateEvent('เด็ก 7 ขวบเล่นได้ไหม', 'sc-ar3')]);
    const t = text(replies, 1);
    assert.match(t, /7 ขวบ/u);
    assert.match(t, /ผู้ปกครอง/u);
    assert.doesNotMatch(t, /ปลอดภัยแน่นอน/u);
  });
});

test('AR4. ถ่ายรูปกับธนูเฉย ๆ ได้ไหม: photo-only goal, no shooting pushed', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('ถ่ายรูปกับธนูเฉย ๆ ได้ไหม', 'sc-ar4')]);
    const t = text(replies, 0);
    assert.match(t, /ถ่ายรูป/u);
    assert.doesNotMatch(t, /สอน.*จับธนู|เคยยิง/u);
  });
});
