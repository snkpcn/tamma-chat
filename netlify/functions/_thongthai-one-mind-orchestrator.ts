// Phase G.1 — canonical One-Mind orchestration entrypoint.
//
// This module is intentionally NOT wired to customer-visible routing yet.
// It proves that Web/LINE can share one server-authoritative pipeline before
// Phase G.2 cutover:
//
// identity -> conversation context -> semantic interpretation -> task state ->
// grounded knowledge -> dialog decision -> bounded state persistence.
//
// It never writes a booking/order/payment and never composes customer prose.
// The one narrow exception is mirrorActivityTaskToLegacySession below: after
// a LINE-sourced activity_booking task's slots are persisted, it writes
// those slots into the legacy booking_sessions row -- never the `bookings`
// table itself, never a transaction -- so the legacy transactional flow
// (still the only thing that executes a real LINE booking) has a current
// view of what this pipeline already knows. See that function's own doc
// comment in _operations-db.ts for the full one-directional-ownership
// contract this implements.
import type { BrainChannel } from './_thongthai-brain-v3';
import { resolveCanonicalGuestId } from './_thongthai-identity';
import { guestDbIdFromAnonymousId, mirrorActivityTaskToLegacySession, activityAssetFromText } from './_operations-db';
import {
  applyConversationContextUpdate,
  buildSemanticContext,
  loadConversationContext,
  parseConversationContextState,
  persistConversationContext,
  CONTEXT_TTL_MS,
  type ConversationContextState,
} from './_conversation-context';
import {
  loadTaskState,
  parseTaskState,
  persistTaskState,
  suspendActiveTask,
  isTerminalTaskStatus,
  type TaskStateContainer,
  type ActiveTask,
} from './_task-state';
import {
  interpretSemanticTurn,
  toSemanticInterpretationMeta,
  type SemanticContext,
  type SemanticContextEntity,
  type SemanticTaskContext,
  type SemanticTurn,
} from './_semantic-interpreter';
import { deriveDeterministicSemanticTurn } from './_deterministic-semantic-turn';
import {
  matchLearnedConcept, loadActiveSemanticConcepts, recordSemanticConceptEvidence,
  safeConceptEntities, companionConceptKeyForValue, MAX_MATCHABLE_MESSAGE_LENGTH,
  SEMANTIC_CONCEPT_MEMORY_WRITE_TIMEOUT_MS, claimWriteAttemptForEvent,
} from './_semantic-concept-memory';
import { deriveSemanticMeaning, type SemanticMeaning } from './_semantic-meaning';
import {
  LLMAvailabilityError,
  ProviderNotConfiguredError,
} from './_thongthai-model-provider';
import { emitZeroCallTurn } from './_ai-cost-ledger';
import {
  processDialogTurnDetailed,
  type DialogDecision,
  type DialogPlan,
} from './_dialog-manager';
import {
  buildRealKnowledgeSourceAdapters,
  type RealKnowledgeAdapterOptions,
} from './_dialog-source-adapters';
import type { KnowledgeBundle, KnowledgeSourceAdapters } from './_knowledge-resolver';
import {
  planMemoryRelevance,
  semanticTurnForDialog,
  type DurableMemorySnapshot,
  type MemoryRelevancePlan,
} from './_memory-relevance';
import {
  planKnowledgeDegradation,
  planModelDegradation,
  type DegradationPlan,
} from './_graceful-degradation';
import {
  compareAndSwapGuestAgentState,
  loadGuestAgentStateSnapshot,
  type GuestAgentStateSnapshot,
} from './_guest-agent-state-store';

export const ONE_MIND_ORCHESTRATOR_VERSION = 'one-mind-g1-v1';

export type OneMindTurnInput = {
  channel: BrainChannel;
  message: string;
  eventId: string;
  /** Channel-local, already privacy-safe provider key. Raw LINE user ids must
   * still be hashed by the LINE adapter before this layer sees them. */
  providerUserKey?: string;
  /** Optional values when the caller has already done canonical resolution. */
  canonicalAnonymousId?: string;
  guestDbId?: string | null;
  /** G.1 defaults to shadow/read-only state behavior. G.2 may explicitly
   * enable bounded conversation/task persistence after cutover gates pass. */
  persistState?: boolean;
  environment?: 'live' | 'test';
  /** Already-normalized durable customer memory. It is deliberately NOT
   * included in the semantic-interpreter prompt. The current utterance is
   * understood first; relevance is selected only afterwards. */
  durableMemory?: DurableMemorySnapshot | null;
};

export type OneMindIdentity = {
  providerUserKey: string | null;
  canonicalAnonymousId: string | null;
  guestDbId: string | null;
  linked: boolean;
};

export type OneMindTrace = {
  orchestratorVersion: string;
  channel: BrainChannel;
  eventId: string;
  semantic: ReturnType<typeof toSemanticInterpretationMeta>;
  dialogMode: DialogDecision['mode'];
  responseIntent: DialogDecision['responseIntent'];
  reasonCodes: DialogDecision['reasons'];
  knowledgeSources: Array<{
    domain: string;
    sourceId: string;
    status: string;
  }>;
  actionProposed: boolean;
  memory: {
    appliedKeys: string[];
    ignoredKeys: string[];
    relevantConstraintCount: number;
  };
  statePersisted: boolean;
  stateConflictRetries?: number;
  timingsMs?: {
    semantic: number;
    dialogAndKnowledge: number;
    stateRead: number;
    stateWrite: number;
    total: number;
  };
};

export type OneMindTurnResult = {
  identity: OneMindIdentity;
  semanticTurn: SemanticTurn;
  /** semanticTurn with planMemoryRelevance's durable-memory constraints
   *  (e.g. a remembered shrimp allergy) folded in -- the SAME authoritative
   *  constraint set the Dialog Manager itself planned knowledge/task-state
   *  from (see semanticTurnForDialog). Response composition must render
   *  from THIS turn, never the bare semanticTurn above: a recommendation
   *  must never be produced from a constraint set different from the one
   *  the rest of the turn was actually decided against. */
  dialogSemanticTurn: SemanticTurn;
  /** Human Core PR B: the ONE authoritative SemanticMeaning for this turn,
   *  derived once from dialogSemanticTurn (the same memory-merged turn the
   *  Dialog Manager itself planned from). Every consumer that needs to make
   *  a decision -- is this a real commitment, how broad is the request, is
   *  this a correction -- should read it from here instead of re-deriving
   *  its own ad hoc reading of action/speechAct/entities. See
   *  _semantic-meaning.ts for the contract itself. */
  semanticMeaning: SemanticMeaning;
  dialogPlan: DialogPlan;
  dialogDecision: DialogDecision;
  groundedKnowledge: KnowledgeBundle[];
  knowledgeDegradation: DegradationPlan;
  memoryRelevance: MemoryRelevancePlan;
  conversationContextBefore: ConversationContextState;
  conversationContextAfter: ConversationContextState;
  taskStateBefore: TaskStateContainer;
  taskStateAfter: TaskStateContainer;
  trace: OneMindTrace;
};

export type OneMindDependencies = {
  resolveCanonicalGuestId: typeof resolveCanonicalGuestId;
  guestDbIdFromAnonymousId: typeof guestDbIdFromAnonymousId;
  loadConversationContext: typeof loadConversationContext;
  persistConversationContext: typeof persistConversationContext;
  loadTaskState: typeof loadTaskState;
  persistTaskState: typeof persistTaskState;
  interpretSemanticTurn: typeof interpretSemanticTurn;
  buildKnowledgeAdapters: (channel: BrainChannel, options: RealKnowledgeAdapterOptions) => KnowledgeSourceAdapters;
  mirrorActivityTaskToLegacySession: typeof mirrorActivityTaskToLegacySession;
};

