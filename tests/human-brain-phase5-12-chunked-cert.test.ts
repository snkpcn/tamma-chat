import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Phase 5.12: certification accepts same-version incomplete chunks as resume sources',()=>{
  const script=readFileSync(new URL('../scripts/write-semantic-certification-artifact.ts',import.meta.url),'utf8');
  assert.match(script,/\['incomplete_provider','incomplete_chunk'\]\.includes/);
});

test('Phase 5.12: certification is bounded to at most 75 semantic cases per production build',()=>{
  const script=readFileSync(new URL('../scripts/write-semantic-certification-artifact.ts',import.meta.url),'utf8');
  assert.match(script,/SEMANTIC_CERT_MAX_CASES_PER_RUN/);
  assert.match(script,/Math\.min\(75/);
  assert.match(script,/semanticCasesThisRun<maxSemanticCasesPerRun/);
  assert.match(script,/limit:Math\.min\(chunkSize,remainingChunkBudget\)/);
});

test('Phase 5.12: final free-tier pacing defaults to nine seconds per case',()=>{
  const script=readFileSync(new URL('../scripts/write-semantic-certification-artifact.ts',import.meta.url),'utf8');
  assert.match(script,/SEMANTIC_CERT_INTER_CASE_DELAY_MS \?\? '9000'/);
  assert.match(script,/: 9_000/);
});

test('Phase 5.12: clean partial runs are incomplete_chunk, provider outages stay incomplete_provider',()=>{
  const script=readFileSync(new URL('../scripts/write-semantic-certification-artifact.ts',import.meta.url),'utf8');
  assert.match(script,/providerFailed>0 \? 'incomplete_provider' : 'incomplete_chunk'/);
});
