// Kernel V2 Phase 3 increment 1 -- Semantic Learning + Cost Efficiency.
//
// Owner goal: "If Thongthai does not confidently understand a human-language
// pattern, ask OpenAI once when needed, obtain canonical meaning, then safely
// learn the semantic concept so similar future language can often be
// understood without paying again. But never create a brittle exact-sentence
// dictionary, and never let self-learning make Thongthai confidently wrong."
//
// SCOPE OF THIS INCREMENT (deliberately narrow -- see
// THONGTHAI_KERNEL_V2_HANDOFF.md for what remains):
//
// This module only learns COMPANION context ("มากับแฟน" -> companion:
// 'partner'), the worked example from the owner's own mandate. Pace and
// consider-only markers are explicitly deferred to a later increment rather
// than bundled in here unreviewed.
//
// SAFETY BY CONSTRUCTION, not by runtime checking alone:
// - SAFE_CONCEPT_OUTCOMES is a CLOSED map. A matched concept can only ever
//   contribute entities.companion, never a domain, an action, or anything
//   resembling book/order/confirm/modify/cancel/correct_previous. There is no
//   code path in this file that can produce a mutating action -- Phase 3's
//   "never turn fuzzy learned semantics into a transaction" rule is enforced
//   by this module simply not having a way to emit one.
// - Matching is NEVER exact-sentence lookup. normalizeForConceptMatching
//   strips punctuation/politeness particles, and conceptSimilarity scores
//   bounded edit distance + order-independent bigram overlap -- the same
//   generalization discipline _experience-discovery.ts already uses for its
//   own typo-tolerant matching (editDistanceWithin), not a growing table of
//   literal phrases.
// - HONESTY, not oversell: this surface-form matching reliably catches a
//   typo, an appended detail, or a reordering of an ALREADY-CONFIRMED
//   exemplar. It does NOT bridge a genuine vocabulary substitution with no
//   shared characters (e.g. "แฟน" vs "คนรู้ใจ" -- both mean "partner" but
//   share no text) -- that is real semantic/lexical generalization, which
//   needs embedding similarity (pgvector), deliberately NOT part of this
//   increment (flagged separately in THONGTHAI_KERNEL_V2_HANDOFF.md). What
//   this DOES achieve: once OpenAI has confirmed ANY phrasing of a concept
//   once, near-repeats of THAT phrasing become free, and each genuinely new
//   phrasing OpenAI confirms is remembered as its own additional exemplar
//   (bounded per concept) -- coverage grows from real confirmed usage, never
//   from a hand-written synonym table.
// - Concepts are learned ONLY from turns the real OpenAI semantic supervisor
//   already confirmed with high confidence (see the write-path hook in
//   resolveSemanticTurn, _thongthai-one-mind-orchestrator.ts) -- this module
//   itself never invents a concept from its own fuzzy match.
import { createHash } from 'node:crypto';

export type CompanionConceptKey =
  | 'companion_partner'
  | 'companion_family'
  | 'companion_friends'
  | 'companion_solo';

const COMPANION_VALUE_BY_CONCEPT_KEY: Readonly<Record<CompanionConceptKey, string>> = {
  companion_partner: 'partner',
  companion_family: 'family',
  companion_friends: 'friends',
  companion_solo: 'solo',
};

export function isCompanionConceptKey(value: string): value is CompanionConceptKey {
  return Object.prototype.hasOwnProperty.call(COMPANION_VALUE_BY_CONCEPT_KEY, value);
}

/** The ONLY outcome a matched concept may ever produce. Closed by
 *  construction: there is no action/domain field here for a bad match to
 *  escalate into. */
export function safeConceptEntities(conceptKey: CompanionConceptKey): Record<string, string> {
  return { companion: COMPANION_VALUE_BY_CONCEPT_KEY[conceptKey] };
}

export function companionConceptKeyForValue(value: string): CompanionConceptKey | null {
  const entry = (Object.entries(COMPANION_VALUE_BY_CONCEPT_KEY) as Array<[CompanionConceptKey, string]>)
    .find(([, mapped]) => mapped === value);
  return entry ? entry[0] : null;
}

