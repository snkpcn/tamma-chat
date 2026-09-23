// HORSE UX PRODUCTION GAP: PR #61's fix was correct in code but never
// actually protected production, because it only bypassed the legacy LINE
// booking flow when `booking_sessions` had NO existing row for the guest
// (`if (!session && isActivityIntentStartMessage(text)) return false;`).
// Every test in the prior round used a brand-new guest, so `session` was
// always null there -- but this test harness itself never modeled
// `booking_sessions` at all before this file (any GET fell through to the
// generic "unmodeled -> []" default), so EVERY prior test across the whole
// suite implicitly assumed an empty table, silently matching "no session"
// instead of real production state. A real LINE account that has been
// tested against repeatedly over the course of this engagement has a
// real, non-null `booking_sessions` row, so the `!session` guard never
// fired and the legacy flow's own "เลือกระยะเวลา" prompt kept answering
// "อยากขี่ม้า" in production even after PR #61 deployed.
//
// Fixed: `booking_sessions` is now modeled by the shared harness
// (setBookingSession/getBookingSession), and shouldConsumeLegacyLineBookingTurn's
// bare-intent-start bypass is now UNCONDITIONAL -- checked before the
// `!session` branch, not only when session is null.
//
// Also fixed a second, real gap the owner's exact reproduction surfaced:
// "จะขี่ทองไทย" (a riding verb attached directly to a specific horse's
// name, but without the generic word "ม้า") was being treated as
// ambiguous -- same as a bare "เอาทองไทย"/"ทองไทย" -- and got the "horse
// or assistant?" clarification even with zero prior context, even though
// naming a riding verb together with the horse's name leaves nothing
// genuinely ambiguous. hasRidingVerbAttachedToHorseName now recognizes
// this shape and lets it select immediately, with or without established
// context, while a bare name alone (no riding verb) still correctly asks
// for context.
//
// See THONGTHAI_HANDOFF.md's "Horse UX Production Gap" entry for the full
// trace.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { withHarness, type Harness } from './helpers/canonical-core-harness';
import { handler as lineWebhookHandler } from '../netlify/functions/line-webhook';

const CHANNEL_SECRET = 'test-horse-ux-production-gap-secret';

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

