// Gate 1 cross-domain customer-level stress: RESTAURANT, driven through the
// real canonical entry point processThongthaiChatCore (never hand-
// constructed SemanticTurn objects -- see tests/helpers/canonical-core-
// harness.ts). Covers what is verifiably zero-LLM/deterministic in the real
// codebase today: menu discovery, dietary-constraint filtering, promotion
// discovery surviving mid-restaurant-conversation, and -- once a proposed
// set exists (seeded via harness.setState the same way a correctly-
// functioning LLM turn would have written it via agentStateUpdate.
// restaurantProposedSet, per _thongthai-brain-v3.ts's own prompt contract)
// -- the deterministic accept/collect-missing-fields/create-preorder path,
// including exactly-once and no-premature-transaction guarantees.
//
// What this file does NOT attempt to prove: whether the real LLM correctly
// DECIDES to propose a set from "มีอะไรแนะนำ" in the first place -- that is
// a live prompt-quality question (see the harness's own header comment),
// not something offline verification can prove.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withHarness, guestId, brainRequest } from './helpers/canonical-core-harness';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';

test('restaurant: menu discovery answers from the real catalog with zero premature writes', async () => {
  await withHarness(async harness => {
    const gid = guestId('restaurant-menu-discovery');
    const r = await processThongthaiChatCore(brainRequest('ร้านมีอะไรกิน', gid, 'web'), 'evt-1');
    assert.equal(r.statusCode, 200);
    const message = String((r.payload as { message: string }).message);
    assert.match(message, /ผัดไทย/);
    assert.match(message, /ต้มยำกุ้ง/);
    assert.equal(harness.postsTo('restaurant_preorders_rpc').length, 0);
  });
});

// Updated (Master Roadmap Phase 2, "restaurant declaration still dumps a
// menu" round, 2026-09-24): this test originally expected a bare
// constraint statement mid-conversation to still show a filtered
// recommendation list. The owner's later, explicit, unconditional
// product rule -- "a customer telling Thongthai a constraint is not the
// same as asking for a menu ... only recommend when asked" -- overrides
// that: a bare constraint mention now always gets a short acknowledgment,
// never a recommendation dump, regardless of how recently a
// recommendation was shown (see thongthai-chat.ts's
// isBareRestaurantConstraintDeclaration / hasPendingRestaurantOrder).
// The "never proposes a transaction" guarantee this test exists to prove
// still holds.
test('restaurant: a dietary constraint mid-conversation gets a short acknowledgment, never proposing a transaction', async () => {
  await withHarness(async harness => {
    const gid = guestId('restaurant-dietary-constraint');
    await processThongthaiChatCore(brainRequest('ร้านมีอะไรกิน', gid, 'web'), 'evt-1');
    const r = await processThongthaiChatCore(brainRequest('จริงๆ ขอเผ็ดน้อย', gid, 'web'), 'evt-2');
    assert.equal(r.statusCode, 200);
    assert.doesNotMatch(String((r.payload as { message: string }).message), /บาท/u, 'a bare constraint statement must never dump a menu');
    assert.equal(harness.postsTo('restaurant_preorders_rpc').length, 0, 'a constraint statement alone must never create an order');
  });
});

test('restaurant: a promotion side-question mid-restaurant-conversation is answered without corrupting the restaurant topic', async () => {
  await withHarness(async harness => {
    const gid = guestId('restaurant-promo-side-question');
    await processThongthaiChatCore(brainRequest('ร้านมีอะไรกิน', gid, 'web'), 'evt-1');
    const r = await processThongthaiChatCore(brainRequest('มีโปรไหม', gid, 'web'), 'evt-2');
    assert.equal(r.statusCode, 200);
    assert.match(String((r.payload as { message: string }).message), /โปรโมชั่น/);
    assert.equal(harness.postsTo('restaurant_preorders_rpc').length, 0);
    assert.equal(harness.postsTo('promotion_redemptions').length, 0, 'discovery alone must never redeem');
  });
});

test('restaurant: accepting a proposed set collects missing fields before ever creating a preorder, then creates exactly once', async () => {
  await withHarness(async harness => {
    const gid = guestId('restaurant-accept-set-exactly-once');
    await processThongthaiChatCore(brainRequest('ร้านมีอะไรกิน', gid, 'web'), 'evt-1');
    const internalId = harness.guestDbId(gid)!;

    // Seed the SAME shape a correct LLM turn would have written via
    // agentStateUpdate.restaurantProposedSet (see _thongthai-brain-v3.ts
    // line ~255's prompt contract) -- this test is about what happens
    // AFTER a set is proposed, not whether the model decides to propose one.
    const existing = harness.getState(internalId);
    harness.setState(internalId, {
      ...(existing?.state ?? {}),
      restaurantProposedSet: {
        source: 'advisor',
        items: [{ name: 'ผัดไทย', quantity: 1 }, { name: 'ต้มยำกุ้ง', quantity: 1 }],
        total: 300, budget: 500, partySize: 2, createdAt: new Date().toISOString(),
      },
    });

    // Accepting with no date/time/name/phone must ask for what's missing,
    // never create a preorder yet.
    const r1 = await processThongthaiChatCore(brainRequest('เอาชุดเมื่อกี้', gid, 'web'), 'evt-2');
    assert.equal(r1.statusCode, 200);
    assert.match(String((r1.payload as { message: string }).message), /วัน|เวลา|ชื่อ|เบอร์/);
    assert.equal(harness.postsTo('restaurant_preorders_rpc').length, 0, 'missing fields must block creation');

    // An unrelated off-topic message in between must not be misread as
    // slot-filling and must not create anything (mirrors the promotion
    // loose-name-guard fix's spirit -- see
    // tests/promotion-redemption-loose-name-guard.test.ts). Checked
    // directly against the persisted draft, not just the downstream write
    // count -- an explicit name on a LATER turn would overwrite a wrongly-
    // captured one and mask the bug from a write-count-only assertion.
    const r2 = await processThongthaiChatCore(brainRequest('ตอนนี้ฝนตกไหม', gid, 'web'), 'evt-3');
    assert.equal(r2.statusCode, 200);
    assert.equal(harness.postsTo('restaurant_preorders_rpc').length, 0, 'an unrelated message must never create a preorder');
    const draftAfterOffTopic = harness.getState(internalId)?.state?.restaurantProposedSet as
      { preorderDraft?: { customerName?: string | null } } | undefined;
    assert.equal(
      draftAfterOffTopic?.preorderDraft?.customerName ?? null, null,
      'an unrelated off-topic message must never be captured as the customer name',
    );

    // Now supply everything at once -- exactly one preorder must be created.
    const r3 = await processThongthaiChatCore(
      brainRequest('รับพรุ่งนี้ 18:00 ชื่อสมชาย 0812345678', gid, 'web'), 'evt-4',
    );
    assert.equal(r3.statusCode, 200);
    const preorders = harness.postsTo('restaurant_preorders_rpc');
    assert.equal(preorders.length, 1, 'exactly one preorder, only after every required field was actually given');
    assert.match(String((r3.payload as { message: string }).message), /เรียบร้อย|✅/);

    // The draft must be cleared afterward, so a stray follow-up doesn't
    // re-trigger a second creation.
    const r4 = await processThongthaiChatCore(brainRequest('ยืนยัน', gid, 'web'), 'evt-5');
    assert.equal(r4.statusCode, 200);
    assert.equal(harness.postsTo('restaurant_preorders_rpc').length, 1, 'a stray confirmation after completion must never create a second preorder');
  });
});
