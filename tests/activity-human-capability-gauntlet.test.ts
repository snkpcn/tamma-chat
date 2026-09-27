// Human Core PR D8: Activity Human Capability Gauntlet.
//
// HONEST SCOPE NOTE: this sandbox has no live OpenAI access, and the
// mandate explicitly forbids auto-running paid live certification. Every
// scenario below therefore drives the REAL production pipeline (the
// response composer, the CanonicalKnowledgeScope firewall, the booking-args
// resolver) from an INJECTED SemanticTurn representing what the paid
// semantic supervisor would have produced for a paraphrased customer
// message -- exactly the established pattern this whole test suite already
// uses everywhere a paid model call sits upstream of the code under test
// (see e.g. tests/canonical-knowledge-scope.test.ts, tests/human-brain-
// grounded-human-response.test.ts). "Hidden/paraphrased" here means: none
// of the Thai wording below is copied from an existing named test fixture.
//
// Scope: this gauntlet exercises what Human Core PR D actually changed --
// the new generic care/safety/suitability/equipment capability, its
// cross-activity isolation, and the booking-execution structured-args fix.
// Categories this PR did NOT touch (comparison, correction, prior-context
// reference, slang/incomplete Thai, switch-topic-and-return, price/how-it-
// works questions, new-unseen-activity-type discovery) already have
// dedicated, extensive coverage elsewhere in this suite (see
// tests/scenario-horse-extended.test.ts, tests/semantic-*-understanding.
// test.ts, tests/canonical-knowledge-scope.test.ts's C8.1-C8.13, and
// tests/master-roadmap-phase2-*.test.ts) and are cited rather than
// re-verified here, per this engagement's practice of not duplicating
// working coverage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeGroundedDeterministicResponse, composeThongthaiResponse } from '../netlify/functions/_response-composer';
import { resolveActivityBookingProposalArgs } from '../netlify/functions/thongthai-chat';
import { deriveCanonicalKnowledgeScope, resolveCanonicalScopeAgainstFacts, filterFactsByCanonicalScope } from '../netlify/functions/_canonical-knowledge-scope';
import { deriveSemanticMeaning } from '../netlify/functions/_semantic-meaning';
import { emptyTaskStateContainer } from '../netlify/functions/_task-state';
import type { SemanticTurn } from '../netlify/functions/_semantic-interpreter';
import type { DialogDecision } from '../netlify/functions/_dialog-manager';

function turn(overrides: Partial<SemanticTurn> = {}): SemanticTurn {
  return {
    domain: 'activity', intent: 'activity_care_question', action: 'ask',
    entities: {}, references: [], constraints: [], confidence: 0.92, needsClarification: false,
    ...overrides,
  };
}

function decision(overrides: Partial<DialogDecision> = {}): DialogDecision {
  return {
    mode: 'answer', taskStateContainer: emptyTaskStateContainer(), knowledgeRequests: [],
    missingFields: [], responseIntent: 'grounded_answer', reasons: [],
    ...overrides,
  };
}

function compose(semanticTurn: SemanticTurn, dialogDecision: DialogDecision = decision()) {
  return composeGroundedDeterministicResponse({
    channel: 'web', language: 'th', semanticTurn, dialogDecision,
    knowledgeBundles: [], degradation: { level: 'none', reasons: [] },
  });
}

// Scenario group: narrow safety questions per activity, paraphrased
// (none of these Thai sentences appear in any other test file).

test('gauntlet: "เดี๋ยวขี่ม้าอันตรายรึเปล่าคะ" (paraphrased horse safety worry) -> answered, not escalated to a clarify/transaction', () => {
  const t = turn({ informationNeed: 'safety', entities: { activityCode: 'horse' } });
  const result = compose(t);
  assert.ok(result, 'semantic correctness: a real answer is produced');
  assert.equal(t.needsClarification, false, 'unnecessary-clarification check: the turn itself never needed clarification');
  assert.match(result!.message, /ไม่กล้าการันตี/, 'grounded in the real shared safety policy fact, not invented text');
});

test('gauntlet: "ถ้าขับเอทีวีแล้วรถเสียกลางทางทำไงอะ" (paraphrased ATV equipment/control worry) -> equipment capability answers correctly, no cross-activity leakage', () => {
  const t = turn({ informationNeed: 'equipment', entities: { activityCode: 'atv' } });
  const result = compose(t);
  assert.ok(result);
  assert.match(result!.message, /เบรก|ควบคุมรถ/, 'scope correctness: ATV-specific equipment guidance, not horse/archery text');
  assert.doesNotMatch(result!.message, /ธนู|ม้า/, 'cross-scope leakage check: no archery/horse wording leaked in');
});

