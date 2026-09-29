// Cost guard hotfix -- TRUE zero-cost pre-router acceptance.
//
// Production DB inspection (ai_response_turns / ai_api_cost_events) proved
// that even when model_reply_used=false and the final answer was
// deterministic/local, the turn still burned a real OpenAI call: EVERY
// ordinary customer turn reached _thongthai-one-mind-orchestrator.ts's
// resolveSemanticTurn, which called interpretSemanticTurn (semantic-
// interpreter) BEFORE any zero-cost routing got a chance to run --
// zero_cost_turn was false on every single turn in the inspected
// conversation (60/60), with 92 real ai_api_cost_events rows totalling
// ~54 THB.
//
// Root cause, traced through the real pipeline (processThongthaiChatCore
// -> processOneMindCustomerTurn -> resolveSemanticTurn ->
// deterministicNeedsLanguageRefinement): the production cost architecture's
// OWN existing zero-call gate already exists and already skips
// interpretSemanticTurn for a narrow allowlist of "exact machine facts" --
// but ask_price/activity_topic_narrow (COARSE_READ_ONLY_INTENTS) were
// deliberately excluded because "price CAN depend on which item/date/
// context is meant" in general. The gap: neither
// detectActivitySideQuestion's ask_price branch nor the activityTopic
// branch's entities ever let the cost gate DISTINGUISH a genuinely
// context-dependent price question from one with zero remaining ambiguity
// (an explicitly named activity in the SAME message). A second, independent
// gap: even a turn that legitimately skipped the semantic-interpreter call
// still went through composeThongthaiResponse, which ALWAYS attempts
// composeGroundedModelResponse (the grounded-response-composition paid
// call) first for any turn with grounded facts -- a second real charge with
// no cost gate of its own at all.
//
// Fix: entities.activityCode is now always populated whenever
// findActivityTopic resolves it from the message's own text; a new
// isTrustedZeroCostFactLookup predicate (_thongthai-one-mind-orchestrator.ts,
// exported) recognizes this unambiguous shape (a single named activity's
// price question) for BOTH the semantic-interpreter skip
// (deterministicNeedsLanguageRefinement) AND the grounded-response-
// composition skip (wired into processOneMindCustomerTurn in
// _thongthai-one-mind-response.ts). This never invents a fact --
// composeGroundedDeterministicResponse is the EXACT SAME fact-grounded
// renderer composeThongthaiResponse itself already falls back to during a
// genuine provider outage. Reset was already fully zero-cost
// (deterministicConversationResetResponse returns before One-Mind is ever
// reached in processThongthaiChatCore) -- this hotfix additionally makes
// that truthful in telemetry by writing an explicit ai_response_turns row
// for it (there was none at all before).
//
// A parallel exception for "มีกิจกรรมอะไรบ้าง" (activity list,
// broad_experience_discovery) was deliberately NOT added: TEST 4 below
// proves _dialog-source-adapters.ts has no 'ecosystem' domain knowledge
// adapter, so skipping the paid call there would replace today's real,
// useful model-composed answer with a "can't verify" apology -- a Phase 4/5
// regression, not a cost win.
//
// Test methodology: processOneMindCustomerTurn/
// processThongthaiOneMindTurnAuthoritative merge caller-supplied
// dependencies as `{ ...REAL_DEPENDENCIES, ...dependencies }`
// (_thongthai-one-mind-orchestrator.ts). The zero-call gate itself is keyed
// on `deps.interpretSemanticTurn === REAL_DEPENDENCIES.interpretSemanticTurn`
// specifically so a caller reusing an already-known cached semantic turn via
// a mocked interpretSemanticTurn never accidentally re-triggers the paid-call
// invariant bookkeeping -- which means a test-supplied mock function can
// never be used to prove "the real call was skipped" (the identity check
// itself would already be false). This suite therefore leaves
// interpretSemanticTurn OUT of every zero-cost test's dependency overrides
// (letting the REAL function be identity-compared and, if genuinely
// unreached, never invoked at all -- no network call is possible for a turn
// this hotfix correctly skips) and observes the SAME signal production
// telemetry is built from: _ai-cost-ledger.ts's console.log('THONGTHAI_AI_COST',
// ...) line, emitted by emitZeroCallTurn (paid_call_used:false,
// ai_zero_call_turn:1) for a genuine zero-cost turn and by reserveAiCall
// (paid_call_used:true) for a real paid attempt -- the exact same function
// that later becomes a persisted ai_api_cost_events row in production. No
// OPENAI_API_KEY is configured in this test environment (this repo's
// established convention -- see tests/zero-cost-provider-outage.test.ts),
// so if a target message DID reach the real interpretSemanticTurn despite
// this hotfix, it would fail fast with a caught ProviderNotConfiguredError/
// LLMAvailabilityError and never attempt a real network call either way --
// the THONGTHAI_AI_COST log capture below still distinguishes the two cases
// because only the zero-call path emits paid_call_used:false.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  processOneMindCustomerTurn,
  type OneMindCustomerTurnResult,
} from '../netlify/functions/_thongthai-one-mind-response';
import type { OneMindDependencies } from '../netlify/functions/_thongthai-one-mind-orchestrator';
import { deriveDeterministicSemanticTurn } from '../netlify/functions/_deterministic-semantic-turn';
import { deterministicNeedsLanguageRefinement, isTrustedZeroCostFactLookup } from '../netlify/functions/_thongthai-one-mind-orchestrator';
import { applyGuestAgentStatePatch, type GuestAgentStateSnapshot } from '../netlify/functions/_guest-agent-state-store';
import { emptySemanticContext, type SemanticContext } from '../netlify/functions/_semantic-interpreter';
import { emptyTaskStateContainer } from '../netlify/functions/_task-state';
import type { GroundedFact, KnowledgeSourceAdapters, SourceResult } from '../netlify/functions/_knowledge-resolver';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';
import { withHarness, guestId as harnessGuestId, brainRequest, type HarnessCatalog } from './helpers/canonical-core-harness';

