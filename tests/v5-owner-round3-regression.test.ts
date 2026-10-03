import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  composeThongthaiResponse,
  type ResponseComposerInput,
} from '../netlify/functions/_response-composer';
import { emptyConversationContextState } from '../netlify/functions/_conversation-context';
import { emptyTaskStateContainer } from '../netlify/functions/_task-state';

const NOW='2026-10-03T04:28:00.000Z';

function baseInput(overrides:Partial<ResponseComposerInput>={}):ResponseComposerInput{
  return {
    channel:'line',
    language:'th',
    userMessage:'ทดสอบ',
    dialogDecision:{
      mode:'answer',
      taskStateContainer:emptyTaskStateContainer(),
      knowledgeRequests:[],
      missingFields:[],
      responseIntent:'grounded_answer',
      reasons:[],
    },
    knowledgeBundles:[],
    degradation:{
      version:'degradation-v1',
      condition:'none',
      level:'normal',
      reasonCodes:[],
      retryable:false,
      safeToExecuteTransaction:false,
      sourceStates:[],
    },
    ...overrides,
  };
}

test('v5 round3: explicit cafe resume restores companion drink instead of stale horse state', async()=>{
  const context=emptyConversationContextState(new Date(NOW));
  context.activeDomain='activity';
  context.activeTopic='horse_selection';
  context.workingMemory.consideredSelections=[{
    domain:'activity',
    entityId:'activity_asset:horse-pharadon',
    entityType:'horse',
    name:'ภาราดร',
    status:'considering',
    observedAt:NOW,
  }];
  context.recentTurns=[
    {role:'assistant',content:'ของแฟนเมื่อกี้คัดอูจิ เพียวมัทฉะไว้ในฝั่งไม่ใช่กาแฟครับ',at:NOW,channel:'line'},
    {role:'assistant',content:'ตอนนี้เหลือน้องภาราดรครับ ยังไม่ได้จอง',at:NOW,channel:'line'},
  ];
  const out=await composeThongthaiResponse(baseInput({
    userMessage:'กลับมาเรื่องเครื่องดื่มหน่อยครับ ของแฟนเมื่อกี้สุดท้ายเราเลือกแนวไหนไว้นะ',
    conversationContext:context,
  }));
  assert.equal(out.mode,'deterministic');
  assert.match(out.message,/อูจิ\s*เพียวมัทฉะ/u);
  assert.doesNotMatch(out.message,/สนใจ:\s*กิจกรรม|เลือกไว้เป็น\s*ภาราดร/u);
});

test('v5 round3: global readback keeps considered choices separate from real submissions', async()=>{
  const context=emptyConversationContextState(new Date(NOW));
  context.activeDomain='activity';
  context.workingMemory.transactionCommitment='none';
  context.workingMemory.consideredSelections=[{
    domain:'activity',
    entityId:'activity_asset:horse-pharadon',
    entityType:'horse',
    name:'ภาราดร',
    status:'considering',
    observedAt:NOW,
  }];
  context.recentTurns=[
    {role:'assistant',content:'ตอนนี้ยังเป็นแค่การเลือกไว้ ยังไม่ได้จองหรือส่งรายการครับ',at:NOW,channel:'line'},
  ];
  const out=await composeThongthaiResponse(baseInput({
    userMessage:'ตอนนี้จากที่คุยมาทั้งหมด มีอะไรถูกสั่ง จอง หรือส่งไปให้พนักงานแล้วบ้างครับ',
    conversationContext:context,
  }));
  assert.equal(out.mode,'deterministic');
  assert.match(out.message,/ยังไม่มีอะไรถูกสั่ง จอง หรือส่งไปให้พนักงาน/u);
  assert.match(out.message,/ยังเป็นแค่ตัวเลือก/u);
});
