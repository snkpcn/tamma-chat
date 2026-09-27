import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RESPONSE_COMPOSER_VERSION,
  ResponseCompositionError,
  assertOperationalClaimSafety,
  buildResponseComposerPrompt,
  composeDeterministicResponse,
  composeGroundedDeterministicResponse,
  composeMembershipInformationResponse,
  composeThongthaiResponse,
  parseComposedResponse,
  type ResponseComposerInput,
} from '../netlify/functions/_response-composer';
import type { DialogDecision } from '../netlify/functions/_dialog-manager';
import type { DegradationPlan } from '../netlify/functions/_graceful-degradation';
import type { KnowledgeBundle, KnowledgeNeed, KnowledgeRequest } from '../netlify/functions/_knowledge-resolver';
import { emptyTaskStateContainer } from '../netlify/functions/_task-state';

const NOW='2026-09-18T12:00:00.000Z';

function decision(overrides: Partial<DialogDecision> = {}): DialogDecision {
  return {
    mode:'answer',
    taskStateContainer:emptyTaskStateContainer(),
    knowledgeRequests:[],
    missingFields:[],
    responseIntent:'grounded_answer',
    reasons:[],
    ...overrides,
  };
}
function degradation(overrides: Partial<DegradationPlan> = {}): DegradationPlan {
  return {
    version:'degradation-v1', condition:'none', level:'normal', reasonCodes:[],
    retryable:false, safeToExecuteTransaction:false, sourceStates:[],
    ...overrides,
  };
}
function bundle(): KnowledgeBundle {
  return {
    domain:'restaurant',
    sources:[{ need:'catalog', sourceId:'restaurant_menu_live', sourceType:'restaurant_live', status:'ok' }],
    facts:[
      { key:'menu:m1:name', value:'ส้มตำไทย', domain:'restaurant', sourceId:'restaurant_menu_live', sourceType:'restaurant_live', authoritative:true, fetchedAt:NOW },
      { key:'menu:m1:price', value:89, domain:'restaurant', sourceId:'restaurant_menu_live', sourceType:'restaurant_live', authoritative:true, fetchedAt:NOW },
    ],
    entities:[], missing:[], warnings:[], freshness:'live',
  };
}
function input(overrides: Partial<ResponseComposerInput> = {}): ResponseComposerInput {
  return {
    channel:'line', language:'th', userMessage:'มีอะไรกิน',
    dialogDecision:decision(), knowledgeBundles:[bundle()], degradation:degradation(),
    ...overrides,
  };
}

test('Response Composer version is explicit', () => {
  assert.equal(RESPONSE_COMPOSER_VERSION, 'response-composer-v2');
});

test('prompt consumes canonical Bible doctrine and grounded facts, not raw DB implementation', () => {
  const prompt=buildResponseComposerPrompt(input());
  assert.match(prompt,/CANONICAL PERSONALITY/);
  assert.match(prompt,/OPERATIONAL TRUTH/);
  assert.match(prompt,/[menu:m1:name]/);
  assert.match(prompt,/[menu:m1:price]/);
  assert.match(prompt,/89/);
  assert.doesNotMatch(prompt,/SUPABASE_SERVICE_ROLE|dbFetch|service_role/i);
});

test('prompt explicitly separates unavailable, empty and unknown truth states', () => {
  const prompt=buildResponseComposerPrompt(input());
  assert.match(prompt,/SOURCE_UNAVAILABLE means/i);
  assert.match(prompt,/VERIFIED_EMPTY means/i);
  assert.match(prompt,/FACT_UNKNOWN means/i);
});

test('parser accepts only grounded usedFactKeys', () => {
  const parsed=parseComposedResponse(JSON.stringify({
    message:'ส้มตำไทย 89 บาทครับ',
    usedFactKeys:['menu:m1:name','menu:m1:price'],
  }),input());
  assert.deepEqual(parsed.usedFactKeys,['menu:m1:name','menu:m1:price']);
});