// A short, closed set of Thai politeness/filler particles this module strips
// before matching -- the SAME kind of structural normalization
// _experience-discovery.ts's normalizeThaiDiscoveryText already does for its
// own matcher, not a phrase table for any one sentence.
const POLITENESS_SUFFIX = /(?:ครับ|คับ|ค่ะ|คะ|จ้า|จ๊ะ|นะครับ|นะคะ|นะ|ด้วย|น่ะ)$/gu;
const PUNCTUATION_AND_SPACE = /[!?！？….,，。/\\|()[\]{}"'"''：:_\-\s]+/gu;

export function normalizeForConceptMatching(message: string): string {
  let text = String(message ?? '').normalize('NFC').trim();
  // Strip trailing politeness particles repeatedly (e.g. "...ด้วยนะครับ").
  for (let i = 0; i < 3; i += 1) {
    const stripped = text.replace(POLITENESS_SUFFIX, '').trim();
    if (stripped === text) break;
    text = stripped;
  }
  return text.replace(PUNCTUATION_AND_SPACE, '').toLowerCase();
}

/** Bounded Levenshtein distance -- returns Infinity once it provably exceeds
 *  maxDistance, mirroring _experience-discovery.ts's editDistanceWithin so
 *  this module never pays for an unbounded comparison. */
function editDistance(a: string, b: string, maxDistance: number): number {
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;
  if (a === b) return 0;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMin = current[0]!;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
      current.push(value);
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > maxDistance) return maxDistance + 1;
    previous = current;
  }
  return previous[b.length]!;
}

function bigrams(text: string): Set<string> {
  if (text.length < 2) return new Set([text]);
  const set = new Set<string>();
  for (let i = 0; i < text.length - 1; i += 1) set.add(text.slice(i, i + 2));
  return set;
}

/** Order-independent overlap -- catches a reordered or word-inserted
 *  variant ("มากับแฟน" vs "พาแฟนมาด้วย") that a strictly positional edit
 *  distance would score as very dissimilar, WITHOUT any real Thai word
 *  segmentation (none exists in this codebase). Still a purely structural,
 *  surface-form measure -- see the honesty note above conceptSimilarity. */
