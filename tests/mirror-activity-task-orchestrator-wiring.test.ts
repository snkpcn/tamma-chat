// Regression coverage for the ORCHESTRATOR-level wiring of PRIORITY 2's
// one-directional write-through (see mirror-activity-task-to-legacy-
// session.test.ts for the function's own guardrail behavior, and
// THONGTHAI_HANDOFF.md for the full design). This proves the GATING logic
// in processThongthaiOneMindTurnAuthoritative itself: the mirror must fire
// only for LINE-sourced activity_booking tasks after a successful state
// write, and must NEVER fire for web (channels must not each own separate
// operational side effects), a different task type, or a conflict retry
// that never actually applied.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  processThongthaiOneMindTurnAuthoritative,
  type OneMindDependencies,
} from '../netlify/functions/_thongthai-one-mind-orchestrator';
import { emptyConversationContextState } from '../netlify/functions/_conversation-context';
import { emptyTaskStateContainer } from '../netlify/functions/_task-state';
import type { SemanticTurn } from '../netlify/functions/_semantic-interpreter';

const NOW = new Date('2026-09-22T12:00:00.000Z');
const CANONICAL = '11111111-1111-4111-8111-111111111111';
const GUEST_DB = '22222222-2222-4222-8222-222222222222';

function activityBookingSemanticTurn(overrides: Partial<SemanticTurn> = {}): SemanticTurn {
  return {
    domain: 'activity',
    intent: 'activity_booking',
    action: 'confirm',
    entities: { resourceCode: 'activity-horse', horseName: 'ภาราดร', durationMinutes: 30, date: '2026-10-03', time: '13:00', partySize: 2 },
    references: [], constraints: [], confidence: 0.95, needsClarification: false,
    ...overrides,
  };
}

function baseDeps(semantic: SemanticTurn, mirrorCalls: Array<Parameters<OneMindDependencies['mirrorActivityTaskToLegacySession']>[0]>): Partial<OneMindDependencies> {
  return {
    resolveCanonicalGuestId: async () => CANONICAL,
    guestDbIdFromAnonymousId: async () => GUEST_DB,
    loadConversationContext: async () => emptyConversationContextState(NOW),
    persistConversationContext: async () => {},
    loadTaskState: async () => emptyTaskStateContainer(),
    persistTaskState: async () => {},
    interpretSemanticTurn: async () => semantic,
    buildKnowledgeAdapters: () => ({}),
    mirrorActivityTaskToLegacySession: async input => { mirrorCalls.push(input); },
  };
}

test('LINE + activity_booking + successful state write -> mirror is called with the task\'s slots', async () => {
  const mirrorCalls: Array<Parameters<OneMindDependencies['mirrorActivityTaskToLegacySession']>[0]> = [];
  const deps = baseDeps(activityBookingSemanticTurn(), mirrorCalls);

  const result = await processThongthaiOneMindTurnAuthoritative({
    channel: 'line',
    message: 'zzz-mocked-turn-placeholder-not-a-real-thai-sentence',
    eventId: 'line-mirror-1',
    providerUserKey: 'line-key',
    persistState: true,
  }, deps, {
    loadSnapshot: async () => ({ exists: true, state: {}, updatedAt: '2026-09-22T11:59:00.000Z' }),
    compareAndSwap: async () => ({
      status: 'applied' as const,
      snapshot: { exists: true, state: {}, updatedAt: '2026-09-22T12:00:00.000Z' },
    }),
  }, NOW);

  assert.equal(result.trace.statePersisted, true);
  assert.equal(mirrorCalls.length, 1, 'mirror must fire exactly once after a successful write');
  assert.equal(mirrorCalls[0]!.guestDbId, GUEST_DB);
  assert.equal(mirrorCalls[0]!.resourceCode, 'activity-horse');
  assert.equal(mirrorCalls[0]!.durationMinutes, 30);
  assert.equal(mirrorCalls[0]!.date, '2026-10-03');
  assert.equal(mirrorCalls[0]!.time, '13:00');
  assert.equal(mirrorCalls[0]!.partySize, 2);
  assert.deepEqual(mirrorCalls[0]!.asset, { name: 'ภาราดร', assetCode: 'horse-pharadon' });
});

