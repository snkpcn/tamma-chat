// Urgent bugfix: a horse-COMPARISON/info question naming one or both
// horses ("ทองไทยกับภาราดรต่างกันยังไง") was being misread as SELECTING a
// horse and prompted for booking details, instead of answering with the
// owner-configured ride-feel/personality facts (composeHorseComparisonResponse,
// _local-concierge-response.ts). See thongthai-chat.ts's
// activityBookingFallbackDraft and _local-concierge-intent.ts's
// HORSE_RIDE_FEEL_MARKER. Every test goes through the real
// processThongthaiChatCore entry point.
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
const BOOKING_DETAIL_PROMPT = /วันที่.*เวลา.*ระยะเวลา.*จำนวนผู้ขี่/u;

// ---------------------------------------------------------------------
// A. Horse comparison must not become booking
// ---------------------------------------------------------------------

test('A1. "ทองไทยกับภาราดรต่างกันยังไง": comparison facts, no booking prompt', async () => {
  await withHarness(async harness => {
    const r = await ask('hvc-a1', 'ทองไทยกับภาราดรต่างกันยังไง');
    assert.equal(r.statusCode, 200);
    const text = msg(r.payload);
    assert.doesNotMatch(text, HORSE_SELECTION_MARKER);
    assert.doesNotMatch(text, BOOKING_DETAIL_PROMPT);
    assert.match(text, /ทองไทย.*กระด้างกว่านิดนึง/u);
    assert.match(text, /ภาราดร.*นิ่มกว่านิดหน่อย/u);
    assert.match(text, /ขี้เล่นน่ารัก/u);
    assert.equal(harness.postsTo('bookings').length, 0);
  });
});

test('A2. "ภาราดรกับทองไทยต่างกันยังไง": same comparison, word order swapped', async () => {
  await withHarness(async harness => {
    const r = await ask('hvc-a2', 'ภาราดรกับทองไทยต่างกันยังไง');
    assert.equal(r.statusCode, 200);
    const text = msg(r.payload);
    assert.doesNotMatch(text, HORSE_SELECTION_MARKER);
    assert.doesNotMatch(text, BOOKING_DETAIL_PROMPT);
    assert.equal(harness.postsTo('bookings').length, 0);
  });
});

test('A3. "ตัวไหนขี่นิ่มกว่า": ภาราดร is smoother, no booking prompt', async () => {
  await withHarness(async harness => {
    const r = await ask('hvc-a3', 'ตัวไหนขี่นิ่มกว่า');
    assert.equal(r.statusCode, 200);
    const text = msg(r.payload);
    assert.doesNotMatch(text, HORSE_SELECTION_MARKER);
    assert.doesNotMatch(text, BOOKING_DETAIL_PROMPT);
  });
});

test('A4. "ตัวไหนขี่กระด้างกว่า": ทองไทย is firmer, no booking prompt', async () => {
  await withHarness(async harness => {
    const r = await ask('hvc-a4', 'ตัวไหนขี่กระด้างกว่า');
    assert.equal(r.statusCode, 200);
    const text = msg(r.payload);
    assert.doesNotMatch(text, HORSE_SELECTION_MARKER);
    assert.doesNotMatch(text, BOOKING_DETAIL_PROMPT);
  });
});

test('A5. "ทองไทยขี่ยังไง": describes riding feel, no booking prompt', async () => {
  await withHarness(async harness => {
    const r = await ask('hvc-a5', 'ทองไทยขี่ยังไง');
    assert.equal(r.statusCode, 200);
    const text = msg(r.payload);
    assert.doesNotMatch(text, HORSE_SELECTION_MARKER);
    assert.doesNotMatch(text, BOOKING_DETAIL_PROMPT);
  });
});

test('A6. "ภาราดรขี่ยังไง": describes riding feel, no booking prompt', async () => {
  await withHarness(async harness => {
    const r = await ask('hvc-a6', 'ภาราดรขี่ยังไง');
    assert.equal(r.statusCode, 200);
    const text = msg(r.payload);
    assert.doesNotMatch(text, HORSE_SELECTION_MARKER);
    assert.doesNotMatch(text, BOOKING_DETAIL_PROMPT);
  });
});

test('A7 (bonus). "ทองไทยกับภาราดรต่างกันไหม": comparison facts, no booking prompt', async () => {
  await withHarness(async harness => {
    const r = await ask('hvc-a7', 'ทองไทยกับภาราดรต่างกันไหม');
    assert.equal(r.statusCode, 200);
    const text = msg(r.payload);
    assert.doesNotMatch(text, HORSE_SELECTION_MARKER);
    assert.doesNotMatch(text, BOOKING_DETAIL_PROMPT);
  });
});

test('A8 (bonus). "ทองไทยนิสัยเป็นไง": personality facts, no booking prompt', async () => {
  await withHarness(async harness => {
    const r = await ask('hvc-a8', 'ทองไทยนิสัยเป็นไง');
    assert.equal(r.statusCode, 200);
    const text = msg(r.payload);
    assert.doesNotMatch(text, HORSE_SELECTION_MARKER);
    assert.doesNotMatch(text, BOOKING_DETAIL_PROMPT);
    assert.match(text, /ขี้เล่นน่ารัก/u);
  });
});

test('A9 (bonus). "ภาราดรนิสัยเป็นไง": personality facts, no booking prompt', async () => {
  await withHarness(async harness => {
    const r = await ask('hvc-a9', 'ภาราดรนิสัยเป็นไง');
    assert.equal(r.statusCode, 200);
    const text = msg(r.payload);
    assert.doesNotMatch(text, HORSE_SELECTION_MARKER);
    assert.doesNotMatch(text, BOOKING_DETAIL_PROMPT);
  });
});

