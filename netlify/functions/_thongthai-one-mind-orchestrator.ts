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
  type ConversationContextState,
} from './_conversation-context';
import {
  loadTaskState,
  parseTaskState,
  persistTaskState,
  type TaskStateContainer,
} from './_task-state';
import {
  interpretSemanticTurn,
  toSemanticInterpretationMeta,
  type SemanticTurn,
} from './_semantic-interpreter';
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

function nextConversationContext(
  before: ConversationContextState,
  input: OneMindTurnInput,
  semanticTurn: SemanticTurn,
  decision: DialogDecision,
  now: Date,
): ConversationContextState {
  const activeTask = decision.taskStateContainer.activeTask;
  const openQuestion = decision.mode === 'collect_field'
    ? decision.missingFields[0] ?? null
    : decision.mode === 'clarify'
      ? 'clarification_required'
      : null;

  return applyConversationContextUpdate(before, {
    eventId: input.eventId,
    channel: input.channel,
    userMessage: normalizeMessage(input.message),
    activeDomain: semanticTurn.domain === 'unknown' ? undefined : semanticTurn.domain,
    activeTopic: semanticTurn.intent || undefined,
    openQuestion,
    newEntities: activeTask?.selectedEntities ?? [],
    lastAction: semanticTurn.action,
    currentTaskReference: activeTask?.taskId ?? null,
    lastToolResultSummary: decision.actionProposal ? 'action_proposed_not_executed' : undefined,
  }, now);
}

async function computeOneMindTurnFromState(
  input: OneMindTurnInput,
  identity: OneMindIdentity,
  conversationContextBefore: ConversationContextState,
  taskStateBefore: TaskStateContainer,
  deps: OneMindDependencies,
  now: Date,
): Promise<OneMindTurnResult> {
  const message = normalizeMessage(input.message);
  const semanticContext = buildSemanticContext(conversationContextBefore, now);
  const semanticTurn = await deps.interpretSemanticTurn(message, semanticContext);
  const adapters = deps.buildKnowledgeAdapters(input.channel, {
    guestDbId: identity.guestDbId,
    environment: input.environment ?? 'live',
  });

  const dialog = await processDialogTurnDetailed({
    semanticTurn,
    conversationContext: conversationContextBefore,
    taskState: taskStateBefore,
    channel: input.channel,
    eventId: input.eventId,
  }, adapters, now);

  const taskStateAfter = dialog.decision.taskStateContainer;
  const conversationContextAfter = nextConversationContext(
    conversationContextBefore,
    input,
    semanticTurn,
    dialog.decision,
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
  const [conversationContextBefore, taskStateBefore] = await Promise.all([
    deps.loadConversationContext(identity.guestDbId, now),
    deps.loadTaskState(identity.guestDbId),
  ]);
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
): Promise<OneMindTurnResult> {
  const deps: OneMindDependencies = { ...REAL_DEPENDENCIES, ...dependencies };
  const stateDeps: AuthoritativeStateDependencies = {
    ...REAL_AUTHORITATIVE_STATE_DEPENDENCIES,
    ...stateDependencies,
  };
  const message = normalizeMessage(input.message);
  if (!message) throw new Error('one_mind_message_required');
  if (!input.eventId.trim()) throw new Error('one_mind_event_id_required');

  const identity = await resolveOneMindIdentity(input, deps);
  const attempts = Math.max(1, Math.min(8, Math.floor(maxAttempts)));

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const snapshot: GuestAgentStateSnapshot = await stateDeps.loadSnapshot(identity.guestDbId);
    const conversationContextBefore = parseConversationContextState(snapshot.state.conversationContext, now);
    const taskStateBefore = parseTaskState(snapshot.state.taskState);
    const result = await computeOneMindTurnFromState(
      input, identity, conversationContextBefore, taskStateBefore, deps, now,
    );

    if (input.persistState !== true || !identity.guestDbId) {
      return {
        ...result,
        trace:{ ...result.trace, statePersisted:false, stateConflictRetries:attempt },
      };
    }

    const write = await stateDeps.compareAndSwap(identity.guestDbId, snapshot, {
      set:{
        conversationContext:result.conversationContextAfter,
        taskState:result.taskStateAfter,
      },
    }, now);

    if (write.status === 'applied') {
      return {
        ...result,
        trace:{ ...result.trace, statePersisted:true, stateConflictRetries:attempt },
      };
    }
    if (write.status === 'unconfigured') {
      return {
        ...result,
        trace:{ ...result.trace, statePersisted:false, stateConflictRetries:attempt },
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
