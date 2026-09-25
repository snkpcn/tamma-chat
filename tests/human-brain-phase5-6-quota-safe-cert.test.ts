import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  runSemanticCertification,
} from '../netlify/functions/_semantic-live-certification';
import type { SemanticTurn } from '../netlify/functions/_semantic-interpreter';

function passingTurn(): SemanticTurn {
  return {
    domain:'ecosystem',
    intent:'broad_experience_discovery',
    action:'discover',
    informationNeed:'catalog',
    entities:{},
    references:[],
    constraints:[],
    confidence:1,
    needsClarification:false,
  };
}

test('Phase 5.6: live certification supports inter-case pacing across selected cases', async () => {
  const calledAt:number[]=[];
  await runSemanticCertification({
    profile:'full',
    start:0,
    limit:3,
    availabilityRetries:0,
    interCaseDelayMs:25,
    interpret:async () => {
      calledAt.push(Date.now());
      return passingTurn();
    },
  });

  assert.equal(calledAt.length,3);
  assert.ok(calledAt[1]! - calledAt[0]! >= 20);
  assert.ok(calledAt[2]! - calledAt[1]! >= 20);
});

test('Phase 5.6: pacing also applies at a resumed/nonzero start boundary', async () => {
  const calledAt:number[]=[];
  const started=Date.now();
  await runSemanticCertification({
    profile:'full',
    start:20,
    limit:1,
    availabilityRetries:0,
    interCaseDelayMs:25,
    interpret:async () => {
      calledAt.push(Date.now());
      return passingTurn();
    },
  });
  assert.equal(calledAt.length,1);
  assert.ok(calledAt[0]! - started >= 20);
});

test('Phase 5.6: one-shot production runner has a conservative default pacing interval and keeps provider failures separate', () => {
  const script=readFileSync(new URL('../scripts/write-semantic-certification-artifact.ts',import.meta.url),'utf8');
  assert.match(script,/SEMANTIC_CERT_INTER_CASE_DELAY_MS/);
  assert.match(script,/4250/);
  assert.match(script,/interCaseDelayMs/);
  assert.match(script,/providerFailed/);
  assert.match(script,/availabilityComplete/);
  assert.match(script,/stopOnProviderFailure:true/);
});
