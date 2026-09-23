// URGENT INTENT SAFETY FIX: "ทองไทย" is a real, deliberate name collision
// -- the bot's own name AND a horse's name. A bare "เอาทองไทย"/"เอาภาราดร"/
// bare horse name with NO established horse/activity context was being
// silently accepted as horse selection by the One-Mind semantic layer's
// own findKnownActivityAssetSelection check (_deterministic-semantic-
// turn.ts), which has no context/intent gate of its own -- quietly
// opening a booking task the customer never asked to start. See
// thongthai-chat.ts's bareHorseSelectionClarification,
// isBareAmbiguousHorseSelection, hasActiveHorseBookingContext,
// hasExplicitHorseBookingIntent. Every test goes through the real
// processThongthaiChatCore path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withHarness, guestId, brainRequest } from './helpers/canonical-core-harness';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';

function msg(payload: unknown): string {
  return String((payload as { message: string }).message);
}

type Turn = { role: 'user' | 'assistant'; content: string };

async function converse(seed: string, messages: string[]) {
  const gid = guestId(seed);
  const history: Turn[] = [];
  const responses: string[] = [];
  for (const message of messages) {
    const r = await processThongthaiChatCore(brainRequest(message, gid, 'web', history), 'evt-1');
    assert.equal(r.statusCode, 200);
    const text = msg(r.payload);
    responses.push(text);
    history.push({ role: 'user', content: message });
    history.push({ role: 'assistant', content: text });
  }
  return responses;
}

const BOOKING_MARKERS = ['เลือกม้า', 'ขอเพิ่มอีกนิด', 'วันที่', 'เวลา', 'ระยะเวลา', 'จำนวนผู้ขี่', 'ชื่อผู้จอง', 'เบอร์โทร'];
function assertNoBookingStarted(text: string) {
  for (const marker of BOOKING_MARKERS) assert.ok(!text.includes(marker), `must not contain "${marker}":\n${text}`);
}

// ---------------------------------------------------------------------
// A. Bare ambiguous phrases must NOT start booking
// ---------------------------------------------------------------------

test('1. "เอาทองไทย" with no context: asks clarification, no booking', async () => {
  await withHarness(async harness => {
    const [reply] = await converse('bha-1', ['เอาทองไทย']);
    assertNoBookingStarted(reply);
    assert.match(reply, /หมายถึง/u, 'must ask a clarifying question');
    assert.equal(harness.postsTo('bookings').length, 0);
  });
});

test('2. "เอาภาราดร" with no context: asks clarification, no booking', async () => {
  await withHarness(async () => {
    const [reply] = await converse('bha-2', ['เอาภาราดร']);
    assertNoBookingStarted(reply);
    assert.match(reply, /หมายถึง/u);
  });
});

test('3. "เลือกทองไทย" with no context: asks clarification, no booking', async () => {
  await withHarness(async () => {
    const [reply] = await converse('bha-3', ['เลือกทองไทย']);
    assertNoBookingStarted(reply);
    assert.match(reply, /หมายถึง/u);
  });
});

test('4. Bare "ทองไทย" with no context: clarification or assistant response, no booking', async () => {
  await withHarness(async () => {
    const [reply] = await converse('bha-4', ['ทองไทย']);
    assertNoBookingStarted(reply);
  });
});

test('5. Bare "ภาราดร" with no context: asks clarification, no booking', async () => {
  await withHarness(async () => {
    const [reply] = await converse('bha-5', ['ภาราดร']);
    assertNoBookingStarted(reply);
    assert.match(reply, /หมายถึง/u);
  });
});

// ---------------------------------------------------------------------
// B. Active context makes selection valid
// ---------------------------------------------------------------------

test('6. Turn 1 "อยากขี่ม้า" then turn 2 "เอาทองไทย": selects ทองไทย', async () => {
  await withHarness(async () => {
    const [, reply] = await converse('bha-6', ['อยากขี่ม้า', 'เอาทองไทย']);
    assert.match(reply, /เลือกม้า:\s*ทองไทย/u);
  });
});

test('7. Turn 1 "อยากขี่ม้า" then turn 2 "เอาภาราดร": selects ภาราดร', async () => {
  await withHarness(async () => {
    const [, reply] = await converse('bha-7', ['อยากขี่ม้า', 'เอาภาราดร']);
    assert.match(reply, /เลือกม้า:\s*ภาราดร/u);
  });
});

// ---------------------------------------------------------------------
// C. Explicit current-message horse intent makes selection valid
// ---------------------------------------------------------------------

test('8. "อยากขี่ทองไทย": horse selection allowed', async () => {
  await withHarness(async () => {
    const [reply] = await converse('bha-8', ['อยากขี่ทองไทย']);
    assert.match(reply, /เลือกม้า:\s*ทองไทย/u);
  });
});

test('9. "อยากขี่ภาราดร": horse selection allowed', async () => {
  await withHarness(async () => {
    const [reply] = await converse('bha-9', ['อยากขี่ภาราดร']);
    assert.match(reply, /เลือกม้า:\s*ภาราดร/u);
  });
});

test('10. "เลือกม้าทองไทย": horse selection allowed', async () => {
  await withHarness(async () => {
    const [reply] = await converse('bha-10', ['เลือกม้าทองไทย']);
    assert.match(reply, /เลือกม้า:\s*ทองไทย/u);
  });
});

test('11. "เอาม้าภาราดร": horse selection allowed', async () => {
  await withHarness(async () => {
    const [reply] = await converse('bha-11', ['เอาม้าภาราดร']);
    assert.match(reply, /เลือกม้า:\s*ภาราดร/u);
  });
});

// ---------------------------------------------------------------------
// D. Existing protections still pass
// ---------------------------------------------------------------------

test('12. "ทองไทยกับภาราดรต่างกันยังไง": comparison, no booking', async () => {
  await withHarness(async () => {
    const [reply] = await converse('bha-12', ['ทองไทยกับภาราดรต่างกันยังไง']);
    assertNoBookingStarted(reply);
    assert.match(reply, /กระด้างกว่านิดนึง/u);
  });
});

test('13. "ทองไทยตอบยาวไป": system feedback, no booking', async () => {
  await withHarness(async harness => {
    const [reply] = await converse('bha-13', ['ทองไทยตอบยาวไป']);
    assertNoBookingStarted(reply);
    const events = harness.postsTo('ops_feedback_events');
    assert.equal(events.length, 1);
    assert.equal(events[0].feedback_type, 'system_feedback');
  });
});

test('14. After unrelated context ("ฝนตกไหม"), "เอาทองไทย" still asks clarification', async () => {
  await withHarness(async () => {
    const [, reply] = await converse('bha-14', ['ฝนตกไหม', 'เอาทองไทย']);
    assertNoBookingStarted(reply);
    assert.match(reply, /หมายถึง/u);
  });
});

test('15. After service-feedback context ("บริการแย่มาก"), "เอาทองไทย" still asks clarification', async () => {
  await withHarness(async () => {
    const [, reply] = await converse('bha-15', ['บริการแย่มาก', 'เอาทองไทย']);
    assertNoBookingStarted(reply);
    assert.match(reply, /หมายถึง/u);
  });
});
