// Phase I / G.2 bridge: canonical customer-response facade.
//
// Channel handlers must not reconstruct business logic or wording. This module
// joins the authoritative One-Mind turn with the ONE Response Composer and
// exposes the cutover gate: read-only turns AND task-continuation turns
// (slot-fill/correction/entity-selection/clarify -- anything that never
// reaches an ActionProposal) compose through One-Mind. Only a turn whose
// DialogDecision actually proposes/executes a transaction
// (propose_action/execute_tool) still falls through to the existing
// deterministic legacy executor, until that executor is migrated and
// equivalence-tested -- see tests/one-mind-never-executes.test.ts for the
// structural proof that this module set never calls a transaction executor
// itself, so that boundary cannot silently regress.
import type { BrainChannel } from './_thongthai-brain-v3';
import {
  processThongthaiOneMindTurnAuthoritative,
  isTrustedZeroCostFactLookup,
  type OneMindDependencies,
  type OneMindTurnInput,
  type OneMindTurnResult,
  type AuthoritativeStateDependencies,
} from './_thongthai-one-mind-orchestrator';
import {
  composeDeterministicResponse,
  composeGroundedDeterministicResponse,
  composeMembershipInformationResponse,
  composeThongthaiResponse,
  type ComposedResponse,
  type ResponseComposerInput,
  type ResponseLanguage,
} from './_response-composer';
import {
  buildOneMindTraceEnvelope,
  type OneMindTraceEnvelope,
} from './_one-mind-observability';
import {
  applyConversationContextUpdate,
  parseConversationContextState,
} from './_conversation-context';
import {
  compareAndSwapGuestAgentState,
  loadGuestAgentStateSnapshot,
} from './_guest-agent-state-store';
import { deriveSemanticMeaning } from './_semantic-meaning';
import { persistAiResponseTurn } from './_ai-cost-store';
import { isPromotionMention } from './_promotion-dialog';

export const ONE_MIND_RESPONSE_VERSION = 'one-mind-response-v1';

const READ_ONLY_ACTIONS = new Set(['ask','discover','recommend','compare','status']);
// Phase P closure: 'ecosystem' joins the cutover set here -- unlike every
// other domain, it has no entry in _dialog-manager.ts's
// DEFAULT_TASK_TYPE_FOR_DOMAIN, so a turn classified into it can NEVER
// create an ActiveTask and therefore can never reach an ActionProposal.
// Journey is also cut over now for read-only itinerary composition: legacy
// keyword routing demonstrably misrouted multi-day plans into unrelated
// weather/activity handlers. Journey has no transaction executor mapping, so
// read-only composition/task-state continuation remains inside One-Mind while
// any future real transaction proposal would still be rejected by the gate.
// Payment/support remain on legacy until their own equivalence is proven.
// The one narrow payment-status exception lives directly in the eligibility
// gate below, where it is constrained to a canonical read-only lookup.
const INITIAL_CUTOVER_DOMAINS = new Set(['restaurant','activity','stay','promotion','otop','ecosystem','membership','cafe','journey','general','local','incident']);
const COMPOSER_MODEL_BUDGET_CUTOFF_MS = 18_000;
const FOOD_SAFETY_CONSTRAINTS = new Set([
  'no_shrimp','shrimp_allergy','no_seafood','seafood_allergy',
  'no_peanut','peanut_allergy','no_egg','egg_allergy','food_allergy',
  'no_spicy','mild_spice',
]);

export function requiresDietarySafetyGroundedResponse(turn: OneMindTurnResult): boolean {
  return turn.dialogSemanticTurn.domain === 'restaurant'
    && turn.dialogSemanticTurn.constraints.some(value => FOOD_SAFETY_CONSTRAINTS.has(value));
}
// Task-worthy modes that only ever COLLECT/CLARIFY information -- they never
// execute or even propose a transaction (see DialogMode/COMMIT_ACTIONS in
// _dialog-manager.ts: only 'propose_action'/'execute_tool' reach an
// ActionProposal). Continuing an in-progress task's slot-filling/correction/
// entity-selection turns through One-Mind is exactly the zero-cost-quota
// requirement (Phase P): the transaction executor equivalence gap that keeps
// 'propose_action'/'execute_tool' on legacy does not apply to these modes.
const TASK_CONTINUATION_SAFE_MODES = new Set(['collect_field','clarify','answer','query_knowledge']);

