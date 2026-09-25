// Phase E of the Thongthai one-mind architecture program (see THONGTHAI_HANDOFF.md).
//
// Knowledge Resolver: given a validated SemanticTurn-shaped request (+
// ConversationContext + ActiveTask), decides what information is needed,
// which authoritative source owns it, fetches it, and returns normalized
// grounded facts -- with provenance, so nothing downstream has to trust an
// unattributed claim. This module does NOT write customer-facing prose, does
// NOT execute transactional writes, and does NOT invent facts: every
// GroundedFact in a returned KnowledgeBundle traces back to a real
// SourceResult an injected adapter returned, never a resolver-synthesized
// value.
//
// NOT a new unified fact database. This module owns ZERO storage and makes
// ZERO direct DB calls itself (see tests/knowledge-resolver-no-cycle.test.ts
// -- it statically proves there is no `fetch(` anywhere in this file). All
// real data access is injected via KnowledgeSourceAdapters. In real
// production wiring (a later phase), those adapters would be thin wrappers
// around the ALREADY-EXISTING functions this codebase has today
// (loadRestaurantWorldFacts/listRestaurantMenu, loadActivityWorldFacts,
// listBookingOptions, loadActivePromotionsWorldFact, etc. in
// _restaurant-sot.ts / _thongthai-runtime-v3.ts / _operations-db.ts /
// _promotions-runtime.ts) -- never a new table, never a copy of live data
// into world_facts or the Bible. This module is not wired into any request
// handler yet (see THONGTHAI_HANDOFF.md's "Known gaps" note); Phase E only
// builds and proves the routing/orchestration contract with mock adapters.
import type { SemanticAction, SemanticDomain } from './_semantic-interpreter';
import type { ActiveTask } from './_task-state';

// ---------------------------------------------------------------------------
// Normalized query contract
// ---------------------------------------------------------------------------

export type KnowledgeNeed =
  | 'catalog' | 'entity_details' | 'price' | 'availability' | 'schedule' | 'inventory'
  | 'ingredients' | 'recommendations_input' | 'promotion_eligibility' | 'booking_status'
  | 'order_status' | 'membership_status' | 'stable_policy';

export type KnowledgeRequest = {
  domain: SemanticDomain;
  intent: string;
  action: SemanticAction;
  entities: Record<string, unknown>;
  constraints: string[];
  task?: ActiveTask | null;
  needs: KnowledgeNeed[];
};

// ---------------------------------------------------------------------------
// Source registry -- documents authoritative ownership. This is a
// DOCUMENTATION/validation table (see tests: "no unnecessary cross-domain
// queries" and "mutable facts not sourced from Bible"), not itself the
// dispatch mechanism -- routeNeed() below is. world_facts is deliberately
// absent here: it is a small stable policy/config table, not a stand-in
// source for any of these domains (see THONGTHAI_HANDOFF.md's Phase E note).
// ---------------------------------------------------------------------------

export type KnowledgeSourceType =
  | 'bible' | 'restaurant_live' | 'activity_live' | 'stay_live' | 'promotion_runtime'
  | 'booking_operational' | 'order_operational' | 'payment_operational' | 'membership_operational'
  | 'otop_live' | 'cafe_live' | 'conversation_memory';

export const SOURCE_REGISTRY: Record<KnowledgeNeed, readonly KnowledgeSourceType[]> = {
  catalog: ['activity_live', 'restaurant_live', 'stay_live', 'otop_live', 'bible'],
  entity_details: ['activity_live', 'restaurant_live', 'stay_live', 'bible'],
  price: ['activity_live', 'restaurant_live', 'stay_live', 'otop_live'],
  availability: ['activity_live', 'stay_live'],
  schedule: ['activity_live', 'stay_live'],
  inventory: ['activity_live', 'otop_live'],
  ingredients: ['restaurant_live'],
  recommendations_input: ['restaurant_live', 'activity_live', 'bible'],
  promotion_eligibility: ['promotion_runtime'],
  booking_status: ['booking_operational'],
  order_status: ['order_operational'],
  membership_status: ['membership_operational'],
  stable_policy: ['bible'],
};

/** Mutable-fact needs that must NEVER route to Bible, even though Bible
 *  appears in SOURCE_REGISTRY above for stable/ecosystem-level context on
 *  those needs -- Bible may describe what an activity IS, never what its
 *  live price/availability/inventory currently IS. Enforced by routeNeed()
 *  and proven by a dedicated test. */
