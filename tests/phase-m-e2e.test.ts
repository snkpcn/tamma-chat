// Phase M — cross-module E2E acceptance.
//
// Network-free by design: semantic turns and authoritative source results are
// injected, but the REAL One-Mind orchestrator, CAS state merge, Dialog
// Manager, Knowledge Resolver, Response Composer bridge, cutover gate and safe
// observability envelope are exercised together.
//
// Transactional scenarios stop at the ActionProposal boundary and prove that
// the proposal matches an EXISTING deterministic executor contract. They never
// write to production in CI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  processThongthaiOneMindTurnAuthoritative,
  type AuthoritativeStateDependencies,
  type OneMindDependencies,
} from '../netlify/functions/_thongthai-one-mind-orchestrator';
import {
  processOneMindCustomerTurn,
  readOnlyCutoverEligibility,
} from '../netlify/functions/_thongthai-one-mind-response';
import { applyGuestAgentStatePatch, type GuestAgentStateSnapshot } from '../netlify/functions/_guest-agent-state-store';
import type { SemanticTurn } from '../netlify/functions/_semantic-interpreter';
import type { KnowledgeSourceAdapters, SourceResult, GroundedFact } from '../netlify/functions/_knowledge-resolver';

const NOW=new Date('2026-09-18T12:00:00.000Z');
const CANON='11111111-1111-4111-8111-111111111111';
const GUEST='22222222-2222-4222-8222-222222222222';

function semantic(
  domain:SemanticTurn['domain'],
  action:SemanticTurn['action'],
  intent:string,
  entities:Record<string,unknown>={},
  constraints:string[]=[],
):SemanticTurn{
  return {domain,action,intent,entities,references:[],constraints,confidence:.95,needsClarification:false};
}

function fact(key:string,value:unknown,domain:GroundedFact['domain'],sourceId:string,sourceType:GroundedFact['sourceType']):GroundedFact{
  return {key,value,domain,sourceId,sourceType,authoritative:true,fetchedAt:NOW.toISOString()};
}
function ok(sourceId:string,sourceType:GroundedFact['sourceType'],data:GroundedFact[]):SourceResult{
  return {status:'ok',sourceId,sourceType,fetchedAt:NOW.toISOString(),data};
}
function empty(sourceId:string,sourceType:GroundedFact['sourceType']):SourceResult{
  return {status:'empty',sourceId,sourceType,fetchedAt:NOW.toISOString()};
}
function unavailable(sourceId:string,sourceType:GroundedFact['sourceType']):SourceResult{
  return {status:'unavailable',sourceId,sourceType,fetchedAt:NOW.toISOString(),error:'fixture_source_down'};
}

function memoryState(initial:Record<string,unknown>={}){
  let snapshot:GuestAgentStateSnapshot={exists:true,state:{...initial},updatedAt:'2026-09-18T11:59:00.000Z'};
  let rev=0;
  const deps:AuthoritativeStateDependencies={
    loadSnapshot:async()=>structuredClone(snapshot),
    compareAndSwap:async(_guest,expected,patch)=>{
      if(expected.updatedAt!==snapshot.updatedAt)return {status:'conflict'};
      rev+=1;
      const updatedAt=new Date(NOW.getTime()+rev).toISOString();
      snapshot={
        exists:true,
        state:applyGuestAgentStatePatch(snapshot.state,patch),
        updatedAt,
      };
      return {status:'applied',snapshot:structuredClone(snapshot)};
    },
  };
  return {deps,get:()=>structuredClone(snapshot)};
}

function oneMindDeps(getTurn:()=>SemanticTurn,getAdapters:()=>KnowledgeSourceAdapters):Partial<OneMindDependencies>{
  return {
    resolveCanonicalGuestId:async()=>CANON,
    guestDbIdFromAnonymousId:async()=>GUEST,
    interpretSemanticTurn:async()=>getTurn(),
    buildKnowledgeAdapters:()=>getAdapters(),
  };
}

