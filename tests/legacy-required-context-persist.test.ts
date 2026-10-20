import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  processThongthaiOneMindTurnAuthoritative,
  semanticTurnTrustedForState,
  type OneMindDependencies,
  type OneMindTurnResult,
} from '../netlify/functions/_thongthai-one-mind-orchestrator';
import { LLMAvailabilityError } from '../netlify/functions/_thongthai-model-provider';
import {
  applyConversationContextUpdate,
  emptyConversationContextState,
} from '../netlify/functions/_conversation-context';
import { emptyTaskStateContainer, type TaskStateContainer } from '../netlify/functions/_task-state';
import type { SemanticTurn } from '../netlify/functions/_semantic-interpreter';

const NOW = new Date('2026-10-20T12:00:00.000Z');
const CANONICAL = '11111111-1111-4111-8111-111111111111';
const GUEST_DB = '22222222-2222-4222-8222-222222222222';

const RESPONSE_SOURCE = readFileSync(
  new URL('../netlify/functions/_thongthai-one-mind-response.ts', import.meta.url),
  'utf8',
);
const CHAT_SOURCE = readFileSync(
  new URL('../netlify/functions/thongthai-chat.ts', import.meta.url),
  'utf8',
);

function semantic(overrides: Partial<SemanticTurn> = {}): SemanticTurn {
  return {
    domain:'activity',
    intent:'activity_price',
    action:'provide_information',
    entities:{},
    references:[],
    constraints:[],
    confidence:0.95,
    needsClarification:false,
    ...overrides,
  };
}

type Written = { conversationContext?:unknown; taskState?:unknown };

/** Run the authoritative path and capture exactly which sibling keys the
 *  compare-and-swap patch touched. */
async function runTurn(options:{
  persistPredicate:(result:OneMindTurnResult)=>boolean;
  contextOnlyPredicate?:(result:OneMindTurnResult)=>boolean;
  semanticTurn?:SemanticTurn;
  existingTaskState?:TaskStateContainer;
}) {
  const deps:Partial<OneMindDependencies> = {
    resolveCanonicalGuestId: async () => CANONICAL,
    guestDbIdFromAnonymousId: async () => GUEST_DB,
    interpretSemanticTurn: async () => options.semanticTurn ?? semantic(),
    buildKnowledgeAdapters: () => ({}),
  };
  const existingTaskState = options.existingTaskState ?? emptyTaskStateContainer();
  let written:Written|null = null;
  let casCalls = 0;

  const result = await processThongthaiOneMindTurnAuthoritative({
    channel:'line',
    message:'ขี่ม้าราคาเท่าไหร่',
    eventId:'evt-1',
    providerUserKey:'line-key',
    persistState:true,
  }, deps, {
    loadSnapshot: async () => ({
      exists:true,
      state:{ taskState:existingTaskState },
      updatedAt:'2026-10-20T11:59:00.000Z',
    }),
    compareAndSwap: async (_guestDbId, _snapshot, patch) => {
      casCalls += 1;
      written = (patch as { set:Written }).set;
      return {
        status:'applied' as const,
        snapshot:{ exists:true, state:{}, updatedAt:'2026-10-20T12:00:01.000Z' },
      };
    },
  }, NOW, 4, options.persistPredicate, options.contextOnlyPredicate);

  return { result, written, casCalls };
}

test('a One-Mind-owned turn still writes BOTH context and task state', async () => {
  const { result, written, casCalls } = await runTurn({ persistPredicate: () => true });
  assert.equal(casCalls, 1);
  assert.ok(written);
  assert.ok('conversationContext' in written!, 'the transcript must be written');
  assert.ok('taskState' in written!, 'the canonical task state must be written');
  assert.equal(result.trace.statePersisted, true);
  assert.equal(result.trace.contextPersisted, true);
});

