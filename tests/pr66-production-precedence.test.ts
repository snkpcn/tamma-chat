// PR #66 PRODUCTION FAILURE FIX -- proof suite.
//
// PR #66 (the prior "Knowledge Base + Scenario Brain" round) passed
// 936/936 tests and was merged, but live production still returned the
// legacy transactional "เลือกระยะเวลา 30, 60 หรือ 90 นาที" prompt for
// horse-fear, ATV-fear, and ATV-safety messages -- exactly the cases that
// round's own tests claimed were fixed.
//
// ROOT CAUSE: every prior round's test used a FRESH userId per test, so a
// legacy `booking_sessions` row never existed when the semantic
// care/risk-signal message was sent. _operations-db.ts's
// shouldConsumeLegacyLineBookingTurn had a `hasCareOrRiskSignal` guard
// (added in the round before this one) that was scoped to `if (!session)`
// -- it only protected a GENUINELY fresh conversation. The moment ANY
// legacy booking_sessions row already existed (even one an innocuous
// earlier message legitimately created, e.g. a bare "อยากขับ ATV"), a
// LATER, genuine safety/care message was never checked against this guard
// at all, and the legacy flow resumed and answered with its own
// transactional prompt, completely ignoring the safety/care content. This
// is the EXACT same bug class isActivityIntentStartMessage's own check
// (right above it in the same function) already had to be fixed for once
// before (see horse-service-mind-ux.test.ts) -- the fix repeated the
// mistake for a second guard added later, and no test with an EXISTING
// session ever existed to catch it.
//
// FIX: hasCareOrRiskSignal is now UNCONDITIONAL (checked before ANY
// session-status branching), exactly matching isActivityIntentStartMessage's
// own precedent immediately above it.
//
// Tests 4 and 5 below are the REGRESSION-PROOF tests this incident
// demanded: they first establish a REAL legacy booking_sessions row via a
// genuine prior turn (not a mock/seed shortcut), through the full signed
// LINE webhook, exactly reproducing the live failure sequence, then assert
// the safety/care override still wins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { withHarness, type Harness } from './helpers/canonical-core-harness';
import { handler as lineWebhookHandler } from '../netlify/functions/line-webhook';

const CHANNEL_SECRET = 'test-pr66-production-precedence-secret';
const DURATION_PROMPT_RE = /เลือกระยะเวลา\s*30,?\s*60\s*หรือ\s*90\s*นาที/u;

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

// ---------------------------------------------------------------------
// 1-3: fresh conversations, exact live-reported phrases.
// ---------------------------------------------------------------------

test('1. "อยากขี่ม้า ไม่เคยเลย กลัวตก" gets horse care mode, never the legacy duration prompt', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('อยากขี่ม้า ไม่เคยเลย กลัวตก', 'pr66-user-1')]);
    const t = text(replies, 0);
    assert.doesNotMatch(t, DURATION_PROMPT_RE);
    assert.match(t, /ไม่ต้องกังวล|เริ่มแบบชิล|มือใหม่/u);
  });
});

test('2. "อยากขับ ATV ไม่เคยขับ กลัวเร็ว" gets ATV slow-start/team-briefing care mode, never the legacy duration prompt', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('อยากขับ ATV ไม่เคยขับ กลัวเร็ว', 'pr66-user-2')]);
    const t = text(replies, 0);
    assert.doesNotMatch(t, DURATION_PROMPT_RE);
    assert.match(t, /บรีฟ|เริ่มขับช้า/u);
  });
});

test('3. "พื้นลื่นมาก ตอนเล่น ATV น่ากลัว" gets safety feedback persisted, never the legacy duration prompt', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    await callLineWebhook([privateEvent('พื้นลื่นมาก ตอนเล่น ATV น่ากลัว', 'pr66-user-3')]);
    const t = text(replies, 0);
    assert.doesNotMatch(t, DURATION_PROMPT_RE);
    assert.match(t, /ความปลอดภัย|แจ้งทีม/u);
    const events = harness.postsTo('ops_feedback_events');
    assert.ok(events.length >= 1, 'the safety report must be persisted');
    assert.equal(events[events.length - 1].feedback_type, 'safety_issue');
  });
});

// ---------------------------------------------------------------------
// 4-5: THE REGRESSION-PROOF TESTS -- an EXISTING legacy booking_sessions
// row (established via a real prior turn through the real webhook, the
// exact live sequence) must not swallow a later safety/care message.
// ---------------------------------------------------------------------

