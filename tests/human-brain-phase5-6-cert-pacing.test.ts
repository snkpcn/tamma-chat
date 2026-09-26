import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  runSemanticCertification,
} from '../netlify/functions/_semantic-live-certification';
import type { SemanticTurn } from '../netlify/functions/_semantic-interpreter';

function validTurn():SemanticTurn {
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

test('Human Brain 5.6 RED: live certification spaces provider calls instead of bursting project quota',async()=>{
  const calledAt:number[]=[];
  await runSemanticCertification({
    start:0,
    limit:3,
    availabilityRetries:0,
    interCaseDelayMs:25,
    interpret:async()=>{
      calledAt.push(Date.now());
      return validTurn();
    },
  });

  assert.equal(calledAt.length,3);
  assert.ok(calledAt[1]! - calledAt[0]! >= 20);
  assert.ok(calledAt[2]! - calledAt[1]! >= 20);
});

test('Human Brain 5.6+: production one-shot runner explicitly enables bounded live-provider pacing',()=>{
  const source=readFileSync(new URL('../scripts/write-semantic-certification-artifact.ts',import.meta.url),'utf8');
  assert.match(source,/runGroupedSemanticCertification/);
  assert.match(source,/SEMANTIC_CERT_INTER_GROUP_DELAY_MS/);
  assert.match(source,/interGroupDelayMs/);
  assert.match(source,/availabilityRetryDelayMs/);
});