const NOW = new Date('2026-09-29T05:00:00.000Z');
const CANON = '55555555-5555-4555-8555-555555555555';
const GUEST = '66666666-6666-4666-8666-666666666666';

function fact(key: string, value: unknown, domain: GroundedFact['domain'], sourceId: string, sourceType: GroundedFact['sourceType']): GroundedFact {
  return { key, value, domain, sourceId, sourceType, authoritative: true, fetchedAt: NOW.toISOString() };
}
function ok(sourceId: string, sourceType: GroundedFact['sourceType'], data: GroundedFact[]): SourceResult {
  return { status: 'ok', sourceId, sourceType, fetchedAt: NOW.toISOString(), data };
}

function memoryState() {
  let snapshot: GuestAgentStateSnapshot = { exists: true, state: {}, updatedAt: '2026-09-29T04:59:00.000Z' };
  let rev = 0;
  return {
    loadSnapshot: async () => structuredClone(snapshot),
    compareAndSwap: async (_guest: string, expected: { updatedAt: string }, patch: unknown) => {
      if (expected.updatedAt !== snapshot.updatedAt) return { status: 'conflict' as const };
      rev += 1;
      snapshot = { exists: true, state: applyGuestAgentStatePatch(snapshot.state, patch as never), updatedAt: new Date(NOW.getTime() + rev).toISOString() };
      return { status: 'applied' as const, snapshot: structuredClone(snapshot) };
    },
  };
}

