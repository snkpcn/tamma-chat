import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  processThongthaiOneMindTurn,
  type OneMindDependencies,
} from '../netlify/functions/_thongthai-one-mind-orchestrator';
import { readOnlyCutoverEligibility } from '../netlify/functions/_thongthai-one-mind-response';
import { emptyConversationContextState } from '../netlify/functions/_conversation-context';
import { emptyTaskStateContainer } from '../netlify/functions/_task-state';
import type { SemanticTurn } from '../netlify/functions/_semantic-interpreter';

const NOW = new Date('2026-09-26T11:40:00.000Z');
const CANONICAL = '61111111-1111-4111-8111-111111111111';
const GUEST_DB = '62222222-2222-4222-8222-222222222222';

function deps(): Partial<OneMindDependencies> {
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

function semantic(overrides: Partial<SemanticTurn>): SemanticTurn {
  return {
    domain: 'restaurant',
    intent: 'preference_update',
    action: 'provide_information',
    informationNeed: 'none',
    entities: {},
    references: [],
    constraints: [],
    confidence: 0.96,
    needsClarification: false,
    ...overrides,
  };
}

test('Human Conversation Recovery: colloquial constraint is language-owned and does not create a preorder task', async () => {
  let modelCalls = 0;
  const result = await processThongthaiOneMindTurn({
    channel: 'line',
    message: 'หมูก็ไม่เอาด้วย',
    eventId: 'recovery-no-pork',
    providerUserKey: 'line-key',
    persistState: false,
  }, {
    ...deps(),
    interpretSemanticTurn: async () => {
      modelCalls += 1;
      return semantic({ constraints: ['no_pork'] });
    },
  }, NOW);

  assert.equal(modelCalls, 1, 'natural language must reach Language Brain');
  assert.equal(result.semanticTurn.action, 'provide_information');
  assert.deepEqual(result.semanticTurn.constraints, ['no_pork']);
  assert.equal(result.taskStateAfter.activeTask, null, 'preference-only turn must not invent an order task');
  assert.equal(readOnlyCutoverEligibility(result).eligible, true, 'safe preference turn must stay in One Mind instead of falling back to regex routing');
  assert.match(result.conversationContextAfter.rollingSummary, /no_pork/);
});

test('Human Conversation Recovery: paraphrases with the same meaning all reach the language layer', async () => {
  const variants = [
    'หมูไม่กินนะ',
    'งดหมูด้วย',
    'หมูผ่านครับ',
    'ของผมไม่หมูนะ',
    'แล้วก็หมูไม่ต้อง',
  ];

  for (const [index, message] of variants.entries()) {
    let modelCalls = 0;
    const result = await processThongthaiOneMindTurn({
      channel: 'line',
      message,
      eventId: `recovery-pork-variant-${index}`,
      providerUserKey: 'line-key',
      persistState: false,
    }, {
      ...deps(),
      interpretSemanticTurn: async () => {
        modelCalls += 1;
        return semantic({ constraints: ['no_pork'] });
      },
    }, NOW);

    assert.equal(modelCalls, 1, `${message} must reach Language Brain`);
    assert.deepEqual(result.semanticTurn.constraints, ['no_pork']);
    assert.equal(result.taskStateAfter.activeTask, null);
  }
});

test('Human Conversation Recovery: deterministic parser remains outage fallback, not primary language owner', async () => {
  let modelCalls = 0;
  const result = await processThongthaiOneMindTurn({
    channel: 'line',
    message: 'มีม้ากี่ตัว',
    eventId: 'recovery-inventory-language-first',
    providerUserKey: 'line-key',
    persistState: false,
  }, {
    ...deps(),
    interpretSemanticTurn: async () => {
      modelCalls += 1;
      return semantic({
        domain: 'activity',
        intent: 'activity_inventory_count',
        action: 'ask',
        informationNeed: 'inventory',
        entities: { activityType: 'horse' },
      });
    },
  }, NOW);

  assert.equal(modelCalls, 1);
  assert.equal(result.semanticTurn.domain, 'activity');
  assert.equal(result.semanticTurn.informationNeed, 'inventory');
});
