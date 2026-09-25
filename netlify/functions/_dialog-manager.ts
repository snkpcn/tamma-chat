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
  applyTaskStateEvent, isTerminalTaskStatus, type ActiveTask, type ActiveTaskType, type TaskStateContainer,
} from './_task-state';
import { computeTaskMissingFields, DOMAIN_TASK_REQUIRED_FIELDS } from './_domain-task-policy';
import {
  getGroundedFactValue, resolveKnowledge, type KnowledgeBundle, type KnowledgeRequest,
  type KnowledgeSourceAdapters,
} from './_knowledge-resolver';
import { resolveActivityDurationOptions, resolveActivityResourceCode } from './_activity-catalog-policy';

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
  | 'known_unconfigured_price' | 'duplicate_event_ignored' | 'no_active_task'
  | 'task_side_question_preserved' | 'task_unrelated_turn_preserved' | 'task_cancelled'
  | 'task_summary_requested';

export type ResponseIntent =
  | 'discovery_response' | 'grounded_answer' | 'clarify_ambiguous_entity' | 'ask_missing_field'
  | 'cannot_verify_comparison' | 'no_active_promotion' | 'source_unavailable_apology'
  | 'propose_action' | 'active_task_summary' | 'no_op';

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

/** An active task is INTERRUPTIBLE: having an unfinished task does not mean
 *  every following message is a slot fill. These actions are inherently
 *  side-questions/browsing, never a customer providing task information --
 *  see TASK_WORTHY_ACTIONS above, which this set is deliberately disjoint
 *  from (a SemanticTurn has exactly one action, so a turn is never both).
 *  A side-question turn on an active task must be answered on its own
 *  terms -- never silently replaced by the task's own missing-field
 *  prompt. */
const SIDE_QUESTION_ACTIONS: ReadonlySet<SemanticAction> = new Set(['ask', 'discover', 'recommend', 'compare', 'status']);

/** Known task-slot key names across domains (matches FIELD_LABELS_TH in
 *  _response-composer.ts). A side-question-shaped action that ALSO carries
 *  one of these (e.g. "บ่ายสามได้ปะ" classified as 'ask' but still stating a
 *  time) is a hybrid turn, not a pure side-question -- see
 *  "AVAILABILITY VS SLOT FILL": the value must still be merged and missing-
 *  field collection must still proceed normally, so a genuinely still-
 *  required field (like durationMinutes) is still asked for. A key like
 *  'compareAttribute' (comparison metadata, never a real slot) does not
 *  count, so a pure compare/price/how-it-works question still bypasses. */
const KNOWN_TASK_SLOT_KEYS = new Set([
  'date', 'time', 'partySize', 'durationMinutes', 'resourceCode', 'quantity',
  'customerName', 'phone', 'checkIn', 'checkOut',
]);

function providesTaskSlotValue(entities: Record<string, unknown>): boolean {
  return Object.keys(entities).some(key => KNOWN_TASK_SLOT_KEYS.has(key));
}

/** Comparison metadata (compareAttribute) is deliberately carried in
 *  turn.entities so resolveDialogDecision's anti-hallucination check can
 *  read it (see DialogPlan.compareAttribute below) -- but it is NOT a real
 *  task slot and must never be written into task.slots. Strips it (and any
 *  future non-slot meta keys) before a merge, never before it's read. */
const NON_SLOT_META_KEYS = new Set(['compareAttribute']);
function taskSlotPatch(entities: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entities)) {
    if (!NON_SLOT_META_KEYS.has(key)) patch[key] = value;
  }
  return patch;
}


const TASK_EVIDENCE_ACTIONS: ReadonlySet<SemanticAction> = new Set([
  'confirm', 'provide_information', 'modify', 'correct_previous',
]);

function hasResolvedTaskReference(turn: SemanticTurn): boolean {
  return turn.references.some(reference =>
    Boolean(reference.resolvedEntityId) || Boolean(reference.resolvedEntityIds?.length)
  );
}

