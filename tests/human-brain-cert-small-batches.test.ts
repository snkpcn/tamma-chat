import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('final live certification uses smaller 10-case groups to reduce cross-case batch noise',()=>{
  const script=readFileSync(new URL('../scripts/write-semantic-certification-artifact.ts',import.meta.url),'utf8');
  assert.match(script,/const chunkSize=10/);
});

test('final live certification caps one build at 80 semantic cases so two same-version builds cover 158 with resume',()=>{
  const script=readFileSync(new URL('../scripts/write-semantic-certification-artifact.ts',import.meta.url),'utf8');
  assert.match(script,/SEMANTIC_CERT_MAX_CASES_PER_RUN \?\? '80'/);
  assert.match(script,/Math\.min\(158/);
  assert.match(script,/\['incomplete_provider','incomplete_chunk'\]\.includes/);
});

test('smaller-batch certification still keeps full corpus and quota-safe group spacing',()=>{
  const script=readFileSync(new URL('../scripts/write-semantic-certification-artifact.ts',import.meta.url),'utf8');
  assert.match(script,/profile:'full'/);
  assert.match(script,/SEMANTIC_CERT_INTER_GROUP_DELAY_MS \?\? '62000'/);
  assert.doesNotMatch(script,/SEMANTIC_CERT_INTER_CASE_DELAY_MS/);
});

test('malformed grouped-output recovery is quota-paced and wired into production certification',()=>{
  const script=readFileSync(new URL('../scripts/write-semantic-certification-artifact.ts',import.meta.url),'utf8');
  assert.match(script,/groupRecoveryDelayMs:interGroupDelayMs/);
});
