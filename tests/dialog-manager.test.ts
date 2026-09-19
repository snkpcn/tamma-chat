// Phase F core tests: Dialog Manager plan/resolve mechanics, SemanticTurn
// -> ActiveTask merge, ambiguity gating, topic switch/resume, knowledge-need
// planning, READY != EXECUTE, action proposals, and idempotence.
// Network-free -- all knowledge is injected mock adapters.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planDialogTurn, processDialogTurn, resolveDialogDecision,
  type DialogInput,
} from '../netlify/functions/_dialog-manager';
import { emptyConversationContextState, type ConversationContextState } from '../netlify/functions/_conversation-context';
import { emptyTaskStateContainer, type TaskStateContainer } from '../netlify/functions/_task-state';
import type { SemanticTurn } from '../netlify/functions/_semantic-interpreter';
import type { KnowledgeSourceAdapters, SourceResult } from '../netlify/functions/_knowledge-resolver';

const NOW = new Date('2026-09-18T10:00:00.000Z');

function turn(overrides: Partial<SemanticTurn>): SemanticTurn {
  return { domain: 'activity', intent: 'test', action: 'ask', entities: {}, references: [], constraints: [], confidence: 0.85, needsClarification: false, ...overrides };
}
function input(overrides: Partial<DialogInput> = {}): DialogInput {
  return {
    semanticTurn: turn({}), conversationContext: emptyConversationContextState(NOW), taskState: emptyTaskStateContainer(),
    channel: 'web', eventId: 'evt-1', ...overrides,
  };
}
function okResult(sourceId: string, data: SourceResult extends { data: infer D } ? D : never): SourceResult {
  return { status: 'ok', data, sourceId, sourceType: 'activity_live', fetchedAt: NOW.toISOString() };
}

// [discovery must not create fake tasks]
test('pure discovery/ask with no existing task never creates one', () => {
  const plan = planDialogTurn(input({ semanticTurn: turn({ domain: 'activity', action: 'discover' }) }));
  assert.equal(plan.taskStateContainer.activeTask, null);
  assert.ok(plan.reasons.includes('discovery_only'));
});

test('compare action alone never creates a task', () => {
  const plan = planDialogTurn(input({ semanticTurn: turn({ domain: 'activity', action: 'compare' }) }));
  assert.equal(plan.taskStateContainer.activeTask, null);
});

// [SemanticTurn -> ActiveTask merge]
test('confirm (entity selection) on an actionable domain creates a task with the turn entities as initial slots', () => {
  const plan = planDialogTurn(input({ semanticTurn: turn({ domain: 'activity', action: 'confirm', entities: { resourceCode: 'activity-horse', horseName: 'ภาราดร' } }) }));
  assert.equal(plan.taskStateContainer.activeTask?.type, 'activity_booking');
  assert.equal(plan.taskStateContainer.activeTask?.slots.horseName, 'ภาราดร');
});

test('a later provide_information turn merges into the SAME task, not a new one', () => {
  let plan = planDialogTurn(input({ semanticTurn: turn({ domain: 'activity', action: 'confirm', entities: { resourceCode: 'activity-horse', horseName: 'ภาราดร' } }), eventId: 'evt-1' }));
  const taskId = plan.taskStateContainer.activeTask!.taskId;
  plan = planDialogTurn(input({ semanticTurn: turn({ domain: 'activity', action: 'provide_information', entities: { date: 'พรุ่งนี้', partySize: 2 } }), taskState: plan.taskStateContainer, eventId: 'evt-2' }));
  assert.equal(plan.taskStateContainer.activeTask!.taskId, taskId);
  assert.equal(plan.taskStateContainer.activeTask!.slots.date, 'พรุ่งนี้');
  assert.equal(plan.taskStateContainer.activeTask!.slots.horseName, 'ภาราดร', 'earlier slots must survive');
});

test('correction "จริง ๆ สามคน" overwrites partySize on the same task', () => {
  let plan = planDialogTurn(input({ semanticTurn: turn({ domain: 'activity', action: 'confirm', entities: { resourceCode: 'activity-horse', partySize: 2 } }), eventId: 'evt-1' }));
  const taskId = plan.taskStateContainer.activeTask!.taskId;
  plan = planDialogTurn(input({ semanticTurn: turn({ domain: 'activity', action: 'correct_previous', entities: { partySize: 3 } }), taskState: plan.taskStateContainer, eventId: 'evt-2' }));
  assert.equal(plan.taskStateContainer.activeTask!.taskId, taskId);
  assert.equal(plan.taskStateContainer.activeTask!.slots.partySize, 3);
});

