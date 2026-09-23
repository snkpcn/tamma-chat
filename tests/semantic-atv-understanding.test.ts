// PROOF-FIRST SEMANTIC UNDERSTANDING: ATV domain tests (7-8) from the
// owner's "Next Phase" request. See THONGTHAI_HANDOFF.md's "Semantic
// Hospitality Intelligence" entry for scope -- ATV got a minimal, new
// care-intro responder (no full booking-task flow yet, unlike horse
// riding); the safety-feedback test (8) needed no new code since the
// existing feedback pipeline already classifies it correctly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { withHarness, type Harness } from './helpers/canonical-core-harness';
import { handler as lineWebhookHandler } from '../netlify/functions/line-webhook';

const CHANNEL_SECRET = 'test-semantic-atv-secret';

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

test('7. อยากขับ ATV ไม่เคยขับ กลัวเร็ว: beginner + speed fear understood, slow start + team briefing, no payment/duration-first', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('อยากขับ ATV ไม่เคยขับ กลัวเร็ว', 'atv-user-7')]);
    const t = text(replies, 0);
    assert.doesNotMatch(t, /เลือกระยะเวลา\s*30|ชำระเงิน|โอนเงิน/u, 'must not rush to duration or payment');
    assert.match(t, /ช้า\s*ๆ|บรีฟ/u, 'must offer a slow start / team briefing');
    assert.doesNotMatch(t, /ขอรายละเอียดเพิ่ม/u, 'must never fall through to the generic vague fallback');
  });
});

test('8. พื้นลื่นมาก ตอนเล่น ATV น่ากลัว: classified as safety feedback, notifies owner/activity, visible in backoffice table', async () => {
  await withHarnessAndLine(async (harness, _replies) => {
    harness.programOpsChannel('activity');
    await callLineWebhook([privateEvent('พื้นลื่นมาก ตอนเล่น ATV น่ากลัว', 'atv-user-8')]);
    const rows = harness.postsTo('ops_feedback_events');
    assert.ok(rows.length >= 1, 'a feedback row must be inserted');
    const row = rows[rows.length - 1];
    assert.equal(row.feedback_type, 'safety_issue');
    assert.equal(row.business_unit, 'activity');
  });
});