const REAL_DEPENDENCIES: OneMindDependencies = {
  resolveCanonicalGuestId,
  guestDbIdFromAnonymousId,
  loadConversationContext,
  persistConversationContext,
  loadTaskState,
  persistTaskState,
  interpretSemanticTurn,
  buildKnowledgeAdapters: buildRealKnowledgeSourceAdapters,
  mirrorActivityTaskToLegacySession,
};

function normalizeMessage(message: string): string {
  return message.trim().slice(0, 4000);
}

function normalizedEntityToken(value:string):string {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');
}

/** Reconcile model-emitted activity asset aliases with the live catalog facts
 * already fetched for this turn. This is data reconciliation, not language
 * interpretation: exact canonical names win; otherwise a model alias may bind
 * only when it uniquely matches a token in the real asset code. */
export function reconcileActivitySemanticEntityNames(
  turn:SemanticTurn,
  bundles:readonly KnowledgeBundle[],
):SemanticTurn {
  if(turn.domain!=='activity') return turn;
  const facts=bundles.filter(bundle=>bundle.domain==='activity').flatMap(bundle=>bundle.facts);
  const assets=[...new Set(facts.map(fact=>fact.key.match(/^activity_asset:([^:]+):name$/)?.[1]).filter(Boolean) as string[])]
    .flatMap(code=>{
      const name=facts.find(fact=>fact.key===`activity_asset:${code}:name`)?.value;
      return typeof name==='string'&&name.trim() ? [{code,name:name.trim()}] : [];
    });
  if(!assets.length) return turn;

  const canonicalName=(raw:string):string|null=>{
    const trimmed=raw.trim();
    if(!trimmed) return null;
    const exact=assets.filter(asset=>normalizedEntityToken(asset.name)===normalizedEntityToken(trimmed));
    if(exact.length===1) return exact[0]!.name;
    const token=normalizedEntityToken(trimmed);
    if(!token) return null;
    const codeMatches=assets.filter(asset=>
      asset.code.split(/[^\p{L}\p{N}]+/u)
        .map(normalizedEntityToken)
        .filter(Boolean)
        .includes(token)
    );
    return codeMatches.length===1 ? codeMatches[0]!.name : null;
  };

  const entityKeys=['horseName','excludedHorse','primaryHorse','fallbackHorse','preferredHorse'] as const;
  const entities={...turn.entities};
  let changed=false;
  for(const key of entityKeys){
    const raw=entities[key];
    if(typeof raw==='string'){
      const canonical=canonicalName(raw);
      if(canonical&&canonical!==raw){
        entities[key]=canonical;
        changed=true;
      }
    }else if(raw&&typeof raw==='object'&&!Array.isArray(raw)){
      const record=raw as Record<string,unknown>;
      if(typeof record.name==='string'){
        const canonical=canonicalName(record.name);
        if(canonical&&canonical!==record.name){
          entities[key]={...record,name:canonical};
          changed=true;
        }
      }
    }
  }
  return changed ? {...turn,entities} : turn;
}

// Only customer-facing, non-secret working values are exposed to the language
// understanding layer. Contact/payment/internal routing slots remain in task
// state but never enter the semantic prompt.
const SEMANTIC_TASK_SLOT_KEYS = new Set([
  'date', 'time', 'partySize', 'durationMinutes', 'quantity',
  'checkIn', 'checkOut', 'endDate', 'nights', 'horseName', 'roomType',
  'bedrooms', 'resourceCode', 'seatPreference',
  'budget', 'budgetBand', 'activityCode', 'serviceType',
]);

function safeSemanticTaskValue(value: unknown): unknown {
  if (typeof value === 'string') return value.slice(0, 160);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value;
  return undefined;
}

function semanticTaskContext(task: ActiveTask | null): SemanticTaskContext | null {
  if (!task) return null;
  const knownSlots: Record<string, unknown> = {};
  for (const [key, rawValue] of Object.entries(task.slots)) {
    if (!SEMANTIC_TASK_SLOT_KEYS.has(key)) continue;
    const value = safeSemanticTaskValue(rawValue);
    if (value !== undefined) knownSlots[key] = value;
  }
  return {
    type:task.type,
    domain:task.domain,
    status:task.status,
    knownSlots,
    missingFields:[...task.missingFields],
    selectedEntities:task.selectedEntities.map(entity => ({ ...entity })),
    constraints:[...task.constraints],
  };
}

export function normalizeTaskStateForConversation(
  taskState: TaskStateContainer,
  now: Date = new Date(),
): { taskState: TaskStateContainer; staleTaskSuspended: boolean } {
  const task = taskState.activeTask;
  if (!task || isTerminalTaskStatus(task.status)) {
    return { taskState, staleTaskSuspended:false };
  }

  const updatedAt = Date.parse(task.updatedAt);
  const stale = !Number.isFinite(updatedAt) || now.getTime() - updatedAt >= CONTEXT_TTL_MS;
  if (!stale) return { taskState, staleTaskSuspended:false };

  // Working-task state can outlive bounded conversation context in storage,
  // but after the same inactivity window it may no longer be the implicit
  // owner of the next customer turn. Suspend it (preserve progress) rather
  // than cancel/delete it; an explicit/domain-specific resume can restore it.
  return { taskState:suspendActiveTask(taskState, now), staleTaskSuspended:true };
}

export async function resolveOneMindIdentity(
  input: OneMindTurnInput,
  deps: Pick<OneMindDependencies, 'resolveCanonicalGuestId' | 'guestDbIdFromAnonymousId'> = REAL_DEPENDENCIES,
): Promise<OneMindIdentity> {
  const providerUserKey = input.providerUserKey?.trim() || null;
  const canonicalAnonymousId = input.canonicalAnonymousId?.trim()
    || (providerUserKey ? (await deps.resolveCanonicalGuestId(input.channel, providerUserKey) ?? providerUserKey) : null);
  const guestDbId = input.guestDbId !== undefined
    ? input.guestDbId
    : (canonicalAnonymousId ? await deps.guestDbIdFromAnonymousId(canonicalAnonymousId) : null);
  return {
    providerUserKey,
    canonicalAnonymousId,
    guestDbId,
    linked: Boolean(providerUserKey && canonicalAnonymousId && providerUserKey !== canonicalAnonymousId),
  };
}

// Catalog-style facts follow the SAME "<prefix>:<id>:name" key convention the
// Response Composer already renders from (see compactGroundedLines in
// _response-composer.ts) -- reusing that established convention here, rather
// than inventing a new one, to turn discovery results (e.g. real horse names
// from the activity catalog) into recallable conversation entities. Without
// this, a customer could never deterministically say "เอาภาราดร" after being
// SHOWN that name this same conversation -- there would be nothing in
// recentEntities to match against.
const CATALOG_NAME_FACT_KEY = /^(restaurant|menu|activity|activity_asset|stay|otop|promo)(?::[^:]+)*:([^:]+):name$/;
const FACT_PREFIX_DOMAIN: Partial<Record<string, SemanticTurn['domain']>> = {
  restaurant: 'restaurant', menu: 'restaurant', activity: 'activity', activity_asset: 'activity',
  stay: 'stay', otop: 'otop', promo:'promotion',
};

function entitiesFromGroundedFacts(bundles: readonly KnowledgeBundle[]): SemanticContextEntity[] {
  const seen = new Set<string>();
  const entities: SemanticContextEntity[] = [];
  for (const bundle of bundles) {
    for (const fact of bundle.facts) {
      const match = fact.key.match(CATALOG_NAME_FACT_KEY);
      if (!match || typeof fact.value !== 'string' || !fact.value.trim()) continue;
      const [, prefix, id] = match;
      const domain = FACT_PREFIX_DOMAIN[prefix!] ?? bundle.domain;
      const entityId = `${prefix}:${id}`;
      if (seen.has(entityId)) continue;
      seen.add(entityId);
      entities.push({ id: entityId, type: prefix!, name: fact.value.trim(), domain, source: 'catalog', canonical: true });
      if (entities.length >= 8) return entities;
    }
  }
  return entities;
}

