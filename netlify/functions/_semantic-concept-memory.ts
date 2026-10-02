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
// This module learns a deliberately CLOSED set of low-risk conversational
// concepts: companion context, relaxed pace, and consider-only / not-yet-
// transaction intent. These outcomes can only update bounded conversation
// memory or DE-ESCALATE transaction authority; none can create a business
// action. True unseen cross-vocabulary paraphrases still fall through to the
// real semantic supervisor and become new confirmed exemplars afterwards.
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
// - PRIVACY BOUNDARY (two independent, both-must-pass checks -- found
//   insufficient in review when it was identifier-detection alone: a
//   personal name like "หนิง" in "มากับแฟนชื่อหนิง" carries no phone/email/
//   URL/handle, so a detector limited to those would let it through
//   verbatim into a cross-customer table with no guest_id):
//   1. containsDirectIdentifier -- REJECTS outright if the message contains
//      a phone/email/URL/handle (the same closed set
//      _direct-identifier-redaction.ts already detects for
//      customer_intelligence_events).
//   2. containsUnrecognizedPersonalDetail -- REJECTS outright if the
//      normalized text contains ANYTHING beyond a small closed set of
//      companion-domain structural words (SAFE_COMPANION_TOKENS). A name,
//      an address, a house number, or any other detail riding along with an
//      otherwise-clean companion statement leaves a non-empty residual after
//      every recognized token is stripped, and any non-empty residual is a
//      reject, never a partial store. This is fail-SAFE, not fail-open: an
//      unrecognized SAFE companion phrasing is merely under-learned (falls
//      through to OpenAI again next time), never persisted with personal
//      content attached.
//   Both are deliberately reject, not redact-and-store: a message carrying
//   a direct identifier or unrecognized content is not a clean companion
//   statement in the first place, and partially-redacted text would still
//   add match-corpus noise for no learning benefit. Neither is a general
//   NER pass -- both are small, closed, deterministic sets, and "no personal
//   payload may become reusable cross-customer semantic memory" is enforced
//   by rejecting on any doubt, not by trying to detect every possible
//   personal-data shape.
import { createHash } from 'node:crypto';
import { redactDirectIdentifiers } from './_direct-identifier-redaction';

export type CompanionConceptKey =
  | 'companion_partner'
  | 'companion_family'
  | 'companion_friends'
  | 'companion_solo';

export type PaceConceptKey = 'pace_relaxed';
export type ConsiderOnlyConceptKey = 'consider_only';
export type SemanticConceptKey = CompanionConceptKey | PaceConceptKey | ConsiderOnlyConceptKey;

const COMPANION_VALUE_BY_CONCEPT_KEY: Readonly<Record<CompanionConceptKey, string>> = {
  companion_partner: 'partner',
  companion_family: 'family',
  companion_friends: 'friends',
  companion_solo: 'solo',
};

type SafeConceptOutcome = {
  entities: Record<string, string>;
  constraints: readonly string[];
  /** A referential consider-only phrase may skip the model only when bounded
   * conversation state proves one unique entity to keep. Otherwise the
   * orchestrator falls through to OpenAI rather than guessing "this one". */
  requiresUniqueContextEntity?: boolean;
};

const SAFE_CONCEPT_OUTCOMES: Readonly<Record<SemanticConceptKey, SafeConceptOutcome>> = {
  companion_partner:{ entities:{companion:'partner'}, constraints:[] },
  companion_family:{ entities:{companion:'family'}, constraints:[] },
  companion_friends:{ entities:{companion:'friends'}, constraints:[] },
  companion_solo:{ entities:{companion:'solo'}, constraints:[] },
  pace_relaxed:{ entities:{pace:'relaxed'}, constraints:[] },
  consider_only:{
    entities:{},
    constraints:['consider_only','no_transaction'],
    requiresUniqueContextEntity:true,
  },
};

export function isCompanionConceptKey(value: string): value is CompanionConceptKey {
  return Object.prototype.hasOwnProperty.call(COMPANION_VALUE_BY_CONCEPT_KEY, value);
}

export function isSemanticConceptKey(value: string): value is SemanticConceptKey {
  return Object.prototype.hasOwnProperty.call(SAFE_CONCEPT_OUTCOMES, value);
}

