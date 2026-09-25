import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planDialogTurn,
  resolveDialogDecision,
} from '../netlify/functions/_dialog-manager';
import {
  resolveKnowledge,
} from '../netlify/functions/_knowledge-resolver';
import {
  planKnowledgeDegradation,
} from '../netlify/functions/_graceful-degradation';
import {
  composeDeterministicResponse,
} from '../netlify/functions/_response-composer';
import {
  emptyConversationContextState,
} from '../netlify/functions/_conversation-context';
import {
  emptyTaskStateContainer,
} from '../netlify/functions/_task-state';
import type { SemanticTurn } from '../netlify/functions/_semantic-interpreter';

const NOW = new Date('2026-09-26T00:31:00.000Z');

function availabilityTurn(): SemanticTurn {
  return {
    domain: 'restaurant',
    intent: 'restaurant_table_availability',
    action: 'status',
    entities: { date: 'พรุ่งนี้', time: '18:00' },
    references: [],
    constraints: [],
    confidence: 0.98,
    needsClarification: false,
  };
}

test('Human Brain Phase 1.2 RED: restaurant table availability requests availability, never order status', () => {
  const plan = planDialogTurn({
    semanticTurn: availabilityTurn(),
    conversationContext: emptyConversationContextState(NOW),
    taskState: emptyTaskStateContainer(),
    channel: 'line',
    eventId: 'phase1-2-availability-plan',
  }, NOW);

  assert.equal(plan.knowledgeRequests.length, 1);
  assert.equal(plan.knowledgeRequests[0]?.domain, 'restaurant');
  assert.deepEqual(plan.knowledgeRequests[0]?.needs, ['availability'],
    'table availability is live venue capacity, not the status of a prior food order');
  assert.equal(plan.knowledgeRequests[0]?.entities.date, 'พรุ่งนี้');
  assert.equal(plan.knowledgeRequests[0]?.entities.time, '18:00');
  assert.ok(!plan.knowledgeRequests[0]?.needs.includes('order_status'));
});

test('Human Brain Phase 1.2 RED: if no live table source exists, the deterministic reply preserves date/time and the actual question', async () => {
  const plan = planDialogTurn({
    semanticTurn: availabilityTurn(),
    conversationContext: emptyConversationContextState(NOW),
    taskState: emptyTaskStateContainer(),
    channel: 'line',
    eventId: 'phase1-2-availability-copy',
  }, NOW);

  const bundle = await resolveKnowledge(plan.knowledgeRequests[0]!, {}, NOW);
  const decision = resolveDialogDecision(plan, [bundle]);
  const degradation = planKnowledgeDegradation([bundle]);
  const response = composeDeterministicResponse({
    channel: 'line',
    language: 'th',
    userMessage: 'ที่ร้านอาหารพรุ่งนี้ตอน 18.00 โต๊ะเต็มรึยังคะ',
    dialogDecision: decision,
    knowledgeBundles: [bundle],
    degradation,
  });

  assert.equal(degradation.condition, 'fact_unknown');
  assert.match(response.message, /พรุ่งนี้/u);
  assert.match(response.message, /18:00/u);
  assert.match(response.message, /โต๊ะ|ที่นั่ง/u,
    'honest degradation should still show that Thongthai understood the table-availability question');
  assert.doesNotMatch(response.message, /ออเดอร์|คำสั่งซื้อ|สถานะรายการ/u);
  assert.doesNotMatch(response.message, /เมนู|คอหมู|ไข่เจียว/u);
});


test('Human Brain Phase 1.2 guard: registered restaurant availability source is used exclusively, never order-status lookup', async () => {
  const plan = planDialogTurn({
    semanticTurn: availabilityTurn(),
    conversationContext: emptyConversationContextState(NOW),
    taskState: emptyTaskStateContainer(),
    channel: 'line',
    eventId: 'phase1-2-source-routing',
  }, NOW);

  let availabilityCalls = 0;
  let orderStatusCalls = 0;

  const bundle = await resolveKnowledge(plan.knowledgeRequests[0]!, {
    restaurant: {
      availability: async () => {
        availabilityCalls += 1;
        return {
          status: 'empty',
          sourceId: 'restaurant_table_availability_live',
          sourceType: 'restaurant_live',
          fetchedAt: NOW.toISOString(),
        };
      },
    },
    orderStatus: {
      lookup: async () => {
        orderStatusCalls += 1;
        return {
          status: 'empty',
          sourceId: 'restaurant_orders',
          sourceType: 'order_operational',
          fetchedAt: NOW.toISOString(),
        };
      },
    },
  }, NOW);

  assert.equal(availabilityCalls, 1);
  assert.equal(orderStatusCalls, 0);
  assert.equal(bundle.sources[0]?.need, 'availability');
  assert.equal(bundle.sources[0]?.sourceType, 'restaurant_live');
});
