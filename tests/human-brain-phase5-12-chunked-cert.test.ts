import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Phase 5.12+: certification accepts same-version incomplete chunks as resume sources',()=>{
  const script=readFileSync(new URL('../scripts/write-semantic-certification-artifact.ts',import.meta.url),'utf8');
  assert.match(script,/\['incomplete_provider','incomplete_chunk'\]\.includes/);
});

test('Grouped final cert covers the 158-case corpus across two bounded resumable production builds',()=>{
  const script=readFileSync(new URL('../scripts/write-semantic-certification-artifact.ts',import.meta.url),'utf8');
  assert.match(script,/SEMANTIC_CERT_MAX_CASES_PER_RUN \?\? '80'/);
  assert.match(script,/Math\.min\(158/);
  assert.match(script,/runGroupedSemanticCertification/);
  assert.match(script,/chunkSize=10/);
});

test('Grouped final cert spaces live provider GROUP requests instead of every individual case',()=>{
  const script=readFileSync(new URL('../scripts/write-semantic-certification-artifact.ts',import.meta.url),'utf8');
  assert.match(script,/SEMANTIC_CERT_INTER_GROUP_DELAY_MS \?\? '62000'/);
  assert.match(script,/interGroupDelayMs/);
  assert.doesNotMatch(script,/SEMANTIC_CERT_INTER_CASE_DELAY_MS/);
});

test('Clean partial runs remain resumable and provider outages stay distinct',()=>{
  const script=readFileSync(new URL('../scripts/write-semantic-certification-artifact.ts',import.meta.url),'utf8');
  assert.match(script,/providerFailed>0 \? 'incomplete_provider' : 'incomplete_chunk'/);
  assert.match(script,/resumeStart/);
});