test('correction "ไม่ใช่ เอาทองไทย" replaces the horse slot, same task', () => {
  let plan = planDialogTurn(input({ semanticTurn: turn({ domain: 'activity', action: 'confirm', entities: { resourceCode: 'activity-horse', horseName: 'ภาราดร' } }), eventId: 'evt-1' }));
  const taskId = plan.taskStateContainer.activeTask!.taskId;
  plan = planDialogTurn(input({ semanticTurn: turn({ domain: 'activity', action: 'correct_previous', entities: { horseName: 'ทองไทย' } }), taskState: plan.taskStateContainer, eventId: 'evt-2' }));
  assert.equal(plan.taskStateContainer.activeTask!.taskId, taskId);
  assert.equal(plan.taskStateContainer.activeTask!.slots.horseName, 'ทองไทย');
});

// [ambiguity]
test('needsClarification=true always produces mode=clarify and touches nothing else', () => {
  const plan = planDialogTurn(input({ semanticTurn: turn({ domain: 'activity', action: 'confirm', needsClarification: true }) }));
  assert.equal(plan.mode, 'clarify');
  assert.equal(plan.taskStateContainer.activeTask, null);
});

test('an ambiguous resolved reference also produces mode=clarify, never a guess', () => {
  const plan = planDialogTurn(input({ semanticTurn: turn({ domain: 'activity', action: 'confirm', references: [{ type: 'entity_selection', refersToPriorContext: true, ambiguous: true }] }) }));
  assert.equal(plan.mode, 'clarify');
  const decision = resolveDialogDecision(plan, []);
  assert.equal(decision.responseIntent, 'clarify_ambiguous_entity');
});

// [topic switch / resume]
test('a domain switch while a task is active suspends it (never destroys it)', () => {
  let plan = planDialogTurn(input({ semanticTurn: turn({ domain: 'activity', action: 'confirm', entities: { resourceCode: 'activity-horse', horseName: 'ภาราดร' } }), eventId: 'evt-1' }));
  const taskId = plan.taskStateContainer.activeTask!.taskId;
  plan = planDialogTurn(input({ semanticTurn: turn({ domain: 'restaurant', action: 'discover' }), taskState: plan.taskStateContainer, eventId: 'evt-2' }));
  assert.equal(plan.taskStateContainer.activeTask, null);
  assert.equal(plan.taskStateContainer.suspendedTask?.taskId, taskId);
  assert.ok(plan.reasons.includes('task_suspended_for_topic_switch'));
});

test('returning to the suspended domain resumes the SAME task, never creating a new one', () => {
  let plan = planDialogTurn(input({ semanticTurn: turn({ domain: 'activity', action: 'confirm', entities: { resourceCode: 'activity-horse', horseName: 'ภาราดร' } }), eventId: 'evt-1' }));
  const taskId = plan.taskStateContainer.activeTask!.taskId;
  plan = planDialogTurn(input({ semanticTurn: turn({ domain: 'restaurant', action: 'discover' }), taskState: plan.taskStateContainer, eventId: 'evt-2' }));
  plan = planDialogTurn(input({ semanticTurn: turn({ domain: 'activity', action: 'ask' }), taskState: plan.taskStateContainer, eventId: 'evt-3' }));
  assert.equal(plan.taskStateContainer.activeTask?.taskId, taskId);
  assert.equal(plan.taskStateContainer.activeTask?.slots.horseName, 'ภาราดร');
  assert.ok(plan.reasons.includes('task_resumed'));
});

// [knowledge-need planning / no overfetch]
test('restaurant discovery plans exactly a restaurant catalog request, nothing else', () => {
  const plan = planDialogTurn(input({ semanticTurn: turn({ domain: 'restaurant', action: 'discover' }) }));
  assert.equal(plan.knowledgeRequests.length, 1);
  assert.equal(plan.knowledgeRequests[0]!.domain, 'restaurant');
  assert.deepEqual(plan.knowledgeRequests[0]!.needs, ['catalog', 'recommendations_input']);
});

test('recommendation follow-ups in non-restaurant catalog domains still query authoritative catalog data', () => {
  for (const domain of ['stay', 'otop', 'cafe'] as const) {
    const plan = planDialogTurn(input({ semanticTurn: turn({ domain, action: 'recommend' }) }));
    assert.equal(plan.knowledgeRequests.length, 1, `${domain} should query knowledge`);
    assert.equal(plan.knowledgeRequests[0]!.domain, domain);
    assert.ok(plan.knowledgeRequests[0]!.needs.includes('catalog'));
  }
});

