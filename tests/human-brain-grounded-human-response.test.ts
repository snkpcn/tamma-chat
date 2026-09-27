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
