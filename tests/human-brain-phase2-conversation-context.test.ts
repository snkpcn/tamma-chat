import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  processThongthaiOneMindTurn,
  type OneMindDependencies,
} from '../netlify/functions/_thongthai-one-mind-orchestrator';
import {
  applyConversationContextUpdate,
  emptyConversationContextState,
} from '../netlify/functions/_conversation-context';
import {
  emptyTaskStateContainer,
  setSelectedEntities,
  startNewActiveTask,
  type TaskStateContainer,
} from '../netlify/functions/_task-state';
import {
  parseSemanticTurnResponse,
  type SemanticContext,
  type SemanticTurn,
} from '../netlify/functions/_semantic-interpreter';
import {
  planDialogTurn,
  resolveDialogDecision,
} from '../netlify/functions/_dialog-manager';
import { planKnowledgeDegradation } from '../netlify/functions/_graceful-degradation';
import { composeDeterministicResponse } from '../netlify/functions/_response-composer';

const NOW = new Date('2026-09-26T01:00:00.000Z');
const CANON = '11111111-1111-4111-8111-111111111111';
const GUEST = '22222222-2222-4222-8222-222222222222';

function activeHorseTask(): TaskStateContainer {
  let state = startNewActiveTask(emptyTaskStateContainer(), {
    type: 'activity_booking',
    sourceChannel: 'web',
    initialSlots: {
      date: '2026-09-27',
      time: '15:00',
      durationMinutes: 60,
      partySize: 2,
      resourceCode: 'activity-horse',
      phone: '0899999999',
      email: 'secret@example.com',
    },
    requiredFields: ['date', 'time', 'durationMinutes', 'partySize'],
  }, NOW);
  state = {
    ...state,
    activeTask: setSelectedEntities(state.activeTask!, [{
      id: 'activity_asset:horse:paradon',
      type: 'horse',
      name: 'ภาราดร',
      domain: 'activity',
      source: 'catalog',
      canonical: true,
    }], NOW),
  };
  return state;
}

test('Human Brain Phase 2 RED: semantic brain receives bounded conversation + privacy-safe active-task context', async () => {
  let conversation = emptyConversationContextState(NOW);
  conversation = applyConversationContextUpdate(conversation, {
    eventId: 'ctx-1',
    channel: 'line',
    userMessage: 'อยากขี่ม้า',
    activeDomain: 'activity',
    activeTopic: 'activity_booking',
    summaryFact: 'ลูกค้ากำลังวางแผนขี่ม้า',
  }, NOW);
  conversation = applyConversationContextUpdate(conversation, {
    eventId: 'ctx-2',
    channel: 'line',
    userMessage: 'เอาภาราดร',
    activeDomain: 'activity',
    activeTopic: 'select_horse',
    summaryFact: 'ลูกค้าเลือกภาราดร',
  }, new Date(NOW.getTime() + 1000));

  let seen: SemanticContext | null = null;
  const deps: Partial<OneMindDependencies> = {
    resolveCanonicalGuestId: async () => CANON,
    guestDbIdFromAnonymousId: async () => GUEST,
    loadConversationContext: async () => conversation,
    loadTaskState: async () => activeHorseTask(),
    buildKnowledgeAdapters: () => ({}),
    interpretSemanticTurn: async (_message, context) => {
      seen = context;
      return {
        domain: 'activity',
        intent: 'summarize_active_task',
        action: 'ask',
        entities: {},
        references: [],
        constraints: [],
        confidence: 0.96,
        needsClarification: false,
      };
    },
  };

  await processThongthaiOneMindTurn({
    channel: 'web',
    message: 'ตอนนี้ที่เลือกไว้มีอะไรบ้าง',
    eventId: 'phase2-context-red',
    canonicalAnonymousId: CANON,
    guestDbId: GUEST,
  }, deps, new Date(NOW.getTime() + 2000));

  assert.ok(seen, 'the semantic model must be called for this natural follow-up');
  const context = seen as SemanticContext & {
    recentTurns?: Array<{ role: string; content: string }>;
    rollingSummary?: string;
    activeTopic?: string;
    activeTask?: {
      knownSlots?: Record<string, unknown>;
      selectedEntities?: Array<{ name: string }>;
    } | null;
  };

  assert.deepEqual(context.recentTurns?.map(turn => turn.content), ['อยากขี่ม้า', 'เอาภาราดร']);
  assert.match(context.rollingSummary ?? '', /วางแผนขี่ม้า.*เลือกภาราดร/u);
  assert.equal(context.activeTopic, 'select_horse');
  assert.equal(context.activeTask?.knownSlots?.time, '15:00');
  assert.equal(context.activeTask?.knownSlots?.durationMinutes, 60);
  assert.equal(context.activeTask?.selectedEntities?.[0]?.name, 'ภาราดร');

  const serialized = JSON.stringify(context);
  assert.doesNotMatch(serialized, /0899999999/u, 'phone must not be exposed to the language-understanding prompt');
  assert.doesNotMatch(serialized, /secret@example\.com/u, 'email must not be exposed to the language-understanding prompt');
});

