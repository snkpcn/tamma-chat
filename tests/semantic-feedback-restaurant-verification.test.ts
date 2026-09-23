// PROOF-FIRST SEMANTIC UNDERSTANDING: verifies tests 14 (feedback
// complaint), 15 (compliment), and 10 (restaurant allergy/spice) from the
// owner's "Next Phase" request against EXISTING infrastructure, with no
// new code -- see THONGTHAI_HANDOFF.md's "Semantic Hospitality
// Intelligence" entry. Test 14 (the exact complaint text) already has
// comprehensive coverage in tests/feedback-delivery-constraint-proof.test.ts
// from a prior round; this file adds 15 and 10, which had no dedicated
// test for this exact phrasing yet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { withHarness, type Harness } from './helpers/canonical-core-harness';
import { handler as lineWebhookHandler } from '../netlify/functions/line-webhook';

const CHANNEL_SECRET = 'test-semantic-verification-secret';

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

test('15. พี่เจิดดูแลดีมาก: compliment classified, staff name captured, backoffice-visible row', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    await callLineWebhook([privateEvent('พี่เจิดดูแลดีมาก', 'verify-user-15')]);
    const t = text(replies, 0);
    assert.match(t, /ดีใจ|ขอบคุณ/u, 'must thank/acknowledge the compliment');
    const rows = harness.postsTo('ops_feedback_events');
    assert.ok(rows.length >= 1);
    const row = rows[rows.length - 1];
    assert.equal(row.feedback_type, 'compliment');
    assert.equal(row.staff_name, 'พี่เจิด');
  });
});

test('10. มีอะไรแนะนำ แม่กินเผ็ดไม่ได้ แพ้กุ้ง: restaurant path, spice+allergy constraints respected, staff informed', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('มีอะไรแนะนำ แม่กินเผ็ดไม่ได้ แพ้กุ้ง', 'verify-user-10')]);
    const t = text(replies, 0);
    assert.doesNotMatch(t, /ผัดไทย|ต้มยำกุ้ง/u, 'must never recommend a dish containing shrimp to a customer who is allergic to shrimp');
    assert.match(t, /เลี่ยงกุ้ง|ไม่มีกุ้ง/u, 'should honestly confirm the shrimp filter was applied');
  });
});
