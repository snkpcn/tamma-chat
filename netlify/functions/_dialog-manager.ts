// Phase F of the Thongthai one-mind architecture program (see THONGTHAI_HANDOFF.md).
//
// Universal Dialog Manager: the orchestration layer that finally connects
// Phase B (Semantic Interpreter: WHAT THE CUSTOMER MEANS), Phase C
// (Conversation Continuity), Phase D (Working/Task State), and Phase E
// (Knowledge Resolver: WHAT VERIFIED INFORMATION IS NEEDED/AVAILABLE) into
// one pipeline that decides WHAT THE SYSTEM SHOULD DO NEXT. It does NOT
// decide what the customer meant (that's Phase B, already done before this
// module runs) and does NOT execute a real transaction (Phase F stops at an
// ActionProposal; a later phase performs the actual write).
//
// Two-step design, per the brief:
//   STEP 1 -- PLAN  (planDialogTurn): pure, synchronous. SemanticTurn +
//     ConversationContext + TaskState -> task-state merge -> missing
//     fields -> KnowledgeRequests -> a PRELIMINARY mode.
//   STEP 2 -- RESOLVE (resolveDialogDecision): pure, synchronous, given the
//     KnowledgeBundles the caller already resolved -> the FINAL
//     DialogDecision (grounded answer / clarify / propose action / etc).
//   processDialogTurn: the only function that does I/O -- it calls
//     resolveKnowledge (Phase E) via injected adapters between the two pure
//     steps. This module has no direct DB calls of its own (same posture
//     as _knowledge-resolver.ts).
//
// Idempotence: every task-state mutation this module makes goes through
// _task-state.ts's applyTaskStateEvent, keyed on `${eventId}:<operation>`
// sub-ids derived from the turn's own eventId -- so replaying the exact
// same turn (same top-level eventId) reproduces the exact same sub-ids,
// which Phase D's own proven dedup mechanism no-ops on the second pass.
//
// Wired through the canonical One-Mind orchestrator. Customer-visible use is
// still controlled by the strangler/cutover gate in thongthai-chat.ts; this
// module itself remains channel-agnostic and never executes transactions.
import type { SemanticAction, SemanticContext, SemanticContextEntity, SemanticDomain, SemanticTurn } from './_semantic-interpreter';
import type { ConversationContextState } from './_conversation-context';
import {
  applyTaskStateEvent, type ActiveTaskType, type TaskStateContainer,
} from './_task-state';
import { computeTaskMissingFields, DOMAIN_TASK_REQUIRED_FIELDS } from './_domain-task-policy';
import {
  getGroundedFactValue, resolveKnowledge, type KnowledgeBundle, type KnowledgeRequest,
  type KnowledgeSourceAdapters,
} from './_knowledge-resolver';

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

export type DialogMode =
  | 'answer' | 'clarify' | 'collect_field' | 'query_knowledge' | 'propose_action'
  | 'execute_tool' | 'handoff' | 'no_op';

/** Bounded machine codes only -- never natural-language private reasoning
 *  or chain-of-thought. A later Response Composer phase turns these (plus
 *  grounded facts) into customer-facing prose; this module never writes
 *  prose itself. */
export type DialogReasonCode =
  | 'discovery_only' | 'no_task_worthy_action' | 'missing_field' | 'ambiguous_entity'
  | 'knowledge_unavailable' | 'knowledge_unverified' | 'knowledge_empty'
  | 'ready_for_availability_check' | 'awaiting_explicit_commit' | 'explicit_commit_received'
  | 'task_suspended_for_topic_switch' | 'task_resumed' | 'cannot_verify_comparison'
  | 'known_unconfigured_price' | 'duplicate_event_ignored' | 'no_active_task';

export type ResponseIntent =
  | 'discovery_response' | 'grounded_answer' | 'clarify_ambiguous_entity' | 'ask_missing_field'
  | 'cannot_verify_comparison' | 'no_active_promotion' | 'source_unavailable_apology'
  | 'propose_action' | 'no_op';

export type DialogInput = {
  semanticTurn: SemanticTurn;
  conversationContext: ConversationContextState;
  taskState: TaskStateContainer;
  channel: string;
  eventId: string;
};

export type ActionProposal = {
  toolName: string;
  validatedArgs: Record<string, unknown>;
  requiresExplicitConfirmation: boolean;
  customerCommitPresent: boolean;
  idempotencyKey: string;
};

