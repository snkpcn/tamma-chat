// Unit tests for the deterministic promotion discovery/redemption dialog
// (Promotion OS Phase 2.1) -- the fallback that lets a real customer still
// see and redeem an active promotion even when the LLM brain itself is
// unavailable. Pure decision-layer tests only, matching this repo's
// convention (see restaurant-preorder-dialog.test.ts): no network/DB/LLM
// mocking, just the deterministic logic that decides what to do.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPendingPromotionRedemption,
  decidePromotionFallback,
  formatPromotionClarificationMessage,
  formatPromotionListMessage,
  formatPromotionRedeemPrompt,
  isPromotionAcceptIntent,
  isPromotionDiscoveryIntent,
  isPromotionMention,
  matchPromotionByText,
  missingPromotionFields,
  parsePendingPromotionRedemption,
  type PromotionListItem,
} from '../netlify/functions/_promotion-dialog';

function promo(overrides: Partial<PromotionListItem> = {}): PromotionListItem {
  return {
    campaignId: '13a2092b-8c40-491f-84ed-1185fb502dc6', campaignCode: 'PROMO-260918-ABCDEF12',
    title: 'ตำไทย+ข้าวเหนียว bundle', description: null, businessScope: 'restaurant', promoType: 'bundle_price',
    items: [{ name: 'ตำไทย', quantity: 1, businessUnit: 'restaurant' }, { name: 'ข้าวเหนียว', quantity: 1, businessUnit: 'restaurant' }],
    normalTotal: 109, promoTotal: 99, discountPct: 9.17,
    startAt: null, endAt: null, maxRedemptions: null, redemptionCount: 0,
    requiresDateTime: true, automatedHandoff: true,
    ...overrides,
  };
}

// --- intent detection ---

test('"มีโปรอะไร" is a promotion mention and a discovery intent', () => {
  assert.equal(isPromotionMention('มีโปรอะไรบ้างไหม'), true);
  assert.equal(isPromotionDiscoveryIntent('มีโปรอะไรบ้างไหม'), true);
});

test('"วันนี้มีโปรอะไร" and "โปรสำหรับ 2 คน" are discovery intents', () => {
  assert.equal(isPromotionDiscoveryIntent('วันนี้มีโปรอะไร'), true);
  assert.equal(isPromotionDiscoveryIntent('โปรสำหรับ 2 คน'), true);
});

test('"เอาโปรนี้" / "ใช้โปรนี้" are accept intents', () => {
  assert.equal(isPromotionAcceptIntent('เอาโปรนี้'), true);
  assert.equal(isPromotionAcceptIntent('ใช้โปรนี้ค่ะ'), true);
});

test('"โปรด...หน่อยครับ" (please) is never a promotion mention', () => {
  assert.equal(isPromotionMention('โปรดแนะนำเมนูหน่อยครับ'), false);
});

// --- matching ---

test('a message naming the promo title resolves to that promotion', () => {
  const promotions = [promo()];
  const matched = matchPromotionByText('เอาโปรตำไทย+ข้าวเหนียว bundle พรุ่งนี้ 14:00', promotions);
  assert.equal(matched?.campaignId, promotions[0]!.campaignId);
});

test('a message naming an item from the promo resolves it when it is the only match', () => {
  const promotions = [promo()];
  const matched = matchPromotionByText('เอาโปรตำไทยค่ะ', promotions);
  assert.equal(matched?.campaignId, promotions[0]!.campaignId);
});

test('an ambiguous item name across two promotions never guesses', () => {
  const promotions = [
    promo({ campaignId: 'a', title: 'โปร A', items: [{ name: 'ตำไทย', quantity: 1, businessUnit: 'restaurant' }] }),
    promo({ campaignId: 'b', title: 'โปร B', items: [{ name: 'ตำไทย', quantity: 2, businessUnit: 'restaurant' }] }),
  ];
  assert.equal(matchPromotionByText('เอาโปรตำไทย', promotions), null);
});

// --- decidePromotionFallback: the core pure decision used by both the LLM-down
// discovery fallback and the confirmation that a non-promo message is left alone ---

test('LLM unavailable + "มีโปรอะไร" with one active promo resolves to list with that promo', () => {
  const promotions = [promo()];
  const decision = decidePromotionFallback('มีโปรอะไรบ้างไหม', promotions);
  assert.equal(decision.kind, 'list');
  if (decision.kind === 'list') assert.equal(decision.promotions.length, 1);
});

