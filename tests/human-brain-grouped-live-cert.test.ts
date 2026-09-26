import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  runGroupedSemanticCertification,
  type GroupedSemanticClassifier,
} from '../netlify/functions/_semantic-live-certification';

test('grouped certification evaluates twenty independent corpus cases with one classifier call',async()=>{
  let calls=0;
  const classifyGroup:GroupedSemanticClassifier=async(items)=>{
    calls+=1;
    return new Map(items.map(item=>[item.id,item.simulatedModelOutput]));
  };
  const result=await runGroupedSemanticCertification({
    profile:'full',
    start:0,
    limit:20,
    classifyGroup,
  });
  assert.equal(calls,1);
  assert.equal(result.semanticEvaluated,20);
  assert.equal(result.pass,20);
  assert.equal(result.semanticFailed,0);
  assert.equal(result.providerFailed,0);
  assert.equal(result.availabilityComplete,true);
});

test('grouped certification preserves per-case context through real parser validation',async()=>{
  const classifyGroup:GroupedSemanticClassifier=async(items)=>{
    return new Map(items.map(item=>[item.id,item.simulatedModelOutput]));
  };
  const result=await runGroupedSemanticCertification({
    profile:'full',
    start:20,
    limit:20,
    classifyGroup,
  });
  assert.equal(result.semanticEvaluated,20);
  assert.equal(result.pass,20);
  assert.equal(result.semanticFailed,0);
});

test('grouped provider outage is availability failure and does not advance semantic prefix',async()=>{
  const classifyGroup:GroupedSemanticClassifier=async()=>{
    const error=Object.assign(new Error('quota'),{
      name:'LLMAvailabilityError',
      attempts:[{
        provider:'gemini' as const,
        model:'gemini-3.1-flash-lite',
        outcome:'rate_limited' as const,
        httpStatus:429,
        elapsedMs:10,
      }],
    });
    throw error;
  };
  const result=await runGroupedSemanticCertification({
    profile:'full',
    start:12,
    limit:20,
    classifyGroup,
  });
  assert.equal(result.semanticEvaluated,0);
  assert.equal(result.providerFailed,1);
  assert.equal(result.availabilityComplete,false);
  assert.equal(result.failures[0]?.providerError?.attempts[0]?.model,'gemini-3.1-flash-lite');
});
