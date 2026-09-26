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

const NOW = new Date('2026-09-26T02:20:00.000Z');
const CANONICAL = '51111111-1111-4111-8111-111111111111';
const GUEST_DB = '52222222-2222-4222-8222-222222222222';

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

function modelTurn(overrides: Partial<SemanticTurn> = {}): SemanticTurn {
  return {
    domain: 'stay',
    intent: 'room_availability_query',
    action: 'ask',
    informationNeed: 'availability',
    entities: { date: 'วันเสาร์' },
    references: [],
    constraints: [],
    confidence: 0.95,
    needsClarification: false,
    ...overrides,
  };
}

test('Human Brain Phase 5.2 RED: task-free stay inquiry is read by Language Brain, not finalized by topic regex', async () => {
  let calls = 0;
  const result = await processThongthaiOneMindTurn({
    channel: 'line',
    message: 'เสาร์นี้ยังมีห้องว่างไหม',
    eventId: 'hb-5-2-stay',
    providerUserKey: 'line-key',
  }, {
    ...baseDeps(),
    interpretSemanticTurn: async () => {
      calls += 1;
      return modelTurn();
    },
  }, NOW);

  assert.equal(calls, 1);
  assert.equal(result.semanticTurn.domain, 'stay');
  assert.equal(result.semanticTurn.informationNeed, 'availability');
  assert.equal(result.semanticTurn.entities.date, 'วันเสาร์');
});

test('Human Brain Phase 5.2 RED: cafe fact inquiry is read as a whole sentence by Language Brain', async () => {
  let calls = 0;
  const result = await processThongthaiOneMindTurn({
    channel: 'line',
    message: 'คาเฟ่มีลาเต้เย็นไม่หวานไหม',
    eventId: 'hb-5-2-cafe',
    providerUserKey: 'line-key',
  }, {
    ...baseDeps(),
    interpretSemanticTurn: async () => {
      calls += 1;
      return modelTurn({
        domain: 'cafe',
        intent: 'ask_cafe_item_with_preference',
        action: 'ask',
        informationNeed: 'catalog',
        entities: { itemName: 'ลาเต้เย็น' },
        constraints: ['no_sugar'],
      });
    },
  }, NOW);

  assert.equal(calls, 1);
  assert.equal(result.semanticTurn.domain, 'cafe');
  assert.equal(result.semanticTurn.entities.itemName, 'ลาเต้เย็น');
  assert.deepEqual(result.semanticTurn.constraints, ['no_sugar']);
});

test('Human Brain Phase 5.2 RED: a richer activity capacity question is not collapsed to activity topic discovery', async () => {
  let calls = 0;
  const result = await processThongthaiOneMindTurn({
    channel: 'line',
    message: 'ATV สามคันออกพร้อมกันได้ไหม',
    eventId: 'hb-5-2-atv-capacity',
    providerUserKey: 'line-key',
  }, {
    ...baseDeps(),
    interpretSemanticTurn: async () => {
      calls += 1;
      return modelTurn({
        domain: 'activity',
        intent: 'ask_atv_capacity',
        action: 'ask',
        informationNeed: 'policy',
        entities: { activityType: 'atv', quantity: 3 },
      });
    },
  }, NOW);

  assert.equal(calls, 1);
  assert.equal(result.semanticTurn.intent, 'ask_atv_capacity');
  assert.equal(result.semanticTurn.informationNeed, 'policy');
  assert.equal(result.semanticTurn.entities.quantity, 3);
});

test('Human Brain Phase 5.2 RED: read-only side question during an active booking reaches Language Brain without mutating the transaction', async () => {
  let calls = 0;
  const active = startNewActiveTask(emptyTaskStateContainer(), {
    type: 'activity_booking',
    sourceChannel: 'line',
    initialSlots: { resourceCode: 'horse-riding', horseName: 'ภาราดร', date: 'พรุ่งนี้' },
    requiredFields: ['date', 'time', 'durationMinutes', 'partySize'],
  }, NOW);

  const result = await processThongthaiOneMindTurn({
    channel: 'line',
    message: 'แล้วขี่ม้าราคาเท่าไหร่',
    eventId: 'hb-5-2-active-price',
    providerUserKey: 'line-key',
  }, {
    ...baseDeps(),
    loadTaskState: async () => active,
    interpretSemanticTurn: async () => {
      calls += 1;
      return modelTurn({
        domain: 'activity',
        intent: 'ask_horse_price',
        action: 'ask',
        informationNeed: 'price',
        entities: { activityType: 'horse' },
      });
    },
  }, NOW);

  assert.equal(calls, 1);
  assert.equal(result.semanticTurn.informationNeed, 'price');
  assert.equal(result.taskStateAfter.activeTask?.slots.horseName, 'ภาราดร');
  assert.equal(result.taskStateAfter.activeTask?.slots.date, 'พรุ่งนี้');
  assert.notEqual(result.taskStateAfter.activeTask?.status, 'completed');
});

