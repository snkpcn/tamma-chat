// Regression tests for a second round of real LINE production failures the
// owner reported after PR #233 (grounded human service voice) had already
// shipped. Each test drives the real processThongthaiChatCore end-to-end
// under a forced provider outage (no OpenAI reply queued by the harness),
// exactly like tests/final-perfection-pass-conversational-fixes.test.ts --
// the repo's own deterministic-fallback layer is what must get every one
// of these right, since that is what real production falls back to on a
// transient provider failure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withHarness, guestId, brainRequest } from './helpers/canonical-core-harness';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';
import { HORSE_FACTS } from '../netlify/functions/_local-concierge-knowledge';

function msg(payload: unknown): string {
  return String((payload as { message: string }).message);
}

test('Horse display names: a beginner soft-ride question directly selects and names the owner-required น้องภาราดร display form', async () => {
  await withHarness(async () => {
    const gid = guestId('owner-r2-horse-display-names');
    const r = await processThongthaiChatCore(
      brainRequest('สนใจขี่ม้า ไม่เคยขี่ ตัวไหนนิ่มกว่ากัน', gid, 'web'),
      'evt-0',
    );
    assert.equal(r.statusCode, 200);
    const reply = msg(r.payload);
    assert.match(reply, /น้องภาราดร/u, 'must use the owner-required display name for ภาราดร');
    assert.equal(HORSE_FACTS.pharadon.name, 'น้องภาราดร');
    assert.equal(HORSE_FACTS.thongthai.name, 'น้องทองไทย');
  });
});

test('Horse display names: an explicit comparison question names BOTH horses using the owner-required display forms', async () => {
  await withHarness(async () => {
    const gid = guestId('owner-r2-horse-comparison-display-names');
    const r = await processThongthaiChatCore(
      brainRequest('น้องทองไทยกับน้องภาราดรขี่ต่างกันยังไงครับ', gid, 'web'),
      'evt-0',
    );
    assert.equal(r.statusCode, 200);
    const reply = msg(r.payload);
    assert.match(reply, /น้องภาราดร/u, 'must use the owner-required display name for ภาราดร');
    assert.match(reply, /น้องทองไทย/u, 'must use the owner-required display name for ทองไทย');
  });
});

test('Horse rejection: "ไม่เอาทองไทยนะครับ เอาอีกตัว" resolves to น้องภาราดร, not a generic clarification', async () => {
  await withHarness(async harness => {
    const gid = guestId('owner-r2-reject-thongthai-other');
    await processThongthaiChatCore(brainRequest('อยากขี่ม้า', gid, 'web'), 'evt-0');
    const r = await processThongthaiChatCore(
      brainRequest('ไม่เอาทองไทยนะครับ เอาอีกตัว', gid, 'web'),
      'evt-1',
    );
    assert.equal(r.statusCode, 200);
    const reply = msg(r.payload);
    assert.match(reply, /น้องภาราดร/u, 'must resolve "the other one" to ภาราดร once ทองไทย is explicitly rejected');
    const state = harness.getState(harness.guestDbId(gid)!)?.state?.taskState as
      { activeTask?: { slots?: Record<string, unknown> } } | undefined;
    assert.equal(state?.activeTask?.slots?.assetSelection, 'ภาราดร');
  });
});

test('Horse rejection (symmetric): "ไม่เอาภาราดร ขออีกตัว" resolves to น้องทองไทย', async () => {
  await withHarness(async harness => {
    const gid = guestId('owner-r2-reject-pharadon-other');
    await processThongthaiChatCore(brainRequest('อยากขี่ม้า', gid, 'web'), 'evt-0');
    const r = await processThongthaiChatCore(
      brainRequest('ไม่เอาภาราดร ขออีกตัว', gid, 'web'),
      'evt-1',
    );
    assert.equal(r.statusCode, 200);
    const reply = msg(r.payload);
    assert.match(reply, /น้องทองไทย/u);
    const state = harness.getState(harness.guestDbId(gid)!)?.state?.taskState as
      { activeTask?: { slots?: Record<string, unknown> } } | undefined;
    assert.equal(state?.activeTask?.slots?.assetSelection, 'ทองไทย');
  });
});

test('Horse rejection is scoped to the current utterance: an unrelated earlier rejection must never combine with a later, separate "the other one" mention', async () => {
  await withHarness(async harness => {
    const gid = guestId('owner-r2-reject-no-cross-turn-glue');
    // Turn 1 rejects ทองไทย for an unrelated reason (never mentions "the
    // other one"). Turn 2 is a genuinely unrelated later statement that
    // happens to contain "อีกตัว" for a different reason. These two must
    // never be glued together into a false horse selection neither turn
    // actually stated on its own.
    await processThongthaiChatCore(brainRequest('ไม่เอาทองไทยนะครับ ยังไม่ได้ตัดสินใจ', gid, 'web'), 'evt-0');
    const r = await processThongthaiChatCore(
      brainRequest('เดี๋ยวขอถามเพื่อนอีกตัวก่อนว่าชอบร้านอาหารไหน', gid, 'web'),
      'evt-1',
    );
    assert.equal(r.statusCode, 200);
    const state = harness.getState(harness.guestDbId(gid)!)?.state?.taskState as
      { activeTask?: { slots?: Record<string, unknown> } } | undefined;
    assert.notEqual(state?.activeTask?.slots?.assetSelection, 'ภาราดร',
      'an unrelated later "อีกตัว" mention must never combine with an earlier, separate rejection to fabricate a horse selection');
  });
});