test('no active promo returns an honest no-promo decision, never invented content', () => {
  const decision = decidePromotionFallback('มีโปรอะไรบ้างไหม', []);
  assert.equal(decision.kind, 'no_promotions');
  assert.match(formatPromotionListMessage([]), /ยังไม่มีโปรโมชั่นพิเศษเปิดใช้งาน/);
});

test('a normal non-promo message is left alone (not_promo_related) so normal chat still falls back gracefully', () => {
  const decision = decidePromotionFallback('วันนี้อากาศดีจัง', [promo()]);
  assert.equal(decision.kind, 'not_promo_related');
});

test('LLM unavailable + "เอาโปรนี้ พรุ่งนี้ 14.00 ชื่อนุ๊ก" starts redemption with exact promo items/qty and parsed fields', () => {
  const promotions = [promo()];
  const decision = decidePromotionFallback('เอาโปรนี้ พรุ่งนี้ 14.00 ชื่อนุ๊ก', promotions);
  assert.equal(decision.kind, 'start_redemption');
  if (decision.kind !== 'start_redemption') return;
  assert.equal(decision.pending.campaignId, promotions[0]!.campaignId);
  assert.deepEqual(decision.pending.items, [{ name: 'ตำไทย', quantity: 1 }, { name: 'ข้าวเหนียว', quantity: 1 }]);
  assert.equal(decision.pending.draft.time, '14:00');
  assert.equal(decision.pending.draft.customerName, 'นุ๊ก');
  assert.deepEqual(missingPromotionFields(decision.pending), []);
});

test('accepting with only some fields present asks only for what is missing', () => {
  const promotions = [promo()];
  const decision = decidePromotionFallback('เอาโปรนี้ค่ะ', promotions);
  assert.equal(decision.kind, 'start_redemption');
  if (decision.kind !== 'start_redemption') return;
  assert.deepEqual(missingPromotionFields(decision.pending), ['date', 'time', 'customerName']);
  assert.match(formatPromotionRedeemPrompt(decision.pending), /ขอวัน \+ เวลารับอาหาร/);
});

test('a non-restaurant promo (no requiresDateTime) only needs a name, never date/time', () => {
  const nonRestaurant = promo({ businessScope: 'activity', requiresDateTime: false, automatedHandoff: false });
  const pending = buildPendingPromotionRedemption(nonRestaurant);
  assert.deepEqual(missingPromotionFields(pending), ['customerName']);
});

test('multiple active promotions with an unspecific accept message asks for clarification, never guesses one', () => {
  const promotions = [
    promo({ campaignId: 'a', title: 'โปร A' }),
    promo({ campaignId: 'b', title: 'โปร B' }),
  ];
  const decision = decidePromotionFallback('เอาโปรนี้ค่ะ', promotions);
  assert.equal(decision.kind, 'clarify');
  if (decision.kind === 'clarify') {
    const message = formatPromotionClarificationMessage(decision.promotions);
    assert.match(message, /โปร A/);
    assert.match(message, /โปร B/);
  }
});

// --- state round-trip ---

test('a pending redemption written to agentState round-trips through parsePendingPromotionRedemption', () => {
  const pending = buildPendingPromotionRedemption(promo());
  const raw = JSON.parse(JSON.stringify(pending));
  const parsed = parsePendingPromotionRedemption(raw);
  assert.deepEqual(parsed?.items, pending.items);
  assert.equal(parsed?.campaignId, pending.campaignId);
});

test('a malformed/corrupted agentState value never crashes -- returns null', () => {
  assert.equal(parsePendingPromotionRedemption(null), null);
  assert.equal(parsePendingPromotionRedemption({}), null);
  assert.equal(parsePendingPromotionRedemption({ campaignId: 'x' }), null);
  assert.equal(parsePendingPromotionRedemption('not an object'), null);
});

// --- exact promo total flows through to the composed message ---

test('the promo list message quotes the exact real normal/promo totals, never recomputed', () => {
  const message = formatPromotionListMessage([promo()]);
  assert.match(message, /99 บาท/);
  assert.match(message, /109 บาท/);
});

test('the redeem prompt quotes the exact real promo total', () => {
  const pending = buildPendingPromotionRedemption(promo());
  assert.match(formatPromotionRedeemPrompt(pending), /99 บาท/);
});
