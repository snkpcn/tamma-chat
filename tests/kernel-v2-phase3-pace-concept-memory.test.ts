// Kernel V2 Phase 3 increment 2: semantic concept memory, pace class.
//
// Direct Semantic Supervisor Learning, extended to a SECOND closed concept
// class using the exact same reviewed architecture as increment 1
// (companion) -- see _semantic-concept-memory.ts's own header for the full
// design rationale, which is unchanged here. This file proves:
//  1. Pace evidence is extracted from the SAME confirmed model turn
//     increment 1 already uses -- no second paid call.
//  2. Ambiguity is preserved, not over-canonicalized: a value outside the
//     closed pace vocabulary (e.g. the model hedging with something other
//     than relaxed/moderate/intense) is never learned.
//  3. The privacy boundary, negation veto, contradiction/demotion, and
//     transaction-safety closure all generalize to this second concept
//     class without being re-implemented per class.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeForConceptMatching, conceptSimilarity, matchLearnedConcept,
  safeConceptEntities, paceConceptKeyForValue, isPaceConceptKey,
  MIN_SIMILARITY, type StoredSemanticConcept,
} from '../netlify/functions/_semantic-concept-memory';
import { withHarness, guestId, brainRequest, type Harness } from './helpers/canonical-core-harness';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';

function seededPaceConcept(overrides: Partial<StoredSemanticConcept> = {}): StoredSemanticConcept {
  return {
    id: 'pace-concept-1',
    conceptKey: 'pace_relaxed',
    normalizedSignature: normalizeForConceptMatching('ไม่อยากเหนื่อย'),
    confidence: 0.9,
    evidenceCount: 5,
    contradictionCount: 0,
    status: 'active',
    ...overrides,
  };
}

test('unit: normalizeForConceptMatching strips ๆ repetition marks (pace phrases use them heavily)', () => {
  assert.equal(normalizeForConceptMatching('ชิล ๆ'), normalizeForConceptMatching('ชิล'));
  assert.equal(normalizeForConceptMatching('เบาๆหน่อย'), normalizeForConceptMatching('เบาหน่อย'));
});

test('unit: conceptSimilarity generalizes across a near-identical unseen pace variant', () => {
  const base = normalizeForConceptMatching('ไม่อยากเหนื่อย');
  const nearVariant = normalizeForConceptMatching('วันนี้ไม่อยากเหนื่อยมาก');
  assert.ok(
    conceptSimilarity(base, nearVariant) >= 0.6,
    'an appended-detail variant of a confirmed pace exemplar must score high enough to be trusted',
  );
});

test('unit: conceptSimilarity honestly does NOT bridge a different pace vocabulary choice', () => {
  const base = normalizeForConceptMatching('ไม่อยากเหนื่อย');
  // "ขอเบาๆ" (want it light) uses entirely different characters than
  // "ไม่อยากเหนื่อย" (don't want to be tired) -- same honest surface-matching
  // limit as companion's "แฟน"/"คนรู้ใจ" case.
  const differentVocabulary = normalizeForConceptMatching('ขอเบาๆ');
  assert.ok(
    conceptSimilarity(base, differentVocabulary) < MIN_SIMILARITY,
    'a genuinely different pace phrasing must NOT be treated as a confident match from a single exemplar',
  );
});

test('unit: paceConceptKeyForValue / isPaceConceptKey only recognize the closed vocabulary', () => {
  assert.equal(paceConceptKeyForValue('relaxed'), 'pace_relaxed');
  assert.equal(paceConceptKeyForValue('moderate'), 'pace_moderate');
  assert.equal(paceConceptKeyForValue('intense'), 'pace_intense');
  assert.equal(paceConceptKeyForValue('chill'), null, 'a value outside the closed vocabulary must never resolve');
  assert.equal(paceConceptKeyForValue('close_person'), null, 'a companion-domain value must never leak into pace');
  assert.equal(isPaceConceptKey('pace_relaxed'), true);
  assert.equal(isPaceConceptKey('companion_partner'), false);
});

test('unit: safeConceptEntities can only ever produce entities.pace for a pace key -- closed by construction', () => {
  for (const key of ['pace_relaxed', 'pace_moderate', 'pace_intense'] as const) {
    const entities = safeConceptEntities(key);
    assert.deepEqual(Object.keys(entities), ['pace']);
  }
});

