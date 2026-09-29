import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';
import { brainRequest, guestId, withHarness } from './helpers/canonical-core-harness';
import {
  buildResponseComposerPrompt,
  composeGroundedModelResponse,
  composeThongthaiResponse,
  type ResponseComposerInput,
} from '../netlify/functions/_response-composer';
import { deriveDeterministicSemanticTurn } from '../netlify/functions/_deterministic-semantic-turn';
import { emptySemanticContext, type SemanticTurn } from '../netlify/functions/_semantic-interpreter';
import { emptyConversationContextState } from '../netlify/functions/_conversation-context';
import { createActiveTask, emptyTaskStateContainer, type TaskStateContainer } from '../netlify/functions/_task-state';
import { planDialogTurn, type DialogDecision } from '../netlify/functions/_dialog-manager';
import type { KnowledgeBundle } from '../netlify/functions/_knowledge-resolver';
import type { DegradationPlan } from '../netlify/functions/_graceful-degradation';

function committedHorseTask(): TaskStateContainer {
  const active=createActiveTask({
    type:'activity_booking',
    sourceChannel:'line',
    initialSlots:{resourceCode:'activity-horse',horseName:'ภาราดร'},
    requiredFields:['resourceCode','durationMinutes','date','time','partySize'],
    now:new Date('2026-09-29T00:00:00Z'),
  });
  return {
    ...emptyTaskStateContainer(),
    activeTask:{...active,commitmentIntent:true},
  };
}

function turn(overrides:Partial<SemanticTurn>):SemanticTurn {
  return {
    normalizedMeaning:'conversation',
    reply:'',
    speechAct:'statement',
    domain:'general',
    intent:'open_chat',
    action:'ask',
    informationNeed:'none',
    entities:{},
    references:[],
    constraints:[],
    confidence:0.96,
    needsClarification:false,
    semanticSource:'openai_supervisor',
    ...overrides,
  };
}

const degradation:DegradationPlan={
  version:'degradation-v1',
  condition:'none',
  level:'normal',
  reasonCodes:[],
  retryable:false,
  safeToExecuteTransaction:false,
  sourceStates:[],
};

test('active horse task cannot hijack a checkout-time question into inventory count',()=>{
  const context=emptySemanticContext();
  context.activeDomain='activity';
  const result=deriveDeterministicSemanticTurn(
    'แล้วเช็กเอาต์กี่โมงครับ',
    context,
    committedHorseTask(),
    new Date('2026-09-29T00:00:00Z'),
  );
  assert.ok(result);
  assert.equal(result?.domain,'stay');
  assert.equal(result?.intent,'stay_checkin_checkout_time_lookup');
  assert.notEqual(result?.intent,'activity_inventory_count');
});

test('historical booking commitment cannot turn a new general preference into stale missing-field collection',()=>{
  const context=emptyConversationContextState(new Date('2026-09-29T00:00:00Z'));
  context.activeDomain='activity';
  const semantic=turn({
    domain:'general',
    intent:'set_unverified_information_policy',
    action:'provide_information',
    speechAct:'preference_update',
    reply:'ได้ครับ ถ้ายังยืนยันข้อมูลไม่ได้ ทองไทยจะบอกตรง ๆ และไม่เดาให้ครับ',
  });
  const plan=planDialogTurn({
    semanticTurn:semantic,
    conversationContext:context,
    taskState:committedHorseTask(),
    channel:'line',
    eventId:'human-v2-unrelated',
  },new Date('2026-09-29T00:00:01Z'));
  assert.equal(plan.mode,'answer');
  assert.deepEqual(plan.missingFields,[]);
  assert.ok(plan.reasons.includes('task_unrelated_turn_preserved'));
});

test('unrelated current model reply is allowed to speak even while an old task retains commitment intent',async()=>{
  const semantic=turn({
    domain:'general',
    intent:'set_unverified_information_policy',
    action:'provide_information',
    speechAct:'preference_update',
    reply:'ได้ครับ ถ้าข้อมูลไหนยังยืนยันไม่ได้ ทองไทยจะบอกตรง ๆ และไม่เดาให้ครับ',
  });
  const decision:DialogDecision={
    mode:'answer',
    taskStateContainer:committedHorseTask(),
    knowledgeRequests:[],
    missingFields:[],
    responseIntent:'discovery_response',
    reasons:['task_unrelated_turn_preserved'],
  };
  const result=await composeThongthaiResponse({
    channel:'line',
    language:'th',
    userMessage:'ถ้าข้อมูลอะไรที่ยังยืนยันไม่ได้ ไม่ต้องเดานะครับ',
    semanticTurn:semantic,
    conversationContext:emptyConversationContextState(),
    dialogDecision:decision,
    knowledgeBundles:[],
    degradation,
  });
  assert.equal(result.mode,'model');
  assert.match(result.message,/ไม่เดา|ยืนยันไม่ได้/u);
  assert.doesNotMatch(result.message,/ระยะเวลา|กี่นาที|จองกี่โมง/u);
});

