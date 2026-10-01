import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aiCostPolicy,
  reserveWorstCaseCostUsd,
  usdToThb,
} from '../netlify/functions/_ai-cost-policy';
import {
  PHASE3_SEMANTIC_INPUT_RESERVE_MULTIPLIER,
  reservationInputTokensForAiCall,
} from '../netlify/functions/_ai-cost-ledger';
import { RESPONSE_COMPOSER_MAX_OUTPUT_TOKENS } from '../netlify/functions/_thongthai-model-provider';

test('Phase 3 semantic reservation keeps calibrated headroom without falling back to absolute 16k every call',()=>{
  const policy=aiCostPolicy();
  const estimate=4_200;
  const reserved=reservationInputTokensForAiCall(
    {callerLabel:'semantic-interpreter'},
    estimate,
    policy.absoluteInputTokens,
  );
  assert.equal(PHASE3_SEMANTIC_INPUT_RESERVE_MULTIPLIER,1.5);
  assert.equal(reserved,6_300);
  assert.ok(reserved<policy.absoluteInputTokens);

  // Live calibration max actual/estimate was 0.6359. The runtime does not
  // depend on that exact number, but this proves the reviewed 1.5x policy
  // retains >2x input-token headroom over the observed maximum ratio.
  const calibratedObservedMaxRatio=0.6359;
  assert.ok(reserved/(estimate*calibratedObservedMaxRatio)>2);
});

test('Phase 3 does not loosen non-semantic reservations',()=>{
  const policy=aiCostPolicy();
  assert.equal(
    reservationInputTokensForAiCall(
      {callerLabel:'grounded-response-composer'},
      4_200,
      policy.absoluteInputTokens,
    ),
    policy.absoluteInputTokens,
  );
  assert.equal(RESPONSE_COMPOSER_MAX_OUTPUT_TOKENS,900);
});

test('semantic output ceiling keeps headroom over live max while reducing theoretical reservation',()=>{
  const policy=aiCostPolicy();
  assert.equal(policy.semanticMaxOutputTokens,700);
  assert.ok(policy.semanticMaxOutputTokens>499,'must retain headroom over Phase 3 live max output');

  const oldReserveThb=usdToThb(reserveWorstCaseCostUsd('gpt-5.6-terra',16_000,900));
  const newInput=reservationInputTokensForAiCall(
    {callerLabel:'semantic-interpreter'},
    4_200,
    policy.absoluteInputTokens,
  );
  const newReserveThb=usdToThb(
    reserveWorstCaseCostUsd('gpt-5.6-terra',newInput,policy.semanticMaxOutputTokens),
  );
  assert.ok(newReserveThb<oldReserveThb);
  assert.ok(newReserveThb>0);
});
