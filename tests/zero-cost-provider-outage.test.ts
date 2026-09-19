// Phase P — zero-cost architecture acceptance.
//
// Proves CUSTOMER BEHAVIOR (not merely retry mechanics) stays correct across
// a full multi-turn conversation with the model provider FORCED unavailable
// for the ENTIRE conversation (interpretSemanticTurn always throws
// LLMAvailabilityError, exactly as the circuit breaker/a sustained 429 would
// produce). Network-free: state, semantic turns and knowledge are all
// injected/in-memory, matching this repo's established test convention (see
// tests/phase-m-e2e.test.ts). No production transaction is ever created --
// the flow never reaches propose_action's transactional boundary here, and
// even if it did, One-Mind never executes a tool itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  processThongthaiOneMindTurnAuthoritative,
  type AuthoritativeStateDependencies,
  type OneMindDependencies,
} from '../netlify/functions/_thongthai-one-mind-orchestrator';
import { processOneMindCustomerTurn, readOnlyCutoverEligibility } from '../netlify/functions/_thongthai-one-mind-response';
import { applyGuestAgentStatePatch, type GuestAgentStateSnapshot } from '../netlify/functions/_guest-agent-state-store';
import { LLMAvailabilityError } from '../netlify/functions/_thongthai-model-provider';
import type { GroundedFact, KnowledgeSourceAdapters, SourceResult } from '../netlify/functions/_knowledge-resolver';

const NOW = new Date('2026-09-19T05:00:00.000Z'); // Bangkok 2026-09-19 12:00
const CANON = '33333333-3333-4333-8333-333333333333';
const GUEST = '44444444-4444-4444-8444-444444444444';

function fact(key: string, value: unknown, domain: GroundedFact['domain'], sourceId: string, sourceType: GroundedFact['sourceType']): GroundedFact {
  return { key, value, domain, sourceId, sourceType, authoritative: true, fetchedAt: NOW.toISOString() };
}
function ok(sourceId: string, sourceType: GroundedFact['sourceType'], data: GroundedFact[]): SourceResult {
  return { status: 'ok', sourceId, sourceType, fetchedAt: NOW.toISOString(), data };
}

function memoryState() {
  let snapshot: GuestAgentStateSnapshot = { exists: true, state: {}, updatedAt: '2026-09-19T04:59:00.000Z' };
  let rev = 0;
  const deps: AuthoritativeStateDependencies = {
    loadSnapshot: async () => structuredClone(snapshot),
    compareAndSwap: async (_guest, expected, patch) => {
      if (expected.updatedAt !== snapshot.updatedAt) return { status: 'conflict' };
      rev += 1;
      snapshot = { exists: true, state: applyGuestAgentStatePatch(snapshot.state, patch), updatedAt: new Date(NOW.getTime() + rev).toISOString() };
      return { status: 'applied', snapshot: structuredClone(snapshot) };
    },
  };
  return deps;
}

const GENERIC_APOLOGY = /ตอบเรื่องนี้ให้แม่นไม่ได้|คิดช้ากว่าปกติ/;

