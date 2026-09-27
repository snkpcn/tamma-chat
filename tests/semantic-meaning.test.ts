// Human Core PR B: the SemanticMeaning contract. Pure unit tests for
// deriveSemanticMeaning -- no I/O, no model, no orchestrator involved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveSemanticMeaning } from '../netlify/functions/_semantic-meaning';
import type { SemanticTurn } from '../netlify/functions/_semantic-interpreter';

function turn(overrides: Partial<SemanticTurn>): SemanticTurn {
  return {
    domain: 'activity',
    intent: 'test',
    action: 'ask',
    entities: {},
    references: [],
    constraints: [],
    confidence: 0.95,
    needsClarification: false,
    ...overrides,
  };
}

test('commitmentLevel is explicit_transaction only for book/order or an explicit transaction_request speech act', () => {
  assert.equal(deriveSemanticMeaning(turn({ action: 'book' })).commitmentLevel, 'explicit_transaction');
  assert.equal(deriveSemanticMeaning(turn({ action: 'order' })).commitmentLevel, 'explicit_transaction');
  assert.equal(deriveSemanticMeaning(turn({ action: 'ask', speechAct: 'transaction_request' })).commitmentLevel, 'explicit_transaction');
  assert.equal(deriveSemanticMeaning(turn({ action: 'confirm' })).commitmentLevel, 'planning');
  assert.equal(deriveSemanticMeaning(turn({ action: 'discover' })).commitmentLevel, 'exploratory');
  assert.equal(deriveSemanticMeaning(turn({ action: 'status' })).commitmentLevel, 'none');
  assert.equal(deriveSemanticMeaning(turn({ action: 'cancel' })).commitmentLevel, 'none');
});

test('a bare selection (speechAct selection, action confirm) is planning, never explicit_transaction', () => {
  const meaning = deriveSemanticMeaning(turn({
    action: 'confirm', speechAct: 'selection',
    entities: { resourceCode: 'activity-horse', horseName: 'ภาราดร' },
  }));
  assert.equal(meaning.commitmentLevel, 'planning');
  assert.notEqual(meaning.commitmentLevel, 'explicit_transaction');
});

test('scopeBreadth is focused when a reference resolves to an entity, domain_wide for bare discovery, unknown otherwise', () => {
  assert.equal(deriveSemanticMeaning(turn({
    action: 'ask', references: [{ type: 'entity_selection', refersToPriorContext: false, resolvedEntityId: 'activity_asset:horse-pharadon' }],
  })).scopeBreadth, 'focused');
  assert.equal(deriveSemanticMeaning(turn({ action: 'discover' })).scopeBreadth, 'domain_wide');
  assert.equal(deriveSemanticMeaning(turn({ action: 'status' })).scopeBreadth, 'unknown');
});

test('userGoal reflects commitment/help/management without inspecting action itself downstream', () => {
  assert.equal(deriveSemanticMeaning(turn({ action: 'book' })).userGoal, 'commit');
  assert.equal(deriveSemanticMeaning(turn({ action: 'ask', speechAct: 'complaint' })).userGoal, 'get_help');
  assert.equal(deriveSemanticMeaning(turn({ action: 'cancel' })).userGoal, 'manage_existing');
  assert.equal(deriveSemanticMeaning(turn({ action: 'discover' })).userGoal, 'browse_or_decide');
  assert.equal(deriveSemanticMeaning(turn({ action: 'status' })).userGoal, 'unknown');
});

test('semanticFocus prefers a resolved entity id, falls back to domain:informationNeed', () => {
  assert.equal(deriveSemanticMeaning(turn({
    action: 'ask', references: [{ type: 'entity_selection', refersToPriorContext: false, resolvedEntityId: 'activity_asset:horse-pharadon' }],
  })).semanticFocus, 'activity_asset:horse-pharadon');
  assert.equal(deriveSemanticMeaning(turn({ domain: 'restaurant', informationNeed: 'recommendation', action: 'recommend' })).semanticFocus, 'restaurant:recommendation');
  assert.equal(deriveSemanticMeaning(turn({ domain: 'restaurant', action: 'ask' })).semanticFocus, 'restaurant:ask');
});

test('corrections only lists entity keys on a genuine correction turn, never an unrelated turn\'s full entity set', () => {
  assert.deepEqual(deriveSemanticMeaning(turn({
    action: 'correct_previous', entities: { date: '2026-10-05' },
  })).corrections, ['date']);
  assert.deepEqual(deriveSemanticMeaning(turn({
    action: 'provide_information', speechAct: 'correction', entities: { time: '18:00' },
  })).corrections, ['time']);
  assert.deepEqual(deriveSemanticMeaning(turn({
    action: 'provide_information', entities: { time: '18:00' },
  })).corrections, []);
});

test('temporalMeaning is lifted structurally from entities.date/time, never parsed from normalizedMeaning', () => {
  assert.deepEqual(deriveSemanticMeaning(turn({ entities: { date: '2026-10-05', time: '18:00' } })).temporalMeaning, { date: '2026-10-05', time: '18:00' });
  assert.equal(deriveSemanticMeaning(turn({ entities: {}, normalizedMeaning: 'tomorrow at 6pm' })).temporalMeaning, null,
    'normalizedMeaning must never be read to derive a closed field');
});

test('refersToPriorContext is true when ANY reference resolves against prior context', () => {
  assert.equal(deriveSemanticMeaning(turn({
    references: [{ type: 'entity_selection', refersToPriorContext: true }],
  })).refersToPriorContext, true);
  assert.equal(deriveSemanticMeaning(turn({
    references: [{ type: 'entity_selection', refersToPriorContext: false }],
  })).refersToPriorContext, false);
  assert.equal(deriveSemanticMeaning(turn({ references: [] })).refersToPriorContext, false);
});

test('normalizedMeaning is never a field on SemanticMeaning', () => {
  const meaning = deriveSemanticMeaning(turn({ normalizedMeaning: 'anything the customer said' }));
  assert.equal((meaning as unknown as Record<string, unknown>).normalizedMeaning, undefined);
});

test('confidence and needsClarification pass through unchanged', () => {
  const meaning = deriveSemanticMeaning(turn({ confidence: 0.42, needsClarification: true }));
  assert.equal(meaning.confidence, 0.42);
  assert.equal(meaning.needsClarification, true);
});