export function shouldPreferGroundedDeterministicResponse(
  turn: OneMindTurnResult,
  elapsedMs: number,
): boolean {
  void turn;
  // Quality-first cutover: grounded deterministic copy is now a latency
  // emergency fallback, not the ordinary authority for discovery/read-only
  // turns with facts. Otherwise we pay for OpenAI understanding and then
  // silently discard the customer-facing reply/composer.
  return elapsedMs >= COMPOSER_MODEL_BUDGET_CUTOFF_MS;
}

/** True for a task-active turn whose DialogDecision only collects/clarifies
 *  (never a real commitment) -- see TASK_CONTINUATION_SAFE_MODES above. */
export function isSafeTaskContinuationTurn(turn: OneMindTurnResult): boolean {
  return Boolean(turn.taskStateBefore.activeTask || turn.taskStateAfter.activeTask)
    && TASK_CONTINUATION_SAFE_MODES.has(turn.dialogDecision.mode)
    && !turn.dialogDecision.actionProposal;
}

export type OneMindCustomerTurnInput = OneMindTurnInput & {
  language: ResponseLanguage;
};

export type OneMindCustomerTurnResult =
  | {
      status:'composed';
      turn:OneMindTurnResult;
      response:ComposedResponse;
      observability:OneMindTraceEnvelope;
    }
  | {
      status:'legacy_required';
      turn:OneMindTurnResult;
      reason:'transactional_or_task_turn' | 'domain_not_cut_over';
      observability:OneMindTraceEnvelope;
    };

/** True when the turn's "understanding" is not real understanding at all --
 *  it is the orchestrator's own synthesized fallback (see resolveSemanticTurn
 *  in _thongthai-one-mind-orchestrator.ts), produced only because BOTH the
 *  deterministic deriver returned null AND the real model was unavailable.
 *  Composing such a turn as a confident 'clarify' would silently steal the
 *  message away from legacy's own working zero-LLM matchers (e.g. the
 *  restaurant advisor, experience discovery) before they ever get a chance
 *  -- exactly the "unrelated side-question gets swallowed" defect this
 *  hardening pass exists to close. */
function isGenuinelyUnclassifiedFallback(turn: OneMindTurnResult): boolean {
  return turn.semanticTurn.clarificationReason === 'provider_unavailable';
}

function isTrustedGroundedPromotionProviderFallback(
  turn: OneMindTurnResult,
  message: string,
): boolean {
  const semantic = turn.dialogSemanticTurn ?? turn.semanticTurn;
  if (semantic.semanticSource !== 'deterministic_fallback') return false;
  if (semantic.domain !== 'promotion') return false;
  if (!['discover','recommend','ask'].includes(semantic.action)) return false;
  if (!isPromotionMention(message)) return false;
  if (turn.dialogDecision.actionProposal) return false;

  // The language model may be unavailable, but promotion facts still must
  // come from the canonical runtime source. This exception only authorizes
  // response composition when that source answered; it never authorizes a
  // redemption/write and the authoritative persistence predicate keeps this
  // fallback response-only under requireSemanticSupervisor.
  return turn.groundedKnowledge.some(bundle =>
    bundle.domain === 'promotion'
    && bundle.sources.some(source =>
      source.need === 'promotion_eligibility'
      && (source.status === 'ok' || source.status === 'empty')));
}

export type ReadOnlyCutoverEligibilityOptions = {
  /** Recovery-mode gate: require the real OpenAI semantic supervisor to own
   * the meaning before this candidate may persist state or answer early.
   * Deterministic/provider-outage candidates then remain pure fallbacks and
   * cannot pre-mutate legacy state. */
  requireSemanticSupervisor?: boolean;
  /** Set only by a caller that is ITSELF the last resort (e.g. the legacy
   *  handler's own LLMAvailabilityError catch, invoked only after legacy's
   *  own deterministic pre-checks and its own real model attempt have
   *  already failed) -- there, a bounded honest clarifying question is
   *  strictly better than the flat generic apology, so the exclusion below
   *  is waived. The PRIMARY cutover path never sets this. */
  allowGenuinelyUnclassifiedFallback?: boolean;
  /** Cost guard hotfix: the raw customer message, used ONLY to let a
   *  requireSemanticSupervisor-gated turn through when it ALSO satisfies
   *  isTrustedZeroCostFactLookup below -- never a general relaxation of the
   *  requireSemanticSupervisor safety boundary. Populated automatically by
   *  processOneMindCustomerTurn from its own input; a caller invoking
   *  readOnlyCutoverEligibility directly may omit it, which simply keeps
   *  the exception inactive (original strict behavior). */
  message?: string;
};

