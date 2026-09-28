// Kernel V2 Phase 3 increment 1: semantic concept memory.
//
// Proves what this increment HONESTLY achieves (see the module's own
// honesty note on conceptSimilarity -- this is surface-form matching, not
// real semantic understanding):
//  1. An UNSEEN near-identical variant of an already-confirmed exemplar
//     (an appended detail, a typo, a reordering) resolves without a paid
//     model call -- not the exact literal string used to seed the store (no
//     "gold cheating"), but a genuinely different sentence.
//  2. A message using different VOCABULARY for the same underlying concept
//     ("คนรู้ใจ" vs "แฟน" -- no shared characters) correctly does NOT match a
//     single seeded exemplar -- proving this module does not oversell
//     cross-vocabulary generalization it cannot deliver without embeddings.
//     The write-path test shows how such a phrase instead becomes its OWN
//     additional exemplar once OpenAI confirms it, which is the real
//     mechanism by which coverage grows over time.
//  3. Safety by construction -- a matched concept can never own a
//     COMMIT/CANCEL/money/safety-shaped turn, and never fires on a longer or
//     multi-clause message.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeForConceptMatching, conceptSimilarity, matchLearnedConcept,
  safeConceptEntities, companionConceptKeyForValue, isCompanionConceptKey,
  MIN_SIMILARITY, MIN_TIER_A_EVIDENCE_COUNT, SEMANTIC_CONCEPT_MEMORY_WRITE_TIMEOUT_MS,
  type StoredSemanticConcept,
} from '../netlify/functions/_semantic-concept-memory';
import { withHarness, guestId, brainRequest, type Harness } from './helpers/canonical-core-harness';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';

function seededConcept(overrides: Partial<StoredSemanticConcept> = {}): StoredSemanticConcept {
  return {
    id: 'concept-1',
    conceptKey: 'companion_partner',
    normalizedSignature: normalizeForConceptMatching('มากับแฟน'),
    confidence: 0.9,
    evidenceCount: 5,
    contradictionCount: 0,
    status: 'active',
    ...overrides,
  };
}

test('unit: normalizeForConceptMatching strips politeness particles and punctuation, never the content', () => {
  assert.equal(normalizeForConceptMatching('มากับแฟนค่ะ'), normalizeForConceptMatching('มากับแฟน'));
  assert.equal(normalizeForConceptMatching('มากับแฟนนะครับ'), normalizeForConceptMatching('มากับแฟน'));
});

test('unit: conceptSimilarity generalizes across a near-identical unseen variant, not just exact-string match', () => {
  const base = normalizeForConceptMatching('มากับแฟน');
  // A genuinely different sentence (not the literal seeded string) that adds
  // one detail to the same confirmed exemplar -- this is what v1's surface
  // matching reliably catches.
  const nearVariant = normalizeForConceptMatching('มากับแฟนสองคน');
  assert.ok(
    conceptSimilarity(base, nearVariant) >= 0.6,
    'an appended-detail variant of a confirmed exemplar must score high enough to be trusted',
  );
  assert.equal(conceptSimilarity(base, base), 1);
  assert.equal(conceptSimilarity('', base), 0);
});

test('unit: conceptSimilarity honestly does NOT bridge a different vocabulary choice for the same concept', () => {
  const base = normalizeForConceptMatching('มากับแฟน');
  // "คนรู้ใจ" (soulmate/significant other) and "แฟน" (partner) share no
  // characters -- true synonym bridging needs embedding similarity
  // (pgvector), which is explicitly deferred, not faked here with a
  // hand-written synonym table.
  const differentVocabulary = normalizeForConceptMatching('มากับคนรู้ใจ');
  assert.ok(
    conceptSimilarity(base, differentVocabulary) < MIN_SIMILARITY,
    'a genuinely different vocabulary choice must NOT be treated as a confident match from a single exemplar',
  );
});

test('unit: matchLearnedConcept ignores concepts below the confidence/evidence bar (Tier B, fuzzy match)', () => {
  // These use a FUZZY (non-exact) variant of the seeded signature, so Tier
  // B's higher bar applies -- Tier A's lower bar (see the two-tier test
  // below) is reserved for a genuine exact replay only.
  const fuzzyVariant = 'มากับแฟนสองคน';
  const lowConfidence = seededConcept({ confidence: 0.5 });
  const lowEvidence = seededConcept({ evidenceCount: 1 });
  const superseded = seededConcept({ status: 'superseded' });
  assert.equal(matchLearnedConcept(fuzzyVariant, [lowConfidence]), null);
  assert.equal(matchLearnedConcept(fuzzyVariant, [lowEvidence]), null);
  assert.equal(matchLearnedConcept(fuzzyVariant, [superseded]), null);
});

test('unit: matchLearnedConcept still rejects an exact replay below even Tier A\'s lower confidence bar', () => {
  const lowConfidence = seededConcept({ confidence: 0.5, evidenceCount: 1 });
  assert.equal(
    matchLearnedConcept('มากับแฟน', [lowConfidence]), null,
    'Tier A lowers the EVIDENCE bar for an exact replay, never the confidence bar below 0.7',
  );
});

