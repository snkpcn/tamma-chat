import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  computeAvailabilityRetryDelayMs,
  runSemanticCertification,
} from '../netlify/functions/_semantic-live-certification';
import { SEMANTIC_EVAL_CORPUS } from './fixtures/semantic-eval-corpus';

test('final cert: 429/circuit gets quota cooldown while 503/timeout/network gets short transient retry',()=>{
  assert.equal(computeAvailabilityRetryDelayMs([
    {provider:'gemini',model:'m',outcome:'rate_limited',httpStatus:429,elapsedMs:1},
  ],61_000,10_000),61_000);
  assert.equal(computeAvailabilityRetryDelayMs([
    {provider:'gemini',model:'m',outcome:'circuit_open',elapsedMs:0},
  ],61_000,10_000),61_000);
  assert.equal(computeAvailabilityRetryDelayMs([
    {provider:'gemini',model:'m',outcome:'server_error',httpStatus:503,elapsedMs:100},
    {provider:'gemini',model:'m2',outcome:'timeout',elapsedMs:100},
  ],61_000,10_000),10_000);
  assert.equal(computeAvailabilityRetryDelayMs([
    {provider:'gemini',model:'m',outcome:'network_error',elapsedMs:100},
  ],61_000,10_000),10_000);
});

test('final cert: transient retry is actually used and provider error is not counted if the retry succeeds',async()=>{
  let calls=0;
  const result=await runSemanticCertification({
    start:0,
    limit:1,
    availabilityRetries:1,
    availabilityRetryDelayMs:25,
    transientAvailabilityRetryDelayMs:1,
    interpret:async()=>{
      calls+=1;
      if(calls===1){
        const error=new Error('temporary');
        (error as Error & {attempts?:unknown}).attempts=[
          {provider:'gemini',model:'gemini-test',outcome:'server_error',httpStatus:503,elapsedMs:1},
        ];
        throw error;
      }
      return {
        domain:'ecosystem',
        intent:'broad_experience_discovery',
        action:'discover',
        informationNeed:'none',
        entities:{},
        references:[],
        constraints:[],
        confidence:1,
        needsClarification:false,
      };
    },
  });
  assert.equal(calls,2);
  assert.equal(result.providerFailed,0);
  assert.equal(result.semanticEvaluated,1);
});

test('final cert: bare which-one gold requires clarification and does not force one action label',()=>{
  const item=SEMANTIC_EVAL_CORPUS.find(row=>row.id==='reference-02');
  assert.ok(item);
  assert.equal(item.expected.domain,'activity');
  assert.equal(item.expected.action,undefined);
  assert.equal(item.expected.needsClarification,true);
});

test('final cert: one-shot runner uses two retries with separate transient delay',()=>{
  const script=readFileSync(new URL('../scripts/write-semantic-certification-artifact.ts',import.meta.url),'utf8');
  assert.match(script,/availabilityRetries:2/);
  assert.match(script,/transientAvailabilityRetryDelayMs=10_000/);
  assert.match(script,/availabilityRetryDelayMs=61_000/);
});
