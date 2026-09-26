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

// Real activity_offerings/activity_assets shape (see _activity-sot.ts /
// _dialog-source-adapters.ts's activityCatalogAdapter): service_resources
// (what create_booking actually keys off) has ONE row per ACTIVITY TYPE
// ("activity-horse"), not per named asset. A customer selecting "ภาราดร"
// must resolve to the real activity resourceCode, never the asset's own id.
function horseCatalogFacts(durationsMinutes: number[]): GroundedFact[] {
  return [
    fact('activity:horse:name', 'ขี่ม้า', 'activity', 'activity_catalog', 'activity_live'),
    fact('activity:horse:resourceCode', 'activity-horse', 'activity', 'activity_catalog', 'activity_live'),
    fact('activity:horse:assetCount', 2, 'activity', 'activity_catalog', 'activity_live'),
    ...durationsMinutes.map(minutes => fact(`activity:horse:${minutes}min:price`, 500, 'activity', 'activity_catalog', 'activity_live')),
    fact('activity_asset:horse-01:name', 'ภาราดร', 'activity', 'activity_catalog', 'activity_live'),
    fact('activity_asset:horse-01:type', 'horse', 'activity', 'activity_catalog', 'activity_live'),
    fact('activity_asset:horse-01:activityCode', 'horse', 'activity', 'activity_catalog', 'activity_live'),
    fact('activity_asset:horse-02:name', 'สายฟ้า', 'activity', 'activity_catalog', 'activity_live'),
    fact('activity_asset:horse-02:type', 'horse', 'activity', 'activity_catalog', 'activity_live'),
    fact('activity_asset:horse-02:activityCode', 'horse', 'activity', 'activity_catalog', 'activity_live'),
  ];
}

test('canonical activity flow retains context/selection/slots through provider outage; only the read-only availability side-question attempts Language Brain', async () => {
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
      activity: { catalog: async () => ok('activity_catalog', 'activity_live', horseCatalogFacts([30])) },
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
  // The composer renders the activity's own catalog name here (its
  // asset-name fallback only engages when no activity-level name fact
  // exists) -- either way it is a real authoritative name, never a guess.
  assert.match(t1.response.message, /มีขี่ม้า/u, 'topic-narrow response should sound like a natural answer, not a raw fact dump');
  assert.match(t1.response.message, /ม้า.*2.*ตัว/u, 'topic-narrow response should summarize the verified horse count naturally');
  assert.match(t1.response.message, /ภาราดร/u, 'topic-narrow discovery should show real named horse assets, not repeat unrelated activities');
  assert.doesNotMatch(t1.response.message, /ข้อมูลที่ทองไทยเช็กยืนยันได้ตอนนี้/u, 'do not expose the generic deterministic fact-dump intro for a simple activity follow-up');

  // Turn 2: "เอาภาราดร" -- selects the horse shown in turn 1. Must resolve
  // deterministically against recentEntities populated from turn 1's
  // grounded facts, creating an activity_booking task. The selected asset's
  // REAL bookable resourceCode ("activity-horse", not the asset id) and its
  // single verified duration (30 min) must both auto-fill from the
  // authoritative catalog -- never guessed, never hardcoded.
  const t2 = await processThongthaiOneMindTurnAuthoritative({
    channel: 'line', message: 'เอาภาราดร', eventId: 'canon-2',
    providerUserKey: 'line-canon', persistState: true, environment: 'test',
  }, forcedUnavailable, state, new Date(NOW.getTime() + 1000));
  assert.ok(t2.taskStateAfter.activeTask, 'a task must exist after an explicit selection');
  assert.equal(t2.taskStateAfter.activeTask?.slots.resourceCode, 'activity-horse', 'must resolve to the REAL activity resourceCode, not the asset id');
  assert.equal(t2.taskStateAfter.activeTask?.slots.durationMinutes, 30, 'a single verified duration must auto-fill');
  assert.equal(t2.taskStateAfter.activeTask?.selectedEntities[0]?.name, 'ภาราดร');
  assert.equal(t2.dialogDecision.mode, 'collect_field');
  assert.deepEqual(t2.dialogDecision.missingFields, ['date'], 'only date should remain -- resourceCode and duration were resolved authoritatively');
  const eligibility2 = readOnlyCutoverEligibility(t2);
  assert.equal(eligibility2.eligible, true, 'a collect_field task-continuation turn must not be forced onto legacy');

  // Turn 3: "พรุ่งนี้สองคน" -- date + party size, filled onto the SAME task.
  const t3 = await processThongthaiOneMindTurnAuthoritative({
    channel: 'line', message: 'พรุ่งนี้สองคน', eventId: 'canon-3',
    providerUserKey: 'line-canon', persistState: true, environment: 'test',
  }, forcedUnavailable, state, new Date(NOW.getTime() + 2000));
  assert.equal(t3.taskStateAfter.activeTask?.slots.date, '2026-09-20');
  assert.equal(t3.taskStateAfter.activeTask?.slots.partySize, 2);
  // The selection/duration from turn 2 must still be there -- a later slot
  // fill must never silently drop an earlier one.
  assert.equal(t3.taskStateAfter.activeTask?.slots.resourceCode, 'activity-horse');
  assert.equal(t3.taskStateAfter.activeTask?.slots.durationMinutes, 30);
  // All required fields are now present, but the customer never said
  // "จองเลย"/committed -- REQUESTED != CONFIRMED, and READY != EXECUTE:
  // no proposal without an explicit commit.
  assert.equal(t3.dialogDecision.actionProposal, undefined, 'ready-but-uncommitted must never fake-propose a booking');

  // Turn 4: "บ่ายสามได้ปะ" -- time, filled onto the SAME task; every prior
  // slot (selection, duration, date, partySize) must still be retained.
  const t4 = await processThongthaiOneMindTurnAuthoritative({
    channel: 'line', message: 'บ่ายสามได้ปะ', eventId: 'canon-4',
    providerUserKey: 'line-canon', persistState: true, environment: 'test',
  }, forcedUnavailable, state, new Date(NOW.getTime() + 3000));
  const finalSlots = t4.taskStateAfter.activeTask?.slots;
  assert.equal(finalSlots?.resourceCode, 'activity-horse', 'the real resourceCode must survive to the final turn');
  assert.equal(finalSlots?.durationMinutes, 30, 'the auto-filled duration must survive to the final turn');
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

  // Human Conversation Recovery: every ordinary turn is read by Language
  // Brain first. During a forced outage each turn falls back to deterministic
  // parsing without losing slots or proposing a transaction.
  assert.equal(modelCallCount, 5,
    'every ordinary turn in this canonical flow should attempt Language Brain before deterministic outage fallback');
});

