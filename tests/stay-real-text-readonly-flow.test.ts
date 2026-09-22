import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  processThongthaiOneMindTurnAuthoritative,
  type OneMindDependencies,
} from '../netlify/functions/_thongthai-one-mind-orchestrator';
import type { GuestAgentStateSnapshot } from '../netlify/functions/_guest-agent-state-store';
import type { SourceResult } from '../netlify/functions/_knowledge-resolver';

const NOW = new Date('2026-09-22T10:00:00+07:00');
const CANONICAL = '33333333-3333-4333-8333-333333333333';
const GUEST_DB = '44444444-4444-4444-8444-444444444444';

function stayKnowledge(): SourceResult {
  return {
    status: 'ok',
    sourceId: 'service_resources_stay',
    sourceType: 'stay_live',
    fetchedAt: NOW.toISOString(),
    data: [
      { key: 'stay:policy:check_in_latest', value: '14:00', domain: 'stay', sourceId: 'service_resources_stay', sourceType: 'stay_live', authoritative: true, fetchedAt: NOW.toISOString() },
      { key: 'stay:policy:check_out_latest', value: '12:00', domain: 'stay', sourceId: 'service_resources_stay', sourceType: 'stay_live', authoritative: true, fetchedAt: NOW.toISOString() },
      { key: 'stay:policy:room_service_hours', value: '10:00-22:00', domain: 'stay', sourceId: 'service_resources_stay', sourceType: 'stay_live', authoritative: true, fetchedAt: NOW.toISOString() },
      { key: 'stay:room:one_bedroom:available', value: true, domain: 'stay', sourceId: 'service_resources_stay', sourceType: 'stay_live', authoritative: true, fetchedAt: NOW.toISOString() },
    ],
  };
}

test('STAY release gate: real customer text stays read-only and never mutates/proposes a booking without explicit commit', async () => {
  let stateRow: GuestAgentStateSnapshot = { exists: false, state: {}, updatedAt: null };
  const deps: Partial<OneMindDependencies> = {
    resolveCanonicalGuestId: async () => CANONICAL,
    guestDbIdFromAnonymousId: async () => GUEST_DB,
    buildKnowledgeAdapters: () => ({
      stay: {
        catalog: async () => stayKnowledge(),
        availability: async () => stayKnowledge(),
      },
      restaurant: {
        menu: async () => ({ status: 'empty', sourceId: 'restaurant_menu', sourceType: 'restaurant_live', fetchedAt: NOW.toISOString() }),
      },
    }),
    mirrorActivityTaskToLegacySession: async () => {},
  };

  async function turn(eventId: string, message: string, minutesOffset: number) {
    return processThongthaiOneMindTurnAuthoritative({
      channel: 'web',
      message,
      eventId,
      providerUserKey: 'web-stay-key',
      persistState: true,
    }, deps, {
      loadSnapshot: async () => stateRow,
      compareAndSwap: async (_guestDbId, snapshot, patch) => {
        stateRow = {
          exists: true,
          state: { ...snapshot.state, ...(patch.set ?? {}) },
          updatedAt: new Date(NOW.getTime() + minutesOffset * 60_000 + 1).toISOString(),
        };
        return { status: 'applied', snapshot: stateRow };
      },
    }, new Date(NOW.getTime() + minutesOffset * 60_000));
  }

  const messages = [
    ['s1', 'มีห้องไหม'],
    ['s2', 'เช็คอินกี่โมง'],
    ['s3', 'พรุ่งนี้มีไหม'],
    ['s4', 'room service ถึงกี่โมง'],
    ['s5', 'ร้านอาหารมีอะไร'],
    ['s6', 'กลับมาถามห้องพักต่อ'],
    ['s7', 'เช็คเอาท์กี่โมง'],
  ] as const;

  const results = [];
  for (let i = 0; i < messages.length; i += 1) {
    const [eventId, message] = messages[i]!;
    results.push(await turn(eventId, message, i + 1));
  }

  assert.equal(results[0]!.semanticTurn.domain, 'stay');
  assert.equal(results[0]!.semanticTurn.intent, 'stay_read_only_inquiry');
  assert.equal(results[1]!.semanticTurn.domain, 'stay');
  assert.equal(results[2]!.semanticTurn.domain, 'stay');
  assert.equal(results[2]!.semanticTurn.entities.date, '2026-09-23');
  assert.equal(results[3]!.semanticTurn.domain, 'stay');
  assert.equal(results[4]!.semanticTurn.domain, 'restaurant', 'restaurant side-question should switch topic without mutating stay state');
  assert.equal(results[5]!.semanticTurn.domain, 'stay', 'explicit stay follow-up should return to the stay topic');
  assert.equal(results[6]!.semanticTurn.domain, 'stay');

  for (const [index, result] of results.entries()) {
    assert.equal(result.dialogDecision.actionProposal, undefined, `turn ${index + 1} must not propose a transaction`);
    assert.equal(result.taskStateAfter.activeTask, null, `turn ${index + 1} must not create a booking task from read-only stay text`);
    assert.equal(result.taskStateAfter.suspendedTask, null, `turn ${index + 1} must not suspend a non-existent stay task`);
    assert.notEqual(result.dialogDecision.mode, 'propose_action', `turn ${index + 1} must remain read-only`);
  }
});
