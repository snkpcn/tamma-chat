import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSemanticInterpreterPrompt,
  emptySemanticContext,
  SEMANTIC_INTERPRETER_VERSION,
  parseSemanticTurnResponse,
} from '../netlify/functions/_semantic-interpreter';
import { SEMANTIC_EVAL_CORPUS } from './fixtures/semantic-eval-corpus';

function byId(id: string) {
  const item = SEMANTIC_EVAL_CORPUS.find((row) => row.id === id);
  assert.ok(item, `missing fixture ${id}`);
  return item;
}

test('semantic-v29 keeps the five live-failure gold decisions unchanged', () => {
  assert.deepEqual(byId('discover-05').expected, { domain: 'ecosystem', action: 'recommend' });
  assert.deepEqual(byId('discover-06').expected, { domain: 'ecosystem', action: 'recommend' });
  assert.deepEqual(byId('multi-intent-01').expected, { domain: 'restaurant', action: 'discover' });
  assert.deepEqual(byId('correction-03').expected, { domain: 'activity', action: 'correct_previous' });
  assert.deepEqual(byId('informational-02').expected, { domain: 'activity', action: 'discover' });
});

test('semantic-v29 terminal audit distinguishes requested judgment from neutral browse', () => {
  const prompt = buildSemanticInterpreterPrompt(emptySemanticContext()).replace(/\s+/g, ' ');
  assert.ok(prompt.includes('the unknown answer itself is qualified as desirable, worthwhile, appealing, or good'));
  assert.ok(prompt.includes('sentence-final evaluative wording modifies the requested choice'));
});

test('semantic-v29 terminal audit preserves primary domain and explicit category ownership', () => {
  const prompt = buildSemanticInterpreterPrompt(emptySemanticContext()).replace(/\s+/g, ' ');
  assert.ok(prompt.includes('A secondary coordinated request does not widen a specific primary domain to ecosystem'));
  assert.ok(prompt.includes('an explicit canonical category noun owns its category domain even inside a general location frame'));
});

test('semantic-v29 terminal audit separates repair from intentional change', () => {
  const prompt = buildSemanticInterpreterPrompt(emptySemanticContext()).replace(/\s+/g, ' ');
  assert.ok(prompt.includes('rejects an earlier value as wrong and supplies its replacement'));
  assert.ok(prompt.includes('correct_previous, not modify'));
});

test('semantic-v29 version is explicit', () => {
  assert.equal(SEMANTIC_INTERPRETER_VERSION, 'semantic-v31');
});


test('incident_report with unknown domain is repaired to incident without hiding clarification', () => {
  const turn = parseSemanticTurnResponse(JSON.stringify({
    normalizedMeaning:'lost pet nearby',
    speechAct:'incident_report',
    domain:'unknown',
    intent:'report_missing_pet',
    action:'provide_information',
    informationNeed:'none',
    entities:{},
    references:[],
    constraints:[],
    confidence:0.96,
    needsClarification:true,
    clarificationReason:'exact_location_missing',
  }), emptySemanticContext());
  assert.equal(turn.domain, 'incident');
  assert.equal(turn.speechAct, 'incident_report');
  assert.equal(turn.needsClarification, true);
});


test('self-directed pause with stray suspend directive stays a statement when no task exists', () => {
  const turn = parseSemanticTurnResponse(JSON.stringify({
    normalizedMeaning:'partner is tired and customer will pause briefly',
    speechAct:'request',
    domain:'general',
    intent:'pause_briefly',
    action:'provide_information',
    informationNeed:'none',
    taskDirective:'suspend_active',
    entities:{},
    references:[],
    constraints:[],
    confidence:0.96,
    needsClarification:false,
  }), emptySemanticContext());
  assert.equal(turn.domain, 'general');
  assert.equal(turn.speechAct, 'statement');
  assert.equal(turn.taskDirective, undefined);
});