test('M1 read-only restaurant: customer -> semantic -> knowledge -> dialog -> composer -> safe trace',async()=>{
  const state=memoryState();
  let turn=semantic('restaurant','discover','discover_menu');
  const adapters:KnowledgeSourceAdapters={
    restaurant:{menu:async()=>ok('restaurant_menu_live','restaurant_live',[
      fact('menu:tamthai:name','ตำไทย','restaurant','restaurant_menu_live','restaurant_live'),
      fact('menu:tamthai:price',89,'restaurant','restaurant_menu_live','restaurant_live'),
      fact('menu:tamthai:orderable',true,'restaurant','restaurant_menu_live','restaurant_live'),
    ])},
  };
  const result=await processOneMindCustomerTurn({
    channel:'web',language:'th',message:'ร้านมีไรกิน',eventId:'m-read-restaurant',
    providerUserKey:'web-key',persistState:true,environment:'test',
  },oneMindDeps(()=>turn,()=>adapters),state.deps,NOW);

  assert.equal(result.status,'composed');
  if(result.status!=='composed')return;
  assert.equal(result.turn.semanticTurn.domain,'restaurant');
  assert.equal(result.turn.groundedKnowledge.some(b=>b.facts.some(f=>f.key==='menu:tamthai:name')),true);
  assert.ok(result.response.message.length>0);
  assert.equal(result.turn.trace.statePersisted,true);
  const traceJson=JSON.stringify(result.observability);
  assert.doesNotMatch(traceJson,/ร้านมีไรกิน|ตำไทย/,'safe trace must contain neither raw customer text nor response/business prose');
  assert.doesNotMatch(traceJson,/web-key|22222222-2222/,'safe trace must not expose provider/canonical guest identity');
});

test('M2 promotion VERIFIED_EMPTY is a valid grounded no-promotion answer, not source failure',async()=>{
  const state=memoryState();
  const turn=semantic('promotion','discover','discover_promotions');
  const adapters:KnowledgeSourceAdapters={
    promotion:{eligibility:async()=>empty('active_promotions_live','promotion_runtime')},
  };
  const result=await processOneMindCustomerTurn({
    channel:'line',language:'th',message:'มีโปรอะไร',eventId:'m-promo-empty',
    providerUserKey:'line-key',persistState:true,environment:'test',
  },oneMindDeps(()=>turn,()=>adapters),state.deps,NOW);
  assert.equal(result.status,'composed');
  if(result.status!=='composed')return;
  assert.equal(result.turn.knowledgeDegradation.condition,'verified_empty');
  assert.match(result.response.message,/ไม่มีโปรโมชั่น|ยังไม่มีโปร/u);
  assert.doesNotMatch(result.response.message,/เช็กข้อมูลล่าสุดส่วนนี้ให้ไม่ได้|ลองอีกครั้ง/u);
});

test('M3 SOURCE_UNAVAILABLE is never rendered as "none available"',async()=>{
  const state=memoryState();
  const turn=semantic('promotion','discover','discover_promotions');
  const adapters:KnowledgeSourceAdapters={
    promotion:{eligibility:async()=>unavailable('active_promotions_live','promotion_runtime')},
  };
  const result=await processOneMindCustomerTurn({
    channel:'web',language:'th',message:'โปรมีไร',eventId:'m-promo-down',
    providerUserKey:'web-key',persistState:true,environment:'test',
  },oneMindDeps(()=>turn,()=>adapters),state.deps,NOW);
  assert.equal(result.status,'composed');
  if(result.status!=='composed')return;
  assert.equal(result.turn.knowledgeDegradation.condition,'source_unavailable');
  assert.match(result.response.message,/ยังเช็กข้อมูลล่าสุด|ไม่ขอเดา/u);
  assert.doesNotMatch(result.response.message,/ไม่มีโปรโมชั่นที่เปิดใช้งาน/u);
});

