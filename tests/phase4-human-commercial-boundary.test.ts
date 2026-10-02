import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  classifyCommercialBoundarySemantic,
  classifyCommercialBoundaryText,
  semanticMayAuthorizeCommercialCommit,
} from '../netlify/functions/_commercial-intent-boundary';
import { isAgentTransactionPrepareIntent } from '../netlify/functions/thongthai-chat';
import type { SemanticTurn } from '../netlify/functions/_semantic-interpreter';

function semantic(overrides:Partial<SemanticTurn>):SemanticTurn{
  return {
    semanticSource:'openai_supervisor',
    domain:'activity',
    intent:'phase4_test',
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
}

test('Phase 4 raw commercial boundary separates questions from current-turn consent',()=>{
  for(const message of [
    'จองได้ไหมครับ',
    'สั่งได้หรือเปล่า',
    'ยืนยันการจองต้องทำยังไง',
    'ช่วยยืนยันหน่อยว่าพรุ่งนี้ห้องว่างไหม',
    'ถ้าจะจองต้องทำยังไงครับ',
  ]){
    const d=classifyCommercialBoundaryText(message,'OTHER');
    assert.equal(d.mode,'READ_ONLY',message);
    assert.equal(d.currentTurnCommit,false,message);
    assert.equal(d.prepareEligible,false,message);
    assert.equal(d.routeToOneMindBeforePrimary,true,message);
  }
});

test('Phase 4 raw commercial boundary recognizes explicit booking/order requests only',()=>{
  for(const message of [
    'ขอจองภาราดรพรุ่งนี้ห้าโมง 30 นาทีครับ',
    'จองเลยครับ',
    'ยืนยันจองครับ',
    'ขอสั่งตำลาว 1 จานครับ',
    'สั่งเลยครับ',
    'ยืนยันสั่งครับ',
  ]){
    const d=classifyCommercialBoundaryText(message,'BUSINESS_TRANSACTION');
    assert.equal(d.mode,'COMMIT',message);
    assert.equal(d.currentTurnCommit,true,message);
    assert.equal(d.prepareEligible,true,message);
  }
});

test('Phase 4 cafe staff handoff is explicit operational consent but remains prepare-only eligible',()=>{
  for(const message of [
    'ช่วยส่งคำถามให้ทีมอินทนิลว่าเตรียมลาเต้ 5 แก้วได้ไหมครับ',
    'ฝากเรื่องให้ทีมคาเฟ่ติดต่อกลับได้ไหมครับ',
  ]){
    const d=classifyCommercialBoundaryText(message,'BUSINESS_TRANSACTION');
    assert.equal(d.mode,'COMMIT',message);
    assert.equal(d.currentTurnCommit,true,message);
    assert.equal(d.prepareEligible,true,message);
  }
});

test('Phase 4 planning, resume and bare confirmation are not fresh commercial consent',()=>{
  const cases=[
    'ยืนยันครับ',
    'เอาชุดนี้เลย',
    'เอาชุดเมื่อกี้',
    'กลับไปเรื่องจองต่อครับ',
    'กลับไปเรื่องสั่งต่อครับ',
  ];
  for(const message of cases){
    const d=classifyCommercialBoundaryText(message,'OTHER');
    assert.equal(d.mode,'CONSIDER',message);
    assert.equal(d.currentTurnCommit,false,message);
    assert.equal(d.prepareEligible,false,message);
    assert.equal(d.routeToOneMindBeforePrimary,true,message);
  }
});

test('Phase 4 same-turn latest consent signal wins',()=>{
  const revoked=classifyCommercialBoundaryText('จองเลยครับ แต่เดี๋ยวก่อน ยังไม่จอง','BUSINESS_TRANSACTION');
  assert.equal(revoked.mode,'WITHHOLD');
  assert.equal(revoked.currentTurnCommit,false);

  const recommitted=classifyCommercialBoundaryText('ยังไม่จอง... เอางี้ จองเลยครับ','BUSINESS_TRANSACTION');
  assert.equal(recommitted.mode,'COMMIT');
  assert.equal(recommitted.currentTurnCommit,true);

  const alternative=classifyCommercialBoundaryText('ไม่จองอันนี้ แต่จองอีกอันครับ','BUSINESS_TRANSACTION');
  assert.equal(alternative.mode,'COMMIT');
  assert.equal(alternative.currentTurnCommit,true);
});

test('Phase 4 cancellation/abandonment manages state and never creates fresh consent',()=>{
  for(const message of ['ยกเลิกก่อนครับ','ไม่เอาแล้ว','ไม่จองแล้วครับ']){
    const d=classifyCommercialBoundaryText(message,'OTHER');
    assert.ok(['MANAGE','WITHHOLD'].includes(d.mode),message);
    assert.equal(d.currentTurnCommit,false,message);
    assert.equal(d.prepareEligible,false,message);
  }
});

test('Phase 4 explicit promotion redemption is COMMIT but never Agent prepare eligible',()=>{
  const d=classifyCommercialBoundaryText('ใช้โปรนี้ครับ','OTHER');
  assert.equal(d.mode,'COMMIT');
  assert.equal(d.currentTurnCommit,true);
  assert.equal(d.prepareEligible,false);
});

test('Phase 4 semantic contract maps human conversational modes to one commercial boundary',()=>{
  const ask=classifyCommercialBoundarySemantic(semantic({
    action:'ask',speechAct:'question',informationNeed:'price',
  }));
  assert.equal(ask.mode,'READ_ONLY');

  const discover=classifyCommercialBoundarySemantic(semantic({
    action:'discover',speechAct:'question',informationNeed:'catalog',
  }));
  assert.equal(discover.mode,'READ_ONLY');

  const consider=classifyCommercialBoundarySemantic(semantic({
    action:'confirm',speechAct:'selection',entities:{horseName:'ภาราดร'},
  }));
  assert.equal(consider.mode,'CONSIDER');

  const commit=classifyCommercialBoundarySemantic(semantic({
    action:'book',speechAct:'transaction_request',
  }));
  assert.equal(commit.mode,'COMMIT');
  assert.equal(semanticMayAuthorizeCommercialCommit(semantic({
    action:'book',speechAct:'transaction_request',
  })),true);

  const incident=classifyCommercialBoundarySemantic(semantic({
    domain:'incident',action:'ask',speechAct:'incident_report',
  }));
  assert.equal(incident.mode,'INCIDENT');

  const manage=classifyCommercialBoundarySemantic(semantic({
    action:'cancel',speechAct:'task_control',
  }));
  assert.equal(manage.mode,'MANAGE');
});

test('Phase 4 semantic no-transaction constraint defeats contradictory model commit label',()=>{
  const malformed=semantic({
    action:'book',
    speechAct:'transaction_request',
    constraints:['no_transaction'],
  });
  const d=classifyCommercialBoundarySemantic(malformed);
  assert.equal(d.mode,'WITHHOLD');
  assert.equal(d.currentTurnCommit,false);
  assert.equal(semanticMayAuthorizeCommercialCommit(malformed),false);
});

test('Phase 4 production prepare routing no longer treats commercial questions or bare confirm as transaction intent',()=>{
  assert.equal(isAgentTransactionPrepareIntent('จองได้ไหมครับ','BUSINESS_TRANSACTION'),false);
  assert.equal(isAgentTransactionPrepareIntent('ยืนยันการจองต้องทำยังไง','BUSINESS_TRANSACTION'),false);
  assert.equal(isAgentTransactionPrepareIntent('ยืนยันครับ','OTHER'),false);
  assert.equal(isAgentTransactionPrepareIntent('เอาชุดนี้เลย','OTHER'),false);
  assert.equal(isAgentTransactionPrepareIntent('ยืนยันจองครับ','BUSINESS_TRANSACTION'),true);
  assert.equal(isAgentTransactionPrepareIntent('ขอสั่งอาหารครับ','BUSINESS_TRANSACTION'),true);
});

test('Phase 4 boundary-sensitive non-commit turns bypass 100% read-only Agent and reach One-Mind',()=>{
  const source=readFileSync(
    new URL('../netlify/functions/thongthai-chat.ts',import.meta.url),
    'utf8',
  );
  assert.match(source,/const commercialBoundary = classifyCommercialBoundaryText/u);
  assert.match(source,/const explicitTransactionIntent = commercialBoundary\.currentTurnCommit/u);
  assert.match(source,/const transactionPrepareIntent = commercialBoundary\.prepareEligible/u);
  assert.match(source,/const phase4CommercialBoundaryEligible =\s*commercialBoundary\.routeToOneMindBeforePrimary/u);
  assert.match(source,/!phase4CommercialBoundaryEligible/u);
});


test('Phase 4 semantic manage intent can independently veto execution',()=>{
  const cancel=classifyCommercialBoundarySemantic(semantic({
    action:'cancel',
    speechAct:'task_control',
    constraints:['no_transaction'],
  }));
  assert.equal(cancel.mode,'MANAGE');
  assert.equal(cancel.currentTurnCommit,false);
  assert.equal(cancel.withholdsExecution,true);

  const correction=classifyCommercialBoundarySemantic(semantic({
    action:'correct_previous',
    speechAct:'correction',
    entities:{horseName:'ทองไทย'},
    constraints:['no_transaction'],
  }));
  assert.equal(correction.mode,'MANAGE');
  assert.equal(correction.withholdsExecution,true);
});
