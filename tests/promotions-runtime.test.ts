// Unit tests for the pure decision logic in _promotions-runtime.ts -- the
// gate that decides whether an active promotion is real, in-window, under
// its redemption cap, and (for restaurant items) actually in stock before
// Thongthai is ever allowed to mention or redeem it for a customer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  channelMatches,
  checkCampaignEligibility,
  isRestaurantItemAvailable,
  preorderItemsFromPromotionItems,
  type PromotionCampaignRow,
} from '../netlify/functions/_promotions-runtime';

function campaign(overrides: Partial<PromotionCampaignRow> = {}): Pick<
  PromotionCampaignRow, 'status' | 'environment' | 'start_at' | 'end_at' | 'max_redemptions' | 'redemption_count'
> {
  return {
    status: 'active', environment: 'live', start_at: null, end_at: null,
    max_redemptions: null, redemption_count: 0,
    ...overrides,
  };
}

const NOW = new Date('2026-09-17T12:00:00Z').valueOf();

test('an active, live, unbounded promotion within its window is eligible', () => {
  assert.deepEqual(checkCampaignEligibility(campaign(), NOW), { ok: true });
});

test('a draft promotion is never customer-eligible', () => {
  assert.deepEqual(checkCampaignEligibility(campaign({ status: 'draft' }), NOW), { ok: false, reason: 'not_active' });
});

test('pending_review/paused/ended/cancelled promotions are never customer-eligible', () => {
  for (const status of ['pending_review', 'paused', 'ended', 'cancelled']) {
    assert.deepEqual(checkCampaignEligibility(campaign({ status }), NOW), { ok: false, reason: 'not_active' });
  }
});

test('a test-environment promotion is never eligible on the live customer channel', () => {
  assert.deepEqual(checkCampaignEligibility(campaign({ environment: 'test' }), NOW), { ok: false, reason: 'not_active' });
});

test('a promotion whose start_at is still in the future is not yet eligible', () => {
  const result = checkCampaignEligibility(campaign({ start_at: '2026-09-18T00:00:00Z' }), NOW);
  assert.deepEqual(result, { ok: false, reason: 'not_started' });
});

test('an expired promotion (end_at in the past) is never eligible', () => {
  const result = checkCampaignEligibility(campaign({ end_at: '2026-09-16T00:00:00Z' }), NOW);
  assert.deepEqual(result, { ok: false, reason: 'expired' });
});

test('a promotion still inside its start/end window is eligible', () => {
  const result = checkCampaignEligibility(
    campaign({ start_at: '2026-09-01T00:00:00Z', end_at: '2026-09-30T00:00:00Z' }), NOW,
  );
  assert.deepEqual(result, { ok: true });
});

test('a promotion at its redemption cap is no longer eligible', () => {
  const result = checkCampaignEligibility(campaign({ max_redemptions: 10, redemption_count: 10 }), NOW);
  assert.deepEqual(result, { ok: false, reason: 'redemption_limit_reached' });
});

test('a promotion under its redemption cap remains eligible', () => {
  const result = checkCampaignEligibility(campaign({ max_redemptions: 10, redemption_count: 9 }), NOW);
  assert.deepEqual(result, { ok: true });
});

test('a null campaign (not found) is rejected as not_found', () => {
  assert.deepEqual(checkCampaignEligibility(null, NOW), { ok: false, reason: 'not_found' });
});

test('an empty channel_scope means unrestricted -- visible on every channel', () => {
  assert.equal(channelMatches([], 'line'), true);
  assert.equal(channelMatches([], 'web'), true);
});

test('a non-empty channel_scope only matches channels it names', () => {
  assert.equal(channelMatches(['line'], 'line'), true);
  assert.equal(channelMatches(['line'], 'web'), false);
  assert.equal(channelMatches(['line', 'web'], 'web'), true);
});

test('a restaurant item is available only when orderable with enough live stock for the promo quantity', () => {
  assert.equal(isRestaurantItemAvailable({ is_orderable: true, available_servings: 5 }, 2), true);
  assert.equal(isRestaurantItemAvailable({ is_orderable: false, available_servings: 5 }, 2), false);
  assert.equal(isRestaurantItemAvailable({ is_orderable: true, available_servings: 1 }, 2), false);
  assert.equal(isRestaurantItemAvailable(undefined, 2), false);
});

test('promo-to-preorder handoff keeps exact items and quantities the promo stored -- never re-derived', () => {
  const promoItems = [
    { business_unit: 'restaurant', entity_id: 'menu-1', name_snapshot: 'ตำไทย', quantity: 2 },
    { business_unit: 'restaurant', entity_id: 'menu-2', name_snapshot: 'ข้าวเหนียว', quantity: 3 },
  ];
  assert.deepEqual(preorderItemsFromPromotionItems(promoItems), [
    { name: 'ตำไทย', quantity: 2 },
    { name: 'ข้าวเหนียว', quantity: 3 },
  ]);
});
