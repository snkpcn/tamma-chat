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
import type { BrainChannel } from './_thongthai-brain-v3';
import { resolveCanonicalGuestId } from './_thongthai-identity';
import { guestDbIdFromAnonymousId } from './_operations-db';
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
} from './_task-state';
import {
  interpretSemanticTurn,
  toSemanticInterpretationMeta,
  type SemanticContext,
  type SemanticContextEntity,
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
};

function normalizeMessage(message: string): string {
  return message.trim().slice(0, 4000);
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
async function resolveSemanticTurn(
  message: string,
  context: SemanticContext,
  taskState: TaskStateContainer,
  deps: OneMindDependencies,
  now: Date = new Date(),
): Promise<SemanticTurn> {
  const deterministic = deriveDeterministicSemanticTurn(message, context, taskState, now);
  if (deterministic) {
    console.log('THONGTHAI_OBSERVABILITY', JSON.stringify({ deterministic_turn: true, model_call_used: false }));
    return deterministic;
  }
  try {
    const turn = await deps.interpretSemanticTurn(message, context);
    console.log('THONGTHAI_OBSERVABILITY', JSON.stringify({ deterministic_turn: false, model_call_used: true }));
    return turn;
  } catch (error) {
    if (!(error instanceof LLMAvailabilityError) && !(error instanceof ProviderNotConfiguredError)) throw error;
    console.log('THONGTHAI_OBSERVABILITY', JSON.stringify({ deterministic_turn: false, model_call_used: false, clarification_without_model: true }));
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
  const semanticContext = buildSemanticContext(conversationContextBefore, now);
  const semanticStartedAt = Date.now();
  const semanticTurn = await resolveSemanticTurn(message, semanticContext, taskStateBefore, deps, now);
  const semanticMs = Date.now() - semanticStartedAt;
  const adapters = deps.buildKnowledgeAdapters(input.channel, {
    guestDbId: identity.guestDbId,
    environment: input.environment ?? 'live',
  });

  const dialogStartedAt = Date.now();
  const dialog = await processDialogTurnDetailed({
    semanticTurn,
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