test('incident domain survives an unresolved deictic reference while clarification remains true', () => {
  const turn = parseSemanticTurnResponse(JSON.stringify({
    normalizedMeaning:'pet is missing around there',
    speechAct:'incident_report',
    domain:'unknown',
    intent:'report_missing_pet',
    action:'provide_information',
    informationNeed:'none',
    entities:{},
    references:[{type:'location_reference',value:'there',refersToPriorContext:true}],
    constraints:[],
    confidence:0.96,
    needsClarification:false,
  }), emptySemanticContext());
  assert.equal(turn.domain, 'incident');
  assert.equal(turn.speechAct, 'incident_report');
  assert.equal(turn.needsClarification, true);
});


test('generic previous-plan reference is backed by bounded conversation evidence without inventing an entity id', () => {
  const context = {
    ...emptySemanticContext(),
    activeDomain:'journey' as const,
    recentTurns:[
      {role:'user' as const,content:'ช่วยจัดทริปคร่าว ๆ'},
      {role:'assistant' as const,content:'วันแรกขี่ม้า วันที่สองกินข้าวแล้วซื้อของฝาก'},
    ],
    lastRecommendationReference:'วันแรกขี่ม้า วันที่สองกินข้าวแล้วซื้อของฝาก',
  };
  const turn = parseSemanticTurnResponse(JSON.stringify({
    normalizedMeaning:'keep the previous plan but move it to tomorrow',
    speechAct:'correction',
    domain:'journey',
    intent:'modify_previous_plan_date',
    action:'modify',
    informationNeed:'none',
    entities:{date:'2026-09-28'},
    references:[{type:'previous_plan',value:'previous plan',refersToPriorContext:true}],
    constraints:[],
    confidence:0.97,
    needsClarification:false,
  }), context);
  assert.equal(turn.domain,'journey');
  assert.equal(turn.needsClarification,false);
  assert.equal(turn.references[0]?.resolvedFromConversation,true);
  assert.equal(turn.references[0]?.resolvedEntityId,undefined);
});


test('local-area question keeps local domain when the deictic place reference needs clarification', () => {
  const turn = parseSemanticTurnResponse(JSON.stringify({
    normalizedMeaning:'asking about animals in the surrounding area',
    speechAct:'question',
    domain:'local',
    intent:'ask_local_conditions',
    action:'ask',
    informationNeed:'none',
    entities:{},
    references:[{type:'location_reference',value:'around there',refersToPriorContext:true}],
    constraints:[],
    confidence:0.95,
    needsClarification:false,
  }), emptySemanticContext());
  assert.equal(turn.domain, 'local');
  assert.equal(turn.speechAct, 'question');
  assert.equal(turn.needsClarification, true);
});


test('semantic entity aliases canonicalize snake_case structural slots for downstream state', () => {
  const turn = parseSemanticTurnResponse(JSON.stringify({
    normalizedMeaning:'check table for four people',
    speechAct:'question',
    domain:'restaurant',
    intent:'check_table_availability',
    action:'status',
    informationNeed:'availability',
    entities:{party_size:4,child_count:1,adult_count:3},
    references:[],
    constraints:[],
    confidence:0.98,
    needsClarification:false,
  }), emptySemanticContext());
  assert.equal(turn.entities.partySize,4);
  assert.equal(turn.entities.children,1);
  assert.equal(turn.entities.adults,3);
});

test('cross-domain recommendation with multiple organization domains is canonical journey planning', () => {
  const turn = parseSemanticTurnResponse(JSON.stringify({
    normalizedMeaning:'plan two days with stay activity meal and souvenirs',
    speechAct:'request',
    domain:'ecosystem',
    intent:'plan_two_day_itinerary',
    action:'recommend',
    informationNeed:'recommendation',
    entities:{
      stay:{nights:2},
      activity:{type:'horse_riding',day:1},
      restaurant:{purpose:'meal',day:2},
      otop:{purpose:'souvenir',day:2},
    },
    references:[],
    constraints:['day_1_horse','day_2_meal','day_2_souvenir'],
    confidence:0.98,
    needsClarification:false,
  }), emptySemanticContext());
  assert.equal(turn.domain,'journey');
  assert.equal(turn.action,'recommend');
});

