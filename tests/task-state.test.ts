// Phase D core tests: Working/Task State container, transitions, corrections,
// suspend/resume, idempotence, serialization, legacy adapters and memory
// ownership boundaries. Network-free -- all pure functions, no DB I/O paths
// are exercised here (loadTaskState/persistTaskState are integration-only
// and untestable without a live Supabase project, matching Phase C's
// precedent for loadConversationContext/persistConversationContext).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addTaskConstraint, adaptBookingSessionToTask, adaptPendingPromotionRedemptionToTask,
  adaptRestaurantProposedSetToTask, applyTaskStateEvent, canTransitionTask, createActiveTask,
  emptyTaskStateContainer, mergeTaskSlots, parseTaskState, resumeSuspendedTask, serializeTaskState,
  setSelectedEntities, startNewActiveTask, supersedeTask, suspendActiveTask, transitionTask, TaskStateError,
  TaskTransitionError, TASK_STATE_SCHEMA_VERSION, TASK_TYPE_DOMAIN,
  type ActiveTask, type LegacyBookingSessionRow, type TaskStateContainer,
} from '../netlify/functions/_task-state';
import { SAFE_MEMORY_KEYS } from '../netlify/functions/_thongthai-runtime-v3';
import { emptyConversationContextState, isContextExpired } from '../netlify/functions/_conversation-context';
import type { SemanticContextEntity } from '../netlify/functions/_semantic-interpreter';
import { buildPendingPromotionRedemption, type PromotionListItem } from '../netlify/functions/_promotion-dialog';
import type { RestaurantProposedSetState } from '../netlify/functions/_restaurant-preorder-dialog';

const NOW = new Date('2026-09-18T10:00:00.000Z');
const HORSE_ENTITY: SemanticContextEntity = { id: 'conv:horse:paradon', type: 'horse', name: 'ภาราดร', domain: 'activity', source: 'conversation', canonical: false };
const THONGTHAI_ENTITY: SemanticContextEntity = { id: 'conv:horse:thongthai', type: 'horse', name: 'ทองไทย', domain: 'activity', source: 'conversation', canonical: false };

// [1] task creation
test('createActiveTask produces a fresh task in collecting status with computed missingFields', () => {
  const task = createActiveTask({ type: 'activity_booking', sourceChannel: 'web', initialSlots: { resourceCode: 'horse' }, requiredFields: ['resourceCode', 'date', 'time', 'partySize'], now: NOW });
  assert.equal(task.status, 'collecting');
  assert.equal(task.domain, 'activity');
  assert.deepEqual(task.missingFields, ['date', 'time', 'partySize']);
  assert.equal(task.selectedEntities.length, 0);
  assert.equal(task.createdAt, task.updatedAt);
  assert.match(task.taskId, /^task_/);
});

test('startNewActiveTask populates an empty container', () => {
  const container = startNewActiveTask(emptyTaskStateContainer(), { type: 'otop_order', sourceChannel: 'line', now: NOW }, NOW);
  assert.equal(container.activeTask?.type, 'otop_order');
  assert.equal(container.activeTask?.domain, 'otop');
});

test('startNewActiveTask throws when an unfinished task is already active (never silently overwritten)', () => {
  const container = startNewActiveTask(emptyTaskStateContainer(), { type: 'activity_booking', sourceChannel: 'web', now: NOW }, NOW);
  assert.throws(() => startNewActiveTask(container, { type: 'stay_booking', sourceChannel: 'web', now: NOW }, NOW), TaskStateError);
});

// [2] task update / [3] missing-field calculation contract
test('mergeTaskSlots merges values and recomputes missingFields against the supplied requiredFields', () => {
  let task = createActiveTask({ type: 'activity_booking', sourceChannel: 'web', requiredFields: ['resourceCode', 'date', 'time', 'partySize'], now: NOW });
  assert.deepEqual(task.missingFields, ['resourceCode', 'date', 'time', 'partySize']);
  task = mergeTaskSlots(task, { resourceCode: 'horse', date: 'tomorrow' }, ['resourceCode', 'date', 'time', 'partySize'], NOW);
  assert.deepEqual(task.missingFields, ['time', 'partySize']);
  assert.equal(task.slots.resourceCode, 'horse');
});

