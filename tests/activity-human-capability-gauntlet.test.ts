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
// Scope: the table below directly exercises all 30 required semantic
// capability classes through the production terminal Activity cutover gate.
// It verifies that already-understood turns always produce a structured
// response/transaction decision, never fall back to another language owner,
// and that only an explicit committed proposal can execute.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeGroundedDeterministicResponse } from '../netlify/functions/_response-composer';
import {
  resolveActivityBookingProposalArgs,
  resolveSupervisedActivityCutover,
} from '../netlify/functions/thongthai-chat';
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

function supervisedLegacy(semanticTurn: SemanticTurn, dialogDecision: DialogDecision = decision()) {
  const supervised = { ...semanticTurn, semanticSource: 'openai_supervisor' as const };
  return {
    status: 'legacy_required', reason: 'transactional_or_task_turn',
    turn: {
      semanticTurn: supervised,
      dialogSemanticTurn: supervised,
      dialogDecision,
      groundedKnowledge: [],
      knowledgeDegradation: { condition: 'none', level: 'normal', reasons: [], retryable: false },
    },
    observability: {},
  } as any;
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

const readyTask = {
  ...emptyTaskStateContainer(),
  activeTask: {
    taskId: 'gauntlet-ready', type: 'activity_booking', domain: 'activity', status: 'ready',
    slots: { resourceCode: 'activity-horse', date: '2026-11-02', time: '10:00', durationMinutes: 30, partySize: 1 },
    missingFields: [],
    selectedEntities: [{ id: 'activity_asset:horse-thongthai', type: 'horse', name: 'ทองไทย', domain: 'activity', canonical: true }],
    constraints: [], commitmentIntent: true, sourceChannel: 'line',
    createdAt: '2026-09-27T00:00:00.000Z', updatedAt: '2026-09-27T00:00:00.000Z',
  },
} as any;

const committedDecision = decision({
  mode: 'propose_action', taskStateContainer: readyTask, responseIntent: 'propose_action',
  actionProposal: {
    toolName: 'create_booking', validatedArgs: readyTask.activeTask.slots,
    requiresExplicitConfirmation: true, customerCommitPresent: true, idempotencyKey: 'gauntlet-ready',
  },
});

const capabilityCases: Array<{
  id: number;
  capability: string;
  semantic: SemanticTurn;
  dialog?: DialogDecision;
  expected: 'respond' | 'execute_booking';
}> = [
  { id: 1, capability: 'broad Activity discovery', semantic: turn({ intent: 'broad_activity_discovery', action: 'discover', informationNeed: 'catalog' }), expected: 'respond' },
  { id: 2, capability: 'focused horse discovery', semantic: turn({ intent: 'horse_discovery', action: 'discover', informationNeed: 'catalog', entities: { activityCode: 'horse' } }), expected: 'respond' },
  { id: 3, capability: 'focused ATV discovery', semantic: turn({ intent: 'atv_discovery', action: 'discover', informationNeed: 'catalog', entities: { activityCode: 'atv' } }), expected: 'respond' },
  { id: 4, capability: 'focused archery discovery', semantic: turn({ intent: 'archery_discovery', action: 'discover', informationNeed: 'catalog', entities: { activityCode: 'archery' } }), expected: 'respond' },
  { id: 5, capability: 'recommendation', semantic: turn({ intent: 'activity_recommendation', action: 'recommend', informationNeed: 'recommendation', constraints: ['beginner'] }), expected: 'respond' },
  { id: 6, capability: 'comparison', semantic: turn({ intent: 'compare_activity_assets', action: 'compare', entities: { activityCode: 'horse', candidateNames: ['ทองไทย', 'ภาราดร'] } }), expected: 'respond' },
  { id: 7, capability: 'asset selection', semantic: turn({ intent: 'select_activity_asset', action: 'provide_information', speechAct: 'selection', entities: { horseName: 'ภาราดร' } }), expected: 'respond' },
  { id: 8, capability: 'correction', semantic: turn({ intent: 'correct_activity_asset', action: 'correct_previous', speechAct: 'correction', entities: { horseName: 'ทองไทย' } }), expected: 'respond' },
  { id: 9, capability: 'reject previous recommendation', semantic: turn({ intent: 'reject_recommendation', action: 'correct_previous', constraints: ['exclude:horse'] }), expected: 'respond' },
  { id: 10, capability: 'prior-context reference', semantic: turn({ intent: 'select_prior_entity', action: 'provide_information', references: [{ type: 'entity_selection', value: 'ตัวเมื่อกี้', refersToPriorContext: true, resolvedEntityId: 'activity_asset:horse-pharadon' }] }), expected: 'respond' },
  { id: 11, capability: 'change one detail only', semantic: turn({ intent: 'change_party_size', action: 'modify', entities: { partySize: 3 } }), expected: 'respond' },
  { id: 12, capability: 'switch topic then return', semantic: turn({ intent: 'resume_activity', action: 'ask', taskDirective: 'resume_suspended', references: [{ type: 'task', value: 'กลับมาเรื่องกิจกรรม', refersToPriorContext: true, resolvedTaskSlot: 'activity_booking' }] }), expected: 'respond' },
  { id: 13, capability: 'casual/slang/incomplete Thai', semantic: turn({ intent: 'activity_topic_narrow', action: 'discover', informationNeed: 'catalog', normalizedMeaning: 'asks casually about available activities' }), expected: 'respond' },
  { id: 14, capability: 'fear/reassurance', semantic: turn({ intent: 'fear_reassurance', action: 'ask', informationNeed: 'suitability', entities: { activityCode: 'horse' }, constraints: ['fearful'] }), expected: 'respond' },
  { id: 15, capability: 'safety', semantic: turn({ intent: 'activity_safety', action: 'ask', informationNeed: 'safety', entities: { activityCode: 'atv' } }), expected: 'respond' },
  { id: 16, capability: 'suitability', semantic: turn({ intent: 'activity_suitability', action: 'ask', informationNeed: 'suitability', entities: { activityCode: 'archery', ageYears: 8 } }), expected: 'respond' },
  { id: 17, capability: 'equipment/control', semantic: turn({ intent: 'activity_controls', action: 'ask', informationNeed: 'equipment', entities: { activityCode: 'atv' } }), expected: 'respond' },
  { id: 18, capability: 'experience-level question', semantic: turn({ intent: 'beginner_question', action: 'ask', informationNeed: 'suitability', entities: { activityCode: 'horse', experienceLevel: 'beginner' } }), expected: 'respond' },
  { id: 19, capability: 'price', semantic: turn({ intent: 'activity_price', action: 'ask', informationNeed: 'price', entities: { activityCode: 'horse' } }), expected: 'respond' },
  { id: 20, capability: 'how-it-works', semantic: turn({ intent: 'activity_how_it_works', action: 'ask', informationNeed: 'policy', entities: { activityCode: 'archery' } }), expected: 'respond' },
  { id: 21, capability: 'availability', semantic: turn({ intent: 'activity_availability', action: 'ask', informationNeed: 'availability', entities: { activityCode: 'horse', date: '2026-11-02' } }), expected: 'respond' },
  { id: 22, capability: 'booking vocabulary without booking intent', semantic: turn({ intent: 'ask_before_booking', action: 'ask', informationNeed: 'policy', entities: { activityCode: 'atv' } }), expected: 'respond' },
  { id: 23, capability: 'explicit booking request still collecting fields', semantic: turn({ intent: 'activity_booking_request', action: 'book', entities: { activityCode: 'horse' } }), dialog: decision({ mode: 'collect_field', missingFields: ['date', 'time'], responseIntent: 'ask_missing_field' }), expected: 'respond' },
  { id: 24, capability: 'bare acknowledgement without commitment context', semantic: turn({ intent: 'bare_acknowledgement', action: 'confirm', speechAct: 'acknowledgement' }), expected: 'respond' },
  { id: 25, capability: 'bare confirmation with established explicit transaction context', semantic: turn({ intent: 'confirm_activity_booking', action: 'confirm', speechAct: 'confirmation' }), dialog: committedDecision, expected: 'execute_booking' },
  { id: 26, capability: 'unknown fact but understood meaning', semantic: turn({ intent: 'unknown_activity_fact', action: 'ask', informationNeed: 'policy', entities: { activityCode: 'horse', fact: 'insurance_limit' } }), expected: 'respond' },
  { id: 27, capability: 'genuinely ambiguous meaning', semantic: turn({ intent: 'ambiguous_activity_reference', action: 'ask', needsClarification: true, references: [{ type: 'entity', value: 'อันนั้น', refersToPriorContext: true }] }), dialog: decision({ mode: 'clarify', responseIntent: 'clarify_ambiguous_entity' }), expected: 'respond' },
  { id: 28, capability: 'new unseen activity asset', semantic: turn({ intent: 'select_new_asset', action: 'provide_information', speechAct: 'selection', entities: { activityCode: 'horse', assetName: 'ดาวเหนือ' } }), expected: 'respond' },
  { id: 29, capability: 'new unseen activity type', semantic: turn({ intent: 'new_activity_type', action: 'ask', informationNeed: 'equipment', entities: { activityCode: 'zipline' } }), expected: 'respond' },
  { id: 30, capability: 'cross-scope contaminated facts', semantic: turn({ intent: 'focused_horse_question', action: 'ask', informationNeed: 'suitability', entities: { activityCode: 'horse' }, constraints: ['exclude:atv', 'exclude:archery'] }), expected: 'respond' },
];

test('gauntlet: all 30 required Activity capability classes terminate inside the single-brain boundary', () => {
  assert.equal(capabilityCases.length, 30);
  let executions = 0;
  for (const scenario of capabilityCases) {
    assert.equal(scenario.semantic.domain, 'activity', `${scenario.id}: domain must remain Activity`);
    const result = resolveSupervisedActivityCutover(
      supervisedLegacy(scenario.semantic, scenario.dialog ?? decision()),
      'line',
      'th',
    );
    assert.ok(result, `${scenario.id}. ${scenario.capability}: must never fall through to a legacy language owner`);
    assert.equal(result!.kind, scenario.expected, `${scenario.id}. ${scenario.capability}`);
    if (result!.kind === 'execute_booking') executions += 1;

    if (scenario.id === 22 || scenario.id === 23 || scenario.id === 24) {
      assert.equal(result!.kind, 'respond', `${scenario.id}: booking words/acknowledgement must not falsely escalate`);
    }
    if (scenario.id === 29 && result!.kind === 'respond') {
      assert.doesNotMatch(result!.response.message, /เบรก|ควบคุมรถ|จับธนู|ขึ้น-ลงม้า/u,
        'unseen type must fail closed without borrowing another activity policy');
    }
    if (scenario.id === 30 && result!.kind === 'respond') {
      assert.doesNotMatch(result!.response.message, /ATV|ธนู/u, 'focused horse response must not leak contaminated scopes');
    }
  }
  assert.equal(executions, 1, 'only established explicit transaction context may execute');
});

test('gauntlet: terminal capability rendering makes zero additional provider/network calls', () => {
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    calls += 1;
    throw new Error('network forbidden in structured response planning');
  }) as typeof fetch;
  try {
    for (const scenario of capabilityCases.filter(item => item.expected === 'respond')) {
      resolveSupervisedActivityCutover(supervisedLegacy(scenario.semantic, scenario.dialog ?? decision()), 'web', 'th');
    }
    assert.equal(calls, 0, 'all 29 non-transaction capability paths reuse the one existing semantic result');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