test('canonical activity flow retains context/selection/slots with ZERO LLM calls across the entire forced-outage conversation', async () => {
  const state = memoryState();
  let modelCallCount = 0;
  const forcedUnavailable: Partial<OneMindDependencies> = {
    resolveCanonicalGuestId: async () => CANON,
    guestDbIdFromAnonymousId: async () => GUEST,
    interpretSemanticTurn: async () => {
      modelCallCount += 1;
      throw new LLMAvailabilityError('forced unavailable for test', []);
    },
    buildKnowledgeAdapters: (): KnowledgeSourceAdapters => ({
      activity: {
        catalog: async () => ok('activity_catalog', 'activity_live', [
          fact('activity_asset:horse-01:name', 'ภาราดร', 'activity', 'activity_catalog', 'activity_live'),
          fact('activity_asset:horse-02:name', 'สายฟ้า', 'activity', 'activity_catalog', 'activity_live'),
        ]),
      },
    }),
  };

  // Turn 1: "ม้าล่ะ" -- narrows to the activity domain, shows real catalog
  // names (zero LLM calls: the deterministic deriver recognizes the known
  // ecosystem activity, and the composer renders the grounded catalog facts
  // directly instead of asking the model to phrase them).
  const t1 = await processOneMindCustomerTurn({
    channel: 'line', language: 'th', message: 'ม้าล่ะ', eventId: 'canon-1',
    providerUserKey: 'line-canon', persistState: true, environment: 'test',
  }, forcedUnavailable, state, NOW);
  assert.equal(t1.status, 'composed');
  if (t1.status !== 'composed') return;
  assert.doesNotMatch(t1.response.message, GENERIC_APOLOGY);
  assert.match(t1.response.message, /ภาราดร/, 'discovery must show the real catalog name, not a guess');

  // Turn 2: "เอาภาราดร" -- selects the horse shown in turn 1. Must resolve
  // deterministically against recentEntities populated from turn 1's
  // grounded facts, creating an activity_booking task with that selection
  // already retained as resourceCode + selectedEntities.
  const t2 = await processThongthaiOneMindTurnAuthoritative({
    channel: 'line', message: 'เอาภาราดร', eventId: 'canon-2',
    providerUserKey: 'line-canon', persistState: true, environment: 'test',
  }, forcedUnavailable, state, new Date(NOW.getTime() + 1000));
  assert.ok(t2.taskStateAfter.activeTask, 'a task must exist after an explicit selection');
  assert.equal(t2.taskStateAfter.activeTask?.slots.resourceCode, 'activity_asset:horse-01');
  assert.equal(t2.taskStateAfter.activeTask?.selectedEntities[0]?.name, 'ภาราดร');
  assert.equal(t2.dialogDecision.mode, 'collect_field');
  const eligibility2 = readOnlyCutoverEligibility(t2);
  assert.equal(eligibility2.eligible, true, 'a collect_field task-continuation turn must not be forced onto legacy');

  // Turn 3: "พรุ่งนี้สองคน" -- date + party size, filled onto the SAME task.
  const t3 = await processThongthaiOneMindTurnAuthoritative({
    channel: 'line', message: 'พรุ่งนี้สองคน', eventId: 'canon-3',
    providerUserKey: 'line-canon', persistState: true, environment: 'test',
  }, forcedUnavailable, state, new Date(NOW.getTime() + 2000));
  assert.equal(t3.taskStateAfter.activeTask?.slots.date, '2026-09-20');
  assert.equal(t3.taskStateAfter.activeTask?.slots.partySize, 2);
  // The selection from turn 2 must still be there -- a later slot fill must
  // never silently drop an earlier one.
  assert.equal(t3.taskStateAfter.activeTask?.slots.resourceCode, 'activity_asset:horse-01');

  // Turn 4: "บ่ายสามได้ปะ" -- time, filled onto the SAME task; every prior
  // slot (selection, date, partySize) must still be retained.
  const t4 = await processThongthaiOneMindTurnAuthoritative({
    channel: 'line', message: 'บ่ายสามได้ปะ', eventId: 'canon-4',
    providerUserKey: 'line-canon', persistState: true, environment: 'test',
  }, forcedUnavailable, state, new Date(NOW.getTime() + 3000));
  const finalSlots = t4.taskStateAfter.activeTask?.slots;
  assert.equal(finalSlots?.resourceCode, 'activity_asset:horse-01', 'selected horse must survive to the final turn');
  assert.equal(finalSlots?.date, '2026-09-20', 'date must survive to the final turn');
  assert.equal(finalSlots?.partySize, 2, 'party size must survive to the final turn');
  assert.equal(finalSlots?.time, '15:00', 'requested time must be retained');
  // No real (or fake) transaction was ever proposed/executed this turn.
  assert.equal(t4.dialogDecision.actionProposal, undefined);
  assert.notEqual(t4.taskStateAfter.activeTask?.status, 'executing');

  const t4Composed = await processOneMindCustomerTurn({
    channel: 'line', language: 'th', message: 'บ่ายสามได้ปะ', eventId: 'canon-4-compose',
    providerUserKey: 'line-canon', persistState: false, environment: 'test',
  }, forcedUnavailable, state, new Date(NOW.getTime() + 3000));
  assert.equal(t4Composed.status, 'composed');
  if (t4Composed.status === 'composed') {
    assert.doesNotMatch(t4Composed.response.message, GENERIC_APOLOGY);
  }

  // The deterministic deriver covered every turn in this script -- the real
  // (forced-throwing) model was never actually reached.
  assert.equal(modelCallCount, 0, 'the canonical flow must cost zero LLM calls end-to-end');
});