test('final composer prompt carries human Isan service voice plus bounded working context',()=>{
  const context=emptyConversationContextState(new Date('2026-09-29T00:00:00Z'));
  context.activeDomain='activity';
  context.activeTopic='horse';
  context.workingMemory.companion='เด็ก';
  context.workingMemory.pace='สบาย ๆ';
  context.workingMemory.consideredSelections=[{
    domain:'activity',name:'ภาราดร',status:'considering',observedAt:'2026-09-29T00:00:00Z',
  }];
  context.workingMemory.constraints=[{
    domain:'restaurant',code:'no_seafood',observedAt:'2026-09-29T00:00:00Z',
  }];
  context.recentTurns=[
    {role:'user',content:'พาเด็กมาด้วยครับ',at:'2026-09-29T00:00:00Z',channel:'line'},
    {role:'assistant',content:'ได้ครับ',at:'2026-09-29T00:00:01Z',channel:'line'},
  ];
  const decision:DialogDecision={
    mode:'answer',taskStateContainer:emptyTaskStateContainer(),
    knowledgeRequests:[],missingFields:[],responseIntent:'grounded_answer',reasons:[],
  };
  const prompt=buildResponseComposerPrompt({
    channel:'line',language:'th',userMessage:'แนะนำให้หน่อยครับ',
    semanticTurn:turn({domain:'activity',action:'recommend',informationNeed:'recommendation'}),
    conversationContext:context,dialogDecision:decision,knowledgeBundles:[],degradation,
  });
  assert.match(prompt,/warm modern-Isan local host/i);
  assert.match(prompt,/BEFORE service/u);
  assert.match(prompt,/DURING service/u);
  assert.match(prompt,/AFTER service/u);
  assert.match(prompt,/ภาราดร/u);
  assert.match(prompt,/no_seafood/u);
  assert.match(prompt,/พาเด็กมาด้วยครับ/u);
  assert.match(prompt,/avoid re-asking|avoid repeating questions|avoid re-asking a care question/i);
});

test('authoritative unavailable source state can be phrased naturally by OpenAI without inventing a fact',async()=>{
  await withHarness(async harness=>{
    const gid=guestId('human-v2-source-unavailable');
    await processThongthaiChatCore(brainRequest('สวัสดีครับ',gid,'line'),'human-v2-seed');
    const guestDbId=harness.guestDbId(gid);
    assert.ok(guestDbId);
    harness.programGeminiReply({
      message:'ตอนนี้ยังยืนยันคิวขี่ม้าให้ไม่ได้ครับ ถ้าต้องการ ทองไทยช่วยให้ทีมเช็กคิวจริงให้อีกทีได้ครับ',
      usedFactKeys:[],
    });
    const bundle:KnowledgeBundle={
      domain:'activity',
      sources:[{
        need:'availability',
        sourceId:'activity_booking_options_live',
        sourceType:'activity_live',
        status:'unavailable',
        reason:'source_unavailable',
      }],
      facts:[],entities:[],missing:['availability'],warnings:[],freshness:'live',
    };
    const decision:DialogDecision={
      mode:'answer',taskStateContainer:emptyTaskStateContainer(),
      knowledgeRequests:[],missingFields:[],responseIntent:'source_unavailable_apology',
      reasons:['knowledge_unavailable'],
    };
    const input:ResponseComposerInput={
      channel:'line',language:'th',userMessage:'ภาราดรว่างไหมครับ',
      semanticTurn:turn({domain:'activity',action:'ask',informationNeed:'availability'}),
      conversationContext:emptyConversationContextState(),
      dialogDecision:decision,knowledgeBundles:[bundle],degradation,
      aiCallContext:{
        conversationId:gid,guestDbId:guestDbId!,channel:'line',
        eventId:'human-v2-unavailable',callerLabel:'grounded-response-composition',
      },
    };
    const result=await composeGroundedModelResponse(input);
    assert.ok(result);
    assert.equal(result?.mode,'model_grounded');
    assert.match(result?.message??'',/ยังยืนยัน.*ไม่ได้|ยังเช็ก.*ไม่ได้/u);
    assert.doesNotMatch(result?.message??'',/ว่างแน่นอน|เต็มแน่นอน/u);
    assert.deepEqual(result?.usedFactKeys,[]);
  });
});

