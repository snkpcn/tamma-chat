// Phase D golden continuation of the canonical 6-turn horse-booking scenario
// (same fixture Phase C's semantic-multiturn-golden.test.ts drives through
// conversation continuity). This file drives the SAME six turns through the
// Working/Task State container instead, proving:
//   - no task exists during pure discovery/ask/compare turns 1-3
//   - a task is created at turn 4 ("เอาภาราดร"), carrying the selected horse
//   - turn 5 ("พรุ่งนี้สองคน") merges date+partySize into the SAME task
//   - turn 6 ("บ่ายสามได้ปะ") merges the requested time into the SAME task
//   - status never leaves 'collecting' -- Phase D does not execute a real
//     booking; that is a later phase's job (Knowledge Resolver + transaction
//     layer), matching the "NO real booking execution yet" requirement.
//
// requiredFields below is a Phase-D-test-local illustration of what a horse
// booking needs, NOT a new authoritative business rule -- the real rule
// belongs to a later phase's deterministic domain code. It exists here only
// to prove the generic missingFields mechanism composes correctly across
// turns, exactly as a real Dialog Manager would drive it later.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyTaskStateEvent, emptyTaskStateContainer, type TaskStateEvent,
} from '../netlify/functions/_task-state';
import { HORSE_BOOKING_SCENARIO } from './fixtures/semantic-multiturn-scenarios';

const HORSE_REQUIRED_FIELDS = ['resourceCode', 'date', 'time', 'partySize'] as const;
const HORSE_ENTITY = { id: 'conv:horse:paradon', type: 'horse', name: 'ภาราดร', domain: 'activity' as const, source: 'conversation' as const, canonical: false };

test('horse-booking golden scenario drives Working/Task State correctly across all 6 turns', () => {
  let container = emptyTaskStateContainer();
  const now = new Date('2026-09-18T10:00:00.000Z');

  // Turns 1-3: broad discovery, domain narrowing, comparison -- no task yet.
  for (const step of HORSE_BOOKING_SCENARIO.slice(0, 3)) {
    assert.equal(container.activeTask, null, `no task should exist yet at "${step.message}"`);
  }

  // Turn 4: "เอาภาราดร" -- selection creates the task.
  const step4 = HORSE_BOOKING_SCENARIO[3]!;
  const startEvent: TaskStateEvent = {
    kind: 'start', eventId: step4.eventId,
    params: { type: 'activity_booking', sourceChannel: step4.channel, initialSlots: { resourceCode: 'horse', horseName: 'ภาราดร' }, requiredFields: HORSE_REQUIRED_FIELDS },
  };
  container = applyTaskStateEvent(container, startEvent, now);
  container = applyTaskStateEvent(container, { kind: 'set_entities', eventId: `${step4.eventId}-entities`, entities: [HORSE_ENTITY] }, now);
  assert.ok(container.activeTask, 'a task must exist after the horse is selected');
  assert.equal(container.activeTask!.slots.horseName, 'ภาราดร');
  assert.equal(container.activeTask!.selectedEntities[0]!.name, 'ภาราดร');
  assert.deepEqual(container.activeTask!.missingFields, ['date', 'time', 'partySize']);
  const taskId = container.activeTask!.taskId;

  // Turn 5: "พรุ่งนี้สองคน" -- same task gains date + partySize.
  const step5 = HORSE_BOOKING_SCENARIO[4]!;
  container = applyTaskStateEvent(container, {
    kind: 'update_slots', eventId: step5.eventId, slotPatch: { date: 'พรุ่งนี้', partySize: 2 }, requiredFields: HORSE_REQUIRED_FIELDS,
  }, now);
  assert.equal(container.activeTask!.taskId, taskId, 'turn 5 must update the SAME task, not create a new one');
  assert.equal(container.activeTask!.slots.horseName, 'ภาราดร', 'the horse selection from turn 4 must survive');
  assert.equal(container.activeTask!.slots.date, 'พรุ่งนี้');
  assert.equal(container.activeTask!.slots.partySize, 2);
  assert.deepEqual(container.activeTask!.missingFields, ['time']);
  assert.equal(container.activeTask!.status, 'collecting');

  // Turn 6: "บ่ายสามได้ปะ" -- same task gains the requested time. Still no execution.
  const step6 = HORSE_BOOKING_SCENARIO[5]!;
  container = applyTaskStateEvent(container, {
    kind: 'update_slots', eventId: step6.eventId, slotPatch: { time: 'บ่ายสาม' }, requiredFields: HORSE_REQUIRED_FIELDS,
  }, now);
  assert.equal(container.activeTask!.taskId, taskId, 'turn 6 must still be the SAME task');
  assert.equal(container.activeTask!.slots.horseName, 'ภาราดร');
  assert.equal(container.activeTask!.slots.date, 'พรุ่งนี้');
  assert.equal(container.activeTask!.slots.partySize, 2);
  assert.equal(container.activeTask!.slots.time, 'บ่ายสาม');
  assert.deepEqual(container.activeTask!.missingFields, [], 'all four fields are now present');
  assert.equal(container.activeTask!.status, 'collecting', 'Phase D must not execute a real booking -- status must not advance past collecting');
});

test('topic switch during the horse scenario: asking about the restaurant mid-booking suspends but does not destroy the horse task, and it is fully recoverable', () => {
  let container = emptyTaskStateContainer();
  const now = new Date('2026-09-18T10:00:00.000Z');
  container = applyTaskStateEvent(container, {
    kind: 'start', eventId: 'topic-switch-1',
    params: { type: 'activity_booking', sourceChannel: 'web', initialSlots: { horseName: 'ภาราดร', date: 'พรุ่งนี้' }, requiredFields: HORSE_REQUIRED_FIELDS },
  }, now);

  // "เดี๋ยวก่อน ร้านมีอะไรกิน" -- a topic switch away from the unfinished booking.
  container = applyTaskStateEvent(container, { kind: 'suspend', eventId: 'topic-switch-2' }, now);
  assert.equal(container.activeTask, null);
  assert.equal(container.suspendedTask?.slots.horseName, 'ภาราดร');

  // "กลับมาจองม้าต่อ" -- must be recoverable without inventing new state.
  container = applyTaskStateEvent(container, { kind: 'resume', eventId: 'topic-switch-3' }, now);
  assert.equal(container.activeTask?.slots.horseName, 'ภาราดร');
  assert.equal(container.activeTask?.slots.date, 'พรุ่งนี้');
  assert.equal(container.suspendedTask, null);
});