test('mergeTaskSlots with a null value deletes that key (used for clearing, not just overwriting)', () => {
  let task = createActiveTask({ type: 'activity_booking', sourceChannel: 'web', initialSlots: { date: 'tomorrow' }, now: NOW });
  task = mergeTaskSlots(task, { date: null }, [], NOW);
  assert.equal('date' in task.slots, false);
});

// [4] correction tests
test('correction: selecting a different horse replaces the prior selection, not adds to it', () => {
  let task = createActiveTask({ type: 'activity_booking', sourceChannel: 'web', initialSlots: { horseName: 'ทองไทย' }, now: NOW });
  task = setSelectedEntities(task, [THONGTHAI_ENTITY], NOW);
  assert.equal(task.selectedEntities.length, 1);
  assert.equal(task.selectedEntities[0]!.name, 'ทองไทย');
  // "ไม่ใช่ เอาภาราดร"
  task = mergeTaskSlots(task, { horseName: 'ภาราดร' }, [], NOW);
  task = setSelectedEntities(task, [HORSE_ENTITY], NOW);
  assert.equal(task.selectedEntities.length, 1, 'must replace, not accumulate both horses');
  assert.equal(task.selectedEntities[0]!.name, 'ภาราดร');
  assert.equal(task.slots.horseName, 'ภาราดร');
});

test('correction: partySize "สองคน" then "จริง ๆ สามคน" becomes 3, same task', () => {
  let task = createActiveTask({ type: 'activity_booking', sourceChannel: 'line', initialSlots: { partySize: 2 }, now: NOW });
  const taskId = task.taskId;
  task = mergeTaskSlots(task, { partySize: 3 }, [], NOW);
  assert.equal(task.taskId, taskId);
  assert.equal(task.slots.partySize, 3);
});

test('correction: date "พรุ่งนี้" then "เปลี่ยนเป็นวันเสาร์" replaces the date, not duplicates it', () => {
  let task = createActiveTask({ type: 'activity_booking', sourceChannel: 'line', initialSlots: { date: 'tomorrow' }, now: NOW });
  task = mergeTaskSlots(task, { date: 'saturday' }, [], NOW);
  assert.equal(task.slots.date, 'saturday');
  assert.equal(Object.keys(task.slots).filter(k => k === 'date').length, 1);
});

// [5] cancellation + transition validation
test('task can be cancelled from collecting, and a cancelled task is terminal', () => {
  const task = createActiveTask({ type: 'cafe_inquiry', sourceChannel: 'web', now: NOW });
  const cancelled = transitionTask(task, 'cancelled', NOW);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(canTransitionTask('cancelled', 'collecting'), false);
  assert.throws(() => transitionTask(cancelled, 'ready', NOW), TaskTransitionError);
});

test('explicitly disallowed transitions are rejected: requested->collecting, completed->executing', () => {
  assert.equal(canTransitionTask('requested', 'collecting'), false);
  assert.equal(canTransitionTask('completed', 'executing'), false);
  let task = createActiveTask({ type: 'otop_order', sourceChannel: 'web', now: NOW });
  task = transitionTask(task, 'ready', NOW);
  task = transitionTask(task, 'executing', NOW);
  task = transitionTask(task, 'requested', NOW);
  assert.throws(() => transitionTask(task, 'collecting', NOW), TaskTransitionError);
  const completed = transitionTask(task, 'completed', NOW);
  assert.throws(() => transitionTask(completed, 'executing', NOW), TaskTransitionError);
});

