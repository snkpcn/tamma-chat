// PROOF-FIRST SYSTEM FIX: the real production root cause for "owner group
// receives nothing" was found by querying REAL ops_feedback_events rows
// directly (not guessed) -- every feedback notification since the
// Feedback Operations feature was built failed with Postgres 23514
// (check_violation) on the ops_notification_deliveries INSERT itself,
// before the LINE push was ever attempted. notifyFeedbackEvent
// (_ops-notifications.ts) has ALWAYS correctly called sendTeamMessage
// with entityType:'feedback_event'/deliveryType:'feedback_<type>' --
// the application code was never the bug. ops_notification_deliveries_
// entity_type_check and _delivery_type_check (two CHECK constraints)
// were simply never extended to allow those values when the feedback
// feature was built. Fixed via supabase/migrations/20260923091310_ops_
// notification_deliveries_feedback_v1.sql, applied to production and
// verified directly (a real insert/delete round-trip against the live
// constraint, see THONGTHAI_HANDOFF.md's "Feedback Delivery Constraint"
// entry).
//
// THE TEST-SUITE GAP THIS ALSO CLOSES: this repo's shared harness
// (tests/helpers/canonical-core-harness.ts) NEVER validated entity_type/
// delivery_type against anything -- it accepted any ops_notification_
// deliveries insert unconditionally. That is WHY three pre-existing
// tests (in ops-notifications-owner-general.test.ts and service-mind-
// feedback-notifications.test.ts) already asserted "notification_status
// becomes sent" and were passing -- but FALSELY, because the mock never
// modeled the real constraint that was rejecting every such insert in
// production. Verified this empirically: temporarily reverting the
// harness's constraint check back to the pre-fix (real, historical)
// shape made exactly those 3 pre-existing tests fail, and nothing else.
// This is the honest answer to "why did previous rounds claim feedback
// worked but the owner saw nothing" -- the tests were real, but the
// mock they ran against was more permissive than production.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { withHarness, type Harness } from './helpers/canonical-core-harness';
import { handler as lineWebhookHandler } from '../netlify/functions/line-webhook';

const CHANNEL_SECRET = 'test-feedback-delivery-constraint-secret';

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

const COMPLAINT_TEXT = 'ทองไทยอธิบายไม่รู้เรื่อง เจิดนิสัยไม่ดี';

// ---------------------------------------------------------------------
// 1. Row is actually inserted, with raw text + classification + staff mention.
// ---------------------------------------------------------------------

test('1. feedback row inserted: raw text, system issue classification, AND the staff mention (เจิด) captured', async () => {
  await withHarnessAndLine(async (harness, _replies) => {
    await callLineWebhook([privateEvent(COMPLAINT_TEXT, 'proof-user-1')]);
    const rows = harness.postsTo('ops_feedback_events');
    assert.ok(rows.length >= 1, 'a row must actually be inserted');
    const row = rows[rows.length - 1];
    assert.equal(row.customer_message, COMPLAINT_TEXT, 'raw customer text must be stored, not summarized/altered');
    assert.equal(row.feedback_type, 'system_feedback');
    const mentions = row.person_mentions as Array<{ label: string; kind: string }>;
    assert.ok(
      mentions.some(m => m.label.includes('เจิด')),
      `staff mention "เจิด" must be captured (person_mentions was: ${JSON.stringify(mentions)})`,
    );
  });
});

// ---------------------------------------------------------------------
// 3. Owner notification: with owner_general bound, notification_status
// becomes 'sent' -- this now genuinely proves the DB-layer fix, because
// the harness enforces the real ops_notification_deliveries constraints.
// ---------------------------------------------------------------------

test('3. with owner_general bound, the complaint notification actually sends (notification_status=sent) -- proves the DB constraint fix', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    harness.programOpsChannel('owner_general');
    await callLineWebhook([privateEvent(COMPLAINT_TEXT, 'proof-user-3')]);
    const finalRow = harness.feedbackEventRow('feedback-event-1');
    assert.equal(finalRow?.notification_status, 'sent', 'notification_status must be sent when a team is bound and the delivery insert succeeds');
    assert.match(text(replies, 0), /ส่ง|แจ้ง/u, 'reply should reflect that it was actually routed');
  });
});

// ---------------------------------------------------------------------
// 4. Notification failure: LINE push itself fails -- row remains,
// notification_status=failed, reply never claims success.
// ---------------------------------------------------------------------