test('prior-plan modification stays journey when bounded conversation evidence resolves the reference', () => {
  const context = {
    ...emptySemanticContext(),
    activeDomain:'journey' as const,
    recentTurns:[{role:'assistant' as const,content:'A verified two-day plan was just discussed.'}],
    lastRecommendationReference:'two-day plan',
  };
  const turn = parseSemanticTurnResponse(JSON.stringify({
    normalizedMeaning:'keep the prior plan but move it to tomorrow',
    speechAct:'request',
    domain:'ecosystem',
    intent:'modify_itinerary_date',
    action:'modify',
    informationNeed:'none',
    entities:{date:'2026-09-28'},
    references:[{type:'previous_request',value:'prior plan',refersToPriorContext:true}],
    constraints:[],
    confidence:0.98,
    needsClarification:false,
  }), context);
  assert.equal(turn.domain,'journey');
  assert.equal(turn.needsClarification,false);
});


test('structured multi-step ecosystem plan canonicalizes to journey', () => {
  const turn = parseSemanticTurnResponse(JSON.stringify({
    normalizedMeaning:'two-night multi-step plan',
    speechAct:'request',
    domain:'ecosystem',
    intent:'plan_multi_day_itinerary',
    action:'recommend',
    informationNeed:'recommendation',
    entities:{
      stay:{nights:2},
      activities:[
        {name:'horse riding',day:1},
        {name:'dining',day:2},
        {name:'souvenir shopping',day:2},
      ],
    },
    references:[],
    constraints:['stay_two_nights'],
    confidence:0.97,
    needsClarification:false,
  }), emptySemanticContext());
  assert.equal(turn.domain, 'journey');
  assert.equal(turn.action, 'recommend');
  assert.equal(turn.informationNeed, 'recommendation');
});

test('active-task summary ignores stale unresolved references and never asks clarification', () => {
  const turn = parseSemanticTurnResponse(JSON.stringify({
    normalizedMeaning:'summarize current selections without booking',
    speechAct:'question',
    domain:'activity',
    intent:'summarize_active_task',
    action:'ask',
    informationNeed:'none',
    entities:{},
    references:[{type:'previous_selection',value:'that one',refersToPriorContext:true}],
    constraints:['no_booking'],
    confidence:0.97,
    needsClarification:true,
    clarificationReason:'stale_reference',
  }), emptySemanticContext());
  assert.equal(turn.intent, 'summarize_active_task');
  assert.equal(turn.needsClarification, false);
  assert.equal(turn.references.length, 0);
  assert.equal(turn.clarificationReason, undefined);
});


test('camelCase counts and selected_activity_asset canonicalize to downstream task fields', () => {
  const turn = parseSemanticTurnResponse(JSON.stringify({
    normalizedMeaning:'change the selected horse and correct group composition',
    speechAct:'correction',
    domain:'activity',
    intent:'change_selection_and_group',
    action:'correct_previous',
    informationNeed:'none',
    entities:{selected_activity_asset:'ทองไทย',partySize:4,childCount:1,adultCount:3},
    references:[],
    constraints:[],
    confidence:0.98,
    needsClarification:false,
  }), emptySemanticContext());
  assert.equal(turn.entities.horseName,'ทองไทย');
  assert.equal(turn.entities.partySize,4);
  assert.equal(turn.entities.children,1);
  assert.equal(turn.entities.adults,3);
});


