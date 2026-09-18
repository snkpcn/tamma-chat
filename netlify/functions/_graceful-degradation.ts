// Phase H — canonical graceful-degradation policy.
//
// This module contains MACHINE DECISIONS only. It never writes customer-facing
// prose, never queries a database, and never executes a transaction. Phase I's
// Response Composer turns these safe reason codes into channel-appropriate
// language.
//
// Keep these states distinct:
// MODEL_UNAVAILABLE != SOURCE_UNAVAILABLE != VERIFIED_EMPTY != FACT_UNKNOWN.
import {
  LLMAvailabilityError,
  LLMRequestError,
  ProviderNotConfiguredError,
} from './_thongthai-model-provider';
import type { KnowledgeBundle, KnowledgeSourceTrace } from './_knowledge-resolver';
import type { TaskStateContainer } from './_task-state';

export const GRACEFUL_DEGRADATION_VERSION = 'degradation-v1';

export type DegradationCondition =
  | 'none'
  | 'model_unavailable'
  | 'model_invalid'
  | 'source_unavailable'
  | 'verified_empty'
  | 'fact_unknown'
  | 'internal_error';

export type DegradationLevel =
  | 'normal'
  | 'grounded_deterministic'
  | 'deterministic_transactional_continuation'
  | 'human_handoff'
  | 'final_failure';

export type DegradationReasonCode =
  | 'provider_stack_exhausted'
  | 'provider_response_invalid'
  | 'authoritative_source_unavailable'
  | 'authoritative_source_empty'
  | 'fact_not_verified'
  | 'partial_grounding_available'
  | 'active_task_present'
  | 'deterministic_fallback_available'
  | 'deterministic_continuation_available'
  | 'human_followup_required'
  | 'unexpected_internal_error';

export type DegradationPlan = {
  version: string;
  condition: DegradationCondition;
  level: DegradationLevel;
  reasonCodes: DegradationReasonCode[];
  retryable: boolean;
  /** Phase H never grants write permission. A later transaction boundary still
   * requires an explicit, validated ActionProposal even when a deterministic
   * continuation is available. */
  safeToExecuteTransaction: false;
  sourceStates: Array<{
    sourceId: string;
    status: KnowledgeSourceTrace['status'];
    reason?: KnowledgeSourceTrace['reason'];
  }>;
};

export type ModelDegradationOptions = {
  taskState?: TaskStateContainer | null;
  /** True only when an EXISTING, tested deterministic fallback can handle the
   * current turn without model language understanding. Never infer this merely
   * because a task exists. */
  deterministicFallbackAvailable?: boolean;
  /** Stronger than the above: an existing deterministic state machine/parser
   * can safely continue the already-active transaction conversation. */
  deterministicContinuationAvailable?: boolean;
};

function plan(
  condition: DegradationCondition,
  level: DegradationLevel,
  reasonCodes: DegradationReasonCode[],
  retryable: boolean,
  sourceStates: DegradationPlan['sourceStates'] = [],
): DegradationPlan {
  return {
    version: GRACEFUL_DEGRADATION_VERSION,
    condition,
    level,
    reasonCodes: [...new Set(reasonCodes)],
    retryable,
    safeToExecuteTransaction: false,
    sourceStates,
  };
}

export function planModelDegradation(error: unknown, options: ModelDegradationOptions = {}): DegradationPlan {
  const activeTask = Boolean(options.taskState?.activeTask);

  if (error instanceof LLMAvailabilityError || error instanceof ProviderNotConfiguredError) {
    if (options.deterministicContinuationAvailable && activeTask) {
      return plan(
        'model_unavailable',
        'deterministic_transactional_continuation',
        ['provider_stack_exhausted', 'active_task_present', 'deterministic_continuation_available'],
        true,
      );
    }
    if (options.deterministicFallbackAvailable) {
      return plan(
        'model_unavailable',
        'grounded_deterministic',
        ['provider_stack_exhausted', 'deterministic_fallback_available'],
        true,
      );
    }
    return plan(
      'model_unavailable',
      'human_handoff',
      ['provider_stack_exhausted', ...(activeTask ? ['active_task_present' as const] : []), 'human_followup_required'],
      true,
    );
  }

  if (error instanceof LLMRequestError) {
    // A blocked/invalid/parse-class model response is different from provider
    // availability. Retrying another provider blindly can repeat a bad request
    // or policy block, so preserve the distinction for observability/composer.
    return plan(
      'model_invalid',
      options.deterministicFallbackAvailable ? 'grounded_deterministic' : 'human_handoff',
      ['provider_response_invalid', ...(options.deterministicFallbackAvailable ? ['deterministic_fallback_available' as const] : ['human_followup_required' as const])],
      false,
    );
  }

  return plan(
    'internal_error',
    'final_failure',
    ['unexpected_internal_error'],
    false,
  );
}

function sourceStates(bundles: readonly KnowledgeBundle[]): DegradationPlan['sourceStates'] {
  return bundles.flatMap(bundle => bundle.sources.map(source => ({
    sourceId: source.sourceId,
    status: source.status,
    reason: source.reason,
  })));
}

/** Convert Phase E's source truth into degradation state without collapsing
 * EMPTY, UNAVAILABLE and UNKNOWN. This operates on already-resolved bundles;
 * it never fetches anything itself. */
export function planKnowledgeDegradation(bundles: readonly KnowledgeBundle[]): DegradationPlan {
  if (!bundles.length) return plan('none', 'normal', [], false);

  const states = sourceStates(bundles);
  const hasFacts = bundles.some(bundle => bundle.facts.length > 0);
  const hasUnavailable = states.some(source => source.status === 'unavailable' && source.reason !== 'no_source_registered');
  const hasUnknown = states.some(source => source.reason === 'no_source_registered')
    || bundles.some(bundle => bundle.missing.length > 0 && !bundle.sources.length);
  const hasEmpty = states.some(source => source.status === 'empty');

  if (hasUnavailable) {
    return plan(
      'source_unavailable',
      hasFacts ? 'grounded_deterministic' : 'human_handoff',
      ['authoritative_source_unavailable', ...(hasFacts ? ['partial_grounding_available' as const] : ['human_followup_required' as const])],
      true,
      states,
    );
  }

  if (hasUnknown) {
    return plan(
      'fact_unknown',
      hasFacts ? 'grounded_deterministic' : 'human_handoff',
      ['fact_not_verified', ...(hasFacts ? ['partial_grounding_available' as const] : ['human_followup_required' as const])],
      false,
      states,
    );
  }

  if (hasEmpty && !hasFacts) {
    return plan(
      'verified_empty',
      'grounded_deterministic',
      ['authoritative_source_empty'],
      false,
      states,
    );
  }

  return plan('none', 'normal', [], false, states);
}
