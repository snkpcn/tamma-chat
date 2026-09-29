// Hotfix regression suite for live LINE open-world conversation failures
// reported after PR #226 ("Open-world human brain live-path cutover").
//
// Each test below is anchored to a specific reported failure class and
// proves the ROOT CAUSE fix at the deterministic layer -- not a patch on
// the exact reported sentence. Network-free: SemanticTurn inputs are either
// hand-built or run through the real parseSemanticTurnResponse/
// resolveReferences validation layer, matching this repo's own
// STATIC/NETWORK-FREE SEMANTIC CONTRACT convention (see
// _semantic-interpreter.ts's SEMANTIC_EVAL_STATUS doc comment). Live model
// conformance for any new prompt guidance added alongside these fixes is
// separately gated by the owner's live LINE acceptance test, same as the
// rest of this program.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyTopLevelSemanticIntent } from '../netlify/functions/_top-level-intent';
import {
  parseSemanticTurnResponse, resolveReferences,
  type SemanticContext, type SemanticTurn,
} from '../netlify/functions/_semantic-interpreter';
import { planDialogTurn, type DialogInput } from '../netlify/functions/_dialog-manager';
import { emptyTaskStateContainer, createActiveTask, setSelectedEntities, type TaskStateContainer } from '../netlify/functions/_task-state';
import { emptyConversationContextState } from '../netlify/functions/_conversation-context';
import { composeDeterministicResponse, type ResponseComposerInput } from '../netlify/functions/_response-composer';

const NOW = new Date('2026-09-28T10:00:00.000Z');

function baseTurn(overrides: Partial<SemanticTurn>): SemanticTurn {
  return {
    domain: 'activity', intent: 'unknown', action: 'ask', entities: {}, references: [],
    constraints: [], confidence: 0.9, needsClarification: false,
    ...overrides,
  };
}

function twoHorseContext(overrides: Partial<SemanticContext> = {}): SemanticContext {
  return {
    activeDomain: 'activity',
    recentEntities: [
      { id: 'activity_asset:horse:paradon', type: 'activity_asset', name: 'ภาราดร', domain: 'activity' },
      { id: 'activity_asset:horse:thongthai', type: 'activity_asset', name: 'ทองไทย', domain: 'activity' },
    ],
    ...overrides,
  };
}

function emptyComposerInput(overrides: Partial<ResponseComposerInput>): ResponseComposerInput {
  return {
    channel: 'line',
    language: 'th',
    dialogDecision: {
      mode: 'clarify',
      taskStateContainer: emptyTaskStateContainer(),
      knowledgeRequests: [],
      missingFields: [],
      responseIntent: 'clarify_ambiguous_entity',
      reasons: ['ambiguous_entity'],
    },
    knowledgeBundles: [],
    degradation: { condition: 'model_unavailable', level: 'model_unavailable', reasonCodes: [] } as any,
    ...overrides,
  };
}

// -- Failure class A: weather must not hijack horse questions --------------

test('A: a horse question containing "ร้อน" is not classified as a weather request', () => {
  assert.equal(classifyTopLevelSemanticIntent('ม้าทองไทยขี้ร้อนไหมครับ'), 'HORSE_RELATED');
  assert.equal(classifyTopLevelSemanticIntent('ม้าตัวนี้ขี้ร้อนไหม เหมาะกับเด็กไหม'), 'HORSE_RELATED');
});

test('A: a genuine weather question is still classified as a weather request', () => {
  assert.equal(classifyTopLevelSemanticIntent('วันนี้ฝนตกไหมครับ'), 'WEATHER_REQUEST');
  assert.equal(classifyTopLevelSemanticIntent('วันนี้อากาศร้อนไหม'), 'WEATHER_REQUEST');
  assert.equal(classifyTopLevelSemanticIntent('พรุ่งนี้ร้อนไหม'), 'WEATHER_REQUEST');
});

// -- Failure class B: "ไม่เอา X ขออีกตัว" resolves to the OTHER candidate ---

test('B: an excluded_entity reference resolves to the single remaining candidate', () => {
  const context = twoHorseContext();
  const [resolved] = resolveReferences(
    [{ type: 'excluded_entity', value: 'ทองไทย', refersToPriorContext: true }],
    context,
  );
  assert.equal(resolved!.resolvedEntityId, 'activity_asset:horse:paradon');
  assert.equal(resolved!.resolvedEntityIds, undefined);
});

