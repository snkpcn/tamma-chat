import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  composeGroundedDeterministicResponse,
  composeDeterministicResponse,
  type ResponseComposerInput,
} from '../netlify/functions/_response-composer';
import type { SemanticTurn } from '../netlify/functions/_semantic-interpreter';
import type { DialogDecision } from '../netlify/functions/_dialog-manager';
import type { KnowledgeBundle, GroundedFact, KnowledgeSourceType } from '../netlify/functions/_knowledge-resolver';
import type { DegradationPlan } from '../netlify/functions/_graceful-degradation';
import { createActiveTask, emptyTaskStateContainer, setSelectedEntities } from '../netlify/functions/_task-state';
import { deriveSemanticMeaning } from '../netlify/functions/_semantic-meaning';
import { deriveCanonicalKnowledgeScope, resolveCanonicalScopeAgainstFacts, filterFactsByCanonicalScope } from '../netlify/functions/_canonical-knowledge-scope';

const NOW='2026-09-27T05:00:00.000Z';
const AT=new Date(NOW);

function fact(key:string,value:unknown,domain:GroundedFact['domain'],sourceType:KnowledgeSourceType):GroundedFact{
  return {key,value,domain,sourceId:'human-response-test',sourceType,authoritative:true,fetchedAt:NOW};
}
function bundle(domain:KnowledgeBundle['domain'],sourceType:KnowledgeSourceType,rows:GroundedFact[]):KnowledgeBundle{
  return {
    domain,
    sources:[{need:'catalog',sourceId:'human-response-test',sourceType,status:'ok'}],
    facts:rows,entities:[],missing:[],warnings:[],freshness:'live',
  };
}
function semantic(overrides:Partial<SemanticTurn>):SemanticTurn{
  return {
    semanticSource:'openai_supervisor',
    domain:'general',intent:'test',action:'ask',informationNeed:'none',
    speechAct:'question',entities:{},references:[],constraints:[],
    confidence:.98,needsClarification:false,...overrides,
  };
}
function decision(overrides:Partial<DialogDecision>={}):DialogDecision{
  return {
    mode:'query_knowledge',
    taskStateContainer:emptyTaskStateContainer(),
    knowledgeRequests:[],
    missingFields:[],
    responseIntent:'grounded_answer',
    reasons:[],
    ...overrides,
  };
}
function degradation():DegradationPlan{
  return {
    version:'degradation-v1',condition:'none',level:'normal',reasonCodes:[],
    retryable:false,safeToExecuteTransaction:false,sourceStates:[],
  };
}
function input(args:{
  semanticTurn:SemanticTurn;
  bundles:KnowledgeBundle[];
  dialogDecision?:DialogDecision;
}):ResponseComposerInput{
  return {
    channel:'line',language:'th',userMessage:'test',
    semanticTurn:args.semanticTurn,
    dialogDecision:args.dialogDecision??decision(),
    knowledgeBundles:args.bundles,
    degradation:degradation(),
  };
}

const activityBundle=bundle('activity','activity_live',[
  fact('activity:horse_riding:name','ขี่ม้า','activity','activity_live'),
  fact('activity:archery:name','ยิงธนู','activity','activity_live'),
  fact('activity_asset:horse-paradorn:name','ภาราดร','activity','activity_live'),
  fact('activity_asset:horse-paradorn:activityCode','horse_riding','activity','activity_live'),
  fact('temperament:activity_asset:horse-paradorn','calm','activity','activity_live'),
  fact('beginnerSuitable:activity_asset:horse-paradorn',true,'activity','activity_live'),
  fact('activity_asset:horse-thongthai:name','ทองไทย','activity','activity_live'),
  fact('activity_asset:horse-thongthai:activityCode','horse_riding','activity','activity_live'),
  fact('temperament:activity_asset:horse-thongthai','lively','activity','activity_live'),
  fact('beginnerSuitable:activity_asset:horse-thongthai',true,'activity','activity_live'),
]);

