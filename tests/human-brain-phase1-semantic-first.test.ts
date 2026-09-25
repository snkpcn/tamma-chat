import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  processThongthaiOneMindTurn,
  type OneMindDependencies,
} from '../netlify/functions/_thongthai-one-mind-orchestrator';
import {
  emptyConversationContextState,
} from '../netlify/functions/_conversation-context';
import {
  emptyTaskStateContainer,
  startNewActiveTask,
} from '../netlify/functions/_task-state';
import type { SemanticTurn } from '../netlify/functions/_semantic-interpreter';

const NOW = new Date('2026-09-26T00:00:00.000Z');
const CANONICAL = '11111111-1111-4111-8111-111111111111';
const GUEST_DB = '22222222-2222-4222-8222-222222222222';

function baseDeps(): Partial<OneMindDependencies> {
  return {
    resolveCanonicalGuestId: async () => CANONICAL,
    guestDbIdFromAnonymousId: async () => GUEST_DB,
    loadConversationContext: async () => emptyConversationContextState(NOW),
    persistConversationContext: async () => undefined,
    loadTaskState: async () => emptyTaskStateContainer(),
    persistTaskState: async () => undefined,
    buildKnowledgeAdapters: () => ({}),
  };
}

test('Human Brain Phase 1 RED: ordinary Thai meaning is owned by the LLM semantic brain before topic regex', async () => {
  let semanticCalls = 0;
  const semantic: SemanticTurn = {
    domain: 'restaurant',
    intent: 'restaurant_table_availability',
    action: 'status',
    entities: { date: 'พรุ่งนี้', time: '18:00' },
    references: [],
    constraints: [],
    confidence: 0.98,
    needsClarification: false,
  };

  const result = await processThongthaiOneMindTurn({
    channel: 'line',
    message: 'ที่ร้านอาหารพรุ่งนี้ตอน 18.00 โต๊ะเต็มรึยังคะ',
    eventId: 'human-brain-phase1-availability',
    providerUserKey: 'line-key',
  }, {
    ...baseDeps(),
    interpretSemanticTurn: async () => {
      semanticCalls += 1;
      return semantic;
    },
  }, NOW);

  assert.equal(semanticCalls, 1,
    'ordinary conversation must reach the language model; a restaurant keyword/topic regex must not preempt whole-sentence meaning');
  assert.equal(result.semanticTurn.domain, 'restaurant');
  assert.equal(result.semanticTurn.intent, 'restaurant_table_availability');
  assert.equal(result.semanticTurn.action, 'status');
  assert.equal(result.semanticTurn.entities.time, '18:00');
});

test('Human Brain Phase 1 guard: an in-progress transactional slot update stays deterministic and does not require the model', async () => {
  let semanticCalls = 0;
  const active = startNewActiveTask(emptyTaskStateContainer(), {
    type: 'activity_booking',
    sourceChannel: 'line',
    initialSlots: { resourceCode: 'horse-riding', horseName: 'ภาราดร' },
    requiredFields: ['date', 'partySize'],
  }, NOW);

  const result = await processThongthaiOneMindTurn({
    channel: 'line',
    message: 'พรุ่งนี้สองคน',
    eventId: 'human-brain-phase1-slot',
    providerUserKey: 'line-key',
  }, {
    ...baseDeps(),
    loadTaskState: async () => active,
    interpretSemanticTurn: async () => {
      semanticCalls += 1;
      throw new Error('model_should_not_be_needed_for_structured_active_task_slot');
    },
  }, NOW);

  assert.equal(semanticCalls, 0,
    'business-critical active task slot filling should keep the proven deterministic path');
  assert.equal(result.semanticTurn.domain, 'activity');
  assert.equal(result.semanticTurn.entities.partySize, 2);
  assert.ok(result.semanticTurn.entities.date);
});
