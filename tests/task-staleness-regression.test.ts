import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTEXT_TTL_MS,
  buildSemanticContext,
  emptyConversationContextState,
} from '../netlify/functions/_conversation-context';
import { normalizeTaskStateForConversation } from '../netlify/functions/_thongthai-one-mind-orchestrator';
import { createActiveTask, emptyTaskStateContainer } from '../netlify/functions/_task-state';
import { deriveDeterministicSemanticTurn } from '../netlify/functions/_deterministic-semantic-turn';
import { planDialogTurn } from '../netlify/functions/_dialog-manager';

const START = new Date('2026-09-19T07:00:00.000Z');
const AFTER_TTL = new Date(START.getTime() + CONTEXT_TTL_MS + 1_000);

function staleActivityState() {
  return {
    ...emptyTaskStateContainer(),
    activeTask:createActiveTask({
      type:'activity_booking',
      sourceChannel:'line',
      now:START,
      initialSlots:{ resourceCode:'activity-horse', time:'15:00' },
      requiredFields:['resourceCode','date','time','partySize','durationMinutes'],
    }),
  };
}

test('unfinished task becomes conversationally suspended after the context inactivity TTL', () => {
  const before = staleActivityState();
  const normalized = normalizeTaskStateForConversation(before, AFTER_TTL);
  assert.equal(normalized.staleTaskSuspended, true);
  assert.equal(normalized.taskState.activeTask, null);
  assert.equal(normalized.taskState.suspendedTask?.taskId, before.activeTask?.taskId);
  assert.equal(normalized.taskState.suspendedTask?.slots.time, '15:00');
});

test('general chat after task TTL cannot expose the stale task missing-field prompt', () => {
  const normalized = normalizeTaskStateForConversation(staleActivityState(), AFTER_TTL);
  const context = emptyConversationContextState(AFTER_TTL);
  const plan = planDialogTurn({
    semanticTurn:{
      domain:'support', intent:'general_chat', action:'unknown',
      entities:{}, references:[], constraints:[], confidence:0.8, needsClarification:false,
    },
    conversationContext:context,
    taskState:normalized.taskState,
    channel:'line',
    eventId:'stale-general-chat',
  }, AFTER_TTL);
  assert.equal(plan.taskStateContainer.activeTask, null);
  assert.ok(plan.taskStateContainer.suspendedTask);
  assert.notEqual(plan.mode, 'collect_field');
  assert.deepEqual(plan.missingFields, []);
});

test('an explicit activity resume after TTL can restore the same preserved task', () => {
  const normalized = normalizeTaskStateForConversation(staleActivityState(), AFTER_TTL);
  const contextState = emptyConversationContextState(AFTER_TTL);
  const semanticContext = buildSemanticContext(contextState, AFTER_TTL);
  const turn = deriveDeterministicSemanticTurn('กลับมาจองม้าต่อ', semanticContext, normalized.taskState);
  assert.ok(turn, 'resume wording names the activity domain structurally');
  assert.equal(turn?.domain, 'activity');

  const plan = planDialogTurn({
    semanticTurn:turn!,
    conversationContext:contextState,
    taskState:normalized.taskState,
    channel:'line',
    eventId:'stale-explicit-resume',
  }, AFTER_TTL);

  assert.ok(plan.reasons.includes('task_resumed'));
  assert.equal(plan.taskStateContainer.activeTask?.taskId, normalized.taskState.suspendedTask?.taskId);
  assert.equal(plan.taskStateContainer.activeTask?.slots.time, '15:00');
});