test('grounded activity recommendation chooses the uniquely verified calm horse and answers rain clause honestly',()=>{
  const response=composeGroundedDeterministicResponse(input({
    semanticTurn:semantic({
      domain:'activity',intent:'horse_riding_with_rain_fallback',action:'recommend',informationNeed:'recommendation',
      entities:{date:'2026-09-28',time:'17:00',excludedHorse:'ทองไทย'},
      constraints:['exclude_thongthai','prefer_calm_horse','rain_fallback'],
    }),
    bundles:[activityBundle],
  }));
  assert.ok(response);
  assert.match(response.message,/ภาราดร/u);
  assert.match(response.message,/calm|นิ่ง/u);
  assert.match(response.message,/ฝน/u);
  assert.match(response.message,/ยิงธนู/u);
  assert.doesNotMatch(response.message,/ทองไทยตรงกว่า/u);
});

test('restaurant recommendation filters verified shrimp constraint and does not pretend unknown spice data is verified',()=>{
  const restaurant=bundle('restaurant','restaurant_live',[
    fact('menu:thai-salad:name','ตำไทย','restaurant','restaurant_live'),
    fact('menu:thai-salad:price',89,'restaurant','restaurant_live'),
    fact('menu:thai-salad:ingredients',['papaya','peanut'],'restaurant','restaurant_live'),
    fact('menu:shrimp:name','กุ้งทอด','restaurant','restaurant_live'),
    fact('menu:shrimp:price',220,'restaurant','restaurant_live'),
    fact('menu:shrimp:ingredients',['shrimp'],'restaurant','restaurant_live'),
    fact('menu:chicken:name','ไก่ย่าง','restaurant','restaurant_live'),
    fact('menu:chicken:price',180,'restaurant','restaurant_live'),
    fact('menu:chicken:ingredients',['chicken'],'restaurant','restaurant_live'),
  ]);
  const response=composeGroundedDeterministicResponse(input({
    semanticTurn:semantic({
      domain:'restaurant',intent:'meal_recommendation',action:'recommend',informationNeed:'recommendation',
      entities:{partySize:3,budget:1000},constraints:['no_shrimp','low_spicy'],
    }),
    bundles:[restaurant],
  }));
  assert.ok(response);
  assert.match(response.message,/ตำไทย/u);
  assert.match(response.message,/ไก่ย่าง/u);
  assert.doesNotMatch(response.message,/กุ้งทอด/u);
  assert.match(response.message,/เผ็ด.*ไม่มีข้อมูลยืนยัน|ไม่มีข้อมูลยืนยัน.*เผ็ด/u);
  assert.match(response.message,/อยู่ในงบ 1000 บาท/u);
});

// PR A item 3: a remembered "shrimp_allergy" (the durable-memory canonical
// key -- see _memory-relevance.ts's FOOD_CONSTRAINTS) must be recognized
// exactly like the current-turn "no_shrimp" phrasing above. Before this fix,
// none of the checked fragments matched "shrimp_allergy" literally, so a
// remembered allergy present in the merged constraint set was silently
// dropped from the actual recommendation text.
test('restaurant recommendation filters a REMEMBERED "shrimp_allergy" constraint the same as a stated "no_shrimp" one',()=>{
  const restaurant=bundle('restaurant','restaurant_live',[
    fact('menu:thai-salad:name','ตำไทย','restaurant','restaurant_live'),
    fact('menu:thai-salad:price',89,'restaurant','restaurant_live'),
    fact('menu:thai-salad:ingredients',['papaya','peanut'],'restaurant','restaurant_live'),
    fact('menu:shrimp:name','กุ้งทอด','restaurant','restaurant_live'),
    fact('menu:shrimp:price',220,'restaurant','restaurant_live'),
    fact('menu:shrimp:ingredients',['shrimp'],'restaurant','restaurant_live'),
  ]);
  const response=composeGroundedDeterministicResponse(input({
    semanticTurn:semantic({
      domain:'restaurant',intent:'meal_recommendation',action:'recommend',informationNeed:'recommendation',
      entities:{partySize:2},constraints:['shrimp_allergy'],
    }),
    bundles:[restaurant],
  }));
  assert.ok(response);
  assert.match(response.message,/ตำไทย/u);
  assert.doesNotMatch(response.message,/กุ้งทอด/u,
    'a remembered shrimp allergy must never surface a shrimp dish, even though the CURRENT turn never said "no_shrimp" itself');
});