// Real activity_offerings/service_resources shape (see _activity-sot.ts /
// _dialog-source-adapters.ts), production-matching values (verified
// directly against Supabase project upaokrprawzhgzeqsdke this session):
// horse 30min=300/45min=500 THB, pedal_boat 30min=50/60min=100 THB,
// pedal_boat inventoryTotal=2.
function activityCatalogFacts(): GroundedFact[] {
  return [
    fact('activity:horse:name', 'ขี่ม้า', 'activity', 'activity_catalog', 'activity_live'),
    fact('activity:horse:30min:price', 300, 'activity', 'activity_catalog', 'activity_live'),
    fact('activity:horse:45min:price', 500, 'activity', 'activity_catalog', 'activity_live'),
    fact('activity:pedal_boat:name', 'ปั่นเรือเป็ดน้ำ', 'activity', 'activity_catalog', 'activity_live'),
    fact('activity:pedal_boat:30min:price', 50, 'activity', 'activity_catalog', 'activity_live'),
    fact('activity:pedal_boat:60min:price', 100, 'activity', 'activity_catalog', 'activity_live'),
    fact('activity:pedal_boat:inventoryTotal', 2, 'activity', 'activity_catalog', 'activity_live'),
  ];
}

type AiCostLogEntry = { paid_call_used?: boolean; ai_zero_call_turn?: number; event_id?: string; [key: string]: unknown };

/** Spies on _ai-cost-ledger.ts's own console.log('THONGTHAI_AI_COST', ...)
 *  line -- the exact same signal a real ai_api_cost_events row (paid) or a
 *  genuine zero-call turn (emitZeroCallTurn) is built from in production. */
async function captureAiCostLogs(run: () => Promise<void>): Promise<AiCostLogEntry[]> {
  const entries: AiCostLogEntry[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    if (args[0] === 'THONGTHAI_AI_COST' && typeof args[1] === 'string') {
      try { entries.push(JSON.parse(args[1]) as AiCostLogEntry); } catch { /* ignore */ }
    }
  };
  try {
    await run();
  } finally {
    console.log = original;
  }
  return entries;
}

function baseDeps(overrides: Partial<OneMindDependencies> = {}): Partial<OneMindDependencies> {
  return {
    resolveCanonicalGuestId: async () => CANON,
    guestDbIdFromAnonymousId: async () => GUEST,
    buildKnowledgeAdapters: (): KnowledgeSourceAdapters => ({
      activity: { catalog: async () => ok('activity_catalog', 'activity_live', activityCatalogFacts()) },
    }),
    ...overrides,
    // interpretSemanticTurn deliberately NOT set here -- see file header.
  };
}

function isTrueZeroCost(result: OneMindCustomerTurnResult): boolean {
  if (result.status !== 'composed') return false;
  return result.response.mode === 'deterministic'
    && result.turn.dialogSemanticTurn.semanticSource !== 'openai_supervisor';
}

test('TEST 1 -- pedal boat price is TRUE zero-cost: no paid call attempted, real canonical price', async () => {
  const deps = baseDeps();
  const state = memoryState();
  let result!: OneMindCustomerTurnResult;
  const logs = await captureAiCostLogs(async () => {
    result = await processOneMindCustomerTurn({
      channel: 'line', language: 'th', message: 'เป็ดน้ำเท่าไหร่', eventId: 'zc-boat-1',
      providerUserKey: 'line-zc-boat', persistState: true, environment: 'test',
    }, deps, state, NOW);
  });

  assert.equal(logs.some(entry => entry.paid_call_used === true), false, 'no paid semantic/grounded-composition call may be attempted');
  assert.ok(logs.some(entry => entry.ai_zero_call_turn === 1), 'a real zero-call log entry must be emitted for this turn');
  assert.equal(result.status, 'composed');
  if (result.status !== 'composed') return;
  assert.match(result.response.message, /50\s*บาท/u);
  assert.match(result.response.message, /100\s*บาท/u);
  assert.ok(isTrueZeroCost(result), 'response.mode must be deterministic and semanticSource must not be openai_supervisor');
});

