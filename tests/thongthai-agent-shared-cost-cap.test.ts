import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function source(path:string):string {
  return readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
}

test('primary Agent budget includes active legacy AI ledger spend before a paid turn', () => {
  const session=source('netlify/functions/_thongthai-agent-session.ts');
  assert.match(session,/readActiveAiLedgerSpendThb/u);
  assert.match(session,/externalLegacySpendThb/u);
  assert.match(session,/combinedSpendThb/u);
  assert.match(session,/capThb - combinedSpendThb < AGENT_TURN_RESERVE_THB/u);
});

test('legacy AI reservation includes active primary Agent spend before another paid call', () => {
  const ledger=source('netlify/functions/_ai-cost-ledger.ts');
  assert.match(ledger,/thongthaiProductionAgentSession/u);
  assert.match(ledger,/externalPrimaryAgentCostUsd/u);
  assert.match(ledger,/ledger\.cumulativeCostUsd \+ ledger\.reservedCostUsd \+ externalPrimaryAgentCostUsd \+ reservedCostUsd/u);
});