test('Preference hold, no booking: "เอาตัวนั้นไว้ก่อน แต่ยังไม่ต้องจอง" stores preference only and never books', async () => {
  await withHarness(async harness => {
    const gid = guestId('owner-r2-hold-no-booking');
    await processThongthaiChatCore(brainRequest('อยากขี่ม้าพรุ่งนี้ช่วงเย็น เอาน้องภาราดร', gid, 'web'), 'evt-0');
    const r = await processThongthaiChatCore(
      brainRequest('เอาตัวนั้นไว้ก่อนนะครับ แต่ยังไม่ต้องจอง', gid, 'web'),
      'evt-1',
    );
    assert.equal(r.statusCode, 200);
    assert.equal(harness.postsTo('bookings').length, 0, 'a preference-hold statement must never create a real booking');
    const state = harness.getState(harness.guestDbId(gid)!)?.state?.taskState as
      { activeTask?: { status?: string } } | undefined;
    assert.notEqual(state?.activeTask?.status, 'confirmed', 'the task must not be committed by a hold-only statement');
  });
});

test('Preference hold, no booking (conditional-unavailability form): "ถ้าทั้งสองตัวไม่ว่างก็ไม่ต้องจอง" never books', async () => {
  await withHarness(async harness => {
    const gid = guestId('owner-r2-both-unavailable-no-booking');
    await processThongthaiChatCore(brainRequest('อยากขี่ม้าพรุ่งนี้ช่วงเย็น เอาน้องภาราดร', gid, 'web'), 'evt-0');
    const r = await processThongthaiChatCore(
      brainRequest('ถ้าทั้งสองตัวไม่ว่างก็ไม่ต้องจองนะครับ', gid, 'web'),
      'evt-1',
    );
    assert.equal(r.statusCode, 200);
    assert.equal(harness.postsTo('bookings').length, 0, 'a conditional non-commitment must never create a real booking');
    const reply = msg(r.payload);
    assert.doesNotMatch(reply, /ส่งคำขอจองเข้าระบบแล้ว/u, 'must never claim a booking was submitted');
  });
});

test('Restaurant: a mild-spice-tolerance question ("ทานเผ็ดไม่เก่ง") never fabricates an unrelated stale shrimp-exclusion acknowledgment', async () => {
  await withHarness(async () => {
    const gid = guestId('owner-r2-spice-not-shrimp');
    // An unrelated earlier turn mentions shrimp in a totally different
    // context (asking whether a dish exists), never as a constraint --
    // the later spice-only question must not resurrect it as if the
    // customer had just restated a shrimp exclusion.
    await processThongthaiChatCore(brainRequest('ร้านมีต้มยำกุ้งไหมครับ', gid, 'web'), 'evt-0');
    const r = await processThongthaiChatCore(
      brainRequest('ร้านอาหารมีเมนูอะไรที่ไม่ค่อยเผ็ดบ้าง แฟนผมทานเผ็ดไม่เก่ง', gid, 'web'),
      'evt-1',
    );
    assert.equal(r.statusCode, 200);
    const reply = msg(r.payload);
    assert.doesNotMatch(reply, /ไม่มีกุ้ง/u,
      'a spice-only question must never re-announce an unrelated, stale shrimp exclusion as if just confirmed');
  });
});

test('Restaurant: an explicit shrimp allergy in the SAME message still gets acknowledged and filtered', async () => {
  await withHarness(async () => {
    const gid = guestId('owner-r2-real-shrimp-allergy');
    const r = await processThongthaiChatCore(
      brainRequest('แพ้กุ้งครับ มีเมนูอะไรแนะนำบ้าง', gid, 'web'),
      'evt-0',
    );
    assert.equal(r.statusCode, 200);
    const reply = msg(r.payload);
    assert.match(reply, /กุ้ง/u, 'a genuine, current-turn shrimp allergy must still be acknowledged');
  });
});

test('Elderly stay care: a practical "should I know/watch for anything" question gets useful guidance, never only the generic no-policy-data disclaimer', async () => {
  await withHarness(async () => {
    const gid = guestId('owner-r2-elderly-stay-care');
    const r = await processThongthaiChatCore(
      brainRequest('ถ้าพาผู้สูงอายุมาพักด้วย มีอะไรที่ควรรู้หรือควรระวังเป็นพิเศษไหมครับ', gid, 'web'),
      'evt-0',
    );
    assert.equal(r.statusCode, 200);
    const reply = msg(r.payload);
    assert.doesNotMatch(reply, /^ยังไม่มีข้อมูลนโยบายที่ยืนยันได้/u,
      'must not answer with only the blanket no-policy-data disclaimer');
    assert.match(reply, /ผู้สูงอายุ/u, 'must address the elderly-care concern directly');
    assert.match(reply, /\?|ไหม/u, 'must ask a concrete, useful follow-up rather than dead-ending');
  });
});
