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
import { withHarness, guestId, brainRequest } from './helpers/canonical-core-harness';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';

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


test('Human Brain Phase 1 guard: precise proven deterministic intents still bypass the model', async () => {
  let semanticCalls = 0;
  const result = await processThongthaiOneMindTurn({
    channel: 'line',
    message: 'มีม้ากี่ตัว',
    eventId: 'human-brain-phase1-inventory',
    providerUserKey: 'line-key',
  }, {
    ...baseDeps(),
    interpretSemanticTurn: async () => {
      semanticCalls += 1;
      throw new Error('precise_inventory_semantics_should_stay_deterministic');
    },
  }, NOW);

  assert.equal(semanticCalls, 0);
  assert.equal(result.semanticTurn.intent, 'activity_inventory_count');
  assert.equal(result.semanticTurn.domain, 'activity');
});

test('Human Brain Phase 1 guard: weak model refinement cannot overwrite the mature deterministic fallback', async () => {
  let semanticCalls = 0;
  const result = await processThongthaiOneMindTurn({
    channel: 'line',
    message: 'ที่ร้านอาหารพรุ่งนี้ตอน 18.00 โต๊ะเต็มรึยังคะ',
    eventId: 'human-brain-phase1-weak-model',
    providerUserKey: 'line-key',
  }, {
    ...baseDeps(),
    interpretSemanticTurn: async () => {
      semanticCalls += 1;
      return {
        domain: 'unknown',
        intent: 'unknown',
        action: 'unknown',
        entities: {},
        references: [],
        constraints: [],
        confidence: 0.2,
        needsClarification: true,
        clarificationReason: 'uncertain',
      };
    },
  }, NOW);

  assert.equal(semanticCalls, 1);
  assert.equal(result.semanticTurn.intent, 'restaurant_topic_switch',
    'a weak/ambiguous model result must not erase the old system\'s known restaurant topic');
  assert.equal(result.semanticTurn.domain, 'restaurant');
});


test('Human Brain Phase 1 canonical gate: dietary memory cannot hijack a later restaurant table-availability question', async () => {
  await withHarness(async harness => {
    const gid = guestId('human-brain-owner-availability');

    // Reproduce the real production setup: the guest previously supplied food
    // constraints, so durable restaurant memory is active.
    const remembered = await processThongthaiChatCore(
      brainRequest('ไม่กินไก่ ไม่กินกุ้ง ไม่เผ็ด', gid, 'line'),
      'human-brain-owner-memory',
    );
    assert.equal(remembered.statusCode, 200);

    // The NEXT Gemini call must be the semantic interpreter for the current
    // whole sentence. This object is intentionally the raw semantic JSON that
    // the real model is instructed to return.
    (harness.programGeminiReply as unknown as (reply: Record<string, unknown>) => void)({
      domain: 'restaurant',
      intent: 'table_availability_check',
      action: 'status',
      informationNeed: 'availability',
      entities: { date: 'พรุ่งนี้', time: '18:00' },
      references: [],
      constraints: [],
      confidence: 0.98,
      needsClarification: false,
    });

    const before = harness.modelCallCount();
    const result = await processThongthaiChatCore(
      brainRequest('ที่ร้านอาหารพรุ่งนี้ตอน 18.00 โต๊ะเต็มรึยังคะ', gid, 'line'),
      'human-brain-owner-availability',
    );
    const used = harness.modelCallCount() - before;
    const reply = String(result.payload.message ?? '');

    assert.equal(result.statusCode, 200);
    assert.ok(used >= 1,
      'the real customer entrypoint must let the semantic brain read this whole sentence');
    assert.doesNotMatch(reply, /ผัดไทย|ต้มยำกุ้ง|ข้าวผัดหมู/u,
      'a table-availability question must never be turned into a dietary menu recommendation');
    assert.match(reply, /โต๊ะ|ที่นั่ง/u);
    assert.match(reply, /พรุ่งนี้/u);
    assert.match(reply, /18:00/u);
  });
});
