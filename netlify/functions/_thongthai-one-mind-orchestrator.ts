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
  LLMAvailabilityError,
  ProviderNotConfiguredError,
} from './_thongthai-model-provider';
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

// Only customer-facing, non-secret working values are exposed to the language
// understanding layer. Contact/payment/internal routing slots remain in task
// state but never enter the semantic prompt.
const SEMANTIC_TASK_SLOT_KEYS = new Set([
  'date', 'time', 'partySize', 'durationMinutes', 'quantity',
  'checkIn', 'checkOut', 'horseName', 'roomType', 'seatPreference',
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
const CATALOG_NAME_FACT_KEY = /^(restaurant|menu|activity|activity_asset|stay|otop)(?::[^:]+)*:([^:]+):name$/;
const FACT_PREFIX_DOMAIN: Partial<Record<string, SemanticTurn['domain']>> = {
  restaurant: 'restaurant', menu: 'restaurant', activity: 'activity', activity_asset: 'activity',
  stay: 'stay', otop: 'otop',
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
  const selected = activeTask?.selectedEntities ?? [];
  const selectedIds = new Set(selected.map(entity => entity.id));
  const discovered = entitiesFromGroundedFacts(bundles).filter(entity => !selectedIds.has(entity.id));

  return applyConversationContextUpdate(before, {
    eventId: input.eventId,
    channel: input.channel,
    userMessage: normalizeMessage(input.message),
    activeDomain: semanticTurn.domain === 'unknown' ? undefined : semanticTurn.domain,
    activeTopic: semanticTurn.intent || undefined,
    openQuestion,
    newEntities: [...selected, ...discovered],
    lastAction: semanticTurn.action,
    currentTaskReference: activeTask?.taskId ?? null,
    lastToolResultSummary: decision.actionProposal ? 'action_proposed_not_executed' : undefined,
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
]);

// A tiny set of read-only deterministic results are already exact machine
// facts rather than language guesses. Keeping them zero-model protects both
// cost and reliability without making phrase routing the owner of broader
// customer meaning.
const EXACT_READ_ONLY_DETERMINISTIC_INTENTS: ReadonlySet<string> = new Set([
  'activity_inventory_count',
]);

function deterministicNeedsLanguageRefinement(
  turn: SemanticTurn | null,
  taskState: TaskStateContainer,
  message: string,
): boolean {
  if (!turn) return true;

  if (EXACT_READ_ONLY_DETERMINISTIC_INTENTS.has(turn.intent)) return false;

  // Preserve Phase 2's proven active-task restaurant switch behavior: a pure
  // switch can remain zero-model, while a compound sentence is read as a
  // whole by the Language Brain.
  if (turn.intent === 'restaurant_topic_switch' && hasLiveActiveTask(taskState)) {
    return mayContainMultipleClauses(message);
  }

  // Transactional / state-mutating meaning remains deterministic whenever the
  // mature parser already has it. The Language Brain is not allowed to become
  // a write-policy engine.
  if (!LANGUAGE_BRAIN_READ_ONLY_ACTIONS.has(turn.action)) return false;

  // Coarse read-only candidates are FALLBACKS, not final language ownership.
  // This includes read-only side questions asked while a booking/order task is
  // alive: asking a price must not be silently treated as filling a slot.
  if (COARSE_READ_ONLY_INTENTS.has(turn.intent)) return true;

  return false;
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
  ) {
    return false;
  }

  return true;
}

async function resolveSemanticTurn(
  message: string,
  context: SemanticContext,
  taskState: TaskStateContainer,
  deps: OneMindDependencies,
  now: Date = new Date(),
): Promise<SemanticTurn> {
  const deterministic = deriveDeterministicSemanticTurn(message, context, taskState, now);

  // Preserve every mature deterministic path unless this checkpoint has
  // explicitly proven that its classification is too coarse.
  if (deterministic && !deterministicNeedsLanguageRefinement(deterministic, taskState, message)) {
    console.log('THONGTHAI_OBSERVABILITY', JSON.stringify({
      semantic_owner: 'deterministic_proven_path',
      deterministic_turn: true,
      model_call_used: false,
      intent: deterministic.intent,
    }));
    return deterministic;
  }

  // No deterministic interpretation has always required real language
  // understanding. A coarse restaurant topic classification now does too.
  try {
    const modelTurn = await deps.interpretSemanticTurn(message, context);

    // A weak model interpretation never replaces a useful deterministic
    // fallback. This gives us the larger language brain without gambling away
    // the mature system on low-confidence/ambiguous output.
    if (deterministic && !modelRefinementIsUsable(modelTurn, deterministic)) {
      console.log('THONGTHAI_OBSERVABILITY', JSON.stringify({
        semantic_owner: 'deterministic_low_confidence_fallback',
        deterministic_turn: true,
        model_call_used: true,
        model_confidence: modelTurn.confidence,
        deterministic_intent: deterministic.intent,
      }));
      return deterministic;
    }

    console.log('THONGTHAI_OBSERVABILITY', JSON.stringify({
      semantic_owner: deterministic ? 'language_model_refinement' : 'language_model',
      deterministic_candidate: Boolean(deterministic),
      deterministic_turn: false,
      model_call_used: true,
      model_confidence: modelTurn.confidence,
    }));
    return modelTurn;
  } catch (error) {
    if (!(error instanceof LLMAvailabilityError) && !(error instanceof ProviderNotConfiguredError)) throw error;

    // Provider outage never destroys a path the old system could already
    // understand. Fall straight back to the exact deterministic candidate.
    if (deterministic) {
      console.log('THONGTHAI_OBSERVABILITY', JSON.stringify({
        semantic_owner: 'deterministic_provider_fallback',
        deterministic_turn: true,
        model_call_used: false,
        provider_unavailable: true,
        deterministic_intent: deterministic.intent,
      }));
      return deterministic;
    }

    console.log('THONGTHAI_OBSERVABILITY', JSON.stringify({
      semantic_owner: 'clarification_provider_fallback',
      deterministic_turn: false,
      model_call_used: false,
      clarification_without_model: true,
    }));
    const domain = taskState.activeTask?.domain ?? context.activeDomain ?? 'unknown';
    return {
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
  const semanticTurn = await resolveSemanticTurn(message, semanticContext, taskStateBefore, deps, now);
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

  const taskStateAfter = dialog.decision.taskStateContainer;
  const conversationContextAfter = nextConversationContext(
    conversationContextBefore,
    input,
    semanticTurn,
    dialog.decision,
    dialog.bundles,
    now,
  );

  return {
    identity,
    semanticTurn,
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
      semantic: toSemanticInterpretationMeta(semanticTurn),
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
  const { taskState:taskStateBefore } = normalizeTaskStateForConversation(loadedTaskState, now);
  const result = await computeOneMindTurnFromState(
    input, identity, conversationContextBefore, taskStateBefore, deps, now,
  );

  const persistState = input.persistState === true;
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
    const shouldPersist = input.persistState === true && (staleTaskSuspended || persistPredicate(result));
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
