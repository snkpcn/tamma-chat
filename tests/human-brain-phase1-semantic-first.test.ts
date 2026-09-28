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

test('Human Brain Phase 1: an in-progress transactional slot update is understood by the supervisor before deterministic execution', async () => {
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
      return {
        domain:'activity',
        intent:'provide_booking_details',
        action:'provide_information',
        informationNeed:'none',
        entities:{ date:'พรุ่งนี้', partySize:2 },
        references:[],
        constraints:[],
        confidence:0.98,
        needsClarification:false,
      };
    },
  }, NOW);

  assert.equal(semanticCalls, 1,
    'every ordinary customer utterance must be read by the language supervisor before business execution');
  assert.equal(result.semanticTurn.domain, 'activity');
  assert.equal(result.semanticTurn.entities.partySize, 2);
  assert.ok(result.semanticTurn.entities.date);
});


test('Human Brain Phase 1: precise inventory language is still read by the supervisor before grounded lookup', async () => {
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
      return {
        domain:'activity',
        intent:'activity_inventory_count',
        action:'ask',
        informationNeed:'inventory',
        entities:{ activityType:'horse' },
        references:[],
        constraints:[],
        confidence:0.98,
        needsClarification:false,
      };
    },
  }, NOW);

  assert.equal(semanticCalls, 1);
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
  // A dedicated table-availability classification (restaurant_availability_
  // check) was added after this test was written -- it is a MORE precise
  // deterministic candidate for this exact message than the old generic
  // restaurant_topic_switch bucket, but the invariant under test (a weak
  // model result must not erase deterministic's own known restaurant
  // classification) still holds under the new, more specific intent name.
  assert.equal(result.semanticTurn.intent, 'restaurant_availability_check',
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

// Production cost invariant (Human Core PR A, 2026-09-27): the H1 audit found
// that the early One-Mind attempt's own semantic result (earlyOneMind) was
// never assigned, so a turn the early attempt could not fully compose (e.g.
// a domain not yet cut over to One-Mind, which returns 'legacy_required')
// silently re-attempted interpretSemanticTurn in TWO further call sites
// later in the same request (the "cutover" One-Mind attempt, and
// deterministicActivityResponse's own independent processOneMindCustomerTurn
// call) instead of reusing the already-computed meaning.
//
// The cost ledger's own eventId-keyed idempotency (_ai-cost-ledger.ts's
// reserveAiCall) already prevents this from becoming an actual duplicate
// OpenAI charge -- a repeated attempt for the same event replays the first
// call's cached output and logs 'ai_duplicate_call_prevented' rather than
// hitting the network again. But the application code still wastefully
// re-attempts the whole reservation/prompt-building path for nothing, and
// each such attempt is a real (if currently caught) violation of "at most
// one paid semantic call per customer turn" that a future change to the
// ledger's own safety net would turn into an actual double charge. The
// correct fix is for the application itself to never attempt a call it
// already has the answer to -- proven here by asserting that log NEVER
// appears, not by relying on the ledger to keep catching it.
test('Human Brain Phase 1 cost invariant: no call site re-attempts a semantic call the request already has an answer for', async () => {
  await withHarness(async harness => {
    const gid = guestId('human-brain-cost-invariant-legacy-required');
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
      originalLog(...(args as []));
    };

    (harness.programGeminiReply as unknown as (reply: Record<string, unknown>) => void)({
      // 'support' is not one of One-Mind's read-only-cutover domains, so the
      // early attempt understands the turn correctly but must still defer
      // execution to the legacy owner ('legacy_required') -- exactly the
      // shape of turn the audit found silently re-attempted.
      domain: 'support',
      intent: 'contact_staff_other_matter',
      action: 'ask',
      informationNeed: 'none',
      speechAct: 'request_help',
      entities: {},
      references: [],
      constraints: [],
      confidence: 0.95,
      needsClarification: false,
    });

    try {
      await processThongthaiChatCore(
        brainRequest('อยากติดต่อทีมงานเรื่องอื่นที่ไม่เกี่ยวกับเรื่องที่คุยกันได้ไหมครับ', gid, 'line'),
        'human-brain-cost-invariant-legacy-required',
      );
    } finally {
      console.log = originalLog;
    }

    const duplicateAttempts = logs.filter(line => line.includes('ai_duplicate_call_prevented'));
    assert.equal(duplicateAttempts.length, 0,
      'a domain not yet cut over to One-Mind must still reuse the early attempt\'s own semantic result in every later call site (the cutover attempt AND deterministicActivityResponse) -- none of them may re-attempt interpretSemanticTurn for a request that already has an answer, even though the cost ledger currently catches and no-ops the repeat');
  });
});
