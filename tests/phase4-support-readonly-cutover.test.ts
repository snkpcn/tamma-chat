import test from 'node:test';
import assert from 'node:assert/strict';

import { readOnlyCutoverEligibility } from '../netlify/functions/_thongthai-one-mind-response';
import { emptyTaskStateContainer } from '../netlify/functions/_task-state';

function supportTurn(overrides:any={}){
  const semantic={
    semanticSource:'openai_supervisor',
    domain:'support',
    intent:'ask_booking_confirmation_process',
    action:'ask',
    speechAct:'question',
    informationNeed:'none',
    entities:{},
    references:[],
    constraints:[],
    confidence:0.98,
    needsClarification:false,
    ...overrides,
  };
  return {
    semanticTurn:semantic,
    dialogSemanticTurn:semantic,
    dialogDecision:{
      mode:'answer',
      responseIntent:'discovery_response',
      reasons:[],
      missingFields:[],
      actionProposal:undefined,
      taskStateContainer:emptyTaskStateContainer(),
    },
    taskStateBefore:emptyTaskStateContainer(),
    taskStateAfter:emptyTaskStateContainer(),
    groundedKnowledge:[],
  } as any;
}

test('Phase 4 support commercial process question is safe read-only cutover',()=>{
  const turn=supportTurn();
  assert.deepEqual(
    readOnlyCutoverEligibility(turn,{
      requireSemanticSupervisor:true,
      message:'ยืนยันการจองต้องทำยังไงครับ',
    }),
    {eligible:true},
  );
});

test('Phase 4 support request-help remains outside the read-only support exception',()=>{
  const turn=supportTurn({
    intent:'need_human_help',
    speechAct:'request_help',
  });
  assert.deepEqual(
    readOnlyCutoverEligibility(turn,{
      requireSemanticSupervisor:true,
      message:'ช่วยด้วยครับ ผมมีปัญหากับการจอง',
    }),
    {eligible:false,reason:'domain_not_cut_over'},
  );
});

test('Phase 4 support transaction request cannot cross read-only cutover',()=>{
  const turn=supportTurn({
    intent:'book_service',
    action:'book',
    speechAct:'transaction_request',
  });
  assert.deepEqual(
    readOnlyCutoverEligibility(turn,{
      requireSemanticSupervisor:true,
      message:'จองให้เลยครับ',
    }),
    {eligible:false,reason:'domain_not_cut_over'},
  );
});

test('Phase 4 support status question remains read-only and eligible',()=>{
  const turn=supportTurn({
    intent:'ask_ordering_process',
    action:'status',
    speechAct:'question',
  });
  assert.deepEqual(
    readOnlyCutoverEligibility(turn,{
      requireSemanticSupervisor:true,
      message:'ถ้าจะสั่งอาหารต้องทำยังไงครับ',
    }),
    {eligible:true},
  );
});