test('verified horse ride-feel facts reach OpenAI and produce a direct human comparison without system-sounding provenance',async()=>{
  await withHarness(async harness=>{
    const gid=guestId('human-v2-horse-truth');
    harness.programGeminiReply({
      normalizedMeaning:'compare the two horses for ride feel',
      reply:'',
      speechAct:'question',
      domain:'activity',
      intent:'compare_horse_ride_feel',
      action:'compare',
      informationNeed:'recommendation',
      entities:{activityCode:'horse'},
      references:[],
      constraints:[],
      confidence:0.98,
      needsClarification:false,
    });
    harness.programGeminiReply({
      message:'ถ้าเน้นนั่งนิ่ม ภาราดรนิ่มกว่าครับ ส่วนทองไทยจะกระด้างกว่านิดหน่อย แต่นิสัยขี้เล่นทั้งคู่ครับ',
      usedFactKeys:[
        'activity_asset:horse-pharadon:name',
        'notes:activity_asset:horse-pharadon',
        'temperament:activity_asset:horse-pharadon',
        'activity_asset:horse-thongthai:name',
        'notes:activity_asset:horse-thongthai',
        'temperament:activity_asset:horse-thongthai',
      ],
    });
    const result=await processThongthaiChatCore(
      brainRequest('สองตัวนี้ต่างกันยังไงครับ ตัวไหนขี่นิ่มกว่า',gid,'line'),
      'human-v2-horse-compare',
    );
    const message=String(result.payload.message??'');
    assert.equal(result.statusCode,200);
    assert.match(message,/ภาราดร.*นิ่มกว่า/u);
    assert.match(message,/ทองไทย.*กระด้าง/u);
    assert.match(message,/ขี้เล่น/u);
    assert.doesNotMatch(message,/ข้อมูลที่มี|ข้อมูลที่เช็กได้|ระบบระบุ/u);
    assert.equal(harness.postsTo('bookings').length,0);
  },{
    activityAssets:[
      {activity_code:'horse',asset_code:'horse-thongthai',name:'ทองไทย',asset_type:'horse',metadata:{capacity:1,temperament:'ขี้เล่น',notes:'ขี่กระด้างกว่าภาราดรเล็กน้อย'}},
      {activity_code:'horse',asset_code:'horse-pharadon',name:'ภาราดร',asset_type:'horse',metadata:{capacity:1,temperament:'ขี้เล่น',notes:'ขี่นิ่มกว่าทองไทย'}},
    ],
  });
});

test('verified horse comparison remains grounded when the paid response composer is unavailable or budget-blocked',async()=>{
  const semantic=turn({
    domain:'activity',
    intent:'compare_horse_options',
    action:'compare',
    informationNeed:'recommendation',
    speechAct:'question',
    references:[{
      type:'comparison_set',value:'ทองไทย,ภาราดร',refersToPriorContext:true,
      ambiguous:true,
      resolvedEntityIds:['activity_asset:horse-pharadon','activity_asset:horse-thongthai'],
    }],
  });
  const bundle:KnowledgeBundle={
    domain:'activity',freshness:'live',missing:[],warnings:[],
    sources:[{need:'entity_details',sourceId:'activity_catalog_live',sourceType:'activity_live',status:'ok'}],
    entities:[],
    facts:[
      {key:'activity_asset:horse-pharadon:name',value:'ภาราดร',domain:'activity',sourceId:'activity_catalog_live',sourceType:'activity_live',authoritative:true},
      {key:'notes:activity_asset:horse-pharadon',value:'ขี่นิ่มกว่าทองไทย',domain:'activity',sourceId:'activity_catalog_live',sourceType:'activity_live',authoritative:true},
      {key:'temperament:activity_asset:horse-pharadon',value:'ขี้เล่น',domain:'activity',sourceId:'activity_catalog_live',sourceType:'activity_live',authoritative:true},
      {key:'activity_asset:horse-thongthai:name',value:'ทองไทย',domain:'activity',sourceId:'activity_catalog_live',sourceType:'activity_live',authoritative:true},
      {key:'notes:activity_asset:horse-thongthai',value:'ขี่กระด้างกว่าภาราดรเล็กน้อย',domain:'activity',sourceId:'activity_catalog_live',sourceType:'activity_live',authoritative:true},
      {key:'temperament:activity_asset:horse-thongthai',value:'ขี้เล่น',domain:'activity',sourceId:'activity_catalog_live',sourceType:'activity_live',authoritative:true},
    ],
  };
  const result=await composeThongthaiResponse({
    channel:'line',language:'th',userMessage:'สองตัวนี้ต่างกันยังไงครับ',
    semanticTurn:semantic,
    conversationContext:emptyConversationContextState(),
    dialogDecision:{
      mode:'query_knowledge',taskStateContainer:emptyTaskStateContainer(),
      knowledgeRequests:[],missingFields:[],responseIntent:'grounded_answer',reasons:[],
    },
    knowledgeBundles:[bundle],degradation,
    // No paid-call context models the fail-closed path after a provider or
    // budget guard refusal.  The final answer must still use verified facts.
    aiCallContext:null,
  });
  assert.equal(result.mode,'deterministic');
  assert.match(result.message,/ภาราดร.*นิ่มกว่า/u);
  assert.match(result.message,/ทองไทย.*กระด้าง/u);
  assert.match(result.message,/ขี้เล่น/u);
  assert.doesNotMatch(result.message,/หมายถึงกิจกรรมหรือม้าตัว/u);
  assert.doesNotMatch(result.message,/ปลอดภัย|รับประกัน|เหมาะกับทุกคน/u);
  assert.ok(result.usedFactKeys.includes('notes:activity_asset:horse-pharadon'));
  assert.ok(result.usedFactKeys.includes('notes:activity_asset:horse-thongthai'));
});