test('TEST 2 -- horse price is TRUE zero-cost: no paid call attempted, real canonical price', async () => {
  const deps = baseDeps();
  const state = memoryState();
  let result!: OneMindCustomerTurnResult;
  const logs = await captureAiCostLogs(async () => {
    result = await processOneMindCustomerTurn({
      channel: 'line', language: 'th', message: 'ขี่ม้ากี่บาท', eventId: 'zc-horse-1',
      providerUserKey: 'line-zc-horse', persistState: true, environment: 'test',
    }, deps, state, NOW);
  });

  assert.equal(logs.some(entry => entry.paid_call_used === true), false);
  assert.ok(logs.some(entry => entry.ai_zero_call_turn === 1));
  assert.equal(result.status, 'composed');
  if (result.status !== 'composed') return;
  assert.match(result.response.message, /300\s*บาท/u);
  assert.match(result.response.message, /500\s*บาท/u);
  assert.ok(isTrueZeroCost(result));
});

test('TEST 2b -- explicit ask_price phrasing after the activity domain is already established is also TRUE zero-cost', async () => {
  const deps = baseDeps();
  const state = memoryState();

  await processOneMindCustomerTurn({
    channel: 'line', language: 'th', message: 'ปั่นเป็ดน้ำ', eventId: 'zc-boat2-1',
    providerUserKey: 'line-zc-boat2', persistState: true, environment: 'test',
  }, deps, state, NOW);

  let result!: OneMindCustomerTurnResult;
  const logs = await captureAiCostLogs(async () => {
    result = await processOneMindCustomerTurn({
      channel: 'line', language: 'th', message: 'ปั่นเป็ดน้ำอ่ะราคาเท่าไหร่ครับ', eventId: 'zc-boat2-2',
      providerUserKey: 'line-zc-boat2', persistState: true, environment: 'test',
    }, deps, state, new Date(NOW.getTime() + 1000));
  });

  assert.equal(logs.some(entry => entry.paid_call_used === true), false, 'the explicit ask_price follow-up must not add a paid call either');
  assert.equal(result.status, 'composed');
  if (result.status !== 'composed') return;
  assert.match(result.response.message, /50\s*บาท/u);
  assert.match(result.response.message, /100\s*บาท/u);
  assert.match(result.response.message, /2\s*ลำ/u);
  assert.ok(isTrueZeroCost(result));
});

test('TEST 4 -- "มีกิจกรรมอะไรบ้าง" activity list deliberately stays on the paid path (no ecosystem knowledge source exists to answer it zero-cost)', async () => {
  // _dialog-source-adapters.ts has no 'ecosystem' domain knowledge adapter
  // at all -- a deterministic broad_experience_discovery turn always
  // degrades to a "can't verify" apology, never a real activity list.
  // Skipping the paid call for this intent would silently replace today's
  // real, useful model-composed answer with that apology on every cold-
  // start "what do you have" question -- a Phase 4/5 behavior regression
  // this hotfix must not cause. Proven structurally: the shared predicate
  // both cost gates key off must reject this intent.
  const turn = deriveDeterministicSemanticTurn('มีกิจกรรมอะไรบ้าง', emptySemanticContext(), emptyTaskStateContainer());
  assert.ok(turn);
  assert.equal(turn!.intent, 'broad_experience_discovery');
  assert.equal(isTrustedZeroCostFactLookup(turn!, 'มีกิจกรรมอะไรบ้าง'), false, 'broad_experience_discovery must remain on the paid path until a real ecosystem knowledge source exists');
});