test('parser rejects a fact key the resolver never grounded', () => {
  assert.throws(() => parseComposedResponse(JSON.stringify({
    message:'เมนูลับ 999 บาท',
    usedFactKeys:['menu:secret:price'],
  }),input()), /composer_unverified_fact_key/);
});

test('no operational success wording is allowed without a verified successful outcome', () => {
  assert.throws(
    () => assertOperationalClaimSafety('จองเรียบร้อยแล้วครับ', null),
    (error: unknown) => error instanceof ResponseCompositionError
      && error.message === 'composer_false_operational_success_claim',
  );
});

test('requested operational result may say submitted but may NOT claim confirmed', () => {
  const requested={executed:true,success:true,status:'requested',referenceCode:'BK123'};
  assert.doesNotThrow(() => assertOperationalClaimSafety('ส่งคำขอเข้าระบบแล้วครับ BK123', requested));
  assert.throws(() => assertOperationalClaimSafety('ยืนยันการจองแล้วครับ BK123', requested), /composer_false_confirmation_claim/);
});

test('real confirmed operational outcome permits confirmed wording', () => {
  assert.doesNotThrow(() => assertOperationalClaimSafety('ยืนยันการจองแล้วครับ BK123', {
    executed:true,success:true,status:'confirmed',referenceCode:'BK123',
  }));
});

test('SOURCE_UNAVAILABLE deterministic copy never says there are no options', () => {
  const response=composeDeterministicResponse(input({
    knowledgeBundles:[],
    degradation:degradation({
      condition:'source_unavailable', level:'human_handoff',
      reasonCodes:['authoritative_source_unavailable','human_followup_required'], retryable:true,
    }),
  }));
  assert.match(response.message,/ยังเช็กข้อมูลล่าสุด/);
  assert.doesNotMatch(response.message,/ไม่มี(?:ห้อง|โปร|สินค้า|ตัวเลือก)/);
});

test('PR G selects the actually failed availability request and preserves structured date/time', async () => {
  const catalogRequest: KnowledgeRequest={
    domain:'restaurant', intent:'restaurant_catalog', action:'ask',
    entities:{}, constraints:[], needs:['catalog'],
  };
  const availabilityRequest: KnowledgeRequest={
    domain:'restaurant', intent:'restaurant_table_availability', action:'ask',
    // Deliberately omit time here: current semantic meaning below must win.
    entities:{date:'2026-09-29'}, constraints:[], needs:['availability'],
  };
  const bundles:KnowledgeBundle[]=[{
    domain:'restaurant',
    sources:[
      {need:'catalog',sourceId:'restaurant_menu_live',sourceType:'restaurant_live',status:'ok'},
      {need:'availability',sourceId:'restaurant_table_live',sourceType:'restaurant_live',status:'unavailable',reason:'source_unavailable'},
    ],
    facts:[
      {key:'menu:m1:name',value:'ส้มตำไทย',domain:'restaurant',sourceId:'restaurant_menu_live',sourceType:'restaurant_live',authoritative:true,fetchedAt:NOW},
    ],
    entities:[], missing:['availability'], warnings:[], freshness:'mixed',
  }];
  const response=await composeThongthaiResponse(input({
    userMessage:'พรุ่งนี้หกโมงโต๊ะเต็มยัง',
    semanticTurn:{
      domain:'restaurant', intent:'restaurant_table_availability', action:'ask',
      informationNeed:'availability', entities:{date:'2026-09-29',time:'18:00'},
      references:[], constraints:[], confidence:.96, needsClarification:false,
    },
    dialogDecision:decision({knowledgeRequests:[catalogRequest,availabilityRequest]}),
    knowledgeBundles:bundles,
    degradation:degradation({
      condition:'source_unavailable',level:'grounded_deterministic',
      reasonCodes:['authoritative_source_unavailable','partial_grounding_available'],retryable:true,
      sourceStates:[{sourceId:'restaurant_menu_live',status:'ok'},{sourceId:'restaurant_table_live',status:'unavailable',reason:'source_unavailable'}],
    }),
  }));
  assert.match(response.message,/โต๊ะว่าง/);
  assert.match(response.message,/2026-09-29/);
  assert.match(response.message,/18:00/);
  assert.match(response.message,/ยืนยันไม่ได้|เช็ก.*ไม่ได้/);
  assert.doesNotMatch(response.message,/รับทราบ|เมนูที่มี|ไม่มีตัวเลือก/);
  assert.equal(response.mode,'deterministic');
});