test('a complete activity task with a provide_information turn plans an availability request', () => {
  let plan = planDialogTurn(input({ semanticTurn: turn({ domain: 'activity', action: 'confirm', entities: { resourceCode: 'activity-horse', date: '2026-09-19', durationMinutes: 60 } }), eventId: 'evt-1' }));
  plan = planDialogTurn(input({ semanticTurn: turn({ domain: 'activity', action: 'provide_information', entities: {} }), taskState: plan.taskStateContainer, eventId: 'evt-2' }));
  assert.equal(plan.missingFields.length, 0);
  assert.equal(plan.knowledgeRequests.some(r => r.needs.includes('availability')), true);
  assert.equal(plan.mode, 'query_knowledge');
});

// [READY != EXECUTE]
test('all fields present but no explicit commit (action=confirm/provide_information) never proposes an action', async () => {
  let plan = planDialogTurn(input({ semanticTurn: turn({ domain: 'activity', action: 'confirm', entities: { resourceCode: 'activity-horse', date: '2026-09-19', durationMinutes: 60 } }), eventId: 'evt-1' }));
  const decision = resolveDialogDecision(plan, []);
  assert.notEqual(decision.mode, 'propose_action');
  assert.equal(decision.actionProposal, undefined);
});

test('an explicit "book" action with all fields present and verified availability DOES propose an action', () => {
  let plan = planDialogTurn(input({ semanticTurn: turn({ domain: 'activity', action: 'confirm', entities: { resourceCode: 'activity-horse', date: '2026-09-19', durationMinutes: 60 } }), eventId: 'evt-1' }));
  plan = planDialogTurn(input({ semanticTurn: turn({ domain: 'activity', action: 'book', entities: {} }), taskState: plan.taskStateContainer, eventId: 'evt-2' }));
  assert.equal(plan.customerCommitPresent, true);
  const bundle = { domain: 'activity' as const, sources: [{ need: 'availability' as const, sourceId: 's', sourceType: 'activity_live' as const, status: 'ok' as const }], facts: [{ key: 'activity:activity-horse:2026-09-19:available', value: true, domain: 'activity' as const, sourceId: 's', sourceType: 'activity_live' as const, authoritative: true, fetchedAt: NOW.toISOString() }], entities: [], missing: [], warnings: [], freshness: 'live' as const };
  const decision = resolveDialogDecision(plan, [bundle]);
  assert.equal(decision.mode, 'propose_action');
  assert.equal(decision.actionProposal?.toolName, 'create_booking');
  assert.equal(decision.actionProposal?.customerCommitPresent, true);
});

test('an explicit "book" action WITHOUT verified availability does not propose an action', () => {
  let plan = planDialogTurn(input({ semanticTurn: turn({ domain: 'activity', action: 'confirm', entities: { resourceCode: 'activity-horse', date: '2026-09-19', durationMinutes: 60 } }), eventId: 'evt-1' }));
  plan = planDialogTurn(input({ semanticTurn: turn({ domain: 'activity', action: 'book', entities: {} }), taskState: plan.taskStateContainer, eventId: 'evt-2' }));
  const decision = resolveDialogDecision(plan, []); // no bundle proving availability
  assert.notEqual(decision.mode, 'propose_action');
});

// [ANTI-HALLUCINATION]
test('a compare turn with no verified fact for the named attribute reports cannot_verify_comparison, never a guess', () => {
  const plan = planDialogTurn(input({
    semanticTurn: turn({
      domain: 'activity', action: 'compare', entities: { compareAttribute: 'temperament' },
      references: [{ type: 'entity_selection', refersToPriorContext: true, resolvedEntityIds: ['conv:horse:paradon', 'conv:horse:thongthai'] }],
    }),
  }));
  const bundle = { domain: 'activity' as const, sources: [], facts: [{ key: 'activity_asset:horse:paradon:name', value: 'ภาราดร', domain: 'activity' as const, sourceId: 's', sourceType: 'activity_live' as const, authoritative: true, fetchedAt: NOW.toISOString() }], entities: [], missing: [], warnings: [], freshness: 'live' as const };
  const decision = resolveDialogDecision(plan, [bundle]);
  assert.equal(decision.responseIntent, 'cannot_verify_comparison');
  assert.ok(decision.reasons.includes('cannot_verify_comparison'));
});

test('a compare turn WITH a verified fact for every candidate does not block on cannot_verify_comparison', () => {
  const plan = planDialogTurn(input({
    semanticTurn: turn({
      domain: 'activity', action: 'compare', entities: { compareAttribute: 'temperament' },
      references: [{ type: 'entity_selection', refersToPriorContext: true, resolvedEntityIds: ['conv:horse:paradon'] }],
    }),
  }));
  const bundle = { domain: 'activity' as const, sources: [], facts: [{ key: 'temperament:horse:paradon', value: 'calm', domain: 'activity' as const, sourceId: 's', sourceType: 'activity_live' as const, authoritative: true, fetchedAt: NOW.toISOString() }], entities: [], missing: [], warnings: [], freshness: 'live' as const };
  const decision = resolveDialogDecision(plan, [bundle]);
  assert.notEqual(decision.responseIntent, 'cannot_verify_comparison');
});

