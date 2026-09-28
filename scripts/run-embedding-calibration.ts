// Phase 3 completion -- semantic generalization architecture decision.
//
// NOT part of npm test / normal CI, and does NOT touch any schema, table,
// or migration. This is a READ-ONLY calibration: it calls the real OpenAI
// embeddings endpoint for a small, fixed set of Thai phrase pairs relevant
// to the companion concept, and reports cosine similarity, so the
// embedding-vs-surface-matching decision in THONGTHAI_KERNEL_V2_HANDOFF.md
// is calibrated empirically (matching this repo's own established
// discipline -- see MIN_SIMILARITY and the negation veto in
// _semantic-concept-memory.ts, both calibrated the same way) rather than
// asserted from first principles alone.
//
// Cost: text-embedding-3-small at ~$0.02/1M tokens. This script embeds
// roughly a dozen short Thai phrases (well under 200 tokens total) -- a
// small fraction of a cent, not a real budget concern.
//
// Usage: OPENAI_API_KEY=... npx tsx scripts/run-embedding-calibration.ts
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const EMBEDDING_MODEL = process.env.THONGTHAI_EMBEDDING_MODEL ?? 'text-embedding-3-small';

if (!OPENAI_API_KEY) {
  console.error('EMBEDDING_CALIBRATION_NOT_RUN: OPENAI_API_KEY is required.');
  process.exit(2);
}

type Pair = {
  id: string;
  a: string;
  b: string;
  /** What this pair is meant to prove. */
  expectation: 'same_concept_different_vocabulary' | 'different_concept' | 'negation_mismatch' | 'unrelated_sentence';
};

// The companion concept's own worked examples from the owner's mandate,
// plus controls: a different-concept pair (must NOT look similar), a
// negation pair (the known hard case surface-matching already needed a
// structural veto for -- embeddings must be checked against this too, not
// assumed safe), and a totally unrelated sentence (must score lowest of all).
const PAIRS: Pair[] = [
  { id: 'companion-partner-synonym', a: 'มากับแฟน', b: 'มากับคนรู้ใจ', expectation: 'same_concept_different_vocabulary' },
  { id: 'companion-partner-synonym-2', a: 'มากับแฟน', b: 'มาด้วยกันกับคู่รัก', expectation: 'same_concept_different_vocabulary' },
  { id: 'companion-partner-vs-family', a: 'มากับแฟน', b: 'มากับครอบครัว', expectation: 'different_concept' },
  { id: 'companion-partner-vs-friends', a: 'มากับแฟน', b: 'มากับเพื่อนกลุ่มใหญ่', expectation: 'different_concept' },
  { id: 'companion-negation', a: 'มากับแฟน', b: 'ไม่ได้มากับแฟน', expectation: 'negation_mismatch' },
  // Content-span variants: the SAME companion pairs above, but with the
  // shared "มากับ..." sentence scaffolding stripped, embedding just the
  // content-bearing noun/noun-phrase. Tests the working hypothesis (see
  // THONGTHAI_KERNEL_V2_HANDOFF.md, PR #221/#223) that the full-sentence
  // template dominates the embedding more than the one differing word does.
  { id: 'content-span-partner-synonym', a: 'แฟน', b: 'คนรู้ใจ', expectation: 'same_concept_different_vocabulary' },
  { id: 'content-span-partner-synonym-2', a: 'แฟน', b: 'คู่รัก', expectation: 'same_concept_different_vocabulary' },
  { id: 'content-span-partner-vs-family', a: 'แฟน', b: 'ครอบครัว', expectation: 'different_concept' },
  { id: 'content-span-partner-vs-friends', a: 'แฟน', b: 'เพื่อนกลุ่มใหญ่', expectation: 'different_concept' },
  { id: 'consider-only-synonym', a: 'เอาอันนี้ไว้ก่อน', b: 'สนใจอันนี้อยู่ ขอจำไว้ก่อน', expectation: 'same_concept_different_vocabulary' },
  { id: 'consider-vs-relaxed-pace', a: 'เอาอันนี้ไว้ก่อน', b: 'ไม่อยากเหนื่อย ขอชิลๆ', expectation: 'different_concept' },
  { id: 'companion-vs-unrelated', a: 'มากับแฟน', b: 'พรุ่งนี้มีห้องว่างไหม', expectation: 'unrelated_sentence' },
];

async function embed(text: string): Promise<number[]> {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: text }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`embeddings request failed ${response.status}: ${body.slice(0, 300)}`);
  }
  const json = await response.json() as { data: Array<{ embedding: number[] }> };
  const vector = json.data[0]?.embedding;
  if (!vector) throw new Error('embeddings response missing vector');
  return vector;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    magA += a[i]! * a[i]!;
    magB += b[i]! * b[i]!;
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

async function main() {
  const cache = new Map<string, number[]>();
  const embedCached = async (text: string): Promise<number[]> => {
    const existing = cache.get(text);
    if (existing) return existing;
    const vector = await embed(text);
    cache.set(text, vector);
    return vector;
  };

  const results: Array<{ id: string; a: string; b: string; expectation: string; similarity: number }> = [];
  for (const pair of PAIRS) {
    // eslint-disable-next-line no-await-in-loop
    const [vecA, vecB] = await Promise.all([embedCached(pair.a), embedCached(pair.b)]);
    const similarity = cosineSimilarity(vecA, vecB);
    results.push({ id: pair.id, a: pair.a, b: pair.b, expectation: pair.expectation, similarity });
    console.log(JSON.stringify({ id: pair.id, a: pair.a, b: pair.b, expectation: pair.expectation, similarity }));
  }

  const byExpectation = (expectation: Pair['expectation']) =>
    results.filter(r => r.expectation === expectation).map(r => r.similarity);
  const summary = {
    kind: 'EMBEDDING_CALIBRATION_RESULT',
    model: EMBEDDING_MODEL,
    same_concept_different_vocabulary: byExpectation('same_concept_different_vocabulary'),
    different_concept: byExpectation('different_concept'),
    negation_mismatch: byExpectation('negation_mismatch'),
    unrelated_sentence: byExpectation('unrelated_sentence'),
  };
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(error => {
  console.error('EMBEDDING_CALIBRATION_CRASHED', error instanceof Error ? error.message : error);
  process.exit(1);
});
