import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  processThongthaiOneMindTurn,
  processThongthaiOneMindTurnAuthoritative,
  resolveOneMindIdentity,
  type OneMindDependencies,
} from '../netlify/functions/_thongthai-one-mind-orchestrator';
import {
  applyConversationContextUpdate,
  emptyConversationContextState,
  type ConversationContextState,
} from '../netlify/functions/_conversation-context';
import {
  emptyTaskStateContainer,
  type TaskStateContainer,
} from '../netlify/functions/_task-state';
import type { SemanticTurn } from '../netlify/functions/_semantic-interpreter';

const NOW = new Date('2026-09-18T12:00:00.000Z');
const CANONICAL = '11111111-1111-4111-8111-111111111111';
const GUEST_DB = '22222222-2222-4222-8222-222222222222';

function semantic(overrides: Partial<SemanticTurn> = {}): SemanticTurn {
  return {
    domain: 'activity',
    intent: 'activity_booking',
    action: 'confirm',
    entities: { resourceCode: 'activity-horse', horseName: 'ภาราดร' },
    references: [],
    constraints: [],
    confidence: 0.95,
    needsClarification: false,
    ...overrides,
  };
}

test('resolveOneMindIdentity maps channel-local key to canonical guest identity', async () => {
  const identity = await resolveOneMindIdentity({
    channel: 'line',
    message: 'hi',
    eventId: 'evt-1',
    providerUserKey: 'line-hashed-key',
  }, {
    resolveCanonicalGuestId: async () => CANONICAL,
    guestDbIdFromAnonymousId: async anonymousId => anonymousId === CANONICAL ? GUEST_DB : null,
  });
  assert.equal(identity.canonicalAnonymousId, CANONICAL);
  assert.equal(identity.guestDbId, GUEST_DB);
  assert.equal(identity.linked, true);
});

test('G.1 defaults to shadow state: no persistence and no transaction execution', async () => {
  let persistedConversation = 0;
  let persistedTask = 0;
  const deps: Partial<OneMindDependencies> = {
    resolveCanonicalGuestId: async () => CANONICAL,
    guestDbIdFromAnonymousId: async () => GUEST_DB,
    loadConversationContext: async () => emptyConversationContextState(NOW),
    persistConversationContext: async () => { persistedConversation += 1; },
    loadTaskState: async () => emptyTaskStateContainer(),
    persistTaskState: async () => { persistedTask += 1; },
    interpretSemanticTurn: async () => semantic(),
    buildKnowledgeAdapters: () => ({}),
  };

  const result = await processThongthaiOneMindTurn({
    channel: 'line',
    message: 'เอาภาราดร',
    eventId: 'line-event-1',
    providerUserKey: 'line-hashed-key',
  }, deps, NOW);

  assert.equal(result.dialogDecision.taskStateContainer.activeTask?.slots.horseName, 'ภาราดร');
  assert.equal(result.trace.statePersisted, false);
  assert.equal(persistedConversation, 0);
  assert.equal(persistedTask, 0);
  assert.equal(result.dialogDecision.actionProposal, undefined, 'selection must never execute a booking');
});

