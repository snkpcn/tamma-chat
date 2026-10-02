import test from 'node:test';
import assert from 'node:assert/strict';

import { composeDeterministicResponse } from '../netlify/functions/_response-composer';
import { emptyTaskStateContainer } from '../netlify/functions/_task-state';

function inputFor(message:string,language:'th'|'en'='th',semanticOverrides:any={}){
  return {
    channel:'web',
    language,
    userMessage:message,
    semanticTurn:{
      semanticSource:'openai_supervisor',
      domain:'support',
      intent:'booking_confirmation_process',
      action:'ask',
      speechAct:'question',
      informationNeed:'policy',
      entities:{},
      references:[],
      constraints:[],
      confidence:0.98,
      needsClarification:false,
      ...semanticOverrides,
    },
    dialogDecision:{
      mode:'answer',
      responseIntent:'discovery_response',
      reasons:['discovery_only'],
      missingFields:[],
      actionProposal:undefined,
      taskStateContainer:emptyTaskStateContainer(),
      knowledgeRequests:[],
    },
    knowledgeBundles:[],
    degradation:{condition:'none',level:'normal',reasonCodes:[],retryable:false},
    operationalOutcome:null,
  } as any;
}

test('Phase 4 support commercial process question gets useful deterministic Thai copy',()=>{
  const response=composeDeterministicResponse(
    inputFor('ยืนยันการจองต้องทำยังไงครับ')
  );
  assert.equal(response.mode,'deterministic');
  assert.match(response.message,/ถามขั้นตอน/u);
  assert.match(response.message,/ยังไม่ทำรายการจริง/u);
  assert.match(response.message,/ยืนยันจริง/u);
  assert.doesNotMatch(response.message,/ตอบเรื่องนี้ให้แม่นไม่ได้|ระบบจอง.*ตอบช้า/u);
  assert.doesNotMatch(response.message,/จองสำเร็จ|ยืนยันการจองแล้ว|เลขที่จอง/u);
});

test('Phase 4 support commercial process question has an English deterministic copy',()=>{
  const response=composeDeterministicResponse(
    inputFor('How do I confirm a booking?','en')
  );
  assert.equal(response.mode,'deterministic');
  assert.match(response.message,/ask about the process|without creating anything/i);
  assert.match(response.message,/before any real confirmation/i);
});

test('Phase 4 support renderer never treats a commit request as a read-only process question',()=>{
  const response=composeDeterministicResponse(
    inputFor('จองให้เลยครับ','th',{
      action:'book',
      speechAct:'transaction_request',
      intent:'book_service',
      informationNeed:'none',
    })
  );
  assert.doesNotMatch(response.message,/ถามขั้นตอนได้ครับ การถามหรือเลือกยังไม่ทำรายการจริง/u);
  assert.doesNotMatch(response.message,/จองสำเร็จ|ยืนยันการจองแล้ว|เลขที่จอง/u);
});

test('Phase 4 support renderer is not a generic support-domain takeover',()=>{
  const response=composeDeterministicResponse(
    inputFor('ช่วยด้วยครับ ผมมีปัญหา','th',{
      intent:'need_human_help',
      action:'ask',
      speechAct:'request_help',
      informationNeed:'none',
    })
  );
  assert.doesNotMatch(response.message,/ถามขั้นตอนได้ครับ การถามหรือเลือกยังไม่ทำรายการจริง/u);
});


test('Phase 4 unknown-domain commercial availability question gets bounded Thai clarification',()=>{
  const response=composeDeterministicResponse(
    inputFor('ช่วยยืนยันหน่อยว่าพรุ่งนี้ว่างไหมครับ','th',{
      domain:'unknown',
      intent:'check_availability',
      action:'status',
      speechAct:'question',
      informationNeed:'availability',
      entities:{date:'2026-10-03'},
      needsClarification:true,
      clarificationReason:'service unspecified',
    })
  );
  assert.equal(response.mode,'deterministic');
  assert.match(response.message,/เช็กความว่าง/u);
  assert.match(response.message,/บริการ|กิจกรรม|ที่พัก/u);
  assert.doesNotMatch(response.message,/ตอบเรื่องนี้ให้แม่นไม่ได้|คิดช้ากว่าปกติ/u);
  assert.doesNotMatch(response.message,/จองสำเร็จ|ยืนยันการจองแล้ว/u);
});

test('Phase 4 unknown-domain commercial availability question has bounded English clarification',()=>{
  const response=composeDeterministicResponse(
    inputFor('Can you confirm whether tomorrow is available?','en',{
      domain:'unknown',
      intent:'check_availability',
      action:'status',
      speechAct:'question',
      informationNeed:'availability',
      entities:{date:'2026-10-03'},
      needsClarification:true,
    })
  );
  assert.equal(response.mode,'deterministic');
  assert.match(response.message,/which service|activity|stay/i);
  assert.match(response.message,/availability/i);
});