function bigramJaccard(a: string, b: string): number {
  const setA = bigrams(a);
  const setB = bigrams(b);
  let intersection = 0;
  for (const gram of setA) if (setB.has(gram)) intersection += 1;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * 0..1 similarity between two ALREADY-normalized strings.
 *
 * HONESTY NOTE (do not oversell this function): this is bounded surface-form
 * similarity (character-level edit distance + order-independent bigram
 * overlap), not semantic understanding. It reliably catches typos, an
 * appended/removed detail, or reordered words of an ALREADY-CONFIRMED
 * exemplar ("มากับแฟนสองคน" after "มากับแฟน" was confirmed). It does NOT
 * bridge a genuine vocabulary substitution with no shared characters
 * ("คนรู้ใจ" has no relation to "แฟน" at the character level) -- that is a
 * real lexical/semantic generalization gap that this module does not close.
 * True cross-vocabulary paraphrase matching needs embedding similarity
 * (pgvector), which is deliberately NOT part of this increment (see
 * THONGTHAI_KERNEL_V2_HANDOFF.md) rather than faked with a keyword table.
 * In practice this still saves real cost: once a customer phrase has been
 * confirmed by OpenAI once, near-repeats of THAT SAME phrasing (which is
 * most of the traffic a phrase concept actually reoccurs as) become free,
 * and each genuinely new phrasing OpenAI confirms accumulates as its own
 * exemplar (bounded per concept), so coverage grows organically from real
 * usage instead of from a hand-written synonym list.
 */
export function conceptSimilarity(normalizedA: string, normalizedB: string): number {
  if (!normalizedA || !normalizedB) return 0;
  if (normalizedA === normalizedB) return 1;
  const longer = Math.max(normalizedA.length, normalizedB.length);
  const maxDistance = Math.max(2, Math.ceil(longer * 0.5));
  const distance = editDistance(normalizedA, normalizedB, maxDistance);
  const editScore = distance > maxDistance ? 0 : 1 - distance / longer;
  const bigramScore = bigramJaccard(normalizedA, normalizedB);
  return Math.max(editScore, bigramScore);
}

export type StoredSemanticConcept = {
  id: string;
  conceptKey: CompanionConceptKey;
  normalizedSignature: string;
  confidence: number;
  evidenceCount: number;
  status: 'active' | 'superseded' | 'retracted';
};

export type SemanticConceptMatch = {
  conceptKey: CompanionConceptKey;
  matchedId: string;
  confidence: number;
  evidenceCount: number;
  similarity: number;
};

// A match may only be trusted to skip the paid model call when BOTH the
// stored concept's own confidence/evidence bar is met AND the current
// message is close enough to a real, previously-confirmed example. Neither
// alone is sufficient -- Phase 3's confidence policy explicitly requires
// evidence to accumulate before a learned pattern is trusted, exactly like
// the pre-existing guest_semantic_memory shape this table's columns mirror.
export const MIN_TRUSTED_CONFIDENCE = 0.85;
export const MIN_TRUSTED_EVIDENCE_COUNT = 3;
// Calibrated empirically against real near-identical variants (an appended
// detail like "สองคน", a reordered/typo'd rendering of the SAME confirmed
// exemplar) -- see the honesty note on conceptSimilarity above. A genuinely
// different vocabulary choice for the same underlying concept scores well
// below this and correctly falls through to a fresh OpenAI call, which then
// (via the write path) becomes its own additional exemplar over time.
export const MIN_SIMILARITY = 0.6;

// This module only ever attempts to own a SHORT, standalone statement -- the
// same discipline the deterministic layer's own short-fragment slot fills
// use. A longer or multi-clause message is never a candidate: attributing a
// compound sentence's meaning to one matched fragment is exactly the unsafe
// overgeneralization the owner mandate warns against.
export const MAX_MATCHABLE_MESSAGE_LENGTH = 40;

export function matchLearnedConcept(
  message: string,
  concepts: readonly StoredSemanticConcept[],
): SemanticConceptMatch | null {
  const normalized = normalizeForConceptMatching(message);
  if (!normalized || normalized.length > MAX_MATCHABLE_MESSAGE_LENGTH) return null;

  let best: SemanticConceptMatch | null = null;
  for (const concept of concepts) {
    if (concept.status !== 'active') continue;
    if (concept.confidence < MIN_TRUSTED_CONFIDENCE) continue;
    if (concept.evidenceCount < MIN_TRUSTED_EVIDENCE_COUNT) continue;
    const similarity = conceptSimilarity(normalized, concept.normalizedSignature);
    if (similarity < MIN_SIMILARITY) continue;
    if (!best || similarity > best.similarity) {
      best = {
        conceptKey: concept.conceptKey,
        matchedId: concept.id,
        confidence: concept.confidence,
        evidenceCount: concept.evidenceCount,
        similarity,
      };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Storage. Table is NOT YET APPLIED to production -- see
// supabase/migrations/20260928120000_semantic_concept_memory_v1.sql and
// THONGTHAI_KERNEL_V2_HANDOFF.md. Every function below is best-effort: a
// missing table/config must degrade to "no learned memory available" for
// reads and a silent no-op for writes, never break or slow down a normal
// customer turn.

function dbConfig(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url: url.replace(/\/$/, ''), key };
}

async function dbFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const config = dbConfig();
  if (!config) throw new Error('Semantic concept memory database is not configured');
  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`semantic_concept_memory request failed ${response.status}: ${body.slice(0, 200)}`);
  }
  return response;
}

type SemanticConceptRow = {
  id: string;
  concept_key: string;
  normalized_signature: string;
  confidence: number;
  evidence_count: number;
  status: string;
};

function parseRow(row: SemanticConceptRow): StoredSemanticConcept | null {
  if (!isCompanionConceptKey(row.concept_key)) return null;
  if (row.status !== 'active' && row.status !== 'superseded' && row.status !== 'retracted') return null;
  return {
    id: row.id,
    conceptKey: row.concept_key,
    normalizedSignature: row.normalized_signature,
    confidence: Number(row.confidence),
    evidenceCount: Number(row.evidence_count),
    status: row.status,
  };
}

/** Never throws. A schema/config/network problem here must fall through to
 *  the real semantic supervisor exactly as if no learned memory existed. */
