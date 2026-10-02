import test from 'node:test';
import assert from 'node:assert/strict';
import { planDialogTurn, type DialogInput } from '../netlify/functions/_dialog-manager';
import { createActiveTask, emptyTaskStateContainer } from '../netlify/functions/_task-state';
import { emptyConversationContextState } from '../netlify/functions/_conversation-context';
import type { SemanticAction, SemanticTurn } from '../netlify/functions/_semantic-interpreter';

const NOW = new Date('2026-10-02T08:45:00Z');

function fixture(action: SemanticAction, entities: Record<string, unknown>, committed = false): DialogInput {
  const activeTask = {
    ...createActiveTask({ type: 'activity_booking', sourceChannel: 'line', initialSlots: {
      resourceCode: 'activity-horse', horseName: 'ภาราดร', assetSelection: 'ภาราดร', durationMinutes: 45,
    } }),
    commitmentIntent: committed,
    constraints: ['no_transaction'],
  };
  const semanticTurn: SemanticTurn = {
    semanticSource: 'openai_supervisor', domain: 'activity', intent: 'current_structured_choice',
    speechAct: 'selection', action, informationNeed: 'none', entities, references: [],
    constraints: ['no_transaction'], confidence: 0.99, needsClarification: false,
  };
  return {
    semanticTurn,
    conversationContext: emptyConversationContextState(NOW),
    taskState: { ...emptyTaskStateContainer(), activeTask },
    channel: 'line',
    eventId: `alias-${action}`,
  };
}

for (const action of ['provide_information', 'modify', 'correct_previous', 'confirm'] as const) {
  test(`Phase 7: ${action} keeps horse aliases consistent without committing`, () => {
    const input = fixture(action, { horseName: 'ทองไทย' });
    const before = JSON.stringify(input);
    const plan = planDialogTurn(input, NOW);
    const task = plan.taskStateContainer.activeTask;
    assert.ok(task);
    assert.equal(task.slots.horseName, 'ทองไทย');
    assert.equal(task.slots.assetSelection, 'ทองไทย');
    assert.equal(task.slots.durationMinutes, 45);
    assert.equal(task.slots.resourceCode, 'activity-horse');
    assert.equal(task.commitmentIntent, false);
    assert.equal(plan.customerCommitPresent, false);
    assert.notEqual(plan.mode, 'propose_action');
    assert.notEqual(plan.mode, 'execute_tool');
    assert.equal(JSON.stringify(input), before);
    const replay = planDialogTurn({ ...input, taskState: plan.taskStateContainer }, NOW);
    assert.deepEqual(replay.taskStateContainer, plan.taskStateContainer);
  });
}

test('Phase 7: current horseName outranks a conflicting legacy alias', () => {
  const plan = planDialogTurn(
    fixture('correct_previous', { horseName: 'ทองไทย', assetSelection: 'ภาราดร' }, true),
    NOW,
  );
  assert.equal(plan.taskStateContainer.activeTask?.slots.assetSelection, 'ทองไทย');
  assert.equal(plan.taskStateContainer.activeTask?.commitmentIntent, false);
  assert.equal(plan.customerCommitPresent, false);
});

test('Phase 7: duration-only update preserves the existing horse aliases', () => {
  const plan = planDialogTurn(fixture('modify', { durationMinutes: 30, horseName: undefined }), NOW);
  assert.equal(plan.taskStateContainer.activeTask?.slots.horseName, 'ภาราดร');
  assert.equal(plan.taskStateContainer.activeTask?.slots.assetSelection, 'ภาราดร');
  assert.equal(plan.taskStateContainer.activeTask?.slots.durationMinutes, 30);
  assert.equal(plan.customerCommitPresent, false);
});