test('a legacy_required turn writes the transcript but NEVER the task state', async () => {
  const { result, written, casCalls } = await runTurn({
    persistPredicate: () => false,
    contextOnlyPredicate: () => true,
  });
  assert.equal(casCalls, 1, 'the transcript write must actually happen');
  assert.ok(written);
  assert.ok('conversationContext' in written!, 'this is the continuity gap being closed');
  assert.ok(
    !('taskState' in written!),
    'taskState must be absent from the patch so the authoritative owner keeps it',
  );
  assert.equal(result.trace.statePersisted, false, 'task state was not written');
  assert.equal(result.trace.contextPersisted, true, 'the transcript was');
  assert.ok(
    result.conversationContextAfter.recentTurns.some(turn => turn.content === 'ขี่ม้าราคาเท่าไหร่'),
    'the recorded transcript must contain this turn',
  );
});

test('opting out writes nothing at all, exactly as before', async () => {
  const { result, written, casCalls } = await runTurn({
    persistPredicate: () => false,
    contextOnlyPredicate: () => false,
  });
  assert.equal(casCalls, 0, 'no write may be attempted');
  assert.equal(written, null);
  assert.equal(result.trace.statePersisted, false);
  assert.equal(result.trace.contextPersisted, false);
});

test('the default keeps the original all-or-nothing behavior for existing callers', async () => {
  // contextOnlyPredicate omitted entirely.
  const { written, casCalls, result } = await runTurn({ persistPredicate: () => false });
  assert.equal(casCalls, 0, 'a caller that has not opted in must see no new write');
  assert.equal(written, null);
  assert.equal(result.trace.contextPersisted, false);
});

test('the trust gate itself rejects an unusable reading', () => {
  // This is the predicate the transcript write is gated on. Tested directly
  // because semanticSource/confidence cannot be injected end to end: the
  // orchestrator decides which reading WINS and stamps the result itself.
  assert.equal(semanticTurnTrustedForState(semantic()), true);
  assert.equal(
    semanticTurnTrustedForState(semantic({ semanticSource:'provider_unavailable' } as Partial<SemanticTurn>)),
    false,
  );
  assert.equal(semanticTurnTrustedForState(semantic({ confidence:0.4 })), false);
  assert.equal(semanticTurnTrustedForState(semantic({ domain:'unknown' })), false);
  assert.equal(semanticTurnTrustedForState(semantic({ action:'unknown' })), false);
});

test('a provider outage with no usable reading records nothing, even with opt-in', async () => {
  // The only real route to 'provider_unavailable': the interpreter raises an
  // availability error AND no deterministic reading can be derived from the
  // message. (A message the deterministic parser CAN read becomes a trusted
  // deterministic_fallback instead -- see the next test.)
  let casCalls = 0;
  const deps:Partial<OneMindDependencies> = {
    resolveCanonicalGuestId: async () => CANONICAL,
    guestDbIdFromAnonymousId: async () => GUEST_DB,
    interpretSemanticTurn: async () => { throw new LLMAvailabilityError('OpenAI timeout'); },
    buildKnowledgeAdapters: () => ({}),
  };
  const result = await processThongthaiOneMindTurnAuthoritative({
    channel:'line', message:'zzz qqq', eventId:'evt-outage',
    providerUserKey:'line-key', persistState:true,
  }, deps, {
    loadSnapshot: async () => ({ exists:true, state:{}, updatedAt:'2026-10-20T11:59:00.000Z' }),
    compareAndSwap: async () => {
      casCalls += 1;
      return {
        status:'applied' as const,
        snapshot:{ exists:true, state:{}, updatedAt:'2026-10-20T12:00:01.000Z' },
      };
    },
  }, NOW, 4, () => false, () => true);

  assert.equal(
    result.semanticTurn.semanticSource, 'provider_unavailable',
    'this test is only meaningful if the outage path was really taken',
  );
  assert.equal(casCalls, 0, 'a guessed meaning must never be recorded as what the guest said');
  assert.equal(result.trace.contextPersisted, false);
  assert.equal(result.trace.statePersisted, false);
});