test('descriptive prior recommendation selection resolves the unique recommended entity across topic switches', () => {
  const context = {
    ...emptySemanticContext(),
    activeDomain:'ecosystem' as const,
    recentEntities:[
      {id:'activity_asset:horse-paradorn',type:'horse',name:'ภาราดร',domain:'activity' as const,source:'catalog' as const,canonical:true},
      {id:'activity_asset:horse-thongthai',type:'horse',name:'ทองไทย',domain:'activity' as const,source:'catalog' as const,canonical:true},
    ],
    lastRecommendationReference:'ถ้าเอาตามเงื่อนไขที่บอก ตอนนี้ ภาราดร ตรงกว่าครับ ข้อมูลที่มีระบุลักษณะว่า calm',
  };
  const turn = parseSemanticTurnResponse(JSON.stringify({
    normalizedMeaning:'select the horse previously recommended as calmer',
    speechAct:'selection',
    domain:'ecosystem',
    intent:'select_previous_recommendation',
    action:'provide_information',
    informationNeed:'none',
    entities:{},
    references:[{type:'previous_selection',value:'the calmer one',refersToPriorContext:true}],
    constraints:[],
    confidence:0.96,
    needsClarification:true,
    clarificationReason:'reference_uncertain',
  }), context);
  assert.equal(turn.domain,'activity');
  assert.equal(turn.action,'confirm');
  assert.equal(turn.needsClarification,false);
  assert.equal(turn.references[0]?.resolvedEntityId,'activity_asset:horse-paradorn');
  assert.equal(turn.references[0]?.resolvedFromRecommendation,true);
});


test('elliptic price question uses same-domain active task instead of needless semantic clarification', () => {
  const context = {
    ...emptySemanticContext(),
    activeDomain:'activity' as const,
    activeTask:{
      type:'activity_booking',
      domain:'activity' as const,
      status:'collecting',
      knownSlots:{resourceCode:'activity-horse',horseName:'ภาราดร'},
      missingFields:['durationMinutes','date'],
      selectedEntities:[{id:'activity_asset:horse-paradorn',type:'horse',name:'ภาราดร',domain:'activity' as const,source:'catalog' as const,canonical:true}],
      constraints:[],
    },
  };
  const turn = parseSemanticTurnResponse(JSON.stringify({
    normalizedMeaning:'check the price of the current item before deciding',
    speechAct:'question',
    domain:'activity',
    intent:'check_price_before_deciding',
    action:'ask',
    informationNeed:'price',
    entities:{},
    references:[],
    constraints:['no_booking_now'],
    confidence:0.95,
    needsClarification:true,
    clarificationReason:'item_not_repeated',
  }), context);
  assert.equal(turn.domain,'activity');
  assert.equal(turn.informationNeed,'price');
  assert.equal(turn.needsClarification,false);
});


test('live ecosystem itinerary shape canonicalizes to journey', () => {
  const turn = parseSemanticTurnResponse(JSON.stringify({
    normalizedMeaning:'two-night trip: horse on day one, food and souvenirs on day two',
    speechAct:'request',
    domain:'ecosystem',
    intent:'plan_multi_day_itinerary',
    action:'recommend',
    informationNeed:'recommendation',
    entities:{
      stayDurationNights:2,
      itinerary:[
        {day:1,activity:'horse riding'},
        {day:2,activities:['dining','souvenir shopping']},
      ],
    },
    references:[],
    constraints:[],
    confidence:0.98,
    needsClarification:false,
  }), emptySemanticContext());
  assert.equal(turn.domain,'journey');
  assert.equal(turn.intent,'plan_multi_day_itinerary');
  assert.equal(turn.action,'recommend');
});


test('mixed stay activity dining shopping live shape canonicalizes ecosystem plan to journey', () => {
  const turn = parseSemanticTurnResponse(JSON.stringify({
    normalizedMeaning:'two-night mixed ecosystem itinerary',
    speechAct:'request',
    domain:'ecosystem',
    intent:'plan_two_night_itinerary',
    action:'recommend',
    informationNeed:'recommendation',
    entities:{
      stay:{nights:2},
      activities:[{name:'horse riding',day:1}],
      dining:{day:2},
      shopping:{category:'souvenir',domain:'otop',day:2},
    },
    references:[],
    constraints:['stay_two_nights','horse_riding_day_1','dining_day_2','souvenir_shopping_day_2'],
    confidence:0.99,
    needsClarification:false,
  }), emptySemanticContext());
  assert.equal(turn.domain,'journey');
});


