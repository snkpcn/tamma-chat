// PR #68 PARTIAL-FAILURE INCIDENT -- owner_general escalation claimed
// success but the owner group never received the alert.
//
// ROOT CAUSE: _ops-notifications.ts's channelForTeam query selected
// `id,team_code,target_type,target_id_enc,display_name,enabled` -- it
// never selected `target_id_hash`, even though PR #68's own dedup-by-
// physical-group logic (added to prevent double-sending when two team
// codes share a LINE group) reads `channel.target_id_hash`. In real
// production, PostgREST only returns columns actually listed in
// `select=`, so `channel.target_id_hash` was `undefined` for EVERY
// resolved channel. The dedup check (`usedTargetHashes.has(channel.
// target_id_hash)`) compares `undefined === undefined`, which is always
// true -- so the SECOND route target in any escalation (owner_general,
// after the domain team) was ALWAYS marked 'duplicate' and never
// actually sent, no matter which real physical group it was bound to.
// composeSafetyIssueResponse treats 'duplicate' as a genuine send (a
// real dedup does mean the message already reached that group), so the
// customer was told both targets were notified while owner_general's
// send was silently skipped.
//
// Confirmed directly against real production data (project
// upaokrprawzhgzeqsdke): the exact live incident's ops_feedback_events
// row (customer_message "พื้นลื่นมาก ตอนเล่น ATV น่ากลัว", created_at
// 2026-09-23 13:35:02 UTC) has internal_notes.notification_targets =
// [{team:"activity",status:"sent"},{team:"owner_general",status:
// "duplicate"}], while ops_notification_deliveries has EXACTLY ONE row
// for this event (the activity send) -- proving owner_general's "sent"
// claim was never backed by a real delivery attempt at all.
// ops_notification_channels confirms activity and owner_general are
// bound to two COMPLETELY DIFFERENT target_id_hash values (not the same
// physical group), so the dedup should never have fired for real reasons.
//
// FIX (two layers):
// 1. channelForTeam's select list now includes target_id_hash (and the
//    NotificationChannel type declares it as required, so a future
//    regression here is a type error, not a silent undefined).
// 2. Defensive: the dedup comparison now requires `channel?.target_id_hash`
//    to be truthy before ever consulting the used-hashes set -- two falsy
//    hashes are never treated as "the same group." Worst case on a future
//    select-list mistake is now a harmless duplicate send, never a
//    silently dropped one.
// 3. tests/helpers/canonical-core-harness.ts's mock now enforces
//    PostgREST's own `select=` column projection on ops_notification_
//    channels' GET handler -- before this fix, the mock returned every
//    stored field regardless of what the query asked for, which is
//    exactly why 964 passing tests never caught this in the first place.
//
// Every test below uses the FULL SIGNED LINE WEBHOOK with realistic
// bound groups, per the incident report's explicit requirement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { withHarness, type Harness } from './helpers/canonical-core-harness';
import { handler as lineWebhookHandler } from '../netlify/functions/line-webhook';

const CHANNEL_SECRET = 'test-safety-escalation-hash-incident-secret';
const ATV_SAFETY_MESSAGE = 'พื้นลื่นมาก ตอนเล่น ATV น่ากลัว';

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

function deliveryStatus(harness: Harness, teamCode: string, eventId = 'feedback-event-1'): string | undefined {
  return harness.notificationDeliveries()
    .find(delivery => delivery.entityId === eventId && delivery.teamCode === teamCode)?.status;
}

function feedbackDeliveries(harness: Harness, eventId = 'feedback-event-1') {
  return harness.notificationDeliveries().filter(delivery => delivery.entityId === eventId);
}

function pushTargetsCalled(harness: Harness): string[] {
  return harness.postsTo('line_push').map(body => String(body.to));
}

test('1. BOTH activity and owner_general bound: each group\'s LINE push is called exactly once, delivery rows exist for both, reply says both only because both really sent', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    harness.programOpsChannel('activity');
    harness.programOpsChannel('owner_general');
    await callLineWebhook([privateEvent(ATV_SAFETY_MESSAGE, 'incident-1')]);

    const pushedTo = pushTargetsCalled(harness);
    assert.equal(pushedTo.filter(t => t === 'line-group-activity').length, 1, 'activity group push must be called exactly once');
    assert.equal(pushedTo.filter(t => t === 'line-group-owner_general').length, 1, 'owner_general group push must be called exactly once -- this is the exact call PR #68 silently skipped');

    const deliveries = harness.postsTo('ops_notification_deliveries');
    assert.equal(deliveries.length, 2, 'a real delivery row must exist for BOTH targets, not just the domain team');

    assert.equal(deliveryStatus(harness, 'activity'), 'sent');
    assert.equal(deliveryStatus(harness, 'owner_general'), 'sent');

    assert.match(text(replies, 0), /ส่งให้ทีมกิจกรรมและเจ้าของตรวจสอบแล้วครับ/u, 'reply may only claim both were notified because both really were');
  });
});