function entitiesFromSemanticSelection(
  context: ConversationContextState,
  turn: SemanticTurn,
): SemanticContextEntity[] {
  const byId = new Map(context.recentEntities.map(entity => [entity.id, entity] as const));
  const ids = turn.references.flatMap(reference =>
    reference.resolvedEntityId ? [reference.resolvedEntityId] : (reference.resolvedEntityIds ?? []));
  const byReference = ids
    .map(id => byId.get(id))
    .filter((entity): entity is SemanticContextEntity => Boolean(entity))
    .map(({ observedAt: _observedAt, ...entity }) => entity);
  if (byReference.length) return [...new Map(byReference.map(entity => [entity.id, entity] as const)).values()];

  const names = ['horseName','resourceName','roomType','itemName','productName','promotionName','name']
    .map(key => turn.entities[key])
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map(value => value.trim());
  if (!names.length) return [];
  const byName = context.recentEntities
    .filter(entity => names.includes(entity.name))
    .map(({ observedAt: _observedAt, ...entity }) => entity);
  return [...new Map(byName.map(entity => [entity.id, entity] as const)).values()];
}

function nextConversationContext(
  before: ConversationContextState,
  input: OneMindTurnInput,
  semanticTurn: SemanticTurn,
  decision: DialogDecision,
  bundles: readonly KnowledgeBundle[],
  now: Date,
): ConversationContextState {
  const activeTask = decision.taskStateContainer.activeTask;
  const openQuestion = decision.mode === 'collect_field'
    ? decision.missingFields[0] ?? null
    : decision.mode === 'clarify'
      ? 'clarification_required'
      : null;

  // A selection the customer just made takes priority over (and is kept
  // alongside) whatever the catalog returned this same turn.
  const selected = activeTask?.selectedEntities?.length
    ? activeTask.selectedEntities
    : entitiesFromSemanticSelection(before, semanticTurn);
  const selectedIds = new Set(selected.map(entity => entity.id));
  const discovered = entitiesFromGroundedFacts(bundles).filter(entity => !selectedIds.has(entity.id));

  return applyConversationContextUpdate(before, {
    eventId: input.eventId,
    channel: input.channel,
    userMessage: normalizeMessage(input.message),
    activeDomain: semanticTurn.domain === 'unknown' ? undefined : semanticTurn.domain,
    activeTopic: semanticTurn.intent || undefined,
    semanticTurn,
    openQuestion,
    newEntities: [...selected, ...discovered],
    lastAction: semanticTurn.action,
    currentTaskReference: activeTask?.taskId ?? null,
    lastToolResultSummary: decision.actionProposal ? 'action_proposed_not_executed' : undefined,
    summaryFact: semanticTurn.constraints.length
      ? `customer constraints in ${semanticTurn.domain}: ${semanticTurn.constraints.join(', ')}.`
      : undefined,
  }, now);
}

/**
 * Zero-cost architecture (Phase P): the ONE place a One-Mind turn decides
 * whether it needs a real model call at all.
 *
 * 1. Prefer a deterministic derivation (zero LLM calls) whenever the turn is
 *    structurally interpretable from context alone -- slot fills,
 *    corrections, entity selections, a handful of doctrine-level discovery
 *    patterns. See _deterministic-semantic-turn.ts.
 * 2. Otherwise call the real model. If the provider is unavailable
 *    (LLMAvailabilityError/ProviderNotConfiguredError -- includes the
 *    circuit breaker's fast-fail), this NEVER throws out of the orchestrator:
 *    it synthesizes an honest "needs clarification" turn instead, which the
 *    Dialog Manager turns into ONE concise clarifying question rather than a
 *    generic apology or a guess. A non-availability failure (a blocked/
 *    invalid response) still propagates -- that is a different, real error
 *    class the caller must still see.
 */
function hasLiveActiveTask(taskState: TaskStateContainer): boolean {
  const task = taskState.activeTask;
  return Boolean(task && !isTerminalTaskStatus(task.status));
}

/**
 * Human Brain strangler gate.
 *
 * The mature deterministic interpreter remains authoritative whenever it has
 * already classified a turn precisely enough for the proven business/dialog
 * path. We ask the language model to refine ONLY a deliberately coarse
 * classification that would otherwise discard the meaning of the sentence.
 *
 * Phase 1 starts with restaurant_topic_switch because that classifier says
 * only "this is about the restaurant" and intentionally carries no specific
 * question/action/entities. It is exactly the class that swallowed the owner's
 * real sentence "ที่ร้านอาหารพรุ่งนี้ตอน 18.00 โต๊ะเต็มรึยังคะ" before the
 * language model could understand availability/date/time.
 *
 * Cross-domain switches while an operational task is active remain on the
 * proven deterministic suspend/resume path in this checkpoint. Later Human
 * Brain phases can expand this gate only with their own RED/full-CI evidence.
 */
/**
 * Cheap clause-shape detector ONLY for arbitration. It never classifies an
 * intent, domain, entity, or action. Its sole purpose is to notice that a
 * deterministic single-intent candidate may cover only one clause of a
 * natural utterance, so the language model should read the whole sentence.
 *
 * Keeping this separate from semantic interpretation is important: words
 * like "แล้ว/แต่/ทีนี้/ละ ..." do not themselves mean cancel/switch/etc.
 */
function mayContainMultipleClauses(message: string): boolean {
  const normalized = message.trim();
  return /(?:แล้ว(?:ก็)?|แต่|ทีนี้|จากนั้น|อีกอย่าง)\s*/u.test(normalized)
    || /ละ\s+\S/u.test(normalized)
    || /[;,]\s*\S/u.test(normalized);
}

/** Single shared structural gate for BOTH semantic-concept-memory call
 *  sites (the read-path lookup and the write-path learning hook). Fixes a
 *  real gap found in review: the read path previously checked only length,
 *  not clause shape, so a SHORT but multi-clause message ("ไปม้า แต่ไม่จอง")
 *  could still reach matchLearnedConcept even though the write path already
 *  refused to learn from exactly that shape. One predicate, not two
 *  divergent length/clause checks, so the two paths can never disagree
 *  again about what counts as a safe standalone candidate. */
function isShortStandaloneConceptCandidate(message: string): boolean {
  const trimmed = message.trim();
  return trimmed.length > 0
    && trimmed.length <= MAX_MATCHABLE_MESSAGE_LENGTH
    && !mayContainMultipleClauses(message);
}

const LANGUAGE_BRAIN_READ_ONLY_ACTIONS: ReadonlySet<SemanticTurn['action']> = new Set([
  'ask', 'discover', 'recommend', 'compare', 'status',
]);

// These deterministic intents are intentionally broad language buckets. They
// are useful as a provider-outage fallback, but they are NOT rich enough to be
// the final owner of a natural sentence because they can discard predicates,
// qualifiers, constraints, references, or informationNeed.
const COARSE_READ_ONLY_INTENTS: ReadonlySet<string> = new Set([
  'restaurant_topic_switch',
  'stay_topic_switch',
  'otop_topic_switch',
  'cafe_topic_switch',
  'membership_topic_switch',
  'activity_topic_narrow',
  'broad_experience_discovery',
  'ask_price',
  'ask_availability_status',
  'ask_how_it_works',
  'stay_follow_up',
  'otop_follow_up',
  'cafe_follow_up',
  'membership_follow_up',
  'stay_read_only_inquiry',
  'otop_product_discovery',
  'cafe_read_only_inquiry',
  'restaurant_availability_check',
  'task_conditional_continuation',
  'promotion_follow_up',
]);