test('web channel never triggers the legacy-session mirror, even for the identical activity_booking task', async () => {
  const mirrorCalls: Array<unknown> = [];
  const deps = baseDeps(activityBookingSemanticTurn(), mirrorCalls as never);

  const result = await processThongthaiOneMindTurnAuthoritative({
    channel: 'web',
    message: 'zzz-mocked-turn-placeholder-not-a-real-thai-sentence',
    eventId: 'web-mirror-1',
    providerUserKey: 'web-key',
    persistState: true,
  }, deps, {
    loadSnapshot: async () => ({ exists: true, state: {}, updatedAt: '2026-09-22T11:59:00.000Z' }),
    compareAndSwap: async () => ({
      status: 'applied' as const,
      snapshot: { exists: true, state: {}, updatedAt: '2026-09-22T12:00:00.000Z' },
    }),
  }, NOW);

  assert.equal(result.trace.statePersisted, true);
  assert.equal(mirrorCalls.length, 0, 'web must never own the LINE-only legacy execution adapter as a side effect');
});

test('a different task type (restaurant_preorder) never triggers the activity mirror', async () => {
  const mirrorCalls: Array<unknown> = [];
  const restaurantTurn: SemanticTurn = {
    domain: 'restaurant', intent: 'restaurant_preorder', action: 'confirm',
    entities: { date: '2026-10-03', time: '18:00', customerName: 'สมชาย', phone: '0812345678' },
    references: [], constraints: [], confidence: 0.9, needsClarification: false,
  };
  const deps = baseDeps(restaurantTurn, mirrorCalls as never);

  const result = await processThongthaiOneMindTurnAuthoritative({
    channel: 'line',
    message: 'zzz-mocked-turn-placeholder-not-a-real-thai-sentence',
    eventId: 'line-mirror-restaurant-1',
    providerUserKey: 'line-key',
    persistState: true,
  }, deps, {
    loadSnapshot: async () => ({ exists: true, state: {}, updatedAt: '2026-09-22T11:59:00.000Z' }),
    compareAndSwap: async () => ({
      status: 'applied' as const,
      snapshot: { exists: true, state: {}, updatedAt: '2026-09-22T12:00:00.000Z' },
    }),
  }, NOW);

  assert.equal(result.trace.statePersisted, true);
  assert.equal(mirrorCalls.length, 0, 'the activity-only legacy mirror must never fire for an unrelated task type');
});

test('a CAS conflict on the first attempt (never applied) does not trigger the mirror; only the eventual successful attempt does', async () => {
  const mirrorCalls: Array<unknown> = [];
  const deps = baseDeps(activityBookingSemanticTurn(), mirrorCalls as never);
  let casCalls = 0;

  const result = await processThongthaiOneMindTurnAuthoritative({
    channel: 'line',
    message: 'zzz-mocked-turn-placeholder-not-a-real-thai-sentence',
    eventId: 'line-mirror-conflict-1',
    providerUserKey: 'line-key',
    persistState: true,
  }, deps, {
    loadSnapshot: async () => ({ exists: true, state: {}, updatedAt: '2026-09-22T11:59:00.000Z' }),
    compareAndSwap: async () => {
      casCalls += 1;
      return casCalls === 1
        ? { status: 'conflict' as const }
        : { status: 'applied' as const, snapshot: { exists: true, state: {}, updatedAt: '2026-09-22T12:00:01.000Z' } };
    },
  }, NOW);

  assert.equal(result.trace.stateConflictRetries, 1);
  assert.equal(mirrorCalls.length, 1, 'exactly one mirror call, only after the write that actually applied');
});
