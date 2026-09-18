// Phase I / G.2 bridge: canonical customer-response facade.
//
// Channel handlers must not reconstruct business logic or wording. This module
// joins the authoritative One-Mind turn with the ONE Response Composer and
// exposes an intentionally narrow read-only cutover gate. Transactional or
// in-progress task turns remain on legacy until their action executor is
// migrated and equivalence-tested.
import type { BrainChannel } from './_thongthai-brain-v3';
import {
  processThongthaiOneMindTurnAuthoritative,
  type OneMindDependencies,
  type OneMindTurnInput,
  type OneMindTurnResult,
  type AuthoritativeStateDependencies,
} from './_thongthai-one-mind-orchestrator';
import {
  composeThongthaiResponse,
  type ComposedResponse,
  type ResponseLanguage,
} from './_response-composer';
import {
  buildOneMindTraceEnvelope,
  type OneMindTraceEnvelope,
} from './_one-mind-observability';

export const ONE_MIND_RESPONSE_VERSION = 'one-mind-response-v1';

const READ_ONLY_ACTIONS = new Set(['ask','discover','recommend','compare','status']);
const INITIAL_CUTOVER_DOMAINS = new Set(['restaurant','activity','stay','promotion','otop']);

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

export function readOnlyCutoverEligibility(turn: OneMindTurnResult):
  | { eligible:true }
  | { eligible:false; reason:'transactional_or_task_turn' | 'domain_not_cut_over' } {
  if (!INITIAL_CUTOVER_DOMAINS.has(turn.semanticTurn.domain)) {
    return { eligible:false, reason:'domain_not_cut_over' };
  }
  if (!READ_ONLY_ACTIONS.has(turn.semanticTurn.action)
      || Boolean(turn.dialogDecision.actionProposal)
      || Boolean(turn.taskStateBefore.activeTask)
      || Boolean(turn.taskStateAfter.activeTask)) {
    return { eligible:false, reason:'transactional_or_task_turn' };
  }
  return { eligible:true };
}

export async function processOneMindCustomerTurn(
  input: OneMindCustomerTurnInput,
  dependencies: Partial<OneMindDependencies> = {},
  stateDependencies: Partial<AuthoritativeStateDependencies> = {},
  now: Date = new Date(),
): Promise<OneMindCustomerTurnResult> {
  const totalStartedAt = Date.now();
  const turn = await processThongthaiOneMindTurnAuthoritative(
    { ...input, persistState:input.persistState !== false },
    dependencies,
    stateDependencies,
    now,
    4,
    candidate => readOnlyCutoverEligibility(candidate).eligible,
  );
  const eligibility = readOnlyCutoverEligibility(turn);
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
  const response = await composeThongthaiResponse({
    channel:input.channel as BrainChannel,
    language:input.language,
    userMessage:input.message,
    dialogDecision:turn.dialogDecision,
    knowledgeBundles:turn.groundedKnowledge,
    degradation:turn.knowledgeDegradation,
    operationalOutcome:null,
  });
  const composerMs = Date.now() - composerStartedAt;
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