// A tiny set of read-only deterministic results are already exact machine
// facts rather than language guesses. Keeping them zero-model protects both
// cost and reliability without making phrase routing the owner of broader
// customer meaning.
const EXACT_READ_ONLY_DETERMINISTIC_INTENTS: ReadonlySet<string> = new Set([
  'activity_inventory_count',
  // This intent is emitted only when the deterministic layer has already
  // resolved a unique activity resource from ActiveTask or bounded
  // recommendation evidence AND the customer explicitly says not to transact
  // when unavailable. Letting a language-model clarification override that
  // exact state caused production to forget the already-selected horse.
  'task_conditional_continuation',
  // OpenAI human-fallback experiment (owner directive): "known opening
  // hours when verified data exists... do not turn every customer message
  // into an OpenAI call." A bare check-in/check-out TIME question (see
  // STAY_CHECKIN_CHECKOUT_TIME_MARKER's own comment in
  // _deterministic-semantic-turn.ts) is a single fixed organization fact
  // that never varies by context -- unlike ask_price/stay_read_only_inquiry
  // (deliberately left in COARSE_READ_ONLY_INTENTS above, since those CAN
  // depend on which item/date/context is meant).
  'stay_checkin_checkout_time_lookup',
]);

// Exact context/state operations whose meaning is already canonical. These are
// the production zero-call path; broad natural-language buckets are excluded.
//
// 'select_known_activity_asset' was removed from this set (Human Core PR A):
// it comes from a bounded name lexicon (_deterministic-semantic-turn.ts's
// findKnownActivityAssetSelection), and one of the two known names
// ("ทองไทย") is also the assistant/business's own name. Treating a bare
// mention as an unconditionally-trusted zero-call selection meant any
// message that named the assistant became "select the ทองไทย horse" without
// ever consulting the real semantic model. It remains available as a
// genuine outage-fallback candidate (deriveDeterministicSemanticTurn still
// produces it, and it still answers when the supervisor is unavailable) --
// it is simply no longer trusted enough to skip the model when the model
// IS available.
const EXACT_ZERO_CALL_INTENTS: ReadonlySet<string> = new Set([
  'task_cancel',
  'task_field_correction',
  'task_slot_update',
  'select_prior_entity',
  'resume_active_task',
  'transaction_request_for_prior_entity',
]);

export function deterministicNeedsLanguageRefinement(
  turn: SemanticTurn | null,
  taskState: TaskStateContainer,
  message: string,
): boolean {
  if (!turn) return true;

  if (EXACT_READ_ONLY_DETERMINISTIC_INTENTS.has(turn.intent)) return false;
  // Explicit conversational cancellation is terminal working-state control;
  // wording such as "ไม่เอาแล้ว ยกเลิก" is still one unambiguous operation.
  if (turn.intent === 'task_cancel') return false;
  if (mayContainMultipleClauses(message)) return true;
  if (EXACT_ZERO_CALL_INTENTS.has(turn.intent)) return false;

  // Preserve Phase 2's proven active-task restaurant switch behavior: a pure
  // switch can remain zero-model, while a compound sentence is read as a
  // whole by the Language Brain.
  if (turn.intent === 'restaurant_topic_switch' && hasLiveActiveTask(taskState)) {
    return mayContainMultipleClauses(message);
  }

  // A state-mutating candidate that is not in the exact allow-list above still
  // needs semantic supervision. The downstream transaction layer remains the
  // only execution authority.
  if (!LANGUAGE_BRAIN_READ_ONLY_ACTIONS.has(turn.action)) return true;

  // Coarse read-only candidates are FALLBACKS, not final language ownership.
  // This includes read-only side questions asked while a booking/order task is
  // alive: asking a price must not be silently treated as filling a slot.
  if (COARSE_READ_ONLY_INTENTS.has(turn.intent)) return true;

  return false;
}

function isTrustedConversationalCorrection(
  turn: SemanticTurn,
  deterministic: SemanticTurn | null,
): boolean {
  const deterministicIsSafeCorrectionBase = Boolean(
    deterministic
    && (
      (LANGUAGE_BRAIN_READ_ONLY_ACTIONS.has(deterministic.action)
        && COARSE_READ_ONLY_INTENTS.has(deterministic.intent))
      // A shallow extractor may see only a value or the first named entity
      // while the language supervisor correctly sees "change the previous
      // choice to the later one". confirm/provide_information are both
      // non-transactional bases; the model may safely refine them into a
      // conversational modify/correction, never book/order.
      || deterministic.action === 'provide_information'
      || deterministic.action === 'confirm'
      || deterministic.action === 'correct_previous'
    )
  );
  return Boolean(
    deterministicIsSafeCorrectionBase
    && deterministic
    && (turn.action === 'correct_previous' || turn.action === 'modify')
    // correction/modify is conversational working-state refinement, not a
    // transaction. Some natural Thai corrections are emitted as speechAct
    // "request" ("เปลี่ยนเป็น...นะ") even though the closed ACTION is still
    // safely non-transactional. Reject only an explicit transaction_request.
    && turn.speechAct !== 'transaction_request'
    && turn.domain === deterministic.domain
    && turn.confidence >= 0.9
    && turn.needsClarification === false
    && Object.keys(turn.entities).length > 0
  );
}

function isTrustedConversationalSelection(
  turn: SemanticTurn,
  deterministic: SemanticTurn | null,
): boolean {
  return Boolean(
    deterministic
    && LANGUAGE_BRAIN_READ_ONLY_ACTIONS.has(deterministic.action)
    && COARSE_READ_ONLY_INTENTS.has(deterministic.intent)
    && turn.action === 'confirm'
    && turn.speechAct === 'selection'
    && turn.domain === deterministic.domain
    && turn.confidence >= 0.9
    && turn.needsClarification === false
    && (Object.keys(turn.entities).length > 0 || turn.references.some(reference => Boolean(reference.resolvedEntityId)))
  );
}

function isTrustedReadOnlyDeescalation(
  turn:SemanticTurn,
  deterministic:SemanticTurn | null,
):boolean {
  return Boolean(
    deterministic
    && deterministic.action === 'confirm'
    && turn.domain === deterministic.domain
    && LANGUAGE_BRAIN_READ_ONLY_ACTIONS.has(turn.action)
    && turn.informationNeed === 'availability'
    && turn.confidence >= 0.9
    && turn.needsClarification === false
  );
}

function isTrustedConversationalStateRefinement(
  turn: SemanticTurn,
  deterministic: SemanticTurn | null,
): boolean {
  return isTrustedConversationalCorrection(turn, deterministic)
    || isTrustedConversationalSelection(turn, deterministic)
    || isTrustedReadOnlyDeescalation(turn, deterministic);
}

function reconcileSafeConversationalCorrectionDomain(
  turn:SemanticTurn,
  deterministic:SemanticTurn | null,
):SemanticTurn {
  if (
    !deterministic
    || deterministic.action !== 'correct_previous'
    || turn.action !== 'correct_previous'
    || turn.speechAct !== 'correction'
    || turn.needsClarification
    || turn.confidence < 0.9
    || turn.domain === deterministic.domain
  ) return turn;

  // A natural correction may be emitted as GENERAL because its subject is
  // ellipsed ("เมื่อกี้บอก 5 คน ผิด จริง ๆ 4 คน"). The active deterministic
  // parser knows which canonical task/domain the corrected field belongs to,
  // while the language model knows WHICH value is the replacement. It is safe
  // to combine those two only when the model did not claim a different
  // concrete business domain. This prevents the shallow "first number wins"
  // parser from overwriting a high-confidence human correction while still
  // refusing cross-domain reinterpretation.
  if (turn.domain === 'general' || turn.domain === 'unknown') {
    return {...turn,domain:deterministic.domain};
  }
  return turn;
}

function mergeSafeDeterministicSlots(
  turn:SemanticTurn,
  deterministic:SemanticTurn | null,
):SemanticTurn {
  if(!deterministic || deterministic.domain !== turn.domain) return turn;
  const entities={...turn.entities};
  // These fields are generic structural parsers, not business semantics.
  // Fill ONLY a missing model field; never overwrite the language model.
  for(const key of ['date','time','partySize','durationMinutes','quantity','activityCode'] as const){
    if(entities[key]===undefined && deterministic.entities[key]!==undefined){
      entities[key]=deterministic.entities[key];
    }
  }
  return {...turn,entities};
}

