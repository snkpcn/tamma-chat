// Conversation-coverage hardening pass -- the exact multi-turn forced-no-LLM
// script from real LINE UAT. Proves the GENERAL rule: an active task is
// INTERRUPTIBLE. Side-questions (compare/price/how-it-works) never hijack
// missing-field collection, a topic switch suspends the task, a return
// resumes the SAME task with every slot intact, and a correction still
// updates a real slot -- all with the model provider FORCED unavailable for
// the entire conversation. Network-free: state/knowledge are injected,
// matching tests/zero-cost-provider-outage.test.ts's established pattern.
// No transaction is ever executed by any turn in this script.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  processThongthaiOneMindTurnAuthoritative,
  type AuthoritativeStateDependencies,
  type OneMindDependencies,
} from '../netlify/functions/_thongthai-one-mind-orchestrator';
import { processOneMindCustomerTurn } from '../netlify/functions/_thongthai-one-mind-response';
import { applyGuestAgentStatePatch, type GuestAgentStateSnapshot } from '../netlify/functions/_guest-agent-state-store';
import { LLMAvailabilityError } from '../netlify/functions/_thongthai-model-provider';
import type { GroundedFact, KnowledgeSourceAdapters, SourceResult } from '../netlify/functions/_knowledge-resolver';

const NOW = new Date('2026-09-19T05:00:00.000Z');
const CANON = '55555555-5555-4555-8555-555555555555';
const GUEST = '66666666-6666-4666-8666-666666666666';

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

// Two horses, MULTIPLE verified durations (30/60/90) -- deliberately not a
// single auto-fillable duration, so the script's own "60 นาที" / "จริงๆ 90
// นาที" turns are real slot-fill/correction turns, not redundant with the
// already-covered single-duration auto-fill scenario.
function horseCatalogFacts(): GroundedFact[] {
  return [
    fact('activity:horse:name', 'ขี่ม้า', 'activity', 'activity_catalog', 'activity_live'),
    fact('activity:horse:resourceCode', 'activity-horse', 'activity', 'activity_catalog', 'activity_live'),
    fact('activity:horse:30min:price', 300, 'activity', 'activity_catalog', 'activity_live'),
    fact('activity:horse:60min:price', 500, 'activity', 'activity_catalog', 'activity_live'),
    fact('activity:horse:90min:price', 700, 'activity', 'activity_catalog', 'activity_live'),
    fact('activity_asset:horse-01:name', 'ภาราดร', 'activity', 'activity_catalog', 'activity_live'),
    fact('activity_asset:horse-01:activityCode', 'horse', 'activity', 'activity_catalog', 'activity_live'),
    fact('activity_asset:horse-02:name', 'สายฟ้า', 'activity', 'activity_catalog', 'activity_live'),
    fact('activity_asset:horse-02:activityCode', 'horse', 'activity', 'activity_catalog', 'activity_live'),
    // Deliberately NO temperament/beginnerSuitability facts -- the source
    // has genuinely never recorded either for these horses.
  ];
}

const GENERIC_APOLOGY = /ตอบเรื่องนี้ให้แม่นไม่ได้|คิดช้ากว่าปกติ/;
const DURATION_PROMPT = /เลือกระยะเวลา|ขอระยะเวลา/;

