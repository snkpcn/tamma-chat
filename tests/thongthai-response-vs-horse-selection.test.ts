// Urgent bugfix: "ทองไทย" is a real, deliberate name collision -- the
// bot's own name AND a horse's name. activityAssetFromText matches it
// purely on lexical grounds, so a message commenting on Thongthai's OWN
// answers ("ทองไทยตอบยาวไป") was being misread as selecting the horse
// (root cause: activityBookingFallbackDraft's hasHorseBookingContext used
// to treat ANY second-plus conversation turn as sufficient horse-booking
// context, with no check that the conversation was ever actually about
// horses). See thongthai-chat.ts's activityBookingFallbackDraft and
// _service-mind-feedback-intent.ts's THONGTHAI_RESPONSE_MENTION for the
// fix. Every test here goes through the real processThongthaiChatCore
// entry point, never a hand-constructed classifier call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withHarness, guestId, brainRequest } from './helpers/canonical-core-harness';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';

function msg(payload: unknown): string {
  return String((payload as { message: string }).message);
}

async function ask(seed: string, message: string, history: Array<{ role: 'user' | 'assistant'; content: string }> = []) {
  const gid = guestId(seed);
  return processThongthaiChatCore(brainRequest(message, gid, 'web', history), 'evt-1');
}

const HORSE_SELECTION_MARKER = /เลือกม้า|ล็อกตัวเลือกเป็น|จองขี่ม้า/u;

// ---------------------------------------------------------------------
// A. System feedback must never become horse selection
// ---------------------------------------------------------------------

test('A1. "ทองไทยตอบยาวไป": system_feedback, never horse selection, no booking-detail prompt', async () => {
  await withHarness(async harness => {
    const r = await ask('rvh-a1', 'ทองไทยตอบยาวไป');
    assert.equal(r.statusCode, 200);
    const text = msg(r.payload);
    assert.doesNotMatch(text, HORSE_SELECTION_MARKER, 'must never be read as horse selection');
    assert.doesNotMatch(text, /วันที่.*เวลา.*ระยะเวลา.*จำนวนผู้ขี่/u, 'must never prompt for booking details');
    const events = harness.postsTo('ops_feedback_events');
    assert.equal(events.length, 1);
    assert.equal(events[0].feedback_type, 'system_feedback');
    assert.equal(events[0].business_unit, 'system');
    assert.equal(harness.postsTo('bookings').length, 0);
  });
});

test('A2. "ทองไทยตอบไม่ตรง": system_feedback, no horse selection', async () => {
  await withHarness(async harness => {
    const r = await ask('rvh-a2', 'ทองไทยตอบไม่ตรง');
    assert.equal(r.statusCode, 200);
    assert.doesNotMatch(msg(r.payload), HORSE_SELECTION_MARKER);
    const events = harness.postsTo('ops_feedback_events');
    assert.equal(events.length, 1);
    assert.equal(events[0].feedback_type, 'system_feedback');
  });
});

test('A3. "บอทตอบยาวไป": system_feedback', async () => {
  await withHarness(async harness => {
    const r = await ask('rvh-a3', 'บอทตอบยาวไป');
    assert.equal(r.statusCode, 200);
    const events = harness.postsTo('ops_feedback_events');
    assert.equal(events.length, 1);
    assert.equal(events[0].feedback_type, 'system_feedback');
  });
});

test('A4. "ระบบทองไทยตอบมั่ว": system_feedback', async () => {
  await withHarness(async harness => {
    const r = await ask('rvh-a4', 'ระบบทองไทยตอบมั่ว');
    assert.equal(r.statusCode, 200);
    const events = harness.postsTo('ops_feedback_events');
    assert.equal(events.length, 1);
    assert.equal(events[0].feedback_type, 'system_feedback');
    assert.equal(events[0].business_unit, 'system');
  });
});

test('A5. Prior safety flow then system feedback: turn 1 stays safety_issue, turn 2 becomes system_feedback, no horse ever booked', async () => {
  await withHarness(async harness => {
    const gid = guestId('rvh-a5');
    const turn1Message = 'พื้นลื่นมาก ตอนเล่น ATV น่ากลัว';
    const r1 = await processThongthaiChatCore(brainRequest(turn1Message, gid, 'web'), 'evt-1');
    assert.equal(r1.statusCode, 200);

    const history = [
      { role: 'user' as const, content: turn1Message },
      { role: 'assistant' as const, content: msg(r1.payload) },
    ];
    const r2 = await processThongthaiChatCore(brainRequest('ทองไทยตอบยาวไป', gid, 'web', history), 'evt-1');
    assert.equal(r2.statusCode, 200);
    const text2 = msg(r2.payload);
    assert.doesNotMatch(text2, HORSE_SELECTION_MARKER, 'the reported live bug: turn 2 must never be read as horse selection just because it is not the first turn');
    assert.doesNotMatch(text2, /วันที่.*เวลา.*ระยะเวลา.*จำนวนผู้ขี่/u);

    const events = harness.postsTo('ops_feedback_events');
    assert.equal(events.length, 2, 'both turns create their own feedback event');
    assert.equal(events[0].feedback_type, 'safety_issue');
    assert.equal(events[1].feedback_type, 'system_feedback');
    assert.equal(harness.postsTo('bookings').length, 0, 'no horse booking must ever be created');
  });
});