test('unit: matchLearnedConcept Tier A (exact replay) trusts a pace concept after a single confirmation', () => {
  const freshlyLearned = seededPaceConcept({ confidence: 0.7, evidenceCount: 1 });
  const match = matchLearnedConcept('ไม่อยากเหนื่อยค่ะ', [freshlyLearned]);
  assert.ok(match, 'an exact (post-normalization) replay must be trusted after one confirmation');
  assert.equal(match!.tier, 'exact_replay');
  assert.equal(match!.conceptKey, 'pace_relaxed');
});

test('unit: matchLearnedConcept Tier B (fuzzy) still requires the stronger trust bar for pace', () => {
  const freshlyLearned = seededPaceConcept({ confidence: 0.7, evidenceCount: 1 });
  const match = matchLearnedConcept('วันนี้ไม่อยากเหนื่อยมาก', [freshlyLearned]);
  assert.equal(match, null, 'a fuzzy variant must not benefit from Tier A\'s fast path');
});

test('unit: matchLearnedConcept never fires on a long or unrelated message for pace', () => {
  const concept = seededPaceConcept();
  assert.equal(
    matchLearnedConcept('อยากขี่ม้าพรุ่งนี้ช่วงเย็น มากับแฟนสองคน แต่ไม่เอาทองไทยนะ ไม่อยากเหนื่อยด้วย', [concept]),
    null,
    'a long compound sentence must never be attributed to one learned pace fragment',
  );
  assert.equal(matchLearnedConcept('พรุ่งนี้มีห้องว่างไหม', [concept]), null);
});

test('acceptance: a negated pace phrase never matches a superficially similar confirmed concept', () => {
  const concept = seededPaceConcept();
  // "อยากเหนื่อย" (DO want to be tired -- i.e. wants intensity) is a near-
  // opposite of "ไม่อยากเหนื่อย" despite sharing almost every character.
  assert.equal(matchLearnedConcept('อยากเหนื่อย', [concept]), null);
});

function msg(payload: unknown): string {
  return String((payload as { message: string }).message);
}

/** Same pattern as the companion test file's own helper -- duplicated
 *  rather than shared/exported, matching this repo's own convention of not
 *  modifying the shared harness file for a single test file's needs. */
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
      if (options.writeDelayMs === Infinity) return;
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

test('integration: an UNSEEN near-identical pace variant resolves at zero cost, mid an in-progress task', async () => {
  await withHarness(async harness => {
    installConceptMemoryMock(harness, [seededPaceConcept()]);
    const gid = guestId('phase3-pace-unseen-variant');
    const turn1 = await processThongthaiChatCore(brainRequest('อยากขี่ม้าพรุ่งนี้ เอาภาราดร', gid, 'web'), 'evt-0');
    assert.equal(turn1.statusCode, 200);
    const callsAfterTurn1 = harness.modelCallCount();

    const turn2 = await processThongthaiChatCore(brainRequest('วันนี้ไม่อยากเหนื่อยมาก', gid, 'web', [
      { role: 'user', content: 'อยากขี่ม้าพรุ่งนี้ เอาภาราดร' },
      { role: 'assistant', content: msg(turn1.payload) },
    ]), 'evt-1');
    assert.equal(turn2.statusCode, 200);
    assert.equal(
      harness.modelCallCount(), callsAfterTurn1,
      'a genuinely learned, high-confidence pace concept must resolve without paying for another model call',
    );
  });
});

test('integration: a different pace vocabulary choice correctly still requires the real model (honest limit)', async () => {
  await withHarness(async harness => {
    installConceptMemoryMock(harness, [seededPaceConcept()]);
    const gid = guestId('phase3-pace-different-vocabulary');
    const turn1 = await processThongthaiChatCore(brainRequest('อยากขี่ม้าพรุ่งนี้ เอาภาราดร', gid, 'web'), 'evt-0');
    assert.equal(turn1.statusCode, 200);
    const callsAfterTurn1 = harness.modelCallCount();

    const turn2 = await processThongthaiChatCore(brainRequest('ขอเบาๆ', gid, 'web', [
      { role: 'user', content: 'อยากขี่ม้าพรุ่งนี้ เอาภาราดร' },
      { role: 'assistant', content: msg(turn1.payload) },
    ]), 'evt-1');
    assert.equal(turn2.statusCode, 200);
    assert.ok(
      harness.modelCallCount() > callsAfterTurn1,
      'an unmatched, genuinely different pace phrasing must still be attempted by the real semantic path',
    );
  });
});