export type DialogPlan = {
  taskStateContainer: TaskStateContainer;
  knowledgeRequests: KnowledgeRequest[];
  mode: DialogMode;
  reasons: DialogReasonCode[];
  missingFields: string[];
  customerCommitPresent: boolean;
  /** The turn's own action, carried through so resolveDialogDecision can
   *  make anti-hallucination decisions (e.g. 'compare') without needing the
   *  full SemanticTurn -- keeps the resolve step's inputs minimal/explicit. */
  action: SemanticAction;
  /** For a 'compare' turn: which attribute is being compared (from
   *  turn.entities.compareAttribute, when the Semantic Interpreter names
   *  one) and which resolved canonical/conversational entity ids are the
   *  candidates (from turn.references). Used to check a PRECISE fact key
   *  per candidate rather than a coarse "were any facts returned at all"
   *  guess -- see resolveDialogDecision's anti-hallucination check. */
  compareAttribute?: string;
  compareEntityIds: string[];
};

export type DialogDecision = {
  mode: DialogMode;
  taskStateContainer: TaskStateContainer;
  knowledgeRequests: KnowledgeRequest[];
  actionProposal?: ActionProposal;
  missingFields: string[];
  responseIntent: ResponseIntent;
  reasons: DialogReasonCode[];
};

// ---------------------------------------------------------------------------
// STEP 1 -- PLAN
// ---------------------------------------------------------------------------

/** Actions that represent an actionable goal, not mere discovery/browsing.
 *  Discovery/ask/compare/recommend/status NEVER create a task on their own
 *  -- see "discovery must not create fake tasks" in the Phase F brief. */
const TASK_WORTHY_ACTIONS: ReadonlySet<SemanticAction> = new Set(['confirm', 'provide_information', 'modify', 'book', 'order', 'cancel', 'correct_previous']);

/** Only 'book'/'order' count as an explicit customer commitment to actually
 *  perform a transaction. 'confirm' (e.g. "เอาภาราดร") is a SELECTION, not
 *  a booking commitment -- see "READY != EXECUTE" in the brief. */
const COMMIT_ACTIONS: ReadonlySet<SemanticAction> = new Set(['book', 'order']);

const DEFAULT_TASK_TYPE_FOR_DOMAIN: Partial<Record<SemanticDomain, ActiveTaskType>> = {
  activity: 'activity_booking',
  stay: 'stay_booking',
  restaurant: 'restaurant_preorder',
  promotion: 'promotion_redemption',
  otop: 'otop_order',
  cafe: 'cafe_inquiry',
  membership: 'membership',
  journey: 'journey_planning',
};

export const TOOL_NAME_FOR_TASK_TYPE: Partial<Record<ActiveTaskType, string>> = {
  activity_booking: 'create_booking',
  stay_booking: 'create_booking',
  restaurant_booking: 'create_booking',
  restaurant_preorder: 'create_restaurant_preorder',
  promotion_redemption: 'redeem_promotion',
  otop_order: 'create_otop_order',
  cafe_inquiry: 'create_cafe_inquiry',
};

function isAmbiguous(turn: SemanticTurn): boolean {
  return turn.needsClarification || turn.references.some(reference => reference.ambiguous === true);
}

type TopicTransition = 'none' | 'suspend' | 'resume';

function detectTopicTransition(taskState: TaskStateContainer, domain: SemanticDomain): TopicTransition {
  if (domain === 'unknown') return 'none';
  const { activeTask, suspendedTask } = taskState;
  if (suspendedTask && suspendedTask.domain === domain && (!activeTask || activeTask.domain !== domain)) return 'resume';
  if (activeTask && activeTask.domain !== domain) return 'suspend';
  return 'none';
}

function resolveSelectedEntities(turn: SemanticTurn, conversationContext: ConversationContextState): SemanticContextEntity[] {
  const ids = turn.references.flatMap(reference => (reference.resolvedEntityId ? [reference.resolvedEntityId] : (reference.resolvedEntityIds ?? [])));
  if (!ids.length) return [];
  const byId = new Map(conversationContext.recentEntities.map(entity => [entity.id, entity] as const));
  return ids.map(id => byId.get(id)).filter((entity): entity is SemanticContextEntity => Boolean(entity));
}

