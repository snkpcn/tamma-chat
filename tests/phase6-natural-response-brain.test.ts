import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildResponseComposerPrompt,
  composeDeterministicResponse,
  type ResponseComposerInput,
  type ResponseLanguage,
} from '../netlify/functions/_response-composer';
import {
  composeEscalationResponse,
  composeServiceFeedbackResponse,
} from '../netlify/functions/_service-mind-feedback-response';
import type { ServiceFeedbackMatch } from '../netlify/functions/_service-mind-feedback-intent';
import { createActiveTask, emptyTaskStateContainer } from '../netlify/functions/_task-state';
import type { DialogDecision } from '../netlify/functions/_dialog-manager';
import { emptyConversationContextState } from '../netlify/functions/_conversation-context';
import { polishCustomerMessage } from '../netlify/functions/_chat-copy-style';

function decision(overrides: Partial<DialogDecision> = {}): DialogDecision {
  return {
    mode: 'answer',
    taskStateContainer: emptyTaskStateContainer(),
    knowledgeRequests: [],
    missingFields: [],
    responseIntent: 'grounded_answer',
    reasons: [],
    ...overrides,
  };
}

function input(language: ResponseLanguage, overrides: Partial<ResponseComposerInput> = {}): ResponseComposerInput {
  return {
    channel: 'line',
    language,
    userMessage: '',
    dialogDecision: decision(),
    knowledgeBundles: [],
    degradation: {
      version: 'phase6-test',
      condition: 'none',
      level: 'normal',
      reasonCodes: [],
      retryable: false,
      safeToExecuteTransaction: false,
      sourceStates: [],
    },
    ...overrides,
  };
}