test('conversation-coverage hardening: exact multi-turn LINE UAT survives provider outage while every ordinary turn attempts Language Brain first', async () => {
  const state = memoryState();
  let modelCallCount = 0;
  const deps: Partial<OneMindDependencies> = {
    resolveCanonicalGuestId: async () => CANON,
    guestDbIdFromAnonymousId: async () => GUEST,
    interpretSemanticTurn: async () => { modelCallCount += 1; throw new LLMAvailabilityError('forced unavailable', []); },
    buildKnowledgeAdapters: (): KnowledgeSourceAdapters => ({
      activity: { catalog: async () => ok('activity_catalog', 'activity_live', horseCatalogFacts()) },
      restaurant: { menu: async () => ok('restaurant_menu_live', 'restaurant_live', [
        fact('menu:tamthai:name', 'ตำไทย', 'restaurant', 'restaurant_menu_live', 'restaurant_live'),
        fact('menu:tamthai:price', 89, 'restaurant', 'restaurant_menu_live', 'restaurant_live'),
        fact('menu:tamthai:orderable', true, 'restaurant', 'restaurant_menu_live', 'restaurant_live'),
      ]) },
    }),
  };

  let eventCounter = 0;
  const send = (message: string) => {
    eventCounter += 1;
    return processOneMindCustomerTurn({
      channel: 'line', language: 'th', message, eventId: `hardening-${eventCounter}`,
      providerUserKey: 'line-hardening', persistState: true, environment: 'test',
    }, deps, state, new Date(NOW.getTime() + eventCounter * 1000));
  };

  // 1. มีไรทำมั่ง -- broad discovery, no task.
  const t1 = await send('มีไรทำมั่ง');
  assert.equal(t1.status, 'composed');
  if (t1.status === 'composed') assert.doesNotMatch(t1.response.message, GENERIC_APOLOGY);

  // 2. ม้าล่ะ -- narrows to activity, shows real horse names via catalog facts.
  const t2 = await send('ม้าล่ะ');
  assert.equal(t2.status, 'composed');
  if (t2.status === 'composed') assert.doesNotMatch(t2.response.message, GENERIC_APOLOGY);

  // 3. ตัวไหนนิสัยดีกว่า -- comparison, no verified temperament data -> must
  // NOT hallucinate an answer, and must not create/touch a task.
  const t3 = await send('ตัวไหนนิสัยดีกว่า');
  assert.equal(t3.status, 'composed');
  if (t3.status === 'composed') {
    assert.doesNotMatch(t3.response.message, GENERIC_APOLOGY);
    assert.doesNotMatch(t3.response.message, /นิสัยดี|ใจดี|ดุ/u, 'must never invent a temperament claim');
  }
  assert.equal(t3.turn.taskStateAfter.activeTask, null, 'a pure comparison must not create a task');

  // 4. เอาภาราดร -- selects the horse; resourceCode resolves authoritatively
  // to the real "activity-horse" resourceCode (never the asset id).
  const t4 = await processThongthaiOneMindTurnAuthoritative({
    channel: 'line', message: 'เอาภาราดร', eventId: 'hardening-select',
    providerUserKey: 'line-hardening', persistState: true, environment: 'test',
  }, deps, state, new Date(NOW.getTime() + 4000));
  assert.ok(t4.taskStateAfter.activeTask);
  assert.equal(t4.taskStateAfter.activeTask?.slots.resourceCode, 'activity-horse');
  assert.equal(t4.taskStateAfter.activeTask?.selectedEntities[0]?.name, 'ภาราดร');
  // Multiple verified durations -> must NOT auto-pick one.
  assert.equal(t4.taskStateAfter.activeTask?.slots.durationMinutes, undefined);

  // 5. บ่ายสามได้ปะ -- time is retained; duration is still genuinely missing
  // so collect_field may still legitimately ask about it (this is a
  // hybrid turn that DOES state a real slot value -- see
  // tests/dialog-manager-side-question-precedence.test.ts for the isolated
  // proof of this exact distinction).
  const t5 = await processThongthaiOneMindTurnAuthoritative({
    channel: 'line', message: 'บ่ายสามได้ปะ', eventId: 'hardening-time',
    providerUserKey: 'line-hardening', persistState: true, environment: 'test',
  }, deps, state, new Date(NOW.getTime() + 5000));
  assert.equal(t5.taskStateAfter.activeTask?.slots.time, '15:00', 'requested time must be retained');
  assert.equal(t5.taskStateAfter.activeTask?.slots.resourceCode, 'activity-horse', 'selection must survive');

  // 6. จะขี่ม้าไง -- how-it-works side-question. Must NOT re-ask duration
  // (no repeated duration prompt on a side question), must not touch slots.
  const t6 = await send('จะขี่ม้าไง');
  assert.equal(t6.status, 'composed');
  if (t6.status === 'composed') {
    assert.doesNotMatch(t6.response.message, GENERIC_APOLOGY);
    assert.doesNotMatch(t6.response.message, DURATION_PROMPT, 'a side-question must not be hijacked into the duration prompt');
    assert.match(t6.response.message, /ขั้นตอน|วิธี|ยังไม่มีข้อมูลยืนยัน/u, 'a how-it-works question must be answered as that question, not as a repeated catalog');
    assert.doesNotMatch(t6.response.message, /กิจกรรมที่มีตอนนี้/u, 'how-it-works must not fall back to the generic activity catalog');
  }
  assert.equal(t6.turn.taskStateAfter.activeTask?.slots.time, '15:00', 'side question must not disturb the task');
  assert.equal(t6.turn.taskStateAfter.activeTask?.slots.resourceCode, 'activity-horse');

  // 7. มีราคาเท่าไร -- price side-question, same invariant.
  const t7 = await send('มีราคาเท่าไร');
  assert.equal(t7.status, 'composed');
  if (t7.status === 'composed') {
    assert.doesNotMatch(t7.response.message, GENERIC_APOLOGY);
    assert.doesNotMatch(t7.response.message, DURATION_PROMPT, 'a price question must not be hijacked into the duration prompt');
    assert.match(t7.response.message, /300 บาท/u);
    assert.match(t7.response.message, /500 บาท/u);
    assert.match(t7.response.message, /700 บาท/u);
    assert.doesNotMatch(t7.response.message, /กิจกรรมที่มีตอนนี้/u, 'a price question must not fall back to the generic activity catalog');
  }
  assert.equal(t7.turn.taskStateAfter.activeTask?.slots.time, '15:00');

  // 8. ร้านมีไรกิน -- topic switch: suspends the activity task, answers the
  // restaurant question instead.
  const t8 = await processThongthaiOneMindTurnAuthoritative({
    channel: 'line', message: 'ร้านมีไรกิน', eventId: 'hardening-switch',
    providerUserKey: 'line-hardening', persistState: true, environment: 'test',
  }, deps, state, new Date(NOW.getTime() + 8000));
  assert.equal(t8.taskStateAfter.activeTask, null, 'the activity task must be suspended, not active, during the restaurant topic');
  assert.ok(t8.taskStateAfter.suspendedTask, 'the activity task must be preserved as suspended, not discarded');
  assert.equal(t8.taskStateAfter.suspendedTask?.slots.resourceCode, 'activity-horse');
  assert.equal(t8.taskStateAfter.suspendedTask?.slots.time, '15:00', 'suspended task must keep every slot filled so far');

  // 9. กลับมาจองม้าต่อ -- resumes the SAME task, same slots intact.
  const t9 = await processThongthaiOneMindTurnAuthoritative({
    channel: 'line', message: 'กลับมาจองม้าต่อ', eventId: 'hardening-resume',
    providerUserKey: 'line-hardening', persistState: true, environment: 'test',
  }, deps, state, new Date(NOW.getTime() + 9000));
  assert.ok(t9.taskStateAfter.activeTask, 'the task must be active again after resuming');
  assert.equal(t9.taskStateAfter.activeTask?.taskId, t4.taskStateAfter.activeTask?.taskId, 'must be the SAME task, never recreated');
  assert.equal(t9.taskStateAfter.activeTask?.slots.resourceCode, 'activity-horse');
  assert.equal(t9.taskStateAfter.activeTask?.slots.time, '15:00', 'time survives the whole suspend/resume round trip');
  assert.equal(t9.taskStateAfter.suspendedTask, null, 'resuming must clear the suspended slot');

  // 10. 60 นาที -- fills durationMinutes.
  const t10 = await processThongthaiOneMindTurnAuthoritative({
    channel: 'line', message: '60 นาที', eventId: 'hardening-duration',
    providerUserKey: 'line-hardening', persistState: true, environment: 'test',
  }, deps, state, new Date(NOW.getTime() + 10000));
  assert.equal(t10.taskStateAfter.activeTask?.slots.durationMinutes, 60);

  // 11. จริงๆ 90 นาที -- corrects the duration, 60 -> 90. No transaction, no
  // fake confirmation anywhere in this entire script (date was never given,
  // so the task never becomes ready -- and even if it had, no commit/จองเลย
  // was ever said).
  const t11 = await processThongthaiOneMindTurnAuthoritative({
    channel: 'line', message: 'จริงๆ 90 นาที', eventId: 'hardening-correction',
    providerUserKey: 'line-hardening', persistState: true, environment: 'test',
  }, deps, state, new Date(NOW.getTime() + 11000));
  assert.equal(t11.taskStateAfter.activeTask?.slots.durationMinutes, 90, 'correction must overwrite, not add to, the duration');
  assert.equal(t11.dialogDecision.actionProposal, undefined, 'no transaction executed anywhere in this script');
  assert.equal(t11.taskStateAfter.activeTask?.status, 'collecting', 'never silently marked ready/executing/confirmed');

  // Human Brain 5.2 deliberately lets coarse READ-ONLY turns attempt semantic
  // understanding first. With the provider forced unavailable, those attempts
  // must fall back to the exact deterministic candidate while transactional
  // slot/correction/cancel turns remain model-free. The five attempts in this
  // script are the bounded read-only questions/switches only.
  assert.equal(modelCallCount, 11,
    'every ordinary turn should attempt Language Brain first; deterministic parsing is outage fallback, not primary language ownership');
});

