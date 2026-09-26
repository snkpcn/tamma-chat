// FROZEN after Phase 4 implementation stabilized. Do not use these cases for tuning.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planDialogTurn, resolveDialogDecision } from '../netlify/functions/_dialog-manager';
import { emptyConversationContextState } from '../netlify/functions/_conversation-context';
import { emptyTaskStateContainer, type TaskStateContainer } from '../netlify/functions/_task-state';
import type { KnowledgeBundle } from '../netlify/functions/_knowledge-resolver';
import type { SemanticTurn } from '../netlify/functions/_semantic-interpreter';

const NOW=new Date('2026-09-27T00:15:00+07:00');
function semantic(overrides:Partial<SemanticTurn>):SemanticTurn {
  return {
    semanticSource:'openai_supervisor',domain:'activity',intent:'phase4_frozen',
    action:'ask',entities:{},references:[],constraints:[],confidence:0.97,
    needsClarification:false,...overrides,
  };
}
function plan(turn:SemanticTurn,state:TaskStateContainer=emptyTaskStateContainer(),eventId='p4-holdout') {
  return planDialogTurn({
    semanticTurn:turn,conversationContext:emptyConversationContextState(NOW),
    taskState:state,channel:'line',eventId,
  },NOW);
}
function availability(key:string,status:'ok'|'unavailable'='ok'):KnowledgeBundle {
  return {
    domain:'activity',
    sources:[status==='ok'
      ? {need:'availability',sourceId:'live_schedule',sourceType:'activity_live',status:'ok'}
      : {need:'availability',sourceId:'live_schedule',sourceType:'activity_live',status:'unavailable',reason:'source_unavailable'}],
    facts:status==='ok'?[{
      key,value:true,domain:'activity',sourceId:'live_schedule',sourceType:'activity_live',
      authoritative:true,fetchedAt:NOW.toISOString(),
    }]:[],
    entities:[],missing:status==='ok'?[]:['availability'],
    warnings:status==='ok'?[]:['source_unavailable:availability:timeout'],freshness:'live',
  };
}

test('Phase 4 frozen holdout: a chosen item plus a read-only question never becomes a booking proposal',()=>{
  const selected=plan(semantic({
    action:'confirm',speechAct:'selection',
    entities:{resourceCode:'activity-trail',horseName:'ทองไทย'},
  }),emptyTaskStateContainer(),'p4-h-selection');
  const asked=plan(semantic({
    action:'ask',speechAct:'question',informationNeed:'availability',entities:{date:'2026-10-04'},
  }),selected.taskStateContainer,'p4-h-question');
  assert.equal(asked.taskStateContainer.activeTask?.commitmentIntent,false);
  assert.equal(resolveDialogDecision(asked,[availability('availability:activity-trail:2026-10-04T10:00:00+07:00:available')]).actionProposal,undefined);
});

test('Phase 4 frozen holdout: provider outage blocks a previously explicit booking intent',()=>{
  const requested=plan(semantic({
    action:'book',speechAct:'transaction_request',
    entities:{resourceCode:'activity-trail',date:'2026-10-04'},
  }),emptyTaskStateContainer(),'p4-h-book');
  const filled=plan(semantic({
    action:'provide_information',entities:{durationMinutes:45,time:'10:00'},
  }),requested.taskStateContainer,'p4-h-fill');
  assert.equal(filled.customerCommitPresent,true);
  const decision=resolveDialogDecision(filled,[availability('', 'unavailable')]);
  assert.equal(decision.actionProposal,undefined);
  assert.ok(decision.reasons.includes('knowledge_unavailable'));
});

test('Phase 4 frozen holdout: cancelling conversational working state emits no transaction proposal',()=>{
  const selected=plan(semantic({
    action:'confirm',entities:{resourceCode:'activity-trail',date:'2026-10-04',durationMinutes:45},
  }),emptyTaskStateContainer(),'p4-h-cancel-start');
  const cancelled=plan(semantic({
    action:'cancel',taskDirective:'cancel_active',speechAct:'task_control',entities:{},
  }),selected.taskStateContainer,'p4-h-cancel');
  assert.equal(cancelled.taskStateContainer.activeTask?.status,'cancelled');
  assert.equal(resolveDialogDecision(cancelled,[]).actionProposal,undefined);
});

test('Phase 4 frozen holdout: exact live availability is resource/time scoped and proposal remains non-executing',()=>{
  const requested=plan(semantic({
    action:'book',speechAct:'transaction_request',
    entities:{resourceCode:'activity-trail',date:'2026-10-04',time:'10:00',durationMinutes:45},
  }),emptyTaskStateContainer(),'p4-h-exact');
  const wrong=resolveDialogDecision(requested,[availability('availability:activity-trail:2026-10-04T11:00:00+07:00:available')]);
  assert.equal(wrong.actionProposal,undefined);
  const exact=resolveDialogDecision(requested,[availability('availability:activity-trail:2026-10-04T10:00:00+07:00:available')]);
  assert.equal(exact.actionProposal?.toolName,'create_booking');
  assert.equal(exact.actionProposal?.requiresExplicitConfirmation,true);
});
