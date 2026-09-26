// FROZEN after Phase 5 channel implementation stabilized. Do not tune against these cases.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planDialogTurn, resolveDialogDecision } from '../netlify/functions/_dialog-manager';
import { emptyConversationContextState } from '../netlify/functions/_conversation-context';
import { createActiveTask, emptyTaskStateContainer, type TaskStateContainer } from '../netlify/functions/_task-state';
import type { BrainChannel } from '../netlify/functions/_thongthai-brain-v3';
import type { KnowledgeBundle } from '../netlify/functions/_knowledge-resolver';
import type { SemanticTurn } from '../netlify/functions/_semantic-interpreter';

const NOW=new Date('2026-09-27T02:00:00+07:00');
function semantic(overrides:Partial<SemanticTurn>):SemanticTurn {
  return {
    semanticSource:'openai_supervisor',domain:'activity',intent:'phase5_frozen',
    action:'ask',entities:{},references:[],constraints:[],confidence:0.98,
    needsClarification:false,...overrides,
  };
}
function project(state:TaskStateContainer) {
  const p=(task:TaskStateContainer['activeTask'])=>task?{
    type:task.type,status:task.status,slots:task.slots,missingFields:task.missingFields,
    selectedEntities:task.selectedEntities,constraints:task.constraints,
    commitmentIntent:task.commitmentIntent,
  }:null;
  return {activeTask:p(state.activeTask),suspendedTask:p(state.suspendedTask)};
}
function seed(channel:BrainChannel):TaskStateContainer {
  return {
    ...emptyTaskStateContainer(),
    activeTask:createActiveTask({
      type:'activity_booking',sourceChannel:channel,now:NOW,
      initialSlots:{resourceCode:'activity-horse',horseName:'ทองไทย',date:'2026-10-06'},
      requiredFields:['durationMinutes'],
    }),
  };
}
function sequence(channel:BrainChannel) {
  const context=emptyConversationContextState(NOW);
  let state=seed(channel);
  const transitions:ReturnType<typeof project>[]=[];
  for(const [eventId,turn] of [
    ['side-b',semantic({domain:'restaurant',intent:'browse_menu',action:'discover',informationNeed:'catalog'})],
    ['side-c',semantic({domain:'local',intent:'ask_nearby',action:'ask'})],
    ['resume-a',semantic({domain:'activity',intent:'resume_prior_task',action:'ask',taskDirective:'resume_suspended'})],
  ] as const) {
    const plan=planDialogTurn({semanticTurn:turn,conversationContext:context,taskState:state,channel,eventId:`${channel}-${eventId}`},NOW);
    state=plan.taskStateContainer;
    transitions.push(project(state));
  }
  return transitions;
}

test('Phase 5 frozen holdout: A to side B to side C to resume A is channel-equivalent',()=>{
  const web=sequence('web');
  const line=sequence('line');
  assert.deepEqual(web,line);
  assert.equal(web[0]?.activeTask,null);
  assert.equal(web[0]?.suspendedTask?.slots.horseName,'ทองไทย');
  assert.equal(web[2]?.activeTask?.slots.horseName,'ทองไทย');
  assert.deepEqual(web[2]?.activeTask?.missingFields,['durationMinutes']);
});

function transaction(channel:BrainChannel) {
  const plan=planDialogTurn({
    semanticTurn:semantic({
      action:'book',speechAct:'transaction_request',
      entities:{resourceCode:'activity-horse',horseName:'ทองไทย',date:'2026-10-06',time:'11:00',durationMinutes:60,partySize:2},
    }),
    conversationContext:emptyConversationContextState(NOW),taskState:emptyTaskStateContainer(),
    channel,eventId:`${channel}-transaction`,
  },NOW);
  const bundle:KnowledgeBundle={
    domain:'activity',
    sources:[{need:'availability',sourceId:'live_schedule',sourceType:'activity_live',status:'ok'}],
    facts:[{key:'availability:activity-horse:2026-10-06T11:00:00+07:00:available',value:true,domain:'activity',sourceId:'live_schedule',sourceType:'activity_live',authoritative:true,fetchedAt:NOW.toISOString()}],
    entities:[],missing:[],warnings:[],freshness:'live',
  };
  return resolveDialogDecision(plan,[bundle]);
}

test('Phase 5 frozen holdout: equivalent committed turns produce identical transaction arguments',()=>{
  const web=transaction('web');
  const line=transaction('line');
  assert.equal(web.actionProposal?.toolName,'create_booking');
  assert.equal(line.actionProposal?.toolName,'create_booking');
  assert.deepEqual(web.actionProposal?.validatedArgs,line.actionProposal?.validatedArgs);
  assert.equal(web.actionProposal?.requiresExplicitConfirmation,true);
  assert.equal(line.actionProposal?.requiresExplicitConfirmation,true);
});

test('Phase 5 frozen holdout: current constraints and selection remain equivalent by channel',()=>{
  for(const channel of ['web','line'] as const) {
    const context=emptyConversationContextState(NOW);
    const selected=planDialogTurn({
      semanticTurn:semantic({
        action:'confirm',speechAct:'selection',
        entities:{resourceCode:'activity-horse',horseName:'ภาราดร'},
        constraints:['beginner'],
      }),
      conversationContext:context,taskState:emptyTaskStateContainer(),
      channel,eventId:`${channel}-select`,
    },NOW);
    assert.equal(selected.taskStateContainer.activeTask?.slots.horseName,'ภาราดร');
    assert.deepEqual(selected.taskStateContainer.activeTask?.constraints,['beginner']);
    assert.equal(selected.customerCommitPresent,false);
  }
});