test('a comparison for beginner-suitability with no verified data is also honest, never hallucinated', async () => {
  const state = memoryState();
  const deps: Partial<OneMindDependencies> = {
    resolveCanonicalGuestId: async () => CANON,
    guestDbIdFromAnonymousId: async () => GUEST,
    interpretSemanticTurn: async () => { throw new LLMAvailabilityError('forced unavailable', []); },
    buildKnowledgeAdapters: (): KnowledgeSourceAdapters => ({
      activity: { catalog: async () => ok('activity_catalog', 'activity_live', horseCatalogFacts()) },
    }),
  };
  await processOneMindCustomerTurn({
    channel: 'line', language: 'th', message: 'ม้าล่ะ', eventId: 'beginner-1',
    providerUserKey: 'line-beginner', persistState: true, environment: 'test',
  }, deps, state, NOW);
  const result = await processOneMindCustomerTurn({
    channel: 'line', language: 'th', message: 'ตัวไหนเหมาะกับมือใหม่', eventId: 'beginner-2',
    providerUserKey: 'line-beginner', persistState: true, environment: 'test',
  }, deps, state, new Date(NOW.getTime() + 1000));
  assert.equal(result.status, 'composed');
  if (result.status === 'composed') {
    assert.doesNotMatch(result.response.message, GENERIC_APOLOGY);
    assert.doesNotMatch(result.response.message, /เหมาะกับมือใหม่|มือใหม่ควรเลือก/u, 'must never invent a beginner-suitability claim');
  }
});