export function semanticConceptFamily(
  conceptKey: SemanticConceptKey,
): 'companion' | 'pace' | 'consider_only' {
  if (isCompanionConceptKey(conceptKey)) return 'companion';
  return conceptKey === 'pace_relaxed' ? 'pace' : 'consider_only';
}

/** Closed, non-transactional learned outcome. No concept can produce an
 * action, domain, tool name, booking/order flag, money, or operational fact. */
export function safeConceptOutcome(conceptKey: SemanticConceptKey): SafeConceptOutcome {
  return SAFE_CONCEPT_OUTCOMES[conceptKey];
}

export function safeConceptEntities(conceptKey: SemanticConceptKey): Record<string, string> {
  return { ...SAFE_CONCEPT_OUTCOMES[conceptKey].entities };
}

export function safeConceptConstraints(conceptKey: SemanticConceptKey): string[] {
  return [...SAFE_CONCEPT_OUTCOMES[conceptKey].constraints];
}

export function companionConceptKeyForValue(value: string): CompanionConceptKey | null {
  const entry = (Object.entries(COMPANION_VALUE_BY_CONCEPT_KEY) as Array<[CompanionConceptKey, string]>)
    .find(([, mapped]) => mapped === value);
  return entry ? entry[0] : null;
}

/** Derive a learnable key ONLY from canonical structured model output. If a
 * turn expresses more than one learnable family, return null: a compound
 * meaning must never be collapsed into one reusable cross-customer concept. */