/**
 * Structural "does this CURRENT turn actually continue the active task?"
 * contract. An active task is state, not intent: its mere existence must
 * never turn arbitrary customer text into a slot-fill turn.
 */
function turnContributesToActiveTask(turn: SemanticTurn, task: ActiveTask): boolean {
  if (turn.action === 'cancel' || COMMIT_ACTIONS.has(turn.action)) return true;

  // Hybrid read-only questions may also state a real task slot ("บ่ายสามได้ปะ").
  if (providesTaskSlotValue(turn.entities)) return true;

  if (!TASK_EVIDENCE_ACTIONS.has(turn.action)) return false;
  if (hasResolvedTaskReference(turn)) return true;
  if (turn.constraints.length > 0) return true;

  // Generic domain fields such as budget/email/specialRequest may not be in
  // KNOWN_TASK_SLOT_KEYS, but a semantic mutation action with a real entity
  // payload is still explicit evidence of task contribution.
  const patch = taskSlotPatch(turn.entities);
  if (Object.keys(patch).length > 0) return true;

  void task;
  return false;
}

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
  // Only a genuine task-bearing BUSINESS domain can suspend/resume a task.
  // General/support/payment/unknown/ecosystem turns must never evict a live
  // business task merely because their semantic domain differs.
  if (!DEFAULT_TASK_TYPE_FOR_DOMAIN[domain]) return 'none';
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

  // An explicit cancel ends the active task outright -- never re-derived as
  // a slot update (turn.entities is typically empty for "ยกเลิกก่อน") and
  // never left silently unhandled. A terminal task is never reopened (see
  // TASK_TRANSITIONS in _task-state.ts); a later "resume" finds nothing to
  // resume and must say so honestly, not resurrect a cancelled task.
  if (turn.action === 'cancel') {
    if (container.activeTask && !isTerminalTaskStatus(container.activeTask.status)) {
      container = applyTaskStateEvent(container, {
        kind: 'transition', eventId: `${eventId}:task_merge`, nextStatus: 'cancelled',
      }, now);
      reasons.push('task_cancelled');
    } else {
      reasons.push('no_active_task');
    }
    return { container, reasons };
  }

  // A terminal task (cancelled/completed/failed/superseded) left sitting in
  // container.activeTask must be treated exactly like "no active task" here
  // -- the ORIGINAL check was a bare null-check, so a fresh, unrelated
  // selection right after a cancel ("ยกเลิก" then "เอาภาราดรครับ") was
  // wrongly merged INTO the dead task object instead of starting a clean
  // one (startNewActiveTask itself already correctly allows replacing a
  // terminal task -- see its own guard -- this call site just never took
  // that branch). Real incident this closes: a cancelled booking task
  // could be silently resurrected, un-cancelled in all but name, by the
  // very next unrelated slot-shaped message in the same domain. Reuses the
  // SAME hasOpenTask pattern already established elsewhere in this file.
  const hasOpenActiveTask = Boolean(container.activeTask) && !isTerminalTaskStatus(container.activeTask!.status);
  if (!hasOpenActiveTask) {
    const defaultType = DEFAULT_TASK_TYPE_FOR_DOMAIN[turn.domain];
    if (TASK_WORTHY_ACTIONS.has(turn.action) && defaultType) {
      container = applyTaskStateEvent(container, {
        kind: 'start', eventId: `${eventId}:task_merge`,
        params: { type: defaultType, sourceChannel: channel, initialSlots: taskSlotPatch(turn.entities) },
      }, now);
    } else {
      reasons.push('discovery_only');
      return { container, reasons };
    }
  } else if (container.activeTask!.domain === turn.domain && Object.keys(turn.entities).length) {
    const slotPatch = taskSlotPatch(turn.entities);
    if (Object.keys(slotPatch).length) {
      container = applyTaskStateEvent(container, {
        kind: 'update_slots', eventId: `${eventId}:task_merge`,
        slotPatch, requiredFields: DOMAIN_TASK_REQUIRED_FIELDS[container.activeTask!.type] ?? [],
      }, now);
    }
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

function needsActivityCatalogResolution(task: ActiveTask): boolean {
  if (task.type !== 'activity_booking') return false;
  const resourceCode = task.slots.resourceCode;
  if (!resourceCode) {
    return task.selectedEntities.some(entity => entity.id.startsWith('activity_asset:'));
  }
  return !task.slots.durationMinutes;
}

/** Translates semantic/task state into INFORMATION NEEDS -- never queries
 *  every source every turn. Returns at most one KnowledgeRequest per domain
 *  actually implicated by this turn. */
function planKnowledgeNeeds(turn: SemanticTurn, container: TaskStateContainer): KnowledgeRequest[] {
  const task = container.activeTask;
  const base = { intent: turn.intent, action: turn.action, entities: turn.entities, constraints: turn.constraints, task: task ?? null };

  // This question is about the canonical working state we already own, not
  // about fresh catalog/availability data. Never refetch a catalog just to
  // tell the customer what they themselves have already selected.
  if (turn.intent === 'summarize_active_task') return [];

  switch (turn.domain) {
    case 'restaurant':
      // Human Brain Phase 1.2: "status" is not one universal business fact.
      // Table/capacity availability is a live venue-availability question,
      // while a customer's EXISTING food order status is an operational
      // order-status lookup. Preserve the semantic intent instead of
      // collapsing both into one action label.
      if (turn.intent === 'restaurant_table_availability') {
        return [{ ...base, domain: 'restaurant', needs: ['availability'] }];
      }
      if (turn.action === 'status') return [{ ...base, domain: 'restaurant', needs: ['order_status'] }];
      if (turn.action === 'discover' || turn.action === 'ask' || turn.action === 'recommend') return [{ ...base, domain: 'restaurant', needs: ['catalog', 'recommendations_input'] }];
      return [];
    case 'activity':
      if (turn.action === 'status') return [{ ...base, domain: 'activity', needs: ['booking_status'] }];
      if (turn.intent === 'activity_inventory_count') return [{ ...base, domain: 'activity', needs: ['inventory'] }];
      if (turn.intent === 'ask_price') return [{ ...base, domain: 'activity', needs: ['price'] }];
      if (turn.action === 'compare' || turn.action === 'ask') return [{ ...base, domain: 'activity', needs: task ? ['entity_details'] : ['entity_details', 'catalog'] }];
      if (turn.action === 'discover') return [{ ...base, domain: 'activity', needs: ['catalog'] }];
      // Authoritative resourceCode/duration resolution (see
      // _activity-catalog-policy.ts, applied in processDialogTurnDetailed
      // below): a task with a named asset selected but no resolved
      // resourceCode yet, or a resourceCode set but no verified duration
      // yet, needs the SAME real catalog data discovery already fetches --
      // never a hardcoded/guessed value.
      if (task && needsActivityCatalogResolution(task)) return [{ ...base, domain: 'activity', needs: ['catalog'] }];
      if (task && task.missingFields.length === 0 && (turn.action === 'provide_information' || COMMIT_ACTIONS.has(turn.action))) {
        return [{ ...base, domain: 'activity', needs: ['availability'] }];
      }
      return [];
    case 'stay':
      if (turn.action === 'status') return [{ ...base, domain: 'stay', needs: ['booking_status'] }];
      if (turn.action === 'discover' || turn.action === 'ask' || turn.action === 'recommend') return [{ ...base, domain: 'stay', needs: ['catalog', 'availability'] }];
      if (task && task.missingFields.length === 0) return [{ ...base, domain: 'stay', needs: ['availability'] }];
      return [];
    case 'promotion':
      if (turn.action === 'discover' || turn.action === 'ask') return [{ ...base, domain: 'promotion', needs: ['promotion_eligibility'] }];
      return [];
    case 'otop':
      if (turn.action === 'status') return [{ ...base, domain: 'otop', needs: ['order_status'] }];
      if (turn.action === 'discover' || turn.action === 'ask' || turn.action === 'recommend') return [{ ...base, domain: 'otop', needs: ['catalog'] }];
      return [];
    case 'membership':
      if (turn.action === 'status') return [{ ...base, domain: 'membership', needs: ['membership_status'] }];
      return [];
    case 'cafe':
      if (turn.action === 'discover' || turn.action === 'ask' || turn.action === 'recommend') return [{ ...base, domain: 'cafe', needs: ['catalog'] }];
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
  // A terminal task (just cancelled, or otherwise finished) is treated as
  // "no active task" from here on -- its stale missingFields must never
  // resurface a collect_field prompt for something that no longer exists.
  const hasOpenTask = Boolean(container.activeTask) && !isTerminalTaskStatus(container.activeTask!.status);
  const missingFields = hasOpenTask ? container.activeTask!.missingFields : [];
  const customerCommitPresent = COMMIT_ACTIONS.has(turn.action);
  if (customerCommitPresent) reasons.push('explicit_commit_received');

  // CORE PRECEDENCE: the CURRENT turn must contain positive structural
  // evidence that it continues the active task before missingFields may drive
  // the reply. This closes the production failure where "หวัดดีจ้า" hours
  // later inherited an old activity task and got "เลือก 30/60/90 นาที".
  const activeTask = hasOpenTask ? container.activeTask! : null;
  const contributesToTask = activeTask ? turnContributesToActiveTask(turn, activeTask) : false;
  const isTaskSideQuestion = hasOpenTask && SIDE_QUESTION_ACTIONS.has(turn.action) && !contributesToTask;
  const isTaskUnrelatedTurn = hasOpenTask
    && !contributesToTask
    && !isTaskSideQuestion
    && !customerCommitPresent
    && turn.action !== 'cancel';

  if (isTaskSideQuestion) reasons.push('task_side_question_preserved');
  if (isTaskUnrelatedTurn) reasons.push('task_unrelated_turn_preserved');

  // Knowledge requests are about the CURRENT turn too. An unrelated turn
  // must not trigger catalog/availability work merely because the preserved
  // task still needs data (e.g. a greeting must not fetch horse durations).
  const knowledgeRequests = isTaskUnrelatedTurn ? [] : planKnowledgeNeeds(turn, container);
  if (turn.intent === 'summarize_active_task') reasons.push('task_summary_requested');

  // Missing fields still live on the preserved task, but they are NOT
  // response-facing on a turn that did not actually continue that task.
  const responseMissingFields = (isTaskSideQuestion || isTaskUnrelatedTurn) ? [] : missingFields;

  let mode: DialogMode;
  if (!hasOpenTask || isTaskSideQuestion || isTaskUnrelatedTurn) {
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

  return { taskStateContainer: container, knowledgeRequests, mode, reasons, missingFields: responseMissingFields, customerCommitPresent, action: turn.action, compareAttribute, compareEntityIds };
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

  if (reasons.includes('task_summary_requested')) responseIntent = 'active_task_summary';
  else if (unavailable) { reasons.push('knowledge_unavailable'); responseIntent = 'source_unavailable_apology'; }
  else if (emptyPromotion) { reasons.push('knowledge_empty'); responseIntent = 'no_active_promotion'; }

  // Anti-hallucination: a comparison must be backed by a real verified fact
  // -- never authorize one just because the customer asked a comparison
  // question. When the turn names a specific attribute + candidates (e.g.
  // "ตัวไหนนิสัยดีกว่า" -> attribute 'temperament', candidates both
  // horses), check the PRECISE fact key per candidate rather than a coarse
  // "were any facts returned at all" guess -- a catalog answering with
  // names/prices but no temperament must still be treated as unverified.
  if (plan.action === 'compare' && !unavailable) {
    const verified = plan.compareAttribute
      ? plan.compareEntityIds.length > 0 && plan.compareEntityIds.every(id => {
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

async function resolveBundles(plan: DialogPlan, adapters: KnowledgeSourceAdapters, now: Date): Promise<KnowledgeBundle[]> {
  return (plan.mode === 'clarify' || !plan.knowledgeRequests.length)
    ? []
    : Promise.all(plan.knowledgeRequests.map(request => resolveKnowledge(request, adapters, now)));
}

/** Authoritative activity resourceCode/duration auto-fill (see
 *  _activity-catalog-policy.ts). Never guesses: applies a slot only when the
 *  real catalog facts just fetched verify it (a resolved asset->activity
 *  link, or exactly one valid duration). When something was applied, the
 *  turn is re-planned from the updated task state so missingFields/mode
 *  reflect it (e.g. "collect_field: date" instead of "...resourceCode");
 *  re-running planDialogTurn with the SAME input.eventId is safe because
 *  every task-state mutation it makes is idempotent per _task-state.ts's
 *  applyTaskStateEvent (a sub-id already applied this turn is a no-op). */
function applyActivityCatalogPolicy(
  plan: DialogPlan,
  bundles: readonly KnowledgeBundle[],
  input: DialogInput,
  now: Date,
): DialogPlan | null {
  const task = plan.taskStateContainer.activeTask;
  if (!task || task.type !== 'activity_booking') return null;

  let container = plan.taskStateContainer;
  let applied = false;

  let resourceCode = typeof task.slots.resourceCode === 'string' ? task.slots.resourceCode : null;
  if (!resourceCode) {
    const assetSelection = task.selectedEntities.find(entity => entity.id.startsWith('activity_asset:'));
    const resolved = assetSelection ? resolveActivityResourceCode(bundles, assetSelection.id) : null;
    if (resolved) {
      container = applyTaskStateEvent(container, {
        kind: 'update_slots', eventId: `${input.eventId}:activity_resource_autofill`,
        slotPatch: { resourceCode: resolved },
      }, now);
      resourceCode = resolved;
      applied = true;
    }
  }

  if (resourceCode && !container.activeTask?.slots.durationMinutes) {
    const durationPolicy = resolveActivityDurationOptions(bundles, resourceCode);
    if (durationPolicy.status === 'single') {
      container = applyTaskStateEvent(container, {
        kind: 'update_slots', eventId: `${input.eventId}:activity_duration_autofill`,
        slotPatch: { durationMinutes: durationPolicy.durationMinutes },
      }, now);
      applied = true;
    }
  }

  return applied ? planDialogTurn({ ...input, taskState: container }, now) : null;
}

/** Detailed form used by the One-Mind orchestrator and, later, the Response
 * Composer. It resolves knowledge exactly once and returns the grounded
 * bundles alongside the final decision so downstream layers never have to
 * re-query live sources just to compose a reply. */
export async function processDialogTurnDetailed(
  input: DialogInput,
  adapters: KnowledgeSourceAdapters,
  now: Date = new Date(),
): Promise<DialogTurnResult> {
  let plan = planDialogTurn(input, now);
  let bundles = await resolveBundles(plan, adapters, now);

  const replanned = applyActivityCatalogPolicy(plan, bundles, input, now);
  if (replanned) {
    plan = replanned;
    bundles = await resolveBundles(plan, adapters, now);
  }

  return { plan, bundles, decision: resolveDialogDecision(plan, bundles) };
}

export async function processDialogTurn(input: DialogInput, adapters: KnowledgeSourceAdapters, now: Date = new Date()): Promise<DialogDecision> {
  return (await processDialogTurnDetailed(input, adapters, now)).decision;
}

export { getGroundedFactValue };
export type { SemanticContext };
