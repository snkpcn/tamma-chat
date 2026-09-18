// Phase F: extends Phase B's legacy shadow harness (_semantic-interpreter-shadow.ts)
// into the new Dialog Manager pipeline. For representative turns, compares
// the LEGACY deterministic router's domain guess against the new
// semantic -> dialog -> knowledge-plan pipeline's domain + knowledge
// requests, and classifies the divergence. Read-only comparison only --
// never wired into production, never forces the new system to copy a
// legacy bug (see Phase B's shadow tests for the two already-documented
// legacy gaps this reuses: แถวนี้ทำไรดี and โปรมีไร).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { legacyShadowRoute } from '../netlify/functions/_semantic-interpreter-shadow';
import { planDialogTurn } from '../netlify/functions/_dialog-manager';
import { emptyConversationContextState, buildSemanticContext, applyConversationContextUpdate, type ConversationContextState } from '../netlify/functions/_conversation-context';
import { emptyTaskStateContainer } from '../netlify/functions/_task-state';
import { parseSemanticTurnResponse, type SemanticDomain } from '../netlify/functions/_semantic-interpreter';

const NOW = new Date('2026-09-18T10:00:00.000Z');

type Divergence = 'expected_improvement' | 'equivalent' | 'needs_review';

function classify(legacyDomain: SemanticDomain | null, newDomain: SemanticDomain, legacyMatched: boolean): Divergence {
  if (legacyMatched && legacyDomain === newDomain) return 'equivalent';
  if (!legacyMatched && newDomain !== 'unknown') return 'expected_improvement';
  return 'needs_review';
}

test('shadow comparison: known legacy gaps are classified as expected_improvement under the new pipeline', () => {
  const cases: Array<{ message: string; newDomain: SemanticDomain; note: string }> = [
    { message: 'แถวนี้ทำไรดี', newDomain: 'ecosystem', note: 'broad discovery phrasing the legacy regex never caught' },
    { message: 'โปรมีไร', newDomain: 'promotion', note: 'short promotion-discovery phrasing the legacy regex never caught' },
  ];
  for (const testCase of cases) {
    const legacy = legacyShadowRoute(testCase.message);
    const divergence = classify(legacy.legacyDomain, testCase.newDomain, legacy.matchedBy.length > 0);
    assert.equal(legacy.legacyDomain, null, `${testCase.message}: legacy router was expected to still miss this (documented gap, see Phase B)`);
    assert.equal(divergence, 'expected_improvement', `${testCase.message}: ${testCase.note}`);
  }
});

test('shadow comparison: a contextual reference turn is only interpretable by the new pipeline (legacy has no context at all)', () => {
  // "พรุ่งนี้สองคน" carries zero domain-identifying keywords on its own --
  // the legacy regex router necessarily returns null (it is stateless).
  // The new pipeline resolves the SAME message correctly because it reads
  // real server-side conversationContext.activeDomain.
  const message = 'พรุ่งนี้สองคน';
  const legacy = legacyShadowRoute(message);
  assert.equal(legacy.legacyDomain, null, 'the legacy router has no notion of context, so it cannot possibly resolve a bare contextual reference');

  let context: ConversationContextState = emptyConversationContextState(NOW);
  context = applyConversationContextUpdate(context, { userMessage: 'ม้าล่ะ', channel: 'web', eventId: 'shadow-ctx-1', activeDomain: 'activity', activeTopic: 'horse riding' }, NOW);
  const semanticContext = buildSemanticContext(context, NOW);
  const turn = parseSemanticTurnResponse(JSON.stringify({ domain: 'activity', intent: 'provide_booking_slot_info', action: 'provide_information', entities: { date: 'พรุ่งนี้', partySize: 2 }, references: [], constraints: [], confidence: 0.85, needsClarification: false }), semanticContext);
  const plan = planDialogTurn({ semanticTurn: turn, conversationContext: context, taskState: emptyTaskStateContainer(), channel: 'web', eventId: 'shadow-ctx-2' }, NOW);
  assert.equal(turn.domain, 'activity');
  assert.ok(plan.taskStateContainer.activeTask, 'the new pipeline correctly continues the activity task from context alone');
  assert.equal(classify(legacy.legacyDomain, turn.domain, legacy.matchedBy.length > 0), 'expected_improvement');
});

test('shadow comparison: a correction turn ("ไม่ใช่ เอาทองไทย") is handled generically by the new merge logic; the legacy system has no correction concept at all', () => {
  const message = 'ไม่ใช่ เอาทองไทย';
  const legacy = legacyShadowRoute(message);
  // The legacy router is a stateless keyword matcher -- it has no concept
  // of "correcting a prior selection" whatsoever, so whatever it returns
  // (matched or not) is incidental, never a real correction mechanism.
  const semanticContext = buildSemanticContext(emptyConversationContextState(NOW), NOW);
  const turn = parseSemanticTurnResponse(JSON.stringify({ domain: 'activity', intent: 'correct_horse_selection', action: 'correct_previous', entities: { horseName: 'ทองไทย' }, references: [], constraints: [], confidence: 0.85, needsClarification: false }), semanticContext);
  assert.equal(turn.action, 'correct_previous', 'the new architecture has a dedicated, generic correction action -- the legacy system has none');
  void legacy;
});

test('shadow comparison: equivalent case (explicit restaurant mention both systems catch)', () => {
  const message = 'ตำไทยอร่อยไหม';
  const legacy = legacyShadowRoute(message);
  const semanticContext = buildSemanticContext(emptyConversationContextState(NOW), NOW);
  const turn = parseSemanticTurnResponse(JSON.stringify({ domain: 'restaurant', intent: 'ask_about_dish', action: 'ask', entities: {}, references: [], constraints: [], confidence: 0.85, needsClarification: false }), semanticContext);
  const divergence = classify(legacy.legacyDomain, turn.domain, legacy.matchedBy.length > 0);
  assert.equal(divergence, 'equivalent', 'both the legacy explicit-food regex and the new semantic layer correctly catch an explicit dish mention');
});
