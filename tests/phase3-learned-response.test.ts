import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { composeDeterministicResponse } from '../netlify/functions/_response-composer';
import {
  isTrustedLearnedSemanticContinuation,
  readOnlyCutoverEligibility,
} from '../netlify/functions/_thongthai-one-mind-response';
import { emptyTaskStateContainer } from '../netlify/functions/_task-state';

function inputFor(overrides:any){
  return {
    channel:'web',
    language:'th',
    userMessage:'test',
    semanticTurn:{
      semanticSource:'semantic_concept_memory',
      domain:'general',
      intent:'semantic_concept_match',
      action:'provide_information',
      speechAct:'preference_update',
      informationNeed:'none',
      entities:{},
      references:[],
      constraints:[],
      confidence:0.7,
      needsClarification:false,
      ...overrides,
    },
    dialogDecision:{
      mode:'answer',
      responseIntent:'discovery_response',
      reasons:['nontransactional_state_update_preserved'],
      missingFields:[],
      actionProposal:undefined,
      taskStateContainer:emptyTaskStateContainer(),
    },
    knowledgeBundles:[],
    degradation:{condition:'none',level:'normal',reasonCodes:[],retryable:false},
    operationalOutcome:null,
  } as any;
}

test('Phase 3 learned relaxed pace gets a human zero-call acknowledgement',()=>{
  const response=composeDeterministicResponse(inputFor({
    entities:{pace:'relaxed'},
  }));
  assert.equal(response.mode,'deterministic');
  assert.match(response.message,/รับทราบ/u);
  assert.match(response.message,/สบาย|ใช้แรงไม่มาก/u);
  assert.doesNotMatch(response.message,/ตอบเรื่องนี้ให้แม่นไม่ได้|ลองอีกครั้ง/u);
});

test('Phase 3 learned companion gets a bounded human acknowledgement',()=>{
  const response=composeDeterministicResponse(inputFor({
    entities:{companion:'partner'},
  }));
  assert.equal(response.mode,'deterministic');
  assert.match(response.message,/คนรัก/u);
  assert.doesNotMatch(response.message,/จองสำเร็จ|ยืนยันการจองแล้ว/u);
});

test('Phase 3 learned consider-only explicitly preserves no-transaction state',()=>{
  const response=composeDeterministicResponse(inputFor({
    action:'confirm',
    speechAct:'selection',
    constraints:['consider_only','no_transaction'],
  }));
  assert.equal(response.mode,'deterministic');
  assert.match(response.message,/พิจารณา/u);
  assert.match(response.message,/ยังไม่ได้จอง|ยังไม่ได้.*รายการ/u);
  assert.doesNotMatch(response.message,/จองสำเร็จ|ยืนยันการจองแล้ว/u);
});

test('One-Mind production response path fast-paths semantic_concept_memory without another model call',()=>{
  const source=readFileSync(
    new URL('../netlify/functions/_thongthai-one-mind-response.ts',import.meta.url),
    'utf8',
  );
  assert.match(source,/const learnedSemanticStateUpdate/u);
  assert.match(source,/semanticSource === 'semantic_concept_memory'/u);
  assert.match(source,/\|\| learnedSemanticStateUpdate/u);
});


function learnedTurn(overrides:any={}){
  const semantic={
    semanticSource:'semantic_concept_memory',
    domain:'general',
    intent:'semantic_concept_match',
    action:'provide_information',
    speechAct:'preference_update',
    informationNeed:'none',
    entities:{pace:'relaxed'},
    references:[],
    constraints:[],
    confidence:0.7,
    needsClarification:false,
    ...overrides,
  };
  return {
    semanticTurn:semantic,
    dialogSemanticTurn:semantic,
    dialogDecision:{
      mode:'answer',
      responseIntent:'discovery_response',
      reasons:['nontransactional_state_update_preserved'],
      missingFields:[],
      actionProposal:undefined,
      taskStateContainer:emptyTaskStateContainer(),
    },
    taskStateBefore:emptyTaskStateContainer(),
    taskStateAfter:emptyTaskStateContainer(),
    groundedKnowledge:[],
  } as any;
}

test('requireSemanticSupervisor admits only trusted non-transactional learned semantics',()=>{
  const pace=learnedTurn();
  assert.equal(isTrustedLearnedSemanticContinuation(pace),true);
  assert.deepEqual(
    readOnlyCutoverEligibility(pace,{requireSemanticSupervisor:true,message:'ไม่อยากเหนื่อยมากครับ'}),
    {eligible:true},
  );

  const consider=learnedTurn({
    action:'confirm',
    speechAct:'selection',
    entities:{},
    constraints:['consider_only','no_transaction'],
    references:[{
      type:'entity_selection',
      value:'ภาราดร',
      refersToPriorContext:true,
      resolvedEntityId:'activity_asset:horse-pharadon',
    }],
    domain:'activity',
  });
  assert.equal(isTrustedLearnedSemanticContinuation(consider),true);
  assert.deepEqual(
    readOnlyCutoverEligibility(consider,{requireSemanticSupervisor:true,message:'เอาอันนี้ไว้ก่อน'}),
    {eligible:true},
  );
});

test('learned semantic source can never use the bypass for mutating action or unresolved consider-only',()=>{
  const malicious=learnedTurn({
    action:'book',
    speechAct:'transaction_request',
  });
  assert.equal(isTrustedLearnedSemanticContinuation(malicious),false);
  assert.deepEqual(
    readOnlyCutoverEligibility(malicious,{requireSemanticSupervisor:true,message:'จองเลย'}),
    {eligible:false,reason:'transactional_or_task_turn'},
  );

  const unresolved=learnedTurn({
    action:'confirm',
    speechAct:'selection',
    entities:{},
    constraints:['consider_only','no_transaction'],
    references:[],
    domain:'activity',
  });
  assert.equal(isTrustedLearnedSemanticContinuation(unresolved),false);
});