const NEVER_BIBLE_FOR: ReadonlySet<KnowledgeNeed> = new Set(['price', 'availability', 'schedule', 'inventory', 'promotion_eligibility', 'booking_status', 'order_status', 'membership_status']);

// ---------------------------------------------------------------------------
// Source precedence -- deterministic conflict resolution when the same fact
// key is grounded by more than one source. Higher wins.
// ---------------------------------------------------------------------------

export const SOURCE_PRECEDENCE: Record<KnowledgeSourceType, number> = {
  booking_operational: 100,
  order_operational: 100,
  payment_operational: 100,
  membership_operational: 100,
  promotion_runtime: 90,
  restaurant_live: 80,
  activity_live: 80,
  stay_live: 80,
  otop_live: 80,
  cafe_live: 80,
  bible: 50,
  conversation_memory: 10,
};

export function pickByPrecedence(candidates: readonly GroundedFact[]): GroundedFact | null {
  if (!candidates.length) return null;
  return candidates.reduce((best, candidate) => (SOURCE_PRECEDENCE[candidate.sourceType] > SOURCE_PRECEDENCE[best.sourceType] ? candidate : best));
}

// ---------------------------------------------------------------------------
// Result / bundle contracts -- EMPTY vs UNAVAILABLE vs UNKNOWN, kept
// structurally distinct (never collapsed into one signal). See
// THONGTHAI_HANDOFF.md's Phase E note: this distinction matters for Phase H.
// ---------------------------------------------------------------------------

export type GroundedFact = {
  key: string;
  value: unknown;
  domain: SemanticDomain;
  sourceId: string;
  sourceType: KnowledgeSourceType;
  authoritative: boolean;
  fetchedAt: string;
  updatedAt?: string;
  stale?: boolean;
};

export type SourceResult =
  | { status: 'ok'; data: GroundedFact[]; sourceId: string; sourceType: KnowledgeSourceType; fetchedAt: string }
  | { status: 'empty'; sourceId: string; sourceType: KnowledgeSourceType; fetchedAt: string }
  | { status: 'unavailable'; sourceId: string; sourceType: KnowledgeSourceType; fetchedAt: string; error: string };

export type KnowledgeSourceTrace = {
  need: KnowledgeNeed;
  sourceId: string;
  sourceType: KnowledgeSourceType;
  status: 'ok' | 'empty' | 'unavailable';
  /** Present only when status is 'unavailable': WHY there is no value --
   *  the source genuinely failed (`source_unavailable`), or nothing was
   *  ever wired up to answer this need at all (`no_source_registered`,
   *  the UNKNOWN case). Both are structurally distinct from 'empty'
   *  (the source succeeded and definitively found nothing). */
  reason?: 'source_unavailable' | 'no_source_registered';
};

export type ResolvedEntity = {
  requestedId: string;
  canonicalId: string | null;
  canonical: boolean;
  ambiguous: boolean;
  candidates?: string[];
  name: string;
  domain: SemanticDomain;
};

export type KnowledgeBundle = {
  domain: SemanticDomain;
  sources: KnowledgeSourceTrace[];
  facts: GroundedFact[];
  entities: ResolvedEntity[];
  missing: KnowledgeNeed[];
  warnings: string[];
  freshness: 'stable' | 'live' | 'mixed';
};

// ---------------------------------------------------------------------------
// Injected source adapters -- ALL real I/O lives outside this module. A
// production wiring phase supplies adapters backed by the existing
// functions named in this file's header comment; tests supply fakes.
// ---------------------------------------------------------------------------

export type KnowledgeSourceFetch = (request: KnowledgeRequest) => Promise<SourceResult>;

export type KnowledgeSourceAdapters = {
  restaurant?: { menu?: KnowledgeSourceFetch };
  activity?: { catalog?: KnowledgeSourceFetch; availability?: KnowledgeSourceFetch };
  stay?: { catalog?: KnowledgeSourceFetch; availability?: KnowledgeSourceFetch };
  promotion?: { eligibility?: KnowledgeSourceFetch };
  bookingStatus?: { lookup?: KnowledgeSourceFetch };
  orderStatus?: { lookup?: KnowledgeSourceFetch };
  paymentStatus?: { lookup?: KnowledgeSourceFetch };
  membership?: { status?: KnowledgeSourceFetch };
  otop?: { catalog?: KnowledgeSourceFetch };
  cafe?: { facts?: KnowledgeSourceFetch };
  bible?: { stablePolicy?: KnowledgeSourceFetch };
};