test('journey renderer composes verified cross-domain options instead of dumping one catalog or generic fallback',()=>{
  const restaurant=bundle('restaurant','restaurant_live',[fact('menu:chicken:name','ไก่ย่าง','restaurant','restaurant_live')]);
  const stay=bundle('stay','stay_live',[fact('stay:two-bedroom:name','บ้านสองห้องนอน','stay','stay_live')]);
  const otop=bundle('otop','otop_live',[fact('otop:gift:name','ของฝากชุมชน','otop','otop_live')]);
  const response=composeGroundedDeterministicResponse(input({
    semanticTurn:semantic({
      domain:'journey',intent:'rough_two_night_itinerary',action:'recommend',informationNeed:'recommendation',
      entities:{tripDurationDays:2},constraints:['day1_horse','day2_meal_and_otop'],
    }),
    bundles:[activityBundle,restaurant,stay,otop],
  }));
  assert.ok(response);
  assert.match(response.message,/วันแรก/u);
  assert.match(response.message,/ขี่ม้า/u);
  assert.match(response.message,/วันที่สอง/u);
  assert.match(response.message,/ไก่ย่าง/u);
  assert.match(response.message,/ของฝากชุมชน/u);
  assert.match(response.message,/บ้านสองห้องนอน/u);
  assert.match(response.message,/ยังไม่ได้จอง/u);
});

test('promotion renderer respects no-new-membership semantic constraint',()=>{
  const promotion=bundle('promotion','promotion_runtime',[
    fact('promo:p1',{name:'โปรกินข้าวลด 10%',requiresMembership:false},'promotion','promotion_runtime'),
    fact('promo:p2',{name:'โปรสมาชิกใหม่',requiresMembership:true},'promotion','promotion_runtime'),
  ]);
  const response=composeGroundedDeterministicResponse(input({
    semanticTurn:semantic({
      domain:'promotion',intent:'recommend_restaurant_promotion',action:'recommend',informationNeed:'recommendation',
      constraints:['no_new_membership'],
    }),
    bundles:[promotion],
  }));
  assert.ok(response);
  assert.match(response.message,/โปรกินข้าวลด 10%/u);
  assert.doesNotMatch(response.message,/โปรสมาชิกใหม่/u);
});

test('active-task summary includes suspended selection and explicitly says nothing is confirmed',()=>{
  const horse={id:'activity_asset:horse-paradorn',type:'horse',name:'ภาราดร',domain:'activity' as const,source:'catalog' as const,canonical:true};
  const active=createActiveTask({type:'stay_booking',sourceChannel:'line',initialSlots:{partySize:3}},AT);
  const suspended=setSelectedEntities(
    createActiveTask({type:'activity_booking',sourceChannel:'line',initialSlots:{horseName:'ภาราดร',date:'2026-09-28'}},AT),
    [horse],
    AT,
  );
  const state={...emptyTaskStateContainer(),activeTask:active,suspendedTask:suspended};
  const response=composeDeterministicResponse(input({
    semanticTurn:semantic({domain:'stay',intent:'summarize_active_task',action:'ask',constraints:['no_transaction']}),
    bundles:[],
    dialogDecision:decision({mode:'answer',taskStateContainer:state,responseIntent:'active_task_summary',reasons:['task_summary_requested']}),
  }));
  assert.match(response.message,/รายการที่กำลังคุยอยู่/u);
  assert.match(response.message,/3 คน/u);
  assert.match(response.message,/รายการที่พักไว้ก่อน/u);
  assert.match(response.message,/ภาราดร/u);
  assert.match(response.message,/ยังไม่ได้ยืนยันการจอง/u);
});


test('selection without commitment acknowledges the choice and does not push booking-slot interrogation',()=>{
  const horse={id:'activity_asset:horse-paradorn',type:'horse',name:'ภาราดร',domain:'activity' as const,source:'catalog' as const,canonical:true};
  const active=setSelectedEntities(
    createActiveTask({type:'activity_booking',sourceChannel:'line',initialSlots:{horseName:'ภาราดร'}},AT),
    [horse],
    AT,
  );
  const state={...emptyTaskStateContainer(),activeTask:active};
  const response=composeDeterministicResponse(input({
    semanticTurn:semantic({
      domain:'activity',intent:'select_previous_calm_horse',action:'confirm',speechAct:'selection',
      entities:{horseName:'ภาราดร'},references:[{type:'entity_selection',value:'ภาราดร',refersToPriorContext:true,resolvedEntityId:horse.id}],
    }),
    bundles:[],
    dialogDecision:decision({
      mode:'collect_field',taskStateContainer:state,responseIntent:'ask_missing_field',
      missingFields:['durationMinutes','date'],reasons:['missing_field'],
    }),
  }));
  assert.match(response.message,/ภาราดร/u);
  assert.match(response.message,/ยังไม่ได้จอง/u);
  assert.doesNotMatch(response.message,/30.*60.*90|เลือกระยะเวลา/u);
});