const BOUNDED_NO_TRANSACTION_SLOT_KEYS = new Set([
  'date', 'time', 'partySize', 'durationMinutes', 'quantity',
]);

/**
 * A deterministic continuation may own the early recovery path when the
 * customer explicitly withholds transaction consent and the turn is either:
 *
 *  1. a uniquely resolved entity selection; or
 *  2. a bounded slot update on the same already-open task.
 *
 * The second shape matters for natural continuations such as supplying a
 * duration, date, time, or party size while explicitly saying not to book.
 * Those values have no entity reference by design, but they are still exact parser output
 * and cannot authorize an ActionProposal. Rejecting them at the semantic-
 * supervisor gate made a transient provider failure fall through every
 * canonical layer to the legacy generic degraded-booking apology even though
 * Dialog Manager had already produced the correct safe state update.
 */
export function isTrustedBoundedNoTransactionContinuation(turn: OneMindTurnResult): boolean {
  const semantic = turn.dialogSemanticTurn ?? turn.semanticTurn;
  const hasNoTransaction = semantic.constraints.some(constraint =>
    /^(?:not_yet_booking|no_transaction|not_booking|consider_only)$/iu.test(constraint));
  if (!hasNoTransaction) return false;
  if (semantic.speechAct === 'transaction_request' || ['book','order','cancel'].includes(semantic.action)) return false;
  if (turn.dialogDecision.actionProposal) return false;

  const resolvedReference = semantic.references.some(reference =>
    Boolean(reference.resolvedEntityId) || (reference.resolvedEntityIds?.length ?? 0) === 1);
  const safeContinuationAction = semantic.action === 'confirm'
    || semantic.action === 'provide_information'
    || semantic.action === 'correct_previous'
    || semantic.action === 'modify';
  if (!safeContinuationAction) return false;
  if (resolvedReference) return true;

  const before = turn.taskStateBefore.activeTask;
  const after = turn.taskStateAfter.activeTask;
  if (!before || !after) return false;
  if (before.taskId !== after.taskId || before.domain !== after.domain || semantic.domain !== after.domain) return false;
  if (before.commitmentIntent || after.commitmentIntent) return false;
  if ((semantic.informationNeed ?? 'none') !== 'none') return false;

  const entityKeys = Object.keys(semantic.entities);
  if (!entityKeys.length || !entityKeys.every(key => BOUNDED_NO_TRANSACTION_SLOT_KEYS.has(key))) return false;
  return entityKeys.every(key => Object.is(after.slots[key], semantic.entities[key]));
}

export function isTrustedBoundedCorrectionContinuation(turn: OneMindTurnResult): boolean {
  const semantic = turn.dialogSemanticTurn ?? turn.semanticTurn;
  if (turn.dialogDecision.actionProposal) return false;
  if (!(
    semantic.action === 'correct_previous'
    || semantic.action === 'modify'
    || semantic.speechAct === 'correction'
  )) return false;
  if (['book','order','cancel'].includes(semantic.action)) return false;
  if ((semantic.informationNeed ?? 'none') !== 'none') return false;

  const before = turn.taskStateBefore.activeTask;
  const after = turn.taskStateAfter.activeTask;
  const task = after ?? before;
  if (!task || task.domain !== semantic.domain) return false;
  if (before && after && before.taskId !== after.taskId) return false;
  if (before?.commitmentIntent || after?.commitmentIntent) return false;

  const selectionKeys = ['horseName','resourceName','roomType','itemName','productName','promotionName','name'];
  const hasStructuredCorrection = selectionKeys.some(key =>
    typeof semantic.entities[key] === 'string' && String(semantic.entities[key]).trim().length > 0)
    || semantic.references.some(reference =>
      Boolean(reference.resolvedEntityId) || (reference.resolvedEntityIds?.length ?? 0) === 1);
  return hasStructuredCorrection;
}