function modelRefinementIsUsable(
  turn: SemanticTurn,
  deterministic: SemanticTurn | null,
): boolean {
  if (!Number.isFinite(turn.confidence)) return false;

  // A real clarification is a valid semantic result. Humans ask when a
  // reference is genuinely unresolved instead of confidently following a
  // coarse keyword guess.
  if (turn.needsClarification === true) {
    return LANGUAGE_BRAIN_READ_ONLY_ACTIONS.has(turn.action)
      && turn.action !== 'unknown'
      && turn.confidence >= 0.6;
  }

  if (turn.domain === 'unknown' || turn.action === 'unknown' || turn.confidence < 0.7) {
    return false;
  }

  // Critical safety boundary: refining a read-only deterministic candidate
  // can NEVER escalate the turn into book/order/confirm/modify/cancel/etc.
  // Write-capable meaning must enter through the existing transactional
  // contracts, not through semantic refinement.
  if (
    deterministic
    && LANGUAGE_BRAIN_READ_ONLY_ACTIONS.has(deterministic.action)
    && !LANGUAGE_BRAIN_READ_ONLY_ACTIONS.has(turn.action)
    && !isTrustedConversationalStateRefinement(turn, deterministic)
  ) {
    return false;
  }

  return true;
}

async function resolveSemanticTurn(
  message: string,
  context: SemanticContext,
  taskState: TaskStateContainer,
  input: Pick<OneMindTurnInput, 'channel'|'eventId'|'canonicalAnonymousId'|'providerUserKey'|'guestDbId'>,
  deps: OneMindDependencies,
  now: Date = new Date(),
): Promise<SemanticTurn> {
  const deterministic = deriveDeterministicSemanticTurn(message, context, taskState, now);
  const conversationId = input.canonicalAnonymousId ?? input.providerUserKey ?? input.guestDbId ?? 'unknown';

  // Production cost architecture: an exact deterministic/contextual result is
  // authoritative and costs zero. Only coarse or genuinely unclassified
  // language reaches the paid semantic boundary.
  if (
    deps.interpretSemanticTurn === REAL_DEPENDENCIES.interpretSemanticTurn
    && !deterministicNeedsLanguageRefinement(deterministic, taskState, message)
  ) {
    emitZeroCallTurn({ conversationId, eventId:input.eventId, channel:input.channel });
    return { ...deterministic!, semanticSource:'deterministic_fallback' };
  }

  // Kernel V2 Phase 3 increment 1: semantic concept memory.
  //
  // Only attempted when NOTHING else already understood this turn
  // (deterministic is null) and only against a REAL fresh decision (never
  // when a caller is reusing an already-known cached semantic turn via a
  // mocked interpretSemanticTurn -- that path must keep its own
  // one-paid-call-per-customer-turn invariant undisturbed). A matched
  // concept can only ever contribute entities.companion (see
  // safeConceptEntities' closed map) -- there is no way for this branch to
  // produce a domain, an action, or anything that could become a
  // transaction, so it is safe to treat as zero-cost exactly like the
  // deterministic layer above.
  if (
    deps.interpretSemanticTurn === REAL_DEPENDENCIES.interpretSemanticTurn
    && !deterministic
    && isShortStandaloneConceptCandidate(message)
  ) {
    const concepts = await loadActiveSemanticConcepts();
    const match = concepts.length ? matchLearnedConcept(message, concepts) : null;
    if (match) {
      emitZeroCallTurn({ conversationId, eventId:input.eventId, channel:input.channel });
      console.log('THONGTHAI_OBSERVABILITY', JSON.stringify({
        semantic_owner: 'semantic_concept_memory',
        deterministic_turn: false,
        model_call_used: false,
        concept_key: match.conceptKey,
        concept_similarity: match.similarity,
        concept_evidence_count: match.evidenceCount,
      }));
      return {
        semanticSource: 'semantic_concept_memory',
        domain: taskState.activeTask?.domain ?? context.activeDomain ?? 'general',
        intent: 'semantic_concept_match',
        action: 'provide_information',
        entities: safeConceptEntities(match.conceptKey),
        references: [],
        constraints: [],
        confidence: match.confidence,
        needsClarification: false,
      };
    }
    if (concepts.length) {
      // A genuine "miss" -- learned concepts exist, this turn's text was a
      // real candidate for one, but none matched confidently enough. Only
      // logged when there was something to miss against, so this stays a
      // meaningful signal rather than noise on every turn before any
      // concept has ever been learned.
      console.log('THONGTHAI_SEMANTIC_CONCEPT_MEMORY_OBSERVABILITY', JSON.stringify({
        event: 'miss', candidate_concept_count: concepts.length,
      }));
    }
  }

  // Human Conversation Recovery: LANGUAGE SUPERVISOR WHEN NEEDED.
  //
  // Every ordinary customer utterance is read by the semantic model first.
  // Deterministic parsing is no longer allowed to become the primary owner of
  // language merely because a phrase happens to match one of its patterns.
  // It remains valuable in exactly two roles:
  //   1) provider-outage / unusable-model fallback; and
  //   2) a transaction-safety guard when model output conflicts with an
  //      already-proven mutating deterministic interpretation.
  //
  // Business execution is still NOT delegated to the model here. This layer
  // only decides what the customer meant; the Dialog Manager / legacy
  // transaction boundary still decides whether anything may be executed.
  try {
    const rawModelTurn = await deps.interpretSemanticTurn(message, context, {
      callContext:{
        conversationId,
        guestDbId:input.guestDbId ?? null,
        channel:input.channel,
        eventId:input.eventId,
        callerLabel:'semantic-interpreter',
      },
    });
    const correctionReconciledTurn = reconcileSafeConversationalCorrectionDomain(rawModelTurn, deterministic);
    const modelTurn = mergeSafeDeterministicSlots(correctionReconciledTurn, deterministic);

    if (!modelRefinementIsUsable(modelTurn, deterministic)) {
      // "Not usable" means the model's STRUCTURED classification (domain/
      // action/entities/references) is not trusted enough to drive task
      // state or business routing -- it says nothing about whether the
      // model's own natural-language `reply` is safe to show the customer.
      // The model's prompt already constrains `reply` to never claim price,
      // availability, booking/order/payment status, promotion eligibility,
      // membership state, or incident status, and leaves it empty whenever
      // verified business truth is required (see buildProductionSemantic-
      // InterpreterPrompt's "reply:" section) -- so a non-empty reply is
      // itself the model's own signal that this turn was conversation-safe.
      // Discarding it here and manufacturing a robotic "clarification
      // needed" instead was the single biggest source of the Language Brain
      // going silent on casual chat, summaries, and state-recall questions:
      // exactly the turns most likely to trip the classification-confidence
      // checks in modelRefinementIsUsable while still having a perfectly
      // good, safe reply already generated in the same call. Routing/task
      // fields remain exactly as conservative as before this change -- only
      // the customer-facing text is preserved when it exists.
      const preservedReply = modelTurn.reply?.trim() || undefined;
      if (deterministic) {
        console.log('THONGTHAI_OBSERVABILITY', JSON.stringify({
          semantic_owner: 'deterministic_unusable_model_fallback',
          deterministic_turn: true,
          model_call_used: true,
          model_confidence: modelTurn.confidence,
          deterministic_intent: deterministic.intent,
          model_reply_preserved: Boolean(preservedReply),
        }));
        return { ...deterministic, semanticSource:'deterministic_fallback', reply:preservedReply };
      }

      // No deterministic interpretation exists and the model result is not
      // strong enough to own state. Convert it to a read-only clarification:
      // low confidence can never start/update/cancel a working task. Its
      // reply, if present, still rides along (see comment above).
      console.log('THONGTHAI_OBSERVABILITY', JSON.stringify({
        semantic_owner: 'clarification_untrusted_model',
        deterministic_turn: false,
        model_call_used: true,
        model_confidence: modelTurn.confidence,
        model_reply_preserved: Boolean(preservedReply),
      }));
      return {
        semanticSource:'openai_supervisor',
        domain:taskState.activeTask?.domain ?? context.activeDomain ?? 'unknown',
        intent:'clarification_needed_untrusted_semantics',
        action:'ask',
        reply:preservedReply,
        entities:{},
        references:[],
        constraints:[],
        confidence:Number.isFinite(modelTurn.confidence) ? modelTurn.confidence : 0,
        needsClarification:true,
        clarificationReason:'untrusted_semantics',
      };
    }

    // A model must never silently reinterpret an already-proven mutating
    // command into a DIFFERENT mutation. Natural-language understanding
    // still happens first, but when BOTH sides claim some mutating action
    // and disagree on which one, execution-sensitive conflicts fall back to
    // the deterministic interpretation until the downstream transaction
    // layer explicitly proves equivalence.
    //
    // Human Core PR B: this used to fire whenever EITHER side's action was
    // mutating, not only when both were -- so a bounded deterministic
    // lexicon match guessing a mutation (e.g. a name lexicon mistaking a
    // question for a selection) could silently discard an already-usable,
    // correctly READ-ONLY model result (modelRefinementIsUsable above has
    // already confirmed it: finite confidence, not low-confidence/unclear,
    // domain/action known). That direction -- deterministic overriding a
    // successful semantic result -- is exactly the invariant "the
    // deterministic brain cannot override a successful semantic result"
    // this guard must never violate; the escalation direction (a READ-ONLY
    // deterministic candidate the model tries to escalate into a mutation)
    // is already independently blocked above, in modelRefinementIsUsable's
    // own safety boundary. So this guard now only has one real job left:
    // when the model's OWN result is itself a mutation that disagrees with
    // deterministic's mutation, prefer the proven deterministic one.
    const mutatingActions = new Set<SemanticTurn['action']>([
      'book', 'order', 'confirm', 'modify', 'cancel', 'correct_previous',
    ]);
    const trustedConversationalStateRefinement = isTrustedConversationalStateRefinement(modelTurn, deterministic);
    if (
      deterministic
      && !trustedConversationalStateRefinement
      && mutatingActions.has(modelTurn.action)
      && mutatingActions.has(deterministic.action)
      && (modelTurn.domain !== deterministic.domain || modelTurn.action !== deterministic.action)
    ) {
      console.log('THONGTHAI_OBSERVABILITY', JSON.stringify({
        semantic_owner: 'deterministic_transaction_conflict_guard',
        deterministic_turn: true,
        model_call_used: true,
        model_action: modelTurn.action,
        deterministic_action: deterministic.action,
      }));
      return { ...deterministic, semanticSource:'deterministic_fallback' };
    }

    console.log('THONGTHAI_OBSERVABILITY', JSON.stringify({
      semantic_owner: deterministic ? 'language_model_over_deterministic_candidate' : 'language_model',
      deterministic_candidate: Boolean(deterministic),
      deterministic_turn: false,
      model_call_used: true,
      model_confidence: modelTurn.confidence,
    }));

    // Kernel V2 Phase 3 increment 1: learn ONLY from a turn nothing else
    // (not even the deterministic layer) already classified, that the real
    // model itself confirmed with high confidence, was a short standalone
    // statement (never a compound sentence -- attributing a multi-clause
    // turn's meaning to one fragment would be unsafe overgeneralization),
    // and whose companion value is already in the closed, safe vocabulary
    // this module can ever reproduce. Excludes a cachedSemantic-mocked
    // interpretSemanticTurn (deterministicActivityResponse and others reuse
    // an already-confirmed turn this way to avoid a second paid call).
    //
    // This branch CAN still legitimately run more than once for the exact
    // same customer turn: the early "understand-first" gate and the later
    // main cutover attempt both call the REAL interpreter for the same
    // eventId, and _ai-cost-ledger.ts's own idempotency replays the FIRST
    // call's result for the second rather than paying twice (see
    // ai_duplicate_call_prevented in its cost log) -- from here that still
    // looks like "deps is real and the call succeeded". This is safe, not
    // just tolerated: recordSemanticConceptEvidence's write is idempotent on
    // (concept_key, normalized_signature) via the migration's own unique
    // source_signal_key + on_conflict=ignore-duplicates, so a repeat write
    // for the same confirmed exemplar is a harmless no-op, never a second
    // row.
    //
    // Durability fix (found in review): this used to be a fire-and-forget
    // `.catch(() => undefined)` with no await. In a serverless runtime,
    // nothing guarantees an unawaited promise keeps running once the
    // customer response has been sent -- the process can be frozen or
    // recycled first, silently losing the learning write with no signal
    // that it ever happened. It is now awaited, bounded by a short timeout
    // so a slow/stuck write can never add unbounded latency to the
    // customer-facing turn, and its outcome (completed/timed-out) is always
    // logged. recordSemanticConceptEvidence itself never throws (it has its
    // own internal try/catch), so awaiting it cannot fail the customer
    // response; only its OWN write failures are swallowed, exactly as
    // before.
    if (
      deps.interpretSemanticTurn === REAL_DEPENDENCIES.interpretSemanticTurn
      && !deterministic
      && isShortStandaloneConceptCandidate(message)
      && modelTurn.confidence >= 0.85
      && modelTurn.needsClarification !== true
      && !mutatingActions.has(modelTurn.action)
    ) {
      const companionValue = modelTurn.entities.companion ?? modelTurn.entities.companionType;
      const conceptKey = typeof companionValue === 'string' ? companionConceptKeyForValue(companionValue) : null;
      // Fix (found in review): without this claim, the SAME customer turn's
      // second resolveSemanticTurn invocation (see the comment above) would
      // start a SECOND independent timeout race, so a genuinely stuck write
      // could add up to 2x SEMANTIC_CONCEPT_MEMORY_WRITE_TIMEOUT_MS to one
      // response instead of a single bounded wait. Claiming by eventId here
      // means at most one write ATTEMPT (and therefore at most one timeout
      // wait) ever happens per real transport event, however many times the
      // understanding itself gets recomputed for it.
      if (conceptKey && claimWriteAttemptForEvent(`${conversationId}:${input.eventId}`)) {
        const writeStartedAt = Date.now();
        let timedOut = false;
        const timeoutGuard = new Promise<void>(resolve => {
          setTimeout(() => { timedOut = true; resolve(); }, SEMANTIC_CONCEPT_MEMORY_WRITE_TIMEOUT_MS);
        });
        await Promise.race([recordSemanticConceptEvidence(conceptKey, message), timeoutGuard]);
        console.log('THONGTHAI_SEMANTIC_CONCEPT_MEMORY_OBSERVABILITY', JSON.stringify({
          event: timedOut ? 'write_timeout' : 'write_awaited',
          concept_key: conceptKey,
          elapsed_ms: Date.now() - writeStartedAt,
        }));
      }
    }

    return { ...modelTurn, semanticSource:'openai_supervisor' };
  } catch (error) {
    if (!(error instanceof LLMAvailabilityError) && !(error instanceof ProviderNotConfiguredError)) throw error;

    if (deterministic) {
      console.log('THONGTHAI_OBSERVABILITY', JSON.stringify({
        semantic_owner: 'deterministic_provider_fallback',
        deterministic_turn: true,
        model_call_used: true,
        provider_unavailable: true,
        deterministic_intent: deterministic.intent,
      }));
      return { ...deterministic, semanticSource:'deterministic_fallback' };
    }

    console.log('THONGTHAI_OBSERVABILITY', JSON.stringify({
      semantic_owner: 'clarification_provider_fallback',
      deterministic_turn: false,
      model_call_used: true,
      clarification_without_model: true,
    }));
    const domain = taskState.activeTask?.domain ?? context.activeDomain ?? 'unknown';
    return {
      semanticSource:'provider_unavailable',
      domain,
      intent: 'clarification_needed_provider_unavailable',
      action: 'ask',
      entities: {},
      references: [],
      constraints: [],
      confidence: 0,
      needsClarification: true,
      clarificationReason: 'provider_unavailable',
    };
  }
}