test('non-transactional party-size correction is acknowledged rather than becoming a generic fallback',()=>{
  const response=composeDeterministicResponse(input({
    semanticTurn:semantic({
      domain:'activity',intent:'correct_party_size',action:'correct_previous',speechAct:'correction',
      entities:{partySize:4,children:1},
    }),
    bundles:[],
    dialogDecision:decision({mode:'answer',responseIntent:'grounded_answer'}),
  }));
  assert.match(response.message,/4 คน/u);
  assert.match(response.message,/เด็ก 1 คน/u);
  assert.match(response.message,/ยังไม่ได้จอง/u);
  assert.doesNotMatch(response.message,/ตอบเรื่องนี้ให้แม่นไม่ได้|ขอรายละเอียดเพิ่ม/u);
});

test('non-transactional duration correction names the accepted duration without implying a booking',()=>{
  const response=composeDeterministicResponse(input({
    semanticTurn:semantic({
      domain:'activity',intent:'correct_duration',action:'correct_previous',speechAct:'selection',
      entities:{durationMinutes:45},constraints:['no_transaction'],
    }),
    bundles:[],
    dialogDecision:decision({mode:'query_knowledge',responseIntent:'grounded_answer',reasons:['transaction_commitment_revoked','nontransactional_state_update_preserved']}),
  }));
  assert.match(response.message,/45 นาที/u);
  assert.match(response.message,/ยังไม่ได้จอง/u);
  assert.doesNotMatch(response.message,/แก้ข้อมูลตามที่บอก/u);
});


test('compound availability turn still renders the grounded horse recommendation and rain fallback',()=>{
  const availabilityBundle:KnowledgeBundle={
    domain:'activity',
    sources:[{need:'availability',sourceId:'availability-test',sourceType:'activity_live',status:'empty'}],
    facts:[],entities:[],missing:['availability'],warnings:[],freshness:'live',
  };
  const response=composeGroundedDeterministicResponse(input({
    semanticTurn:semantic({
      domain:'activity',
      intent:'horse_riding_availability_and_rain_fallback',
      action:'status',
      informationNeed:'availability',
      entities:{excludedHorse:'ทองไทย',preferredHorseTrait:'calm',weatherCondition:'rain'},
      constraints:['exclude_thongthai','calm_horse','rain_fallback_activity'],
    }),
    bundles:[activityBundle,availabilityBundle],
  }));
  assert.ok(response);
  assert.match(response.message,/ภาราดร/u);
  assert.match(response.message,/ฝน/u);
  assert.match(response.message,/ยิงธนู/u);
  assert.match(response.message,/คิว|เวลา/u);
});

test('restaurant recommendation reads a structured budget amount object without losing the budget constraint',()=>{
  const restaurant=bundle('restaurant','restaurant_live',[
    fact('menu:thai-salad:name','ตำไทย','restaurant','restaurant_live'),
    fact('menu:thai-salad:price',89,'restaurant','restaurant_live'),
    fact('menu:thai-salad:ingredients',['papaya'],'restaurant','restaurant_live'),
    fact('menu:chicken:name','ไก่ย่าง','restaurant','restaurant_live'),
    fact('menu:chicken:price',180,'restaurant','restaurant_live'),
    fact('menu:chicken:ingredients',['chicken'],'restaurant','restaurant_live'),
  ]);
  const response=composeGroundedDeterministicResponse(input({
    semanticTurn:semantic({
      domain:'restaurant',intent:'meal_recommendation',action:'recommend',informationNeed:'recommendation',
      entities:{partySize:3,budget:{amount:1000,currency:'THB'}},constraints:['no_shrimp'],
    }),
    bundles:[restaurant],
  }));
  assert.ok(response);
  assert.match(response.message,/งบ 1000 บาท/u);
});