test('M4 activity: explicit booking commit reaches ActionProposal but never executes inside One-Mind',async()=>{
  const state=memoryState();
  let turn=semantic('activity','confirm','select_horse',{
    resourceCode:'activity-horse',horseName:'ภาราดร',date:'2026-09-19',durationMinutes:60,partySize:2,
  });
  const adapters:KnowledgeSourceAdapters={
    activity:{
      availability:async()=>ok('activity_schedule','activity_live',[
        fact('activity:activity-horse:2026-09-19:15:00:available',true,'activity','activity_schedule','activity_live'),
      ]),
      catalog:async()=>ok('activity_catalog','activity_live',[
        fact('activity:horse:name','ขี่ม้า','activity','activity_catalog','activity_live'),
      ]),
    },
  };
  const deps=oneMindDeps(()=>turn,()=>adapters);

  const select=await processThongthaiOneMindTurnAuthoritative({
    channel:'line',message:'เอาภาราดร พรุ่งนี้สองคน',eventId:'m-activity-select',
    providerUserKey:'line-key',persistState:true,environment:'test',
  },deps,state.deps,NOW);
  assert.ok(select.taskStateAfter.activeTask);
  assert.equal(select.dialogDecision.actionProposal,undefined);

  turn=semantic('activity','book','confirm_activity_booking',{time:'15:00'});
  const commit=await processThongthaiOneMindTurnAuthoritative({
    channel:'line',message:'จองเลย บ่ายสาม',eventId:'m-activity-book',
    providerUserKey:'line-key',persistState:true,environment:'test',
  },deps,state.deps,new Date(NOW.getTime()+1000));

  assert.equal(commit.dialogDecision.mode,'propose_action');
  assert.equal(commit.dialogDecision.actionProposal?.toolName,'create_booking');
  assert.equal(commit.dialogDecision.actionProposal?.customerCommitPresent,true);
  assert.equal(readOnlyCutoverEligibility(commit).eligible,false,'transaction must remain on deterministic legacy executor until transaction cutover');
  assert.equal(commit.conversationContextAfter.lastToolResultSummary,'action_proposed_not_executed');

  const runtime=readFileSync('netlify/functions/_thongthai-runtime-v3.ts','utf8');
  assert.match(runtime,/call\.name === 'create_booking'/,'existing executor contract must still own create_booking');
});

test('M5 stay explicit commit proposes existing create_booking contract only after availability is verified',async()=>{
  const state=memoryState();
  const turn=semantic('stay','book','book_stay',{
    date:'2026-09-20',resourceCode:'stay-house-1',partySize:2,quantity:1,
  });
  const adapters:KnowledgeSourceAdapters={
    stay:{availability:async()=>ok('stay_schedule','stay_live',[
      fact('stay:stay-house-1:2026-09-20:available',true,'stay','stay_schedule','stay_live'),
    ])},
  };
  const result=await processThongthaiOneMindTurnAuthoritative({
    channel:'web',message:'จองหลังนี้พรุ่งนี้เลย',eventId:'m-stay-book',
    providerUserKey:'web-key',persistState:true,environment:'test',
  },oneMindDeps(()=>turn,()=>adapters),state.deps,NOW);
  assert.equal(result.dialogDecision.actionProposal?.toolName,'create_booking');
  assert.equal(result.dialogDecision.actionProposal?.validatedArgs.resourceCode,'stay-house-1');
  assert.equal(readOnlyCutoverEligibility(result).eligible,false);
});

test('M6 restaurant preorder: explicit order proposal matches existing deterministic preorder executor',async()=>{
  const state=memoryState();
  const turn=semantic('restaurant','order','submit_preorder',{
    date:'2026-09-19',time:'14:00',customerName:'สมชาย',phone:'0812345678',
    items:[{name:'ตำไทย',quantity:1}],
  });
  const result=await processThongthaiOneMindTurnAuthoritative({
    channel:'line',message:'สั่งชุดนี้เลย พรุ่งนี้บ่ายสอง สมชาย 0812345678',eventId:'m-preorder',
    providerUserKey:'line-key',persistState:true,environment:'test',
  },oneMindDeps(()=>turn,()=>({})),state.deps,NOW);
  assert.equal(result.dialogDecision.actionProposal?.toolName,'create_restaurant_preorder');
  assert.equal(readOnlyCutoverEligibility(result).eligible,false);
  const runtime=readFileSync('netlify/functions/_thongthai-runtime-v3.ts','utf8');
  assert.match(runtime,/call\.name === 'create_restaurant_preorder'/);
});

