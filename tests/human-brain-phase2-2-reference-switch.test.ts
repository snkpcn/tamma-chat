import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSemanticTurnResponse,
  type SemanticContext,
  type SemanticTurn,
} from '../netlify/functions/_semantic-interpreter';
import {
  emptyTaskStateContainer,
  setSelectedEntities,
  startNewActiveTask,
  type TaskStateContainer,
} from '../netlify/functions/_task-state';
import {
  emptyConversationContextState,
} from '../netlify/functions/_conversation-context';
import {
  processThongthaiOneMindTurn,
  type OneMindDependencies,
} from '../netlify/functions/_thongthai-one-mind-orchestrator';
import {
  planDialogTurn,
  resolveDialogDecision,
} from '../netlify/functions/_dialog-manager';
import type { GroundedFact, KnowledgeSourceAdapters, SourceResult } from '../netlify/functions/_knowledge-resolver';

const NOW = new Date('2026-09-26T01:20:00.000Z');
const CANON = '33333333-3333-4333-8333-333333333333';
const GUEST = '44444444-4444-4444-8444-444444444444';

function activeHorseTask(): TaskStateContainer {
  let state = startNewActiveTask(emptyTaskStateContainer(), {
    type:'activity_booking',
    sourceChannel:'web',
    initialSlots:{ resourceCode:'activity-horse', horseName:'ภาราดร', time:'15:00', durationMinutes:60 },
    requiredFields:['date','partySize'],
  }, NOW);
  state = {
    ...state,
    activeTask:setSelectedEntities(state.activeTask!, [{
      id:'activity_asset:horse:paradon',
      type:'horse',
      name:'ภาราดร',
      domain:'activity',
      source:'catalog',
      canonical:true,
    }], NOW),
  };
  return state;
}

function fact(key:string,value:unknown,domain:GroundedFact['domain'],sourceId:string,sourceType:GroundedFact['sourceType']):GroundedFact{
  return {key,value,domain,sourceId,sourceType,authoritative:true,fetchedAt:NOW.toISOString()};
}
function ok(sourceId:string,sourceType:GroundedFact['sourceType'],data:GroundedFact[]):SourceResult{
  return {status:'ok',sourceId,sourceType,fetchedAt:NOW.toISOString(),data};
}

test('Human Brain Phase 2.2 RED: "same/previous selected one" resolves to the active selection, not every recently seen option', () => {
  const context = {
    activeDomain:'activity',
    recentEntities:[
      { id:'activity_asset:horse:paradon', type:'horse', name:'ภาราดร', domain:'activity', canonical:true },
      { id:'activity_asset:horse:thongthai', type:'horse', name:'ทองไทย', domain:'activity', canonical:true },
    ],
    activeTask:{
      type:'activity_booking',
      domain:'activity',
      status:'collecting',
      knownSlots:{ time:'15:00', durationMinutes:60 },
      missingFields:['date','partySize'],
      selectedEntities:[
        { id:'activity_asset:horse:paradon', type:'horse', name:'ภาราดร', domain:'activity', canonical:true },
      ],
      constraints:[],
    },
  } as unknown as SemanticContext;

  const turn = parseSemanticTurnResponse(JSON.stringify({
    domain:'activity',
    intent:'reuse_prior_selection',
    action:'confirm',
    entities:{},
    references:[{ type:'selected_entity', refersToPriorContext:true }],
    constraints:[],
    confidence:0.95,
    needsClarification:false,
  }), context);

  assert.equal(turn.references[0]?.resolvedEntityId, 'activity_asset:horse:paradon');
  assert.equal(turn.references[0]?.resolvedEntityIds, undefined,
    'a singular prior selection must not widen back out to all catalog entities');
  assert.equal(turn.needsClarification, false);
});