export function readOnlyCutoverEligibility(
  turn: OneMindTurnResult,
  options: ReadOnlyCutoverEligibilityOptions = {},
):
  | { eligible:true }
  | { eligible:false; reason:'transactional_or_task_turn' | 'domain_not_cut_over' } {
  if (options.requireSemanticSupervisor
      && turn.semanticTurn.semanticSource !== 'openai_supervisor') {
    // requireSemanticSupervisor exists to stop an UNVERIFIED deterministic
    // guess from pre-mutating state or answering early before legacy's own
    // careful pre-checks run -- it was never meant to force a second real
    // paid model call for a turn the cost architecture already trusts
    // enough to have skipped interpretSemanticTurn for in the first place
    // (see isTrustedZeroCostFactLookup in
    // _thongthai-one-mind-orchestrator.ts). Confirmed via a real production
    // regression: a single-activity price question correctly skipped the
    // semantic-interpreter call, but this gate then rejected the resulting
    // composed answer outright (before the composer even ran) purely
    // because its source wasn't openai_supervisor, forcing a SECOND
    // attempt that paid for grounded-response-composition anyway. The
    // exception is narrow and read-only by construction (every branch of
    // isTrustedZeroCostFactLookup is action:'ask', never a task mutation)
    // -- never a blanket relaxation for every deterministic_fallback turn.
    const trustedZeroCostBypass = options.message !== undefined
      && isTrustedZeroCostFactLookup(turn.dialogSemanticTurn ?? turn.semanticTurn, options.message);
    // A uniquely resolved prior entity plus an explicit CURRENT
    // no-transaction constraint is also safe to own without a model. It can
    // update bounded conversational/planning state, but can never create an
    // ActionProposal or transaction consent. This prevents provider/budget
    // degradation from bouncing a clear "keep this one, don't book" choice
    // into a legacy clarification loop.
    const trustedBoundedNoTransaction = isTrustedBoundedNoTransactionContinuation(turn);
    const trustedBoundedCorrection = isTrustedBoundedCorrectionContinuation(turn);
    if (!trustedZeroCostBypass && !trustedBoundedNoTransaction && !trustedBoundedCorrection) {
      return { eligible:false, reason:'transactional_or_task_turn' };
    }
  }
  // The transaction-safety gate always runs first, regardless of domain:
  // an ActionProposal can never be composed by One-Mind's read-only path.
  if (Boolean(turn.dialogDecision.actionProposal)) {
    return { eligible:false, reason:'transactional_or_task_turn' };
  }
  if (!options.allowGenuinelyUnclassifiedFallback
      && isGenuinelyUnclassifiedFallback(turn)
      && turn.semanticTurn.domain === 'unknown') {
    return { eligible:false, reason:'transactional_or_task_turn' };
  }
  const meaning = deriveSemanticMeaning(turn.dialogSemanticTurn ?? turn.semanticTurn);
  const isSafeConversationalMode = meaning.conversationalMode === 'CHAT'
    || meaning.conversationalMode === 'ASK'
    || meaning.conversationalMode === 'DISCOVER'
    || meaning.conversationalMode === 'CONSIDER'
    || meaning.conversationalMode === 'INCIDENT';
  // Narrow exception, checked BEFORE the domain-cutover gate: a turn whose
  // domain came back 'unknown' (the untrusted-semantics/modelRefinement
  // rejection fallback synthesizes exactly that -- see
  // _thongthai-one-mind-orchestrator.ts's resolveSemanticTurn) is still
  // worth composing through One-Mind IF it carries an actual customer-
  // facing reply (preserved by that same fallback whenever the model wrote
  // one -- see its own comment). A safe, on-topic reply beats a robotic
  // "domain not cut over" bounce to legacy. But when NO reply survived
  // (a genuine provider outage, or a real zero-confidence model failure),
  // legacy's own domain-specific deterministic fallback logic is not
  // necessarily worse than One-Mind's generic clarify text, so this
  // exception does NOT widen eligibility for that case -- the domain gate
  // below still applies exactly as before.
  const hasReplyToShow = Boolean((turn.dialogSemanticTurn ?? turn.semanticTurn).reply?.trim());
  if (turn.semanticTurn.domain === 'unknown' && isSafeConversationalMode && hasReplyToShow) {
    return { eligible:true };
  }
  const semantic=turn.dialogSemanticTurn??turn.semanticTurn;
  const canonicalPaymentStatusLookup = semantic.domain === 'payment'
    && semantic.intent === 'check_payment_status'
    && semantic.action === 'status'
    && semantic.informationNeed === 'transaction_status'
    && !turn.dialogDecision.actionProposal;
  if (!INITIAL_CUTOVER_DOMAINS.has(turn.semanticTurn.domain) && !canonicalPaymentStatusLookup) {
    return { eligible:false, reason:'domain_not_cut_over' };
  }
  const suspendedTask = turn.taskStateAfter.suspendedTask ?? turn.taskStateBefore.suspendedTask;
  const hasOnlySuspendedTask = Boolean(suspendedTask)
    && !turn.taskStateBefore.activeTask
    && !turn.taskStateAfter.activeTask;
  const unrelatedSuspendedMutationShape = hasOnlySuspendedTask
    && suspendedTask!.domain !== turn.semanticTurn.domain
    && !READ_ONLY_ACTIONS.has(turn.semanticTurn.action);

  if (isSafeConversationalMode && !unrelatedSuspendedMutationShape) {
    return { eligible:true };
  }
  if (READ_ONLY_ACTIONS.has(turn.semanticTurn.action)
      && !turn.taskStateBefore.activeTask
      && !turn.taskStateAfter.activeTask) {
    return { eligible:true };
  }
  if (turn.semanticTurn.action === 'correct_previous'
      && turn.semanticTurn.speechAct === 'correction'
      && !turn.taskStateBefore.activeTask
      && !turn.taskStateAfter.activeTask
      && !turn.dialogDecision.actionProposal) {
    // Correcting conversational facts (for example group composition) is
    // read-only when there is no booking/order task to mutate. Sending this
    // back to a raw-text legacy router is exactly how human corrections were
    // turning into generic fallbacks.
    return { eligible:true };
  }

  // Journey/itinerary modification edits only the bounded conversational
  // plan. There is no journey transaction executor or booking task behind it,
  // so sending "same plan, change it to tomorrow" to legacy raw-text routing
  // is both unnecessary and harmful. Real booking/order actions remain
  // protected by ActionProposal and the transaction gate above.
  if (turn.semanticTurn.domain === 'journey'
      && turn.semanticTurn.action === 'modify'
      && !turn.taskStateBefore.activeTask
      && !turn.taskStateAfter.activeTask
      && !turn.dialogDecision.actionProposal) {
    return { eligible:true };
  }

  // A pure preference/constraint declaration is also safe conversation.
  // It changes no booking/order/payment state and must not be forced back into
  // a keyword parser merely because the semantic action is
  // provide_information. Dialog Manager guarantees that a constraint-only
  // declaration with no active task creates no transactional task.
  if (turn.semanticTurn.action === 'provide_information'
      && turn.semanticTurn.constraints.length > 0
      && !turn.taskStateBefore.activeTask
      && !turn.taskStateAfter.activeTask
      && !turn.dialogDecision.actionProposal) {
    return { eligible:true };
  }
  // Human Core PR F: Restaurant now owns its bounded preorder planning
  // state inside One-Mind. Creating a NEW restaurant_preorder task is safe
  // when the Dialog Manager is only collecting/clarifying structured fields
  // and has issued no ActionProposal: this persists planning state only, never
  // an order write. The generic safe-continuation gate below enforces exactly
  // those conditions. Real execution still remains blocked above whenever an
  // ActionProposal exists and is handled only by the terminal Restaurant gate.
  // A turn that merely continues an already-active task (fills a slot,
  // corrects a field, selects an entity, or asks one clarifying question)
  // never reaches an ActionProposal -- checked above -- so it carries none of
  // the transaction-executor equivalence risk that keeps propose_action/
  // execute_tool on legacy. See TASK_CONTINUATION_SAFE_MODES.
  if (isTrustedBoundedCorrectionContinuation(turn)) {
    return { eligible:true };
  }
  if (isSafeTaskContinuationTurn(turn)) {
    return { eligible:true };
  }
  return { eligible:false, reason:'transactional_or_task_turn' };
}

