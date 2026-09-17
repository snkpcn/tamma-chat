// Real unit tests for the incoming-slip-image payment resolution bug fixed
// here: a slip image must be matched to the payment the customer is
// actually paying, never guessed by created_at order, and never
// auto-attached when genuinely ambiguous. Uses Node's built-in test runner
// (node --test) — no new dependency, matching this repo's existing
// package.json (no test framework was installed before this).
//
// Run with: node --test --import tsx tests/payments.test.ts
// (or transpile first; any TS-aware `node --test` runner works since this
// file only imports the pure, I/O-free choosePaymentForReceipt function.)
//
// Lives outside netlify/functions/ deliberately — Netlify's function
// bundler discovers entry points from that directory, and a *.test.ts file
// there (even underscore-prefixed) risks being picked up and failing the
// bundle on its node:test/node:assert imports.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { choosePaymentForReceipt, type PaymentRequest } from '../netlify/functions/_payments';

function fakeRequest(overrides: Partial<PaymentRequest>): PaymentRequest {
  return {
    id: 'id-placeholder',
    payment_code: 'PAY-000000-00000000',
    entity_type: 'restaurant_preorder',
    entity_id: 'entity-placeholder',
    entity_code: 'PO-000000-00000000',
    guest_id: 'guest-a',
    customer_id: null,
    team_code: 'restaurant',
    amount: 100,
    currency: 'THB',
    method: 'promptpay_owner_qr',
    status: 'awaiting_payment',
    source_channel: 'line',
    environment: 'live',
    note: null,
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

test('a real preorder (awaiting_payment) is chosen over a later, not-yet-payable activity booking (quote_required)', () => {
  // Production case this bug fix addresses: PO-260917-EAF0E513 (restaurant,
  // awaiting_payment) existed before BK-260917-D0178517 (activity,
  // quote_required) was created. quote_required is never a payable
  // candidate at all, so PO must be the only candidate reaching the
  // resolver — matching what actually happened in production.
  const po = fakeRequest({ id: 'po-1', entity_code: 'PO-260917-EAF0E513', team_code: 'restaurant', status: 'awaiting_payment' });
  // BK is quote_required, so it is never included in the candidate list
  // passed in here — payableCandidatesForGuest() filters it out before
  // choosePaymentForReceipt() ever sees it.
  const candidates = [po];

  const result = choosePaymentForReceipt(candidates, null);

  assert.equal(result.kind, 'resolved');
  assert.equal(result.kind === 'resolved' ? result.request.entity_code : null, 'PO-260917-EAF0E513');
});

test('when two payable candidates exist, the one most recently delivered to the customer wins, not the newest by created_at', () => {
  const older = fakeRequest({
    id: 'po-1',
    entity_code: 'PO-260917-EAF0E513',
    team_code: 'restaurant',
    status: 'awaiting_payment',
    updated_at: '2026-09-17T11:26:47.000Z',
  });
  const newer = fakeRequest({
    id: 'bk-1',
    entity_code: 'BK-260917-D0178517',
    team_code: 'activity',
    status: 'awaiting_payment',
    updated_at: '2026-09-17T12:01:00.000Z',
  });
  // The old bug ordered by created_at desc and would have picked `newer`
  // (bk-1) here. The fix must pick whichever id the customer's QR/rejection
  // delivery log says was actually sent to them last — here, the older
  // restaurant preorder.
  const mostRecentlyDeliveredId = older.id;

  const result = choosePaymentForReceipt([newer, older], mostRecentlyDeliveredId);

  assert.equal(result.kind, 'resolved');
  assert.equal(result.kind === 'resolved' ? result.request.id : null, 'po-1');
});

test('two payable candidates with no delivery signal to disambiguate them is reported as ambiguous, never auto-attached', () => {
  const po = fakeRequest({ id: 'po-1', entity_code: 'PO-260917-EAF0E513', team_code: 'restaurant', status: 'awaiting_payment' });
  const bk = fakeRequest({ id: 'bk-1', entity_code: 'BK-260917-D0178517', team_code: 'activity', status: 'awaiting_payment' });

  const result = choosePaymentForReceipt([po, bk], null);

  assert.equal(result.kind, 'ambiguous');
  assert.equal(result.kind === 'ambiguous' ? result.candidates.length : -1, 2);
});

test('a single payable candidate is chosen directly with no delivery lookup needed', () => {
  const po = fakeRequest({ id: 'po-1', entity_code: 'PO-260917-EAF0E513' });
  const result = choosePaymentForReceipt([po], null);
  assert.equal(result.kind, 'resolved');
  assert.equal(result.kind === 'resolved' ? result.request.id : null, 'po-1');
});

test('no payable candidates at all resolves to none, not an error or a guess', () => {
  const result = choosePaymentForReceipt([], null);
  assert.equal(result.kind, 'none');
});