test('selection emitted as provide_information with activity_asset is acknowledged and never turns into a duration prompt',()=>{
  const horse={id:'activity_asset:horse-paradorn',type:'horse',name:'ภาราดร',domain:'activity' as const,source:'catalog' as const,canonical:true};
  const active=setSelectedEntities(
    createActiveTask({type:'activity_booking',sourceChannel:'line',initialSlots:{resourceCode:'activity-horse'}},AT),
    [horse],
    AT,
  );
  const state={...emptyTaskStateContainer(),activeTask:active};
  const response=composeDeterministicResponse(input({
    semanticTurn:semantic({
      domain:'activity',
      intent:'select_activity_asset',
      action:'provide_information',
      speechAct:'selection',
      entities:{activity_asset:'ภาราดร'},
      constraints:['prefer_calm_horse'],
    }),
    bundles:[],
    dialogDecision:decision({
      mode:'answer',
      taskStateContainer:state,
      responseIntent:'grounded_answer',
      missingFields:[],
      reasons:['nontransactional_state_update_preserved'],
    }),
  }));
  assert.match(response.message,/ภาราดร/u);
  assert.match(response.message,/ยังไม่ได้จอง/u);
  assert.doesNotMatch(response.message,/30.*60|เลือกระยะเวลา|ขอ.*วัน/u);
});

test('horse replacement emitted as modify with activity_asset acknowledges the new horse',()=>{
  const response=composeDeterministicResponse(input({
    semanticTurn:semantic({
      domain:'activity',
      intent:'change_horse_selection',
      action:'modify',
      speechAct:'selection',
      entities:{activity_asset:'ทองไทย'},
      constraints:['keep_same_time'],
    }),
    bundles:[],
    dialogDecision:decision({mode:'answer',responseIntent:'grounded_answer'}),
  }));
  assert.match(response.message,/ทองไทย/u);
  assert.match(response.message,/ยังไม่ได้จอง/u);
});


test('stay availability clarification never borrows a stale activity entity from another domain',()=>{
  const horse={id:'activity_asset:horse-paradorn',type:'horse',name:'ภาราดร',domain:'activity' as const,source:'catalog' as const,canonical:true};
  const staleActivity=setSelectedEntities(
    createActiveTask({type:'activity_booking',sourceChannel:'line',initialSlots:{horseName:'ภาราดร'}},AT),
    [horse],
    AT,
  );
  const state={...emptyTaskStateContainer(),activeTask:staleActivity};
  const response=composeDeterministicResponse(input({
    semanticTurn:semantic({
      domain:'stay',
      intent:'find_available_room_for_three',
      action:'status',
      informationNeed:'availability',
      speechAct:'request',
      entities:{partySize:3,resourceType:'room'},
      needsClarification:true,
    }),
    bundles:[],
    dialogDecision:decision({
      mode:'clarify',
      taskStateContainer:state,
      responseIntent:'clarify_ambiguous_entity',
      reasons:['ambiguous_entity'],
    }),
  }));
  assert.match(response.message,/วันไหน|เข้าพัก/u);
  assert.doesNotMatch(response.message,/ภาราดร|ขี่ม้า/u);
});


test('conditional horse availability answers the named fallback rule instead of dumping the activity catalog',()=>{
  const availability:KnowledgeBundle={
    domain:'activity',
    sources:[{need:'availability',sourceId:'availability-test',sourceType:'activity_live',status:'empty'}],
    facts:[],entities:[],missing:['availability'],warnings:[],freshness:'live',
  };
  const response=composeGroundedDeterministicResponse(input({
    semanticTurn:semantic({
      domain:'activity',
      intent:'check_horse_availability_with_fallback',
      action:'status',
      informationNeed:'availability',
      speechAct:'request',
      entities:{
        primaryResource:{id:'activity_asset:horse-paradorn',name:'ภาราดร'},
        fallbackResource:{id:'activity_asset:horse-thongthai',name:'ทองไทย'},
      },
      constraints:['fallback_to_thongthai_if_paradorn_unavailable','no_booking_if_both_unavailable','no_transaction'],
    }),
    bundles:[activityBundle,availability],
  }));
  assert.ok(response);
  assert.match(response.message,/ภาราดร/u);
  assert.match(response.message,/ทองไทย/u);
  assert.match(response.message,/ยังไม่ได้.*จอง|ไม่ได้เลือกหรือจอง/u);
  assert.doesNotMatch(response.message,/กิจกรรมที่มีตอนนี้/u);
});

