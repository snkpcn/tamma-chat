// Unit tests for the pure decision logic in _settlements.ts -- the
// internal payout ledger layered on top of payment_requests. Covers: which
// LINE card kind a settlement notification should dispatch, whether an
// "acknowledge transfer" postback is allowed given the settlement's
// current status, and whether a LINE group is authorized to act on a
// given settlement's team.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  settlementNotificationKind,
  decideAcknowledge,
  settlementTeamMatches,
} from '../netlify/functions/_settlements';

test('a freshly created pending_transfer settlement dispatches the pending-transfer card', () => {
  assert.equal(settlementNotificationKind('pending_transfer'), 'pending_transfer');
});

test('a transferred settlement dispatches the transferred card', () => {
  assert.equal(settlementNotificationKind('transferred'), 'transferred');
});

test('acknowledged/cancelled/transfer_submitted settlements dispatch no card (no re-notify loop)', () => {
  assert.equal(settlementNotificationKind('acknowledged'), 'none');
  assert.equal(settlementNotificationKind('cancelled'), 'none');
  assert.equal(settlementNotificationKind('transfer_submitted'), 'none');
});

test('acknowledge is allowed once a settlement is transferred', () => {
  assert.deepEqual(decideAcknowledge('transferred'), { kind: 'acknowledge' });
});

test('acknowledging an already-acknowledged settlement is a no-op reply, not a re-write', () => {
  assert.deepEqual(decideAcknowledge('acknowledged'), { kind: 'already_acknowledged' });
});

test('acknowledge is rejected before a transfer has actually happened -- staff cannot acknowledge money they have not received', () => {
  assert.deepEqual(decideAcknowledge('pending_transfer'), { kind: 'not_transferred_yet', status: 'pending_transfer' });
});

test('a team-bound LINE group can act on its own team settlement', () => {
  assert.equal(settlementTeamMatches('restaurant', 'restaurant'), true);
});

test('a LINE group bound to one team cannot act on a different team settlement', () => {
  assert.equal(settlementTeamMatches('activity', 'restaurant'), false);
});

test('a group bound to "all" teams can act on any team settlement', () => {
  assert.equal(settlementTeamMatches('all', 'restaurant'), true);
});