/** Only semantics that passed the structural/confidence gate may mutate
 * conversation/task state. Provider outage and weak model results remain
 * response-only clarification events. */
export function semanticTurnTrustedForState(turn:SemanticTurn):boolean {
  if (turn.semanticSource === 'provider_unavailable') return false;
  if (!Number.isFinite(turn.confidence) || turn.confidence < 0.7) return false;
  if (turn.domain === 'unknown' || turn.action === 'unknown') return false;
  return true;
}

async function computeOneMindTurnFromState(
  input: OneMindTurnInput,
  identity: OneMindIdentity,
  conversationContextBefore: ConversationContextState,
  taskStateBefore: TaskStateContainer,
  deps: OneMindDependencies,
  now: Date,
): Promise<OneMindTurnResult> {
  const computeStartedAt = Date.now();
  const message = normalizeMessage(input.message);
  const semanticContext: SemanticContext = {
    ...buildSemanticContext(conversationContextBefore, now),
    activeTask:semanticTaskContext(taskStateBefore.activeTask),
    suspendedTask:semanticTaskContext(taskStateBefore.suspendedTask),
  };
  const semanticStartedAt = Date.now();
  const semanticTurn = await resolveSemanticTurn(message, semanticContext, taskStateBefore, input, deps, now);
  const semanticMs = Date.now() - semanticStartedAt;

  // Human Brain Phase 3: durable memory is evaluated only AFTER current-turn
  // meaning exists. It cannot alter domain/intent/action/informationNeed.
  // Only the relevance-selected subset is allowed into downstream planning.
  const memoryRelevance = planMemoryRelevance(semanticTurn, input.durableMemory);
  const dialogSemanticTurn = semanticTurnForDialog(semanticTurn, memoryRelevance);

  const adapters = deps.buildKnowledgeAdapters(input.channel, {
    guestDbId: identity.guestDbId,
    environment: input.environment ?? 'live',
  });

  const dialogStartedAt = Date.now();
  const dialog = await processDialogTurnDetailed({
    semanticTurn: dialogSemanticTurn,
    conversationContext: conversationContextBefore,
    taskState: taskStateBefore,
    channel: input.channel,
    eventId: input.eventId,
  }, adapters, now);
  const dialogAndKnowledgeMs = Date.now() - dialogStartedAt;

  const reconciledSemanticTurn = reconcileActivitySemanticEntityNames(semanticTurn, dialog.bundles);
  const reconciledDialogSemanticTurn = reconcileActivitySemanticEntityNames(dialogSemanticTurn, dialog.bundles);

  const stateTrusted = semanticTurnTrustedForState(reconciledSemanticTurn);
  const taskStateAfter = stateTrusted ? dialog.decision.taskStateContainer : taskStateBefore;
  const conversationContextAfter = stateTrusted
    ? nextConversationContext(
        conversationContextBefore,
        input,
        reconciledSemanticTurn,
        dialog.decision,
        dialog.bundles,
        now,
      )
    : conversationContextBefore;

  return {
    identity,
    semanticTurn:reconciledSemanticTurn,
    dialogSemanticTurn:reconciledDialogSemanticTurn,
    semanticMeaning: deriveSemanticMeaning(reconciledDialogSemanticTurn),
    dialogPlan: dialog.plan,
    dialogDecision: dialog.decision,
    groundedKnowledge: dialog.bundles,
    knowledgeDegradation: planKnowledgeDegradation(dialog.bundles),
    memoryRelevance,
    conversationContextBefore,
    conversationContextAfter,
    taskStateBefore,
    taskStateAfter,
    trace: {
      orchestratorVersion: ONE_MIND_ORCHESTRATOR_VERSION,
      channel: input.channel,
      eventId: input.eventId,
      semantic: toSemanticInterpretationMeta(reconciledSemanticTurn),
      dialogMode: dialog.decision.mode,
      responseIntent: dialog.decision.responseIntent,
      reasonCodes: dialog.decision.reasons,
      knowledgeSources: dialog.bundles.flatMap(bundle => bundle.sources.map(source => ({
        domain: bundle.domain,
        sourceId: source.sourceId,
        status: source.status,
      }))),
      actionProposed: Boolean(dialog.decision.actionProposal),
      memory: {
        appliedKeys: [...memoryRelevance.appliedKeys],
        ignoredKeys: [...memoryRelevance.ignoredKeys],
        relevantConstraintCount: memoryRelevance.relevantConstraints.length,
      },
      statePersisted: false,
      stateConflictRetries: 0,
      timingsMs:{
        semantic:semanticMs,
        dialogAndKnowledge:dialogAndKnowledgeMs,
        stateRead:0,
        stateWrite:0,
        total:Date.now() - computeStartedAt,
      },
    },
  };
}

