import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planDialogTurn,
  resolveDialogDecision,
  type DialogPlan,
} from '../netlify/functions/_dialog-manager';
import { emptyConversationContextState } from '../netlify/functions/_conversation-context';
import { emptyTaskStateContainer, type TaskStateContainer } from '../netlify/functions/_task-state';
import type { KnowledgeBundle } from '../netlify/functions/_knowledge-resolver';
import type { SemanticTurn } from '../netlify/functions/_semantic-interpreter';

const NOW=new Date('2026-09-26T21:00:00.000Z');
function turn(overrides:Partial<SemanticTurn>):SemanticTurn {
  return {
    semanticSource:'openai_supervisor',
    domain:'activity',
    intent:'phase4_acceptance',
    action:'ask',
    entities:{},
    references:[],
    constraints:[],
    confidence:0.96,
    needsClarification:false,
    ...overrides,
  };
}
function plan(semanticTurn:SemanticTurn,taskState:TaskStateContainer=emptyTaskStateContainer(),eventId='phase4'):DialogPlan {
  return planDialogTurn({
    semanticTurn,
    conversationContext:emptyConversationContextState(NOW),
    taskState,
    channel:'web',
    eventId,
  },NOW);
}
function available():KnowledgeBundle {
  return {
    domain:'activity',
    sources:[{need:'availability',sourceId:'schedule',sourceType:'activity_live',status:'ok'}],
    facts:[{key:'availability:activity-horse:2026-10-02T15:00:00+07:00:available',value:true,domain:'activity',sourceId:'schedule',sourceType:'activity_live',authoritative:true,fetchedAt:NOW.toISOString()}],
    entities:[],missing:[],warnings:[],freshness:'live',
  };
}

test('Phase 4 acceptance: browsing/status/recommendation cannot create a transaction task', () => {
  for (const action of ['discover','status','recommend'] as const) {
    const p=plan(turn({action,informationNeed:action==='status'?'availability':'catalog'}),emptyTaskStateContainer(),`phase4-read-${action}`);
    assert.equal(p.taskStateContainer.activeTask,null);
    assert.equal(resolveDialogDecision(p,[]).actionProposal,undefined);
  }
});

test('Phase 4 acceptance: preference-only update cannot create a preorder/order task', () => {
  const p=plan(turn({
    domain:'restaurant',
    action:'provide_information',
    speechAct:'preference_update',
    constraints:['no_pork'],
  }));
  assert.equal(p.taskStateContainer.activeTask,null);
  assert.equal(resolveDialogDecision(p,[]).actionProposal,undefined);
});

test('Phase 4 acceptance: selection may create working state but can never execute/propose booking', () => {
  const p=plan(turn({
    action:'confirm',
    speechAct:'selection',
    entities:{resourceCode:'activity-horse',horseName:'ภาราดร'},
  }));
  assert.equal(p.taskStateContainer.activeTask?.type,'activity_booking');
  assert.equal(p.customerCommitPresent,false);
  assert.equal(resolveDialogDecision(p,[]).actionProposal,undefined);
});

test('Phase 4 acceptance: explicit booking intent survives missing-slot collection', () => {
  const started=plan(turn({
    action:'book',
    speechAct:'transaction_request',
    entities:{resourceCode:'activity-horse',date:'2026-10-02'},
  }),emptyTaskStateContainer(),'phase4-book-start');
  assert.deepEqual(started.missingFields,['durationMinutes']);
  assert.equal(started.customerCommitPresent,true);
  assert.equal(started.taskStateContainer.activeTask?.commitmentIntent,true);

  const filled=plan(turn({
    action:'provide_information',
    entities:{durationMinutes:60},
  }),started.taskStateContainer,'phase4-book-fill');
  assert.equal(filled.customerCommitPresent,true,
    'the explicit transaction request must survive while required slots are collected');
  assert.deepEqual(filled.missingFields,[]);

  const decision=resolveDialogDecision(filled,[available()]);
  assert.equal(decision.actionProposal?.toolName,'create_booking');
  assert.equal(decision.actionProposal?.requiresExplicitConfirmation,true,
    'proposal and execution confirmation must remain separate');
});

test('Phase 4 acceptance: correction changes only the named slot', () => {
  const started=plan(turn({
    action:'confirm',
    entities:{resourceCode:'activity-horse',date:'2026-10-02',durationMinutes:60,partySize:2},
  }),emptyTaskStateContainer(),'phase4-correct-start');
  const corrected=plan(turn({
    action:'correct_previous',
    speechAct:'correction',
    entities:{date:'2026-10-03'},
  }),started.taskStateContainer,'phase4-correct-date');

  assert.equal(corrected.taskStateContainer.activeTask?.slots.date,'2026-10-03');
  assert.equal(corrected.taskStateContainer.activeTask?.slots.resourceCode,'activity-horse');
  assert.equal(corrected.taskStateContainer.activeTask?.slots.durationMinutes,60);
  assert.equal(corrected.taskStateContainer.activeTask?.slots.partySize,2);
});

test('Phase 4 acceptance: duplicate final event remains one idempotent proposal identity', () => {
  const started=plan(turn({
    action:'book',
    entities:{resourceCode:'activity-horse',date:'2026-10-02'},
  }),emptyTaskStateContainer(),'phase4-dup-start');
  const fillTurn=turn({action:'provide_information',entities:{durationMinutes:60}});
  const first=plan(fillTurn,started.taskStateContainer,'phase4-dup-final');
  const replay=plan(fillTurn,first.taskStateContainer,'phase4-dup-final');
  const d1=resolveDialogDecision(first,[available()]);
  const d2=resolveDialogDecision(replay,[available()]);
  assert.deepEqual(replay.taskStateContainer,first.taskStateContainer);
  assert.equal(d1.actionProposal?.idempotencyKey,d2.actionProposal?.idempotencyKey);
  assert.equal(d1.actionProposal?.requiresExplicitConfirmation,true);
  assert.equal(d2.actionProposal?.requiresExplicitConfirmation,true);
});


test('Phase 4 acceptance: availability must match the selected resource and requested time', () => {
  const p=plan(turn({
    action:'book',
    entities:{
      resourceCode:'activity-horse',
      date:'2026-10-02',
      time:'15:00',
      durationMinutes:60,
    },
  }),emptyTaskStateContainer(),'phase4-exact-availability');

  const wrongResource:KnowledgeBundle={
    ...available(),
    facts:[{key:'availability:activity-atv:2026-10-02T15:00:00+07:00:available',value:true,domain:'activity',sourceId:'schedule',sourceType:'activity_live',authoritative:true,fetchedAt:NOW.toISOString()}],
  };
  const wrongTime:KnowledgeBundle={
    ...available(),
    facts:[{key:'availability:activity-horse:2026-10-02T16:00:00+07:00:available',value:true,domain:'activity',sourceId:'schedule',sourceType:'activity_live',authoritative:true,fetchedAt:NOW.toISOString()}],
  };
  assert.equal(resolveDialogDecision(p,[wrongResource]).actionProposal,undefined);
  assert.equal(resolveDialogDecision(p,[wrongTime]).actionProposal,undefined);
  assert.equal(resolveDialogDecision(p,[available()]).actionProposal?.toolName,'create_booking');
});