// [known_unconfigured_price]
test('a null (unconfigured) price fact is flagged known_unconfigured_price, never invented as a number', () => {
  const plan = planDialogTurn(input({ semanticTurn: turn({ domain: 'activity', action: 'ask' }) }));
  const bundle = { domain: 'activity' as const, sources: [], facts: [{ key: 'activity:horse:90min:price', value: null, domain: 'activity' as const, sourceId: 's', sourceType: 'activity_live' as const, authoritative: true, fetchedAt: NOW.toISOString() }], entities: [], missing: [], warnings: [], freshness: 'live' as const };
  const decision = resolveDialogDecision(plan, [bundle]);
  assert.ok(decision.reasons.includes('known_unconfigured_price'));
});

// [EMPTY vs UNAVAILABLE propagation]
test('an empty promotion source is a valid "no active promotion" answer, not a source failure', () => {
  const plan = planDialogTurn(input({ semanticTurn: turn({ domain: 'promotion', action: 'discover' }) }));
  const bundle = { domain: 'promotion' as const, sources: [{ need: 'promotion_eligibility' as const, sourceId: 's', sourceType: 'promotion_runtime' as const, status: 'empty' as const }], facts: [], entities: [], missing: [], warnings: [], freshness: 'live' as const };
  const decision = resolveDialogDecision(plan, [bundle]);
  assert.equal(decision.responseIntent, 'no_active_promotion');
  assert.ok(!decision.reasons.includes('knowledge_unavailable'));
});

test('an unavailable source is reported as a real failure, distinct from an empty result', () => {
  const plan = planDialogTurn(input({ semanticTurn: turn({ domain: 'promotion', action: 'discover' }) }));
  const bundle = { domain: 'promotion' as const, sources: [{ need: 'promotion_eligibility' as const, sourceId: 's', sourceType: 'promotion_runtime' as const, status: 'unavailable' as const, reason: 'source_unavailable' as const }], facts: [], entities: [], missing: ['promotion_eligibility' as const], warnings: ['source_unavailable:promotion_eligibility:timeout'], freshness: 'live' as const };
  const decision = resolveDialogDecision(plan, [bundle]);
  assert.equal(decision.responseIntent, 'source_unavailable_apology');
  assert.ok(decision.reasons.includes('knowledge_unavailable'));
  assert.notEqual(decision.responseIntent, 'no_active_promotion');
});

// [idempotence]
test('replaying the exact same eventId produces the identical resulting taskStateContainer (no duplicated merge)', () => {
  const firstInput = input({ semanticTurn: turn({ domain: 'activity', action: 'confirm', entities: { resourceCode: 'activity-horse', horseName: 'ภาราดร' } }), eventId: 'evt-dup' });
  const firstPlan = planDialogTurn(firstInput);
  const secondPlan = planDialogTurn({ ...firstInput, taskState: firstPlan.taskStateContainer });
  assert.deepEqual(secondPlan.taskStateContainer, firstPlan.taskStateContainer);
});

test('processDialogTurn end-to-end: replaying the same turn twice never duplicates an ActionProposal', async () => {
  let taskState = emptyTaskStateContainer();
  const adapters: KnowledgeSourceAdapters = {};
  let plan = planDialogTurn(input({ semanticTurn: turn({ domain: 'activity', action: 'confirm', entities: { resourceCode: 'activity-horse', date: '2026-09-19', durationMinutes: 60 } }), eventId: 'evt-1', taskState }));
  taskState = plan.taskStateContainer;
  const bookInput: DialogInput = input({ semanticTurn: turn({ domain: 'activity', action: 'book', entities: {} }), eventId: 'evt-2', taskState });
  const adaptersWithAvailability: KnowledgeSourceAdapters = {
    activity: { availability: async () => okResult('schedule', [{ key: 'activity:activity-horse:2026-09-19:available', value: true, domain: 'activity', sourceId: 'schedule', sourceType: 'activity_live', authoritative: true, fetchedAt: NOW.toISOString() }]) },
  };
  const firstDecision = await processDialogTurn(bookInput, adaptersWithAvailability, NOW);
  const secondDecision = await processDialogTurn({ ...bookInput, taskState: firstDecision.taskStateContainer }, adaptersWithAvailability, NOW);
  assert.equal(firstDecision.mode, 'propose_action');
  assert.deepEqual(secondDecision.taskStateContainer, firstDecision.taskStateContainer);
  void adapters;
});