/** Canonical One-Mind turn orchestrator. This compatibility form preserves the
 * original Phase G.1 dependency-injection surface for network-free tests and
 * shadow work. G.2 customer-authoritative traffic uses
 * processThongthaiOneMindTurnAuthoritative() below so concurrent requests
 * cannot overwrite each other's context/task state. */
export async function processThongthaiOneMindTurn(
  input: OneMindTurnInput,
  dependencies: Partial<OneMindDependencies> = {},
  now: Date = new Date(),
): Promise<OneMindTurnResult> {
  const deps: OneMindDependencies = { ...REAL_DEPENDENCIES, ...dependencies };
  const message = normalizeMessage(input.message);
  if (!message) throw new Error('one_mind_message_required');
  if (!input.eventId.trim()) throw new Error('one_mind_event_id_required');

  const identity = await resolveOneMindIdentity(input, deps);
  const [conversationContextBefore, loadedTaskState] = await Promise.all([
    deps.loadConversationContext(identity.guestDbId, now),
    deps.loadTaskState(identity.guestDbId),
  ]);
  const { taskState:taskStateBefore, staleTaskSuspended } = normalizeTaskStateForConversation(loadedTaskState, now);
  const result = await computeOneMindTurnFromState(
    input, identity, conversationContextBefore, taskStateBefore, deps, now,
  );

  const persistState = input.persistState === true
    && (staleTaskSuspended || semanticTurnTrustedForState(result.semanticTurn));
  if (persistState) {
    await deps.persistConversationContext(identity.guestDbId, result.conversationContextAfter);
    await deps.persistTaskState(identity.guestDbId, result.taskStateAfter);
  }
  return {
    ...result,
    trace:{ ...result.trace, statePersisted:persistState },
  };
}

export type AuthoritativeStateDependencies = {
  loadSnapshot: typeof loadGuestAgentStateSnapshot;
  compareAndSwap: typeof compareAndSwapGuestAgentState;
};

const REAL_AUTHORITATIVE_STATE_DEPENDENCIES: AuthoritativeStateDependencies = {
  loadSnapshot:loadGuestAgentStateSnapshot,
  compareAndSwap:compareAndSwapGuestAgentState,
};

function activityAssetFromSlots(task: ActiveTask): { name: string; assetCode: string } | null {
  const horseName = task.slots.horseName;
  if (typeof horseName !== 'string' || !horseName) return null;
  // A raw horse NAME is all taskState ever stores (see
  // _deterministic-semantic-turn.ts's entities.horseName) -- resolve it
  // through the SAME owner-verified lexicon the legacy flow and the web
  // deterministic fallback both already use, rather than inventing a
  // second name->asset mapping here.
  return activityAssetFromText(horseName);
}

/**
 * After a LINE-sourced activity_booking task's slots are freshly persisted,
 * mirror them into the legacy booking_sessions row (see
 * mirrorActivityTaskToLegacySession's own doc comment in _operations-db.ts
 * for the full one-directional-ownership contract). A no-op for every other
 * channel/domain/terminal-task case -- this never runs for web, and never
 * for a task type other than activity_booking.
 */