test('PR G fact-unknown price keeps the named stay instead of collapsing to generic copy', async () => {
  const request:KnowledgeRequest={
    domain:'stay',intent:'stay_price',action:'ask',
    entities:{accommodationName:'บ้านชมดาว'},constraints:[],needs:['price'],
  };
  const response=await composeThongthaiResponse(input({
    userMessage:'หลังนี้เท่าไหร่',
    semanticTurn:{
      domain:'stay',intent:'stay_price',action:'ask',informationNeed:'price',
      entities:{accommodationName:'บ้านชมดาว'},references:[],constraints:[],
      confidence:.95,needsClarification:false,
    },
    dialogDecision:decision({knowledgeRequests:[request]}),
    knowledgeBundles:[{
      domain:'stay',
      sources:[{need:'price',sourceId:'stay_price_unwired',sourceType:'stay_live',status:'unavailable',reason:'no_source_registered'}],
      facts:[],entities:[],missing:['price'],warnings:[],freshness:'live',
    }],
    degradation:degradation({
      condition:'fact_unknown',level:'human_handoff',
      reasonCodes:['fact_not_verified','human_followup_required'],
      sourceStates:[{sourceId:'stay_price_unwired',status:'unavailable',reason:'no_source_registered'}],
    }),
  }));
  assert.match(response.message,/บ้านชมดาว/);
  assert.match(response.message,/ราคา/);
  assert.match(response.message,/ยังไม่มีข้อมูลที่ยืนยันได้/);
  assert.doesNotMatch(response.message,/เรื่องนี้ยังไม่มีข้อมูลยืนยัน/);
});

test('PR G schedule gap preserves the structured activity entity and date', async () => {
  const request:KnowledgeRequest={
    domain:'activity',intent:'activity_schedule',action:'ask',
    entities:{horseName:'ทองไทย'},constraints:[],needs:['schedule'],
  };
  const response=await composeThongthaiResponse(input({
    semanticTurn:{
      domain:'activity',intent:'activity_schedule',action:'ask',informationNeed:'schedule',
      entities:{horseName:'ทองไทย',date:'2026-10-01'},references:[],constraints:[],
      confidence:.94,needsClarification:false,
    },
    dialogDecision:decision({knowledgeRequests:[request]}),
    knowledgeBundles:[{
      domain:'activity',
      sources:[{need:'schedule',sourceId:'activity_schedule_live',sourceType:'activity_live',status:'unavailable',reason:'source_unavailable'}],
      facts:[],entities:[],missing:['schedule'],warnings:[],freshness:'live',
    }],
    degradation:degradation({
      condition:'source_unavailable',level:'human_handoff',
      reasonCodes:['authoritative_source_unavailable','human_followup_required'],retryable:true,
      sourceStates:[{sourceId:'activity_schedule_live',status:'unavailable',reason:'source_unavailable'}],
    }),
  }));
  assert.match(response.message,/ทองไทย/);
  assert.match(response.message,/2026-10-01/);
  assert.match(response.message,/รอบ|ตารางเวลา/);
  assert.match(response.message,/ไม่ขอเดา/);
});