export async function loadActiveSemanticConcepts(): Promise<StoredSemanticConcept[]> {
  try {
    const response = await dbFetch(
      'semantic_concept_memory?status=eq.active&select=id,concept_key,normalized_signature,confidence,evidence_count,status&limit=500',
    );
    const rows = await response.json() as SemanticConceptRow[];
    return rows.map(parseRow).filter((row): row is StoredSemanticConcept => row !== null);
  } catch (error) {
    console.error(
      'THONGTHAI_SEMANTIC_CONCEPT_MEMORY_LOAD_ERROR',
      error instanceof Error ? error.message.slice(0, 200) : 'unknown',
    );
    return [];
  }
}

// A concept row's key stays private (SHA-256 of the concept key + normalized
// signature) purely so the unique index below can dedupe without a second
// round trip -- never used as an identifier outside this table.
function conceptRowKey(conceptKey: string, normalizedSignature: string): string {
  return createHash('sha256').update(`${conceptKey}:${normalizedSignature}`, 'utf8').digest('hex');
}

const MAX_ACTIVE_SIGNATURES_PER_CONCEPT = 20;

/**
 * Best-effort evidence accumulation for one already-confirmed example.
 * Never called for a message the deterministic layer or the fuzzy matcher
 * itself produced -- callers must pass an example a message the REAL OpenAI
 * semantic supervisor already classified with high confidence (see
 * shouldLearnCompanionConcept in the orchestrator). This function does not
 * re-derive or trust its own judgement about what the concept means; it only
 * records that this exact wording was one more confirmed instance of it.
 */
export async function recordSemanticConceptEvidence(
  conceptKey: CompanionConceptKey,
  message: string,
): Promise<void> {
  try {
    const normalizedSignature = normalizeForConceptMatching(message);
    if (!normalizedSignature || normalizedSignature.length > MAX_MATCHABLE_MESSAGE_LENGTH) return;

    const existingResponse = await dbFetch(
      `semantic_concept_memory?concept_key=eq.${encodeURIComponent(conceptKey)}&status=eq.active`
      + '&select=id,concept_key,normalized_signature,confidence,evidence_count,status&limit=500',
    );
    const existingRows = (await existingResponse.json() as SemanticConceptRow[])
      .map(parseRow)
      .filter((row): row is StoredSemanticConcept => row !== null);

    let bestMatch: { id: string; similarity: number } | null = null;
    for (const row of existingRows) {
      const similarity = conceptSimilarity(normalizedSignature, row.normalizedSignature);
      if (similarity >= MIN_SIMILARITY && (!bestMatch || similarity > bestMatch.similarity)) {
        bestMatch = { id: row.id, similarity };
      }
    }

    if (bestMatch) {
      // Reinforce an existing signature rather than growing the table --
      // this IS the generalization mechanism: repeated confirmed paraphrases
      // raise confidence/evidence for the SAME stored signature instead of
      // creating one row per literal sentence.
      await dbFetch(`semantic_concept_memory?id=eq.${encodeURIComponent(bestMatch.id)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          evidence_count: existingRows.find(row => row.id === bestMatch!.id)!.evidenceCount + 1,
          confidence: Math.min(0.99, Math.max(...existingRows.map(row => row.confidence), 0.7) + 0.02),
          updated_at: new Date().toISOString(),
        }),
      });
      return;
    }

    if (existingRows.length >= MAX_ACTIVE_SIGNATURES_PER_CONCEPT) {
      // Bounded growth: once a concept already has enough distinct
      // exemplars, a further genuinely-new phrasing is observationally
      // interesting but not written -- prevents unbounded table growth from
      // becoming an unreviewed phrase dictionary by another name.
      return;
    }

    await dbFetch('semantic_concept_memory?on_conflict=source_signal_key', {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify({
        concept_key: conceptKey,
        normalized_signature: normalizedSignature,
        source_signal_key: conceptRowKey(conceptKey, normalizedSignature),
        confidence: 0.7,
        evidence_count: 1,
        source: 'openai_confirmed',
        status: 'active',
      }),
    });
  } catch (error) {
    console.error(
      'THONGTHAI_SEMANTIC_CONCEPT_MEMORY_WRITE_ERROR',
      error instanceof Error ? error.message.slice(0, 200) : 'unknown',
    );
  }
}
