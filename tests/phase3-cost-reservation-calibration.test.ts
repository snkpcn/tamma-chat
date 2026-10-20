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

// Phase 3 originally sized EVERY non-semantic caller at the flat absolute
// ceiling, which was affordable under the 5 THB cap this test was written
// for. At the owner's 2 THB ceiling that flat reservation is ~2.95 THB on a
// single call, so the grounded composer became permanently budget-blocked
// from turn one (see tests/composer-budget-unblocked.test.ts). The reviewed
// callers are now sized from their real prompt; the safety property that
// actually matters -- an UNREVIEWED caller never inherits a cheap
// reservation -- is asserted below and is unchanged.
test('reservation sizing is per reviewed caller, and unreviewed callers stay at the absolute ceiling',()=>{
  const policy=aiCostPolicy();
  assert.equal(
    reservationInputTokensForAiCall(
      {callerLabel:'some-unreviewed-future-caller'},
      4_200,
      policy.absoluteInputTokens,
    ),
    policy.absoluteInputTokens,
  );
  // callPreferredModel's own default label is deliberately unregistered.
  assert.equal(
    reservationInputTokensForAiCall({callerLabel:'unknown'},4_200,policy.absoluteInputTokens),
    policy.absoluteInputTokens,
  );
  // A reviewed caller is sized from this prompt, never the flat ceiling.
  assert.equal(
    reservationInputTokensForAiCall(
      {callerLabel:'grounded-response-composer'},
      4_200,
      policy.absoluteInputTokens,
    ),
    6_300,
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
