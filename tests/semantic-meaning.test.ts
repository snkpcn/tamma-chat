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

test('conversationalMode is the closed CHAT/ASK/DISCOVER/CONSIDER/COMMIT/INCIDENT contract', () => {
  assert.equal(deriveSemanticMeaning(turn({ domain: 'general', action: 'unknown', speechAct: 'social' })).conversationalMode, 'CHAT');
  assert.equal(deriveSemanticMeaning(turn({ action: 'ask' })).conversationalMode, 'ASK');
  assert.equal(deriveSemanticMeaning(turn({ action: 'status', informationNeed: 'availability' })).conversationalMode, 'ASK');
  assert.equal(deriveSemanticMeaning(turn({ action: 'recommend' })).conversationalMode, 'DISCOVER');
  assert.equal(deriveSemanticMeaning(turn({ action: 'provide_information', speechAct: 'preference_update', constraints: ['low_exertion'] })).conversationalMode, 'CONSIDER');
  assert.equal(deriveSemanticMeaning(turn({ action: 'confirm', speechAct: 'selection' })).conversationalMode, 'CONSIDER');
  assert.equal(deriveSemanticMeaning(turn({ action: 'book', speechAct: 'transaction_request' })).conversationalMode, 'COMMIT');
  assert.equal(deriveSemanticMeaning(turn({ domain: 'incident', action: 'provide_information', speechAct: 'incident_report' })).conversationalMode, 'INCIDENT');
});

// Human Core PR C1: real semantic scope understanding, using the exact
// example utterances from the mandate. Each is expressed here as the
// SemanticTurn shape the real model/deterministic layer would already
// produce for it (this file tests the pure derivation, not language
// understanding itself).
test('domain-wide whole-catalog browse ("ที่นี่มีกิจกรรมอะไรบ้าง"): focusKind domain, scopeBreadth domain_wide', () => {
  const meaning = deriveSemanticMeaning(turn({ action: 'discover', informationNeed: 'catalog' }));
  assert.equal(meaning.focusKind, 'domain');
  assert.equal(meaning.focusValue, null);
  assert.equal(meaning.scopeBreadth, 'domain_wide');
});

test('a stated entity TYPE ("มีม้าตัวไหนบ้าง", "ATV มีคันไหน"): focusKind entity_type, scopeBreadth focused', () => {
  for (const activityCode of ['horse', 'atv', 'archery']) {
    const meaning = deriveSemanticMeaning(turn({ action: 'discover', informationNeed: 'catalog', entities: { activityCode } }));
    assert.equal(meaning.focusKind, 'entity_type', activityCode);
    assert.equal(meaning.focusValue, activityCode);
    assert.equal(meaning.scopeBreadth, 'focused', activityCode);
  }
});

test('a named specific asset ("อยากขี่ม้า มีตัวไหนแนะนำ" once a horse is named): focusKind entity, scopeBreadth focused', () => {
  const meaning = deriveSemanticMeaning(turn({ action: 'recommend', entities: { horseName: 'ภาราดร' } }));
  assert.equal(meaning.focusKind, 'entity');
  assert.equal(meaning.focusValue, 'ภาราดร');
  assert.equal(meaning.scopeBreadth, 'focused');
});

test('a resolved canonical reference outranks a bare name: focusValue is the canonical id, not the raw name', () => {
  const meaning = deriveSemanticMeaning(turn({
    action: 'confirm',
    entities: { horseName: 'ภาราดร' },
    references: [{ type: 'entity_selection', refersToPriorContext: false, resolvedEntityId: 'activity_asset:horse-pharadon' }],
  }));
  assert.equal(meaning.focusKind, 'entity');
  assert.equal(meaning.focusValue, 'activity_asset:horse-pharadon');
});

test('an unresolved prior-context pointer ("เอาอันเดิม"): focusKind prior_reference, scopeBreadth still focused (bounded, not broad)', () => {
  const meaning = deriveSemanticMeaning(turn({
    action: 'confirm',
    references: [{ type: 'entity_selection', value: 'ม้าที่แนะนำเมื่อกี้', refersToPriorContext: true }],
  }));
  assert.equal(meaning.focusKind, 'prior_reference');
  assert.equal(meaning.focusValue, 'ม้าที่แนะนำเมื่อกี้');
  assert.equal(meaning.scopeBreadth, 'focused');
});

test('a genuinely ambiguous broad ask ("มีอะไรสนุก ๆ บ้าง" with no domain/type/entity signal): focusKind unknown, scopeBreadth unknown', () => {
  const meaning = deriveSemanticMeaning(turn({ domain: 'ecosystem', action: 'ask' }));
  assert.equal(meaning.focusKind, 'unknown');
  assert.equal(meaning.scopeBreadth, 'unknown');
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
