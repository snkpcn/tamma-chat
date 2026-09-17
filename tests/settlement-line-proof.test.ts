import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseSettlementForProof } from '../netlify/functions/_settlement-line-proof';

const base = {
  entity_code: 'PO-260917-AAAAAAAA',
  team_code: 'restaurant',
  amount_due: 168,
  status: 'pending_transfer' as const,
  transfer_proof_path: null,
  updated_at: '2026-09-17T14:00:00.000Z',
};

test('single pending settlement resolves automatically', () => {
  const one = { ...base, id: '11111111-1111-4111-8111-111111111111' };
  const result = chooseSettlementForProof([one], null);
  assert.equal(result.kind, 'resolved');
  if (result.kind === 'resolved') assert.equal(result.settlement.id, one.id);
});

test('multiple pending settlements resolve to most recently delivered card', () => {
  const first = { ...base, id: '11111111-1111-4111-8111-111111111111' };
  const second = { ...base, id: '22222222-2222-4222-8222-222222222222', entity_code: 'PO-260917-BBBBBBBB', amount_due: 250 };
  const result = chooseSettlementForProof([first, second], second.id);
  assert.equal(result.kind, 'resolved');
  if (result.kind === 'resolved') assert.equal(result.settlement.id, second.id);
});

test('multiple pending settlements without delivery context stay ambiguous', () => {
  const first = { ...base, id: '11111111-1111-4111-8111-111111111111' };
  const second = { ...base, id: '22222222-2222-4222-8222-222222222222', entity_code: 'PO-260917-BBBBBBBB', amount_due: 250 };
  const result = chooseSettlementForProof([first, second], null);
  assert.equal(result.kind, 'ambiguous');
});

test('no pending settlements returns none', () => {
  const result = chooseSettlementForProof([], null);
  assert.equal(result.kind, 'none');
});
