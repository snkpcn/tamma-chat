import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSemanticInterpreterPrompt,
  emptySemanticContext,
  SEMANTIC_INTERPRETER_VERSION,
} from '../netlify/functions/_semantic-interpreter';
import { SEMANTIC_EVAL_CORPUS } from './fixtures/semantic-eval-corpus';

function byId(id:string){
  const item=SEMANTIC_EVAL_CORPUS.find(row=>row.id===id);
  assert.ok(item,`missing fixture ${id}`);
  return item;
}

test('semantic-v18 version is explicit',()=>{
  assert.equal(SEMANTIC_INTERPRETER_VERSION,'semantic-v18');
});

test('semantic-v18 keeps journey-02 and informational-02 gold unchanged',()=>{
  assert.deepEqual(byId('journey-02').expected,{domain:'journey',action:'ask'});
  assert.deepEqual(byId('informational-02').expected,{domain:'activity',action:'discover'});
  assert.equal(byId('informational-02').simulatedModelOutput?.informationNeed,'catalog');
});

test('semantic-v18 removes the activity-domain contradiction and gives explicit category nouns priority',()=>{
  const prompt=buildSemanticInterpreterPrompt(emptySemanticContext());
  const normalized=prompt.replace(/\s+/g,' ');
  assert.ok(normalized.includes('Generic do/play/visit wording alone may remain ecosystem'));
  assert.ok(normalized.includes('an explicit canonical category noun such as activities establishes that category domain'));
  assert.ok(normalized.includes('No specific activity entity is required when the customer explicitly asks for the activity category itself'));
  assert.equal(normalized.includes('Use activity only when a specific activity/activity entity is stated'),false);
});

test('semantic-v18 distinguishes retrieving an existing saved artifact from catalog discovery',()=>{
  const prompt=buildSemanticInterpreterPrompt(emptySemanticContext());
  const normalized=prompt.replace(/\s+/g,' ');
  assert.ok(normalized.includes('Retrieving, viewing, reopening, or showing one existing saved artifact is ask'));
  assert.ok(normalized.includes('discover + catalog is for browsing multiple options or categories, not reading back a specific saved artifact'));
  assert.ok(normalized.includes('A saved journey/plan that already exists is an artifact, not a journey catalog'));
});