test('4. LINE push failure: row remains persisted, notification_status=failed, reply does NOT claim sent', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    harness.programOpsChannel('owner_general');
    const originalFetch = global.fetch;
    global.fetch = (async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      if (href.includes('api.line.me/v2/bot/message/push')) {
        return new Response('rate limited', { status: 429 });
      }
      return originalFetch(url as never, init);
    }) as typeof fetch;
    try {
      await callLineWebhook([privateEvent(COMPLAINT_TEXT, 'proof-user-4')]);
    } finally {
      global.fetch = originalFetch;
    }
    const finalRow = harness.feedbackEventRow('feedback-event-1');
    assert.ok(finalRow, 'the row must remain in the table even when notification fails');
    assert.equal(finalRow?.notification_status, 'failed');
    const t = text(replies, 0);
    assert.doesNotMatch(t, /ส่งเรียบร้อยแล้ว|แจ้งทีมแล้วครับ ✅/u, 'must never claim success when the push failed');
  });
});

// ---------------------------------------------------------------------
// 5. No binding: notification_status=not_bound, reply honest.
// ---------------------------------------------------------------------

test('5. no team bound: notification_status=not_bound, reply is honest (never claims sent)', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    await callLineWebhook([privateEvent(COMPLAINT_TEXT, 'proof-user-5')]);
    const finalRow = harness.feedbackEventRow('feedback-event-1');
    assert.equal(finalRow?.notification_status, 'not_bound');
    const t = text(replies, 0);
    assert.doesNotMatch(t, /ส่งเรียบร้อยแล้ว|แจ้งทีมแล้วครับ ✅/u);
  });
});

// ---------------------------------------------------------------------
// 6. Horse state: after beginner/alone/no concern/no back pain, the next
// response must not ask a vague "detail" question again.
// ---------------------------------------------------------------------

test('6. after beginner/alone/no back pain, the bot moves to duration -- never repeats "ขอรายละเอียดเพิ่ม"', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    const userId = 'proof-user-6';
    await callLineWebhook([privateEvent('อยากขี่ม้า', userId)]);
    await callLineWebhook([privateEvent('เอาทองไทย', userId)]);
    await callLineWebhook([privateEvent('ไม่เคยครับมาคนเดียว', userId)]);
    await callLineWebhook([privateEvent('ไม่กังวลครับ', userId)]);
    const t = text(replies, 3);
    assert.doesNotMatch(t, /ขอรายละเอียดเพิ่ม/u);
    assert.match(t, /30 นาที/u);
    assert.match(t, /60 นาที/u);
  });
});

// ---------------------------------------------------------------------
// 7. Mixed complaint during active horse task overrides, never continues booking.
// ---------------------------------------------------------------------

test('7. mixed complaint sent mid-horse-flow interrupts immediately, never continues booking, staff mention captured', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    const userId = 'proof-user-7';
    await callLineWebhook([privateEvent('อยากขี่ม้า', userId)]);
    await callLineWebhook([privateEvent('เอาทองไทย', userId)]);
    await callLineWebhook([privateEvent(COMPLAINT_TEXT, userId)]);
    const t = text(replies, 2);
    assert.doesNotMatch(t, /เลือกทองไทย|เคยขี่ม้ามาก่อนไหม|แล้วมากี่คนครับ/u);
    const rows = harness.postsTo('ops_feedback_events');
    const latest = rows[rows.length - 1];
    const mentions = latest.person_mentions as Array<{ label: string; kind: string }>;
    assert.ok(mentions.some(m => m.label.includes('เจิด')));
  });
});


test('8. privacy smoke: direct phone/email/url identifiers are redacted in stored feedback and owner LINE notification', async () => {
  await withHarnessAndLine(async (harness, _replies) => {
    harness.programOpsChannel('owner_general');

    const message = 'พื้นลื่นมาก ติดต่อ 081-234-5678 อีเมล test@example.com ดู https://example.com';
    await callLineWebhook([privateEvent(message, 'proof-user-privacy')]);

    const rows = harness.postsTo('ops_feedback_events');
    assert.ok(rows.length >= 1);
    const row = rows[rows.length - 1];

    const stored = JSON.stringify({
      customer_message: row.customer_message,
      summary: row.summary,
    });
    assert.doesNotMatch(stored, /081-234-5678/u);
    assert.doesNotMatch(stored, /test@example\.com/u);
    assert.doesNotMatch(stored, /https:\/\/example\.com/u);
    assert.match(stored, /\[phone\]/u);
    assert.match(stored, /\[email\]/u);
    assert.match(stored, /\[url\]/u);

    const pushes = harness.postsTo('line_push');
    assert.ok(pushes.length >= 1, 'owner notification must actually be pushed');
    const pushed = JSON.stringify(pushes[pushes.length - 1]);
    assert.doesNotMatch(pushed, /081-234-5678/u);
    assert.doesNotMatch(pushed, /test@example\.com/u);
    assert.doesNotMatch(pushed, /https:\/\/example\.com/u);
    assert.match(pushed, /\[phone\]/u);
    assert.match(pushed, /\[email\]/u);
    assert.match(pushed, /\[url\]/u);
  });
});