test('A6. Turn 1 legitimately about horse riding, turn 2 is response-quality feedback: still system_feedback, never horse selection', async () => {
  await withHarness(async harness => {
    const gid = guestId('rvh-a6');
    const turn1Message = 'อยากขี่ม้า';
    const r1 = await processThongthaiChatCore(brainRequest(turn1Message, gid, 'web'), 'evt-1');
    assert.equal(r1.statusCode, 200);

    const history = [
      { role: 'user' as const, content: turn1Message },
      { role: 'assistant' as const, content: msg(r1.payload) },
    ];
    // Without the mentionsThongthaiResponse guard, the joined conversation
    // text ("อยากขี่ม้า\nทองไทยตอบยาวไป") still contains "ม้า" from turn 1,
    // so hasHorseBookingContext alone is NOT enough here -- this is the
    // scenario that specifically needs the guard, not just the narrowed
    // context regex.
    const r2 = await processThongthaiChatCore(brainRequest('ทองไทยตอบยาวไป', gid, 'web', history), 'evt-1');
    assert.equal(r2.statusCode, 200);
    assert.doesNotMatch(msg(r2.payload), HORSE_SELECTION_MARKER);
    const events = harness.postsTo('ops_feedback_events');
    assert.equal(events.length, 1, 'turn 1 alone ("อยากขี่ม้า") is not itself feedback, so only turn 2 creates an event');
    assert.equal(events[0].feedback_type, 'system_feedback');
  });
});

// ---------------------------------------------------------------------
// B. Horse selection must still work
// ---------------------------------------------------------------------

test('B6. Active horse booking: "อยากขี่ม้า" then "เอาทองไทย" still selects the horse and asks for remaining details', async () => {
  await withHarness(async harness => {
    const gid = guestId('rvh-b6');
    const turn1Message = 'อยากขี่ม้า';
    const r1 = await processThongthaiChatCore(brainRequest(turn1Message, gid, 'web'), 'evt-1');
    assert.equal(r1.statusCode, 200);

    const history = [
      { role: 'user' as const, content: turn1Message },
      { role: 'assistant' as const, content: msg(r1.payload) },
    ];
    const r2 = await processThongthaiChatCore(brainRequest('เอาทองไทย', gid, 'web', history), 'evt-1');
    assert.equal(r2.statusCode, 200);
    const text2 = msg(r2.payload);
    assert.match(text2, /ทองไทย/u, 'must acknowledge the horse selection');
    assert.match(text2, /วันที่|เวลา|ระยะเวลา|จำนวนผู้ขี่|ชื่อ|เบอร์โทร/u, 'must ask for at least one remaining booking detail');
    assert.equal(harness.postsTo('ops_feedback_events').length, 0, 'a real horse-selection turn must never be misread as feedback');
  });
});

test('B7. Explicit horse-riding wording in a single turn: "อยากขี่ทองไทย" is horse/activity intent, not system feedback', async () => {
  await withHarness(async harness => {
    const r = await ask('rvh-b7', 'อยากขี่ทองไทย');
    assert.equal(r.statusCode, 200);
    assert.match(msg(r.payload), HORSE_SELECTION_MARKER, 'must actually engage horse selection, not just avoid feedback');
    assert.equal(harness.postsTo('ops_feedback_events').length, 0, 'must not be misread as feedback');
  });
});

test('B8. Bare "ทองไทย" with no active horse-booking context: does not blindly select the horse', async () => {
  await withHarness(async harness => {
    const r = await ask('rvh-b8', 'ทองไทย');
    assert.equal(r.statusCode, 200);
    assert.doesNotMatch(msg(r.payload), HORSE_SELECTION_MARKER, 'must never blindly assume horse selection with zero booking context');
  });
});

// ---------------------------------------------------------------------
// C. Positive system feedback
// ---------------------------------------------------------------------

test('C9. "ทองไทยตอบดีมาก": compliment about Thongthai itself, business_unit system, no horse selection', async () => {
  await withHarness(async harness => {
    const r = await ask('rvh-c9', 'ทองไทยตอบดีมาก');
    assert.equal(r.statusCode, 200);
    assert.doesNotMatch(msg(r.payload), HORSE_SELECTION_MARKER);
    const events = harness.postsTo('ops_feedback_events');
    assert.equal(events.length, 1);
    assert.equal(events[0].feedback_type, 'compliment');
    assert.equal(events[0].business_unit, 'system');
  });
});

// ---------------------------------------------------------------------
// D. Existing horse facts must still work
// ---------------------------------------------------------------------

test('D10. "ทองไทยกับภาราดรต่างกันยังไง": horse comparison facts, no booking created', async () => {
  await withHarness(async harness => {
    const r = await ask('rvh-d10', 'ทองไทยกับภาราดรต่างกันยังไง');
    assert.equal(r.statusCode, 200);
    const text = msg(r.payload);
    assert.match(text, /ขี่กระด้างกว่านิดนึง/u);
    assert.match(text, /ขี่นิ่มกว่านิดหน่อย/u);
    assert.equal(harness.postsTo('bookings').length, 0);
    assert.equal(harness.postsTo('ops_feedback_events').length, 0);
  });
});
