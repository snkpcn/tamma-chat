import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildSemanticInterpreterPrompt,
  emptySemanticContext,
  SEMANTIC_INTERPRETER_VERSION,
} from '../netlify/functions/_semantic-interpreter';
import {
  runGroupedSemanticCertification,
  type GroupedSemanticClassifier,
} from '../netlify/functions/_semantic-live-certification';
import { SEMANTIC_EVAL_CORPUS } from './fixtures/semantic-eval-corpus';

test('semantic-v13 version is explicit so v11 partial evidence cannot be resumed',()=>{
  assert.equal(SEMANTIC_INTERPRETER_VERSION,'semantic-v13');
});

test('semantic-v13 makes an explicitly requested single business catalog own the domain',()=>{
  const prompt=buildSemanticInterpreterPrompt(emptySemanticContext());
  assert.ok(prompt.includes('The requested catalog noun owns domain classification'));
  assert.ok(prompt.includes('If the customer asks what activities are offered, domain=activity'));
  assert.ok(prompt.includes('ecosystem only when the requested discovery itself spans businesses or stays genuinely broad'));
});

test('semantic-v13 keeps informational-02 gold unchanged',()=>{
  const item=SEMANTIC_EVAL_CORPUS.find(candidate=>candidate.id==='informational-02');
  assert.ok(item);
  assert.equal(item.expected.domain,'activity');
  assert.equal(item.expected.action,'discover');
  assert.equal(item.simulatedModelOutput?.informationNeed,'catalog');
});

test('grouped certification retries the same malformed envelope once without advancing or inventing case results',async()=>{
  let calls=0;
  const classifyGroup:GroupedSemanticClassifier=async(items)=>{
    calls+=1;
    if(calls===1) throw new SyntaxError('bad grouped json');
    return new Map(items.map(item=>[item.id,item.simulatedModelOutput]));
  };
  const result=await runGroupedSemanticCertification({
    profile:'full',
    start:0,
    limit:10,
    classifyGroup,
    formatRetries:1,
    formatRetryDelayMs:0,
  });
  assert.equal(calls,2);
  assert.equal(result.semanticEvaluated,10);
  assert.equal(result.pass,10);
  assert.equal(result.semanticFailed,0);
  assert.equal(result.providerFailed,0);
});

test('persistent malformed grouped output still fails the selected group explicitly after bounded retry',async()=>{
  let calls=0;
  const classifyGroup:GroupedSemanticClassifier=async()=>{
    calls+=1;
    throw new SyntaxError('still bad grouped json');
  };
  const result=await runGroupedSemanticCertification({
    profile:'full',
    start:10,
    limit:10,
    classifyGroup,
    formatRetries:1,
    formatRetryDelayMs:0,
  });
  assert.equal(calls,2);
  assert.equal(result.semanticEvaluated,10);
  assert.equal(result.semanticFailed,10);
  assert.equal(result.pass,0);
  assert.equal(result.providerFailed,0);
  assert.equal(result.failures.length,10);
});

test('production certification enables one quota-spaced malformed-envelope retry',()=>{
  const script=readFileSync(new URL('../scripts/write-semantic-certification-artifact.ts',import.meta.url),'utf8');
  assert.match(script,/formatRetries:1/);
  assert.match(script,/formatRetryDelayMs:availabilityRetryDelayMs/);
});
