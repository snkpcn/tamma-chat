import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planDialogTurn } from '../netlify/functions/_dialog-manager';
import { emptyConversationContextState } from '../netlify/functions/_conversation-context';
import { createActiveTask, emptyTaskStateContainer, type TaskStateContainer } from '../netlify/functions/_task-state';
import type { SemanticTurn } from '../netlify/functions/_semantic-interpreter';
import type { BrainChannel } from '../netlify/functions/_thongthai-brain-v3';
import { deriveDeterministicSemanticTurn } from '../netlify/functions/_deterministic-semantic-turn';

const NOW=new Date('2026-09-27T01:00:00+07:00');

function semantic(overrides:Partial<SemanticTurn>):SemanticTurn {
  return {
    semanticSource:'openai_supervisor',domain:'activity',intent:'phase5_parity',
    action:'ask',entities:{},references:[],constraints:[],confidence:0.97,
    needsClarification:false,...overrides,
  };
}

test('Phase 5 acceptance: LINE private text has no booking, membership, or payment semantic bypass before the shared core',()=>{
  const lineCore=readFileSync('netlify/functions/_line-webhook-core.ts','utf8');
  const lineOuter=readFileSync('netlify/functions/line-webhook.ts','utf8');
  assert.match(lineCore,/processThongthaiChatCore\(/);
  assert.doesNotMatch(lineCore,/handleLine(?:Booking|Membership)Message/);
  assert.doesNotMatch(lineOuter,/handleCustomerPaymentText/);
  assert.match(lineOuter,/handleCustomerPaymentSlip/,'non-text media adapter remains channel presentation/input plumbing');
});

function seeded(channel:BrainChannel):TaskStateContainer {
  return {
    ...emptyTaskStateContainer(),
    activeTask:createActiveTask({
      type:'activity_booking',sourceChannel:channel,now:NOW,
      initialSlots:{resourceCode:'activity-horse',horseName:'ภาราดร',date:'2026-10-05'},
      requiredFields:['durationMinutes'],
    }),
  };
}
function project(state:TaskStateContainer) {
  const task=state.activeTask;
  const suspended=state.suspendedTask;
  const p=(value:typeof task)=>value?{
    type:value.type,status:value.status,slots:value.slots,
    missingFields:value.missingFields,commitmentIntent:value.commitmentIntent,
  }:null;
  return {activeTask:p(task),suspendedTask:p(suspended)};
}
function runInterruptResume(channel:BrainChannel) {
  const context=emptyConversationContextState(NOW);
  const side=planDialogTurn({
    semanticTurn:semantic({domain:'restaurant',intent:'browse_menu',action:'discover',informationNeed:'catalog'}),
    conversationContext:context,taskState:seeded(channel),channel,eventId:`${channel}-side`,
  },NOW);
  const resume=planDialogTurn({
    semanticTurn:semantic({domain:'activity',intent:'resume_activity',action:'ask',taskDirective:'resume_suspended'}),
    conversationContext:context,taskState:side.taskStateContainer,channel,eventId:`${channel}-resume`,
  },new Date(NOW.getTime()+1000));
  return {side,resume};
}

test('Phase 5 acceptance: web and LINE suspend a side topic and restore the exact same business task',()=>{
  const web=runInterruptResume('web');
  const line=runInterruptResume('line');
  assert.deepEqual(project(web.side.taskStateContainer),project(line.side.taskStateContainer));
  assert.deepEqual(project(web.resume.taskStateContainer),project(line.resume.taskStateContainer));
  assert.equal(web.side.taskStateContainer.activeTask,null);
  assert.equal(web.resume.taskStateContainer.activeTask?.slots.horseName,'ภาราดร');
  assert.deepEqual(web.resume.taskStateContainer.activeTask?.missingFields,['durationMinutes']);
});

test('Phase 5 acceptance: incident, local, and general meaning produce channel-independent decisions',()=>{
  for(const domain of ['incident','local','general'] as const) {
    const results=(['web','line'] as const).map(channel=>planDialogTurn({
      semanticTurn:semantic({domain,action:'ask',speechAct:domain==='incident'?'incident_report':'question'}),
      conversationContext:emptyConversationContextState(NOW),taskState:emptyTaskStateContainer(),
      channel,eventId:`${channel}-${domain}`,
    },NOW));
    assert.equal(results[0].mode,results[1].mode,domain);
    assert.deepEqual(results[0].knowledgeRequests,results[1].knowledgeRequests,domain);
    assert.deepEqual(results[0].reasons,results[1].reasons,domain);
  }
});


test('Phase 5 acceptance: explicit activity commitment cannot be downgraded to channel catalog browsing',()=>{
  const interpreted=deriveDeterministicSemanticTurn(
    'ขอจองกิจกรรม ATV',
    {activeDomain:null,activeTopic:null,recentEntities:[],recentConstraints:[],recentTurns:[]},
    emptyTaskStateContainer(),
    NOW,
  );
  assert.equal(interpreted?.domain,'activity');
  assert.equal(interpreted?.action,'book');
  assert.equal(interpreted?.speechAct,'transaction_request');
  assert.equal(interpreted?.entities.resourceCode,'activity-atv');

  const question=deriveDeterministicSemanticTurn(
    'ATV จองได้ไหม',
    {activeDomain:null,activeTopic:null,recentEntities:[],recentConstraints:[],recentTurns:[]},
    emptyTaskStateContainer(),NOW,
  );
  assert.notEqual(question?.action,'book','a booking question is not transaction commitment');
});