test('acceptance D (unit): a negated/contradictory phrase never matches a superficially similar confirmed concept', () => {
  const concept = seededConcept();
  // "ไม่มากับแฟน" (NOT coming with a partner) scores 0.73 on pure surface
  // similarity against "มากับแฟน" in calibration -- well above MIN_SIMILARITY
  // -- so this specifically exercises the negation-mismatch veto in
  // conceptSimilarity, not merely low similarity.
  assert.equal(matchLearnedConcept('ไม่มากับแฟน', [concept]), null);
  assert.equal(matchLearnedConcept('เลิกกับแฟนแล้ว', [concept]), null);
  assert.ok(
    conceptSimilarity(normalizeForConceptMatching('มากับแฟน'), normalizeForConceptMatching('ไม่มากับแฟน')) === 0,
    'negation mismatch must zero out similarity regardless of surface character overlap',
  );
});

test('acceptance D (unit): a concept with a recorded contradiction is never matched even if still marked active', () => {
  const contradicted = seededConcept({ contradictionCount: 1 });
  assert.equal(
    matchLearnedConcept('มากับแฟน', [contradicted]), null,
    'a contradicted row must be excluded as defense in depth, independent of its status field',
  );
});

test('unit: matchLearnedConcept never fires on a long or unrelated message', () => {
  const concept = seededConcept();
  assert.equal(
    matchLearnedConcept('อยากขี่ม้าพรุ่งนี้ช่วงเย็น มากับแฟนสองคน แต่ไม่เอาทองไทยนะ เอาตัวที่นิสัยนิ่งกว่า', [concept]),
    null,
    'a long compound sentence must never be attributed to one learned fragment',
  );
  assert.equal(matchLearnedConcept('พรุ่งนี้มีห้องว่างไหม', [concept]), null, 'an unrelated message must not match');
});

test('unit: safeConceptEntities can only ever produce entities.companion -- closed by construction', () => {
  for (const key of ['companion_partner', 'companion_family', 'companion_friends', 'companion_solo'] as const) {
    const entities = safeConceptEntities(key);
    assert.deepEqual(Object.keys(entities), ['companion']);
  }
});

test('unit: companionConceptKeyForValue / isCompanionConceptKey only recognize the closed vocabulary', () => {
  assert.equal(companionConceptKeyForValue('partner'), 'companion_partner');
  assert.equal(companionConceptKeyForValue('stranger'), null);
  assert.equal(isCompanionConceptKey('companion_partner'), true);
  assert.equal(isCompanionConceptKey('booking_confirmed'), false);
});

function msg(payload: unknown): string {
  return String((payload as { message: string }).message);
}

/** Wraps the harness's own fetch mock to additionally serve
 *  semantic_concept_memory reads/writes, without modifying the shared
 *  harness file (which many other tests depend on staying unchanged).
 *  `writeDelayMs` (ms, or `Infinity` to never resolve) simulates a
 *  slow/stuck Supabase round trip on PATCH/POST, for proving the write is
 *  genuinely awaited (durability) and bounded by a timeout (no unbounded
 *  latency) -- see acceptance items 3 below. */
