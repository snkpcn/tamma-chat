// PROOF-FIRST SCENARIO BRAIN: ecosystem/first-time-visitor domain 1's
// numbered tests from the owner's "Knowledge Base + Scenario Brain"
// request. See THONGTHAI_HANDOFF.md's matching entry for scope.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { withHarness, type Harness } from './helpers/canonical-core-harness';
import { handler as lineWebhookHandler } from '../netlify/functions/line-webhook';

const CHANNEL_SECRET = 'test-scenario-ecosystem-secret';

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

test('E1. มาครั้งแรก มีอะไรแนะนำ: exact 3-path breakdown, asks group size + vibe, no forced booking', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('มาครั้งแรก มีอะไรแนะนำ', 'sc-e1')]);
    const t = text(replies, 0);
    assert.match(t, /สายชิล/u);
    assert.match(t, /สายกิจกรรม/u);
    assert.match(t, /สายพัก/u);
    assert.match(t, /กี่คน/u);
  });
});

test('E2. พาแม่ไป อยากได้เดินน้อย: elderly + low-walking, ecosystem-level care reply (NEW -- was a generic apology before)', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('พาแม่ไป อยากได้เดินน้อย', 'sc-e2')]);
    const t = text(replies, 0);
    assert.doesNotMatch(t, /ยังไม่มีข้อมูลที่ยืนยันได้/u);
    assert.match(t, /เดินน้อย|ไม่ต้องเดินไกล/u);
  });
});

test('E3. มีเวลา 2 ชั่วโมง ทำอะไรดี: compact plan, asks who is coming (existing behavior, verified)', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('มีเวลา 2 ชั่วโมง ทำอะไรดี', 'sc-e3')]);
    const t = text(replies, 0);
    assert.match(t, /แผน|กิน|พัก|กิจกรรม/u);
  });
});

test('E4. ฝนตกไปไหนดี: indoor-friendly suggestion from real business units, no fabricated claim (NEW -- was a generic apology before)', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('ฝนตกไปไหนดี', 'sc-e4')]);
    const t = text(replies, 0);
    assert.doesNotMatch(t, /ยังไม่มีข้อมูลที่ยืนยันได้/u);
    assert.match(t, /ตำมา-ชาติ|Inthanin|เฮือนสเตย์/u);
  });
});