test('TEST 5 -- OpenAI is still used for a genuinely ambiguous/complex turn (paid path untouched)', async () => {
  let modelCallCount = 0;
  const deps: Partial<OneMindDependencies> = {
    resolveCanonicalGuestId: async () => CANON,
    guestDbIdFromAnonymousId: async () => GUEST,
    interpretSemanticTurn: async () => {
      modelCallCount += 1;
      return {
        domain: 'activity', intent: 'ask_price', action: 'ask',
        entities: {}, references: [], constraints: [], confidence: 0.85, needsClarification: false,
        reply: 'ราคาของอันที่คุณถามถึงยังไม่ชัดเจนครับ ขอรายละเอียดเพิ่มอีกนิดได้ไหมครับ',
      };
    },
    buildKnowledgeAdapters: (): KnowledgeSourceAdapters => ({
      activity: { catalog: async () => ok('activity_catalog', 'activity_live', activityCatalogFacts()) },
    }),
  };
  const state = memoryState();
  const result = await processOneMindCustomerTurn({
    channel: 'line', language: 'th', message: 'ตัวไหนนะที่เมื่อกี้มึงบอกว่านิ่งกว่า เอาตัวนั้นแหละ', eventId: 'zc-ambiguous-1',
    providerUserKey: 'line-zc-ambiguous', persistState: true, environment: 'test',
  }, deps, state, NOW);

  assert.equal(modelCallCount, 1, 'a genuinely ambiguous compound reference turn must still reach the real semantic supervisor');
  assert.equal(result.status, 'composed');
  if (result.status !== 'composed') return;
  assert.notEqual(result.turn.dialogSemanticTurn.semanticSource, 'deterministic_fallback');
});

test('TEST 6 -- no false zero-cost: a turn whose meaning came from the model is never marked zero-cost', async () => {
  let modelCallCount = 0;
  const deps: Partial<OneMindDependencies> = {
    resolveCanonicalGuestId: async () => CANON,
    guestDbIdFromAnonymousId: async () => GUEST,
    interpretSemanticTurn: async () => {
      modelCallCount += 1;
      return {
        domain: 'activity', intent: 'ask_price', action: 'ask',
        entities: {}, references: [], constraints: [], confidence: 0.85, needsClarification: false,
      };
    },
    buildKnowledgeAdapters: (): KnowledgeSourceAdapters => ({
      activity: { catalog: async () => ok('activity_catalog', 'activity_live', activityCatalogFacts()) },
    }),
  };
  const state = memoryState();
  const result = await processOneMindCustomerTurn({
    channel: 'line', language: 'th', message: 'ราคาเท่าไหร่ครับ', eventId: 'zc-bare-price-1',
    providerUserKey: 'line-zc-bare-price', persistState: true, environment: 'test',
  }, deps, state, NOW);

  assert.equal(modelCallCount, 1, 'a bare price question naming no activity must still reach interpretSemanticTurn');
  if (result.status === 'composed') {
    assert.equal(isTrueZeroCost(result), false, 'a turn whose semantic meaning came from the real model must never be logged as zero-cost');
  }
});

test('TEST 7 -- cost-event proxy: a genuine zero-cost turn emits no paid THONGTHAI_AI_COST entry; a paid turn does', async () => {
  const zeroCostLogs = await captureAiCostLogs(async () => {
    await processOneMindCustomerTurn({
      channel: 'line', language: 'th', message: 'เป็ดน้ำเท่าไหร่', eventId: 'zc-cost-proxy-1',
      providerUserKey: 'line-zc-cost-proxy-1', persistState: true, environment: 'test',
    }, baseDeps(), memoryState(), NOW);
  });
  assert.equal(zeroCostLogs.filter(entry => entry.paid_call_used === true).length, 0, 'a true zero-cost turn must correspond to zero paid-call log entries (proxy for zero ai_api_cost_events rows)');

  const paidDeps: Partial<OneMindDependencies> = {
    resolveCanonicalGuestId: async () => CANON,
    guestDbIdFromAnonymousId: async () => GUEST,
    interpretSemanticTurn: async () => ({
      domain: 'activity', intent: 'ask_price', action: 'ask',
      entities: {}, references: [], constraints: [], confidence: 0.85, needsClarification: false,
    }),
    buildKnowledgeAdapters: (): KnowledgeSourceAdapters => ({
      activity: { catalog: async () => ok('activity_catalog', 'activity_live', activityCatalogFacts()) },
    }),
  };
  let paidCallCount = 0;
  const wrappedPaidDeps: Partial<OneMindDependencies> = {
    ...paidDeps,
    interpretSemanticTurn: async (...args: Parameters<NonNullable<OneMindDependencies['interpretSemanticTurn']>>) => {
      paidCallCount += 1;
      return paidDeps.interpretSemanticTurn!(...args);
    },
  };
  await processOneMindCustomerTurn({
    channel: 'line', language: 'th', message: 'ราคาเท่าไหร่ครับ', eventId: 'zc-cost-proxy-2',
    providerUserKey: 'line-zc-cost-proxy-2', persistState: true, environment: 'test',
  }, wrappedPaidDeps, memoryState(), NOW);
  assert.equal(paidCallCount, 1, 'a genuinely ambiguous turn must correspond to at least one real semantic-interpreter call (proxy for at least one ai_api_cost_events row)');
});