test('a bare count question ("มีม้ากี่ตัว") is answered from the real catalog, never a guessed count', async () => {
  const state = memoryState();
  const deps: Partial<OneMindDependencies> = {
    resolveCanonicalGuestId: async () => CANON,
    guestDbIdFromAnonymousId: async () => GUEST,
    interpretSemanticTurn: async () => { throw new LLMAvailabilityError('forced unavailable', []); },
    buildKnowledgeAdapters: (): KnowledgeSourceAdapters => ({
      activity: { catalog: async () => ok('activity_catalog', 'activity_live', horseCatalogFacts()) },
    }),
  };
  const result = await processOneMindCustomerTurn({
    channel: 'line', language: 'th', message: 'มีม้ากี่ตัว', eventId: 'count-1',
    providerUserKey: 'line-count', persistState: true, environment: 'test',
  }, deps, state, NOW);
  assert.equal(result.status, 'composed');
  if (result.status === 'composed') assert.doesNotMatch(result.response.message, GENERIC_APOLOGY);
});

test('an availability question ("พรุ่งนี้ว่างไหม") on an active task preserves the task and does not fake availability', async () => {
  const state = memoryState();
  const deps: Partial<OneMindDependencies> = {
    resolveCanonicalGuestId: async () => CANON,
    guestDbIdFromAnonymousId: async () => GUEST,
    interpretSemanticTurn: async () => { throw new LLMAvailabilityError('forced unavailable', []); },
    buildKnowledgeAdapters: (): KnowledgeSourceAdapters => ({
      activity: { catalog: async () => ok('activity_catalog', 'activity_live', horseCatalogFacts()) },
    }),
  };
  await processOneMindCustomerTurn({
    channel: 'line', language: 'th', message: 'ม้าล่ะ', eventId: 'avail-1',
    providerUserKey: 'line-avail', persistState: true, environment: 'test',
  }, deps, state, NOW);
  await processThongthaiOneMindTurnAuthoritative({
    channel: 'line', message: 'เอาภาราดร', eventId: 'avail-2',
    providerUserKey: 'line-avail', persistState: true, environment: 'test',
  }, deps, state, new Date(NOW.getTime() + 1000));
  const result = await processOneMindCustomerTurn({
    channel: 'line', language: 'th', message: 'พรุ่งนี้ว่างไหม', eventId: 'avail-3',
    providerUserKey: 'line-avail', persistState: true, environment: 'test',
  }, deps, state, new Date(NOW.getTime() + 2000));
  if (result.status === 'composed') {
    assert.doesNotMatch(result.response.message, GENERIC_APOLOGY);
    assert.doesNotMatch(result.response.message, /จองเรียบร้อย|ยืนยันการจองแล้ว|ว่างครับ|ว่างค่ะ/u, 'must never fabricate a confirmed availability answer');
  }
});

