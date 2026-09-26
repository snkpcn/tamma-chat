import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  processThongthaiOneMindTurn,
  type OneMindDependencies,
} from '../netlify/functions/_thongthai-one-mind-orchestrator';
import {
  applyConversationContextUpdate,
  emptyConversationContextState,
} from '../netlify/functions/_conversation-context';
import {
  createActiveTask,
  emptyTaskStateContainer,
  type TaskStateContainer,
} from '../netlify/functions/_task-state';
import { planDialogTurn } from '../netlify/functions/_dialog-manager';
import { ProviderNotConfiguredError } from '../netlify/functions/_thongthai-model-provider';
import type { SemanticTurn } from '../netlify/functions/_semantic-interpreter';

const NOW = new Date('2026-09-26T17:00:00.000Z');
const CANON = '11111111-1111-4111-8111-111111111111';
const GUEST = '22222222-2222-4222-8222-222222222222';

function activeActivityTask(): TaskStateContainer {
  return {
    ...emptyTaskStateContainer(),
    activeTask:createActiveTask({
      type:'activity_booking',
      sourceChannel:'web',
      now:NOW,
      initialSlots:{ resourceCode:'activity-horse', horseName:'ภาราดร', date:'2026-09-27' },
      requiredFields:['resourceCode', 'date', 'time', 'partySize', 'durationMinutes'],
    }),
  };
}

function contextWithActivity() {
  return applyConversationContextUpdate(emptyConversationContextState(NOW), {
    eventId:'seed-context',
    channel:'web',
    userMessage:'อยากขี่ม้า เอาภาราดร',
    activeDomain:'activity',
    activeTopic:'activity_booking',
    summaryFact:'customer selected the horse ภาราดร.',
  }, NOW);
}

function dependencies(
  conversationContext: ReturnType<typeof contextWithActivity>,
  taskState:TaskStateContainer,
  interpretSemanticTurn:OneMindDependencies['interpretSemanticTurn'],
): Partial<OneMindDependencies> {
  return {
    loadConversationContext:async () => conversationContext,
    loadTaskState:async () => taskState,
    interpretSemanticTurn,
    buildKnowledgeAdapters:() => ({}),
  };
}

function semantic(overrides:Partial<SemanticTurn>):SemanticTurn {
  return {
    domain:'activity',
    intent:'continuity_acceptance',
    action:'ask',
    entities:{},
    references:[],
    constraints:[],
    confidence:0.95,
    needsClarification:false,
    ...overrides,
  };
}

test('Phase 2 acceptance: provider outage cannot mutate canonical conversation or task state', async () => {
  const beforeContext = contextWithActivity();
  const beforeTask = activeActivityTask();
  const result = await processThongthaiOneMindTurn({
    channel:'web',
    message:'แล้วตัวนั้นว่างพรุ่งนี้ไหม',
    eventId:'phase2-outage-no-state-write',
    canonicalAnonymousId:CANON,
    guestDbId:GUEST,
  }, dependencies(beforeContext, beforeTask, async () => {
    throw new ProviderNotConfiguredError();
  }), new Date(NOW.getTime() + 1000));

  assert.equal(result.semanticTurn.semanticSource, 'provider_unavailable');
  assert.deepEqual(result.taskStateAfter, beforeTask);
  assert.deepEqual(result.conversationContextAfter, beforeContext,
    'an unobserved meaning must not overwrite topic/domain/open-question/turn context');
  assert.equal(result.dialogDecision.mode, 'clarify');
  assert.equal(result.dialogDecision.actionProposal, undefined);
});

test('Phase 2 acceptance: structurally weak low-confidence model output cannot create a task', async () => {
  const beforeContext = emptyConversationContextState(NOW);
  const beforeTask = emptyTaskStateContainer();
  const result = await processThongthaiOneMindTurn({
    channel:'line',
    message:'ก็แบบที่ว่าไปนั่นแหละ',
    eventId:'phase2-low-confidence-no-state-write',
    canonicalAnonymousId:CANON,
    guestDbId:GUEST,
  }, dependencies(beforeContext, beforeTask, async () => ({
    domain:'activity',
    intent:'maybe_book_something',
    action:'book',
    entities:{},
    references:[],
    constraints:[],
    confidence:0.31,
    needsClarification:false,
  })), new Date(NOW.getTime() + 1000));

  assert.equal(result.dialogDecision.mode, 'clarify');
  assert.equal(result.taskStateAfter.activeTask, null);
  assert.equal(result.dialogDecision.actionProposal, undefined);
  assert.deepEqual(result.conversationContextAfter, beforeContext);
});

test('Phase 2 acceptance: an ambiguous reference asks instead of guessing or mutating selection', () => {
  const beforeTask = activeActivityTask();
  const beforeContext = contextWithActivity();
  const plan = planDialogTurn({
    semanticTurn:semantic({
      action:'confirm',
      speechAct:'selection',
      references:[{ type:'pronoun', value:'ตัวนั้น', refersToPriorContext:true, ambiguous:true }],
      needsClarification:true,
    }),
    conversationContext:beforeContext,
    taskState:beforeTask,
    channel:'web',
    eventId:'phase2-ambiguous-reference',
  }, NOW);

  assert.equal(plan.mode, 'clarify');
  assert.deepEqual(plan.taskStateContainer, beforeTask);
  assert.ok(plan.reasons.includes('ambiguous_entity'));
});

test('Phase 2 acceptance: side questions preserve the exact active task', () => {
  const beforeTask = activeActivityTask();
  const plan = planDialogTurn({
    semanticTurn:semantic({
      action:'ask',
      informationNeed:'price',
      intent:'ask_activity_price',
    }),
    conversationContext:contextWithActivity(),
    taskState:beforeTask,
    channel:'line',
    eventId:'phase2-side-question',
  }, NOW);

  assert.equal(plan.taskStateContainer.activeTask?.taskId, beforeTask.activeTask?.taskId);
  assert.deepEqual(plan.taskStateContainer.activeTask?.slots, beforeTask.activeTask?.slots);
  assert.deepEqual(plan.taskStateContainer.activeTask?.missingFields, beforeTask.activeTask?.missingFields);
  assert.ok(plan.reasons.includes('task_side_question_preserved'));
});

test('Phase 2 acceptance: cancel is terminal and cannot be resurrected by resume', () => {
  const beforeTask = activeActivityTask();
  const cancelled = planDialogTurn({
    semanticTurn:semantic({ action:'cancel', taskDirective:'cancel_active' }),
    conversationContext:contextWithActivity(),
    taskState:beforeTask,
    channel:'web',
    eventId:'phase2-cancel',
  }, NOW).taskStateContainer;

  assert.equal(cancelled.activeTask?.status, 'cancelled');

  const resumed = planDialogTurn({
    semanticTurn:semantic({ action:'ask', taskDirective:'resume_suspended' }),
    conversationContext:contextWithActivity(),
    taskState:cancelled,
    channel:'web',
    eventId:'phase2-resume-cancelled',
  }, new Date(NOW.getTime() + 1000)).taskStateContainer;

  assert.equal(resumed.activeTask?.status, 'cancelled');
  assert.equal(resumed.suspendedTask, null);
});
