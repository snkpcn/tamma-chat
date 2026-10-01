import assert from 'node:assert/strict';
import { runPhase3CostStressSuite } from './phase3-cost-stress-contract';

const suite=runPhase3CostStressSuite();
console.log(JSON.stringify({
  kind:suite.kind,
  byLength:suite.byLength,
},null,2));

for(const row of suite.byLength){
  assert.equal(row.arbitraryCliffTurns,0,`${row.turns}-turn samples hit an arbitrary fixed-call cliff`);
  assert.equal(row.accidentalLearnedTransactions,0,`${row.turns}-turn samples let learned semantics own a transaction`);
  assert.equal(row.costThb.conversationsExceedingCap,0,`${row.turns}-turn samples exceeded the hard cost cap`);
  assert.ok(row.learnedHitRatePct>0,`${row.turns}-turn samples never exercised learned memory`);
  assert.ok(row.zeroCallRatePct>=35,`${row.turns}-turn zero-call rate unexpectedly low: ${row.zeroCallRatePct}%`);
}