// -- Failure class C: demonstrative "ตัวนั้น" resolves to most-recent, not ambiguous --

test('C: a bare demonstrative reference resolves to the most recently discussed entity', () => {
  const context = twoHorseContext();
  const [resolved] = resolveReferences(
    [{ type: 'entity_selection', value: 'ตัวนั้น', refersToPriorContext: true }],
    context,
  );
  assert.equal(resolved!.resolvedEntityId, 'activity_asset:horse:paradon', 'most-relevant-first entity wins, not a "which one" prompt');
  assert.equal(resolved!.ambiguous, undefined);
});

test('C: a genuine multi-way comparison reference ("ตัวไหน") is still left ambiguous', () => {
  const context = twoHorseContext();
  const [resolved] = resolveReferences(
    [{ type: 'entity_selection', value: 'ตัวไหนนิสัยดีกว่า', refersToPriorContext: true }],
    context,
  );
  assert.deepEqual(resolved!.resolvedEntityIds, ['activity_asset:horse:paradon', 'activity_asset:horse:thongthai']);
});

test('C2: a resolved multi-entity comparison set is answerable, not an ambiguous selection', () => {
  const turn = baseTurn({
    intent:'compare_horse_options',
    action:'compare',
    informationNeed:'recommendation',
    references:[{
      type:'comparison_set',
      value:'ทองไทย,ภาราดร',
      refersToPriorContext:true,
      ambiguous:true,
      resolvedEntityIds:['activity_asset:horse:paradon','activity_asset:horse:thongthai'],
    }],
    needsClarification:false,
  });
  const plan=planDialogTurn({
    semanticTurn:turn,
    conversationContext:emptyConversationContextState(NOW),
    taskState:emptyTaskStateContainer(),
    channel:'line',
    eventId:'hotfix-c2-resolved-comparison',
  },NOW);
  assert.notEqual(plan.mode,'clarify');
  assert.deepEqual(plan.compareEntityIds,[
    'activity_asset:horse:paradon','activity_asset:horse:thongthai',
  ]);
  assert.equal(plan.knowledgeRequests[0]?.domain,'activity');
  assert.ok(plan.knowledgeRequests[0]?.needs.includes('entity_details'));
});

test('C3: prior customer constraints stay conversation evidence when many menu entities are recent', () => {
  const context:SemanticContext = {
    activeDomain:'restaurant',
    recentEntities:[
      {id:'menu:1',type:'menu_item',name:'ตำลาว',domain:'restaurant'},
      {id:'menu:2',type:'menu_item',name:'ตำไทย',domain:'restaurant'},
      {id:'menu:3',type:'menu_item',name:'ไก่ย่าง',domain:'restaurant'},
    ],
    recentTurns:[
      {role:'user',content:'แฟนแพ้กุ้ง มีอะไรกินได้บ้าง'},
      {role:'assistant',content:'แนะนำเมนูที่ตรวจสอบส่วนผสมให้ครับ'},
      {role:'user',content:'ผมกินเผ็ดไม่เก่งด้วยครับ'},
    ],
  };
  const turn=parseSemanticTurnResponse(JSON.stringify({
    normalizedMeaning:'recommend menus matching the customer constraints already stated',
    speechAct:'request',
    domain:'restaurant',
    intent:'menu_recommendation_for_shrimp_avoidance',
    action:'recommend',
    informationNeed:'recommendation',
    entities:{allergen:'shrimp'},
    references:[{type:'prior_constraint',value:'avoid_shrimp',refersToPriorContext:true}],
    constraints:['no_shrimp','mild_spice'],
    confidence:0.96,
    needsClarification:false,
  }),context,'มีเมนูไหนเหมาะกับที่บอกไปบ้างครับ');

  assert.equal(turn.action,'recommend','a prior constraint must not turn a recommendation into a menu comparison');
  assert.equal(turn.needsClarification,false);
  assert.equal(turn.references[0]?.resolvedFromConversation,true);
  assert.equal(turn.references[0]?.resolvedEntityIds,undefined);
  assert.equal(turn.references[0]?.ambiguous,undefined);

  const plan=planDialogTurn({
    semanticTurn:turn,
    conversationContext:emptyConversationContextState(NOW),
    taskState:emptyTaskStateContainer(),
    channel:'line',
    eventId:'hotfix-c3-prior-constraint',
  },NOW);
  assert.notEqual(plan.mode,'clarify');
  assert.notEqual(plan.responseIntent,'cannot_verify_comparison');
  assert.ok(plan.knowledgeRequests.some(request=>request.domain==='restaurant'));
});