test('an outage that still has a deterministic reading DOES keep continuity', async () => {
  // Deliberate and desirable: the meaning came from the real message via the
  // deterministic parser, not from a guess, so remembering the turn is
  // honest. Asserted so the distinction above is not mistaken for a bug.
  let casCalls = 0;
  const deps:Partial<OneMindDependencies> = {
    resolveCanonicalGuestId: async () => CANONICAL,
    guestDbIdFromAnonymousId: async () => GUEST_DB,
    interpretSemanticTurn: async () => { throw new LLMAvailabilityError('OpenAI timeout'); },
    buildKnowledgeAdapters: () => ({}),
  };
  const result = await processThongthaiOneMindTurnAuthoritative({
    channel:'line', message:'ขี่ม้าราคาเท่าไหร่', eventId:'evt-outage-2',
    providerUserKey:'line-key', persistState:true,
  }, deps, {
    loadSnapshot: async () => ({ exists:true, state:{}, updatedAt:'2026-10-20T11:59:00.000Z' }),
    compareAndSwap: async () => {
      casCalls += 1;
      return {
        status:'applied' as const,
        snapshot:{ exists:true, state:{}, updatedAt:'2026-10-20T12:00:01.000Z' },
      };
    },
  }, NOW, 4, () => false, () => true);

  assert.equal(result.semanticTurn.semanticSource, 'deterministic_fallback');
  assert.equal(casCalls, 1);
  assert.equal(result.trace.contextPersisted, true);
  assert.equal(result.trace.statePersisted, false, 'still no task write');
});

