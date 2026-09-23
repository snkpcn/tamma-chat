// URGENT PRODUCTION BUG: once BOTH horse names had appeared anywhere in a
// conversation (e.g. selecting ภาราดร, then later saying "เอาทองไทย" to
// switch), the customer's CURRENT explicit choice was ignored -- the
// selection kept resolving to ภาราดร. Root cause:
// activityBookingFallbackDraft ran activityAssetFromText over the WHOLE
// joined history+current-message text, and ACTIVITY_ASSET_SELECTIONS'
// array-declaration order (ภาราดร before ทองไทย, an arbitrary detail, not
// recency) decided the winner whenever both names were present anywhere
// in that text. Fix: check the CURRENT message alone first; only fall
// back to scanning history when the current message names no horse at
// all. See thongthai-chat.ts's activityBookingFallbackDraft. Every test
// here builds real, persisted multi-turn state through the actual
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

test('1. Clean active horse booking: "อยากขี่ม้า" then "เอาทองไทย" selects ทองไทย', async () => {
  await withHarness(async harness => {
    const [, reply] = await converse('sel-1', ['อยากขี่ม้า', 'เอาทองไทย']);
    assert.match(reply, /เลือกม้า:\s*ทองไทย/u);
    assert.doesNotMatch(reply, /เลือกม้า:\s*ภาราดร|ตัวเลือกเป็น\s*ภาราดร/u);
    assert.equal(harness.postsTo('bookings').length, 0);
  });
});

test('2. Clean active horse booking: "อยากขี่ม้า" then "เอาภาราดร" selects ภาราดร', async () => {
  await withHarness(async () => {
    const [, reply] = await converse('sel-2', ['อยากขี่ม้า', 'เอาภาราดร']);
    assert.match(reply, /เลือกม้า:\s*ภาราดร/u);
    assert.doesNotMatch(reply, /เลือกม้า:\s*ทองไทย|ตัวเลือกเป็น\s*ทองไทย/u);
  });
});

test('3. Existing ภาราดร state, then explicit switch to ทองไทย: selection updates, no longer says ภาราดร', async () => {
  await withHarness(async () => {
    const [, selectReply, switchReply] = await converse('sel-3', ['อยากขี่ม้า', 'เอาภาราดร', 'เอาทองไทย']);
    assert.match(selectReply, /เลือกม้า:\s*ภาราดร/u);
    assert.match(switchReply, /เลือกม้า:\s*ทองไทย/u);
    assert.doesNotMatch(switchReply, /เลือกม้า:\s*ภาราดร|ตัวเลือกเป็น\s*ภาราดร/u, 'must not still say ภาราดร after switching to ทองไทย');
  });
});

test('4. Existing ทองไทย state, then explicit switch to ภาราดร: selection updates, no longer says ทองไทย', async () => {
  await withHarness(async () => {
    const [, selectReply, switchReply] = await converse('sel-4', ['อยากขี่ม้า', 'เอาทองไทย', 'เอาภาราดร']);
    assert.match(selectReply, /เลือกม้า:\s*ทองไทย/u);
    assert.match(switchReply, /เลือกม้า:\s*ภาราดร/u);
    assert.doesNotMatch(switchReply, /เลือกม้า:\s*ทองไทย|ตัวเลือกเป็น\s*ทองไทย/u, 'must not still say ทองไทย after switching to ภาราดร');
  });
});

test('5. Prior comparison naming both horses, then explicit selection: selects ทองไทย', async () => {
  await withHarness(async harness => {
    const [comparisonReply, selectReply] = await converse('sel-5', ['ทองไทยกับภาราดรต่างกันยังไง', 'เอาทองไทย']);
    assert.match(comparisonReply, /กระด้างกว่านิดนึง|นิ่มกว่านิดหน่อย/u);
    assert.doesNotMatch(selectReply, /เลือกม้า:\s*ภาราดร|ตัวเลือกเป็น\s*ภาราดร/u, 'must not select ภาราดร just because it was named in the prior comparison');
    assert.equal(harness.postsTo('ops_feedback_events').length, 0, 'a comparison question is a local-concierge answer, never feedback');
  });
});

test('6. After system feedback about Thongthai itself, explicit "เอาทองไทย" still selects ทองไทย, never ภาราดร', async () => {
  await withHarness(async harness => {
    const [feedbackReply, selectReply] = await converse('sel-6', ['ทองไทยตอบยาวไป', 'เอาทองไทย']);
    assert.doesNotMatch(feedbackReply, /เลือกม้า/u, 'turn 1 must stay system feedback, never horse selection');
    assert.doesNotMatch(selectReply, /เลือกม้า:\s*ภาราดร|ตัวเลือกเป็น\s*ภาราดร/u);
    const events = harness.postsTo('ops_feedback_events');
    assert.equal(events.length, 1);
    assert.equal(events[0].feedback_type, 'system_feedback');
  });
});

test('7. Regression protections still pass: comparison, horse facts, and system feedback all unchanged', async () => {
  await withHarness(async harness => {
    const [feedbackReply] = await converse('sel-7a', ['ทองไทยตอบยาวไป']);
    assert.doesNotMatch(feedbackReply, /เลือกม้า/u);
    const events = harness.postsTo('ops_feedback_events');
    assert.equal(events[0].feedback_type, 'system_feedback');
  });
  await withHarness(async () => {
    const [comparisonReply] = await converse('sel-7b', ['ทองไทยกับภาราดรต่างกันยังไง']);
    assert.doesNotMatch(comparisonReply, /เลือกม้า/u);
    assert.match(comparisonReply, /กระด้างกว่านิดนึง/u);
  });
  await withHarness(async () => {
    const [factsReply] = await converse('sel-7c', ['ตัวไหนขี่นิ่มกว่า']);
    assert.doesNotMatch(factsReply, /เลือกม้า/u);
    assert.match(factsReply, /นิ่มกว่านิดหน่อย/u);
  });
  await withHarness(async () => {
    const [, reply1] = await converse('sel-7d', ['อยากขี่ม้า', 'เอาทองไทย']);
    assert.match(reply1, /เลือกม้า:\s*ทองไทย/u);
  });
  await withHarness(async () => {
    const [, reply2] = await converse('sel-7e', ['อยากขี่ม้า', 'เอาภาราดร']);
    assert.match(reply2, /เลือกม้า:\s*ภาราดร/u);
  });
});