test('PR G inventory gap preserves product identity and never invents stock', async () => {
  const request:KnowledgeRequest={
    domain:'otop',intent:'otop_inventory',action:'status',
    entities:{productName:'ข้าวฮาง'},constraints:[],needs:['inventory'],
  };
  const response=await composeThongthaiResponse(input({
    semanticTurn:{
      domain:'otop',intent:'otop_inventory',action:'status',informationNeed:'inventory',
      entities:{productName:'ข้าวฮาง'},references:[],constraints:[],
      confidence:.93,needsClarification:false,
    },
    dialogDecision:decision({knowledgeRequests:[request]}),
    knowledgeBundles:[{
      domain:'otop',
      sources:[{need:'inventory',sourceId:'otop_inventory_live',sourceType:'otop_live',status:'unavailable',reason:'source_unavailable'}],
      facts:[],entities:[],missing:['inventory'],warnings:[],freshness:'live',
    }],
    degradation:degradation({
      condition:'source_unavailable',level:'human_handoff',
      reasonCodes:['authoritative_source_unavailable','human_followup_required'],retryable:true,
      sourceStates:[{sourceId:'otop_inventory_live',status:'unavailable',reason:'source_unavailable'}],
    }),
  }));
  assert.match(response.message,/ข้าวฮาง/);
  assert.match(response.message,/จำนวน/);
  assert.match(response.message,/เช็ก.*ไม่ได้/);
  assert.doesNotMatch(response.message,/เหลือ\s*\d|มี\s*\d/);
});

test('PR G response depends on structured meaning, not raw customer phrasing', async () => {
  const request:KnowledgeRequest={
    domain:'restaurant',intent:'restaurant_table_availability',action:'ask',
    entities:{date:'2026-09-29',time:'18:00'},constraints:[],needs:['availability'],
  };
  const bundle:KnowledgeBundle={
    domain:'restaurant',
    sources:[{need:'availability',sourceId:'restaurant_table_live',sourceType:'restaurant_live',status:'unavailable',reason:'source_unavailable'}],
    facts:[],entities:[],missing:['availability'],warnings:[],freshness:'live',
  };
  const base:Partial<ResponseComposerInput>={
    semanticTurn:{
      domain:'restaurant',intent:'restaurant_table_availability',action:'ask',
      informationNeed:'availability',entities:{date:'2026-09-29',time:'18:00'},
      references:[],constraints:[],confidence:.97,needsClarification:false,
    },
    dialogDecision:decision({knowledgeRequests:[request]}),
    knowledgeBundles:[bundle],
    degradation:degradation({
      condition:'source_unavailable',level:'human_handoff',
      reasonCodes:['authoritative_source_unavailable','human_followup_required'],retryable:true,
      sourceStates:[{sourceId:'restaurant_table_live',status:'unavailable',reason:'source_unavailable'}],
    }),
  };
  const a=await composeThongthaiResponse(input({...base,userMessage:'พรุ่งนี้หกโมงมีโต๊ะปะ'}));
  const b=await composeThongthaiResponse(input({...base,userMessage:'ขอทราบ availability ของโต๊ะเวลา 18:00'}));
  assert.equal(a.message,b.message);
});

test('PR G semantic policy need correctly bridges to stable_policy knowledge taxonomy', async () => {
  const request:KnowledgeRequest={
    domain:'stay',intent:'stay_policy',action:'ask',
    entities:{accommodationName:'บ้านชมดาว'},constraints:[],needs:['stable_policy'],
  };
  const response=await composeThongthaiResponse(input({
    semanticTurn:{
      domain:'stay',intent:'stay_policy',action:'ask',informationNeed:'policy',
      entities:{accommodationName:'บ้านชมดาว'},references:[],constraints:[],
      confidence:.91,needsClarification:false,
    },
    dialogDecision:decision({knowledgeRequests:[request]}),
    knowledgeBundles:[{
      domain:'stay',
      sources:[{need:'stable_policy',sourceId:'policy_unwired',sourceType:'bible',status:'unavailable',reason:'no_source_registered'}],
      facts:[],entities:[],missing:['stable_policy'],warnings:[],freshness:'stable',
    }],
    degradation:degradation({
      condition:'fact_unknown',level:'human_handoff',
      reasonCodes:['fact_not_verified','human_followup_required'],
      sourceStates:[{sourceId:'policy_unwired',status:'unavailable',reason:'no_source_registered'}],
    }),
  }));
  assert.match(response.message,/เงื่อนไข/);
  assert.match(response.message,/บ้านชมดาว/);
  assert.match(response.message,/ยืนยันได้/);
});

