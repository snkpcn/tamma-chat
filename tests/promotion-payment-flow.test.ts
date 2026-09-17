// Unit tests for Promotion OS Phase 2 -- threading the real promo price into
// the actual payment. Covers the pure decision points: which restaurant
// items get a price override (and that it can only ever come from real,
// stored promotion_items rows, never a customer/LLM-supplied amount), the
// idempotency key that makes a duplicate redemption request safe, and that
// the brain's redeem_promotion tool call carries no price field at all for
// buildPricingOverride to even see.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPricingOverride, type PromotionItemRow } from '../netlify/functions/_promotions-runtime';
import { restaurantPreorderPromotionIdempotencyKey } from '../netlify/functions/_restaurant-sot';
import { normalizeToolCalls, type BrainRuntimeContext } from '../netlify/functions/_thongthai-brain-v3';

function item(overrides: Partial<PromotionItemRow> = {}): PromotionItemRow {
  return { business_unit: 'restaurant', entity_id: 'menu-1', name_snapshot: 'ตำไทย', quantity: 1, promo_price: 79, cost_basis: 21.835, ...overrides };
}

test('a restaurant item with a real stored promo_price gets an override keyed by its menu_item_id', () => {
  const override = buildPricingOverride([item({ entity_id: 'menu-1', promo_price: 79 })]);
  assert.deepEqual(override, { 'menu-1': 79 });
});

test('multiple restaurant items each get their own real promo price', () => {
  const override = buildPricingOverride([
    item({ entity_id: 'menu-1', name_snapshot: 'ตำไทย', promo_price: 79 }),
    item({ entity_id: 'menu-2', name_snapshot: 'ข้าวเหนียว', promo_price: 20 }),
  ]);
  assert.deepEqual(override, { 'menu-1': 79, 'menu-2': 20 });
});

test('an item with no stored promo_price is left out of the override -- the RPC falls back to live menu price, never zero by accident', () => {
  const override = buildPricingOverride([item({ entity_id: 'menu-1', promo_price: null })]);
  assert.deepEqual(override, {});
});

test('a non-restaurant business_unit item is never included, even with a promo_price set', () => {
  const override = buildPricingOverride([item({ business_unit: 'otop', entity_id: 'otop-1', promo_price: 50 })]);
  assert.deepEqual(override, {});
});

test('a negative promo_price is refused rather than passed through', () => {
  const override = buildPricingOverride([item({ entity_id: 'menu-1', promo_price: -5 })]);
  assert.deepEqual(override, {});
});

test('the same redemption inputs always hash to the same idempotency key -- a duplicate webhook delivery or repeated tool call replays into the same key', () => {
  const input = {
    guestDbId: 'guest-1', requestedForIso: '2026-09-18T07:00:00.000Z',
    items: [{ menuItemId: 'menu-1', quantity: 2 }], customerName: 'นุ๊ก', note: 'PROMO:PROMO-260917-ABC',
    environment: 'live' as const, promotionCampaignId: 'campaign-1', pricingOverride: { 'menu-1': 79 },
  };
  const keyA = restaurantPreorderPromotionIdempotencyKey(input);
  const keyB = restaurantPreorderPromotionIdempotencyKey({ ...input });
  assert.equal(keyA, keyB);
});

test('item order does not change the idempotency key (canonical sort by menuItemId)', () => {
  const base = {
    guestDbId: 'guest-1', requestedForIso: '2026-09-18T07:00:00.000Z',
    customerName: 'นุ๊ก', note: 'PROMO:PROMO-260917-ABC', environment: 'live' as const,
    promotionCampaignId: 'campaign-1', pricingOverride: { 'menu-1': 79, 'menu-2': 20 },
  };
  const keyA = restaurantPreorderPromotionIdempotencyKey({ ...base, items: [{ menuItemId: 'menu-1', quantity: 1 }, { menuItemId: 'menu-2', quantity: 1 }] });
  const keyB = restaurantPreorderPromotionIdempotencyKey({ ...base, items: [{ menuItemId: 'menu-2', quantity: 1 }, { menuItemId: 'menu-1', quantity: 1 }] });
  assert.equal(keyA, keyB);
});

test('a different campaign, time, or pricing produces a different idempotency key', () => {
  const base = {
    guestDbId: 'guest-1', requestedForIso: '2026-09-18T07:00:00.000Z',
    items: [{ menuItemId: 'menu-1', quantity: 1 }], customerName: 'นุ๊ก', note: '', environment: 'live' as const,
    promotionCampaignId: 'campaign-1', pricingOverride: { 'menu-1': 79 },
  };
  const baseline = restaurantPreorderPromotionIdempotencyKey(base);
  assert.notEqual(restaurantPreorderPromotionIdempotencyKey({ ...base, promotionCampaignId: 'campaign-2' }), baseline);
  assert.notEqual(restaurantPreorderPromotionIdempotencyKey({ ...base, requestedForIso: '2026-09-19T07:00:00.000Z' }), baseline);
  assert.notEqual(restaurantPreorderPromotionIdempotencyKey({ ...base, pricingOverride: { 'menu-1': 69 } }), baseline);
});

function runtime(): BrainRuntimeContext {
  return { agentState: {}, semanticMemory: [], worldFacts: [], toolResults: [] };
}

test('redeem_promotion tool call never carries a price/amount field through, even if the raw LLM output tried to include one', () => {
  const raw = [{
    name: 'redeem_promotion',
    args: {
      campaignId: '13a2092b-8c40-491f-84ed-1185fb502dc6', customerName: 'นุ๊ก', date: '2026-09-18', time: '14:00',
      price: 1, promoPrice: 1, amount: 1, totalAmount: 1, pricingOverride: { 'menu-1': 1 },
    },
  }];
  const calls = normalizeToolCalls(raw, false, runtime());
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.name, 'redeem_promotion');
  const keys = Object.keys(calls[0]!.args);
  for (const forbidden of ['price', 'promoPrice', 'amount', 'totalAmount', 'pricingOverride']) {
    assert.equal(keys.includes(forbidden), false, `redeem_promotion args must never carry ${forbidden}`);
  }
  assert.deepEqual(calls[0]!.args, { campaignId: '13a2092b-8c40-491f-84ed-1185fb502dc6', customerName: 'นุ๊ก', date: '2026-09-18', time: '14:00' });
});

test('redeem_promotion requires a plausible campaignId and a customerName, or it is dropped', () => {
  const missingName = normalizeToolCalls([{ name: 'redeem_promotion', args: { campaignId: '13a2092b-8c40-491f-84ed-1185fb502dc6' } }], false, runtime());
  assert.equal(missingName.length, 0);
  const badId = normalizeToolCalls([{ name: 'redeem_promotion', args: { campaignId: 'not-a-uuid', customerName: 'นุ๊ก' } }], false, runtime());
  assert.equal(badId.length, 0);
});