type Route = { sourceType: KnowledgeSourceType; fetch: KnowledgeSourceFetch } | null;

/** THE routing table: one (domain, need) pair maps to exactly one adapter
 *  call. This is what makes "no overfetching" true structurally -- a
 *  request for one need in one domain can only ever trigger the single
 *  adapter function this function selects, never any other domain's
 *  adapters (proven by a spy-based test). */
function routeNeed(domain: SemanticDomain, need: KnowledgeNeed, adapters: KnowledgeSourceAdapters): Route {
  if (NEVER_BIBLE_FOR.has(need) && domain !== 'ecosystem') {
    // fall through to the domain-specific live routes below; Bible is
    // simply never a candidate for these needs outside 'ecosystem'.
  }
  switch (domain) {
    case 'restaurant':
      if ((need === 'catalog' || need === 'price' || need === 'ingredients' || need === 'entity_details' || need === 'recommendations_input') && adapters.restaurant?.menu) {
        return { sourceType: 'restaurant_live', fetch: adapters.restaurant.menu };
      }
      if ((need === 'booking_status') && adapters.bookingStatus?.lookup) return { sourceType: 'booking_operational', fetch: adapters.bookingStatus.lookup };
      if ((need === 'order_status') && adapters.orderStatus?.lookup) return { sourceType: 'order_operational', fetch: adapters.orderStatus.lookup };
      return null;
    case 'activity':
      if ((need === 'catalog' || need === 'price' || need === 'entity_details' || need === 'inventory' || need === 'recommendations_input') && adapters.activity?.catalog) {
        return { sourceType: 'activity_live', fetch: adapters.activity.catalog };
      }
      if ((need === 'availability' || need === 'schedule') && adapters.activity?.availability) return { sourceType: 'activity_live', fetch: adapters.activity.availability };
      if (need === 'booking_status' && adapters.bookingStatus?.lookup) return { sourceType: 'booking_operational', fetch: adapters.bookingStatus.lookup };
      return null;
    case 'stay':
      if ((need === 'catalog' || need === 'price' || need === 'entity_details' || need === 'inventory') && adapters.stay?.catalog) {
        return { sourceType: 'stay_live', fetch: adapters.stay.catalog };
      }
      if ((need === 'availability' || need === 'schedule') && adapters.stay?.availability) return { sourceType: 'stay_live', fetch: adapters.stay.availability };
      if (need === 'booking_status' && adapters.bookingStatus?.lookup) return { sourceType: 'booking_operational', fetch: adapters.bookingStatus.lookup };
      return null;
    case 'promotion':
      if ((need === 'promotion_eligibility' || need === 'catalog') && adapters.promotion?.eligibility) return { sourceType: 'promotion_runtime', fetch: adapters.promotion.eligibility };
      return null;
    case 'membership':
      if (need === 'membership_status' && adapters.membership?.status) return { sourceType: 'membership_operational', fetch: adapters.membership.status };
      return null;
    case 'otop':
      if ((need === 'catalog' || need === 'price' || need === 'inventory') && adapters.otop?.catalog) return { sourceType: 'otop_live', fetch: adapters.otop.catalog };
      if (need === 'order_status' && adapters.orderStatus?.lookup) return { sourceType: 'order_operational', fetch: adapters.orderStatus.lookup };
      return null;
    case 'cafe':
      if ((need === 'catalog' || need === 'entity_details' || need === 'recommendations_input' || need === 'price') && adapters.cafe?.facts) return { sourceType: 'cafe_live', fetch: adapters.cafe.facts };
      return null;
    case 'payment':
      if (adapters.paymentStatus?.lookup) return { sourceType: 'payment_operational', fetch: adapters.paymentStatus.lookup };
      return null;
    case 'ecosystem':
      if ((need === 'catalog' || need === 'entity_details' || need === 'stable_policy' || need === 'recommendations_input') && adapters.bible?.stablePolicy) {
        return { sourceType: 'bible', fetch: adapters.bible.stablePolicy };
      }
      return null;
    default:
      return null;
  }
}

function computeFreshness(sources: readonly KnowledgeSourceTrace[]): KnowledgeBundle['freshness'] {
  const liveTypes = sources.filter(s => s.status !== 'unavailable' && s.sourceType !== 'bible' && s.sourceType !== 'conversation_memory');
  const stableTypes = sources.filter(s => s.status !== 'unavailable' && s.sourceType === 'bible');
  if (liveTypes.length && stableTypes.length) return 'mixed';
  if (stableTypes.length && !liveTypes.length) return 'stable';
  return 'live';
}