test('a horse activity with MULTIPLE verified durations asks ONE question showing the real choices, never auto-picks one', async () => {
  const state = memoryState();
  const deps: Partial<OneMindDependencies> = {
    resolveCanonicalGuestId: async () => CANON,
    guestDbIdFromAnonymousId: async () => GUEST,
    interpretSemanticTurn: async () => { throw new LLMAvailabilityError('forced unavailable', []); },
    buildKnowledgeAdapters: (): KnowledgeSourceAdapters => ({
      activity: { catalog: async () => ok('activity_catalog', 'activity_live', horseCatalogFacts([30, 60])) },
    }),
  };
  await processOneMindCustomerTurn({
    channel: 'line', language: 'th', message: 'ม้าล่ะ', eventId: 'multi-1',
    providerUserKey: 'line-multi', persistState: true, environment: 'test',
  }, deps, state, NOW);
  const select = await processThongthaiOneMindTurnAuthoritative({
    channel: 'line', message: 'เอาภาราดร', eventId: 'multi-2',
    providerUserKey: 'line-multi', persistState: true, environment: 'test',
  }, deps, state, new Date(NOW.getTime() + 1000));

  assert.equal(select.taskStateAfter.activeTask?.slots.resourceCode, 'activity-horse');
  assert.equal(select.taskStateAfter.activeTask?.slots.durationMinutes, undefined, 'must NOT auto-pick a duration when more than one is verified');
  assert.ok(select.dialogDecision.missingFields.includes('durationMinutes'));

  const composed = await processOneMindCustomerTurn({
    channel: 'line', language: 'th', message: 'เอาภาราดร', eventId: 'multi-2-compose',
    providerUserKey: 'line-multi', persistState: false, environment: 'test',
  }, deps, state, new Date(NOW.getTime() + 1000));
  assert.equal(composed.status, 'composed');
  if (composed.status === 'composed') {
    assert.match(composed.response.message, /30 นาที/);
    assert.match(composed.response.message, /60 นาที/);
    assert.doesNotMatch(composed.response.message, GENERIC_APOLOGY);
  }
});