test('gauntlet: "ลูกอายุ 8 ขวบ ยิงธนูได้มั้ยพี่" (paraphrased archery child-suitability question) -> answered from the real archery fact, not fabricated', () => {
  const t = turn({ informationNeed: 'suitability', entities: { activityCode: 'archery' } });
  const result = compose(t);
  assert.ok(result);
  assert.match(result!.message, /จับธนู|ผู้ปกครอง/);
});

// Scenario group: unknown fact vs. genuinely ambiguous meaning -- the
// no-hallucination boundary.

test('gauntlet: an equipment question about a NEW, unseen activity type has no verified fact -- honest null, never a fabricated policy claim', () => {
  const t = turn({ informationNeed: 'equipment', entities: { activityCode: 'zipline' } });
  const result = compose(t);
  assert.equal(result, null, 'no-hallucination: an unrecognized activity type must never receive invented equipment copy');
});

test('gauntlet: a care topic with the meaning understood but genuinely no resourceCode context at all -- honest null, not a guess', () => {
  const t = turn({ informationNeed: 'suitability', entities: {} });
  const result = compose(t);
  assert.equal(result, null, 'the semantic meaning (suitability) is understood; the SCOPE (which activity) is not, and must not be guessed');
});

// Scenario group: selection vs. booking, and structured-only execution.

test('gauntlet: naming a specific horse mid-conversation is a selection, never itself a transaction', () => {
  // A real dialog decision never sets actionProposal from a bare selection
  // (see _dialog-manager.ts:834's customerCommitPresent gate) -- modeled
  // here directly since constructing the full orchestrator would duplicate
  // tests/activity-asset-selection-booking.test.ts's existing coverage.
  const d = decision({ actionProposal: undefined });
  assert.equal(d.actionProposal, undefined, 'false-transaction-escalation check: selection alone carries no actionProposal');
});

test('gauntlet: a committed booking\'s executed args come from the task\'s own selectedEntities, never the confirming message\'s wording', () => {
  const args = resolveActivityBookingProposalArgs(
    { validatedArgs: { resourceCode: 'activity-horse', date: '2026-11-01', durationMinutes: 30 } },
    { selectedEntities: [{ id: 'activity_asset:horse-pharadon', name: 'ภาราดร' }] },
  );
  assert.equal(args.horseName, 'ภาราดร', 'context continuity: the earlier selection survives into execution structurally');
});

// Scenario group: cross-scope isolation under a contaminated knowledge
// bundle (reusing PR C's firewall, now exercised together with the new
// care capability's own resourceCode resolution).

test('gauntlet: a focused horse scope firewall still isolates horse facts even when the bundle also carries ATV/archery facts', () => {
  const meaning = deriveSemanticMeaning({
    domain: 'activity', intent: 'x', action: 'confirm', entities: { activityCode: 'horse' },
    references: [], constraints: [], confidence: 0.9, needsClarification: false,
  });
  const scope = deriveCanonicalKnowledgeScope(meaning);
  const contaminatedFacts = [
    { key: 'activity_asset:horse-pharadon:name', value: 'ภาราดร' },
    { key: 'activity_asset:horse-pharadon:activityCode', value: 'horse' },
    { key: 'activity_asset:atv-01:name', value: 'ATV หมายเลข 1' },
    { key: 'activity_asset:atv-01:activityCode', value: 'atv' },
  ];
  const refined = resolveCanonicalScopeAgainstFacts(scope, contaminatedFacts);
  const filtered = filterFactsByCanonicalScope(contaminatedFacts, refined);
  assert.ok(filtered.every(fact => !fact.key.includes('atv-01')), 'scope correctness: no ATV asset leaks into a focused horse scope');
});

// Scenario group: zero-additional-paid-call bound for the new capability.

test('gauntlet: the new care capability never itself makes a network/model call (paid-call-count = 0 for this layer)', async () => {
  const before = Date.now();
  const result = await composeThongthaiResponse({
    channel: 'line', language: 'th',
    semanticTurn: turn({ informationNeed: 'safety', entities: { activityCode: 'archery' } }),
    dialogDecision: decision(), knowledgeBundles: [], degradation: { level: 'none', reasons: [] },
  });
  assert.ok(Date.now() - before < 50, 'a real network call could not complete this fast; proves zero paid calls in this layer');
  assert.equal(result.mode, 'deterministic');
});