test('4. WITH an existing active ATV booking session, "พื้นลื่นมาก ตอนเล่น ATV น่ากลัว" still overrides -- not booking continuation', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    const userId = 'pr66-user-4';
    // Turn 1: a genuinely bare, risk-free activity start -- legitimately
    // establishes a real legacy booking_sessions row via handleLineBookingMessage.
    await callLineWebhook([privateEvent('อยากขับ ATV', userId)]);
    assert.match(text(replies, 0), DURATION_PROMPT_RE, 'sanity check: turn 1 must genuinely have started a legacy session');
    // Turn 2: the safety report, sent mid-session -- this is the exact
    // live failure sequence (production incident this test proves fixed).
    await callLineWebhook([privateEvent('พื้นลื่นมาก ตอนเล่น ATV น่ากลัว', userId)]);
    const t = text(replies, 1);
    assert.doesNotMatch(t, DURATION_PROMPT_RE, 'the existing session must NOT swallow the safety report');
    assert.match(t, /ความปลอดภัย|แจ้งทีม/u);
    const events = harness.postsTo('ops_feedback_events');
    assert.ok(events.length >= 1, 'the safety report must still be persisted even with an active session');
    assert.equal(events[events.length - 1].feedback_type, 'safety_issue');
  });
});

test('5. WITH an existing active horse booking session, "อยากขี่ม้า ไม่เคยเลย กลัวตก" still overrides -- not duration-first', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    const userId = 'pr66-user-5';
    // Turn 1: "จองขี่ม้า" (contains "จอง", NOT the bare
    // isActivityIntentStartMessage phrase) legitimately establishes a real
    // legacy horse booking_sessions row.
    await callLineWebhook([privateEvent('จองขี่ม้า', userId)]);
    assert.match(text(replies, 0), DURATION_PROMPT_RE, 'sanity check: turn 1 must genuinely have started a legacy session');
    // Turn 2: the fear/care message, sent mid-session.
    await callLineWebhook([privateEvent('อยากขี่ม้า ไม่เคยเลย กลัวตก', userId)]);
    const t = text(replies, 1);
    assert.doesNotMatch(t, DURATION_PROMPT_RE, 'the existing session must NOT swallow the care signal');
    assert.match(t, /ไม่ต้องกังวล|เริ่มแบบชิล|มือใหม่/u);
  });
});

// ---------------------------------------------------------------------
// 6: restaurant no-hallucination / allergy-safety guard.
// ---------------------------------------------------------------------

test('6. restaurant allergy question ("แม่กินเผ็ดไม่ได้ แพ้กุ้ง") excludes shrimp items and tells the customer to notify staff', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('ร้านอาหารมีอะไรแนะนำ แม่กินเผ็ดไม่ได้ แพ้กุ้ง', 'pr66-user-6')]);
    const t = text(replies, 0);
    assert.doesNotMatch(t, /ผัดไทย|ต้มยำกุ้ง/u, 'shrimp-containing menu items must never be recommended for a shrimp allergy');
    assert.match(t, /แจ้งพนักงาน/u, 'must explicitly ask the customer to notify staff (cross-contact cannot be ruled out by ingredient text alone)');
  });
});

// ---------------------------------------------------------------------
// 7: short, ambiguous Thai fragments get a clarifying question, never the
// generic "คิดช้ากว่าปกติ" degraded-provider apology.
// ---------------------------------------------------------------------

test('7. "สติ" gets a graceful clarification, never the generic slow-fallback apology', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('สติ', 'pr66-user-7')]);
    const t = text(replies, 0);
    assert.doesNotMatch(t, /คิดช้ากว่าปกติ/u);
    assert.match(t, /ตั้งสติ|ถามเรื่องไหนต่อ/u);
  });
});

// ---------------------------------------------------------------------
// 8: blanket negative assertion -- no care/safety compound message may
// EVER get the legacy duration-first prompt, across every scenario above.
// ---------------------------------------------------------------------

test('8. no response to any care/safety compound message contains the legacy duration-first prompt', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('อยากขี่ม้า ไม่เคยเลย กลัวตก', 'pr66-user-8a')]);
    await callLineWebhook([privateEvent('อยากขับ ATV ไม่เคยขับ กลัวเร็ว', 'pr66-user-8b')]);
    await callLineWebhook([privateEvent('พื้นลื่นมาก ตอนเล่น ATV น่ากลัว', 'pr66-user-8c')]);
    const userId8d = 'pr66-user-8d';
    await callLineWebhook([privateEvent('อยากขับ ATV', userId8d)]);
    await callLineWebhook([privateEvent('พื้นลื่นมาก ตอนเล่น ATV น่ากลัว', userId8d)]);
    for (let i = 0; i < replies.length; i += 1) {
      const t = text(replies, i);
      if (i === 3) {
        assert.match(t, DURATION_PROMPT_RE, 'reply 3 is the legitimate bare session-start, expected to carry the prompt');
        continue;
      }
      assert.doesNotMatch(t, DURATION_PROMPT_RE, `reply ${i} must not contain the legacy duration-first prompt: ${t}`);
    }
  });
});
