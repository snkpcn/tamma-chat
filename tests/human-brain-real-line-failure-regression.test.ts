import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  processThongthaiOneMindTurnAuthoritative,
  type OneMindDependencies,
  type OneMindTurnResult,
} from '../netlify/functions/_thongthai-one-mind-orchestrator';
import {
  processOneMindCustomerTurn,
  readOnlyCutoverEligibility,
} from '../netlify/functions/_thongthai-one-mind-response';
import type { GuestAgentStateSnapshot } from '../netlify/functions/_guest-agent-state-store';
import type { GroundedFact, KnowledgeSourceAdapters, SourceResult } from '../netlify/functions/_knowledge-resolver';
import type { SemanticTurn } from '../netlify/functions/_semantic-interpreter';
import { emptyConversationContextState } from '../netlify/functions/_conversation-context';
import { createActiveTask, emptyTaskStateContainer, setSelectedEntities } from '../netlify/functions/_task-state';

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

function scriptedCustomerConversation(
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
  return async(message:string)=>{
    offset+=1;
    return processOneMindCustomerTurn({
      channel:'line',language:'th',message,
      eventId:`real-line-customer-${offset}`,
      providerUserKey:'line-real-customer-regression',
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
  const run=scriptedCustomerConversation({
    [select]:semantic({
      domain:'activity',intent:'select_horse',action:'confirm',speechAct:'selection',
      entities:{resourceCode:'activity-horse',horseName:'ภาราดร'},
    }),
    [conditional]:semantic({
      domain:'activity',intent:'set_horse_availability_fallback',action:'status',informationNeed:'availability',speechAct:'preference_update',
      // Real provider output observed on PR #250 head: the fallback name was
      // accidentally copied into both roles. Current named entities must
      // structurally repair those roles before response composition.
      entities:{horseName:'ทองไทย',fallbackHorseName:'ทองไทย',activityCode:'horse'},
      constraints:['no_transaction','fallback_if_paradorn_unavailable','do_not_book_if_both_unavailable'],
    }),
  },{
    activity:{
      catalog:async()=>emptyResult('activity-catalog','activity_live'),
      availability:async()=>emptyResult('activity-schedule','activity_live'),
    },
  });
  const selected=await run(select);
  assert.equal(selected.status,'composed');
  const before=structuredClone(selected.turn.taskStateAfter.activeTask?.slots);
  const result=await run(conditional);
  assert.equal(result.status,'composed');
  assert.deepEqual(result.turn.taskStateAfter.activeTask?.slots,before);
  assert.equal(result.turn.semanticTurn.entities.primaryHorse,'ภาราดร');
  assert.equal(result.turn.semanticTurn.entities.fallbackHorse,'ทองไทย');
  assert.notEqual(result.turn.semanticTurn.entities.primaryHorse,result.turn.semanticTurn.entities.fallbackHorse);
  assert.equal(result.turn.dialogDecision.actionProposal,undefined);
  assert.ok(result.turn.dialogDecision.knowledgeRequests.some(r=>r.needs.includes('availability')));
  assert.match(result.response.message,/ภาราดร/u);
  assert.match(result.response.message,/ทองไทย/u);
  assert.match(result.response.message,/ยังไม่ได้(?:เลือกหรือ)?จอง|ไม่ได้ทำรายการ/u);
});


test('REAL LINE: explicit horse correction replaces stale selected entity instead of preserving the old horse identity', async()=>{
  const active=createActiveTask({
    type:'activity_booking',
    sourceChannel:'line',
    initialSlots:{resourceCode:'activity-horse',horseName:'ภาราดร',date:'2026-09-28',time:'17:00'},
  },NOW);
  const paradorn={id:'activity_asset:horse-paradorn',type:'horse',name:'ภาราดร',domain:'activity' as const,source:'catalog' as const,canonical:true};
  const thongthai={id:'activity_asset:horse-thongthai',type:'horse',name:'ทองไทย',domain:'activity' as const,source:'catalog' as const,canonical:true};
  const taskState={
    ...emptyTaskStateContainer(),
    activeTask:setSelectedEntities(active,[paradorn],NOW),
  };
  const conversation={
    ...emptyConversationContextState(NOW),
    activeDomain:'activity' as const,
    recentEntities:[paradorn,thongthai],
  };
  let snapshot:GuestAgentStateSnapshot={
    exists:true,
    state:{conversationContext:conversation,taskState},
    updatedAt:NOW.toISOString(),
  };
  const message='เมื่อกี้บอกว่าเอาภาราดร เปลี่ยนใจละ เอาทองไทยเหมือนเดิม แต่เวลาเดิมนะ';
  const deps:Partial<OneMindDependencies>={
    resolveCanonicalGuestId:async()=>CANON,
    guestDbIdFromAnonymousId:async()=>GUEST,
    interpretSemanticTurn:async()=>semantic({
      domain:'activity',intent:'correct_horse_selection',action:'correct_previous',speechAct:'correction',
      entities:{horseName:'ทองไทย'},
      references:[{type:'task_slot',value:'time',refersToPriorContext:true,resolvedTaskSlot:'time'}],
    }),
    buildKnowledgeAdapters:()=>({activity:{catalog:async()=>emptyResult('activity-catalog','activity_live')}}),
    mirrorActivityTaskToLegacySession:async()=>{},
  };
  const result=await processThongthaiOneMindTurnAuthoritative({
    channel:'line',message,eventId:'real-line-horse-correction',providerUserKey:'line-key',persistState:true,
  },deps,{
    loadSnapshot:async()=>snapshot,
    compareAndSwap:async(_id,current,patch)=>{
      snapshot={exists:true,state:{...current.state,...(patch.set??{})},updatedAt:new Date(NOW.getTime()+1000).toISOString()};
      return {status:'applied',snapshot};
    },
  },new Date(NOW.getTime()+1000));

  assert.equal(result.taskStateAfter.activeTask?.slots.horseName,'ทองไทย');
  assert.equal(result.taskStateAfter.activeTask?.slots.time,'17:00');
  assert.equal(result.taskStateAfter.activeTask?.selectedEntities[0]?.name,'ทองไทย');
  assert.equal(result.dialogDecision.actionProposal,undefined);
});

test('KERNEL V2 PHASE 1: companion and low-exertion preference is consideration context, not an activity booking', async()=>{
  const message='มากับแฟนสองคน ไม่อยากทำอะไรเหนื่อยมาก';
  const run=scriptedConversation({
    [message]:semantic({
      domain:'activity',
      intent:'share_visit_context_low_exertion',
      action:'provide_information',
      speechAct:'preference_update',
      entities:{partySize:2,companion:'partner'},
      constraints:['low_exertion'],
    }),
  });
  const result=await run(message);
  assert.equal(result.semanticMeaning.conversationalMode,'CONSIDER');
  assert.equal(result.semanticMeaning.commitmentLevel,'planning');
  assert.equal(result.taskStateAfter.activeTask,null);
  assert.equal(result.dialogDecision.actionProposal,undefined);
});

test('KERNEL V2 PHASE 1: restaurant availability question outranks stale horse task state', async()=>{
  const select='เอาภาราดรไว้ก่อน แต่ยังไม่จองนะ';
  const restaurant='แล้วโต๊ะร้านอาหารพรุ่งนี้หกโมงเต็มหรือยัง';
  const run=scriptedConversation({
    [select]:semantic({
      domain:'activity',
      intent:'consider_horse_selection',
      action:'confirm',
      speechAct:'selection',
      entities:{resourceCode:'activity-horse',horseName:'ภาราดร'},
      constraints:['not_yet_booking'],
    }),
    [restaurant]:semantic({
      domain:'restaurant',
      intent:'check_table_availability',
      action:'status',
      informationNeed:'availability',
      speechAct:'question',
      entities:{date:'2026-09-28',time:'18:00'},
    }),
  },{
    restaurant:{availability:async()=>emptyResult('restaurant-table-schedule','restaurant_live')},
  });
  const selected=await run(select);
  assert.equal(selected.taskStateAfter.activeTask,null,'consideration must not create a stale activity task');
  assert.ok(selected.conversationContextAfter.workingMemory.consideredSelections.some(selection=>selection.name==='ภาราดร'));
  assert.equal(selected.dialogDecision.actionProposal,undefined);
  const asked=await run(restaurant);
  assert.equal(asked.semanticMeaning.conversationalMode,'ASK');
  assert.equal(asked.semanticTurn.domain,'restaurant');
  assert.ok(asked.dialogDecision.knowledgeRequests.some(request=>request.domain==='restaurant'&&request.needs.includes('availability')));
  assert.equal(asked.dialogDecision.actionProposal,undefined);
  assert.notEqual(asked.dialogDecision.mode,'collect_field');
});

test('KERNEL V2 PHASE 1: lost-property report is INCIDENT and eligible for One-Mind response, not legacy transaction routing', async()=>{
  const message='ลูกค้าลืม Apple Watch ไว้ พนักงานหาแล้วยังไม่เจอ รออัปเดตอยู่';
  const run=scriptedConversation({
    [message]:semantic({
      domain:'incident',
      intent:'lost_property_followup',
      action:'provide_information',
      speechAct:'incident_report',
      entities:{item:'Apple Watch',status:'staff_searched_not_found'},
      constraints:['customer_waiting_for_update'],
    }),
  });
  const result=await run(message);
  assert.equal(result.semanticMeaning.conversationalMode,'INCIDENT');
  assert.equal(result.taskStateAfter.activeTask,null);
  assert.equal(result.dialogDecision.actionProposal,undefined);
  assert.equal(readOnlyCutoverEligibility(result).eligible,true);
});


test('REAL LINE: composed assistant reply is persisted so the next human reference can see what Thongthai actually said', async()=>{
  let snapshot:GuestAgentStateSnapshot={exists:false,state:{},updatedAt:null};
  let revision=0;
  const deps:Partial<OneMindDependencies>={
    resolveCanonicalGuestId:async()=>CANON,
    guestDbIdFromAnonymousId:async()=>GUEST,
    interpretSemanticTurn:async()=>semantic({
      domain:'membership',intent:'membership_information',action:'ask',speechAct:'question',
    }),
    buildKnowledgeAdapters:()=>({}),
    mirrorActivityTaskToLegacySession:async()=>{},
  };
  const stateDeps={
    loadSnapshot:async()=>snapshot,
    compareAndSwap:async(_id:string,current:GuestAgentStateSnapshot,patch:{set?:Record<string,unknown>;removeKeys?:string[]})=>{
      revision+=1;
      const next={...current.state,...(patch.set??{})};
      for(const key of patch.removeKeys??[]) delete next[key];
      snapshot={exists:true,state:next,updatedAt:new Date(NOW.getTime()+revision).toISOString()};
      return {status:'applied' as const,snapshot};
    },
  };
  const result=await processOneMindCustomerTurn({
    channel:'line',language:'th',message:'สมัครสมาชิกยังไง',
    eventId:'real-line-assistant-memory-1',providerUserKey:'line-key',persistState:true,
  },deps,stateDeps,NOW,{requireSemanticSupervisor:true});
  assert.equal(result.status,'composed');
  if(result.status!=='composed') return;
  const state=snapshot.state.conversationContext as {recentTurns?:Array<{role:string;content:string}>};
  assert.ok(state.recentTurns?.some(turn=>turn.role==='assistant'&&turn.content.includes('สมัครสมาชิก')),
    'assistant-facing answer must be bounded into conversation evidence for later references');
});


test('REAL LINE: compound horse availability plus preference keeps catalog facts for the recommendation clause', async()=>{
  const message='compound activity recommendation with timing';
  const run=scriptedConversation({
    [message]:semantic({
      domain:'activity',
      intent:'horse_riding_availability_and_fallback',
      action:'status',
      informationNeed:'availability',
      speechAct:'request',
      entities:{
        date:'2026-09-28',
        excludedHorse:'ทองไทย',
        preferredHorseTrait:'calm',
        weatherCondition:'rain',
      },
      constraints:['exclude_thongthai','calm_horse','rain_fallback_activity'],
    }),
  },{
    activity:{
      catalog:async()=>emptyResult('activity-catalog','activity_live'),
      availability:async()=>emptyResult('activity-schedule','activity_live'),
    },
  });
  const result=await run(message);
  const request=result.dialogDecision.knowledgeRequests.find(req=>req.domain==='activity');
  assert.ok(request);
  assert.ok(request.needs.includes('availability'));
  assert.ok(request.needs.includes('catalog'));
  assert.ok(request.needs.includes('entity_details'));
  assert.equal(result.dialogDecision.actionProposal,undefined);
});


test('REAL LINE: nontransactional horse selection is acknowledged before missing booking slots', async()=>{
  const first='เอาภาราดร';
  const follow='ตัวไหนนะที่เมื่อกี้บอกว่านิ่งกว่า เอาตัวนั้นแหละ';
  const run=scriptedConversation({
    [first]:semantic({
      domain:'activity',intent:'select_horse',action:'confirm',speechAct:'selection',
      entities:{resourceCode:'activity-horse',horseName:'ภาราดร'},
    }),
    [follow]:semantic({
      domain:'activity',intent:'select_activity_asset',action:'provide_information',speechAct:'selection',
      entities:{activity_asset:'ภาราดร'},constraints:['prefer_calm_horse'],
    }),
  },{
    activity:{catalog:async()=>emptyResult('activity-catalog','activity_live')},
  });
  await run(first);
  const result=await run(follow);
  assert.notEqual(result.dialogDecision.mode,'collect_field');
  assert.equal(result.dialogDecision.missingFields.length,0);
  assert.equal(result.dialogDecision.actionProposal,undefined);
});

test('REAL LINE: language correction value wins over shallow first-number extraction without leaving One-Mind', async()=>{
  const select='เอาภาราดร';
  const correction='เมื่อกี้บอก 5 คน ผิด จริง ๆ 4 คน แล้วมีเด็ก 1 คน';
  const meanings={
    [select]:semantic({
      domain:'activity',intent:'select_horse',action:'confirm',speechAct:'selection',
      entities:{resourceCode:'activity-horse',horseName:'ภาราดร'},
    }),
    [correction]:semantic({
      domain:'general',intent:'correct_party_size',action:'correct_previous',speechAct:'correction',
      entities:{partySize:4,children:1},
    }),
  };
  const run=scriptedConversation(meanings,{
    activity:{catalog:async()=>emptyResult('activity-catalog','activity_live')},
  });
  await run(select);
  const result=await run(correction);
  assert.equal(result.semanticTurn.semanticSource,'openai_supervisor');
  assert.equal(result.conversationContextAfter.workingMemory.partySize,4);
  assert.equal(result.semanticTurn.entities.partySize,4);
  assert.equal(result.semanticTurn.entities.children,1);
  assert.notEqual(result.dialogDecision.mode,'collect_field');
  assert.equal(result.dialogDecision.actionProposal,undefined);
});


test('REAL LINE: durable entity recommendation survives later cross-domain recommendations for descriptive follow-up', async()=>{
  let snapshot:GuestAgentStateSnapshot={exists:false,state:{},updatedAt:null};
  let rev=0;
  const makeFact=(key:string,value:unknown,domain:GroundedFact['domain'],sourceType:GroundedFact['sourceType']):GroundedFact=>({
    key,value,domain,sourceId:'sticky-rec-test',sourceType,authoritative:true,fetchedAt:NOW.toISOString(),
  });
  const ok=(sourceType:GroundedFact['sourceType'],data:GroundedFact[]):SourceResult=>({
    status:'ok',sourceId:'sticky-rec-test',sourceType,fetchedAt:NOW.toISOString(),data,
  });
  const meanings:Record<string,SemanticTurn>={
    horse:semantic({
      domain:'activity',intent:'recommend_calm_horse',action:'recommend',informationNeed:'recommendation',speechAct:'request',
      entities:{},constraints:['calm_temperament'],
    }),
    trip:semantic({
      domain:'journey',intent:'compose_trip',action:'recommend',informationNeed:'recommendation',speechAct:'request',
      entities:{tripDurationDays:2},constraints:[],
    }),
  };
  const deps:Partial<OneMindDependencies>={
    resolveCanonicalGuestId:async()=>CANON,
    guestDbIdFromAnonymousId:async()=>GUEST,
    interpretSemanticTurn:async message=>structuredClone(meanings[message]!),
    buildKnowledgeAdapters:()=>({
      activity:{catalog:async()=>ok('activity_live',[
        makeFact('activity:horse_riding:name','ขี่ม้า','activity','activity_live'),
        makeFact('activity_asset:horse-paradorn:name','ภาราดร','activity','activity_live'),
        makeFact('temperament:activity_asset:horse-paradorn','calm','activity','activity_live'),
      ])},
      restaurant:{menu:async()=>ok('restaurant_live',[makeFact('menu:m1:name','ไก่ย่าง','restaurant','restaurant_live')])},
      stay:{catalog:async()=>ok('stay_live',[makeFact('stay:s1:name','บ้านสองห้องนอน','stay','stay_live')])},
      otop:{catalog:async()=>ok('otop_live',[makeFact('otop:o1:name','ของฝากชุมชน','otop','otop_live')])},
    }),
  };
  const stateDeps={
    loadSnapshot:async()=>snapshot,
    compareAndSwap:async(_id:string,current:GuestAgentStateSnapshot,patch:{set?:Record<string,unknown>;removeKeys?:string[]},at:Date)=>{
      rev+=1;
      const next={...current.state,...(patch.set??{})};
      for(const key of patch.removeKeys??[]) delete next[key];
      snapshot={exists:true,state:next,updatedAt:new Date(at.getTime()+rev).toISOString()};
      return {status:'applied' as const,snapshot};
    },
  };
  const first=await processOneMindCustomerTurn({
    channel:'line',language:'th',message:'horse',eventId:'sticky-rec-1',
    providerUserKey:'sticky-rec',persistState:true,
  },deps,stateDeps,NOW,{requireSemanticSupervisor:true});
  assert.equal(first.status,'composed');
  const afterFirst=snapshot.state.conversationContext as {lastRecommendationReference?:string|null};
  assert.match(afterFirst.lastRecommendationReference??'',/ภาราดร/u);

  const second=await processOneMindCustomerTurn({
    channel:'line',language:'th',message:'trip',eventId:'sticky-rec-2',
    providerUserKey:'sticky-rec',persistState:true,
  },deps,stateDeps,new Date(NOW.getTime()+60_000),{requireSemanticSupervisor:true});
  assert.equal(second.status,'composed');
  const afterSecond=snapshot.state.conversationContext as {lastRecommendationReference?:string|null};
  assert.match(afterSecond.lastRecommendationReference??'',/ภาราดร/u);
});