test('VERIFIED_EMPTY deterministic promotion copy truthfully says no active promotion', () => {
  const response=composeDeterministicResponse(input({
    dialogDecision:decision({ responseIntent:'no_active_promotion' }),
    degradation:degradation({
      condition:'verified_empty', level:'grounded_deterministic',
      reasonCodes:['authoritative_source_empty'],
    }),
  }));
  assert.match(response.message,/ยังไม่มีโปรโมชั่นที่เปิดใช้งาน/);
});

test('FACT_UNKNOWN copy says unverified and does not guess', () => {
  const response=composeDeterministicResponse(input({
    degradation:degradation({
      condition:'fact_unknown', level:'human_handoff',
      reasonCodes:['fact_not_verified','human_followup_required'],
    }),
  }));
  assert.match(response.message,/ยังไม่มีข้อมูลยืนยัน/);
  assert.match(response.message,/ไม่ขอเดา/);
});

test('collect-field response asks only the next bounded missing fields', () => {
  const response=composeDeterministicResponse(input({
    dialogDecision:decision({
      mode:'collect_field', responseIntent:'ask_missing_field',
      missingFields:['date','time','partySize'],
    }),
  }));
  assert.match(response.message,/วัน \+ เวลา/);
  assert.doesNotMatch(response.message,/จำนวนคน/,'composer should ask only first two fields, not interrogate');
});

test('ActionProposal alone is explicitly NOT described as submitted', () => {
  const response=composeDeterministicResponse(input({
    dialogDecision:decision({
      mode:'propose_action', responseIntent:'propose_action',
      actionProposal:{
        toolName:'create_booking', validatedArgs:{}, requiresExplicitConfirmation:true,
        customerCommitPresent:true, idempotencyKey:'evt-1',
      },
    }),
  }));
  assert.match(response.message,/ยังไม่ได้ส่งคำขอเข้าระบบ/);
});

test('successful requested outcome uses real reference code and preserves requested!=confirmed', () => {
  const response=composeDeterministicResponse(input({
    operationalOutcome:{executed:true,success:true,status:'requested',referenceCode:'BK123'},
  }));
  assert.match(response.message,/BK123/);
  assert.match(response.message,/ทีมงานจะยืนยันอีกครั้ง/);
  assert.doesNotMatch(response.message,/ยืนยันการจองแล้ว/);
});

test('model-unavailable copy is centralized and never exposes provider/tool details', () => {
  const response=composeDeterministicResponse(input({
    degradation:degradation({
      condition:'model_unavailable', level:'human_handoff',
      reasonCodes:['provider_stack_exhausted','human_followup_required'], retryable:true,
    }),
  }));
  assert.doesNotMatch(response.message,/Gemini|OpenAI|provider|tool|confidence/i);
  assert.match(response.message,/ตอบเรื่องนี้ให้แม่นไม่ได้/);
});