test('server continuity survives web -> LINE with no client chat history field at all', async () => {
  const conversation = new Map<string, ConversationContextState>();
  const tasks = new Map<string, TaskStateContainer>();
  let currentMessage = '';

  const deps: Partial<OneMindDependencies> = {
    resolveCanonicalGuestId: async (_channel, providerKey) => providerKey === 'web-key' || providerKey === 'line-key' ? CANONICAL : providerKey,
    guestDbIdFromAnonymousId: async () => GUEST_DB,
    loadConversationContext: async guestDbId => conversation.get(guestDbId ?? '') ?? emptyConversationContextState(NOW),
    persistConversationContext: async (guestDbId, state) => { if (guestDbId) conversation.set(guestDbId, state); },
    loadTaskState: async guestDbId => tasks.get(guestDbId ?? '') ?? emptyTaskStateContainer(),
    persistTaskState: async (guestDbId, state) => { if (guestDbId) tasks.set(guestDbId, state); },
    interpretSemanticTurn: async (_message, context) => {
      if (currentMessage === 'เอาภาราดร') {
        return semantic();
      }
      assert.equal(context.activeDomain, 'activity', 'LINE turn must receive server-loaded activity context');
      return semantic({
        action: 'provide_information',
        entities: { date: '2026-09-19', partySize: 2 },
      });
    },
    buildKnowledgeAdapters: () => ({}),
  };

  currentMessage = 'เอาภาราดร';
  const first = await processThongthaiOneMindTurn({
    channel: 'web',
    message: currentMessage,
    eventId: 'web-event-1',
    providerUserKey: 'web-key',
    persistState: true,
  }, deps, NOW);

  const taskId = first.taskStateAfter.activeTask?.taskId;
  assert.ok(taskId);

  currentMessage = 'พรุ่งนี้สองคน';
  const second = await processThongthaiOneMindTurn({
    channel: 'line',
    message: currentMessage,
    eventId: 'line-event-2',
    providerUserKey: 'line-key',
    persistState: true,
  }, deps, new Date(NOW.getTime() + 1000));

  assert.equal(second.taskStateAfter.activeTask?.taskId, taskId);
  assert.equal(second.taskStateAfter.activeTask?.slots.horseName, 'ภาราดร');
  assert.equal(second.taskStateAfter.activeTask?.slots.partySize, 2);
  assert.equal(second.conversationContextAfter.recentTurns.some(turn => turn.channel === 'web'), true);
  assert.equal(second.conversationContextAfter.recentTurns.some(turn => turn.channel === 'line'), true);
});

test('unlinked provider identities do not share server continuity', async () => {
  const conversation = new Map<string, ConversationContextState>();
  const tasks = new Map<string, TaskStateContainer>();
  const providerToCanonical: Record<string, string> = {
    'web-a': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'line-b': 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  };
  const canonicalToDb: Record<string, string> = {
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa': 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb': 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb',
  };
  const deps: Partial<OneMindDependencies> = {
    resolveCanonicalGuestId: async (_channel, key) => key ? providerToCanonical[key] : undefined,
    guestDbIdFromAnonymousId: async id => id ? canonicalToDb[id] ?? null : null,
    loadConversationContext: async id => conversation.get(id ?? '') ?? emptyConversationContextState(NOW),
    persistConversationContext: async (id, state) => { if (id) conversation.set(id, state); },
    loadTaskState: async id => tasks.get(id ?? '') ?? emptyTaskStateContainer(),
    persistTaskState: async (id, state) => { if (id) tasks.set(id, state); },
    interpretSemanticTurn: async () => semantic(),
    buildKnowledgeAdapters: () => ({}),
  };

  await processThongthaiOneMindTurn({
    channel: 'web', message: 'เอาภาราดร', eventId: 'a1', providerUserKey: 'web-a', persistState: true,
  }, deps, NOW);

  const unrelated = await processThongthaiOneMindTurn({
    channel: 'line', message: 'พรุ่งนี้สองคน', eventId: 'b1', providerUserKey: 'line-b',
  }, deps, NOW);

  assert.equal(unrelated.conversationContextBefore.recentTurns.length, 0);
  assert.equal(unrelated.taskStateBefore.activeTask, null);
});

test('duplicate event id is idempotent for bounded conversation/task state', async () => {
  let conversation = emptyConversationContextState(NOW);
  let taskState = emptyTaskStateContainer();
  const deps: Partial<OneMindDependencies> = {
    resolveCanonicalGuestId: async () => CANONICAL,
    guestDbIdFromAnonymousId: async () => GUEST_DB,
    loadConversationContext: async () => conversation,
    persistConversationContext: async (_id, state) => { conversation = state; },
    loadTaskState: async () => taskState,
    persistTaskState: async (_id, state) => { taskState = state; },
    interpretSemanticTurn: async () => semantic(),
    buildKnowledgeAdapters: () => ({}),
  };

  const input = {
    channel: 'line' as const,
    message: 'เอาภาราดร',
    eventId: 'dup-1',
    providerUserKey: 'line-key',
    persistState: true,
  };
  await processThongthaiOneMindTurn(input, deps, NOW);
  const afterFirstConversation = JSON.stringify(conversation);
  const afterFirstTask = JSON.stringify(taskState);
  await processThongthaiOneMindTurn(input, deps, NOW);

  assert.equal(JSON.stringify(conversation), afterFirstConversation);
  assert.equal(JSON.stringify(taskState), afterFirstTask);
});