test('nested reservation envelope exposes canonical date time and partySize slots', () => {
  const turn = parseSemanticTurnResponse(JSON.stringify({
    normalizedMeaning:'check a table for four people tomorrow around 18:00',
    speechAct:'question',
    domain:'restaurant',
    intent:'check_table_availability_with_nearby_time_recommendation',
    action:'status',
    informationNeed:'availability',
    entities:{reservation:{date:'2026-09-28',time:'~18:00',partySize:4}},
    references:[],
    constraints:['fallback_nearby_time_if_unavailable'],
    confidence:0.97,
    needsClarification:false,
  }), emptySemanticContext());
  assert.equal(turn.entities.date,'2026-09-28');
  assert.equal(turn.entities.time,'~18:00');
  assert.equal(turn.entities.partySize,4);
});

test('resolved previous-plan continuation inherits journey domain and suppresses redundant clarification', () => {
  const context = {
    ...emptySemanticContext(),
    activeDomain:'journey' as const,
    recentTurns:[
      {role:'user' as const,content:'plan a two-day trip'},
      {role:'assistant' as const,content:'day one horse riding, day two meal and souvenirs'},
    ],
    lastRecommendationReference:'day one horse riding, day two meal and souvenirs',
  };
  const turn = parseSemanticTurnResponse(JSON.stringify({
    normalizedMeaning:'keep the same plan but move it to tomorrow',
    speechAct:'correction',
    domain:'unknown',
    intent:'modify_previous_plan_date',
    action:'modify',
    informationNeed:'none',
    entities:{date:'2026-09-28'},
    references:[{type:'previous_plan',value:'same plan',refersToPriorContext:true}],
    constraints:[],
    confidence:0.78,
    needsClarification:true,
    clarificationReason:'prior_plan_reference',
  }), context);
  assert.equal(turn.domain,'journey');
  assert.equal(turn.action,'modify');
  assert.equal(turn.references[0]?.resolvedFromConversation,true);
  assert.equal(turn.needsClarification,false);
  assert.equal(turn.clarificationReason,undefined);
});

// Real 16-turn live acceptance regression (2026-09-27): the model is free to
// spell a prior-context reference's `type` however it likes -- it is not
// contractually bound to the literal words "previous_plan"/"prior_request".
// resolveReferences used to gate its whole "trust bounded conversation
// evidence" path on a closed keyword regex over that free-text type, so a
// live model call that reasonably used a different spelling (observed live:
// something outside plan/itinerary/journey/topic/turn/conversation/
// previous_request/prior_request) silently fell through to an unresolved
// reference and a needless "หมายถึงแผนทริปที่คุยไว้ก่อนหน้านี้ใช่ไหมครับ"
// clarification, even though domain/action/confidence all already qualified
// for continuation trust. Root-cause fix: resolution now keys off the
// model's own refersToPriorContext:true signal plus real bounded evidence
// (recentTurns/rollingSummary/lastRecommendationReference), never off the
// type string's spelling.
test('prior-plan continuation resolves from conversation evidence even when reference.type uses a synonym outside the old keyword list', () => {
  const context = {
    ...emptySemanticContext(),
    activeDomain:'journey' as const,
    recentTurns:[
      {role:'user' as const,content:'ถ้าพักสองคืนแล้ววันแรกอยากขี่ม้า วันที่สองอยากกินข้าวแล้วซื้อของฝาก ช่วยจัดให้คร่าว ๆ ได้ไหม'},
      {role:'assistant' as const,content:'จัดเป็นแผนคร่าว ๆ จากตัวเลือกที่มีข้อมูลยืนยันได้แบบนี้ครับ วันแรก: ขี่ม้า วันที่สอง: ตำไทย แล้วต่อด้วย ของฝากชุมชน'},
    ],
    lastRecommendationReference:'จัดเป็นแผนคร่าว ๆ วันแรก: ขี่ม้า วันที่สอง: ตำไทย แล้วต่อด้วย ของฝากชุมชน',
  };
  const turn = parseSemanticTurnResponse(JSON.stringify({
    normalizedMeaning:'keep the same itinerary but move it to tomorrow',
    speechAct:'correction',
    domain:'journey',
    intent:'modify_previous_plan_date',
    action:'ask',
    informationNeed:'none',
    entities:{date:'2026-09-28'},
    references:[{type:'same_as_before_reference',value:'the plan just discussed',refersToPriorContext:true}],
    constraints:[],
    confidence:0.9,
    needsClarification:true,
    clarificationReason:'ambiguous prior reference',
  }), context);
  assert.equal(turn.references[0]?.resolvedFromConversation,true);
  assert.equal(turn.needsClarification,false);
  assert.equal(turn.clarificationReason,undefined);
});