function installConceptMemoryMock(
  harness: Harness,
  seedRows: StoredSemanticConcept[],
  options: { writeDelayMs?: number } = {},
) {
  const patches: Array<Record<string, unknown>> = [];
  const posts: Array<Record<string, unknown>> = [];
  const seenSignalKeys = new Set<string>();
  const rows = seedRows.map(row => ({
    id: row.id,
    concept_key: row.conceptKey,
    normalized_signature: row.normalizedSignature,
    confidence: row.confidence,
    evidence_count: row.evidenceCount,
    contradiction_count: row.contradictionCount,
    status: row.status,
  }));
  const delay = () => options.writeDelayMs
    ? new Promise<void>(resolve => {
      if (options.writeDelayMs === Infinity) return; // never resolves -- simulates a stuck request
      setTimeout(resolve, options.writeDelayMs);
    })
    : Promise.resolve();
  const baseFetch = harness.fetchMock;
  global.fetch = (async (url: string | URL, init: RequestInit = {}) => {
    const u = String(url);
    if (u.includes('semantic_concept_memory')) {
      const method = (init.method ?? 'GET').toUpperCase();
      if (method === 'GET') {
        return new Response(JSON.stringify(rows.filter(row => row.status === 'active')), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (method === 'PATCH') {
        await delay();
        const body = JSON.parse(String(init.body ?? '{}')) as { status?: string; contradiction_count?: number };
        patches.push(body);
        // Mirrors real Postgres: the same in-memory rows this mock's GET
        // reads from must reflect a PATCH, so a subsequent read in the SAME
        // test sees the retraction/reinforcement, matching production.
        const idMatch = u.match(/id=eq\.([^&]+)/);
        const row = idMatch ? rows.find(candidate => candidate.id === decodeURIComponent(idMatch[1]!)) : undefined;
        if (row) {
          if (typeof body.status === 'string') row.status = body.status;
          if (typeof body.contradiction_count === 'number') row.contradiction_count = body.contradiction_count;
        }
        return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (method === 'POST') {
        await delay();
        // Mirrors the real migration's unique(source_signal_key) +
        // on_conflict=ignore-duplicates: a repeat insert for the SAME
        // confirmed exemplar (e.g. the ai-cost-ledger replaying an
        // already-confirmed turn for the same eventId, see the write-path
        // hook's own comment) is a harmless no-op in real Postgres, never a
        // second row.
        const body = JSON.parse(String(init.body ?? '{}')) as { source_signal_key?: string };
        if (!seenSignalKeys.has(body.source_signal_key ?? '')) {
          seenSignalKeys.add(body.source_signal_key ?? '');
          posts.push(body);
        }
        return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
      }
    }
    return baseFetch(url, init);
  }) as typeof fetch;
  return { patches, posts };
}

test('integration: an UNSEEN near-identical variant of a learned companion concept resolves at zero cost, mid an in-progress task', async () => {
  await withHarness(async harness => {
    installConceptMemoryMock(harness, [seededConcept()]);
    const gid = guestId('phase3-companion-unseen-variant');
    // This mirrors the mandate's own worked shape: companion context arrives
    // WHILE another domain is already active (here, an activity booking
    // opened deterministically by the exact horse-name mention), never as an
    // isolated first message with nothing else going on. The model is left
    // unprogrammed for both turns (harness default), so ANY OpenAI call at
    // all proves the concept memory branch did not take over.
    const turn1 = await processThongthaiChatCore(brainRequest('อยากขี่ม้าพรุ่งนี้ เอาภาราดร', gid, 'web'), 'evt-0');
    assert.equal(turn1.statusCode, 200);
    const callsAfterTurn1 = harness.modelCallCount();

    // "มากับแฟนสองคน" is a genuinely different sentence from the seeded
    // exemplar "มากับแฟน" (never sent to the pipeline before), not the exact
    // literal string used to seed the store.
    const turn2 = await processThongthaiChatCore(brainRequest('มากับแฟนสองคน', gid, 'web', [
      { role: 'user', content: 'อยากขี่ม้าพรุ่งนี้ เอาภาราดร' },
      { role: 'assistant', content: msg(turn1.payload) },
    ]), 'evt-1');
    assert.equal(turn2.statusCode, 200);
    assert.equal(
      harness.modelCallCount(), callsAfterTurn1,
      'a genuinely learned, high-confidence concept must resolve without paying for another model call',
    );
  });
});

test('integration: a different vocabulary choice for the same concept correctly still requires the real model (honest limit, not a false positive)', async () => {
  await withHarness(async harness => {
    installConceptMemoryMock(harness, [seededConcept()]);
    const gid = guestId('phase3-companion-different-vocabulary');
    const turn1 = await processThongthaiChatCore(brainRequest('อยากขี่ม้าพรุ่งนี้ เอาภาราดร', gid, 'web'), 'evt-0');
    assert.equal(turn1.statusCode, 200);
    const callsAfterTurn1 = harness.modelCallCount();

    // "มากับคนรู้ใจ" uses different vocabulary than the seeded "มากับแฟน" --
    // v1's surface-form matcher correctly does NOT claim this as a match, so
    // it must still attempt the real semantic path exactly as it would
    // without any concept memory at all.
    const turn2 = await processThongthaiChatCore(brainRequest('มากับคนรู้ใจ', gid, 'web', [
      { role: 'user', content: 'อยากขี่ม้าพรุ่งนี้ เอาภาราดร' },
      { role: 'assistant', content: msg(turn1.payload) },
    ]), 'evt-1');
    assert.equal(turn2.statusCode, 200);
    assert.ok(
      harness.modelCallCount() > callsAfterTurn1,
      'an unmatched, genuinely different phrasing must still be attempted by the real semantic path, never silently dropped',
    );
  });
});

test('integration: the write path accumulates a genuinely new confirmed exemplar as its own row, not a rewrite of the old one', async () => {
  await withHarness(async harness => {
    const { posts } = installConceptMemoryMock(harness, [seededConcept()]);
    const gid = guestId('phase3-companion-write-path-new-exemplar');
    const turn1 = await processThongthaiChatCore(brainRequest('อยากขี่ม้าพรุ่งนี้ เอาภาราดร', gid, 'web'), 'evt-0');
    assert.equal(turn1.statusCode, 200);

    // This is the raw semantic JSON the real model is instructed to return
    // (same shape used by tests/human-brain-phase1-semantic-first.test.ts) --
    // a high-confidence, short, standalone companion statement confirming
    // "มากับคนรู้ใจ" means companion: partner.
    (harness.programGeminiReply as unknown as (reply: Record<string, unknown>) => void)({
      domain: 'activity',
      intent: 'companion_statement',
      action: 'provide_information',
      entities: { companion: 'partner' },
      references: [],
      constraints: [],
      confidence: 0.92,
      needsClarification: false,
    });

    await processThongthaiChatCore(brainRequest('มากับคนรู้ใจ', gid, 'web', [
      { role: 'user', content: 'อยากขี่ม้าพรุ่งนี้ เอาภาราดร' },
      { role: 'assistant', content: msg(turn1.payload) },
    ]), 'evt-1');

    assert.equal(posts.length, 1, 'a newly confirmed, genuinely different exemplar must be recorded exactly once');
    assert.equal(posts[0]!.concept_key, 'companion_partner');
    assert.notEqual(
      posts[0]!.normalized_signature, seededConcept().normalizedSignature,
      'the new exemplar must be stored as its OWN signature, never silently merged into the old one it does not resemble',
    );
  });
});

test('acceptance D (integration): a negated companion statement never reuses the prior concept and still requires the real model', async () => {
  await withHarness(async harness => {
    installConceptMemoryMock(harness, [seededConcept()]);
    const gid = guestId('phase3-companion-negation-contradiction');
    const turn1 = await processThongthaiChatCore(brainRequest('อยากขี่ม้าพรุ่งนี้ เอาภาราดร', gid, 'web'), 'evt-0');
    assert.equal(turn1.statusCode, 200);
    const callsAfterTurn1 = harness.modelCallCount();

    // "ไม่ได้มากับแฟนนะ" (I did NOT come with a partner) is the exact
    // opposite meaning of the seeded "มากับแฟน" exemplar despite very high
    // surface-character overlap -- it must never be silently reused.
    const turn2 = await processThongthaiChatCore(brainRequest('ไม่ได้มากับแฟนนะ', gid, 'web', [
      { role: 'user', content: 'อยากขี่ม้าพรุ่งนี้ เอาภาราดร' },
      { role: 'assistant', content: msg(turn1.payload) },
    ]), 'evt-1');
    assert.equal(turn2.statusCode, 200);
    assert.ok(
      harness.modelCallCount() > callsAfterTurn1,
      'a contradictory phrase must fall through to the real model rather than reusing the prior concept',
    );
  });
});

test('acceptance D (integration): a confirmed contradiction against a DIFFERENT concept retracts the stale row', async () => {
  await withHarness(async harness => {
    // Seed companion_partner from "มากับแฟน" with LOW evidence AND LOW
    // confidence (below Tier A's own 0.7 bar) -- deliberately: a
    // not-yet-trusted row is exactly what the contradiction check protects.
    // A row that already cleared EITHER tier's trust bar would have been
    // caught (correctly, harmlessly) by the READ path's own exact-replay
    // match before the model was ever called at all, which would make this
    // test about the read path, not contradiction detection.
    const { patches } = installConceptMemoryMock(harness, [seededConcept({ evidenceCount: 1, confidence: 0.6 })]);
    const gid = guestId('phase3-companion-cross-concept-contradiction');
    const turn1 = await processThongthaiChatCore(brainRequest('อยากขี่ม้าพรุ่งนี้ เอาภาราดร', gid, 'web'), 'evt-0');
    assert.equal(turn1.statusCode, 200);

    (harness.programGeminiReply as unknown as (reply: Record<string, unknown>) => void)({
      domain: 'activity',
      intent: 'companion_statement',
      action: 'provide_information',
      entities: { companion: 'solo' },
      references: [],
      constraints: [],
      confidence: 0.93,
      needsClarification: false,
    });
    // Deliberately the SAME text as the seeded companion_partner exemplar --
    // a real-world equivalent would be a near-duplicate signature OpenAI
    // confirms means something else. This isolates the contradiction
    // mechanism itself from the similarity threshold.
    await processThongthaiChatCore(brainRequest('มากับแฟน', gid, 'web', [
      { role: 'user', content: 'อยากขี่ม้าพรุ่งนี้ เอาภาราดร' },
      { role: 'assistant', content: msg(turn1.payload) },
    ]), 'evt-1');

    const retraction = patches.find(patch => patch.status === 'retracted');
    assert.ok(retraction, 'the contradicted companion_partner row must be retracted, not left silently trustworthy');
  });
});

test('integration: a message with no seeded concept correctly finds nothing to match (empty store degrades safely)', async () => {
  await withHarness(async harness => {
    installConceptMemoryMock(harness, []);
    const gid = guestId('phase3-companion-empty-store');
    const r = await processThongthaiChatCore(brainRequest('มากับแฟน', gid, 'web'), 'evt-0');
    assert.equal(r.statusCode, 200);
    // No learned concept exists yet, so this must fall through to whatever
    // the system does today (real model attempt / deterministic fallback) --
    // it must NOT crash or silently invent a match.
    assert.ok(msg(r.payload).trim().length > 0);
  });
});

test('negative control: a real commit/booking message is never routed through the fuzzy concept matcher', async () => {
  await withHarness(async harness => {
    // Seed a deliberately over-broad, low-quality concept to prove the
    // matcher's own structural guards (length/multi-clause), not merely a
    // lucky absence of similarity, are what keep this safe.
    installConceptMemoryMock(harness, [seededConcept({ normalizedSignature: normalizeForConceptMatching('จองเลยครับ') })]);
    const gid = guestId('phase3-negative-control-commit');
    const r = await processThongthaiChatCore(brainRequest('จองเลยครับ ยืนยันการจอง', gid, 'web'), 'evt-0');
    assert.equal(r.statusCode, 200);
    assert.doesNotMatch(msg(r.payload), /จองสำเร็จ|เลขที่จอง/u, 'a fuzzy-matched concept must never be able to execute or confirm a transaction by itself');
  });
});

// ---------------------------------------------------------------------------
// Fixes from PR #218 review (structural blockers found before merge/migration).
// ---------------------------------------------------------------------------

test('review fix 1 (unit): the read-path gate rejects a multi-clause message the same way the write path already did', () => {
  // Before the fix, only message length gated the read path -- a SHORT but
  // multi-clause message could still reach matchLearnedConcept even though
  // isShortStandaloneConceptCandidate (used by the write path) already
  // refused this exact shape. This is exercised end-to-end below; this unit
  // test locks the underlying claim that such a message's own normalized
  // form would otherwise score a real match if the gate were missing.
  const shortMultiClause = 'มากับแฟน แต่ไม่จอง';
  assert.ok(shortMultiClause.length <= 40, 'fixture must stay within MAX_MATCHABLE_MESSAGE_LENGTH to isolate the clause-shape gate');
  const concept = seededConcept({ normalizedSignature: normalizeForConceptMatching(shortMultiClause) });
  // matchLearnedConcept itself has no clause-shape awareness (that lives in
  // the orchestrator's shared isShortStandaloneConceptCandidate gate) --
  // this confirms the underlying similarity WOULD match, so the
  // integration test below is proving the gate, not an accidental miss.
  assert.ok(matchLearnedConcept(shortMultiClause, [concept]) !== null);
});

test('review fix 1 (integration): a short multi-clause message never resolves via semantic concept memory, even when its own text was seeded as the exemplar', async () => {
  await withHarness(async harness => {
    const shortMultiClause = 'มากับแฟน แต่ไม่จอง';
    installConceptMemoryMock(harness, [seededConcept({ normalizedSignature: normalizeForConceptMatching(shortMultiClause) })]);
    const gid = guestId('phase3-review-multiclause-read-gate');
    const before = harness.modelCallCount();
    const r = await processThongthaiChatCore(brainRequest(shortMultiClause, gid, 'web'), 'evt-0');
    assert.equal(r.statusCode, 200);
    assert.ok(
      harness.modelCallCount() > before,
      'a short but multi-clause message must still reach the real model, never be silently owned by semantic concept memory',
    );
  });
});

test('review fix 2 (integration): reinforcing a weak exemplar advances confidence from ITS OWN value, never a stronger sibling exemplar\'s', async () => {
  await withHarness(async harness => {
    const strongExemplarA = seededConcept({
      id: 'concept-strong-a', normalizedSignature: normalizeForConceptMatching('มากับแฟน'),
      confidence: 0.95, evidenceCount: 10,
    });
    const weakExemplarB = seededConcept({
      // Confidence deliberately BELOW Tier A's 0.7 bar: the triggering
      // message below normalizes to an EXACT replay of this row's own
      // signature, and this test is about write-path reinforcement, not the
      // read path's (correct, separately-tested) Tier A fast path.
      id: 'concept-weak-b', normalizedSignature: normalizeForConceptMatching('พาแฟนไปด้วย'),
      confidence: 0.65, evidenceCount: 2,
    });
    const { patches } = installConceptMemoryMock(harness, [strongExemplarA, weakExemplarB]);
    const gid = guestId('phase3-review-confidence-cross-leak');
    const turn1 = await processThongthaiChatCore(brainRequest('อยากขี่ม้าพรุ่งนี้ เอาภาราดร', gid, 'web'), 'evt-0');
    assert.equal(turn1.statusCode, 200);

    (harness.programGeminiReply as unknown as (reply: Record<string, unknown>) => void)({
      domain: 'activity', intent: 'companion_statement', action: 'provide_information',
      entities: { companion: 'partner' }, references: [], constraints: [],
      confidence: 0.9, needsClarification: false,
    });
    // A near-identical variant of weakExemplarB's own signature only.
    await processThongthaiChatCore(brainRequest('พาแฟนไปด้วยนะ', gid, 'web', [
      { role: 'user', content: 'อยากขี่ม้าพรุ่งนี้ เอาภาราดร' },
      { role: 'assistant', content: msg(turn1.payload) },
    ]), 'evt-1');

    const reinforcement = patches.find(patch => typeof patch.confidence === 'number');
    assert.ok(reinforcement, 'a reinforcement PATCH must have been issued');
    assert.equal(
      reinforcement!.confidence, Math.min(0.99, weakExemplarB.confidence + 0.02),
      'confidence must advance from the MATCHED row\'s own prior value, never the stronger sibling\'s',
    );
  });
});

test('review fix 3a (integration): the learning write is genuinely awaited, not fire-and-forget', async () => {
  await withHarness(async harness => {
    const writeDelayMs = 200;
    installConceptMemoryMock(harness, [], { writeDelayMs });
    const gid = guestId('phase3-review-durability-awaited');
    const turn1 = await processThongthaiChatCore(brainRequest('อยากขี่ม้าพรุ่งนี้ เอาภาราดร', gid, 'web'), 'evt-0');
    assert.equal(turn1.statusCode, 200);

    (harness.programGeminiReply as unknown as (reply: Record<string, unknown>) => void)({
      domain: 'activity', intent: 'companion_statement', action: 'provide_information',
      entities: { companion: 'partner' }, references: [], constraints: [],
      confidence: 0.9, needsClarification: false,
    });
    const startedAt = Date.now();
    await processThongthaiChatCore(brainRequest('มากับแฟน', gid, 'web', [
      { role: 'user', content: 'อยากขี่ม้าพรุ่งนี้ เอาภาราดร' },
      { role: 'assistant', content: msg(turn1.payload) },
    ]), 'evt-1');
    const elapsedMs = Date.now() - startedAt;
    assert.ok(
      elapsedMs >= writeDelayMs * 0.8,
      `a genuinely awaited write must delay the response by roughly its own duration (got ${elapsedMs}ms, expected >= ~${writeDelayMs}ms) -- a fire-and-forget write would return almost instantly`,
    );
  });
});

test('review fix 3b (integration): a stuck learning write is bounded by a timeout, never hangs the customer response', async () => {
  await withHarness(async harness => {
    installConceptMemoryMock(harness, [], { writeDelayMs: Infinity });
    const gid = guestId('phase3-review-durability-bounded');
    const turn1 = await processThongthaiChatCore(brainRequest('อยากขี่ม้าพรุ่งนี้ เอาภาราดร', gid, 'web'), 'evt-0');
    assert.equal(turn1.statusCode, 200);

    (harness.programGeminiReply as unknown as (reply: Record<string, unknown>) => void)({
      domain: 'activity', intent: 'companion_statement', action: 'provide_information',
      entities: { companion: 'partner' }, references: [], constraints: [],
      confidence: 0.9, needsClarification: false,
    });
    const startedAt = Date.now();
    const r = await processThongthaiChatCore(brainRequest('มากับแฟน', gid, 'web', [
      { role: 'user', content: 'อยากขี่ม้าพรุ่งนี้ เอาภาราดร' },
      { role: 'assistant', content: msg(turn1.payload) },
    ]), 'evt-1');
    const elapsedMs = Date.now() - startedAt;
    assert.equal(r.statusCode, 200, 'the customer response must still succeed even when the learning write never resolves');
    assert.ok(
      elapsedMs < SEMANTIC_CONCEPT_MEMORY_WRITE_TIMEOUT_MS + 1000,
      `a stuck write must never add unbounded latency (got ${elapsedMs}ms, timeout is ${SEMANTIC_CONCEPT_MEMORY_WRITE_TIMEOUT_MS}ms)`,
    );
  });
});

test('review fix 4 (integration): a message carrying a direct identifier is never persisted, even if otherwise a clean high-confidence candidate', async () => {
  await withHarness(async harness => {
    const { posts, patches } = installConceptMemoryMock(harness, []);
    const gid = guestId('phase3-review-privacy-reject');
    const turn1 = await processThongthaiChatCore(brainRequest('อยากขี่ม้าพรุ่งนี้ เอาภาราดร', gid, 'web'), 'evt-0');
    assert.equal(turn1.statusCode, 200);

    (harness.programGeminiReply as unknown as (reply: Record<string, unknown>) => void)({
      domain: 'activity', intent: 'companion_statement', action: 'provide_information',
      entities: { companion: 'partner' }, references: [], constraints: [],
      confidence: 0.95, needsClarification: false,
    });
    // A phone number riding along with an otherwise clean companion
    // statement -- short, standalone, high confidence, exactly the shape
    // that would otherwise be learned.
    await processThongthaiChatCore(brainRequest('มากับแฟน 0812345678', gid, 'web', [
      { role: 'user', content: 'อยากขี่ม้าพรุ่งนี้ เอาภาราดร' },
      { role: 'assistant', content: msg(turn1.payload) },
    ]), 'evt-1');

    assert.equal(posts.length, 0, 'a message carrying a phone number must never be persisted as a learned exemplar');
    assert.equal(patches.length, 0, 'a rejected candidate must not reinforce any existing row either');
  });
});

// ---------------------------------------------------------------------------
// Fixes from the SECOND PR #218 review round (two-tier trust policy +
// stronger privacy boundary), found before merge/migration.
// ---------------------------------------------------------------------------

test('two-tier (unit): a high-confidence safe phrase learned ONCE is immediately trusted for an exact replay (Tier A)', () => {
  // The DEFAULT values a freshly-promoted row is written with (see
  // recordSemanticConceptEvidence: confidence 0.7, evidence_count 1) must
  // already clear Tier A's bar -- this is the actual "ask once, reuse next
  // time" fix, applied only to the safest possible case: an exact replay of
  // the confirmed sentence itself (here, only a politeness particle
  // differs -- normalizes identically).
  const freshlyLearned = seededConcept({ confidence: 0.7, evidenceCount: 1 });
  const match = matchLearnedConcept('มากับแฟนค่ะ', [freshlyLearned]);
  assert.ok(match, 'a single confirmation must be enough to trust an exact (post-normalization) replay');
  assert.equal(match!.tier, 'exact_replay');
});

test('two-tier (integration): a safe repeat of a once-confirmed exact phrase does not pay for a full semantic call again', async () => {
  await withHarness(async harness => {
    // Seed with the SAME low evidence/confidence a fresh write produces --
    // proving this is Tier A doing the work, not pre-accumulated trust.
    installConceptMemoryMock(harness, [seededConcept({ confidence: 0.7, evidenceCount: 1 })]);
    const gid = guestId('phase3-two-tier-exact-repeat');
    const turn1 = await processThongthaiChatCore(brainRequest('อยากขี่ม้าพรุ่งนี้ เอาภาราดร', gid, 'web'), 'evt-0');
    assert.equal(turn1.statusCode, 200);
    const callsAfterTurn1 = harness.modelCallCount();

    // Same underlying sentence as the seeded exemplar, only a trailing
    // politeness particle differs -- normalizes to an EXACT replay.
    const turn2 = await processThongthaiChatCore(brainRequest('มากับแฟนนะครับ', gid, 'web', [
      { role: 'user', content: 'อยากขี่ม้าพรุ่งนี้ เอาภาราดร' },
      { role: 'assistant', content: msg(turn1.payload) },
    ]), 'evt-1');
    assert.equal(turn2.statusCode, 200);
    assert.equal(
      harness.modelCallCount(), callsAfterTurn1,
      'an exact replay of a once-confirmed phrase must resolve at zero cost, without waiting for accumulated evidence',
    );
  });
});

test('two-tier (unit): a fuzzy (non-exact) variant still requires the stronger Tier B trust bar, even against the same low-evidence row', () => {
  const freshlyLearned = seededConcept({ confidence: 0.7, evidenceCount: 1 });
  // "มากับแฟนสองคน" is a genuinely different sentence from the seeded
  // "มากับแฟน" (an appended detail) -- not an exact replay, so it must NOT
  // benefit from Tier A's fast path.
  const match = matchLearnedConcept('มากับแฟนสองคน', [freshlyLearned]);
  assert.equal(
    match, null,
    'a fuzzy variant must still require Tier B\'s higher confidence/evidence bar, never Tier A\'s',
  );
});

test('two-tier (unit): one wrong/low-evidence inference can never gain transaction authority, even under Tier A\'s fast path', () => {
  // Even a Tier-A-eligible row (immediately trusted after one confirmation)
  // can only ever resolve to entities.companion -- there is no code path
  // from a match, of either tier, to an action/domain/transaction field.
  const tierAEligible = seededConcept({ confidence: 0.7, evidenceCount: MIN_TIER_A_EVIDENCE_COUNT });
  const match = matchLearnedConcept('มากับแฟน', [tierAEligible]);
  assert.ok(match, 'setup: this row must be Tier-A-eligible for the assertion below to be meaningful');
  assert.equal(match!.tier, 'exact_replay');
  const entities = safeConceptEntities(match!.conceptKey);
  assert.deepEqual(
    Object.keys(entities), ['companion'],
    'a Tier A match can only ever produce entities.companion -- never an action, domain, or transaction field',
  );
});

test('privacy (integration): a personal name attached to an otherwise-clean companion statement is never persisted', async () => {
  await withHarness(async harness => {
    const { posts, patches } = installConceptMemoryMock(harness, []);
    const gid = guestId('phase3-privacy-personal-name');
    const turn1 = await processThongthaiChatCore(brainRequest('อยากขี่ม้าพรุ่งนี้ เอาภาราดร', gid, 'web'), 'evt-0');
    assert.equal(turn1.statusCode, 200);

    (harness.programGeminiReply as unknown as (reply: Record<string, unknown>) => void)({
      domain: 'activity', intent: 'companion_statement', action: 'provide_information',
      entities: { companion: 'partner' }, references: [], constraints: [],
      confidence: 0.95, needsClarification: false,
    });
    // "มากับแฟนชื่อหนิง" -- comes with my partner named Ning. No phone/email/
    // URL/handle, so containsDirectIdentifier alone would miss this.
    await processThongthaiChatCore(brainRequest('มากับแฟนชื่อหนิง', gid, 'web', [
      { role: 'user', content: 'อยากขี่ม้าพรุ่งนี้ เอาภาราดร' },
      { role: 'assistant', content: msg(turn1.payload) },
    ]), 'evt-1');

    assert.equal(posts.length, 0, 'a message carrying a personal name must never be persisted as a learned exemplar');
    assert.equal(patches.length, 0, 'a rejected candidate must not reinforce any existing row either');
  });
});

test('privacy (integration): an address/location detail attached to a companion statement is never persisted', async () => {
  await withHarness(async harness => {
    const { posts, patches } = installConceptMemoryMock(harness, []);
    const gid = guestId('phase3-privacy-address');
    const turn1 = await processThongthaiChatCore(brainRequest('อยากขี่ม้าพรุ่งนี้ เอาภาราดร', gid, 'web'), 'evt-0');
    assert.equal(turn1.statusCode, 200);

    (harness.programGeminiReply as unknown as (reply: Record<string, unknown>) => void)({
      domain: 'activity', intent: 'companion_statement', action: 'provide_information',
      entities: { companion: 'partner' }, references: [], constraints: [],
      confidence: 0.95, needsClarification: false,
    });
    await processThongthaiChatCore(brainRequest('มากับแฟนบ้านเลขที่55', gid, 'web', [
      { role: 'user', content: 'อยากขี่ม้าพรุ่งนี้ เอาภาราดร' },
      { role: 'assistant', content: msg(turn1.payload) },
    ]), 'evt-1');

    assert.equal(posts.length, 0, 'a message carrying an address/house-number detail must never be persisted');
    assert.equal(patches.length, 0, 'a rejected candidate must not reinforce any existing row either');
  });
});

test('privacy (integration): mixed personal detail + companion statement is never persisted, despite containing recognized companion vocabulary', async () => {
  await withHarness(async harness => {
    const { posts, patches } = installConceptMemoryMock(harness, []);
    const gid = guestId('phase3-privacy-mixed');
    const turn1 = await processThongthaiChatCore(brainRequest('อยากขี่ม้าพรุ่งนี้ เอาภาราดร', gid, 'web'), 'evt-0');
    assert.equal(turn1.statusCode, 200);

    (harness.programGeminiReply as unknown as (reply: Record<string, unknown>) => void)({
      domain: 'activity', intent: 'companion_statement', action: 'provide_information',
      entities: { companion: 'family' }, references: [], constraints: [],
      confidence: 0.95, needsClarification: false,
    });
    // Contains recognized companion tokens ("แฟน", "ลูก", "สองคน") AND an
    // unrecognized personal detail ("ชื่อหนิงและ") -- the recognized tokens
    // must not "dilute" the reject; any residual at all is a reject.
    await processThongthaiChatCore(brainRequest('มากับแฟนชื่อหนิงและลูกสองคน', gid, 'web', [
      { role: 'user', content: 'อยากขี่ม้าพรุ่งนี้ เอาภาราดร' },
      { role: 'assistant', content: msg(turn1.payload) },
    ]), 'evt-1');

    assert.equal(posts.length, 0, 'recognized companion vocabulary must not offset unrecognized personal content');
    assert.equal(patches.length, 0, 'a rejected candidate must not reinforce any existing row either');
  });
});

test('privacy (integration): re-verify phone/email/handle is still rejected under the combined boundary', async () => {
  await withHarness(async harness => {
    const { posts, patches } = installConceptMemoryMock(harness, []);
    const gid = guestId('phase3-privacy-reverify-identifier');
    const turn1 = await processThongthaiChatCore(brainRequest('อยากขี่ม้าพรุ่งนี้ เอาภาราดร', gid, 'web'), 'evt-0');
    assert.equal(turn1.statusCode, 200);

    (harness.programGeminiReply as unknown as (reply: Record<string, unknown>) => void)({
      domain: 'activity', intent: 'companion_statement', action: 'provide_information',
      entities: { companion: 'partner' }, references: [], constraints: [],
      confidence: 0.95, needsClarification: false,
    });
    await processThongthaiChatCore(brainRequest('มากับแฟน @nong123', gid, 'web', [
      { role: 'user', content: 'อยากขี่ม้าพรุ่งนี้ เอาภาราดร' },
      { role: 'assistant', content: msg(turn1.payload) },
    ]), 'evt-1');

    assert.equal(posts.length, 0, 'a handle must still be rejected under the combined direct-identifier + residual boundary');
    assert.equal(patches.length, 0, 'a rejected candidate must not reinforce any existing row either');
  });
});

test('review verification: a retracted concept never matches (not just superseded)', () => {
  const retracted = seededConcept({ status: 'retracted' });
  assert.equal(matchLearnedConcept('มากับแฟน', [retracted]), null);
});

test('review verification: after a confirmed contradiction retracts a row, a later similar message correctly fails safe to the real model, never to the stale answer', async () => {
  await withHarness(async harness => {
    // Confidence deliberately BELOW Tier A's 0.7 bar -- see the identical
    // note in the "cross-concept contradiction retracts the stale row" test
    // above: otherwise the READ path's own exact-replay fast path would
    // resolve this turn before the model (and thus the contradiction check)
    // ever ran, which would make this test about the read path instead.
    const { patches } = installConceptMemoryMock(harness, [seededConcept({ evidenceCount: 1, confidence: 0.6 })]);
    const gid = guestId('phase3-review-failsafe-after-retraction');
    const turn1 = await processThongthaiChatCore(brainRequest('อยากขี่ม้าพรุ่งนี้ เอาภาราดร', gid, 'web'), 'evt-0');
    assert.equal(turn1.statusCode, 200);

    (harness.programGeminiReply as unknown as (reply: Record<string, unknown>) => void)({
      domain: 'activity', intent: 'companion_statement', action: 'provide_information',
      entities: { companion: 'solo' }, references: [], constraints: [],
      confidence: 0.93, needsClarification: false,
    });
    await processThongthaiChatCore(brainRequest('มากับแฟน', gid, 'web', [
      { role: 'user', content: 'อยากขี่ม้าพรุ่งนี้ เอาภาราดร' },
      { role: 'assistant', content: msg(turn1.payload) },
    ]), 'evt-1');
    assert.ok(patches.some(patch => patch.status === 'retracted'), 'setup: the companion_partner row must have been retracted');

    // A THIRD customer's turn, textually close to the now-retracted
    // exemplar. It must never be answered from the stale (retracted) row --
    // it must fail safe to a fresh real model attempt.
    const turn2 = await processThongthaiChatCore(brainRequest('อยากขี่ม้าพรุ่งนี้ เอาภาราดร', gid, 'web'), 'evt-2');
    assert.equal(turn2.statusCode, 200);
    const callsAfterTurn2 = harness.modelCallCount();
    const turn3 = await processThongthaiChatCore(brainRequest('มากับแฟน', gid, 'web', [
      { role: 'user', content: 'อยากขี่ม้าพรุ่งนี้ เอาภาราดร' },
      { role: 'assistant', content: msg(turn2.payload) },
    ]), 'evt-3');
    assert.equal(turn3.statusCode, 200);
    assert.ok(
      harness.modelCallCount() > callsAfterTurn2,
      'a retracted concept must never answer a matching message -- it must fail safe to the real semantic supervisor',
    );
  });
});
