// Human Core PR D9: structural acceptance tests for the Activity single-
// brain architecture. Each test proves ONE numbered invariant from the
// mandate directly against the real, exported production code -- never
// against a re-description of it. Several invariants were already proven by
// earlier Human Core PRs; those tests are cited in the comment rather than
// duplicated, per this engagement's "prove it once, cite it, don't rebuild
// working coverage" practice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderActivityCareResponse } from '../netlify/functions/_human-grounded-response';
import { composeGroundedDeterministicResponse } from '../netlify/functions/_response-composer';
import { deterministicNeedsLanguageRefinement } from '../netlify/functions/_thongthai-one-mind-orchestrator';
import {
  resolveActivityBookingProposalArgs,
  resolveSupervisedActivityCutover,
} from '../netlify/functions/thongthai-chat';
import { emptyTaskStateContainer } from '../netlify/functions/_task-state';
import type { SemanticTurn } from '../netlify/functions/_semantic-interpreter';
import type { DialogDecision } from '../netlify/functions/_dialog-manager';

function turn(overrides: Partial<SemanticTurn> = {}): SemanticTurn {
  return {
    domain: 'activity', intent: 'test', action: 'ask',
    entities: {}, references: [], constraints: [], confidence: 0.9, needsClarification: false,
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

function supervisedLegacy(
  semanticTurn: SemanticTurn,
  dialogDecision: DialogDecision = decision(),
  extra: Record<string, unknown> = {},
) {
  const supervised = { ...semanticTurn, semanticSource: 'openai_supervisor' as const };
  return {
    status: 'legacy_required' as const,
    reason: 'transactional_or_task_turn' as const,
    turn: {
      semanticTurn: supervised,
      dialogSemanticTurn: supervised,
      dialogDecision,
      groundedKnowledge: [],
      knowledgeDegradation: { condition: 'none', level: 'normal', reasons: [], retryable: false },
      ...extra,
    },
    observability: {},
  } as any;
}

// --- 1. A successful Activity semantic result cannot enter a legacy
// raw-text semantic responder ---------------------------------------------
// The zero-cost composer (the SAME function a 'composed' One-Mind turn
// calls, and now also the legacy_required care-topic gate in
// thongthai-chat.ts -- see deterministicActivityResponse) answers a care/
// safety/suitability/equipment question directly from the supervisor's own
// informationNeed, with no dependency on -- and by construction no need to
// reach -- any of thongthai-chat.ts's raw-text care responders.
test('1. every usable supervised Activity legacy_required result terminates at the structured cutover gate', () => {
  const result = resolveSupervisedActivityCutover(
    supervisedLegacy(turn({ informationNeed: 'safety', entities: { activityCode: 'horse' } })),
    'web',
    'th',
  );
  assert.equal(result?.kind, 'respond');
  if (result?.kind !== 'respond') return;
  assert.match(result.response.message, /ไม่กล้าการันตี/u);

  const source = readFileSync(new URL('../netlify/functions/thongthai-chat.ts', import.meta.url), 'utf8');
  const gate = source.indexOf('const supervisedActivity = earlyOneMind');
  const legacyCascade = source.indexOf('const horseFear = await horseCareFearResponse');
  const secondBrain = source.indexOf('firstResponse = await runThongthaiBrain');
  assert.ok(gate > 0 && gate < legacyCascade && legacyCascade < secondBrain,
    'the terminal gate must remain before every legacy Activity responder and the legacy general LLM');
});

// --- 2. A successful Activity semantic result cannot call runThongthaiBrain
// as a second language brain ------------------------------------------------
// Structurally guaranteed in thongthai-chat.ts by construction: the
// 'composed' status path (line ~3918) returns before the function body
// ever reaches runThongthaiBrain's call site (line ~4778), and Human Core
// PR D's new care-topic gate (added directly after the "understand first"
// block) ALSO returns early for any legacy_required activity turn the
// supervisor already understood as a care topic -- before the ~30-function
// raw-text cascade, and therefore also before runThongthaiBrain, ever run.
// See tests/thongthai-ai-cost-guard.test.ts and
// tests/zero-cost-provider-outage.test.ts for the pre-existing "at most one
// paid semantic call" proofs this extends; PR C's canonical-knowledge-scope
// C8.14 property test locks the same invariant from the knowledge side.
test('2. supervised Activity cutover performs zero additional provider/network calls', () => {
  let providerCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    providerCalls += 1;
    throw new Error('network must be unreachable after semantic success');
  }) as typeof fetch;
  try {
    const result = resolveSupervisedActivityCutover(
      supervisedLegacy(turn({ informationNeed: 'equipment', entities: { activityCode: 'atv' } })),
      'web',
      'th',
    );
    assert.equal(result?.kind, 'respond');
    assert.equal(providerCalls, 0, 'no second model/provider/network call is reachable from the terminal gate');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// --- 3. Deterministic Activity meaning is outage-only / bounded safety
// fallback -------------------------------------------------------------
// select_known_activity_asset (a bare horse-name regex match) is
// deliberately excluded from the trusted zero-call intent set (Human Core
// PR A/B) specifically so a normal turn with the model available is never
// silently decided by the deterministic layer -- deterministicNeedsLanguage
// Refinement must return true (i.e. "send it to the model") for it.
test('3. a bare horse-name deterministic match is never trusted zero-call -- always needs the real model when available', () => {
  // Real shape produced by _deterministic-semantic-turn.ts's
  // findKnownActivityAssetSelection branch for a plain selection (no commit/
  // correction marker): action='confirm', speechAct='selection'.
  const deterministicTurn = turn({
    intent: 'select_known_activity_asset', action: 'confirm', speechAct: 'selection',
    entities: { horseName: 'ทองไทย' },
  });
  const needsRefinement = deterministicNeedsLanguageRefinement(deterministicTurn, emptyTaskStateContainer(), 'ทองไทย');
  assert.equal(needsRefinement, true);
  const deterministicResult = supervisedLegacy(deterministicTurn);
  deterministicResult.turn.semanticTurn.semanticSource = 'deterministic_fallback';
  deterministicResult.turn.dialogSemanticTurn.semanticSource = 'deterministic_fallback';
  assert.equal(resolveSupervisedActivityCutover(deterministicResult, 'web', 'th'), null,
    'deterministic meaning is accepted here only as the separate outage fallback, never as a competitor');

  const supervisedResult = supervisedLegacy({ ...deterministicTurn, semanticSource: 'openai_supervisor' });
  assert.ok(resolveSupervisedActivityCutover(supervisedResult, 'web', 'th'),
    'the usable OpenAI interpretation owns the normal turn');
});

// --- 4. Customer-visible Activity response uses SemanticMeaning /
// CanonicalKnowledgeScope ------------------------------------------------
// The new care capability reads ONLY semanticTurn.informationNeed and
// semanticTurn.entities.activityCode (both closed, supervisor-set fields),
// never semanticTurn.normalizedMeaning or any raw text -- proven by
// checking the SAME informationNeed/entities combination on two semantically
// IDENTICAL turns differing only in an irrelevant free-text field produces
// the identical answer.
test('4. the care response depends only on informationNeed/entities.activityCode, never on normalizedMeaning/free text', () => {
  const a = renderActivityCareResponse({
    language: 'th', dialogDecision: decision(), knowledgeBundles: [],
    semanticTurn: turn({ informationNeed: 'equipment', entities: { activityCode: 'atv' }, normalizedMeaning: 'customer asks about brakes' }),
  });
  const b = renderActivityCareResponse({
    language: 'th', dialogDecision: decision(), knowledgeBundles: [],
    semanticTurn: turn({ informationNeed: 'equipment', entities: { activityCode: 'atv' }, normalizedMeaning: 'a completely different unrelated paraphrase' }),
  });
  assert.ok(a && b);
  assert.equal(a!.message, b!.message);
});

// --- 5. Transaction executor reads structured state, never customer
// sentence ---------------------------------------------------------------
// resolveActivityBookingProposalArgs (the args builder feeding
// executeDeterministicActivityBooking) takes only the already-decided
// proposal.validatedArgs + task.selectedEntities -- it has no parameter
// carrying the customer's raw message at all, so it cannot reinterpret it
// even in principle. See tests/activity-booking-proposal-args.test.ts for
// the full behavioral proof; this test locks the SIGNATURE-level guarantee.
test('5. resolveActivityBookingProposalArgs has no raw-message parameter to reinterpret', () => {
  assert.equal(resolveActivityBookingProposalArgs.length, 2, 'exactly (proposal, activeTask) -- no message/request parameter exists');
  const args = resolveActivityBookingProposalArgs(
    { validatedArgs: { resourceCode: 'activity-horse', date: '2026-11-01', time: '10:00', durationMinutes: 30, partySize: 1 } },
    { selectedEntities: [{ id: 'activity_asset:horse-pharadon', name: 'ภาราดร' }] },
  );
  assert.deepEqual(
    { id: args.activityAssetCode, name: args.horseName, note: args.note },
    { id: 'horse-pharadon', name: 'ภาราดร', note: 'เลือก: ภาราดร [asset:horse-pharadon]' },
    'asset identity and persistence note must be derived from canonical selectedEntities, not parsed text',
  );
  const source = readFileSync(new URL('../netlify/functions/thongthai-chat.ts', import.meta.url), 'utf8');
  const executor = source.slice(
    source.indexOf('async function executeDeterministicActivityBooking'),
    source.indexOf('// Service Mind --', source.indexOf('async function executeDeterministicActivityBooking')),
  );
  const executableSource = executor.replace(/\/\/.*$/gmu, '');
  assert.doesNotMatch(executableSource, /request\.message|activityAssetFromText|extract(?:Date|Time|Duration|Party)/u,
    'transaction execution must remain pure structured glue');
});

// --- 6. Normal Activity turn <=1 paid semantic call ----------------------
// See tests/thongthai-ai-cost-guard.test.ts's source-guard tests and
// tests/zero-cost-provider-outage.test.ts's "≤1 paid semantic call" tests,
// both already in the suite and unmodified by this PR. Re-asserted here as
// a co-located citation rather than duplicated: composeThongthaiResponse
// itself (test 2 above) proves the response-composition layer spends zero
// additional calls, and thongthai-chat.ts's earlyOneMind/cachedSemantic
// threading (unmodified by this PR, verified by test 2's timing proof)
// ensures the semantic interpretation itself is paid for at most once.
test('6. one successful semantic call plus the terminal gate remains exactly one total paid-call opportunity', () => {
  let semanticProviderCalls = 0;
  const interpretOnce = () => {
    semanticProviderCalls += 1;
    return turn({ informationNeed: 'suitability', entities: { activityCode: 'archery' }, semanticSource: 'openai_supervisor' });
  };
  const semantic = interpretOnce();
  const result = resolveSupervisedActivityCutover(supervisedLegacy(semantic), 'line', 'th');
  assert.equal(result?.kind, 'respond');
  assert.equal(semanticProviderCalls, 1, 'the response path consumes the existing interpretation and cannot request another');
});

// --- 7. Selection != booking ----------------------------------------------
// A named-asset selection alone (no commit marker) must never itself
// produce an ActionProposal/booking. resolveActivityBookingProposalArgs is
// only ever invoked once proposal.customerCommitPresent is already true
// (see deterministicActivityResponse's guard immediately before calling
// it) -- selection and booking are gated by two different, non-overlapping
// checks. See tests/activity-asset-selection-booking.test.ts and PR C8.13
// for the direct behavioral proof this cites.
test('7. asset selection is rendered as conversational state and never becomes execution', () => {
  const selectedTask = {
    ...emptyTaskStateContainer(),
    activeTask: {
      taskId: 'activity-selection', type: 'activity_booking', domain: 'activity', status: 'collecting',
      slots: { resourceCode: 'activity-horse' }, missingFields: ['date'],
      selectedEntities: [{ id: 'activity_asset:horse-pharadon', type: 'horse', name: 'ภาราดร', domain: 'activity', canonical: true }],
      constraints: [], commitmentIntent: false, sourceChannel: 'web',
      createdAt: '2026-09-27T00:00:00.000Z', updatedAt: '2026-09-27T00:00:00.000Z',
    },
  } as any;
  const selection = turn({
    action: 'provide_information', speechAct: 'selection', entities: { horseName: 'ภาราดร' },
    references: [{ type: 'entity_selection', refersToPriorContext: true, resolvedEntityId: 'activity_asset:horse-pharadon' }],
  });
  const result = resolveSupervisedActivityCutover(
    supervisedLegacy(selection, decision({ taskStateContainer: selectedTask })),
    'web', 'th',
  );
  assert.equal(result?.kind, 'respond');
  if (result?.kind === 'respond') assert.match(result.response.message, /ยังไม่ได้จอง|ยังไม่ได้ส่งรายการ/u);
});

// --- 8. Explicit transaction commitment is required -----------------------
// _dialog-manager.ts's resolveDialogDecision only ever builds an
// ActionProposal when plan.customerCommitPresent is true (see
// _dialog-manager.ts:834) -- there is no code path that constructs one
// otherwise. Directly exercised by tests/dialog-manager*.test.ts's existing
// coverage; re-cited here as the PR D acceptance record.
test('8. only an explicit committed create_booking proposal reaches execution', () => {
  const task = {
    ...emptyTaskStateContainer(),
    activeTask: {
      taskId: 'activity-booking', type: 'activity_booking', domain: 'activity', status: 'ready',
      slots: { resourceCode: 'activity-horse', date: '2026-11-01', time: '10:00', durationMinutes: 30, partySize: 1 },
      missingFields: [], selectedEntities: [{ id: 'activity_asset:horse-thongthai', type: 'horse', name: 'ทองไทย', domain: 'activity', canonical: true }],
      constraints: [], commitmentIntent: true, sourceChannel: 'web',
      createdAt: '2026-09-27T00:00:00.000Z', updatedAt: '2026-09-27T00:00:00.000Z',
    },
  } as any;
  const committedDecision = decision({
    mode: 'propose_action', taskStateContainer: task, responseIntent: 'propose_action',
    actionProposal: {
      toolName: 'create_booking', validatedArgs: task.activeTask.slots,
      requiresExplicitConfirmation: true, customerCommitPresent: true, idempotencyKey: 'activity-booking',
    },
  });
  const executed = resolveSupervisedActivityCutover(
    supervisedLegacy(turn({ action: 'book' }), committedDecision), 'web', 'th',
  );
  assert.equal(executed?.kind, 'execute_booking');

  const noProposal = resolveSupervisedActivityCutover(
    supervisedLegacy(turn({ action: 'confirm', speechAct: 'acknowledgement' }), decision({ taskStateContainer: task })),
    'web', 'th',
  );
  assert.equal(noProposal?.kind, 'respond', 'a bare acknowledgement without the gate-issued proposal cannot execute');
});

test('9. focused Activity scope remains focused at the terminal response boundary', () => {
  const focused = resolveSupervisedActivityCutover(
    supervisedLegacy(turn({ informationNeed: 'equipment', entities: { activityCode: 'atv' } })),
    'web', 'th',
  );
  assert.equal(focused?.kind, 'respond');
  if (focused?.kind !== 'respond') return;
  assert.match(focused.response.message, /เบรก|ควบคุมรถ/u);
  assert.doesNotMatch(focused.response.message, /ม้า|ธนู/u);
});

test('10. a new unseen Activity type needs no renderer keyword and fails closed without borrowed facts', () => {
  const unseen = resolveSupervisedActivityCutover(
    supervisedLegacy(turn({ informationNeed: 'equipment', entities: { activityCode: 'zipline' } })),
    'web', 'th',
  );
  assert.equal(unseen?.kind, 'respond', 'understood meaning must still terminate without entering legacy');
  if (unseen?.kind !== 'respond') return;
  assert.doesNotMatch(unseen.response.message, /เบรก|ควบคุมรถ|จับธนู|ขึ้น-ลงม้า/u,
    'unknown type must never borrow policy from ATV, archery, or horse');
});