test('A10 (bonus). "ขอเปรียบเทียบม้าสองตัว": comparison facts, no booking prompt', async () => {
  await withHarness(async harness => {
    const r = await ask('hvc-a10', 'ขอเปรียบเทียบม้าสองตัว');
    assert.equal(r.statusCode, 200);
    const text = msg(r.payload);
    assert.doesNotMatch(text, HORSE_SELECTION_MARKER);
    assert.doesNotMatch(text, BOOKING_DETAIL_PROMPT);
  });
});

test('A11 (bonus). "ม้าสองตัวต่างกันยังไง": comparison facts, no booking prompt', async () => {
  await withHarness(async harness => {
    const r = await ask('hvc-a11', 'ม้าสองตัวต่างกันยังไง');
    assert.equal(r.statusCode, 200);
    const text = msg(r.payload);
    assert.doesNotMatch(text, HORSE_SELECTION_MARKER);
    assert.doesNotMatch(text, BOOKING_DETAIL_PROMPT);
  });
});

// ---------------------------------------------------------------------
// B. Horse selection must still work
// ---------------------------------------------------------------------

test('B7. Turn 1 "อยากขี่ม้า" then turn 2 "เอาทองไทย": selects ทองไทย, asks remaining details', async () => {
  await withHarness(async harness => {
    const gid = guestId('hvc-b7');
    const turn1 = 'อยากขี่ม้า';
    const r1 = await processThongthaiChatCore(brainRequest(turn1, gid, 'web'), 'evt-1');
    assert.equal(r1.statusCode, 200);
    const history = [{ role: 'user' as const, content: turn1 }, { role: 'assistant' as const, content: msg(r1.payload) }];
    const r2 = await processThongthaiChatCore(brainRequest('เอาทองไทย', gid, 'web', history), 'evt-1');
    assert.equal(r2.statusCode, 200);
    const text2 = msg(r2.payload);
    assert.match(text2, /ทองไทย/u);
    assert.match(text2, /วันที่|เวลา|ระยะเวลา|จำนวนผู้ขี่|ชื่อ|เบอร์โทร/u);
    assert.equal(harness.postsTo('ops_feedback_events').length, 0);
  });
});

test('B8. Turn 1 "อยากขี่ม้า" then turn 2 "เอาภาราดร": selects ภาราดร', async () => {
  await withHarness(async harness => {
    const gid = guestId('hvc-b8');
    const turn1 = 'อยากขี่ม้า';
    const r1 = await processThongthaiChatCore(brainRequest(turn1, gid, 'web'), 'evt-1');
    assert.equal(r1.statusCode, 200);
    const history = [{ role: 'user' as const, content: turn1 }, { role: 'assistant' as const, content: msg(r1.payload) }];
    const r2 = await processThongthaiChatCore(brainRequest('เอาภาราดร', gid, 'web', history), 'evt-1');
    assert.equal(r2.statusCode, 200);
    const text2 = msg(r2.payload);
    assert.match(text2, /ภาราดร/u);
    assert.equal(harness.postsTo('ops_feedback_events').length, 0);
  });
});

test('B9. "อยากขี่ทองไทย": horse/activity intent, selection allowed', async () => {
  await withHarness(async harness => {
    const r = await ask('hvc-b9', 'อยากขี่ทองไทย');
    assert.equal(r.statusCode, 200);
    assert.match(msg(r.payload), HORSE_SELECTION_MARKER);
    assert.equal(harness.postsTo('ops_feedback_events').length, 0);
  });
});

test('B10. "อยากขี่ภาราดร": horse/activity intent, selection allowed', async () => {
  await withHarness(async harness => {
    const r = await ask('hvc-b10', 'อยากขี่ภาราดร');
    assert.equal(r.statusCode, 200);
    assert.match(msg(r.payload), HORSE_SELECTION_MARKER);
    assert.equal(harness.postsTo('ops_feedback_events').length, 0);
  });
});

// ---------------------------------------------------------------------
// C. Ambiguous bare names must never blindly select
// ---------------------------------------------------------------------

test('C11. Bare "ทองไทย" with no active booking context: does not blindly select', async () => {
  await withHarness(async harness => {
    const r = await ask('hvc-c11', 'ทองไทย');
    assert.equal(r.statusCode, 200);
    assert.doesNotMatch(msg(r.payload), HORSE_SELECTION_MARKER);
  });
});

test('C12. Bare "ภาราดร" with no active booking context: does not blindly select', async () => {
  await withHarness(async harness => {
    const r = await ask('hvc-c12', 'ภาราดร');
    assert.equal(r.statusCode, 200);
    assert.doesNotMatch(msg(r.payload), HORSE_SELECTION_MARKER);
  });
});

// ---------------------------------------------------------------------
// D. System feedback stays protected
// ---------------------------------------------------------------------

test('D13. "ทองไทยตอบยาวไป": system_feedback, no horse selection', async () => {
  await withHarness(async harness => {
    const r = await ask('hvc-d13', 'ทองไทยตอบยาวไป');
    assert.equal(r.statusCode, 200);
    assert.doesNotMatch(msg(r.payload), HORSE_SELECTION_MARKER);
    const events = harness.postsTo('ops_feedback_events');
    assert.equal(events.length, 1);
    assert.equal(events[0].feedback_type, 'system_feedback');
  });
});
