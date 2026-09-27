import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  processThongthaiOneMindTurnAuthoritative,
  type OneMindDependencies,
  type OneMindTurnResult,
} from '../netlify/functions/_thongthai-one-mind-orchestrator';
import type { GuestAgentStateSnapshot } from '../netlify/functions/_guest-agent-state-store';
import type { KnowledgeSourceAdapters, SourceResult } from '../netlify/functions/_knowledge-resolver';
import type { SemanticTurn } from '../netlify/functions/_semantic-interpreter';

// FROZEN PHASE 6 HOLDOUT.
// These conversations were added only after the implementation and public
// acceptance suite were green. Do not use their utterances as implementation
// rules or rewrite their expected behavior to fit a regression.
const NOW=new Date('2026-09-27T03:00:00+07:00');
const CANON='33333333-3333-4333-8333-333333333333';
const GUEST='44444444-4444-4444-8444-444444444444';

function turn(overrides:Partial<SemanticTurn>):SemanticTurn {
  return {
    semanticSource:'openai_supervisor',domain:'general',intent:'phase6_hidden',
    action:'ask',entities:{},references:[],constraints:[],confidence:0.97,
    needsClarification:false,...overrides,
  };
}
function ok(sourceId:string,sourceType:SourceResult['sourceType'],data:Extract<SourceResult,{status:'ok'}>['data']):SourceResult {
  return {status:'ok',sourceId,sourceType,fetchedAt:NOW.toISOString(),data};
}
function fact(key:string,value:unknown,domain:'activity'|'stay'|'restaurant',sourceId:string,sourceType:'activity_live'|'stay_live'|'restaurant_live') {
  return {key,value,domain,sourceId,sourceType,authoritative:true,fetchedAt:NOW.toISOString()} as const;
}
function runner(channel:'web'|'line',meanings:Record<string,SemanticTurn>,adapters:KnowledgeSourceAdapters={}) {
  let snapshot:GuestAgentStateSnapshot={exists:false,state:{},updatedAt:null};
  let offset=0;
  const deps:Partial<OneMindDependencies>={
    resolveCanonicalGuestId:async()=>CANON,
    guestDbIdFromAnonymousId:async()=>GUEST,
    interpretSemanticTurn:async message=>{
      const semantic=meanings[message];
      if(!semantic) throw new Error('missing frozen semantic');
      return semantic;
    },
    buildKnowledgeAdapters:()=>adapters,
    mirrorActivityTaskToLegacySession:async()=>{},
  };
  return async(message:string):Promise<OneMindTurnResult>=>{
    offset+=1;
    return processThongthaiOneMindTurnAuthoritative({
      channel,message,eventId:`phase6-hidden-${channel}-${offset}`,providerUserKey:`hidden-${channel}`,persistState:true,
    },deps,{
      loadSnapshot:async()=>snapshot,
      compareAndSwap:async(_id,current,patch)=>{
        const state={...current.state,...(patch.set??{})};
        for(const key of patch.removeKeys??[]) delete state[key];
        snapshot={exists:true,state,updatedAt:new Date(NOW.getTime()+offset*1000).toISOString()};
        return {status:'applied',snapshot};
      },
    },new Date(NOW.getTime()+offset*1000));
  };
}