const THAI_RE=/[ก-๙]/u;
const CJK_RE=/[㐀-鿿]/u;
const LAO_RE=/[຀-໿]/u;
const VIETNAMESE_RE=/[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/iu;

function assertLanguage(text:string, language:ResponseLanguage):void {
  assert.ok(text.trim().length>0);
  if(language==='th') assert.match(text,THAI_RE);
  if(language==='zh') {
    assert.match(text,CJK_RE);
    assert.doesNotMatch(text,/I can|The request|Nothing has|Current:|Paused:/iu);
  }
  if(language==='lo') {
    assert.match(text,LAO_RE);
    assert.doesNotMatch(text,/I can|The request|Nothing has|Current:|Paused:/iu);
  }
  if(language==='vi') {
    assert.match(text,VIETNAMESE_RE);
    assert.doesNotMatch(text,/I can|The request|Nothing has|Current:|Paused:/iu);
  }
}

test('Phase 6 deterministic degradation never leaks English into zh/lo/vi',()=>{
  for(const language of ['zh','lo','vi'] as const){
    const response=composeDeterministicResponse(input(language,{
      degradation:{
        version:'phase6-test',
        condition:'source_unavailable',
        level:'human_handoff',
        reasonCodes:['authoritative_source_unavailable'],
        retryable:true,
        safeToExecuteTransaction:false,
        sourceStates:[],
      },
    }));
    assertLanguage(response.message,language);
  }
});

test('Phase 6 collect-field copy is localized and names the actual missing fields',()=>{
  const cases:Array<[ResponseLanguage,string,RegExp]>=[
    ['en','date','date'],
    ['zh','date',/日期/u],
    ['lo','date',/ວັນ/u],
    ['vi','date',/ngày/iu],
  ].map(([language,field,pattern])=>[language,field,pattern as RegExp]);
  for(const [language,field,pattern] of cases){
    const response=composeDeterministicResponse(input(language,{
      dialogDecision:decision({
        mode:'collect_field',
        missingFields:[field],
        responseIntent:'ask_missing_field',
      }),
    }));
    assert.match(response.message,pattern);
    assert.match(response.message,language==='en'?/nothing has been submitted/iu
      :language==='zh'?/没有提交/u
      :language==='lo'?/ຍັງບໍ່ໄດ້ສົ່ງ/u
      :/chưa có yêu cầu nào được gửi/iu);
    assertLanguage(response.message,language);
  }
});

test('Phase 6 operational truth remains localized: requested is never falsely confirmed',()=>{
  for(const language of ['en','zh','lo','vi'] as const){
    const requested=composeDeterministicResponse(input(language,{
      operationalOutcome:{executed:true,success:true,status:'requested',referenceCode:'REQ-6'},
    }));
    assertLanguage(requested.message,language);
    assert.doesNotMatch(requested.message,/confirmed|已确认|ຢືນຢັນລາຍການແລ້ວ|đã xác nhận/iu);

    const confirmed=composeDeterministicResponse(input(language,{
      operationalOutcome:{executed:true,success:true,status:'confirmed',referenceCode:'REQ-6'},
    }));
    assertLanguage(confirmed.message,language);
  }
});

test('Phase 6 active-task summary stays in the requested language and preserves no-transaction truth',()=>{
  const now=new Date('2026-10-02T00:00:00Z');
  const task=createActiveTask({
    type:'activity_booking',
    sourceChannel:'line',
    initialSlots:{resourceCode:'activity-horse',horseName:'ภาราดร',durationMinutes:45,partySize:2},
    requiredFields:['date','time','durationMinutes','partySize'],
    now,
  });
  const container={...emptyTaskStateContainer(),activeTask:task};

  for(const language of ['zh','lo','vi'] as const){
    const context=emptyConversationContextState(now);
    const response=composeDeterministicResponse(input(language,{
      dialogDecision:decision({
        taskStateContainer:container,
        responseIntent:'active_task_summary',
      }),
      conversationContext:context,
    }));
    assert.match(response.message,/ภาราดร/u);
    assertLanguage(response.message,language);
    assert.doesNotMatch(response.message,/รายการที่กำลังคุยอยู่|ยังไม่ได้ยืนยันการจอง|Current:|These are conversation-state/iu);
  }
});

test('Phase 6 refund authority rail answers in the customer language and still refuses owner-level authority',()=>{
  for(const language of ['en','zh','lo','vi'] as const){
    const response=composeEscalationResponse({
      category:'refund_request',
      domainUnit:null,
      pureEscalation:true,
      escalates:true,
    },true,[{team:'owner_general',status:'sent'}],language);
    assertLanguage(response,language);
    if(language==='en') assert.match(response,/shouldn’t confirm|owner/iu);
    if(language==='zh') assert.match(response,/负责人|退款/u);
    if(language==='lo') assert.match(response,/ຄືນເງິນ|ເຈົ້າຂອງ/u);
    if(language==='vi') assert.match(response,/hoàn tiền|chủ sở hữu/iu);
  }
});

test('Phase 6 deterministic customer-voice acknowledgement uses customer language',()=>{
  const match:ServiceFeedbackMatch={
    feedbackType:'complaint',
    businessUnit:'otop',
    severity:'normal',
    staffName:null,
    personMentions:[],
    businessUnitMentions:['otop'],
    sentimentKeywords:[],
    issueKeywords:['fulfillment'],
    namedAssets:[],
    keywordSummary:{topPositive:[],topNegative:[]},
  };
  for(const language of ['en','zh','lo','vi'] as const){
    const response=composeServiceFeedbackResponse(match,true,{
      eventId:'phase6-feedback',
      targets:[{team:'otop',status:'sent'}],
    },language);
    assertLanguage(response,language);
    assert.doesNotMatch(response,/ขอบคุณ|ทองไทยรับเรื่อง|ส่งให้ทีม/u);
  }
});

test('Phase 6 grounded model prompt preserves natural response doctrine and explicit output language',()=>{
  const prompt=buildResponseComposerPrompt(input('zh',{
    userMessage:'骑马多少钱？',
    dialogDecision:decision({
      mode:'query_knowledge',
      responseIntent:'grounded_answer',
      knowledgeRequests:[{domain:'activity',needs:['price'],entities:{activityCode:'horse'}} as any],
    }),
  }));
  assert.match(prompt,/OUTPUT LANGUAGE: zh/u);
  assert.match(prompt,/Answer the substance first/iu);
  assert.match(prompt,/Do not narrate.*classification|Do not mechanically restate/iu);
  assert.match(prompt,/natural spoken Thai|phrase the supplied verified decision naturally/iu);
});

test('Phase 6 last-mile Thai voice keeps male polite particles',()=>{
  const polished=polishCustomerMessage('ได้ค่ะ เดี๋ยวเช็กให้คะ','line');
  assert.equal(polished,'ได้ครับ เดี๋ยวเช็กให้ครับ');
});
