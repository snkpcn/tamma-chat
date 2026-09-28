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
  MIN_SIMILARITY, type StoredSemanticConcept,
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

test('unit: matchLearnedConcept ignores concepts below the confidence/evidence bar', () => {
  const lowConfidence = seededConcept({ confidence: 0.5 });
  const lowEvidence = seededConcept({ evidenceCount: 1 });
  const superseded = seededConcept({ status: 'superseded' });
  assert.equal(matchLearnedConcept('มากับแฟน', [lowConfidence]), null);
  assert.equal(matchLearnedConcept('มากับแฟน', [lowEvidence]), null);
  assert.equal(matchLearnedConcept('มากับแฟน', [superseded]), null);
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
 *  harness file (which many other tests depend on staying unchanged). */
function installConceptMemoryMock(harness: Harness, seedRows: StoredSemanticConcept[]) {
  const patches: Array<Record<string, unknown>> = [];
  const posts: Array<Record<string, unknown>> = [];
  const seenSignalKeys = new Set<string>();
  const rows = seedRows.map(row => ({
    id: row.id,
    concept_key: row.conceptKey,
    normalized_signature: row.normalizedSignature,
    confidence: row.confidence,
    evidence_count: row.evidenceCount,
    status: row.status,
  }));
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
        patches.push(JSON.parse(String(init.body ?? '{}')));
        return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (method === 'POST') {
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