test('LINE presentation stays plain and scan-friendly (no markdown heading/bold syntax)', () => {
  const response=composeDeterministicResponse(input({
    dialogDecision:decision({ mode:'clarify', responseIntent:'clarify_ambiguous_entity' }),
  }));
  assert.doesNotMatch(response.message,/^#|\*\*/m);
  assert.ok(response.message.length < 500);
});


test('model outage with verified grounded data still answers deterministically instead of generic retry copy', () => {
  const response=composeDeterministicResponse(input({
    degradation:degradation({
      condition:'model_unavailable',
      level:'grounded_deterministic',
      reasonCodes:['provider_stack_exhausted','deterministic_fallback_available'],
      retryable:true,
    }),
  }));
  assert.match(response.message,/ส้มตำไทย/);
  assert.match(response.message,/89 บาท/);
  assert.doesNotMatch(response.message,/ตอบเรื่องนี้ให้แม่นไม่ได้/);
  assert.deepEqual(response.usedFactKeys.sort(), ['menu:m1:name','menu:m1:price'].sort());
});

test('grounded deterministic restaurant copy uses customer-facing menu wording, not internal verification language', () => {
  const response=composeGroundedDeterministicResponse(input());
  assert.ok(response);
  assert.match(response.message,/เมนูที่มีตอนนี้/);
  assert.match(response.message,/ส้มตำไทย/);
  assert.match(response.message,/89 บาท/);
  assert.doesNotMatch(response.message,/ข้อมูลที่ทองไทยเช็กยืนยันได้ตอนนี้/);
});

test('membership signup information is deterministic and never a provider apology', () => {
  const response=composeMembershipInformationResponse(input({
    knowledgeBundles:[],
    dialogDecision:decision({ mode:'answer', responseIntent:'grounded_answer' }),
    degradation:degradation({
      condition:'model_unavailable',
      level:'human_handoff',
      reasonCodes:['provider_stack_exhausted','human_followup_required'],
      retryable:true,
    }),
  }));
  assert.match(response.message,/สมัครสมาชิกผ่าน LINE/);
  assert.match(response.message,/สมัครสมาชิก/);
  assert.doesNotMatch(response.message,/ตอบเรื่องนี้ให้แม่นไม่ได้|Gemini|OpenAI/i);
});

test('model outage without verified facts remains the last-resort concise failure', () => {
  const response=composeDeterministicResponse(input({
    knowledgeBundles:[],
    degradation:degradation({
      condition:'model_unavailable',
      level:'human_handoff',
      reasonCodes:['provider_stack_exhausted','human_followup_required'],
      retryable:true,
    }),
  }));
  assert.match(response.message,/ตอบเรื่องนี้ให้แม่นไม่ได้/);
});

// Zero-cost architecture (Phase P): the Dialog Manager's mode is a real
// already-computed decision, not something that needs the model to have
// succeeded this turn. A slot-collection/clarify turn must still ask for the
// SPECIFIC missing field/clarification while Gemini is down or circuit-open
// -- collapsing to the generic "can't answer this right now" apology here
// would be exactly the production defect Phase P fixed.
test('an active-task slot-collection turn asks for the missing field even under model_unavailable, not the generic apology', () => {
  const response=composeDeterministicResponse(input({
    knowledgeBundles:[],
    dialogDecision:decision({
      mode:'collect_field', responseIntent:'ask_missing_field',
      missingFields:['date','partySize'],
    }),
    degradation:degradation({
      condition:'model_unavailable', level:'human_handoff',
      reasonCodes:['provider_stack_exhausted','active_task_present'], retryable:true,
    }),
  }));
  assert.match(response.message,/วัน \+ จำนวนคน/);
  assert.doesNotMatch(response.message,/ตอบเรื่องนี้ให้แม่นไม่ได้/);
});

test('a clarify-mode turn asks for clarification even under model_unavailable, not the generic apology', () => {
  const response=composeDeterministicResponse(input({
    knowledgeBundles:[],
    dialogDecision:decision({ mode:'clarify', responseIntent:'clarify_ambiguous_entity' }),
    degradation:degradation({
      condition:'model_unavailable', level:'human_handoff',
      reasonCodes:['provider_stack_exhausted'], retryable:true,
    }),
  }));
  assert.match(response.message,/ขอรายละเอียดเพิ่ม/);
  assert.doesNotMatch(response.message,/ตอบเรื่องนี้ให้แม่นไม่ได้/);
});


test('unverified comparison is always deterministic and cannot hallucinate traits', async () => {
  const response = await composeThongthaiResponse(input({
    knowledgeBundles:[],
    dialogDecision:decision({
      mode:'answer',
      responseIntent:'cannot_verify_comparison',
      reasons:['cannot_verify_comparison'],
    }),
  }));
  assert.equal(response.mode, 'deterministic');
  assert.match(response.message,/ยังไม่มีข้อมูลยืนยัน|ไม่ขอเดา/u);
  assert.doesNotMatch(response.message,/ใจดี|น่ารัก|คุ้นเคยกับคน|นิสัยดีกว่า/u);
});
