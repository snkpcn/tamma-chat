import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  processThongthaiOneMindTurnAuthoritative,
  type OneMindDependencies,
  type OneMindTurnResult,
} from '../netlify/functions/_thongthai-one-mind-orchestrator';
import {
  processOneMindCustomerTurn,
} from '../netlify/functions/_thongthai-one-mind-response';
import type { GuestAgentStateSnapshot } from '../netlify/functions/_guest-agent-state-store';
import type { KnowledgeSourceAdapters, SourceResult } from '../netlify/functions/_knowledge-resolver';
import type { SemanticTurn } from '../netlify/functions/_semantic-interpreter';

const NOW = new Date('2026-09-27T12:00:00+07:00');
const CANON = '71111111-1111-4111-8111-111111111111';
const GUEST = '72222222-2222-4222-8222-222222222222';

function semantic(overrides: Partial<SemanticTurn>): SemanticTurn {
  return {
    semanticSource:'openai_supervisor',
    domain:'general',
    intent:'real_line_regression',
    action:'ask',
    informationNeed:'none',
    speechAct:'question',
    entities:{},
    references:[],
    constraints:[],
    confidence:0.98,
    needsClarification:false,
    ...overrides,
  };
}

function emptyResult(sourceId:string, sourceType:SourceResult['sourceType']):SourceResult {
  return {status:'empty', sourceId, sourceType, fetchedAt:NOW.toISOString()};
}

function scriptedConversation(
  meanings: Record<string, SemanticTurn>,
  adapters: KnowledgeSourceAdapters = {},
) {
  let snapshot:GuestAgentStateSnapshot={exists:false,state:{},updatedAt:null};
  let offset=0;
  const deps:Partial<OneMindDependencies>={
    resolveCanonicalGuestId:async()=>CANON,
    guestDbIdFromAnonymousId:async()=>GUEST,
    interpretSemanticTurn:async message=>{
      const turn=meanings[message];
      if(!turn) throw new Error(`missing scripted semantic turn: ${message}`);
      return structuredClone(turn);
    },
    buildKnowledgeAdapters:()=>adapters,
    mirrorActivityTaskToLegacySession:async()=>{},
  };
  return async(message:string):Promise<OneMindTurnResult>=>{
    offset+=1;
    return processThongthaiOneMindTurnAuthoritative({
      channel:'line',
      message,
      eventId:`real-line-${offset}`,
      providerUserKey:'line-real-regression',
      persistState:true,
    },deps,{
      loadSnapshot:async()=>snapshot,
      compareAndSwap:async(_id,current,patch)=>{
        const next={...current.state,...(patch.set??{})};
        for(const key of patch.removeKeys??[]) delete next[key];
        snapshot={exists:true,state:next,updatedAt:new Date(NOW.getTime()+offset*1000).toISOString()};
        return {status:'applied',snapshot};
      },
    },new Date(NOW.getTime()+offset*1000));
  };
}

test('REAL LINE: availability question with date/time never mutates an unfinished horse booking or asks its missing duration', async()=>{
  const select='เอาภาราดร';
  const availability='ยังไม่ต้องทำรายการอะไรทั้งนั้น แค่อยากรู้ว่าพรุ่งนี้ม้าตัวไหนว่างช่วง 16:30';
  const meanings={
    [select]:semantic({
      domain:'activity',intent:'select_horse',action:'confirm',speechAct:'selection',
      entities:{resourceCode:'activity-horse',horseName:'ภาราดร'},
    }),
    [availability]:semantic({
      domain:'activity',intent:'check_horse_availability',action:'status',informationNeed:'availability',speechAct:'question',
      entities:{date:'2026-09-28',time:'16:30'},constraints:['no_transaction'],
    }),
  };
  const run=scriptedConversation(meanings,{
    activity:{
      catalog:async()=>emptyResult('activity-catalog','activity_live'),
      availability:async()=>emptyResult('activity-schedule','activity_live'),
    },
  });
  const selected=await run(select);
  assert.equal(selected.taskStateAfter.activeTask?.slots.horseName,'ภาราดร');
  const before=structuredClone(selected.taskStateAfter.activeTask?.slots);
  const asked=await run(availability);
  assert.deepEqual(asked.taskStateAfter.activeTask?.slots,before,'read-only availability parameters must not become booking slots');
  assert.equal(asked.dialogDecision.mode,'query_knowledge');
  assert.equal(asked.dialogDecision.missingFields.length,0);
  assert.ok(asked.dialogDecision.knowledgeRequests.some(r=>r.domain==='activity'&&r.needs.includes('availability')));
  assert.equal(asked.dialogDecision.actionProposal,undefined);
});

test('REAL LINE: price question routes from informationNeed, not a fragile free-form intent label', async()=>{
  const message='ขอเช็กราคาก่อน ยังไม่จองนะ ถ้าถูกกว่าที่คิดค่อยว่ากัน';
  const run=scriptedConversation({
    [message]:semantic({
      domain:'activity',intent:'check_cost_before_deciding',action:'ask',informationNeed:'price',speechAct:'question',
      entities:{resourceCode:'activity-horse'},constraints:['no_transaction'],
    }),
  },{
    activity:{catalog:async()=>emptyResult('activity-catalog','activity_live')},
  });
  const result=await run(message);
  assert.ok(result.dialogDecision.knowledgeRequests.some(r=>r.domain==='activity'&&r.needs.includes('price')));
  assert.equal(result.dialogDecision.actionProposal,undefined);
});