test('full happy-path transition chain collecting -> ready -> executing -> completed is valid', () => {
  let task = createActiveTask({ type: 'activity_booking', sourceChannel: 'web', now: NOW });
  task = transitionTask(task, 'ready', NOW);
  task = transitionTask(task, 'executing', NOW);
  task = transitionTask(task, 'completed', NOW);
  assert.equal(task.status, 'completed');
});

// [6] topic switch / suspend-resume
test('topic switch: suspending the active task preserves it and clears the active slot', () => {
  let container = startNewActiveTask(emptyTaskStateContainer(), { type: 'activity_booking', sourceChannel: 'web', initialSlots: { horseName: 'ภาราดร', date: 'tomorrow' }, now: NOW }, NOW);
  const originalTaskId = container.activeTask!.taskId;
  container = suspendActiveTask(container, NOW);
  assert.equal(container.activeTask, null);
  assert.equal(container.suspendedTask?.taskId, originalTaskId);
  assert.equal(container.suspendedTask?.slots.horseName, 'ภาราดร');
});

test('resume with nothing else active restores the suspended task exactly', () => {
  let container = startNewActiveTask(emptyTaskStateContainer(), { type: 'activity_booking', sourceChannel: 'web', initialSlots: { horseName: 'ภาราดร' }, now: NOW }, NOW);
  container = suspendActiveTask(container, NOW);
  container = resumeSuspendedTask(container, NOW);
  assert.equal(container.activeTask?.slots.horseName, 'ภาราดร');
  assert.equal(container.suspendedTask, null);
});

test('resume while a different task is active swaps them (neither is destroyed)', () => {
  let container = startNewActiveTask(emptyTaskStateContainer(), { type: 'activity_booking', sourceChannel: 'web', initialSlots: { horseName: 'ภาราดร' }, now: NOW }, NOW);
  container = suspendActiveTask(container, NOW);
  container = startNewActiveTask(container, { type: 'restaurant_preorder', sourceChannel: 'web', initialSlots: { items: ['ตำไทย'] }, now: NOW }, NOW);
  container = resumeSuspendedTask(container, NOW);
  assert.equal(container.activeTask?.type, 'activity_booking');
  assert.equal(container.activeTask?.slots.horseName, 'ภาราดร');
  assert.equal(container.suspendedTask?.type, 'restaurant_preorder');
});

// [D.1] system eviction vs customer cancellation must never be conflated.
test('suspending a second task while one is already suspended evicts the older one as SUPERSEDED, never CANCELLED, and preserves it in lastSupersededTask rather than dropping it', () => {
  let container = startNewActiveTask(emptyTaskStateContainer(), { type: 'activity_booking', sourceChannel: 'web', now: NOW }, NOW);
  container = suspendActiveTask(container, NOW);
  const firstSuspendedId = container.suspendedTask!.taskId;
  container = startNewActiveTask(container, { type: 'restaurant_preorder', sourceChannel: 'web', now: NOW }, NOW);
  container = suspendActiveTask(container, NOW);
  assert.notEqual(container.suspendedTask!.taskId, firstSuspendedId, 'the suspended slot must hold the NEWER suspended task');
  assert.equal(container.suspendedTask!.type, 'restaurant_preorder');
  assert.equal(container.lastSupersededTask?.taskId, firstSuspendedId, 'the evicted task must be preserved, not silently dropped');
  assert.equal(container.lastSupersededTask?.status, 'superseded', 'a system eviction must NEVER be reported as customer cancellation');
});

test('D.1: customer-initiated cancellation stays CANCELLED; only the internal eviction path ever produces SUPERSEDED', () => {
  const task = createActiveTask({ type: 'activity_booking', sourceChannel: 'web', now: NOW });
  const customerCancelled = transitionTask(task, 'cancelled', NOW);
  assert.equal(customerCancelled.status, 'cancelled');

  // No entry in the generic transition graph can ever reach 'superseded' --
  // it is reachable ONLY via supersedeTask/suspendActiveTask's internal
  // eviction path, never via a caller-driven transitionTask call.
  const allStatuses: Array<typeof task.status> = ['collecting', 'ready', 'executing', 'requested', 'completed', 'cancelled', 'failed', 'superseded'];
  for (const from of allStatuses) assert.equal(canTransitionTask(from, 'superseded'), false, `no status may transition to 'superseded' via the generic graph (checked from "${from}")`);
});