function mergeTaskState(input: DialogInput, now: Date): { container: TaskStateContainer; reasons: DialogReasonCode[] } {
  const { semanticTurn: turn, taskState, conversationContext, channel, eventId } = input;
  const reasons: DialogReasonCode[] = [];
  let container = taskState;

  // Each logical operation below gets ONE stable eventId regardless of
  // which branch actually fires -- this is what makes a duplicate
  // redelivery of the SAME turn idempotent even though the exact branch
  // taken can depend on state (e.g. "start" the first time, "update_slots"
  // if somehow replayed against already-updated state): applyTaskStateEvent
  // dedups purely on the eventId string, before it even looks at `kind`, so
  // a shared id across branches is what lets that dedup actually catch a
  // resent duplicate rather than being sidestepped by a different `kind`.
  // `now` is threaded explicitly throughout (never left to
  // applyTaskStateEvent's wall-clock default) -- the same class of flaky
  // timestamp bug already found and fixed once in Phase C's golden test.
  const transition = detectTopicTransition(taskState, turn.domain);
  if (transition === 'suspend') {
    container = applyTaskStateEvent(container, { kind: 'suspend', eventId: `${eventId}:topic_transition` }, now);
    reasons.push('task_suspended_for_topic_switch');
  } else if (transition === 'resume') {
    container = applyTaskStateEvent(container, { kind: 'resume', eventId: `${eventId}:topic_transition` }, now);
    reasons.push('task_resumed');
  }

  if (!container.activeTask) {
    const defaultType = DEFAULT_TASK_TYPE_FOR_DOMAIN[turn.domain];
    if (TASK_WORTHY_ACTIONS.has(turn.action) && defaultType) {
      container = applyTaskStateEvent(container, {
        kind: 'start', eventId: `${eventId}:task_merge`,
        params: { type: defaultType, sourceChannel: channel, initialSlots: turn.entities },
      }, now);
    } else {
      reasons.push('discovery_only');
      return { container, reasons };
    }
  } else if (container.activeTask.domain === turn.domain && Object.keys(turn.entities).length) {
    container = applyTaskStateEvent(container, {
      kind: 'update_slots', eventId: `${eventId}:task_merge`,
      slotPatch: turn.entities, requiredFields: DOMAIN_TASK_REQUIRED_FIELDS[container.activeTask.type] ?? [],
    }, now);
  }

  const selectedEntities = resolveSelectedEntities(turn, conversationContext);
  if (selectedEntities.length && container.activeTask) {
    container = applyTaskStateEvent(container, { kind: 'set_entities', eventId: `${eventId}:entities`, entities: selectedEntities }, now);
  }

  if (container.activeTask) {
    for (const [index, constraint] of turn.constraints.entries()) {
      container = applyTaskStateEvent(container, { kind: 'add_constraint', eventId: `${eventId}:constraint:${index}`, constraint }, now);
    }
  }

  // Authoritative recompute via the domain policy layer -- correct even for
  // the two conditional domains (restaurant_preorder/promotion_redemption)
  // that a static requiredFields list can't fully express.
  if (container.activeTask) {
    const missingFields = computeTaskMissingFields(container.activeTask);
    container = { ...container, activeTask: { ...container.activeTask, missingFields } };
  }

  return { container, reasons };
}

/** Translates semantic/task state into INFORMATION NEEDS -- never queries
 *  every source every turn. Returns at most one KnowledgeRequest per domain
 *  actually implicated by this turn. */