test('Human Brain Phase 2 RED: a task-slot reference resolves from real active-task state instead of forcing clarification', () => {
  const context = {
    activeDomain: 'activity',
    recentEntities: [],
    activeTask: {
      type: 'activity_booking',
      domain: 'activity',
      status: 'collecting',
      knownSlots: { time: '15:00', durationMinutes: 60 },
      missingFields: ['date'],
      selectedEntities: [{ id:'activity_asset:horse:paradon', type:'horse', name:'ภาราดร', domain:'activity', canonical:true }],
    },
  } as unknown as SemanticContext;

  const turn = parseSemanticTurnResponse(JSON.stringify({
    domain: 'activity',
    intent: 'reaffirm_existing_task_value',
    action: 'provide_information',
    entities: {},
    references: [{ type:'task_slot', value:'time', refersToPriorContext:true }],
    constraints: [],
    confidence: 0.94,
    needsClarification: false,
  }), context);

  assert.equal(turn.entities.time, '15:00',
    'the semantic validator should resolve "same time" from canonical task state, not ask the customer to repeat it');
  assert.equal(turn.needsClarification, false);
});

test('Human Brain Phase 2 RED: "what have I selected?" is a generic active-task summary, not a catalog lookup', () => {
  const taskState = activeHorseTask();
  const semanticTurn: SemanticTurn = {
    domain: 'activity',
    intent: 'summarize_active_task',
    action: 'ask',
    entities: {},
    references: [],
    constraints: [],
    confidence: 0.97,
    needsClarification: false,
  };

  const plan = planDialogTurn({
    semanticTurn,
    conversationContext: emptyConversationContextState(NOW),
    taskState,
    channel: 'line',
    eventId: 'phase2-summary-red',
  }, NOW);

  assert.equal(plan.knowledgeRequests.length, 0,
    'summarizing what the customer already selected must read task state, not fetch/recommend a catalog again');

  const decision = resolveDialogDecision(plan, []);
  assert.equal(String(decision.responseIntent), 'active_task_summary');

  const response = composeDeterministicResponse({
    channel: 'line',
    language: 'th',
    userMessage: 'ตอนนี้ที่เลือกไว้มีอะไรบ้าง',
    dialogDecision: decision,
    knowledgeBundles: [],
    degradation: planKnowledgeDegradation([]),
  });

  assert.match(response.message, /ภาราดร/u);
  assert.match(response.message, /15:00/u);
  assert.match(response.message, /60\s*นาที/u);
  assert.match(response.message, /2\s*คน/u);
  assert.doesNotMatch(response.message, /0899999999|secret@example\.com|activity-horse/u,
    'task summary must expose customer-facing selections only, never contact/internal slot data');
});