test('integration: the write path accumulates a genuinely new confirmed pace exemplar, extracted from the SAME confirmed turn (no second call)', async () => {
  await withHarness(async harness => {
    const { posts } = installConceptMemoryMock(harness, [seededPaceConcept()]);
    const gid = guestId('phase3-pace-write-path-new-exemplar');
    const turn1 = await processThongthaiChatCore(brainRequest('อยากขี่ม้าพรุ่งนี้ เอาภาราดร', gid, 'web'), 'evt-0');
    assert.equal(turn1.statusCode, 200);
    const callsBeforeLearning = harness.modelCallCount();

    (harness.programGeminiReply as unknown as (reply: Record<string, unknown>) => void)({
      domain: 'activity',
      intent: 'pace_statement',
      action: 'provide_information',
      entities: { pace: 'relaxed' },
      references: [],
      constraints: [],
      confidence: 0.92,
      needsClarification: false,
    });

    await processThongthaiChatCore(brainRequest('ขอเบาๆ', gid, 'web', [
      { role: 'user', content: 'อยากขี่ม้าพรุ่งนี้ เอาภาราดร' },
      { role: 'assistant', content: msg(turn1.payload) },
    ]), 'evt-1');

    // Exactly ONE paid call was used for this turn (the real semantic
    // supervisor call the write path reuses) -- proving the write path
    // extracts evidence from that SAME call, never a second one.
    assert.equal(harness.modelCallCount(), callsBeforeLearning + 1);
    assert.equal(posts.length, 1, 'a newly confirmed, genuinely different pace exemplar must be recorded exactly once');
    assert.equal(posts[0]!.concept_key, 'pace_relaxed');
    assert.notEqual(
      posts[0]!.normalized_signature, seededPaceConcept().normalizedSignature,
      'the new exemplar must be stored as its OWN signature, never silently merged into the old one',
    );
  });
});

test('ambiguity discipline: a companion value OUTSIDE the closed vocabulary is never learned -- the mandate\'s core correction', async () => {
  await withHarness(async harness => {
    // This is the exact scenario the owner flagged: the real supervisor
    // judges "มากับคนรู้ใจ" as genuinely ambiguous and returns something
    // OTHER than one of the closed companion values (partner/family/
    // friends/solo) -- e.g. a broader, hedged label. Nothing must be
    // learned from this, because companionConceptKeyForValue only
    // recognizes the closed set; the module must never widen or guess a
    // stronger label than the supervisor itself committed to.
    const { posts, patches } = installConceptMemoryMock(harness, []);
    const gid = guestId('phase3-ambiguity-no-over-canonicalization');
    const turn1 = await processThongthaiChatCore(brainRequest('อยากขี่ม้าพรุ่งนี้ เอาภาราดร', gid, 'web'), 'evt-0');
    assert.equal(turn1.statusCode, 200);

    (harness.programGeminiReply as unknown as (reply: Record<string, unknown>) => void)({
      domain: 'activity',
      intent: 'companion_statement',
      action: 'provide_information',
      // Deliberately NOT one of partner/family/friends/solo -- the
      // supervisor's own honest hedge for a genuinely ambiguous phrase.
      entities: { companion: 'close_person', relationshipSpecificity: 'ambiguous' },
      references: [],
      constraints: [],
      confidence: 0.9,
      needsClarification: false,
    });

    await processThongthaiChatCore(brainRequest('มากับคนรู้ใจ', gid, 'web', [
      { role: 'user', content: 'อยากขี่ม้าพรุ่งนี้ เอาภาราดร' },
      { role: 'assistant', content: msg(turn1.payload) },
    ]), 'evt-1');

    assert.equal(posts.length, 0, 'an out-of-vocabulary (ambiguous) companion value must never be learned as a strong global rule');
    assert.equal(patches.length, 0, 'an ambiguous value must not reinforce any existing row either');
  });
});