test('2. owner_general push genuinely fails: activity sent, owner_general failed, reply never claims owner success', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    harness.programOpsChannel('activity');
    harness.programOpsChannel('owner_general');
    harness.programLinePushFailure('owner_general');
    await callLineWebhook([privateEvent(ATV_SAFETY_MESSAGE, 'incident-2')]);

    const pushedTo = pushTargetsCalled(harness);
    assert.equal(pushedTo.filter(t => t === 'line-group-activity').length, 1);
    assert.equal(pushedTo.filter(t => t === 'line-group-owner_general').length, 1, 'a real push attempt to owner_general must still happen even though it will fail');

    assert.equal(deliveryStatus(harness, 'activity'), 'sent');
    assert.equal(deliveryStatus(harness, 'owner_general'), 'failed');
    assert.match(text(replies, 0), /ส่งให้ทีมกิจกรรมแล้วครับ ส่วนแจ้งเจ้าของยังไม่สำเร็จ/u);
  });
});

test('3. owner_general not bound: activity sent, owner not_bound, reply never claims owner success', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    harness.programOpsChannel('activity');
    await callLineWebhook([privateEvent(ATV_SAFETY_MESSAGE, 'incident-3')]);

    assert.equal(pushTargetsCalled(harness).filter(t => t === 'line-group-owner_general').length, 0, 'no push should even be attempted when owner_general has no bound channel');
    assert.equal(deliveryStatus(harness, 'activity'), 'sent');
    assert.equal(deliveryStatus(harness, 'owner_general'), undefined, 'unbound owner has no provider delivery row');
    assert.equal(pushTargetsCalled(harness).filter(t => t === 'line-group-owner_general').length, 0);
    assert.match(text(replies, 0), /ส่งให้ทีมกิจกรรมแล้วครับ ส่วนแจ้งเจ้าของยังไม่สำเร็จ/u);
  });
});

test('4. activity missing but owner_general bound: owner sent, activity not_bound, reply is honest', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    harness.programOpsChannel('owner_general');
    await callLineWebhook([privateEvent(ATV_SAFETY_MESSAGE, 'incident-4')]);

    assert.equal(pushTargetsCalled(harness).filter(t => t === 'line-group-owner_general').length, 1);
    assert.equal(harness.feedbackEventRow('feedback-event-1')?.notification_status, 'not_bound', 'primary activity target remains honestly not bound');
    assert.equal(deliveryStatus(harness, 'activity'), undefined, 'unbound activity has no provider delivery row');
    assert.equal(deliveryStatus(harness, 'owner_general'), 'sent');
    assert.match(text(replies, 0), /ส่งให้เจ้าของตรวจสอบแล้วครับ/u);
  });
});

test('5. Regression: a plain (non-safety, non-urgent) activity complaint still routes to activity ONLY, no owner_general escalation', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    harness.programOpsChannel('activity');
    harness.programOpsChannel('owner_general');
    await callLineWebhook([privateEvent('ทีมกิจกรรมพูดไม่สุภาพ', 'incident-5')]);

    const pushedTo = pushTargetsCalled(harness);
    assert.equal(pushedTo.filter(t => t === 'line-group-activity').length, 1);
    assert.equal(pushedTo.filter(t => t === 'line-group-owner_general').length, 0, 'a plain complaint must never also escalate to owner_general');

    assert.equal(deliveryStatus(harness, 'activity'), 'sent');
    assert.equal(deliveryStatus(harness, 'owner_general'), undefined, 'plain complaint never creates an owner escalation delivery');
    assert.equal(feedbackDeliveries(harness).length, 1, 'only the domain-team provider delivery exists');
  });
});

test('6. Regression: "ผูกทีม เจ้าของ" owner_general binding command still works', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    const groupEvent = {
      type: 'message', replyToken: 'reply-incident-6', timestamp: Date.now(),
      source: { type: 'group', groupId: 'incident-owner-group-6', userId: 'staff-1' },
      message: { id: 'msg-incident-6', type: 'text', text: 'ผูกทีม เจ้าของ' },
    };
    await callLineWebhook([groupEvent]);
    assert.match(text(replies, 0), /ผูกกลุ่มนี้กับทีม เจ้าของ\/ทั่วไป แล้วครับ/u);
  });
});