async function mirrorActivityTaskIfLineSourced(
  channel: BrainChannel,
  guestDbId: string | null,
  taskStateAfter: TaskStateContainer,
  environment: 'live' | 'test' | undefined,
  deps: OneMindDependencies,
): Promise<void> {
  if (channel !== 'line' || !guestDbId) return;
  const task = taskStateAfter.activeTask;
  if (!task || task.type !== 'activity_booking' || task.sourceChannel !== 'line') return;
  if (isTerminalTaskStatus(task.status)) return;

  const durationRaw = Number(task.slots.durationMinutes);
  const durationMinutes = durationRaw === 30 || durationRaw === 60 || durationRaw === 90 ? (durationRaw as 30 | 60 | 90) : null;

  await deps.mirrorActivityTaskToLegacySession({
    guestDbId,
    environment,
    resourceCode: typeof task.slots.resourceCode === 'string' ? task.slots.resourceCode : null,
    durationMinutes,
    date: typeof task.slots.date === 'string' ? task.slots.date : null,
    time: typeof task.slots.time === 'string' ? task.slots.time : null,
    partySize: typeof task.slots.partySize === 'number' ? task.slots.partySize : null,
    asset: activityAssetFromSlots(task),
  });
}

/** G.2-safe authoritative variant.
 *
 * It reads ConversationContext + TaskState from ONE row snapshot, computes the
 * turn, then atomically CAS-writes both sibling keys against that same
 * updated_at revision. If another web/LINE/runtime request changed the row
 * meanwhile, the entire turn is reloaded and recomputed from the newer state.
 * This prevents lost fast-message updates across server instances without
 * holding a database lock while a model/source call is in flight. */
export async function processThongthaiOneMindTurnAuthoritative(
  input: OneMindTurnInput,
  dependencies: Partial<OneMindDependencies> = {},
  stateDependencies: Partial<AuthoritativeStateDependencies> = {},
  now: Date = new Date(),
  maxAttempts = 4,
  persistPredicate: (result: OneMindTurnResult) => boolean = () => true,
): Promise<OneMindTurnResult> {
  const deps: OneMindDependencies = { ...REAL_DEPENDENCIES, ...dependencies };
  const stateDeps: AuthoritativeStateDependencies = {
    ...REAL_AUTHORITATIVE_STATE_DEPENDENCIES,
    ...stateDependencies,
  };
  const message = normalizeMessage(input.message);
  if (!message) throw new Error('one_mind_message_required');
  if (!input.eventId.trim()) throw new Error('one_mind_event_id_required');

  const totalStartedAt = Date.now();
  const identity = await resolveOneMindIdentity(input, deps);
  const attempts = Math.max(1, Math.min(8, Math.floor(maxAttempts)));
  let stateReadMs = 0;
  let stateWriteMs = 0;
  let semanticMs = 0;
  let dialogAndKnowledgeMs = 0;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const stateReadStartedAt = Date.now();
    const snapshot: GuestAgentStateSnapshot = await stateDeps.loadSnapshot(identity.guestDbId);
    stateReadMs += Date.now() - stateReadStartedAt;
    const conversationContextBefore = parseConversationContextState(snapshot.state.conversationContext, now);
    const loadedTaskState = parseTaskState(snapshot.state.taskState);
    const { taskState:taskStateBefore, staleTaskSuspended } = normalizeTaskStateForConversation(loadedTaskState, now);
    const result = await computeOneMindTurnFromState(
      input, identity, conversationContextBefore, taskStateBefore, deps, now,
    );
    semanticMs += result.trace.timingsMs?.semantic ?? 0;
    dialogAndKnowledgeMs += result.trace.timingsMs?.dialogAndKnowledge ?? 0;

    // Staleness normalization is a state-safety operation, not a response
    // cutover decision. Persist it even when this turn itself falls through
    // to legacy (e.g. a greeting/support turn outside initial cutover).
    const shouldPersist = input.persistState === true
      && (staleTaskSuspended
        || (semanticTurnTrustedForState(result.semanticTurn) && persistPredicate(result)));
    if (!shouldPersist || !identity.guestDbId) {
      return {
        ...result,
        trace:{
          ...result.trace,
          statePersisted:false,
          stateConflictRetries:attempt,
          timingsMs:{
            semantic:semanticMs,
            dialogAndKnowledge:dialogAndKnowledgeMs,
            stateRead:stateReadMs,
            stateWrite:stateWriteMs,
            total:Date.now() - totalStartedAt,
          },
        },
      };
    }

    const stateWriteStartedAt = Date.now();
    const write = await stateDeps.compareAndSwap(identity.guestDbId, snapshot, {
      set:{
        conversationContext:result.conversationContextAfter,
        taskState:result.taskStateAfter,
      },
    }, now);
    stateWriteMs += Date.now() - stateWriteStartedAt;

    if (write.status === 'applied') {
      await mirrorActivityTaskIfLineSourced(input.channel, identity.guestDbId, result.taskStateAfter, input.environment, deps);
      return {
        ...result,
        trace:{
          ...result.trace,
          statePersisted:true,
          stateConflictRetries:attempt,
          timingsMs:{
            semantic:semanticMs,
            dialogAndKnowledge:dialogAndKnowledgeMs,
            stateRead:stateReadMs,
            stateWrite:stateWriteMs,
            total:Date.now() - totalStartedAt,
          },
        },
      };
    }
    if (write.status === 'unconfigured') {
      return {
        ...result,
        trace:{
          ...result.trace,
          statePersisted:false,
          stateConflictRetries:attempt,
          timingsMs:{
            semantic:semanticMs,
            dialogAndKnowledge:dialogAndKnowledgeMs,
            stateRead:stateReadMs,
            stateWrite:stateWriteMs,
            total:Date.now() - totalStartedAt,
          },
        },
      };
    }
    // conflict => loop, reload the newer canonical state, and recompute.
  }

  throw new Error('one_mind_state_conflict_exhausted');
}

export type OneMindResilientOptions = {
  /** Set only by a trusted compatibility layer that has already determined an
   * existing tested deterministic fallback can understand this exact turn. */
  deterministicFallbackAvailable?: boolean;
  /** Set only when an existing deterministic transaction-continuation parser
   * can safely continue the current active task without model interpretation. */
  deterministicContinuationAvailable?: boolean;
};

export type OneMindResilientResult =
  | { status: 'ok'; result: OneMindTurnResult }
  | {
      status: 'degraded';
      identity: OneMindIdentity;
      conversationContext: ConversationContextState;
      taskState: TaskStateContainer;
      degradation: DegradationPlan;
    };

/** Failure-safe wrapper for Phase H. Provider failover happens inside the
 * neutral model-provider first. Only after that stack is exhausted does this
 * return a structured degradation result. No customer prose and no writes are
 * performed on the degraded path. */
export async function processThongthaiOneMindTurnResilient(
  input: OneMindTurnInput,
  options: OneMindResilientOptions = {},
  dependencies: Partial<OneMindDependencies> = {},
  now: Date = new Date(),
): Promise<OneMindResilientResult> {
  const deps: OneMindDependencies = { ...REAL_DEPENDENCIES, ...dependencies };
  try {
    return { status: 'ok', result: await processThongthaiOneMindTurn(input, deps, now) };
  } catch (error) {
    const identity = await resolveOneMindIdentity(input, deps);
    const [conversationContext, taskState] = await Promise.all([
      deps.loadConversationContext(identity.guestDbId, now),
      deps.loadTaskState(identity.guestDbId),
    ]);
    return {
      status: 'degraded',
      identity,
      conversationContext,
      taskState,
      degradation: planModelDegradation(error, {
        taskState,
        deterministicFallbackAvailable: options.deterministicFallbackAvailable,
        deterministicContinuationAvailable: options.deterministicContinuationAvailable,
      }),
    };
  }
}
