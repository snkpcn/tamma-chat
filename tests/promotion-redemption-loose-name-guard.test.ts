// Regression test for a real, customer-facing bug found while building
// Gate 1's cross-domain stress coverage (see THONGTHAI_HANDOFF.md): once a
// promotion redemption was pending and only missing the customer's name,
// resolvePromotionRedemption (thongthai-chat.ts) reused
// parseRestaurantPreorderTurn's "loose name" fallback -- built for the
// restaurant preorder flow, where a stray aside after the order is
// committed is rare -- to accept ANY subsequent short message as the
// customer's name. An unrelated question, or a bare "ยืนยัน", was treated
// as a valid name and immediately redeemed the promotion, creating a new
// promotion_redemptions row every single time, with the customer's real
// name never actually captured.
//
// Fixed by passing { allowLooseName: false } at that call site, so
// promotion redemption now requires an EXPLICIT name marker ("ชื่อ...",
// "ผมชื่อ...", "ฉันชื่อ...") -- exactly like the restaurant preorder flow's
// own explicit-marker path, just without the loose fallback.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withHarness, guestId, brainRequest } from './helpers/canonical-core-harness';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';

test('promotion redemption: an unrelated off-topic message never fills in as the customer name, and never redeems', async () => {
  await withHarness(async harness => {
    const gid = guestId('promo-loose-name-offtopic');

    const r1 = await processThongthaiChatCore(brainRequest('มีโปรอะไร', gid, 'web'), 'evt-1');
    assert.equal(r1.statusCode, 200);

    const r2 = await processThongthaiChatCore(brainRequest('เอาโปรนี้ พรุ่งนี้ 12:00', gid, 'web'), 'evt-2');
    assert.equal(r2.statusCode, 200);

    // Off-topic message: must NOT be accepted as the customer's name.
    const r3 = await processThongthaiChatCore(brainRequest('ร้านมีอะไรแนะนำ', gid, 'web'), 'evt-3');
    assert.equal(r3.statusCode, 200);
    assert.equal(harness.postsTo('promotion_redemptions').length, 0, 'an off-topic message must never trigger a redemption');

    // A bare confirmation word must ALSO not be accepted as the name.
    const r4 = await processThongthaiChatCore(brainRequest('ยืนยัน', gid, 'web'), 'evt-4');
    assert.equal(r4.statusCode, 200);
    assert.equal(harness.postsTo('promotion_redemptions').length, 0, 'a bare confirmation must never be accepted as the customer name');
    assert.match(String((r4.payload as { message: string }).message), /ชื่อ/, 'must still be asking for the name');

    // Only an EXPLICIT name marker may satisfy the missing name.
    const r5 = await processThongthaiChatCore(brainRequest('ชื่อสมชาย', gid, 'web'), 'evt-5');
    assert.equal(r5.statusCode, 200);
    const redemptions = harness.postsTo('promotion_redemptions');
    assert.equal(redemptions.length, 1, 'exactly one redemption, only after an explicit name was actually given');
    assert.equal(redemptions[0]!.campaign_id, 'promo-otop-10');
  });
});

test('promotion redemption: an explicit name marker on the very first accept turn is still honored (no regression to the working path)', async () => {
  await withHarness(async harness => {
    const gid = guestId('promo-loose-name-explicit-first-turn');

    await processThongthaiChatCore(brainRequest('มีโปรอะไร', gid, 'web'), 'evt-1');
    const r2 = await processThongthaiChatCore(brainRequest('เอาโปรนี้ พรุ่งนี้ 12:00 ชื่อสมหญิง', gid, 'web'), 'evt-2');
    assert.equal(r2.statusCode, 200);

    const redemptions = harness.postsTo('promotion_redemptions');
    assert.equal(redemptions.length, 1);
    assert.equal(redemptions[0]!.campaign_id, 'promo-otop-10');
  });
});