test('C4: named no-booking preference is canonicalized to a safe working selection, not missing-field collection', () => {
  const context=twoHorseContext({
    activeTask:{
      taskId:'task-horse',domain:'activity',type:'activity_booking',
      selectedEntities:[],knownSlots:{activityCode:'horse'},constraints:[],
      missingFields:['resourceCode','date','durationMinutes'],commitmentIntent:false,
    },
  });
  const turn=parseSemanticTurnResponse(JSON.stringify({
    normalizedMeaning:'customer keeps ภาราดร as a tentative choice without booking',
    reply:'ได้ครับ ผมเก็บภาราดรไว้เป็นตัวเลือกก่อนนะครับ ยังไม่ดำเนินการจองให้ครับ',
    speechAct:'preference_update',
    domain:'activity',
    intent:'hold_horse_selection_without_booking',
    action:'provide_information',
    informationNeed:'none',
    entities:{horseName:'ภาราดร',activityCode:'horse'},
    references:[],
    constraints:['no_transaction'],
    confidence:0.99,
    needsClarification:false,
  }),context,'เอาภาราดรไว้ก่อน แต่ยังไม่จองครับ');

  assert.equal(turn.action,'confirm');
  assert.equal(turn.speechAct,'preference_update');
  assert.deepEqual(turn.constraints,['no_transaction']);

  const existing=createActiveTask({
    type:'activity_booking',sourceChannel:'line',initialSlots:{activityCode:'horse'},
    requiredFields:['resourceCode','date','durationMinutes'],now:NOW,
  });
  const taskState:TaskStateContainer={
    ...emptyTaskStateContainer(),
    activeTask:{...existing,slots:{activityCode:'horse'},missingFields:['resourceCode','date','durationMinutes']},
  };
  const plan=planDialogTurn({
    semanticTurn:turn,
    conversationContext:emptyConversationContextState(NOW),
    taskState,
    channel:'line',
    eventId:'hotfix-c4-safe-hold',
  },NOW);
  assert.notEqual(plan.mode,'collect_field');
  assert.equal(plan.actionProposal,undefined);
  assert.notEqual(plan.taskStateContainer.activeTask?.commitmentIntent,true);
  assert.equal(plan.taskStateContainer.activeTask?.slots.horseName,'ภาราดร');
  const response=composeDeterministicResponse(emptyComposerInput({
    semanticTurn:turn,
    dialogDecision:plan,
    conversationContext:emptyConversationContextState(NOW),
  }));
  assert.match(response.message,/ภาราดร/u);
  assert.doesNotMatch(response.message,/ขอรายการที่ต้องการ|ขอ.*วัน/u);
  assert.doesNotMatch(response.message,/จองเรียบร้อย|ยืนยันการจองแล้ว/u);
});

// -- Failure classes D/F/G: an ambiguous side-reference must never block a
// task summary or casual chat -----------------------------------------------

test('D: summarize_active_task bypasses clarify even with an unrelated ambiguous reference', () => {
  const turn = baseTurn({
    intent: 'summarize_active_task', action: 'ask',
    references: [{ type: 'entity_selection', value: 'เมื่อกี้', refersToPriorContext: true, ambiguous: true }],
    needsClarification: false,
  });
  const plan = planDialogTurn({
    semanticTurn: turn,
    conversationContext: emptyConversationContextState(NOW),
    taskState: emptyTaskStateContainer(),
    channel: 'line', eventId: 'hotfix-d-1',
  }, NOW);
  assert.notEqual(plan.mode, 'clarify', 'a status/summary question must never be forced into generic ambiguous-entity clarification');
});

