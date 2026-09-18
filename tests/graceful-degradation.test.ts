import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GRACEFUL_DEGRADATION_VERSION,
  planKnowledgeDegradation,
  planModelDegradation,
} from '../netlify/functions/_graceful-degradation';
import {
  LLMAvailabilityError,
  LLMRequestError,
  ProviderNotConfiguredError,
  isAvailabilityHttpStatus,
  shouldFallbackToSecondaryProvider,
} from '../netlify/functions/_thongthai-model-provider';
import { emptyTaskStateContainer, type ActiveTask } from '../netlify/functions/_task-state';
import type { KnowledgeBundle } from '../netlify/functions/_knowledge-resolver';

const NOW = '2026-09-18T12:00:00.000Z';

function activeTask(): ActiveTask {
  return {
    taskId:'task-1', type:'activity_booking', domain:'activity', status:'collecting',
    slots:{ resourceCode:'activity-horse', date:'2026-09-19' }, missingFields:['durationMinutes'],
    selectedEntities:[], constraints:[], sourceChannel:'line', createdAt:NOW, updatedAt:NOW,
  };
}

function bundle(overrides: Partial<KnowledgeBundle> = {}): KnowledgeBundle {
  return {
    domain:'promotion', sources:[], facts:[], entities:[], missing:[], warnings:[], freshness:'live',
    ...overrides,
  };
}

test('Phase H version is explicit', () => {
  assert.equal(GRACEFUL_DEGRADATION_VERSION, 'degradation-v1');
});

test('provider hierarchy treats missing primary configuration as fallback-eligible', () => {
  assert.equal(shouldFallbackToSecondaryProvider(new ProviderNotConfiguredError()), true);
});

test('provider hierarchy treats availability failures as fallback-eligible but bad requests as not', () => {
  assert.equal(shouldFallbackToSecondaryProvider(new LLMAvailabilityError('timeout')), true);
  assert.equal(shouldFallbackToSecondaryProvider(new LLMRequestError('blocked')), false);
});

test('provider availability status set covers throttling and transient 5xx only', () => {
  for (const status of [429,500,502,503,504]) assert.equal(isAvailabilityHttpStatus(status), true);
  for (const status of [400,401,403,404,422]) assert.equal(isAvailabilityHttpStatus(status), false);
});

test('exhausted model stack without a proven deterministic fallback routes to human handoff', () => {
  const result = planModelDegradation(new LLMAvailabilityError('all providers down'));
  assert.equal(result.condition, 'model_unavailable');
  assert.equal(result.level, 'human_handoff');
  assert.equal(result.safeToExecuteTransaction, false);
  assert.ok(result.reasonCodes.includes('provider_stack_exhausted'));
});

test('model outage may use a tested deterministic fallback, but still never grants write permission', () => {
  const result = planModelDegradation(new LLMAvailabilityError('all providers down'), {
    deterministicFallbackAvailable:true,
  });
  assert.equal(result.level, 'grounded_deterministic');
  assert.equal(result.safeToExecuteTransaction, false);
});

test('deterministic transactional continuation requires BOTH active task and explicit capability', () => {
  const state = emptyTaskStateContainer();
  state.activeTask = activeTask();
  const result = planModelDegradation(new LLMAvailabilityError('down'), {
    taskState:state,
    deterministicContinuationAvailable:true,
  });
  assert.equal(result.level, 'deterministic_transactional_continuation');
  assert.equal(result.safeToExecuteTransaction, false);

  const noTask = planModelDegradation(new LLMAvailabilityError('down'), {
    taskState:emptyTaskStateContainer(),
    deterministicContinuationAvailable:true,
  });
  assert.equal(noTask.level, 'human_handoff');
});

test('invalid model response is distinct from provider unavailability', () => {
  const result = planModelDegradation(new LLMRequestError('invalid json'));
  assert.equal(result.condition, 'model_invalid');
  assert.equal(result.retryable, false);
});

test('VERIFIED_EMPTY stays an authoritative empty answer, not source failure', () => {
  const result = planKnowledgeDegradation([bundle({
    sources:[{ need:'promotion_eligibility', sourceId:'promotions_active', sourceType:'promotion_runtime', status:'empty' }],
  })]);
  assert.equal(result.condition, 'verified_empty');
  assert.equal(result.level, 'grounded_deterministic');
  assert.equal(result.retryable, false);
  assert.ok(result.reasonCodes.includes('authoritative_source_empty'));
});

test('SOURCE_UNAVAILABLE with zero grounded facts requires handoff, never becomes EMPTY', () => {
  const result = planKnowledgeDegradation([bundle({
    sources:[{ need:'promotion_eligibility', sourceId:'promotions_active', sourceType:'promotion_runtime', status:'unavailable', reason:'source_unavailable' }],
    missing:['promotion_eligibility'],
  })]);
  assert.equal(result.condition, 'source_unavailable');
  assert.equal(result.level, 'human_handoff');
  assert.equal(result.retryable, true);
  assert.notEqual(result.condition, 'verified_empty');
});

test('SOURCE_UNAVAILABLE with partial verified facts may answer only the grounded portion', () => {
  const result = planKnowledgeDegradation([bundle({
    sources:[
      { need:'catalog', sourceId:'activity_live', sourceType:'activity_live', status:'ok' },
      { need:'availability', sourceId:'activity_availability', sourceType:'activity_live', status:'unavailable', reason:'source_unavailable' },
    ],
    facts:[{
      key:'activity:horse:name', value:'ขี่ม้า', domain:'activity', sourceId:'activity_live',
      sourceType:'activity_live', authoritative:true, fetchedAt:NOW,
    }],
    missing:['availability'],
  })]);
  assert.equal(result.condition, 'source_unavailable');
  assert.equal(result.level, 'grounded_deterministic');
  assert.ok(result.reasonCodes.includes('partial_grounding_available'));
});

test('FACT_UNKNOWN / no registered source is distinct from unavailable and empty', () => {
  const result = planKnowledgeDegradation([bundle({
    domain:'cafe',
    sources:[{ need:'catalog', sourceId:'none', sourceType:'cafe_live', status:'unavailable', reason:'no_source_registered' }],
    missing:['catalog'],
  })]);
  assert.equal(result.condition, 'fact_unknown');
  assert.equal(result.retryable, false);
  assert.notEqual(result.condition, 'source_unavailable');
  assert.notEqual(result.condition, 'verified_empty');
});

test('healthy grounded knowledge returns normal degradation state', () => {
  const result = planKnowledgeDegradation([bundle({
    sources:[{ need:'catalog', sourceId:'restaurant_menu', sourceType:'restaurant_live', status:'ok' }],
    facts:[{
      key:'menu:1:name', value:'ส้มตำ', domain:'restaurant', sourceId:'restaurant_menu',
      sourceType:'restaurant_live', authoritative:true, fetchedAt:NOW,
    }],
  })]);
  assert.equal(result.condition, 'none');
  assert.equal(result.level, 'normal');
});