function taskStateChanged(turn: OneMindTurnResult): boolean {
  return JSON.stringify(turn.taskStateBefore) !== JSON.stringify(turn.taskStateAfter);
}

async function persistAssistantConversationTurn(
  input:OneMindCustomerTurnInput,
  turn:OneMindTurnResult,
  response:ComposedResponse,
  stateDependencies:Partial<AuthoritativeStateDependencies>,
  now:Date,
):Promise<boolean> {
  const guestDbId=turn.identity.guestDbId;
  if (!guestDbId || input.persistState === false || !turn.trace.statePersisted) return false;

  const loadSnapshot=stateDependencies.loadSnapshot ?? loadGuestAgentStateSnapshot;
  const compareAndSwap=stateDependencies.compareAndSwap ?? compareAndSwapGuestAgentState;
  const assistantEventId=(`assistant:${input.eventId}`).slice(0,180);

  // The assistant's own reply is bounded/redacted by the SAME conversation
  // reducer as user turns. Without this, a natural follow-up referring
  // to what Thongthai just said has no assistant-turn evidence, so stale task
  // state can hijack the next turn.
  for(let attempt=0;attempt<4;attempt+=1){
    const snapshot=await loadSnapshot(guestDbId);
    const current=parseConversationContextState(snapshot.state.conversationContext,now);
    const isRecommendationTurn=
      ['recommend','compare'].includes(turn.semanticTurn.action)
      || turn.semanticTurn.informationNeed==='recommendation';
    const hasDurableRecommendationEvidence=response.usedFactKeys.some(key=>
      /(?:temperament|beginnerSuitable|suitability|spiceLevel|requiresMembership|recommend)/iu.test(key)
    );
    // The single long-reference slot is deliberately sticky: a later generic
    // itinerary/menu recommendation must not erase an earlier entity-specific
    // comparison that a human can naturally refer back to several turns later
    // ("the calmer one you mentioned"). Immediate newer recommendations still
    // live in recentTurns/rollingSummary; durable evaluative evidence may
    // replace this slot.
    const shouldReplaceLongRecommendation=
      turn.semanticTurn.action==='compare'
      || hasDurableRecommendationEvidence
      || (!current.lastRecommendationReference && isRecommendationTurn);
    const next=applyConversationContextUpdate(current,{
      eventId:assistantEventId,
      channel:input.channel,
      assistantMessage:response.message,
      lastRecommendationReference:shouldReplaceLongRecommendation
        ? response.message.slice(0,320)
        : undefined,
      summaryFact:(isRecommendationTurn || hasDurableRecommendationEvidence)
        ? `assistant recommendation in ${turn.semanticTurn.domain}: ${response.message.slice(0,180)}.`
        : undefined,
    },now);
    const written=await compareAndSwap(guestDbId,snapshot,{set:{conversationContext:next}},now);
    if(written.status==='applied') return true;
    if(written.status==='unconfigured') return false;
  }
  return false;
}