test('light-activity recommendation lists verified activities, not only horse asset names',()=>{
  const response=composeGroundedDeterministicResponse(input({
    semanticTurn:semantic({
      domain:'activity',
      intent:'recommend_light_afternoon_activities',
      action:'recommend',
      informationNeed:'recommendation',
      speechAct:'question',
      entities:{party:{children:2,adults:3}},
      constraints:['light_activity'],
    }),
    bundles:[activityBundle],
  }));
  assert.ok(response);
  assert.match(response.message,/ขี่ม้า/u);
  assert.match(response.message,/ยิงธนู/u);
  assert.match(response.message,/ความหนัก|ไม่ขอเดา/u);
  assert.doesNotMatch(response.message,/ภาราดร \/ ทองไทย/u);
});


test('conditional availability renderer preserves preferredAsset and fallbackAsset names from live semantic shape',()=>{
  const availabilityBundle:KnowledgeBundle={
    domain:'activity',
    sources:[{need:'availability',sourceId:'availability-test',sourceType:'activity_live',status:'empty'}],
    facts:[],entities:[],missing:['availability'],warnings:[],freshness:'live',
  };
  const response=composeGroundedDeterministicResponse(input({
    semanticTurn:semantic({
      domain:'activity',
      intent:'conditional_horse_availability_with_fallback',
      action:'status',
      informationNeed:'availability',
      entities:{
        preferredAsset:{id:'activity_asset:horse-paradorn',name:'ภาราดร'},
        fallbackAsset:{id:'activity_asset:horse-thongthai',name:'ทองไทย'},
      },
      constraints:['fallback_to_thongthai_if_paradorn_unavailable','no_booking_if_both_unavailable','no_transaction'],
    }),
    bundles:[availabilityBundle],
  }));
  assert.ok(response);
  assert.match(response.message,/ภาราดร/u);
  assert.match(response.message,/ทองไทย/u);
  assert.match(response.message,/ยังไม่ได้.*จอง|ยังไม่ได้ทำรายการ/u);
});


test('conditional availability renderer preserves generic primary/fallback live aliases',()=>{
  const availabilityBundle:KnowledgeBundle={
    domain:'activity',
    sources:[{need:'availability',sourceId:'availability-test',sourceType:'activity_live',status:'empty'}],
    facts:[],entities:[],missing:['availability'],warnings:[],freshness:'live',
  };
  const response=composeGroundedDeterministicResponse(input({
    semanticTurn:semantic({
      domain:'activity',
      intent:'conditional_horse_availability_with_fallback',
      action:'status',
      informationNeed:'availability',
      entities:{
        primary:{type:'activity_asset',id:'activity_asset:horse-paradorn',name:'ภาราดร'},
        fallback:{type:'activity_asset',id:'activity_asset:horse-thongthai',name:'ทองไทย'},
      },
      constraints:['prefer_horse_paradorn','fallback_horse_thongthai_if_paradorn_unavailable','no_booking_if_both_unavailable','no_transaction_now'],
    }),
    bundles:[availabilityBundle],
  }));
  assert.ok(response);
  assert.match(response.message,/ภาราดร/u);
  assert.match(response.message,/ทองไทย/u);
  assert.match(response.message,/ไม่ได้.*จอง|ไม่ได้ทำรายการ/u);
});

