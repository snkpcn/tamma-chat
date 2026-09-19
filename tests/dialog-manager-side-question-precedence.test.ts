// Conversation-coverage hardening -- the GENERAL rule, proven directly
// against the real Dialog Manager (not just the deterministic deriver): an
// active task is INTERRUPTIBLE. Having a missing field does not mean every
// following turn is a slot fill -- a genuine side-question (compare/ask/
// discover/recommend/status) that does not provide one of the task's own
// slot values must be answered on its own terms, and the task must survive
// untouched, resumable on the next real continuation turn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planDialogTurn, type DialogInput } from '../netlify/functions/_dialog-manager';
import { emptyConversationContextState } from '../netlify/functions/_conversation-context';
import { createActiveTask, emptyTaskStateContainer, type TaskStateContainer } from '../netlify/functions/_task-state';
import type { SemanticTurn } from '../netlify/functions/_semantic-interpreter';

const NOW = new Date('2026-09-19T05:00:00.000Z');

function activityTask(): TaskStateContainer {
  return {
    ...emptyTaskStateContainer(),
    activeTask: createActiveTask({
      type: 'activity_booking', sourceChannel: 'line', now: NOW,
      initialSlots: { resourceCode: 'activity-horse', date: '2026-09-20' },
    }),
  };
}

function turn(overrides: Partial<SemanticTurn>): SemanticTurn {
  return { domain: 'activity', intent: 'x', action: 'ask', entities: {}, references: [], constraints: [], confidence: .9, needsClarification: false, ...overrides };
}

test('a pure side-question (compare) on a task missing durationMinutes never becomes collect_field', () => {
  const taskState = activityTask();
  const input: DialogInput = {
    semanticTurn: turn({ action: 'compare', intent: 'compare_entities', entities: { compareAttribute: 'temperament' } }),
    conversationContext: emptyConversationContextState(NOW), taskState, channel: 'line', eventId: 'sq-1',
  };
  const plan = planDialogTurn(input, NOW);
  assert.notEqual(plan.mode, 'collect_field');
  assert.ok(plan.reasons.includes('task_side_question_preserved'));
  // The task itself is untouched -- still missing exactly what it was
  // missing before, nothing corrupted by comparison metadata.
  assert.deepEqual(plan.taskStateContainer.activeTask!.missingFields, ['durationMinutes']);
  assert.equal(plan.taskStateContainer.activeTask!.slots.compareAttribute, undefined, 'comparison metadata must never leak into task slots');
});

test('a pure side-question (price ask, no entities) on a task missing durationMinutes never becomes collect_field', () => {
  const taskState = activityTask();
  const input: DialogInput = {
    semanticTurn: turn({ action: 'ask', intent: 'ask_price' }),
    conversationContext: emptyConversationContextState(NOW), taskState, channel: 'line', eventId: 'sq-2',
  };
  const plan = planDialogTurn(input, NOW);
  assert.notEqual(plan.mode, 'collect_field');
  assert.ok(plan.reasons.includes('task_side_question_preserved'));
  assert.deepEqual(plan.taskStateContainer.activeTask!.missingFields, ['durationMinutes'], 'task survives the side-question untouched');
});

test('a hybrid turn (status action that ALSO states a real slot value) still proceeds to collect_field for what remains missing', () => {
  const taskState = activityTask();
  const input: DialogInput = {
    semanticTurn: turn({ action: 'status', intent: 'check_specific_time_availability', entities: { time: 'บ่ายสาม' } }),
    conversationContext: emptyConversationContextState(NOW), taskState, channel: 'line', eventId: 'sq-3',
  };
  const plan = planDialogTurn(input, NOW);
  assert.equal(plan.taskStateContainer.activeTask!.slots.time, 'บ่ายสาม', 'the stated time must still be retained');
  assert.equal(plan.mode, 'collect_field', 'durationMinutes is still genuinely required and must still be asked for');
  assert.ok(!plan.reasons.includes('task_side_question_preserved'));
});

test('a genuine slot-fill turn (provide_information with the missing field) still fills it and proceeds normally', () => {
  const taskState = activityTask();
  const input: DialogInput = {
    semanticTurn: turn({ action: 'provide_information', intent: 'provide_duration', entities: { durationMinutes: 60 } }),
    conversationContext: emptyConversationContextState(NOW), taskState, channel: 'line', eventId: 'sq-4',
  };
  const plan = planDialogTurn(input, NOW);
  assert.equal(plan.taskStateContainer.activeTask!.slots.durationMinutes, 60);
  assert.deepEqual(plan.taskStateContainer.activeTask!.missingFields, []);
  assert.ok(!plan.reasons.includes('task_side_question_preserved'));
});

test('an explicit cancel ends the task and a later side-question no longer has anything to preserve', () => {
  const taskState = activityTask();
  const cancelInput: DialogInput = {
    semanticTurn: turn({ action: 'cancel', intent: 'task_cancel' }),
    conversationContext: emptyConversationContextState(NOW), taskState, channel: 'line', eventId: 'sq-5',
  };
  const cancelPlan = planDialogTurn(cancelInput, NOW);
  assert.equal(cancelPlan.taskStateContainer.activeTask?.status, 'cancelled');
  assert.deepEqual(cancelPlan.missingFields, [], 'a cancelled task never re-surfaces a stale missing-field prompt');
  assert.notEqual(cancelPlan.mode, 'collect_field');
});

test('cancelling with no active task at all is a safe no-op, never fabricates a task to cancel', () => {
  const input: DialogInput = {
    semanticTurn: turn({ action: 'cancel', intent: 'task_cancel' }),
    conversationContext: emptyConversationContextState(NOW), taskState: emptyTaskStateContainer(), channel: 'line', eventId: 'sq-6',
  };
  const plan = planDialogTurn(input, NOW);
  assert.equal(plan.taskStateContainer.activeTask, null);
});