function planKnowledgeNeeds(turn: SemanticTurn, container: TaskStateContainer): KnowledgeRequest[] {
  const task = container.activeTask;
  const base = { intent: turn.intent, action: turn.action, entities: turn.entities, constraints: turn.constraints, task: task ?? null };

  switch (turn.domain) {
    case 'restaurant':
      if (turn.action === 'status') return [{ ...base, domain: 'restaurant', needs: ['order_status'] }];
      if (turn.action === 'discover' || turn.action === 'ask' || turn.action === 'recommend') return [{ ...base, domain: 'restaurant', needs: ['catalog', 'recommendations_input'] }];
      return [];
    case 'activity':
      if (turn.action === 'status') return [{ ...base, domain: 'activity', needs: ['booking_status'] }];
      if (turn.action === 'compare' || turn.action === 'ask') return [{ ...base, domain: 'activity', needs: task ? ['entity_details'] : ['entity_details', 'catalog'] }];
      if (turn.action === 'discover') return [{ ...base, domain: 'activity', needs: ['catalog'] }];
      if (task && task.missingFields.length === 0 && (turn.action === 'provide_information' || COMMIT_ACTIONS.has(turn.action))) {
        return [{ ...base, domain: 'activity', needs: ['availability'] }];
      }
      return [];
    case 'stay':
      if (turn.action === 'status') return [{ ...base, domain: 'stay', needs: ['booking_status'] }];
      if (turn.action === 'discover' || turn.action === 'ask') return [{ ...base, domain: 'stay', needs: ['catalog', 'availability'] }];
      if (task && task.missingFields.length === 0) return [{ ...base, domain: 'stay', needs: ['availability'] }];
      return [];
    case 'promotion':
      if (turn.action === 'discover' || turn.action === 'ask') return [{ ...base, domain: 'promotion', needs: ['promotion_eligibility'] }];
      return [];
    case 'otop':
      if (turn.action === 'status') return [{ ...base, domain: 'otop', needs: ['order_status'] }];
      if (turn.action === 'discover' || turn.action === 'ask') return [{ ...base, domain: 'otop', needs: ['catalog'] }];
      return [];
    case 'ecosystem':
      if (turn.action === 'discover' || turn.action === 'ask') return [{ ...base, domain: 'ecosystem', needs: ['catalog'] }];
      return [];
    default:
      return [];
  }
}

export function planDialogTurn(input: DialogInput, now: Date = new Date()): DialogPlan {
  const { semanticTurn: turn } = input;

  if (isAmbiguous(turn)) {
    return {
      taskStateContainer: input.taskState, knowledgeRequests: [], mode: 'clarify',
      reasons: ['ambiguous_entity'], missingFields: [], customerCommitPresent: false, action: turn.action, compareEntityIds: [],
    };
  }

  const { container, reasons } = mergeTaskState(input, now);
  const knowledgeRequests = planKnowledgeNeeds(turn, container);
  const missingFields = container.activeTask?.missingFields ?? [];
  const customerCommitPresent = COMMIT_ACTIONS.has(turn.action);
  if (customerCommitPresent) reasons.push('explicit_commit_received');

  let mode: DialogMode;
  if (!container.activeTask) {
    mode = knowledgeRequests.length ? 'query_knowledge' : 'answer';
  } else if (missingFields.length > 0) {
    mode = 'collect_field';
    reasons.push('missing_field');
  } else if (knowledgeRequests.length) {
    mode = 'query_knowledge';
    reasons.push('ready_for_availability_check');
  } else if (customerCommitPresent) {
    mode = 'propose_action';
  } else {
    mode = 'answer';
    reasons.push('awaiting_explicit_commit');
  }

  const compareAttribute = typeof turn.entities.compareAttribute === 'string' ? turn.entities.compareAttribute : undefined;
  const compareEntityIds = turn.action === 'compare'
    ? turn.references.flatMap(reference => (reference.resolvedEntityId ? [reference.resolvedEntityId] : (reference.resolvedEntityIds ?? [])))
    : [];

  return { taskStateContainer: container, knowledgeRequests, mode, reasons, missingFields, customerCommitPresent, action: turn.action, compareAttribute, compareEntityIds };
}

// ---------------------------------------------------------------------------
// STEP 2 -- RESOLVE
// ---------------------------------------------------------------------------

function hasVerifiedFacts(bundles: readonly KnowledgeBundle[]): boolean {
  return bundles.some(bundle => bundle.facts.length > 0);
}