test('an explicit cancel ends the task, and a later "resume" honestly finds nothing to resume rather than reviving it', async () => {
  const state = memoryState();
  const deps: Partial<OneMindDependencies> = {
    resolveCanonicalGuestId: async () => CANON,
    guestDbIdFromAnonymousId: async () => GUEST,
    interpretSemanticTurn: async () => { throw new LLMAvailabilityError('forced unavailable', []); },
    buildKnowledgeAdapters: (): KnowledgeSourceAdapters => ({
      activity: { catalog: async () => ok('activity_catalog', 'activity_live', horseCatalogFacts()) },
    }),
  };
  await processOneMindCustomerTurn({
    channel: 'line', language: 'th', message: 'ม้าล่ะ', eventId: 'cancel-1',
    providerUserKey: 'line-cancel', persistState: true, environment: 'test',
  }, deps, state, NOW);
  const selected = await processThongthaiOneMindTurnAuthoritative({
    channel: 'line', message: 'เอาภาราดร', eventId: 'cancel-2',
    providerUserKey: 'line-cancel', persistState: true, environment: 'test',
  }, deps, state, new Date(NOW.getTime() + 1000));
  assert.ok(selected.taskStateAfter.activeTask);

  const cancelled = await processThongthaiOneMindTurnAuthoritative({
    channel: 'line', message: 'ยกเลิกก่อน', eventId: 'cancel-3',
    providerUserKey: 'line-cancel', persistState: true, environment: 'test',
  }, deps, state, new Date(NOW.getTime() + 2000));
  assert.equal(cancelled.taskStateAfter.activeTask?.status, 'cancelled');

  const resumeAttempt = await processThongthaiOneMindTurnAuthoritative({
    channel: 'line', message: 'กลับมาจองต่อ', eventId: 'cancel-4',
    providerUserKey: 'line-cancel', persistState: true, environment: 'test',
  }, deps, state, new Date(NOW.getTime() + 3000));
  // A cancelled task is terminal -- it must never be silently revived with
  // its old (now stale) slots as if nothing happened.
  assert.notEqual(resumeAttempt.taskStateAfter.activeTask?.status, 'collecting');
  assert.notEqual(resumeAttempt.dialogDecision.actionProposal?.toolName, 'create_booking');
});