test('F: casual/social speech never triggers ambiguous-entity clarification', () => {
  const turn = baseTurn({
    domain: 'general', intent: 'casual_chat', action: 'ask', speechAct: 'social',
    references: [{ type: 'entity_selection', value: 'เมื่อกี้', refersToPriorContext: true, ambiguous: true }],
    needsClarification: true,
  });
  const plan = planDialogTurn({
    semanticTurn: turn,
    conversationContext: emptyConversationContextState(NOW),
    taskState: emptyTaskStateContainer(),
    channel: 'line', eventId: 'hotfix-f-1',
  }, NOW);
  assert.notEqual(plan.mode, 'clarify', 'ordinary casual chat must never be routed through business-entity clarification');
});

test('D/F: composeDeterministicResponse never emits the banned generic activity clarification for a non-clarify mode', () => {
  const summaryInput = emptyComposerInput({
    dialogDecision: {
      mode: 'answer',
      taskStateContainer: emptyTaskStateContainer(),
      knowledgeRequests: [],
      missingFields: [],
      responseIntent: 'active_task_summary',
      reasons: ['task_summary_requested'],
    },
  });
  const response = composeDeterministicResponse(summaryInput);
  assert.doesNotMatch(response.message, /หมายถึงกิจกรรมหรือม้าตัวที่คุยไว้ก่อนหน้านี้ใช่ไหมครับ/);
});

// -- Failure class E: returning to a suspended task's domain must scope
// knowledge to THAT task, not leak the wrong-domain active task -----------

test('E: a stale wrong-domain active task never scopes knowledge for a different-domain turn', () => {
  const activityTask = setSelectedEntities(
    createActiveTask({ type: 'activity_booking', sourceChannel: 'line', domain: 'activity', now: NOW, initialSlots: { resourceCode: 'activity-horse' } }),
    [{ id: 'activity_asset:horse:paradon', type: 'activity_asset', name: 'ภาราดร', domain: 'activity' }],
    NOW,
  );
  const restaurantTask = createActiveTask({ type: 'restaurant_preorder', sourceChannel: 'line', domain: 'restaurant', now: NOW });
  const taskState: TaskStateContainer = {
    ...emptyTaskStateContainer(),
    activeTask: restaurantTask,
    suspendedTask: activityTask,
  };
  const turn = baseTurn({
    domain: 'activity', intent: 'ask_about_selected_horse', action: 'ask',
    informationNeed: 'suitability',
  });
  const dialogInput: DialogInput = {
    semanticTurn: turn,
    conversationContext: emptyConversationContextState(NOW),
    taskState,
    channel: 'line', eventId: 'hotfix-e-1',
  };
  const plan = planDialogTurn(dialogInput, NOW);
  assert.equal(plan.knowledgeRequests.length, 1);
  assert.equal(plan.knowledgeRequests[0]!.domain, 'activity');
  assert.equal(plan.knowledgeRequests[0]!.task?.taskId, activityTask.taskId, 'must scope to the SUSPENDED horse task, not the unrelated active restaurant task');
});

// -- Reference-layer wiring through the real parseSemanticTurnResponse path --

test('B/C wired through parseSemanticTurnResponse: exclusion and demonstrative both clear needsClarification on a selection turn', () => {
  const context = twoHorseContext();
  const excludeTurn = parseSemanticTurnResponse(JSON.stringify({
    domain: 'activity', intent: 'select_other_horse', action: 'confirm', speechAct: 'selection',
    entities: {}, references: [{ type: 'excluded_entity', value: 'ทองไทย', refersToPriorContext: true }],
    constraints: [], confidence: 0.9, needsClarification: false,
  }), context);
  assert.equal(excludeTurn.needsClarification, false);
  assert.equal(excludeTurn.references[0]!.resolvedEntityId, 'activity_asset:horse:paradon');

  const demonstrativeTurn = parseSemanticTurnResponse(JSON.stringify({
    domain: 'activity', intent: 'consider_horse', action: 'confirm', speechAct: 'selection',
    entities: {}, references: [{ type: 'entity_selection', value: 'ตัวนั้น', refersToPriorContext: true }],
    constraints: [], confidence: 0.9, needsClarification: false,
  }), context);
  assert.equal(demonstrativeTurn.needsClarification, false);
  assert.equal(demonstrativeTurn.references[0]!.resolvedEntityId, 'activity_asset:horse:paradon');
});