/** The main orchestrator. Only calls the ONE adapter each requested need
 *  routes to -- never every adapter in `adapters`. Never synthesizes a
 *  GroundedFact itself; every fact in the result came from a SourceResult
 *  an adapter actually returned. */
export async function resolveKnowledge(request: KnowledgeRequest, adapters: KnowledgeSourceAdapters, now: Date = new Date()): Promise<KnowledgeBundle> {
  const sources: KnowledgeSourceTrace[] = [];
  const facts: GroundedFact[] = [];
  const missing: KnowledgeNeed[] = [];
  const warnings: string[] = [];

  for (const need of request.needs) {
    const route = routeNeed(request.domain, need, adapters);
    if (!route) {
      missing.push(need);
      sources.push({ need, sourceId: 'none', sourceType: guessSourceType(request.domain, need), status: 'unavailable', reason: 'no_source_registered' });
      continue;
    }
    let result: SourceResult;
    try {
      result = await route.fetch(request);
    } catch (error) {
      result = { status: 'unavailable', sourceId: 'adapter_threw', sourceType: route.sourceType, fetchedAt: now.toISOString(), error: error instanceof Error ? error.message : 'unknown' };
    }
    if (result.status === 'ok') {
      facts.push(...result.data);
      sources.push({ need, sourceId: result.sourceId, sourceType: result.sourceType, status: 'ok' });
    } else if (result.status === 'empty') {
      sources.push({ need, sourceId: result.sourceId, sourceType: result.sourceType, status: 'empty' });
    } else {
      missing.push(need);
      warnings.push(`source_unavailable:${need}:${result.error}`);
      sources.push({ need, sourceId: result.sourceId, sourceType: result.sourceType, status: 'unavailable', reason: 'source_unavailable' });
    }
  }

  return { domain: request.domain, sources, facts, entities: [], missing, warnings, freshness: computeFreshness(sources) };
}

function guessSourceType(domain: SemanticDomain, need: KnowledgeNeed): KnowledgeSourceType {
  return SOURCE_REGISTRY[need]?.find(type => type.startsWith(domain)) ?? SOURCE_REGISTRY[need]?.[0] ?? 'conversation_memory';
}

/** Anti-hallucination lookup: the ONLY correct way to ask "do we have a
 *  verified value for X". Absence here means exactly that -- unverified --
 *  and must never be filled in by guessing. Applies pickByPrecedence when
 *  more than one source grounds the same key. */
export function getGroundedFactValue(bundle: KnowledgeBundle, key: string): { status: 'known'; value: unknown; fact: GroundedFact } | { status: 'unverified' } {
  const candidates = bundle.facts.filter(f => f.key === key);
  const best = pickByPrecedence(candidates);
  return best ? { status: 'known', value: best.value, fact: best } : { status: 'unverified' };
}

// ---------------------------------------------------------------------------
// Resolved entity identity -- conversation entities (Phase C, possibly
// conv:-prefixed/non-canonical) resolved against real candidate lists. Never
// guesses: exact match -> canonical; multiple matches -> ambiguous; no
// match -> honestly retained as non-canonical. Never fabricates an id.
// ---------------------------------------------------------------------------

export type CanonicalCandidate = {
  canonicalId: string;
  name: string;
  domain: SemanticDomain;
  aliases?: readonly string[];
};

export function resolveEntityIdentity(
  conversational: { id: string; name: string; domain: SemanticDomain },
  candidates: readonly CanonicalCandidate[],
): ResolvedEntity {
  const matches = candidates.filter(candidate => candidate.domain === conversational.domain
    && (candidate.name === conversational.name || (candidate.aliases ?? []).includes(conversational.name)));

  if (matches.length === 1) {
    return { requestedId: conversational.id, canonicalId: matches[0]!.canonicalId, canonical: true, ambiguous: false, name: conversational.name, domain: conversational.domain };
  }
  if (matches.length > 1) {
    return { requestedId: conversational.id, canonicalId: null, canonical: false, ambiguous: true, candidates: matches.map(m => m.canonicalId), name: conversational.name, domain: conversational.domain };
  }
  return { requestedId: conversational.id, canonicalId: null, canonical: false, ambiguous: false, name: conversational.name, domain: conversational.domain };
}