export function semanticConceptKeyForConfirmedMeaning(input: {
  entities: Record<string, unknown>;
  constraints: readonly string[];
}): SemanticConceptKey | null {
  const candidates: SemanticConceptKey[] = [];
  const companionValue = input.entities.companion ?? input.entities.companionType;
  if (typeof companionValue === 'string') {
    const companion = companionConceptKeyForValue(companionValue);
    if (companion) candidates.push(companion);
  }
  const paceValue = input.entities.pace ?? input.entities.exertionPreference;
  if (paceValue === 'relaxed') candidates.push('pace_relaxed');
  if (input.constraints.some(value =>
    /^(?:consider_only|not_yet_booking|no_transaction|not_booking)$/iu.test(value))) {
    candidates.push('consider_only');
  }
  const unique=[...new Set(candidates)];
  return unique.length === 1 ? unique[0]! : null;
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

// Phase 3 production-routing bridge. These markers DO NOT decide meaning;
// they only decide that a short, standalone turn is worth sending through
// One-Mind's semantic-learning path before the 100% Saved-Agent rollout.
// The semantic supervisor / learned-memory matcher remains the sole meaning
// authority. False positives therefore cost at most one normal semantic call;
// they can never create a concept or transaction by marker match alone.
const PHASE3_COMPANION_ROUTE_MARKER =
  /(?:มากับ|มาด้วย|พามา|ไปด้วย|อยู่ด้วย).{0,16}(?:แฟน|คนรัก|คนรู้ใจ|ครอบครัว|พ่อแม่|พ่อ|แม่|ลูก|ญาติ|พี่น้อง|เพื่อน|สามี|ภรรยา|คนเดียว)/u;
const PHASE3_RELAXED_PACE_ROUTE_MARKER =
  /(?:ไม่อยากเหนื่อย|ไม่เหนื่อย|เหนื่อยน้อย|ไม่หนัก|ชิล(?:ๆ)?|สบาย(?:ๆ)?|เบา(?:ๆ)?|เรื่อย(?:ๆ)?)/u;
const PHASE3_CONSIDER_ONLY_ROUTE_MARKER =
  /(?:ไว้ก่อน|จำไว้ก่อน|เก็บไว้ก่อน|ยังไม่(?:จอง|สั่ง|ทำรายการ)|ไม่ต้อง(?:จอง|สั่ง|ทำรายการ))/u;

export function isPhase3SemanticLearningCandidate(message:string):boolean {
  const text=String(message??'').normalize('NFC').trim();
  if(!text) return false;
  return PHASE3_COMPANION_ROUTE_MARKER.test(text)
    || PHASE3_RELAXED_PACE_ROUTE_MARKER.test(text)
    || PHASE3_CONSIDER_ONLY_ROUTE_MARKER.test(text);
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

// A negated/reversed phrase can still score HIGH on pure surface similarity
// ("ไม่มากับแฟน" -- NOT coming with a partner -- shares almost every
// character with "มากับแฟน" and scored 0.73 in calibration, well above
// MIN_SIMILARITY). Surface-form matching cannot tell "X" from "not X" by
// construction, so this is a deliberate STRUCTURAL veto, not a similarity
// tweak: if exactly one side carries a negation/reversal marker, the two can
// never be treated as the same confirmed concept, however close their
// characters are. This is the acceptance-criterion-D safety boundary
// ("a contradictory phrase must not incorrectly reuse a prior concept").
const NEGATION_MARKER = /ไม่|เลิก|ยกเลิก|งด|แยกทาง|หย่า/u;
function hasNegationMismatch(normalizedA: string, normalizedB: string): boolean {
  return NEGATION_MARKER.test(normalizedA) !== NEGATION_MARKER.test(normalizedB);
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
 *
 * A negation/reversal mismatch (see hasNegationMismatch) always returns 0
 * here, before either surface-form score is even computed -- this must hold
 * for EVERY caller (matching AND the write path's own "reinforce an
 * existing exemplar" check), so it lives in the shared primitive rather than
 * being duplicated at each call site.
 */
export function conceptSimilarity(normalizedA: string, normalizedB: string): number {
  if (!normalizedA || !normalizedB) return 0;
  if (hasNegationMismatch(normalizedA, normalizedB)) return 0;
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
  conceptKey: SemanticConceptKey;
  normalizedSignature: string;
  confidence: number;
  evidenceCount: number;
  contradictionCount: number;
  status: 'active' | 'superseded' | 'retracted';
};

export type SemanticConceptTrustTier = 'exact_replay' | 'fuzzy_generalized';

export type SemanticConceptMatch = {
  conceptKey: SemanticConceptKey;
  matchedId: string;
  confidence: number;
  evidenceCount: number;
  similarity: number;
  tier: SemanticConceptTrustTier;
};

// TWO-TIER TRUST POLICY (found in review: a single evidence-accumulating bar
// meant a newly learned phrasing needed ~9 confirmed occurrences before
// becoming zero-call -- too slow for the owner's actual goal, "ask once,
// reuse next time"). The fix is NOT to lower every threshold (that would
// make the RISKIER fuzzy-matching path reach zero-cost just as fast as a
// true exact repeat, which is exactly the failure mode a two-tier design
// exists to avoid). Instead:
//
// TIER A ("exact replay") -- the current message's normalized form is
// CHARACTER-FOR-CHARACTER IDENTICAL to a stored exemplar's own normalized
// signature (not merely a high similarity score -- see matchLearnedConcept).
// An exact replay of an already-confirmed sentence carries essentially no
// interpretation risk, so ONE real OpenAI confirmation is enough: the
// DEFAULT values a freshly-promoted row is written with (confidence 0.7,
// evidence_count 1, see recordSemanticConceptEvidence) already clear this
// bar. This closes the actual gap: two different customers typing politeness
// variants of the SAME underlying sentence ("มากับแฟน" / "มากับแฟนค่ะ" /
// "มากับแฟนนะครับ" all normalize identically) become free after just one
// confirmation, which is the bulk of real repeat traffic for a single
// confirmed phrasing.
export const MIN_TIER_A_CONFIDENCE = 0.7;
export const MIN_TIER_A_EVIDENCE_COUNT = 1;

// TIER B ("fuzzy generalized") -- ANY match that is not an exact replay (an
// appended detail, a typo, a reordering) is a genuinely different sentence
// with residual interpretation risk, and keeps today's slower,
// evidence-accumulating trust bar UNCHANGED. This is the pre-existing policy
// this table's columns mirror from guest_semantic_memory's own
// confidence/evidence shape -- deliberately left conservative rather than
// loosened.
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
    // Defense in depth alongside the write path's own retract-on-contradiction
    // logic: a row that has ever been confirmed to contradict another
    // concept is never matched, even if something upstream failed to flip
    // its status to 'retracted'.
    if (concept.contradictionCount >= CONTRADICTION_RETRACT_THRESHOLD) continue;
    const similarity = conceptSimilarity(normalized, concept.normalizedSignature);
    if (similarity < MIN_SIMILARITY) continue;
    // Tier is decided by EXACT normalized equality, never by a similarity
    // score close to 1 -- a 0.97 fuzzy score is still a different sentence
    // and must not borrow Tier A's fast-promotion bar.
    const isExactReplay = normalized === concept.normalizedSignature;
    const tier: SemanticConceptTrustTier = isExactReplay ? 'exact_replay' : 'fuzzy_generalized';
    const requiredConfidence = isExactReplay ? MIN_TIER_A_CONFIDENCE : MIN_TRUSTED_CONFIDENCE;
    const requiredEvidenceCount = isExactReplay ? MIN_TIER_A_EVIDENCE_COUNT : MIN_TRUSTED_EVIDENCE_COUNT;
    if (concept.confidence < requiredConfidence) continue;
    if (concept.evidenceCount < requiredEvidenceCount) continue;
    if (!best || similarity > best.similarity) {
      best = {
        conceptKey: concept.conceptKey,
        matchedId: concept.id,
        confidence: concept.confidence,
        evidenceCount: concept.evidenceCount,
        similarity,
        tier,
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

// Bumped only if a future migration changes this table's meaning in a way
// old rows can't be read compatibly under -- lets a later reader distinguish
// "no rows yet" from "rows written under an incompatible shape" without
// inspecting column existence at runtime.
export const SEMANTIC_CONCEPT_MEMORY_SCHEMA_VERSION = 'semantic-concept-memory-v1';

// A single confirmed contradiction is enough to retract a row rather than
// requiring several: "never let self-learning make Thongthai confidently
// wrong" argues for conservatism over patience here. A genuinely correct
// concept that got unlucky once can always reappear as a fresh exemplar the
// next time OpenAI confirms it -- retracting is never destructive (the row
// stays, auditable, via status + superseded_by, see the migration).
export const CONTRADICTION_RETRACT_THRESHOLD = 1;

type SemanticConceptRow = {
  id: string;
  concept_key: string;
  normalized_signature: string;
  confidence: number;
  evidence_count: number;
  contradiction_count: number;
  status: string;
};

function parseRow(row: SemanticConceptRow): StoredSemanticConcept | null {
  if (!isSemanticConceptKey(row.concept_key)) return null;
  if (row.status !== 'active' && row.status !== 'superseded' && row.status !== 'retracted') return null;
  return {
    id: row.id,
    conceptKey: row.concept_key,
    normalizedSignature: row.normalized_signature,
    confidence: Number(row.confidence),
    evidenceCount: Number(row.evidence_count),
    contradictionCount: Number(row.contradiction_count ?? 0),
    status: row.status,
  };
}

const CONCEPT_ROW_SELECT = 'id,concept_key,normalized_signature,confidence,evidence_count,contradiction_count,status';

/** Never throws. A schema/config/network problem here must fall through to
 *  the real semantic supervisor exactly as if no learned memory existed. */
export async function loadActiveSemanticConcepts(): Promise<StoredSemanticConcept[]> {
  try {
    const response = await dbFetch(
      `semantic_concept_memory?status=eq.active&select=${CONCEPT_ROW_SELECT}&limit=500`,
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

// The caller (resolveSemanticTurn's write-path hook) awaits this write with
// a race against this timeout, so a slow/stuck Supabase round trip can never
// add unbounded latency to the customer-facing turn. This is a caller-side
// bound, not a fetch abort -- the underlying request may keep running in the
// background, but the customer's own response is never held up past this.
export const SEMANTIC_CONCEPT_MEMORY_WRITE_TIMEOUT_MS = 1_500;

// resolveSemanticTurn's write-path hook can genuinely run more than once for
// the SAME customer turn: the early "understand-first" gate and the later
// main cutover attempt both call the real interpreter for the same eventId,
// and _ai-cost-ledger.ts's own idempotency replays the first call's result
// for the second rather than paying twice -- from the write-path hook's own
// point of view that still looks like "a fresh, usable model confirmation"
// each time (found in review: a stuck write timing out on BOTH attempts
// sequentially added ~2x SEMANTIC_CONCEPT_MEMORY_WRITE_TIMEOUT_MS to one
// customer's response, not a single bounded wait). Deduping by eventId here
// caps the number of write ATTEMPTS at one per real transport event,
// independent of how many times the orchestrator recomputes the same
// understanding for it. Bounded FIFO eviction keeps this a small, constant
// amount of memory for a long-lived warm serverless instance, never an
// unbounded per-request leak.
const MAX_TRACKED_WRITE_EVENT_IDS = 500;
const attemptedWriteEventIds: string[] = [];
const attemptedWriteEventIdSet = new Set<string>();

/** True the FIRST time called for a given eventId; false every time after,
 *  for as long as that eventId is still tracked. Exported so the
 *  orchestrator's write-path hook can skip a redundant attempt entirely
 *  (never even starting the timeout race a second time) rather than relying
 *  on this module to silently swallow it after the fact.
 *
 *  Callers should pass a key scoped by BOTH conversation and eventId (e.g.
 *  `${conversationId}:${eventId}`), not a bare eventId -- real transport
 *  event ids are unique on their own, but scoping by conversation too costs
 *  nothing and removes any dependence on that uniqueness holding perfectly
 *  across every caller. */
export function claimWriteAttemptForEvent(key: string): boolean {
  if (attemptedWriteEventIdSet.has(key)) return false;
  attemptedWriteEventIdSet.add(key);
  attemptedWriteEventIds.push(key);
  if (attemptedWriteEventIds.length > MAX_TRACKED_WRITE_EVENT_IDS) {
    const oldest = attemptedWriteEventIds.shift();
    if (oldest) attemptedWriteEventIdSet.delete(oldest);
  }
  return true;
}

/**
 * Best-effort evidence accumulation for one already-confirmed example.
 * Never called for a message the deterministic layer or the fuzzy matcher
 * itself produced -- callers must pass an example a message the REAL OpenAI
 * semantic supervisor already classified with high confidence (see
 * shouldLearnCompanionConcept in the orchestrator). This function does not
 * re-derive or trust its own judgement about what the concept means; it only
 * records that this exact wording was one more confirmed instance of it.
 */
// A closed, deterministic check for the same identifier classes
// _direct-identifier-redaction.ts already detects (phone/email/URL/handle)
// -- checked on the RAW message, before normalization strips the
// punctuation those patterns rely on. This is intentionally narrow: it is
// not a general PII/NER classifier, only the small set this codebase
// already trusts elsewhere for exactly this purpose.
function containsDirectIdentifier(message: string): boolean {
  return /\[(?:url|email|phone|handle)\]/u.test(redactDirectIdentifiers(message));
}

// A CLOSED, deliberately small set of companion-domain structural words
// (prepositions/verbs, the closed counting vocabulary, and the concept's own
// closed relationship vocabulary plus a handful of near-synonyms this
// module's own tests already exercise, e.g. "คนรู้ใจ"). This is NOT a
// semantic classifier and NOT a general Thai tokenizer -- OpenAI has ALREADY
// told the caller what the confirmed concept means; this list exists purely
// to decide whether the confirmed sentence is composed ENTIRELY of generic
// companion-domain words, or whether it ALSO carries something else (a name,
// an address, any other personal detail) that must never enter a table with
// no guest_id column at all (found in review: "มากับแฟนชื่อหนิง" carries no
// phone/email/URL/handle, so containsDirectIdentifier alone would let the
// name "หนิง" through verbatim).
const SAFE_CONCEPT_TOKENS: Readonly<Record<'companion'|'pace'|'consider_only', RegExp>> = {
  companion:new RegExp(
    [
      'มากับ', 'พามา', 'ไปด้วย', 'อยู่ด้วย', 'มาด้วย',
      'สองคน', 'สามคน', 'สี่คน', 'ห้าคน', 'หกคน', 'กี่คน', 'หลายคน', 'คนเดียว', 'ทั้งครอบครัว',
      'แฟนสาว', 'แฟนหนุ่ม', 'แฟน', 'คนรัก', 'คนรู้ใจ', 'กิ๊ก',
      'ครอบครัว', 'พ่อแม่', 'พ่อ', 'แม่', 'ลูก', 'ญาติ', 'พี่น้อง', 'เพื่อนๆ', 'เพื่อน', 'สามี', 'ภรรยา',
      'มา', 'กับ', 'พา', 'ด้วย', 'ไป', 'อยู่',
    ].join('|'),
    'gu',
  ),
  // Privacy allowlists are NOT semantic classifiers. OpenAI has already
  // confirmed the canonical meaning before this code runs; these tokens only
  // prove the stored exemplar contains no extra personal payload.
  pace:new RegExp(
    [
      'ไม่อยากเหนื่อย', 'ไม่เหนื่อย', 'เหนื่อยน้อย', 'ไม่หนัก', 'เบาๆ', 'เบา', 'ชิลๆ', 'ชิล',
      'สบายๆ', 'สบาย', 'เรื่อยๆ', 'ช้าๆ', 'เอาแบบ', 'ขอแบบ', 'อยาก', 'มาก', 'เกิน', 'หน่อย',
    ].join('|'),
    'gu',
  ),
  consider_only:new RegExp(
    [
      'ยังไม่ต้อง', 'ยังไม่', 'ไม่ต้อง', 'ไม่', 'เอาอันนี้', 'เอาตัวนี้', 'เอาอันนั้น', 'เอาตัวนั้น',
      'เอา', 'สนใจอันนี้', 'สนใจตัวนี้', 'สนใจ', 'จำไว้ก่อน', 'เก็บไว้ก่อน', 'ไว้ก่อน',
      'ขอ', 'จำ', 'เก็บ', 'จอง', 'สั่ง', 'ทำรายการ', 'ตอนนี้', 'ก่อน', 'อยู่',
    ].join('|'),
    'gu',
  ),
};

/** FAIL-SAFE, NOT FAIL-OPEN. Any residual outside the concept family's
 * closed generic vocabulary rejects the cross-customer learning write. */
function containsUnrecognizedPersonalDetail(
  conceptKey: SemanticConceptKey,
  normalizedSignature: string,
): boolean {
  return normalizedSignature.replace(SAFE_CONCEPT_TOKENS[semanticConceptFamily(conceptKey)], '').length > 0;
}

export async function recordSemanticConceptEvidence(
  conceptKey: SemanticConceptKey,
  message: string,
): Promise<void> {
  try {
    if (containsDirectIdentifier(message)) {
      // Reject outright -- never persisted in any form, redacted or not.
      // A message carrying a direct identifier is not a clean companion
      // statement to learn from, and this table has no legitimate reason
      // to ever store one.
      console.log('THONGTHAI_SEMANTIC_CONCEPT_MEMORY_OBSERVABILITY', JSON.stringify({
        event: 'rejected_direct_identifier', concept_key: conceptKey,
      }));
      return;
    }

    const normalizedSignature = normalizeForConceptMatching(message);
    if (!normalizedSignature || normalizedSignature.length > MAX_MATCHABLE_MESSAGE_LENGTH) return;

    if (containsUnrecognizedPersonalDetail(conceptKey, normalizedSignature)) {
      // Reject outright -- same policy as containsDirectIdentifier above.
      // Whatever this unrecognized content is (a name, an address, anything
      // else), it must never enter a cross-customer table with no guest_id.
      console.log('THONGTHAI_SEMANTIC_CONCEPT_MEMORY_OBSERVABILITY', JSON.stringify({
        event: 'rejected_unrecognized_content', concept_key: conceptKey,
      }));
      return;
    }

    // One read covers both checks below: reinforce-or-add for THIS concept,
    // and contradiction detection against every OTHER concept key. A single
    // query keeps this best-effort write cheap (this module never queries
    // per-concept-key in a loop).
    const allActiveResponse = await dbFetch(
      `semantic_concept_memory?status=eq.active&select=${CONCEPT_ROW_SELECT}&limit=500`,
    );
    const allActiveRows = (await allActiveResponse.json() as SemanticConceptRow[])
      .map(parseRow)
      .filter((row): row is StoredSemanticConcept => row !== null);
    const existingRows = allActiveRows.filter(row => row.conceptKey === conceptKey);

    // Acceptance criterion D: a phrase OpenAI just confirmed as concept X
    // that ALSO closely resembles an existing exemplar stored under a
    // DIFFERENT concept key Y is a genuine contradiction -- Y's own
    // surface-form signature is not, after all, uniquely predictive of Y.
    // Retract Y rather than let it keep answering confidently. This can
    // never fire from X's own accumulated evidence (only cross-concept
    // matches count), and never touches the row being written for X itself.
    for (const other of allActiveRows) {
      if (other.conceptKey === conceptKey) continue;
      // Only keys in the SAME semantic family are mutually exclusive.
      // Companion partner/family/friends/solo can contradict one another;
      // pace and consider-only can legitimately co-exist with companion or
      // with each other and must never retract across families.
      if (semanticConceptFamily(other.conceptKey) !== semanticConceptFamily(conceptKey)) continue;
      if (conceptSimilarity(normalizedSignature, other.normalizedSignature) < MIN_SIMILARITY) continue;
      const nextContradictionCount = other.contradictionCount + 1;
      const shouldRetract = nextContradictionCount >= CONTRADICTION_RETRACT_THRESHOLD;
      await dbFetch(`semantic_concept_memory?id=eq.${encodeURIComponent(other.id)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          contradiction_count: nextContradictionCount,
          ...(shouldRetract ? { status: 'retracted' } : {}),
          updated_at: new Date().toISOString(),
        }),
      }).catch(error => console.error(
        'THONGTHAI_SEMANTIC_CONCEPT_MEMORY_CONTRADICTION_ERROR',
        error instanceof Error ? error.message.slice(0, 200) : 'unknown',
      ));
      console.log('THONGTHAI_SEMANTIC_CONCEPT_MEMORY_OBSERVABILITY', JSON.stringify({
        event: 'conflict',
        conflicting_concept_key: other.conceptKey,
        confirmed_concept_key: conceptKey,
        contradiction_count: nextContradictionCount,
        retracted: shouldRetract,
      }));
    }

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
      //
      // Fix (found in review): confidence must advance from the MATCHED
      // row's OWN prior confidence, never the max across every row this
      // concept key happens to have. A weak, rarely-confirmed exemplar must
      // never borrow trust from an unrelated strong exemplar of the same
      // concept just because they share a concept_key -- each stored
      // signature earns its own confidence independently.
      const matchedRow = existingRows.find(row => row.id === bestMatch!.id)!;
      const newEvidenceCount = matchedRow.evidenceCount + 1;
      const newConfidence = Math.min(0.99, matchedRow.confidence + 0.02);
      await dbFetch(`semantic_concept_memory?id=eq.${encodeURIComponent(bestMatch.id)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          evidence_count: newEvidenceCount,
          confidence: newConfidence,
          updated_at: new Date().toISOString(),
        }),
      });
      console.log('THONGTHAI_SEMANTIC_CONCEPT_MEMORY_OBSERVABILITY', JSON.stringify({
        event: 'reinforce', concept_key: conceptKey, matched_id: bestMatch.id,
        similarity: bestMatch.similarity, evidence_count: newEvidenceCount, confidence: newConfidence,
      }));
      return;
    }

    if (existingRows.length >= MAX_ACTIVE_SIGNATURES_PER_CONCEPT) {
      // Bounded growth: once a concept already has enough distinct
      // exemplars, a further genuinely-new phrasing is observationally
      // interesting but not written -- prevents unbounded table growth from
      // becoming an unreviewed phrase dictionary by another name.
      console.log('THONGTHAI_SEMANTIC_CONCEPT_MEMORY_OBSERVABILITY', JSON.stringify({
        event: 'promotion_skipped_at_cap', concept_key: conceptKey, existing_signature_count: existingRows.length,
      }));
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
        contradiction_count: 0,
        source: 'openai_confirmed',
        status: 'active',
        schema_version: SEMANTIC_CONCEPT_MEMORY_SCHEMA_VERSION,
      }),
    });
    console.log('THONGTHAI_SEMANTIC_CONCEPT_MEMORY_OBSERVABILITY', JSON.stringify({
      event: 'promotion', concept_key: conceptKey,
    }));
  } catch (error) {
    console.error(
      'THONGTHAI_SEMANTIC_CONCEPT_MEMORY_WRITE_ERROR',
      error instanceof Error ? error.message.slice(0, 200) : 'unknown',
    );
  }
}