test('acceptance D (integration): a confirmed pace contradiction against a DIFFERENT concept (including companion) retracts the stale row', async () => {
  await withHarness(async harness => {
    // Proves the SHARED cross-concept-class contradiction check (one table,
    // one query across ALL active rows regardless of class) still works
    // once a second concept class exists -- a companion exemplar can be
    // contradicted by a confirmed pace exemplar whose surface form happens
    // to resemble it closely, and vice versa.
    const staleCompanion = seededPaceConcept({
      id: 'stale-companion-row',
      conceptKey: 'companion_partner',
      normalizedSignature: normalizeForConceptMatching('ไม่อยากเหนื่อย'),
      evidenceCount: 1,
      confidence: 0.6,
    });
    const { patches } = installConceptMemoryMock(harness, [staleCompanion]);
    const gid = guestId('phase3-pace-cross-class-contradiction');
    const turn1 = await processThongthaiChatCore(brainRequest('อยากขี่ม้าพรุ่งนี้ เอาภาราดร', gid, 'web'), 'evt-0');
    assert.equal(turn1.statusCode, 200);

    (harness.programGeminiReply as unknown as (reply: Record<string, unknown>) => void)({
      domain: 'activity',
      intent: 'pace_statement',
      action: 'provide_information',
      entities: { pace: 'relaxed' },
      references: [],
      constraints: [],
      confidence: 0.93,
      needsClarification: false,
    });
    // Deliberately the SAME text as the stale companion row -- isolates the
    // contradiction mechanism from the similarity threshold.
    await processThongthaiChatCore(brainRequest('ไม่อยากเหนื่อย', gid, 'web', [
      { role: 'user', content: 'อยากขี่ม้าพรุ่งนี้ เอาภาราดร' },
      { role: 'assistant', content: msg(turn1.payload) },
    ]), 'evt-1');

    const retraction = patches.find(patch => patch.status === 'retracted');
    assert.ok(retraction, 'the contradicted stale companion row must be retracted by a confirmed pace exemplar, proving the shared check generalizes');
  });
});

test('privacy (integration): a pace statement carrying a personal name is never persisted', async () => {
  await withHarness(async harness => {
    const { posts, patches } = installConceptMemoryMock(harness, []);
    const gid = guestId('phase3-pace-privacy-personal-name');
    const turn1 = await processThongthaiChatCore(brainRequest('อยากขี่ม้าพรุ่งนี้ เอาภาราดร', gid, 'web'), 'evt-0');
    assert.equal(turn1.statusCode, 200);

    (harness.programGeminiReply as unknown as (reply: Record<string, unknown>) => void)({
      domain: 'activity',
      intent: 'pace_statement',
      action: 'provide_information',
      entities: { pace: 'relaxed' },
      references: [],
      constraints: [],
      confidence: 0.95,
      needsClarification: false,
    });
    // "ไม่อยากเหนื่อยเหมือนหนิง" -- don't want to be tired like Ning. No
    // phone/email/URL/handle, so containsDirectIdentifier alone would miss
    // the name.
    await processThongthaiChatCore(brainRequest('ไม่อยากเหนื่อยเหมือนหนิง', gid, 'web', [
      { role: 'user', content: 'อยากขี่ม้าพรุ่งนี้ เอาภาราดร' },
      { role: 'assistant', content: msg(turn1.payload) },
    ]), 'evt-1');

    assert.equal(posts.length, 0, 'a pace statement carrying a personal name must never be persisted');
    assert.equal(patches.length, 0);
  });
});

test('negative control: a real commit/booking message is never routed through the fuzzy pace matcher', async () => {
  await withHarness(async harness => {
    installConceptMemoryMock(harness, [seededPaceConcept({ normalizedSignature: normalizeForConceptMatching('จองเลยครับ') })]);
    const gid = guestId('phase3-pace-negative-control-commit');
    const r = await processThongthaiChatCore(brainRequest('จองเลยครับ ยืนยันการจอง', gid, 'web'), 'evt-0');
    assert.equal(r.statusCode, 200);
    assert.doesNotMatch(msg(r.payload), /จองสำเร็จ|เลขที่จอง/u, 'a fuzzy-matched pace concept must never be able to execute or confirm a transaction by itself');
  });
});

test('review verification: a retracted pace concept never matches (not just superseded)', () => {
  const retracted = seededPaceConcept({ status: 'retracted' });
  assert.equal(matchLearnedConcept('ไม่อยากเหนื่อย', [retracted]), null);
});