test('REAL LINE: stay resource availability is availability, not existing-booking status', async()=>{
  const message='อยากได้ห้องที่เหมาะกับ 3 คน แต่ก่อนตอบเช็กก่อนว่ามีห้องว่างจริงไหม';
  const run=scriptedConversation({
    [message]:semantic({
      domain:'stay',intent:'check_room_availability_for_group',action:'status',informationNeed:'availability',speechAct:'question',
      entities:{partySize:3},
    }),
  },{
    stay:{availability:async()=>emptyResult('stay-schedule','stay_live')},
  });
  const result=await run(message);
  assert.ok(result.dialogDecision.knowledgeRequests.some(r=>r.domain==='stay'&&r.needs.includes('availability')));
  assert.equal(result.dialogDecision.knowledgeRequests.some(r=>r.needs.includes('booking_status')),false);
  assert.equal(result.taskStateAfter.activeTask,null,'availability question must not open a stay booking');
});

test('REAL LINE: correcting a prior recommendation/group fact cannot manufacture a booking task', async()=>{
  const message='เมื่อกี้บอก 5 คน ผิด จริง ๆ 4 คน แล้วมีเด็ก 1 คน';
  const run=scriptedConversation({
    [message]:semantic({
      domain:'activity',intent:'correct_group_size',action:'correct_previous',speechAct:'correction',
      entities:{partySize:4,children:1},
    }),
  });
  const result=await run(message);
  assert.equal(result.taskStateAfter.activeTask,null);
  assert.equal(result.dialogDecision.actionProposal,undefined);
  assert.notEqual(result.dialogDecision.mode,'collect_field');
});

test('REAL LINE: promotion recommendation still queries verified promotion truth', async()=>{
  const message='เอาโปรร้านอาหารที่คุ้มสุด แต่ไม่เอาแบบต้องสมัครสมาชิกเพิ่มนะ';
  const run=scriptedConversation({
    [message]:semantic({
      domain:'promotion',intent:'recommend_restaurant_promotion',action:'recommend',informationNeed:'recommendation',speechAct:'request',
      entities:{businessDomain:'restaurant'},constraints:['no_new_membership'],
    }),
  },{
    promotion:{eligibility:async()=>emptyResult('promotion-live','promotion_live')},
  });
  const result=await run(message);
  assert.ok(result.dialogDecision.knowledgeRequests.some(r=>r.domain==='promotion'&&r.needs.includes('promotion_eligibility')));
  assert.equal(result.dialogDecision.actionProposal,undefined);
});

test('REAL LINE: itinerary composition is owned by One-Mind instead of falling through to a legacy keyword router', async()=>{
  const message='ถ้าพักสองคืนแล้ววันแรกอยากขี่ม้า วันที่สองอยากกินข้าวแล้วซื้อของฝาก ช่วยจัดให้คร่าว ๆ ได้ไหม';
  let snapshot:GuestAgentStateSnapshot={exists:false,state:{},updatedAt:null};
  const deps:Partial<OneMindDependencies>={
    resolveCanonicalGuestId:async()=>CANON,
    guestDbIdFromAnonymousId:async()=>GUEST,
    interpretSemanticTurn:async()=>semantic({
      domain:'journey',intent:'compose_two_day_plan',action:'recommend',informationNeed:'recommendation',speechAct:'request',
      entities:{tripDurationDays:2},constraints:['day1_horse','day2_meal_and_otop'],
    }),
    buildKnowledgeAdapters:()=>({}),
  };
  const result=await processOneMindCustomerTurn({
    channel:'line',language:'th',message,eventId:'journey-line-1',providerUserKey:'line-key',persistState:true,
  },deps,{
    loadSnapshot:async()=>snapshot,
    compareAndSwap:async(_id,current,patch)=>{
      snapshot={exists:true,state:{...current.state,...(patch.set??{})},updatedAt:NOW.toISOString()};
      return {status:'applied',snapshot};
    },
  },NOW,{requireSemanticSupervisor:true});
  assert.equal(result.status,'composed','journey planning must not be handed back to legacy raw-text routing');
  assert.equal(result.turn.semanticTurn.domain,'journey');
  assert.equal(result.turn.dialogDecision.actionProposal,undefined);
});

test('REAL LINE: conditional fallback remains read-only and cannot replace the current horse selection', async()=>{
  const select='เอาภาราดร';
  const conditional='ถ้าภาราดรไม่ว่าง เอาทองไทยแทนได้ แต่ถ้าทั้งคู่ไม่ว่างไม่ต้องจองอะไร';
  const run=scriptedConversation({
    [select]:semantic({
      domain:'activity',intent:'select_horse',action:'confirm',speechAct:'selection',
      entities:{resourceCode:'activity-horse',horseName:'ภาราดร'},
    }),
    [conditional]:semantic({
      domain:'activity',intent:'conditional_horse_fallback',action:'status',informationNeed:'availability',speechAct:'request',
      entities:{primaryHorse:'ภาราดร',fallbackHorse:'ทองไทย'},constraints:['no_transaction_if_unavailable'],
    }),
  },{
    activity:{
      catalog:async()=>emptyResult('activity-catalog','activity_live'),
      availability:async()=>emptyResult('activity-schedule','activity_live'),
    },
  });
  const selected=await run(select);
  const before=structuredClone(selected.taskStateAfter.activeTask?.slots);
  const result=await run(conditional);
  assert.deepEqual(result.taskStateAfter.activeTask?.slots,before);
  assert.equal(result.dialogDecision.actionProposal,undefined);
  assert.ok(result.dialogDecision.knowledgeRequests.some(r=>r.needs.includes('availability')));
});