test('promotion best-value follow-up resolves from conversation evidence instead of re-clarifying an already-surfaced promotion', () => {
  const context = {
    ...emptySemanticContext(),
    activeDomain:'promotion' as const,
    recentTurns:[
      {role:'user' as const,content:'เมื่อกี้ถามเรื่องห้องอยู่ แต่ช่างมันก่อน มีโปรกินข้าวอะไรตอนนี้บ้าง'},
      {role:'assistant' as const,content:'โปรที่ตรงเงื่อนไขและมีข้อมูลยืนยันตอนนี้ครับ • โปรร้านอาหาร — ไม่ต้องสมัครสมาชิกเพิ่ม'},
    ],
    lastRecommendationReference:'โปรที่ตรงเงื่อนไขและมีข้อมูลยืนยันตอนนี้ครับ • โปรร้านอาหาร — ไม่ต้องสมัครสมาชิกเพิ่ม',
  };
  const turn = parseSemanticTurnResponse(JSON.stringify({
    normalizedMeaning:'take the best-value dining promotion without needing extra membership',
    speechAct:'request',
    domain:'promotion',
    intent:'recommend_best_restaurant_promotion',
    action:'recommend',
    informationNeed:'recommendation',
    entities:{promotion_type:'restaurant_promotion'},
    references:[{type:'same_offer_reference',value:'restaurant_promotion',refersToPriorContext:true}],
    constraints:['no_additional_membership_required'],
    confidence:0.92,
    needsClarification:true,
    clarificationReason:'which promotion was meant',
  }), context);
  assert.equal(turn.references[0]?.resolvedFromConversation,true);
  assert.equal(turn.needsClarification,false);
  assert.equal(turn.clarificationReason,undefined);
});

// Real 16-turn live acceptance regression (2026-09-27, turn 2): "เมื่อกี้บอก
// ว่าเอาภาราดร เปลี่ยนใจละ เอาทองไทยเหมือนเดิม แต่เวลาเดิมนะ" was classified
// perfectly (domain/action/constraints all correct) but the live model put
// the corrected horse under a bare `horse` key (with the old one under
// `replacedHorse`), not the canonical `horseName`/`activity_asset` keys the
// alias table already knew about. The response composer's
// conversationalStateUpdateMessage only names the corrected entity when
// entities.horseName is present, so it silently fell back to a generic
// "แก้ข้อมูลตามที่บอกแล้วครับ" that never said which horse was chosen.
test('correction entities.horse (bare key) canonicalizes to horseName like activity_asset already does', () => {
  const turn = parseSemanticTurnResponse(JSON.stringify({
    normalizedMeaning:'switch the horse selection back to ทองไทย, keep the same time',
    speechAct:'correction',
    domain:'activity',
    intent:'correct_horse_selection_keep_time',
    action:'correct_previous',
    informationNeed:'none',
    entities:{activity:'ขี่ม้า',horse:'ทองไทย',replacedHorse:'ภาราดร',timeReference:'เวลาเดิม'},
    references:[],
    constraints:['horse_thongthai','keep_previous_time'],
    confidence:0.95,
    needsClarification:false,
  }), emptySemanticContext());
  assert.equal(turn.entities.horseName,'ทองไทย');
});