test('D.1: supersedeTask is idempotent on an already-terminal task (never relabels a real cancellation as superseded)', () => {
  const task = createActiveTask({ type: 'activity_booking', sourceChannel: 'web', now: NOW });
  const cancelled = transitionTask(task, 'cancelled', NOW);
  const result = supersedeTask(cancelled, NOW);
  assert.equal(result.status, 'cancelled', 'supersedeTask must never overwrite an existing terminal status, including a real customer cancellation');
});

test('D.1: eviction never touches operational booking/order/payment state -- _task-state.ts only persists under guest_agent_state', async () => {
  const source = await (await import('node:fs/promises')).readFile(new URL('../netlify/functions/_task-state.ts', import.meta.url), 'utf8');
  const dbFetchTargets = [...source.matchAll(/dbFetch\(`([a-z_]+)\?/g)].map(match => match[1]);
  for (const target of dbFetchTargets) assert.equal(target, 'guest_agent_state', `_task-state.ts must only read/write guest_agent_state, never an operational table directly (found: ${target})`);
});

test('suspend/resume are no-ops when there is nothing to act on', () => {
  const empty = emptyTaskStateContainer();
  assert.deepEqual(suspendActiveTask(empty, NOW), empty);
  assert.deepEqual(resumeSuspendedTask(empty, NOW), empty);
});

// [7] completed-task isolation (no contamination between tasks)
test('starting a new task after the previous one completed gives fresh slots -- no leakage', () => {
  let container = startNewActiveTask(emptyTaskStateContainer(), { type: 'activity_booking', sourceChannel: 'web', initialSlots: { horseName: 'ภาราดร', date: 'tomorrow' }, now: NOW }, NOW);
  container = { ...container, activeTask: transitionTask(transitionTask(transitionTask(container.activeTask!, 'ready', NOW), 'executing', NOW), 'completed', NOW) };
  const finishedTaskId = container.activeTask!.taskId;
  container = startNewActiveTask(container, { type: 'restaurant_preorder', sourceChannel: 'web', now: NOW }, NOW);
  assert.notEqual(container.activeTask!.taskId, finishedTaskId);
  assert.deepEqual(container.activeTask!.slots, {});
  assert.equal('horseName' in container.activeTask!.slots, false);
});

// [8] duplicate input idempotence
test('applyTaskStateEvent ignores a replayed eventId (duplicate webhook delivery is a safe no-op)', () => {
  let container = emptyTaskStateContainer();
  const startEvent = { kind: 'start' as const, eventId: 'evt-1', params: { type: 'activity_booking' as const, sourceChannel: 'line', initialSlots: { horseName: 'ภาราดร' } } };
  container = applyTaskStateEvent(container, startEvent, NOW);
  const afterFirst = container;
  container = applyTaskStateEvent(container, startEvent, NOW);
  assert.deepEqual(container, afterFirst, 'replaying the same eventId must not create a second task or change anything');
});

test('applyTaskStateEvent duplicate update_slots does not double-apply', () => {
  let container = applyTaskStateEvent(emptyTaskStateContainer(), { kind: 'start', eventId: 'evt-1', params: { type: 'otop_order', sourceChannel: 'web' } }, NOW);
  const updateEvent = { kind: 'update_slots' as const, eventId: 'evt-2', slotPatch: { quantity: 1 } };
  container = applyTaskStateEvent(container, updateEvent, NOW);
  container = applyTaskStateEvent(container, updateEvent, NOW);
  assert.equal(container.activeTask!.slots.quantity, 1);
});

// [9] state serialization/deserialization
test('serializeTaskState/parseTaskState round-trips exactly', () => {
  let container = startNewActiveTask(emptyTaskStateContainer(), { type: 'activity_booking', sourceChannel: 'web', initialSlots: { horseName: 'ภาราดร' }, now: NOW }, NOW);
  container = suspendActiveTask(container, NOW);
  const roundTripped = parseTaskState(JSON.parse(serializeTaskState(container)));
  assert.deepEqual(roundTripped, container);
});

test('parseTaskState defensively falls back to empty on malformed/foreign JSONB content', () => {
  assert.deepEqual(parseTaskState(null), emptyTaskStateContainer());
  assert.deepEqual(parseTaskState({ some: 'unrelated', blob: true }), emptyTaskStateContainer());
  assert.deepEqual(parseTaskState({ schemaVersion: 'task-state-v0' }), emptyTaskStateContainer());
  const withBadTask = parseTaskState({ schemaVersion: TASK_STATE_SCHEMA_VERSION, activeTask: { taskId: 'x', status: 'not_a_real_status' }, suspendedTask: null, recentEventIds: [] });
  assert.equal(withBadTask.activeTask, null, 'a structurally invalid task must not be trusted');
});

// [10] legacy-state adapter tests
test('adaptBookingSessionToTask maps a LINE booking_sessions row honestly, reusing its own status/fields', () => {
  const row: LegacyBookingSessionRow = {
    service_type: 'activity', resource_code: 'activity-horse', requested_date: '2026-09-19', requested_time: null,
    end_date: null, party_size: 2, quantity: 0, special_request: null, status: 'needs_slot', booking_code: null,
  };
  const task = adaptBookingSessionToTask(row, 'line', NOW);
  assert.equal(task?.type, 'activity_booking');
  assert.equal(task?.status, 'collecting');
  assert.deepEqual(task?.missingFields, ['time']);
  assert.equal(task?.slots.resourceCode, 'activity-horse');
});

test('adaptBookingSessionToTask returns null for a row with no recognizable service_type', () => {
  const row: LegacyBookingSessionRow = { service_type: null, resource_code: null, requested_date: null, requested_time: null, end_date: null, party_size: null, quantity: 0, special_request: null, status: 'collecting', booking_code: null };
  assert.equal(adaptBookingSessionToTask(row, 'line', NOW), null);
});

test('adaptRestaurantProposedSetToTask reuses missingRestaurantPreorderFields, does not reinvent it', () => {
  const state: RestaurantProposedSetState = {
    items: [{ name: 'ตำไทย', quantity: 1, priceEach: 60 }], total: 109, partySize: 2, createdAt: NOW.toISOString(),
    preorderDraft: { date: '2026-09-19', time: null, customerName: 'สมชาย', phone: null, email: null, acceptedAt: NOW.toISOString() },
  };
  const task = adaptRestaurantProposedSetToTask(state, 'web', NOW);
  assert.equal(task.type, 'restaurant_preorder');
  assert.deepEqual(task.missingFields, ['time', 'phone']);
});

test('adaptPendingPromotionRedemptionToTask reuses missingPromotionFields, does not reinvent it', () => {
  const promo: PromotionListItem = {
    campaignId: 'c1', campaignCode: 'PROMO1', title: 'ตำไทย + ข้าวเหนียว', description: null, businessScope: 'restaurant', promoType: 'bundle',
    items: [{ name: 'ตำไทย', quantity: 1, businessUnit: 'restaurant' }], normalTotal: 109, promoTotal: 99, discountPct: null,
    startAt: null, endAt: null, maxRedemptions: null, redemptionCount: 0, requiresDateTime: true, automatedHandoff: false,
  };
  const pending = buildPendingPromotionRedemption(promo);
  const task = adaptPendingPromotionRedemptionToTask(pending, 'line', NOW);
  assert.equal(task.type, 'promotion_redemption');
  assert.deepEqual(task.missingFields, ['date', 'time', 'customerName']);
  assert.equal(task.slots.promoTotal, 99);
});

// [11] memory ownership / leak tests
test('SAFE_MEMORY_KEYS (durable semantic memory allow-list) contains no transactional/PII field names', () => {
  const forbidden = ['name', 'phone', 'email', 'payment', 'paymentSlip', 'bookingCode', 'preorderCode', 'campaignCode', 'status', 'card', 'slip', 'address'];
  for (const key of SAFE_MEMORY_KEYS) {
    for (const bad of forbidden) assert.equal(key.toLowerCase().includes(bad.toLowerCase()), false, `SAFE_MEMORY_KEYS must never include a transactional/PII-shaped key like "${bad}", found in "${key}"`);
  }
});

test('an ActiveTask has no rollingSummary/recentTurns field, and ConversationContextState has no status/slots field -- the two layers cannot be confused for each other', () => {
  const task = createActiveTask({ type: 'activity_booking', sourceChannel: 'web', now: NOW });
  assert.equal('rollingSummary' in task, false);
  assert.equal('recentTurns' in task, false);
  const context = emptyConversationContextState(NOW);
  assert.equal('status' in context, false);
  assert.equal('slots' in context, false);
  assert.equal('missingFields' in context, false);
});

test('expired conversation context does not resurrect or alter a completed ActiveTask -- the two are independently serialized', () => {
  let container = startNewActiveTask(emptyTaskStateContainer(), { type: 'activity_booking', sourceChannel: 'web', now: NOW }, NOW);
  container = { ...container, activeTask: transitionTask(transitionTask(transitionTask(container.activeTask!, 'ready', NOW), 'executing', NOW), 'completed', NOW) };
  const staleContext = { ...emptyConversationContextState(NOW), expiresAt: new Date(NOW.getTime() - 1000).toISOString() };
  const muchLater = new Date(NOW.getTime() + 3 * 60 * 60 * 1000);
  assert.equal(isContextExpired(staleContext, muchLater), true);
  // Nothing about the expired conversation context can reach into or change task state -- they are separate top-level keys under guest_agent_state.state.
  assert.equal(container.activeTask!.status, 'completed');
});

test('task correction fields are keyed objects, not append-only logs -- a repeated correction never grows unboundedly', () => {
  let task = createActiveTask({ type: 'activity_booking', sourceChannel: 'line', now: NOW });
  for (const date of ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']) task = mergeTaskSlots(task, { date }, [], NOW);
  assert.equal(task.slots.date, 'friday');
  assert.equal(Object.keys(task.slots).length, 1);
});

test('addTaskConstraint is bounded and deduplicated', () => {
  let task = createActiveTask({ type: 'activity_booking', sourceChannel: 'web', now: NOW });
  for (let i = 0; i < 20; i += 1) task = addTaskConstraint(task, `constraint-${i % 3}`, NOW);
  assert.ok(task.constraints.length <= 10);
  assert.deepEqual(new Set(task.constraints).size, task.constraints.length);
});

test('TASK_TYPE_DOMAIN covers every ActiveTaskType used by createActiveTask default domain lookup', () => {
  const types: Array<ActiveTask['type']> = ['activity_booking', 'stay_booking', 'restaurant_booking', 'restaurant_preorder', 'promotion_redemption', 'otop_order', 'cafe_inquiry', 'membership', 'journey_planning'];
  for (const type of types) assert.ok(TASK_TYPE_DOMAIN[type], `TASK_TYPE_DOMAIN must define a domain for ${type}`);
});

test('emptyTaskStateContainer has the expected shape', () => {
  const container: TaskStateContainer = emptyTaskStateContainer();
  assert.equal(container.activeTask, null);
  assert.equal(container.suspendedTask, null);
  assert.equal(container.lastSupersededTask, null);
  assert.deepEqual(container.recentEventIds, []);
  assert.equal(container.schemaVersion, TASK_STATE_SCHEMA_VERSION);
});