test('Human Brain Phase 2.2 RED: compound abandon+topic-switch reaches semantic brain even with an active task', async () => {
  let semanticCalls = 0;
  const deps: Partial<OneMindDependencies> = {
    resolveCanonicalGuestId: async () => CANON,
    guestDbIdFromAnonymousId: async () => GUEST,
    loadConversationContext: async () => ({
      ...emptyConversationContextState(NOW),
      activeDomain:'activity',
      activeTopic:'activity_booking',
      recentEntities:[
        { id:'activity_asset:horse:paradon', type:'horse', name:'ภาราดร', domain:'activity', source:'catalog', canonical:true, observedAt:NOW.toISOString() },
      ],
    }),
    loadTaskState: async () => activeHorseTask(),
    buildKnowledgeAdapters: ():KnowledgeSourceAdapters => ({
      restaurant:{
        menu:async()=>ok('restaurant_menu','restaurant_live',[
          fact('menu:somtam:name','ส้มตำ','restaurant','restaurant_menu','restaurant_live'),
        ]),
      },
    }),
    interpretSemanticTurn: async (_message, context) => {
      semanticCalls += 1;
      assert.equal(context.activeTask?.selectedEntities[0]?.name, 'ภาราดร');
      return {
        domain:'restaurant',
        intent:'restaurant_food_discovery_after_abandoning_prior_task',
        action:'discover',
        entities:{},
        references:[],
        constraints:[],
        confidence:0.97,
        needsClarification:false,
        taskDirective:'cancel_active',
      } as SemanticTurn;
    },
  };

  const result = await processThongthaiOneMindTurn({
    channel:'web',
    message:'ไม่เอาละ ไปกินข้าวก่อน',
    eventId:'phase2-2-compound-switch',
    canonicalAnonymousId:CANON,
    guestDbId:GUEST,
  }, deps, NOW);

  assert.equal(semanticCalls, 1,
    'a coarse deterministic restaurant topic switch must not swallow the compound meaning when an active task exists');
  assert.equal(result.semanticTurn.domain, 'restaurant');
  assert.equal((result.semanticTurn as SemanticTurn & {taskDirective?:string}).taskDirective, 'cancel_active');
  assert.equal(result.taskStateAfter.activeTask?.status, 'cancelled',
    'conversation working-task state should reflect the explicit abandon directive');
  assert.equal(result.taskStateAfter.suspendedTask, null,
    'an explicitly abandoned working task must not be silently kept as a resumable stale task');
  assert.ok(result.dialogPlan.knowledgeRequests.some(request =>
    request.domain === 'restaurant' && request.needs.includes('catalog')
  ), 'the CURRENT restaurant request must still be served after closing the old working task');
  assert.equal(result.dialogDecision.actionProposal, undefined,
    'conversation directives can never execute a booking/order transaction');
});

test('Human Brain Phase 2.2 RED: taskDirective cancels only working state while preserving the current-turn domain decision', () => {
  const semanticTurn = {
    domain:'restaurant',
    intent:'restaurant_food_discovery_after_abandoning_prior_task',
    action:'discover',
    entities:{},
    references:[],
    constraints:[],
    confidence:0.97,
    needsClarification:false,
    taskDirective:'cancel_active',
  } as SemanticTurn & { taskDirective:'cancel_active' };

  const plan = planDialogTurn({
    semanticTurn,
    conversationContext:emptyConversationContextState(NOW),
    taskState:activeHorseTask(),
    channel:'line',
    eventId:'phase2-2-directive-plan',
  }, NOW);
  const decision = resolveDialogDecision(plan, []);

  assert.equal(decision.taskStateContainer.activeTask?.status, 'cancelled');
  assert.equal(decision.taskStateContainer.suspendedTask, null);
  assert.ok(plan.knowledgeRequests.some(request => request.domain === 'restaurant'));
  assert.equal(decision.actionProposal, undefined);
});


test('Human Brain Phase 2.2 guard: a coarse deterministic cross-domain switch is refined when the sentence also abandons the old task', async () => {
  let semanticCalls = 0;
  const deps: Partial<OneMindDependencies> = {
    resolveCanonicalGuestId: async () => CANON,
    guestDbIdFromAnonymousId: async () => GUEST,
    loadConversationContext: async () => ({
      ...emptyConversationContextState(NOW),
      activeDomain:'activity',
      activeTopic:'activity_booking',
    }),
    loadTaskState: async () => activeHorseTask(),
    buildKnowledgeAdapters: ():KnowledgeSourceAdapters => ({
      restaurant:{ menu:async()=>ok('restaurant_menu','restaurant_live',[]) },
    }),
    interpretSemanticTurn: async () => {
      semanticCalls += 1;
      return {
        domain:'restaurant',
        intent:'restaurant_food_discovery_after_abandoning_prior_task',
        action:'discover',
        entities:{},
        references:[],
        constraints:[],
        confidence:0.97,
        needsClarification:false,
        taskDirective:'cancel_active',
      } as SemanticTurn;
    },
  };

  const result = await processThongthaiOneMindTurn({
    channel:'web',
    message:'ไม่เอาละ ร้านมีอะไรกินก่อน',
    eventId:'phase2-2-coarse-switch-refine',
    canonicalAnonymousId:CANON,
    guestDbId:GUEST,
  }, deps, NOW);

  assert.equal(semanticCalls, 1,
    'restaurant_topic_switch is only a coarse domain label; with task context available the Human Brain must get a chance to preserve compound meaning');
  assert.equal(result.taskStateAfter.activeTask?.status, 'cancelled');
  assert.equal(result.taskStateAfter.suspendedTask, null);
});