export async function processOneMindCustomerTurn(
  input: OneMindCustomerTurnInput,
  dependencies: Partial<OneMindDependencies> = {},
  stateDependencies: Partial<AuthoritativeStateDependencies> = {},
  now: Date = new Date(),
  eligibilityOptions: ReadOnlyCutoverEligibilityOptions = {},
): Promise<OneMindCustomerTurnResult> {
  const totalStartedAt = Date.now();
  // Threading input.message into eligibilityOptions here (rather than
  // requiring every caller to do it) is what lets
  // readOnlyCutoverEligibility's requireSemanticSupervisor exception
  // (isTrustedZeroCostFactLookup) actually engage -- see its own comment.
  const eligibilityOptionsWithMessage: ReadOnlyCutoverEligibilityOptions = {
    ...eligibilityOptions,
    message: eligibilityOptions.message ?? input.message,
  };
  const turn = await processThongthaiOneMindTurnAuthoritative(
    { ...input, persistState:input.persistState !== false },
    dependencies,
    stateDependencies,
    now,
    4,
    candidate => {
      const eligible = readOnlyCutoverEligibility(candidate, eligibilityOptionsWithMessage).eligible;
      if (!eligible) return false;
      // A grounded promotion fallback is safe to SHOW during a provider outage,
      // but requireSemanticSupervisor explicitly means deterministic meaning is
      // not authoritative enough to mutate canonical working state. Keep this
      // response-only so a temporary outage cannot steal ownership from the
      // existing promotion redemption/continuation state machine.
      if (
        eligibilityOptionsWithMessage.requireSemanticSupervisor
        && isTrustedGroundedPromotionProviderFallback(candidate, eligibilityOptionsWithMessage.message ?? input.message)
      ) {
        return false;
      }
      return true;
    },
  );
  const eligibility = readOnlyCutoverEligibility(turn, eligibilityOptionsWithMessage);

  // Never acknowledge a state-mutating conversational decision unless the
  // authoritative state write actually succeeded. This matters for cancel /
  // suspend / resume / correction turns: a pretty reply with statePersisted
  // false would tell the customer the working state changed when it did not.
  // Fall through to the existing deterministic executor instead.
  if (
    input.persistState !== false
    && taskStateChanged(turn)
    && !turn.trace.statePersisted
  ) {
    return {
      status:'legacy_required',
      turn,
      reason:'transactional_or_task_turn',
      observability:buildOneMindTraceEnvelope({
        turn,
        response:null,
        totalMs:Date.now() - totalStartedAt,
      }),
    };
  }

  if (!eligibility.eligible) {
    return {
      status:'legacy_required',
      turn,
      reason:eligibility.reason,
      observability:buildOneMindTraceEnvelope({
        turn,
        response:null,
        totalMs:Date.now() - totalStartedAt,
      }),
    };
  }

  const composerStartedAt = Date.now();
  const conversationId = input.canonicalAnonymousId ?? input.providerUserKey ?? input.guestDbId ?? 'unknown';
  const composerInput: ResponseComposerInput = {
    channel:input.channel as BrainChannel,
    language:input.language,
    userMessage:input.message,
    // dialogSemanticTurn, not the bare semanticTurn -- see OneMindTurnResult's
    // own doc comment. The Dialog Manager already planned knowledge/task-state
    // from the memory-merged constraint set; rendering from a DIFFERENT
    // (unmerged) constraint set is exactly the defect that let a remembered
    // allergy be present in state but silently absent from the recommendation
    // copy the customer actually reads.
    semanticTurn:turn.dialogSemanticTurn,
    conversationContext:turn.conversationContextAfter,
    dialogDecision:turn.dialogDecision,
    knowledgeBundles:turn.groundedKnowledge,
    degradation:turn.knowledgeDegradation,
    operationalOutcome:null,
    // Authorizes composeGroundedModelResponse's real OpenAI call (see
    // _response-composer.ts). Mirrors the exact same AiCallContext shape the
    // semantic-interpreter call already builds in
    // _thongthai-one-mind-orchestrator.ts's resolveSemanticTurn. Without a
    // real guestDbId there is no ledger key to guard/meter a paid call
    // against, so this stays null and the composer stage is skipped.
    aiCallContext: turn.identity.guestDbId ? {
      conversationId,
      guestDbId: turn.identity.guestDbId,
      channel: input.channel,
      eventId: input.eventId,
      callerLabel: 'grounded-response-composition',
      certificationMode: input.environment !== 'live'
        && process.env.THONGTHAI_SEMANTIC_CERTIFICATION_MODE === '1',
    } : null,
    allowModelComposition: (composerStartedAt - totalStartedAt) < COMPOSER_MODEL_BUDGET_CUTOFF_MS,
  };
  // Netlify's customer gateway has a finite request budget. In this
  // quality-first phase, latency pressure is the only reason a normal
  // grounded read-only turn may skip the model composer. Facts/discovery
  // alone are not a valid override reason anymore.
  // Zero-cost architecture (Phase P): a collect_field/clarify decision is
  // already-correct, already-tested centralized copy (see
  // composeDeterministicResponse in _response-composer.ts) -- asking the
  // model to rephrase "what's the missing field" would spend a call to
  // rewrite prose that is already right. "Do NOT call an LLM simply to
  // rewrite already-grounded prose" (owner's Phase P brief).
  // A cannot_verify_comparison decision is ALSO already-machine-determined
  // (see resolveDialogDecision's anti-hallucination check in
  // _dialog-manager.ts) -- no model call could add anything, it could only
  // risk phrasing it in a way that implies an answer was found.
  const explicitNamedActivitySelection =
    turn.semanticTurn.domain === 'activity'
    && turn.semanticTurn.action === 'provide_information'
    && typeof turn.semanticTurn.entities.horseName === 'string'
    && turn.semanticTurn.entities.horseName.trim().length > 0
    && turn.semanticTurn.references.some(reference =>
      reference.type === 'entity_selection'
      && Boolean(reference.resolvedEntityId));

  const conversationalStateUpdate = !turn.dialogDecision.actionProposal
    && !turn.taskStateAfter.activeTask?.commitmentIntent
    && !['book','order','cancel'].includes(turn.semanticTurn.action)
    // A correction/selection can also carry a real business-truth question
    // (for example, "if the primary asset is unavailable, use the named
    // fallback; otherwise book nothing"). That turn must still consume its
    // authoritative availability result. Treat only a pure working-state update as this
    // zero-cost acknowledgement fast path; compound information needs must
    // continue through the grounded composer and its deterministic fallback.
    && (turn.dialogSemanticTurn.informationNeed ?? 'none') === 'none'
    && (
      turn.semanticTurn.speechAct === 'selection'
      || turn.semanticTurn.speechAct === 'correction'
      || turn.semanticTurn.action === 'correct_previous'
      || turn.semanticTurn.action === 'modify'
      || explicitNamedActivitySelection
    );
  const hasModelConversationReply = Boolean(turn.dialogSemanticTurn.reply?.trim() || turn.semanticTurn.reply?.trim());
  const deterministicFastPath = (
      turn.dialogDecision.mode === 'collect_field'
      || turn.dialogDecision.responseIntent === 'cannot_verify_comparison'
      || (!hasModelConversationReply && (turn.dialogDecision.mode === 'clarify' || conversationalStateUpdate))
    )
    ? composeDeterministicResponse(composerInput)
    : null;
  const membershipFastPath = !deterministicFastPath
      && turn.semanticTurn.domain === 'membership'
      && turn.semanticTurn.action === 'ask'
    ? composeMembershipInformationResponse(composerInput)
    : null;
  // Allergy and dietary filtering is an executable safety policy over
  // authoritative menu facts, not a prose-style choice. Keep it on the
  // centralized grounded renderer so a fluent model response cannot select
  // an item without applying remembered/current restrictions first.
  const dietarySafetyFastPath = !deterministicFastPath && !membershipFastPath
      && requiresDietarySafetyGroundedResponse(turn)
    ? composeGroundedDeterministicResponse(composerInput)
    : null;
  // Cost guard hotfix: a semantic turn that already skipped the paid
  // semantic-interpreter call (semanticSource==='deterministic_fallback')
  // AND matches the same narrow, proven-unambiguous allowlist
  // (isTrustedZeroCostFactLookup) must not then spend a SECOND paid call
  // here on grounded-response-composition just to re-phrase what canonical
  // data already answers -- composeGroundedDeterministicResponse is the
  // exact same fact-grounded renderer composeThongthaiResponse itself falls
  // back to during a real outage, so this never risks a lower-quality or
  // fabricated answer, only skips paying for a rephrase. If it returns null
  // (no grounded facts found this way), the turn falls through to the
  // normal paid path below rather than ever showing a false answer.
  const zeroCostFactPath = !deterministicFastPath && !membershipFastPath && !dietarySafetyFastPath
      && turn.dialogSemanticTurn.semanticSource === 'deterministic_fallback'
      && isTrustedZeroCostFactLookup(turn.dialogSemanticTurn, input.message)
    ? composeGroundedDeterministicResponse(composerInput)
    : null;
  const groundedFastPath = !deterministicFastPath && !zeroCostFactPath && shouldPreferGroundedDeterministicResponse(
    turn,
    composerStartedAt - totalStartedAt,
  )
    ? composeGroundedDeterministicResponse(composerInput)
    : null;
  const response = deterministicFastPath ?? membershipFastPath ?? dietarySafetyFastPath ?? zeroCostFactPath ?? groundedFastPath ?? await composeThongthaiResponse(composerInput);
  const composerMs = Date.now() - composerStartedAt;
  await persistAiResponseTurn({
    conversationId,
    eventId:input.eventId,
    channel:input.channel,
    finalResponseSource:response.mode === 'model_grounded'
      ? 'openai_grounded_response'
      : response.mode === 'model'
        ? 'openai_direct_response'
        : 'deterministic_or_grounded_local',
    modelReplyUsed:response.mode === 'model' || response.mode === 'model_grounded',
    groundedKnowledgeSupplied:turn.groundedKnowledge.some(bundle=>bundle.facts.length>0),
    zeroCostTurn:response.mode === 'deterministic' && turn.semanticTurn.semanticSource !== 'openai_supervisor',
    environment:input.environment,
    occurredAt:new Date().toISOString(),
  }).catch(error=>{
    console.error('AI_RESPONSE_TURN_PERSIST_ERROR',error instanceof Error?error.message.slice(0,180):'unknown');
  });
  const assistantContextPersisted=await persistAssistantConversationTurn(
    input,turn,response,stateDependencies,new Date(now.getTime()+1),
  ).catch(error=>{
    console.error('THONGTHAI_ASSISTANT_CONTEXT_PERSIST_ERROR',error instanceof Error?error.message.slice(0,180):'unknown');
    return false;
  });
  if(input.persistState !== false && turn.trace.statePersisted && !assistantContextPersisted){
    console.log('THONGTHAI_OBSERVABILITY',JSON.stringify({
      assistant_context_persisted:false,
      event_id:input.eventId,
      channel:input.channel,
    }));
  }
  return {
    status:'composed',
    turn,
    response,
    observability:buildOneMindTraceEnvelope({
      turn,
      response,
      composerMs,
      totalMs:Date.now() - totalStartedAt,
    }),
  };
}