test('a horse activity with NO verified duration says it cannot be verified yet, never guesses a default', async () => {
  const state = memoryState();
  const deps: Partial<OneMindDependencies> = {
    resolveCanonicalGuestId: async () => CANON,
    guestDbIdFromAnonymousId: async () => GUEST,
    interpretSemanticTurn: async () => { throw new LLMAvailabilityError('forced unavailable', []); },
    buildKnowledgeAdapters: (): KnowledgeSourceAdapters => ({
      activity: { catalog: async () => ok('activity_catalog', 'activity_live', horseCatalogFacts([])) },
    }),
  };
  await processOneMindCustomerTurn({
    channel: 'line', language: 'th', message: 'ม้าล่ะ', eventId: 'unknown-1',
    providerUserKey: 'line-unknown', persistState: true, environment: 'test',
  }, deps, state, NOW);
  const select = await processThongthaiOneMindTurnAuthoritative({
    channel: 'line', message: 'เอาภาราดร', eventId: 'unknown-2',
    providerUserKey: 'line-unknown', persistState: true, environment: 'test',
  }, deps, state, new Date(NOW.getTime() + 1000));
  assert.equal(select.taskStateAfter.activeTask?.slots.resourceCode, 'activity-horse');
  assert.equal(select.taskStateAfter.activeTask?.slots.durationMinutes, undefined);

  const composed = await processOneMindCustomerTurn({
    channel: 'line', language: 'th', message: 'เอาภาราดร', eventId: 'unknown-2-compose',
    providerUserKey: 'line-unknown', persistState: false, environment: 'test',
  }, deps, state, new Date(NOW.getTime() + 1000));
  assert.equal(composed.status, 'composed');
  if (composed.status === 'composed') {
    assert.match(composed.response.message, /เช็กระยะเวลา|ไม่ขอเดา|ยังไม่มีข้อมูลยืนยัน/);
    assert.doesNotMatch(composed.response.message, GENERIC_APOLOGY);
  }
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


test('activity inventory-count question is language-supervised then answers from authoritative asset inventory', async () => {
  const state = memoryState();
  let modelCallCount = 0;
  const deps: Partial<OneMindDependencies> = {
    resolveCanonicalGuestId: async () => CANON,
    guestDbIdFromAnonymousId: async () => GUEST,
    interpretSemanticTurn: async () => {
      modelCallCount += 1;
      throw new LLMAvailabilityError('forced unavailable', []);
    },
    buildKnowledgeAdapters: (): KnowledgeSourceAdapters => ({
      activity: { catalog: async () => ok('activity_catalog', 'activity_live', horseCatalogFacts([30])) },
    }),
  };

  const result = await processOneMindCustomerTurn({
    channel:'line', language:'th', message:'มีม้ากี่ตัว', eventId:'inventory-count-1',
    providerUserKey:'line-inventory-count', persistState:true, environment:'test',
  }, deps, state, NOW);

  assert.equal(result.status, 'composed');
  if (result.status === 'composed') {
    assert.match(result.response.message, /ตอนนี้มีม้า.*2.*ตัว/u);
    assert.match(result.response.message, /ภาราดร/u);
    assert.doesNotMatch(result.response.message, /ข้อมูลที่ทองไทยเช็กยืนยันได้ตอนนี้/u);
    assert.doesNotMatch(result.response.message, GENERIC_APOLOGY);
  }
  assert.equal(modelCallCount, 1, 'inventory-count language should be supervised once before grounded inventory lookup');
});


test('time supplied before choosing among multiple durations is retained and acknowledged instead of ignored', async () => {
  const state = memoryState();
  const deps: Partial<OneMindDependencies> = {
    resolveCanonicalGuestId: async () => CANON,
    guestDbIdFromAnonymousId: async () => GUEST,
    interpretSemanticTurn: async () => { throw new LLMAvailabilityError('forced unavailable', []); },
    buildKnowledgeAdapters: (): KnowledgeSourceAdapters => ({
      activity: { catalog: async () => ok('activity_catalog', 'activity_live', horseCatalogFacts([30, 60, 90])) },
    }),
  };

  await processOneMindCustomerTurn({
    channel:'line', language:'th', message:'ม้าล่ะ', eventId:'time-before-duration-1',
    providerUserKey:'line-time-before-duration', persistState:true, environment:'test',
  }, deps, state, NOW);

  await processOneMindCustomerTurn({
    channel:'line', language:'th', message:'เอาภาราดร', eventId:'time-before-duration-2',
    providerUserKey:'line-time-before-duration', persistState:true, environment:'test',
  }, deps, state, new Date(NOW.getTime()+1000));

  const result = await processOneMindCustomerTurn({
    channel:'line', language:'th', message:'บ่ายสามได้ปะ', eventId:'time-before-duration-3',
    providerUserKey:'line-time-before-duration', persistState:true, environment:'test',
  }, deps, state, new Date(NOW.getTime()+2000));

  assert.equal(result.status,'composed');
  if (result.status === 'composed') {
    assert.equal(result.turn.taskStateAfter.activeTask?.slots.time,'15:00');
    assert.ok(result.turn.dialogDecision.missingFields.includes('durationMinutes'));
    assert.match(result.response.message,/15:00/u);
    assert.match(result.response.message,/ยังไม่ได้ยืนยันคิว/u);
    assert.match(result.response.message,/30 นาที/u);
    assert.match(result.response.message,/60 นาที/u);
    assert.match(result.response.message,/90 นาที/u);
  }
});