test('M7 membership/cafe read-only turns may compose, while unfinished transactional domains stay on legacy safety path',async()=>{
  const cases:Array<[SemanticTurn['domain'],SemanticTurn['action'],string]>=[
    ['payment','status','payment_status'],
  ];
  for(const [domain,action,intent] of cases){
    const state=memoryState();
    const turn=semantic(domain,action,intent);
    const result=await processOneMindCustomerTurn({
      channel:'web',language:'th',message:'test',eventId:`m-legacy-${domain}`,
      providerUserKey:'web-key',persistState:true,environment:'test',
    },oneMindDeps(()=>turn,()=>({})),state.deps,NOW);
    assert.equal(result.status,'legacy_required',`${domain} must not be silently cut over before equivalence`);
  }
  const readOnlyCases:Array<[SemanticTurn['domain'],SemanticTurn['action'],string]>=[
    ['membership','status','membership_status'],
    ['cafe','ask','ask_cafe_menu'],
  ];
  for(const [domain,action,intent] of readOnlyCases){
    const state=memoryState();
    const turn=semantic(domain,action,intent);
    const result=await processOneMindCustomerTurn({
      channel:'web',language:'th',message:'test',eventId:`m-readonly-${domain}`,
      providerUserKey:'web-key',persistState:true,environment:'test',
    },oneMindDeps(()=>turn,()=>({})),state.deps,NOW);
    assert.equal(result.status,'composed',`${domain} read-only degradation should be centralized instead of falling to generic provider apology`);
  }
});

test('M8 OTOP read-only inquiry can use One-Mind, while order action remains transactional legacy',async()=>{
  const state=memoryState();
  let turn=semantic('otop','discover','discover_otop');
  const adapters:KnowledgeSourceAdapters={
    otop:{catalog:async()=>ok('otop_products','otop_live',[
      fact('otop:honey:name','น้ำผึ้งป่า','otop','otop_products','otop_live'),
      fact('otop:honey:price',120,'otop','otop_products','otop_live'),
      fact('otop:honey:stock',4,'otop','otop_products','otop_live'),
    ])},
  };
  const deps=oneMindDeps(()=>turn,()=>adapters);
  const browse=await processOneMindCustomerTurn({
    channel:'web',language:'th',message:'มีของฝากอะไรบ้าง',eventId:'m-otop-browse',
    providerUserKey:'web-key',persistState:true,environment:'test',
  },deps,state.deps,NOW);
  assert.equal(browse.status,'composed');

  turn=semantic('otop','order','order_otop',{productSku:'honey',quantity:2});
  const order=await processOneMindCustomerTurn({
    channel:'web',language:'th',message:'เอาสองขวด สั่งเลย',eventId:'m-otop-order',
    providerUserKey:'web-key',persistState:true,environment:'test',
  },deps,state.deps,new Date(NOW.getTime()+1000));
  assert.equal(order.status,'legacy_required');
});

test('M9 executor support matrix keeps promotion/OTOP/cafe transaction safety in existing deterministic runtime',()=>{
  const runtime=readFileSync('netlify/functions/_thongthai-runtime-v3.ts','utf8');
  for(const tool of ['redeem_promotion','create_otop_order','create_cafe_inquiry']){
    assert.match(runtime,new RegExp(`call\\.name === '${tool}'`),`missing legacy deterministic executor for ${tool}`);
  }
});

test('M10 Phase M keeps payment truth and requested!=confirmed regressions executable',()=>{
  const paymentTests=readFileSync('tests/payments.test.ts','utf8');
  const composerTests=readFileSync('tests/response-composer.test.ts','utf8');
  assert.match(paymentTests,/ambiguous, never auto-attached|reported as ambiguous/i);
  assert.match(composerTests,/requested.*confirmed|requested!=confirmed/is);
});

test('M11 bounded observability contract is compatible with owner-only backoffice control-plane schema',()=>{
  const migration=readFileSync('netlify/functions/supabase/one-mind-observability-v1.sql','utf8');
  const observability=readFileSync('netlify/functions/_one-mind-observability.ts','utf8');
  assert.match(migration,/one_mind_traces/);
  assert.match(migration,/expires_at/);
  assert.match(migration,/unique \(channel, trace_id\)/i);
  assert.match(observability,/conversationKeyFromGuestId/);
  assert.doesNotMatch(observability,/rawCustomerMessage|responseProse|modelOutput/);
});