test('stay booking date continuation degrades deterministically too (pipeline is domain-generic, not activity-only)', async () => {
  const state = memoryState();
  const deps: Partial<OneMindDependencies> = {
    resolveCanonicalGuestId: async () => CANON,
    guestDbIdFromAnonymousId: async () => GUEST,
    interpretSemanticTurn: async () => { throw new LLMAvailabilityError('forced unavailable', []); },
    buildKnowledgeAdapters: (): KnowledgeSourceAdapters => ({
      stay: { catalog: async () => ok('stay_catalog', 'stay_live', [
        fact('stay:house-1:name', 'ทำมา-ชาติ เฮือนสเตย์', 'stay', 'stay_catalog', 'stay_live'),
      ]) },
    }),
  };
  const t1 = await processThongthaiOneMindTurnAuthoritative({
    channel: 'web', message: 'เอาทำมา-ชาติ เฮือนสเตย์', eventId: 'stay-1',
    providerUserKey: 'web-stay', persistState: true, environment: 'test',
  }, deps, state, NOW);
  // No task yet (nothing selected this entity from prior context) -- this
  // proves the deterministic deriver honestly returns null / defers rather
  // than fabricate a match when there is nothing in recentEntities yet.
  assert.equal(t1.taskStateAfter.activeTask, null);

  // A real entity now in context (as if shown this same conversation):
  const stateWithEntity = memoryState();
  const seedTurn = await processThongthaiOneMindTurnAuthoritative({
    channel: 'web', message: 'มีที่พักไหม', eventId: 'stay-seed',
    providerUserKey: 'web-stay-2', persistState: true, environment: 'test',
  }, { ...deps, interpretSemanticTurn: async () => ({
    domain: 'stay', intent: 'discover_stay', action: 'discover', entities: {}, references: [], constraints: [], confidence: .9, needsClarification: false,
  }) }, stateWithEntity, NOW);
  assert.ok(seedTurn.conversationContextAfter.recentEntities.some(e => e.name === 'ทำมา-ชาติ เฮือนสเตย์'));

  const select = await processThongthaiOneMindTurnAuthoritative({
    channel: 'web', message: 'เอาทำมา-ชาติ เฮือนสเตย์', eventId: 'stay-select',
    providerUserKey: 'web-stay-2', persistState: true, environment: 'test',
  }, deps, stateWithEntity, new Date(NOW.getTime() + 1000));
  assert.ok(select.taskStateAfter.activeTask);
  assert.equal(select.taskStateAfter.activeTask?.slots.resourceCode, 'stay:house-1');

  const dated = await processThongthaiOneMindTurnAuthoritative({
    channel: 'web', message: 'พรุ่งนี้', eventId: 'stay-date',
    providerUserKey: 'web-stay-2', persistState: true, environment: 'test',
  }, deps, stateWithEntity, new Date(NOW.getTime() + 2000));
  assert.equal(dated.taskStateAfter.activeTask?.slots.date, '2026-09-20');
  assert.equal(dated.dialogDecision.actionProposal, undefined, 'no fake booking');
});

test('a genuinely ambiguous zero-LLM turn asks ONE clarifying question instead of guessing or apologizing generically', async () => {
  const state = memoryState();
  const deps: Partial<OneMindDependencies> = {
    resolveCanonicalGuestId: async () => CANON,
    guestDbIdFromAnonymousId: async () => GUEST,
    interpretSemanticTurn: async () => { throw new LLMAvailabilityError('forced unavailable', []); },
    buildKnowledgeAdapters: (): KnowledgeSourceAdapters => ({}),
  };
  // No active task, no recent entities, and text that matches none of the
  // deterministic patterns -- genuinely ambiguous with the model down.
  const result = await processOneMindCustomerTurn({
    channel: 'web', language: 'th', message: 'เอาอันนั้นแหละ', eventId: 'ambiguous-1',
    providerUserKey: 'web-ambiguous', persistState: true, environment: 'test',
  }, deps, state, NOW);
  if (result.status === 'composed') {
    assert.doesNotMatch(result.response.message, GENERIC_APOLOGY);
    assert.match(result.response.message, /ขอรายละเอียดเพิ่ม|รายละเอียด/);
  } else {
    // Falling to legacy (e.g. domain not cut over) is also an acceptable
    // outcome here -- the key invariant is that One-Mind itself never threw.
    assert.equal(result.turn.semanticTurn.needsClarification, true);
  }
});