export function resolveDialogDecision(plan: DialogPlan, bundles: readonly KnowledgeBundle[]): DialogDecision {
  if (plan.mode === 'clarify') {
    return { mode: 'clarify', taskStateContainer: plan.taskStateContainer, knowledgeRequests: plan.knowledgeRequests, missingFields: plan.missingFields, responseIntent: 'clarify_ambiguous_entity', reasons: plan.reasons };
  }

  const reasons = [...plan.reasons];
  let mode = plan.mode;
  let responseIntent: ResponseIntent = plan.taskStateContainer.activeTask ? 'grounded_answer' : 'discovery_response';

  const unavailable = bundles.some(bundle => bundle.sources.some(source => source.status === 'unavailable'));
  const emptyPromotion = bundles.some(bundle => bundle.domain === 'promotion' && bundle.sources.some(source => source.need === 'promotion_eligibility' && source.status === 'empty'));

  if (unavailable) { reasons.push('knowledge_unavailable'); responseIntent = 'source_unavailable_apology'; }
  else if (emptyPromotion) { reasons.push('knowledge_empty'); responseIntent = 'no_active_promotion'; }

  // Anti-hallucination: a comparison must be backed by a real verified fact
  // -- never authorize one just because the customer asked a comparison
  // question. When the turn names a specific attribute + candidates (e.g.
  // "ตัวไหนนิสัยดีกว่า" -> attribute 'temperament', candidates both
  // horses), check the PRECISE fact key per candidate rather than a coarse
  // "were any facts returned at all" guess -- a catalog answering with
  // names/prices but no temperament must still be treated as unverified.
  if (plan.action === 'compare' && !unavailable) {
    const verified = plan.compareAttribute && plan.compareEntityIds.length
      ? plan.compareEntityIds.every(id => {
          const suffix = id.replace(/^conv:/, '');
          return bundles.some(bundle => getGroundedFactValue(bundle, `${plan.compareAttribute}:${suffix}`).status === 'known');
        })
      : hasVerifiedFacts(bundles);
    if (!verified) {
      reasons.push('cannot_verify_comparison');
      responseIntent = 'cannot_verify_comparison';
      mode = 'answer';
    }
  }

  for (const bundle of bundles) {
    for (const fact of bundle.facts) {
      if (fact.key.includes(':price') && fact.value === null) reasons.push('known_unconfigured_price');
    }
  }

  if (mode === 'collect_field') responseIntent = 'ask_missing_field';

  // READY != EXECUTE: only produce a proposal when the customer explicitly
  // committed (book/order) AND every required field is present AND, if a
  // live availability check was requested this turn, it came back verified
  // (not merely "no source configured for it").
  let actionProposal: ActionProposal | undefined;
  if (plan.customerCommitPresent && plan.missingFields.length === 0 && plan.taskStateContainer.activeTask && !unavailable) {
    const availabilityRequested = plan.knowledgeRequests.some(request => request.needs.includes('availability'));
    const availabilityVerified = !availabilityRequested || bundles.some(bundle => bundle.facts.some(fact => fact.key.includes('available') && fact.value === true));
    if (availabilityVerified) {
      const task = plan.taskStateContainer.activeTask;
      const toolName = TOOL_NAME_FOR_TASK_TYPE[task.type];
      if (toolName) {
        mode = 'propose_action';
        responseIntent = 'propose_action';
        actionProposal = {
          toolName, validatedArgs: task.slots, requiresExplicitConfirmation: false,
          customerCommitPresent: true, idempotencyKey: task.taskId,
        };
      }
    }
  }

  return { mode, taskStateContainer: plan.taskStateContainer, knowledgeRequests: plan.knowledgeRequests, actionProposal, missingFields: plan.missingFields, responseIntent, reasons };
}

// ---------------------------------------------------------------------------
// Orchestrator -- the only function in this module that performs I/O (via
// injected adapters, exactly like _knowledge-resolver.ts).
// ---------------------------------------------------------------------------

export type DialogTurnResult = {
  plan: DialogPlan;
  bundles: KnowledgeBundle[];
  decision: DialogDecision;
};

/** Detailed form used by the One-Mind orchestrator and, later, the Response
 * Composer. It resolves knowledge exactly once and returns the grounded
 * bundles alongside the final decision so downstream layers never have to
 * re-query live sources just to compose a reply. */
export async function processDialogTurnDetailed(
  input: DialogInput,
  adapters: KnowledgeSourceAdapters,
  now: Date = new Date(),
): Promise<DialogTurnResult> {
  const plan = planDialogTurn(input, now);
  const bundles = (plan.mode === 'clarify' || !plan.knowledgeRequests.length)
    ? []
    : await Promise.all(plan.knowledgeRequests.map(request => resolveKnowledge(request, adapters, now)));
  return { plan, bundles, decision: resolveDialogDecision(plan, bundles) };
}

export async function processDialogTurn(input: DialogInput, adapters: KnowledgeSourceAdapters, now: Date = new Date()): Promise<DialogDecision> {
  return (await processDialogTurnDetailed(input, adapters, now)).decision;
}

export { getGroundedFactValue };
export type { SemanticContext };