// Production smoke-test regression (2026-09-27): "อยากขี่ม้าพรุ่งนี้ตอนเย็น
// มีม้าตัวไหนแนะนำบ้างครับ" (a plain "which horse do you recommend"
// request, no calm/beginner/light/rain preference and nothing excluded) hit
// renderActivityRecommendation's final catch-all branch, which listed EVERY
// activity_asset fact present -- ATVs and archery lanes included -- instead
// of scoping to the one activity type the semantic turn's own entities
// already identified. Originally fixed with a downstream ACTIVITY_TYPE_MARKERS
// regex at render time; Human Core PR C retired that regex and moved scoping
// upstream into _knowledge-resolver.ts's own response scope firewall (see
// _canonical-knowledge-scope.ts), driven by the semantic turn's
// entities.activityCode -- scopedBundle below simulates exactly what that
// firewall already does to a KnowledgeBundle before a renderer ever sees it,
// so this test still proves the SAME production guarantee through the real
// current mechanism, not the retired one.
function scopedBundle(turn:SemanticTurn, source:KnowledgeBundle):KnowledgeBundle{
  const scope=deriveCanonicalKnowledgeScope(deriveSemanticMeaning(turn));
  const refined=resolveCanonicalScopeAgainstFacts(scope, source.facts);
  return {...source, facts:[...filterFactsByCanonicalScope(source.facts, refined)]};
}

const mixedActivityBundle=bundle('activity','activity_live',[
  fact('activity:horse_riding:name','ขี่ม้า','activity','activity_live'),
  fact('activity_asset:horse-paradorn:name','ภาราดร','activity','activity_live'),
  fact('activity_asset:horse-paradorn:activityCode','horse_riding','activity','activity_live'),
  fact('activity_asset:horse-paradorn:type','horse','activity','activity_live'),
  fact('activity_asset:horse-thongthai:name','ทองไทย','activity','activity_live'),
  fact('activity_asset:horse-thongthai:activityCode','horse_riding','activity','activity_live'),
  fact('activity_asset:horse-thongthai:type','horse','activity','activity_live'),
  fact('activity:atv:name','ATV','activity','activity_live'),
  fact('activity_asset:atv-1:name','ATV 1','activity','activity_live'),
  fact('activity_asset:atv-1:activityCode','atv','activity','activity_live'),
  fact('activity_asset:atv-1:type','atv','activity','activity_live'),
  fact('activity_asset:atv-2:name','ATV 2','activity','activity_live'),
  fact('activity_asset:atv-2:activityCode','atv','activity','activity_live'),
  fact('activity_asset:atv-2:type','atv','activity','activity_live'),
  fact('activity:archery:name','ยิงธนู','activity','activity_live'),
  fact('activity_asset:archery-1:name','ช่องยิง 1','activity','activity_live'),
  fact('activity_asset:archery-1:activityCode','archery','activity','activity_live'),
  fact('activity_asset:archery-1:type','archery','activity','activity_live'),
]);

test('a plain horse-riding recommendation request never surfaces ATV or archery assets from the shared activity catalog',()=>{
  const turn=semantic({
    domain:'activity',intent:'horse_riding_recommendation',action:'recommend',informationNeed:'recommendation',
    entities:{activityCode:'horse_riding',date:'2026-09-28',timeOfDay:'evening'},
    normalizedMeaning:'Customer wants to go horse riding tomorrow evening and asks which horse is recommended.',
  });
  const response=composeGroundedDeterministicResponse(input({
    semanticTurn:turn,
    bundles:[scopedBundle(turn,mixedActivityBundle)],
  }));
  assert.ok(response);
  assert.doesNotMatch(response.message,/ATV/u,'must not surface ATV assets for a horse-only request');
  assert.doesNotMatch(response.message,/ช่องยิง|ยิงธนู/u,'must not surface archery assets for a horse-only request');
  assert.match(response.message,/ภาราดร/u);
  assert.match(response.message,/ทองไทย/u);
});

test('a plain ATV recommendation request never surfaces horse or archery assets from the shared activity catalog',()=>{
  const turn=semantic({
    domain:'activity',intent:'atv_recommendation',action:'recommend',informationNeed:'recommendation',
    entities:{activityCode:'atv'},
    normalizedMeaning:'Customer asks which ATV is recommended.',
  });
  const response=composeGroundedDeterministicResponse(input({
    semanticTurn:turn,
    bundles:[scopedBundle(turn,mixedActivityBundle)],
  }));
  assert.ok(response);
  assert.doesNotMatch(response.message,/ภาราดร|ทองไทย/u,'must not surface horse assets for an ATV-only request');
  assert.doesNotMatch(response.message,/ช่องยิง|ยิงธนู/u,'must not surface archery assets for an ATV-only request');
  assert.match(response.message,/ATV 1/u);
  assert.match(response.message,/ATV 2/u);
});
