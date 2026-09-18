// Regression tests for a real production bug (Promotion OS Phase 2.1 fallback):
// once a pendingPromotionRedemption exists, a repeated discovery question
// ("มีโปรอะไร" again) was being fed straight into the redemption field parser,
// which treated the customer's own question text as their name. These tests
// exercise promotionContinuationResponse directly -- no network/DB involved,
// since guestDbId:null makes resolvePromotionRedemption short-circuit before
// any tool call, the same way the existing promotion-dialog tests stay pure.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promotionContinuationResponse } from '../netlify/functions/thongthai-chat';
import type { BrainRequest, BrainRuntimeContext } from '../netlify/functions/_thongthai-brain-v3';
import type { PendingPromotionRedemption, PromotionListItem } from '../netlify/functions/_promotion-dialog';

function request(message: string): BrainRequest {
  return {
    guestId: '00000000-0000-4000-8000-000000000002',
    message,
    language: 'th',
    chatHistory: [],
    guestContext: {
      tripDuration: null, travelerType: null,
      group: { adults: null, children: null, elderly: null },
      interests: [], pace: null, budget: null, constraints: [],
    },
    journeyContext: { currentPlan: null, savedPlan: null, visitedExperiences: [], favorites: [], journalEntries: [] },
    pageContext: { section: 'line' },
  };
}

function promo(): PromotionListItem {
  return {
    campaignId: '13a2092b-8c40-491f-84ed-1185fb502dc6', campaignCode: 'PROMO-260918-ABCDEF12',
    title: 'ตำไทย+ข้าวเหนียว bundle', description: null, businessScope: 'restaurant', promoType: 'bundle_price',
    items: [{ name: 'ตำไทย', quantity: 1, businessUnit: 'restaurant' }, { name: 'ข้าวเหนียว', quantity: 1, businessUnit: 'restaurant' }],
    normalTotal: 109, promoTotal: 99, discountPct: 9.17,
    startAt: null, endAt: null, maxRedemptions: null, redemptionCount: 0,
    requiresDateTime: true, automatedHandoff: true,
  };
}

function freshPending(): PendingPromotionRedemption {
  return {
    campaignId: '13a2092b-8c40-491f-84ed-1185fb502dc6', campaignCode: 'PROMO-260918-ABCDEF12',
    title: 'ตำไทย+ข้าวเหนียว bundle',
    items: [{ name: 'ตำไทย', quantity: 1 }, { name: 'ข้าวเหนียว', quantity: 1 }],
    requiresDateTime: true, promoTotal: 99,
    draft: { date: null, time: null, customerName: null, phone: null, email: null, acceptedAt: '2026-09-18T00:00:00.000Z' },
  };
}

function runtimeWith(pending: PendingPromotionRedemption): BrainRuntimeContext {
  return {
    agentState: { pendingPromotionRedemption: pending },
    semanticMemory: [],
    worldFacts: [{ fact_key: 'active_promotions_live', category: 'operations', fact_value: { promotions: [promo()] }, source: null, updated_at: '2026-09-18T00:00:00.000Z' }],
    toolResults: [],
  };
}

test('repeated "มีโปรอะไร" with a pending redemption re-shows the promo list, does not continue redemption', async () => {
  const pending = freshPending();
  const response = await promotionContinuationResponse(request('มีโปรอะไร'), runtimeWith(pending), null, 'line');
  assert.ok(response);
  assert.match(response!.message, /ตำไทย\+ข้าวเหนียว bundle/);
  assert.match(response!.message, /99 บาท/);
  // the pending redemption must be handed back completely unchanged -- in
  // particular the customer's own question text must never land in the name
  const roundTripped = response!.agentStateUpdate?.pendingPromotionRedemption as PendingPromotionRedemption;
  assert.deepEqual(roundTripped, pending);
  assert.notEqual(roundTripped.draft.customerName, 'มีโปรอะไร');
  assert.equal(roundTripped.draft.customerName, null);
});

test('"มีโปรอะไรอีก" after a pending redemption also re-shows discovery, never continues redemption', async () => {
  const pending = freshPending();
  const response = await promotionContinuationResponse(request('มีโปรอะไรอีก'), runtimeWith(pending), null, 'line');
  assert.ok(response);
  assert.match(response!.message, /ตำไทย\+ข้าวเหนียว bundle/);
  const roundTripped = response!.agentStateUpdate?.pendingPromotionRedemption as PendingPromotionRedemption;
  assert.equal(roundTripped.draft.customerName, null);
});

test('"มีโปรไหนบ้าง" after a pending redemption also re-shows discovery, never continues redemption', async () => {
  const pending = freshPending();
  const response = await promotionContinuationResponse(request('มีโปรไหนบ้าง'), runtimeWith(pending), null, 'line');
  assert.ok(response);
  assert.match(response!.message, /ตำไทย\+ข้าวเหนียว bundle/);
  const roundTripped = response!.agentStateUpdate?.pendingPromotionRedemption as PendingPromotionRedemption;
  assert.equal(roundTripped.draft.customerName, null);
});

test('discovery then "เอาโปรนี้ พรุ่งนี้ 14.00 ชื่อนุ๊ก" continues redemption with the real parsed fields, not blocked as a re-ask', async () => {
  const pending = freshPending();
  const response = await promotionContinuationResponse(
    request('เอาโปรนี้ พรุ่งนี้ 14.00 ชื่อนุ๊ก'), runtimeWith(pending), null, 'line',
  );
  assert.ok(response);
  // guestDbId:null makes resolvePromotionRedemption short-circuit before any
  // tool call (see the "!guestDbId" branch), so this stays a pure unit test
  // while still proving the redemption path -- not the discovery re-ask
  // branch -- was taken, and the fields were parsed correctly.
  const updated = response!.agentStateUpdate?.pendingPromotionRedemption as PendingPromotionRedemption;
  assert.equal(updated.draft.customerName, 'นุ๊ก');
  assert.equal(updated.draft.time, '14:00');
  assert.ok(updated.draft.date);
  assert.doesNotMatch(response!.message, /ตอนนี้มีโปรโมชั่นดังนี้ครับ/);
});

test('discovery then plain "เอาโปรนี้" (no date/time/name yet) continues redemption and asks for what is missing, not blocked as a re-ask', async () => {
  const pending = freshPending();
  const response = await promotionContinuationResponse(request('เอาโปรนี้ค่ะ'), runtimeWith(pending), null, 'line');
  assert.ok(response);
  const updated = response!.agentStateUpdate?.pendingPromotionRedemption as PendingPromotionRedemption;
  assert.equal(updated.draft.customerName, null);
  assert.doesNotMatch(response!.message, /ตอนนี้มีโปรโมชั่นดังนี้ครับ/);
});

test('"เอาชุดนี้" (the generic set-accept phrase) also continues redemption rather than being read as a discovery re-ask', async () => {
  const pending = freshPending();
  const response = await promotionContinuationResponse(
    request('เอาชุดนี้ พรุ่งนี้ 14:00 ชื่อนุ๊ก'), runtimeWith(pending), null, 'line',
  );
  assert.ok(response);
  const updated = response!.agentStateUpdate?.pendingPromotionRedemption as PendingPromotionRedemption;
  assert.equal(updated.draft.customerName, 'นุ๊ก');
});
