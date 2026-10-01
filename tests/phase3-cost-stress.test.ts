import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runPhase3CostStress,
  runPhase3CostStressSuite,
} from '../scripts/phase3-cost-stress-contract';

test('Phase 3 formal 20/50/100-turn stress has no arbitrary call cliff or learned transaction escalation',()=>{
  const suite=runPhase3CostStressSuite();
  assert.equal(suite.reports.length,15,'5 independent samples at each requested length');
  for(const summary of suite.byLength){
    assert.equal(summary.samples,5);
    assert.equal(summary.arbitraryCliffTurns,0);
    assert.equal(summary.accidentalLearnedTransactions,0);
    assert.equal(summary.costThb.conversationsExceedingCap,0);
    assert.ok(summary.learnedHitRatePct>0);
    assert.ok(summary.zeroCallRatePct>=35);
    assert.ok(summary.inputTokens.max<=16_000);
  }
});

test('Phase 3 stress explicitly exercises exact and fuzzy learned-memory tiers',()=>{
  const report=runPhase3CostStress(100,0);
  assert.ok(report.learnedExactHits>0);
  assert.ok(report.learnedFuzzyHits>0);
  assert.equal(report.accidentalLearnedTransactions,0);
});

test('Phase 3 budget degradation is monetary, never the old arbitrary call-count ceiling',()=>{
  const report=runPhase3CostStress(100,2);
  assert.equal(report.arbitraryCliffTurns,0);
  assert.equal(report.costThb.conversationsExceedingCap,0);
  if(report.budgetBlockedTurns>0){
    assert.ok(
      report.paidCalls<100,
      'budget blocks may occur only after real paid semantic turns accumulated spend',
    );
  }
});