test('TEST 8 -- structural proof: deterministicNeedsLanguageRefinement returns false for the exact turns TEST 1/2/2b rely on', () => {
  const boatTurn = deriveDeterministicSemanticTurn('เป็ดน้ำเท่าไหร่', emptySemanticContext(), emptyTaskStateContainer());
  assert.ok(boatTurn);
  assert.equal(boatTurn!.entities.activityCode, 'pedal_boat');
  assert.equal(deterministicNeedsLanguageRefinement(boatTurn, emptyTaskStateContainer(), 'เป็ดน้ำเท่าไหร่'), false);
  assert.equal(isTrustedZeroCostFactLookup(boatTurn!, 'เป็ดน้ำเท่าไหร่'), true);

  const horseTurn = deriveDeterministicSemanticTurn('ขี่ม้ากี่บาท', emptySemanticContext(), emptyTaskStateContainer());
  assert.ok(horseTurn);
  assert.equal(horseTurn!.entities.activityCode, 'horse');
  assert.equal(deterministicNeedsLanguageRefinement(horseTurn, emptyTaskStateContainer(), 'ขี่ม้ากี่บาท'), false);

  const activeDomainContext: SemanticContext = { activeDomain: 'activity', recentEntities: [] };
  const explicitAskPrice = deriveDeterministicSemanticTurn('ปั่นเป็ดน้ำอ่ะราคาเท่าไหร่ครับ', activeDomainContext, emptyTaskStateContainer());
  assert.ok(explicitAskPrice);
  assert.equal(explicitAskPrice!.intent, 'ask_price');
  assert.equal(explicitAskPrice!.entities.activityCode, 'pedal_boat');
  assert.equal(deterministicNeedsLanguageRefinement(explicitAskPrice, emptyTaskStateContainer(), 'ปั่นเป็ดน้ำอ่ะราคาเท่าไหร่ครับ'), false);

  // A bare "ราคาเท่าไหร่" naming no activity at all must NOT be trusted --
  // this is the genuinely context-dependent case COARSE_READ_ONLY_INTENTS
  // exists to protect (see TEST 6's own end-to-end proof).
  const bareContext: SemanticContext = { activeDomain: 'activity', recentEntities: [] };
  const barePrice = deriveDeterministicSemanticTurn('ราคาเท่าไหร่ครับ', bareContext, emptyTaskStateContainer());
  assert.ok(barePrice);
  assert.equal(barePrice!.entities.activityCode, undefined);
  assert.equal(deterministicNeedsLanguageRefinement(barePrice, emptyTaskStateContainer(), 'ราคาเท่าไหร่ครับ'), true, 'a price question naming no activity must still require language refinement');

  // A bare, generic first-visit discovery question with no "กิจกรรม" word
  // must NOT be trusted zero-cost -- only the narrower activity-catalog
  // phrasing is (see the mandate's own scoping note).
  const genericDiscovery = deriveDeterministicSemanticTurn('มีอะไรให้เล่นบ้าง', emptySemanticContext(), emptyTaskStateContainer());
  assert.ok(genericDiscovery);
  assert.equal(deterministicNeedsLanguageRefinement(genericDiscovery, emptyTaskStateContainer(), 'มีอะไรให้เล่นบ้าง'), true, 'the general first-visit discovery bucket stays on the paid path');
});