test('Phase 6 frozen holdout 1: activity survives two side topics and resumes exact selection before explicit booking',async()=>{
  const meanings={
    'เลือกทองไทยไว้ก่อน':turn({domain:'activity',intent:'choose_horse',action:'confirm',speechAct:'selection',entities:{resourceCode:'activity-horse',horseName:'ทองไทย'}}),
    'บ้านพักมีแบบไหนบ้าง':turn({domain:'stay',intent:'browse_stays',action:'discover',informationNeed:'catalog',speechAct:'question'}),
    'แถวฟาร์มมีหมาจรไหม':turn({domain:'local',intent:'ask_animals',action:'ask',speechAct:'question'}),
    'ย้อนกลับไปเรื่องม้าอันเดิม':turn({domain:'activity',intent:'resume_horse',action:'ask',speechAct:'request',taskDirective:'resume_suspended'}),
    'วันที่หกตุลา สี่สิบห้านาที':turn({domain:'activity',intent:'schedule_horse',action:'provide_information',entities:{date:'2026-10-06',durationMinutes:45}}),
    'จองเลย สิบโมง สองคน':turn({domain:'activity',intent:'commit_horse',action:'book',speechAct:'transaction_request',entities:{time:'10:00',partySize:2}}),
  };
  const adapters:KnowledgeSourceAdapters={
    activity:{
      catalog:async()=>ok('activity_catalog','activity_live',[
        fact('activity:horse:resourceCode','activity-horse','activity','activity_catalog','activity_live'),
        fact('activity:horse:45min:price',450,'activity','activity_catalog','activity_live'),
      ]),
      availability:async()=>ok('activity_schedule','activity_live',[
        fact('availability:activity-horse:2026-10-06T10:00:00+07:00:available',true,'activity','activity_schedule','activity_live'),
      ]),
    },
    stay:{catalog:async()=>({status:'empty',sourceId:'stay_catalog',sourceType:'stay_live',fetchedAt:NOW.toISOString()})},
  };
  const run=runner('line',meanings,adapters);
  await run('เลือกทองไทยไว้ก่อน');
  const side1=await run('บ้านพักมีแบบไหนบ้าง');
  const side2=await run('แถวฟาร์มมีหมาจรไหม');
  const resumed=await run('ย้อนกลับไปเรื่องม้าอันเดิม');
  await run('วันที่หกตุลา สี่สิบห้านาที');
  const committed=await run('จองเลย สิบโมง สองคน');
  assert.equal(side1.taskStateAfter.suspendedTask?.slots.horseName,'ทองไทย');
  assert.equal(side2.taskStateAfter.suspendedTask?.slots.horseName,'ทองไทย');
  assert.equal(resumed.taskStateAfter.activeTask?.slots.horseName,'ทองไทย');
  assert.equal(committed.dialogDecision.actionProposal?.toolName,'create_booking');
  assert.equal(committed.dialogDecision.actionProposal?.validatedArgs.horseName,'ทองไทย');
  assert.equal(committed.dialogDecision.actionProposal?.requiresExplicitConfirmation,true);
});

test('Phase 6 frozen holdout 2: stay question, selection, correction and negation do not propose until later explicit commitment',async()=>{
  const meanings={
    'บ้านริมน้ำว่างวันที่ยี่สิบเก้าไหม':turn({domain:'stay',intent:'stay_availability',action:'status',informationNeed:'availability',speechAct:'question',entities:{date:'2026-09-29'}}),
    'เลือกบ้านริมน้ำไว้ สามคน':turn({domain:'stay',intent:'select_stay',action:'confirm',speechAct:'selection',entities:{resourceCode:'stay:river-house',date:'2026-09-29',partySize:3}}),
    'แก้เป็นสี่คน':turn({domain:'stay',intent:'correct_party',action:'correct_previous',speechAct:'correction',entities:{partySize:4}}),
    'ยังไม่ได้จะจองนะ':turn({domain:'stay',intent:'not_booking',action:'correct_previous',speechAct:'correction',entities:{}}),
    'ตกลงจองหลังนี้':turn({domain:'stay',intent:'commit_stay',action:'book',speechAct:'transaction_request',entities:{}}),
  };
  const adapters:KnowledgeSourceAdapters={
    stay:{
      availability:async()=>ok('stay_schedule','stay_live',[
        fact('availability:stay:river-house:2026-09-29T12:00:00+07:00:available',true,'stay','stay_schedule','stay_live'),
      ]),
    },
  };
  const run=runner('web',meanings,adapters);
  const asked=await run('บ้านริมน้ำว่างวันที่ยี่สิบเก้าไหม');
  const selected=await run('เลือกบ้านริมน้ำไว้ สามคน');
  const corrected=await run('แก้เป็นสี่คน');
  const negated=await run('ยังไม่ได้จะจองนะ');
  const committed=await run('ตกลงจองหลังนี้');
  assert.equal(asked.taskStateAfter.activeTask,null);
  assert.equal(selected.dialogDecision.actionProposal,undefined);
  assert.equal(corrected.taskStateAfter.activeTask?.slots.partySize,4);
  assert.equal(negated.dialogDecision.actionProposal,undefined);
  assert.equal(committed.dialogDecision.actionProposal?.toolName,'create_booking');
  assert.equal(committed.dialogDecision.actionProposal?.validatedArgs.partySize,4);
});

test('Phase 6 frozen holdout 3: open-world typo, incident and local questions remain bounded non-transactional conversation',async()=>{
  const meanings={
    'ของหายอะ น่าจะลืมหมวก':turn({domain:'incident',intent:'lost_item',action:'ask',speechAct:'incident_report'}),
    'แถวนี้มีงูบ่อยป่าว':turn({domain:'local',intent:'local_animals',action:'ask',speechAct:'question'}),
    'ทำไมพระจันมีข้างขึ้นข้างแรม':turn({domain:'general',intent:'general_question',action:'ask',speechAct:'question'}),
  };
  const run=runner('line',meanings);
  for(const message of Object.keys(meanings)) {
    const result=await run(message);
    assert.equal(result.taskStateAfter.activeTask,null);
    assert.equal(result.taskStateAfter.suspendedTask,null);
    assert.equal(result.dialogDecision.actionProposal,undefined);
  }
});
