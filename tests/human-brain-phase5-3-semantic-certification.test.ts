import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSemanticCertification } from '../netlify/functions/_semantic-live-certification';
import type { SemanticTurn } from '../netlify/functions/_semantic-interpreter';
import { LLMAvailabilityError } from '../netlify/functions/_thongthai-model-provider';

test('Phase 5.3 semantic certification helper is stateless and supports injected model interpretation', async () => {
  const turn: SemanticTurn = {
    domain:'ecosystem',
    intent:'broad_experience_discovery',
    action:'discover',
    informationNeed:'none',
    entities:{},
    references:[],
    constraints:[],
    confidence:0.95,
    needsClarification:false,
  };

  const result = await runSemanticCertification({
    profile:'full',
    start:0,
    limit:1,
    interpret:async () => turn,
  });

  assert.equal(result.evaluated,1);
  assert.equal(result.pass,1);
  assert.equal(result.failed,0);
});

test('Phase 5.3 full certification corpus is large enough to be meaningful', async () => {
  const result = await runSemanticCertification({
    profile:'full',
    start:0,
    limit:1,
    interpret:async () => ({
      domain:'ecosystem',
      intent:'broad_experience_discovery',
      action:'discover',
      informationNeed:'none',
      entities:{},
      references:[],
      constraints:[],
      confidence:0.95,
      needsClarification:false,
    }),
  });
  assert.ok(result.totalCorpusCases >= 140);
});


test('Phase 5.4 live cert retries a transient provider availability failure without counting it as semantic failure', async () => {
  let calls=0;
  const result=await runSemanticCertification({
    profile:'full',
    start:0,
    limit:1,
    availabilityRetries:1,
    availabilityRetryDelayMs:1,
    interpret:async () => {
      calls += 1;
      if(calls===1){
        throw new LLMAvailabilityError('rate limited',[{
          provider:'gemini',
          model:'gemini-3.8-flash',
          outcome:'rate_limited',
          httpStatus:429,
          elapsedMs:20,
        }]);
      }
      return {
        domain:'ecosystem',
        intent:'broad_experience_discovery',
        action:'discover',
        informationNeed:'none',
        entities:{},
        references:[],
        constraints:[],
        confidence:0.95,
        needsClarification:false,
      };
    },
  });

  assert.equal(calls,2);
  assert.equal(result.pass,1);
  assert.equal(result.semanticFailed,0);
  assert.equal(result.providerFailed,0);
  assert.equal(result.semanticEvaluated,1);
  assert.equal(result.availabilityComplete,true);
});

test('Phase 5.4 live cert reports persistent provider outage separately and can stop before polluting semantic score', async () => {
  let calls=0;
  const result=await runSemanticCertification({
    profile:'full',
    start:0,
    limit:3,
    availabilityRetries:0,
    stopOnProviderFailure:true,
    interpret:async () => {
      calls += 1;
      throw new LLMAvailabilityError('quota exhausted',[{
        provider:'gemini',
        model:'gemini-3.8-flash',
        outcome:'rate_limited',
        httpStatus:429,
        elapsedMs:10,
      },{
        provider:'gemini',
        model:'gemini-3.7-flash',
        outcome:'circuit_open',
        elapsedMs:0,
      }]);
    },
  });

  assert.equal(calls,1);
  assert.equal(result.evaluated,1);
  assert.equal(result.semanticEvaluated,0);
  assert.equal(result.pass,0);
  assert.equal(result.semanticFailed,0);
  assert.equal(result.providerFailed,1);
  assert.equal(result.passPct,0);
  assert.equal(result.availabilityComplete,false);
  assert.equal(result.failures.length,1);
  assert.equal(result.failures[0]?.providerError?.name,'LLMAvailabilityError');
  assert.deepEqual(
    result.failures[0]?.providerError?.attempts.map(item=>item.outcome),
    ['rate_limited','circuit_open'],
  );
});