// Mirrors line-webhook.ts's own lineGuestId exactly -- needed here only to
// look up harness.guestDbId(anonymousId) for seeding a stale booking
// session against the SAME guest a subsequent private message will use.
function lineGuestId(userId: string): string {
  const hex = createHash('sha256').update('tamma-line:' + userId, 'utf8').digest('hex').slice(0, 32).split('');
  hex[12] = '5';
  const variant = parseInt(hex[16], 16);
  hex[16] = ((variant & 0x3) | 0x8).toString(16);
  const value = hex.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`;
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

// ---------------------------------------------------------------------
// The actual production-shaped reproduction: a STALE, unrelated
// booking_sessions row already exists for this guest (as a real
// production LINE account tested many times over this engagement would
// have), BEFORE the bare "อยากขี่ม้า" is ever sent.
// ---------------------------------------------------------------------

test('1. STALE existing booking_sessions row: "อยากขี่ม้า" still gets the warm intro, never the legacy duration prompt', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    const userId = 'prod-gap-user-1';
    // Establish the guest first (a harmless prior message), then seed a
    // stale, unrelated session exactly like a real repeatedly-tested LINE
    // account would have.
    await callLineWebhook([privateEvent('เห้ยยย', userId)]);
    const guestDbId = harness.guestDbId(lineGuestId(userId));
    assert.ok(guestDbId, 'guest must exist after the first message');
    harness.setBookingSession(guestDbId!, {
      service_type: 'activity',
      resource_code: 'activity-atv',
      status: 'collecting',
      quantity: 60,
      updated_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(),
    });

    await callLineWebhook([privateEvent('อยากขี่ม้า', userId)]);
    const text = replies[1].messages.map(m => m.text ?? '').join(' ');
    assert.doesNotMatch(text, /เลือกระยะเวลา\s*30/u, 'must never surface the legacy duration prompt, even with a stale unrelated session present');
    assert.match(text, /ทองไทย/u);
    assert.match(text, /ภาราดร/u);
  });
});

test('2. "อยากขี่ม้า" then "เอาทองไทย" selects the horse, no clarification (fresh guest, through the full webhook)', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    const userId = 'prod-gap-user-2';
    await callLineWebhook([privateEvent('อยากขี่ม้า', userId)]);
    await callLineWebhook([privateEvent('เอาทองไทย', userId)]);
    const text = replies[1].messages.map(m => m.text ?? '').join(' ');
    assert.match(text, /เลือกทองไทย/u);
    assert.doesNotMatch(text, /หรือเรียกทองไทยผู้ช่วยแชท/u);
  });
});

test('3. "อยากขี่ม้า" then "จะขี่ทองไทย" selects the horse, no clarification', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    const userId = 'prod-gap-user-3';
    await callLineWebhook([privateEvent('อยากขี่ม้า', userId)]);
    await callLineWebhook([privateEvent('จะขี่ทองไทย', userId)]);
    const text = replies[1].messages.map(m => m.text ?? '').join(' ');
    assert.match(text, /เลือกทองไทย/u);
    assert.doesNotMatch(text, /หรือเรียกทองไทยผู้ช่วยแชท/u);
  });
});

test('4. bare "เอาทองไทย" with NO context: still asks for clarification', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('เอาทองไทย', 'prod-gap-user-4')]);
    assert.match(replies[0].messages[0]?.text ?? '', /หมายถึง/u);
  });
});

test('5. "จะขี่ทองไทย" with NO prior context: explicit riding+name intent selects immediately, no clarification', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('จะขี่ทองไทย', 'prod-gap-user-5')]);
    const text = replies[0].messages.map(m => m.text ?? '').join(' ');
    assert.match(text, /เลือกทองไทย/u);
    assert.doesNotMatch(text, /หรือเรียกทองไทยผู้ช่วยแชท/u);
  });
});

test('6. bare "ทองไทย" with NO context (no riding verb at all): still asks for clarification', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('ทองไทย', 'prod-gap-user-6')]);
    assert.match(replies[0].messages[0]?.text ?? '', /หมายถึง/u);
  });
});

test('7. horse comparison with no context: comparison, no booking forced', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('ทองไทยกับภาราดรต่างกันยังไง', 'prod-gap-user-7')]);
    const text = replies[0].messages.map(m => m.text ?? '').join(' ');
    assert.doesNotMatch(text, /เลือกม้า/u);
  });
});

test('8. "อยากขี่ม้า" alone: the legacy duration prompt text must not appear anywhere in the reply', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('อยากขี่ม้า', 'prod-gap-user-8')]);
    const text = replies[0].messages.map(m => m.text ?? '').join(' ');
    assert.doesNotMatch(text, /เลือกระยะเวลา 30, 60 หรือ 90 นาทีได้เลย/u);
  });
});

// ---------------------------------------------------------------------
// Regression: an ACTIVE, non-stale, real legacy booking session (e.g. the
// customer already picked ATV and supplied a duration) must still work
// exactly as before -- the unconditional bypass must not swallow real,
// in-progress bookings.
// ---------------------------------------------------------------------

test('9. an ACTIVE ATV booking session continues to work when the customer supplies a duration', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    const userId = 'prod-gap-user-9';
    await callLineWebhook([privateEvent('เห้ยยย', userId)]);
    const guestDbId = harness.guestDbId(lineGuestId(userId));
    harness.setBookingSession(guestDbId!, {
      service_type: 'activity',
      resource_code: 'activity-atv',
      status: 'collecting',
      updated_at: new Date().toISOString(),
    });
    await callLineWebhook([privateEvent('30 นาที', userId)]);
    // Not asserting exact wording (that's the legacy flow's own concern,
    // unchanged by this fix) -- only that SOME reply came through and it
    // is not the horse-specific warm intro (proving the legacy session
    // continuation path still runs for genuinely active sessions).
    const text = replies[1].messages.map(m => m.text ?? '').join(' ');
    assert.doesNotMatch(text, /ทองไทย.*ภาราดร/su);
  });
});
