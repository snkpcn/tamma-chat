// URGENT PRODUCTION BUG: a horse info/comparison question naming BOTH
// horses ("ทองไทยกับภาราดรต่างกันยังไง") was silently re-selecting
// whichever horse was named LAST in the text and re-asking for booking
// details -- even with an ALREADY-OPEN horse-booking task from an
// earlier turn. Root cause: activityBookingFallbackDraft's only guard
// against a non-selection message was mentionsThongthaiResponse (for
// the earlier, narrower "system feedback" bug), which never covers a
// comparison question. isHorseInfoOrComparisonQuestion
// (_local-concierge-intent.ts) closes this, reusing the SAME markers
// the horse-facts composer itself answers from. Every test here builds
// REAL, PERSISTED multi-turn state through the actual
// processThongthaiChatCore path -- no hand-constructed classifier calls,
// no mocked task state.
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

const BAD_RESPONSE_MARKERS = ['เลือกม้า', 'ขอเพิ่มอีกนิด', /(?:^|\s)วันที่(?:,|\s|$)/u, /(?:^|\s)เวลา(?:,|\s|$)/u, 'ระยะเวลา', 'จำนวนผู้ขี่', 'ชื่อผู้จอง', 'เบอร์โทร'];

function assertNoBookingHijack(text: string) {
  for (const marker of BAD_RESPONSE_MARKERS) {
    if (typeof marker === 'string') assert.ok(!text.includes(marker), `response must not contain "${marker}":\n${text}`);
    else assert.doesNotMatch(text, marker, `response must not match ${marker}:\n${text}`);
  }
}

test('1. Clean conversation: comparison question answers facts, no booking prompt', async () => {
  await withHarness(async harness => {
    const [reply] = await converse('hcat-1', ['ทองไทยกับภาราดรต่างกันยังไง']);
    assertNoBookingHijack(reply);
    assert.match(reply, /กระด้างกว่านิดนึง/u);
    assert.match(reply, /นิ่มกว่านิดหน่อย/u);
    assert.equal(harness.postsTo('bookings').length, 0);
  });
});

test('2. Active task with ทองไทย already selected: comparison turn answers facts, does not re-ask booking details', async () => {
  await withHarness(async harness => {
    const [, selectReply, comparisonReply] = await converse('hcat-2', [
      'อยากขี่ม้า',
      'เอาทองไทย',
      'ทองไทยกับภาราดรต่างกันยังไง',
    ]);
    assert.match(selectReply, /ทองไทย/u, 'turn 2 must still select the horse normally');
    assertNoBookingHijack(comparisonReply);
    assert.match(comparisonReply, /กระด้างกว่านิดนึง|นิ่มกว่านิดหน่อย/u, 'turn 3 must answer the comparison, not re-select a horse');
    assert.equal(harness.postsTo('bookings').length, 0);
  });
});

test('3. Active task with ภาราดร already selected: comparison turn answers facts, no booking prompt', async () => {
  await withHarness(async harness => {
    const [, selectReply, comparisonReply] = await converse('hcat-3', [
      'อยากขี่ม้า',
      'เอาภาราดร',
      'ทองไทยกับภาราดรต่างกันยังไง',
    ]);
    assert.match(selectReply, /ภาราดร/u);
    assertNoBookingHijack(comparisonReply);
    assert.equal(harness.postsTo('bookings').length, 0);
  });
});

test('4. Prior safety/complaint context: comparison turn still answers facts, no booking prompt', async () => {
  await withHarness(async harness => {
    const [, comparisonReply] = await converse('hcat-4', [
      'พื้นลื่นมาก ตอนเล่น ATV น่ากลัว',
      'ทองไทยกับภาราดรต่างกันยังไง',
    ]);
    assertNoBookingHijack(comparisonReply);
    const events = harness.postsTo('ops_feedback_events');
    assert.equal(events.length, 1, 'only the first turn is feedback; the comparison turn is not');
    assert.equal(events[0].feedback_type, 'safety_issue');
  });
});

test('5. Exact reported bad-response guard, run standalone against the exact failing live phrase', async () => {
  await withHarness(async () => {
    const [reply] = await converse('hcat-5', ['ทองไทยกับภาราดรต่างกันยังไง']);
    assertNoBookingHijack(reply);
  });
});

test('6. Horse selection still works: "อยากขี่ม้า" then "เอาทองไทย"', async () => {
  await withHarness(async harness => {
    const [, reply] = await converse('hcat-6', ['อยากขี่ม้า', 'เอาทองไทย']);
    assert.match(reply, /ทองไทย/u);
    assert.match(reply, /วันที่|เวลา|ระยะเวลา|จำนวนผู้ขี่|ชื่อ|เบอร์โทร/u);
    assert.equal(harness.postsTo('ops_feedback_events').length, 0);
  });
});

test('7. Horse selection still works: "อยากขี่ภาราดร" in a single turn', async () => {
  await withHarness(async harness => {
    const [reply] = await converse('hcat-7', ['อยากขี่ภาราดร']);
    assert.match(reply, /ภาราดร/u);
    assert.match(reply, /เลือกม้า/u);
    assert.equal(harness.postsTo('ops_feedback_events').length, 0);
  });
});

test('8. Horse facts still answer: "ตัวไหนขี่นิ่มกว่า" -> ภาราดร, no booking', async () => {
  await withHarness(async harness => {
    const [reply] = await converse('hcat-8', ['ตัวไหนขี่นิ่มกว่า']);
    assertNoBookingHijack(reply);
    assert.match(reply, /นิ่มกว่านิดหน่อย/u);
  });
});

test('9. Horse facts still answer: "ตัวไหนขี่กระด้างกว่า" -> ทองไทย, no booking', async () => {
  await withHarness(async harness => {
    const [reply] = await converse('hcat-9', ['ตัวไหนขี่กระด้างกว่า']);
    assertNoBookingHijack(reply);
    assert.match(reply, /กระด้างกว่านิดนึง/u);
  });
});