test('authoritative G.2 path retries the WHOLE turn on CAS conflict and preserves the concurrent message', async () => {
  let interpreterCalls = 0;
  let loadCalls = 0;
  let casCalls = 0;

  const concurrentContext = applyConversationContextUpdate(
    emptyConversationContextState(NOW),
    {
      eventId:'web-concurrent',
      channel:'web',
      userMessage:'อยากขี่ม้า',
      activeDomain:'activity',
      activeTopic:'horse_riding',
      lastAction:'ask',
    },
    NOW,
  );

  const deps: Partial<OneMindDependencies> = {
    resolveCanonicalGuestId: async () => CANONICAL,
    guestDbIdFromAnonymousId: async () => GUEST_DB,
    // These legacy loaders are intentionally irrelevant to the authoritative
    // path; if it accidentally falls back to them this test should fail.
    loadConversationContext: async () => { throw new Error('legacy_context_loader_used'); },
    persistConversationContext: async () => { throw new Error('legacy_context_persist_used'); },
    loadTaskState: async () => { throw new Error('legacy_task_loader_used'); },
    persistTaskState: async () => { throw new Error('legacy_task_persist_used'); },
    interpretSemanticTurn: async (_message, context) => {
      interpreterCalls += 1;
      if (interpreterCalls === 1) assert.equal(context.activeDomain, null);
      if (interpreterCalls === 2) assert.equal(context.activeDomain, 'activity');
      return semantic({
        action:'provide_information',
        entities:{ date:'2026-09-19', partySize:2 },
      });
    },
    buildKnowledgeAdapters: () => ({}),
  };

  const result = await processThongthaiOneMindTurnAuthoritative({
    channel:'line',
    message:'พรุ่งนี้สองคน',
    eventId:'line-current',
    providerUserKey:'line-key',
    persistState:true,
  }, deps, {
    loadSnapshot: async () => {
      loadCalls += 1;
      return loadCalls === 1
        ? { exists:true, state:{}, updatedAt:'2026-09-18T11:59:00.000Z' }
        : {
            exists:true,
            state:{
              conversationContext:concurrentContext,
              taskState:emptyTaskStateContainer(),
            },
            updatedAt:'2026-09-18T12:00:00.500Z',
          };
    },
    compareAndSwap: async () => {
      casCalls += 1;
      return casCalls === 1
        ? { status:'conflict' as const }
        : {
            status:'applied' as const,
            snapshot:{ exists:true, state:{}, updatedAt:'2026-09-18T12:00:01.000Z' },
          };
    },
  }, NOW);

  assert.equal(interpreterCalls, 2, 'semantic interpretation must rerun against the newer canonical context');
  assert.equal(loadCalls, 2);
  assert.equal(casCalls, 2);
  assert.equal(result.trace.statePersisted, true);
  assert.equal(result.trace.stateConflictRetries, 1);
  assert.equal(result.conversationContextAfter.recentTurns.some(turn => turn.content === 'อยากขี่ม้า'), true);
  assert.equal(result.conversationContextAfter.recentTurns.some(turn => turn.content === 'พรุ่งนี้สองคน'), true);
});

test('authoritative G.2 path gives up rather than stale-overwriting after bounded CAS conflicts', async () => {
  const deps: Partial<OneMindDependencies> = {
    resolveCanonicalGuestId: async () => CANONICAL,
    guestDbIdFromAnonymousId: async () => GUEST_DB,
    interpretSemanticTurn: async () => semantic(),
    buildKnowledgeAdapters: () => ({}),
  };

  await assert.rejects(() => processThongthaiOneMindTurnAuthoritative({
    channel:'line',
    message:'เอาภาราดร',
    eventId:'conflict-loop',
    providerUserKey:'line-key',
    persistState:true,
  }, deps, {
    loadSnapshot: async () => ({ exists:true, state:{}, updatedAt:'2026-09-18T12:00:00.000Z' }),
    compareAndSwap: async () => ({ status:'conflict' as const }),
  }, NOW, 2), /one_mind_state_conflict_exhausted/);
});