test('the activity task mirror is gated on a real task write', () => {
  // mirrorActivityTaskIfLineSourced only acts on a live line-sourced
  // activity_booking task, which a price question never produces, so a
  // behavioral test here would pass vacuously in both directions. Assert the
  // structure instead: the mirror must sit inside the task-write branch, or a
  // transcript-only write would push an unwritten task outward.
  const source = readFileSync(
    new URL('../netlify/functions/_thongthai-one-mind-orchestrator.ts', import.meta.url),
    'utf8',
  );
  const applied = source.indexOf("if (write.status === 'applied') {");
  assert.ok(applied > 0);
  const branch = source.slice(applied, applied + 700);
  assert.match(
    branch,
    /if \(shouldPersist\) \{[\s\S]{0,200}mirrorActivityTaskIfLineSourced\(/u,
    'the mirror must only run when the canonical task state was actually written',
  );
  assert.match(branch, /statePersisted:shouldPersist/u);
  assert.match(branch, /contextPersisted:true/u);
});

// ---------------------------------------------------------------------------
// The three guarantees this change must not weaken
// ---------------------------------------------------------------------------

test('guarantee 1: a state-mutating turn records nothing when its task write did not land', () => {
  const predicate = RESPONSE_SOURCE.slice(
    RESPONSE_SOURCE.indexOf('// Transcript-only fallback.'),
    RESPONSE_SOURCE.indexOf('const eligibility = readOnlyCutoverEligibility'),
  );
  assert.match(
    predicate, /if \(taskStateChanged\(candidate\)\) return false;/u,
    'a cancel/suspend/resume/correction turn must not record a transcript',
  );
  // The legacy_required branch that depends on this is still present.
  assert.match(RESPONSE_SOURCE, /taskStateChanged\(turn\)[\s\S]{0,80}!turn\.trace\.statePersisted/u);
  assert.match(RESPONSE_SOURCE, /reason:'transactional_or_task_turn'/u);
});

test('guarantee 2: a promotion provider-fallback stays response-only', () => {
  const predicate = RESPONSE_SOURCE.slice(
    RESPONSE_SOURCE.indexOf('// Transcript-only fallback.'),
    RESPONSE_SOURCE.indexOf('const eligibility = readOnlyCutoverEligibility'),
  );
  assert.match(predicate, /isTrustedGroundedPromotionProviderFallback\(candidate/u);
  assert.match(predicate, /requireSemanticSupervisor/u);
});

test('guarantee 3: a trusted incident leaves persistence to the chat core', () => {
  const predicate = RESPONSE_SOURCE.slice(
    RESPONSE_SOURCE.indexOf('// Transcript-only fallback.'),
    RESPONSE_SOURCE.indexOf('const eligibility = readOnlyCutoverEligibility'),
  );
  assert.match(predicate, /conversationalMode === 'INCIDENT'/u);
  assert.match(predicate, /openai_supervisor|semantic_concept_memory/u);
  // The incident handoff itself is unchanged.
  assert.match(RESPONSE_SOURCE, /trustedIncidentMeaning/u);
});

// ---------------------------------------------------------------------------
// No double-write with thongthai-chat.ts's own five context writes
// ---------------------------------------------------------------------------

test('a second write for the same event is a no-op, so the manual paths cannot duplicate a turn', () => {
  const first = applyConversationContextUpdate(emptyConversationContextState(NOW), {
    eventId:'evt-1',
    channel:'line',
    userMessage:'ขี่ม้าราคาเท่าไหร่',
    assistantMessage:'300 บาทครับ',
    activeDomain:'activity',
    lastAction:'provide_information',
    semanticTurn:semantic(),
  }, NOW);
  assert.equal(first.recentTurns.filter(turn => turn.content === 'ขี่ม้าราคาเท่าไหร่').length, 1);

  // thongthai-chat.ts re-applies with the SAME transportEventId.
  const second = applyConversationContextUpdate(first, {
    eventId:'evt-1',
    channel:'line',
    userMessage:'ขี่ม้าราคาเท่าไหร่',
    assistantMessage:'300 บาทครับ',
    activeDomain:'activity',
    lastAction:'provide_information',
    semanticTurn:semantic(),
  }, NOW);
  assert.deepEqual(second.recentTurns, first.recentTurns, 'no duplicated turn entries');
  assert.deepEqual(second.recentEventIds, first.recentEventIds);
});

test('the manual context writes all key off the same transport event id', () => {
  const calls = [...CHAT_SOURCE.matchAll(/persistConversationContext\(/gu)];
  assert.ok(calls.length >= 5, `expected the known manual writes, found ${calls.length}`);
  // Every manual update is built from transportEventId, which is the same id
  // One-Mind receives, so the dedupe above applies to all of them.
  const updates = [...CHAT_SOURCE.matchAll(/applyConversationContextUpdate\([\s\S]{0,200}?eventId:(\w+)/gu)]
    .map(match => match[1]);
  assert.ok(updates.length > 0, 'expected context updates in the chat core');
  for (const id of updates) {
    assert.equal(id, 'transportEventId', `context updates must use transportEventId, saw ${id}`);
  }
});

// ---------------------------------------------------------------------------
// Multi-turn continuity: the actual customer-visible point of this change
// ---------------------------------------------------------------------------

test('a follow-up turn sees the transcript recorded by a legacy_required turn', async () => {
  const firstTurn = await runTurn({
    persistPredicate: () => false,
    contextOnlyPredicate: () => true,
  });
  const recorded = firstTurn.result.conversationContextAfter;
  assert.ok(recorded.recentTurns.length > 0);

  // Second turn loads the row the transcript-only write produced.
  let secondSemanticContextTurns = 0;
  const deps:Partial<OneMindDependencies> = {
    resolveCanonicalGuestId: async () => CANONICAL,
    guestDbIdFromAnonymousId: async () => GUEST_DB,
    interpretSemanticTurn: async (_message, context) => {
      secondSemanticContextTurns = context.recentTurns?.length ?? 0;
      return semantic({ intent:'activity_followup' });
    },
    buildKnowledgeAdapters: () => ({}),
  };
  await processThongthaiOneMindTurnAuthoritative({
    channel:'line', message:'แล้วมีรอบกี่โมง', eventId:'evt-2',
    providerUserKey:'line-key', persistState:true,
  }, deps, {
    loadSnapshot: async () => ({
      exists:true,
      state:{ conversationContext:recorded, taskState:emptyTaskStateContainer() },
      updatedAt:'2026-10-20T12:00:02.000Z',
    }),
    compareAndSwap: async () => ({
      status:'applied' as const,
      snapshot:{ exists:true, state:{}, updatedAt:'2026-10-20T12:00:03.000Z' },
    }),
  }, new Date('2026-10-20T12:00:05.000Z'), 4, () => true, () => true);

  assert.ok(
    secondSemanticContextTurns > 0,
    'the follow-up turn must see what the legacy_required turn recorded',
  );
});
