// PROOF-FIRST SCENARIO BRAIN: ATV domain 3's numbered tests from the
// owner's "Knowledge Base + Scenario Brain" request. See
// THONGTHAI_HANDOFF.md's matching entry for scope.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { withHarness, type Harness } from './helpers/canonical-core-harness';
import { handler as lineWebhookHandler } from '../netlify/functions/line-webhook';

const CHANNEL_SECRET = 'test-scenario-atv-secret';

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

test('A2. เด็กซ้อน ATV ได้ไหม: asks age, no guarantee, no duration-first', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('เด็กซ้อน ATV ได้ไหม', 'sc-a2')]);
    const t = text(replies, 0);
    assert.match(t, /อายุ/u);
    assert.doesNotMatch(t, /การันตี(?!ล่วงหน้า)|เลือกระยะเวลา/u);
  });
});

test('A4. ถ้าเบรกไม่เป็นทำไง (mid-flow): team teaches braking before starting', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('อยากขับ ATV', 'sc-a4')]);
    await callLineWebhook([privateEvent('ถ้าเบรกไม่เป็นทำไง', 'sc-a4')]);
    const t = text(replies, 1);
    assert.match(t, /สอน|เบรก/u);
  });
});

test('A5. อยากมันส์ ๆ เร็ว ๆ: honest calibration, no speed guarantee', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('อยากขับ ATV มันส์ ๆ เร็ว ๆ', 'sc-a5')]);
    const t = text(replies, 0);
    assert.doesNotMatch(t, /รับรองเร็วแน่นอน|การันตีความเร็ว/u);
    assert.match(t, /ประเมิน|ทีมงาน/u);
  });
});

test('A6. หลังไม่ค่อยดี เล่น ATV ได้ไหม: back concern acknowledged, care-aware reply', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('หลังไม่ค่อยดี เล่น ATV ได้ไหม', 'sc-a6')]);
    const t = text(replies, 0);
    assert.match(t, /เข้าใจ|มีเรื่องสุขภาพ/u);
    assert.doesNotMatch(t, /เลือกระยะเวลา/u);
  });
});