// TEST 9/10 -- full end-to-end regression through processThongthaiChatCore
// ITSELF, using the real HTTP-boundary-mocked harness (matching
// tests/pedal-boat-price-hotfix.test.ts's own convention), not just
// processOneMindCustomerTurn. This is the exact seam where a real
// production bug was found AFTER this hotfix's first version merged: a
// live LINE retest showed "เป็ดน้ำเท่าไหร่"/"ขี่ม้ากี่บาท" correctly skipped
// the semantic-interpreter call (proving TEST 1/2 above were right about
// processOneMindCustomerTurn's own internals) but STILL logged a real
// grounded-response-composition charge in production ai_api_cost_events.
// Root cause: thongthai-chat.ts's early "Human Conversation Recovery" gate
// (processThongthaiChatCore's first processOneMindCustomerTurn attempt)
// only accepted a composed answer when semanticSource==='openai_supervisor'
// -- so a genuinely zero-cost deterministic_fallback answer (correct and
// already free) was discarded there and the turn fell through into a
// legacy path that paid for composition anyway. Fixed by also accepting a
// composed deterministic_fallback answer when isTrustedZeroCostFactLookup
// already proved it trustworthy. These two tests exercise the REAL
// processThongthaiChatCore entry point end to end (the same function LINE
// production calls) so a regression here can never hide behind a narrower
// unit test again.
function pedalBoatAndHorseCatalog(): HarnessCatalog {
  return {
    activityOfferings: [
      { activity_code: 'horse', activity_name: 'ขี่ม้า', duration_minutes: 30, price: 300, currency: 'THB', metadata: {} },
      { activity_code: 'horse', activity_name: 'ขี่ม้า', duration_minutes: 45, price: 500, currency: 'THB', metadata: {} },
      { activity_code: 'pedal_boat', activity_name: 'ปั่นเรือเป็ดน้ำ', duration_minutes: 30, price: 50, currency: 'THB', metadata: {} },
      { activity_code: 'pedal_boat', activity_name: 'ปั่นเรือเป็ดน้ำ', duration_minutes: 60, price: 100, currency: 'THB', metadata: {} },
    ],
    serviceResources: [
      { id: 'res-room-a', code: 'stay-hueun', name: 'เฮือนสเตย์', metadata: {} },
      {
        id: 'res-pedal-boat', code: 'activity-pedal-boat', name: 'ปั่นเรือเป็ดน้ำ', default_capacity: 2, active: true,
        metadata: { activityCode: 'pedal_boat', inventoryTotal: 2, status: 'available' },
      },
    ],
  };
}

test('TEST 9 -- end-to-end through processThongthaiChatCore: pedal boat price makes ZERO real model-provider calls', async () => {
  await withHarness(async harness => {
    const gid = harnessGuestId('e2e-zc-boat');
    const result = await processThongthaiChatCore(brainRequest('เป็ดน้ำเท่าไหร่', gid, 'line'), 'e2e-evt-boat');
    assert.equal(result.statusCode, 200);
    const message = String((result.payload as { message: string }).message);
    assert.match(message, /50\s*บาท/u);
    assert.match(message, /100\s*บาท/u);
    assert.equal(harness.modelCallCount(), 0, 'the real HTTP-mocked model provider must never be called for this turn end-to-end');
  }, pedalBoatAndHorseCatalog());
});

test('TEST 10 -- end-to-end through processThongthaiChatCore: horse price makes ZERO real model-provider calls', async () => {
  await withHarness(async harness => {
    const gid = harnessGuestId('e2e-zc-horse');
    const result = await processThongthaiChatCore(brainRequest('ขี่ม้ากี่บาท', gid, 'line'), 'e2e-evt-horse');
    assert.equal(result.statusCode, 200);
    const message = String((result.payload as { message: string }).message);
    assert.match(message, /300\s*บาท/u);
    assert.match(message, /500\s*บาท/u);
    assert.equal(harness.modelCallCount(), 0, 'the real HTTP-mocked model provider must never be called for this turn end-to-end');
  }, pedalBoatAndHorseCatalog());
});