test('Human Conversation Recovery: transactional slot filling is understood by Language Brain before safe task merge', async () => {
  let calls = 0;
  const active = startNewActiveTask(emptyTaskStateContainer(), {
    type: 'activity_booking',
    sourceChannel: 'line',
    initialSlots: { resourceCode: 'horse-riding', horseName: 'ภาราดร' },
    requiredFields: ['date', 'partySize'],
  }, NOW);

  const result = await processThongthaiOneMindTurn({
    channel: 'line',
    message: 'พรุ่งนี้สองคน',
    eventId: 'hb-5-2-slot',
    providerUserKey: 'line-key',
  }, {
    ...baseDeps(),
    loadTaskState: async () => active,
    interpretSemanticTurn: async () => {
      calls += 1;
      return modelTurn({
        domain: 'activity',
        intent: 'provide_booking_details',
        action: 'provide_information',
        informationNeed: 'none',
        entities: { date: 'พรุ่งนี้', partySize: 2 },
      });
    },
  }, NOW);

  assert.equal(calls, 1);
  assert.equal(result.semanticTurn.action, 'provide_information');
  assert.equal(result.semanticTurn.entities.partySize, 2);
});

test('Human Conversation Recovery: exact inventory question is still read by Language Brain first', async () => {
  let calls = 0;
  const result = await processThongthaiOneMindTurn({
    channel: 'line',
    message: 'มีม้ากี่ตัว',
    eventId: 'hb-5-2-exact-inventory',
    providerUserKey: 'line-key',
  }, {
    ...baseDeps(),
    interpretSemanticTurn: async () => {
      calls += 1;
      return modelTurn({
        domain: 'activity',
        intent: 'activity_inventory_count',
        action: 'ask',
        informationNeed: 'inventory',
        entities: { activityType: 'horse' },
      });
    },
  }, NOW);

  assert.equal(calls, 1);
  assert.equal(result.semanticTurn.intent, 'activity_inventory_count');
});

test('Human Brain Phase 5.2 guard: weak or write-escalating model output cannot replace a safe read-only deterministic candidate', async () => {
  let calls = 0;
  const result = await processThongthaiOneMindTurn({
    channel: 'line',
    message: 'เสาร์นี้ยังมีห้องว่างไหม',
    eventId: 'hb-5-2-no-write-escalation',
    providerUserKey: 'line-key',
  }, {
    ...baseDeps(),
    interpretSemanticTurn: async () => {
      calls += 1;
      return modelTurn({
        domain: 'stay',
        intent: 'book_stay',
        action: 'book',
        informationNeed: 'availability',
        confidence: 0.99,
      });
    },
  }, NOW);

  assert.equal(calls, 1);
  assert.notEqual(result.semanticTurn.action, 'book');
  assert.ok(['ask', 'status'].includes(result.semanticTurn.action));
});

test('Human Brain Phase 5.2: a high-confidence clarification is allowed to beat a coarse read-only guess', async () => {
  let calls = 0;
  const result = await processThongthaiOneMindTurn({
    channel: 'line',
    message: 'ห้องอันนั้นยังมีไหม',
    eventId: 'hb-5-2-clarify',
    providerUserKey: 'line-key',
  }, {
    ...baseDeps(),
    interpretSemanticTurn: async () => {
      calls += 1;
      return modelTurn({
        domain: 'stay',
        intent: 'clarify_which_room',
        action: 'ask',
        informationNeed: 'availability',
        entities: {},
        references: [{ type: 'previous_selection', value: 'อันนั้น', refersToPriorContext: true }],
        confidence: 0.82,
        needsClarification: true,
        clarificationReason: 'unresolved_reference',
      });
    },
  }, NOW);

  assert.equal(calls, 1);
  assert.equal(result.semanticTurn.needsClarification, true);
  assert.equal(result.semanticTurn.clarificationReason, 'unresolved_reference');
});
