// FROZEN PHASE 2 HOLDOUT.
// Created only after the Phase 2 implementation and public acceptance suite
// were stable at 3b55ae74f90b033d7a309c39844d3a66d0127ccf.
// Do not tune production code against these individual cases.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planDialogTurn } from '../netlify/functions/_dialog-manager';
import { emptyConversationContextState } from '../netlify/functions/_conversation-context';
import {
  applyTaskStateEvent,
  createActiveTask,
  emptyTaskStateContainer,
  startNewActiveTask,
  type TaskStateContainer,
} from '../netlify/functions/_task-state';
import type { SemanticTurn } from '../netlify/functions/_semantic-interpreter';

const NOW=new Date('2026-09-26T18:00:00.000Z');

function turn(overrides:Partial<SemanticTurn>):SemanticTurn {
  return {
    semanticSource:'openai_supervisor',
    domain:'activity',
    intent:'holdout_unseen_intent_label',
    action:'ask',
    entities:{},
    references:[],
    constraints:[],
    confidence:0.93,
    needsClarification:false,
    ...overrides,
  };
}

function activeA():TaskStateContainer {
  return {
    ...emptyTaskStateContainer(),
    activeTask:createActiveTask({
      type:'activity_booking',
      sourceChannel:'line',
      now:NOW,
      initialSlots:{ resourceCode:'activity-horse', horseName:'ภาราดร', date:'2026-10-02' },
      requiredFields:['durationMinutes'],
    }),
  };
}

test('Phase 2 frozen holdout: A survives two side topics and exact A resumes', () => {
  const context=emptyConversationContextState(NOW);
  const original=activeA();
  const taskId=original.activeTask!.taskId;

  const b=planDialogTurn({
    semanticTurn:turn({ domain:'stay', action:'discover', informationNeed:'catalog' }),
    conversationContext:context, taskState:original, channel:'line', eventId:'hidden-b',
  }, NOW).taskStateContainer;
  assert.equal(b.activeTask, null);
  assert.equal(b.suspendedTask?.taskId, taskId);

  const c=planDialogTurn({
    semanticTurn:turn({ domain:'restaurant', action:'ask', informationNeed:'availability' }),
    conversationContext:context, taskState:b, channel:'line', eventId:'hidden-c',
  }, new Date(NOW.getTime()+1000)).taskStateContainer;
  assert.equal(c.activeTask, null);
  assert.equal(c.suspendedTask?.taskId, taskId);
  assert.deepEqual(c.suspendedTask?.slots, original.activeTask?.slots);

  const resumed=planDialogTurn({
    semanticTurn:turn({ domain:'activity', action:'ask', taskDirective:'resume_suspended' }),
    conversationContext:context, taskState:c, channel:'web', eventId:'hidden-resume-a',
  }, new Date(NOW.getTime()+2000)).taskStateContainer;
  assert.equal(resumed.activeTask?.taskId, taskId);
  assert.equal(resumed.suspendedTask, null);
});

test('Phase 2 frozen holdout: current unrelated meaning outranks stale restaurant constraints', () => {
  let stale=startNewActiveTask(emptyTaskStateContainer(), {
    type:'restaurant_preorder',
    sourceChannel:'web',
    now:NOW,
    initialSlots:{ menuItem:'ตำไทย' },
  }, NOW);
  stale=applyTaskStateEvent(stale, {
    kind:'add_constraint', eventId:'hidden-old-diet', constraint:'no_pork',
  }, NOW);

  const planned=planDialogTurn({
    semanticTurn:turn({
      domain:'stay',
      action:'ask',
      informationNeed:'availability',
      entities:{ checkIn:'2026-10-10' },
      constraints:[],
    }),
    conversationContext:emptyConversationContextState(NOW),
    taskState:stale,
    channel:'web',
    eventId:'hidden-current-stay',
  }, new Date(NOW.getTime()+1000));

  assert.equal(planned.taskStateContainer.activeTask, null);
  assert.equal(planned.taskStateContainer.suspendedTask?.type, 'restaurant_preorder');
  assert.equal(planned.taskStateContainer.suspendedTask?.constraints[0], 'no_pork');
  assert.equal(planned.taskStateContainer.suspendedTask?.slots.checkIn, undefined);
  assert.ok(planned.knowledgeRequests.every(request => request.domain === 'stay'));
});

test('Phase 2 frozen holdout: ambiguous correction cannot replace the selected entity', () => {
  const context={
    ...emptyConversationContextState(NOW),
    recentEntities:[
      { id:'activity_asset:horse:thongthai', type:'horse', name:'ทองไทย', domain:'activity' as const, canonical:true, observedAt:NOW.toISOString() },
      { id:'activity_asset:horse:paradon', type:'horse', name:'ภาราดร', domain:'activity' as const, canonical:true, observedAt:NOW.toISOString() },
    ],
  };
  const original=activeA();
  const planned=planDialogTurn({
    semanticTurn:turn({
      action:'correct_previous',
      speechAct:'correction',
      references:[{ type:'entity', value:'the other one', refersToPriorContext:true, ambiguous:true }],
      needsClarification:true,
    }),
    conversationContext:context,
    taskState:original,
    channel:'line',
    eventId:'hidden-ambiguous-correction',
  }, NOW);

  assert.equal(planned.mode, 'clarify');
  assert.deepEqual(planned.taskStateContainer, original);
});

test('Phase 2 frozen holdout: bounded third task evicts oldest as superseded, never cancelled', () => {
  let state=activeA();
  const firstId=state.activeTask!.taskId;
  state=applyTaskStateEvent(state,{kind:'suspend',eventId:'hidden-suspend-a'},NOW);
  state=startNewActiveTask(state,{type:'stay_booking',sourceChannel:'web',now:new Date(NOW.getTime()+1)},new Date(NOW.getTime()+1));
  const secondId=state.activeTask!.taskId;
  state=applyTaskStateEvent(state,{kind:'suspend',eventId:'hidden-suspend-b'},new Date(NOW.getTime()+2));

  assert.equal(state.suspendedTask?.taskId, secondId);
  assert.equal(state.lastSupersededTask?.taskId, firstId);
  assert.equal(state.lastSupersededTask?.status, 'superseded');
  assert.notEqual(state.lastSupersededTask?.status, 'cancelled');
});
