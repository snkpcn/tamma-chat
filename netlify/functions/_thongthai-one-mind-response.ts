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
const INITIAL_CUTOVER_DOMAINS = new Set(['restaurant','activity','stay','promotion','otop','ecosystem','membership','cafe','journey','general','local','incident']);
const COMPOSER_MODEL_BUDGET_CUTOFF_MS = 18_000;
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
  const hasGroundedFacts = turn.groundedKnowledge.some(bundle => bundle.facts.length > 0);
  return turn.semanticTurn.action === 'discover'
    || (hasGroundedFacts && READ_ONLY_ACTIONS.has(turn.semanticTurn.action))
    || elapsedMs >= COMPOSER_MODEL_BUDGET_CUTOFF_MS;
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
};

export function readOnlyCutoverEligibility(
  turn: OneMindTurnResult,
  options: ReadOnlyCutoverEligibilityOptions = {},
):
  | { eligible:true }
  | { eligible:false; reason:'transactional_or_task_turn' | 'domain_not_cut_over' } {
  if (options.requireSemanticSupervisor
      && turn.semanticTurn.semanticSource !== 'openai_supervisor') {
    return { eligible:false, reason:'transactional_or_task_turn' };
  }
  if (!INITIAL_CUTOVER_DOMAINS.has(turn.semanticTurn.domain)) {
    return { eligible:false, reason:'domain_not_cut_over' };
  }
  if (Boolean(turn.dialogDecision.actionProposal)) {
    return { eligible:false, reason:'transactional_or_task_turn' };
  }
  if (!options.allowGenuinelyUnclassifiedFallback
      && isGenuinelyUnclassifiedFallback(turn)
      && turn.semanticTurn.domain === 'unknown') {
    return { eligible:false, reason:'transactional_or_task_turn' };
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
  // A newly-created restaurant preorder from an ambiguous party/budget
  // follow-up is not a safe task continuation yet. Let the stateful
  // deterministic restaurant advisor answer first; only an already-active
  // preorder may collect pickup fields here.
  if (!turn.taskStateBefore.activeTask
      && turn.taskStateAfter.activeTask?.type === 'restaurant_preorder') {
    return { eligible:false, reason:'transactional_or_task_turn' };
  }
  // A turn that merely continues an already-active task (fills a slot,
  // corrects a field, selects an entity, or asks one clarifying question)
  // never reaches an ActionProposal -- checked above -- so it carries none of
  // the transaction-executor equivalence risk that keeps propose_action/
  // execute_tool on legacy. See TASK_CONTINUATION_SAFE_MODES.
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
  const turn = await processThongthaiOneMindTurnAuthoritative(
    { ...input, persistState:input.persistState !== false },
    dependencies,
    stateDependencies,
    now,
    4,
    candidate => readOnlyCutoverEligibility(candidate, eligibilityOptions).eligible,
  );
  const eligibility = readOnlyCutoverEligibility(turn, eligibilityOptions);

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
  const composerInput: ResponseComposerInput = {
    channel:input.channel as BrainChannel,
    language:input.language,
    userMessage:input.message,
    semanticTurn:turn.semanticTurn,
    dialogDecision:turn.dialogDecision,
    knowledgeBundles:turn.groundedKnowledge,
    degradation:turn.knowledgeDegradation,
    operationalOutcome:null,
  };
  // Netlify's customer gateway has a finite request budget. Semantic
  // interpretation already used the model once; a second LLM call for simple
  // catalog discovery can push an otherwise-correct turn past the gateway
  // timeout. Prefer the centralized grounded deterministic renderer for
  // discovery, and whenever the orchestration phase has already consumed most
  // of the request budget. This preserves One-Mind truth/wording ownership
  // without falling back to channel-local business logic.
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
  const conversationalStateUpdate = !turn.dialogDecision.actionProposal
    && !turn.taskStateAfter.activeTask?.commitmentIntent
    && !['book','order','cancel'].includes(turn.semanticTurn.action)
    && (
      turn.semanticTurn.speechAct === 'selection'
      || turn.semanticTurn.speechAct === 'correction'
      || turn.semanticTurn.action === 'correct_previous'
      || turn.semanticTurn.action === 'modify'
    );
  const deterministicFastPath = (turn.dialogDecision.mode === 'collect_field' || turn.dialogDecision.mode === 'clarify'
      || turn.dialogDecision.responseIntent === 'cannot_verify_comparison'
      || conversationalStateUpdate)
    ? composeDeterministicResponse(composerInput)
    : null;
  const membershipFastPath = !deterministicFastPath
      && turn.semanticTurn.domain === 'membership'
      && turn.semanticTurn.action === 'ask'
    ? composeMembershipInformationResponse(composerInput)
    : null;
  const groundedFastPath = !deterministicFastPath && shouldPreferGroundedDeterministicResponse(
    turn,
    composerStartedAt - totalStartedAt,
  )
    ? composeGroundedDeterministicResponse(composerInput)
    : null;
  const response = deterministicFastPath ?? membershipFastPath ?? groundedFastPath ?? await composeThongthaiResponse(composerInput);
  const composerMs = Date.now() - composerStartedAt;
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
