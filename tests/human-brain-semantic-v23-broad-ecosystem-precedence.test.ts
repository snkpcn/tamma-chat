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

test('semantic-v23 preserves the three semantic-v22 chunk1 gold meanings',()=>{
  assert.deepEqual(byId('discover-04').expected,{domain:'ecosystem',action:'discover'});
  assert.deepEqual(byId('discover-05').expected,{domain:'ecosystem',action:'recommend'});
  assert.equal(byId('discover-05').simulatedModelOutput?.informationNeed,'recommendation');
  assert.deepEqual(byId('discover-06').expected,{domain:'ecosystem',action:'recommend'});
  assert.equal(byId('discover-06').simulatedModelOutput?.informationNeed,'recommendation');
});

test('semantic-v23 resolves broad ecosystem domain before action',()=>{
  const p=buildSemanticInterpreterPrompt(emptySemanticContext()).replace(/\s+/g,' ');
  assert.ok(p.includes('When no canonical business category or named entity is present and the customer asks generally for something to do, play, try, or experience, keep domain=ecosystem'));
  assert.ok(p.includes('A generic activity-like verb does not by itself establish domain=activity'));
});

test('semantic-v23 lets evaluative meaning outrank existence-shaped wording',()=>{
  const p=buildSemanticInterpreterPrompt(emptySemanticContext()).replace(/\s+/g,' ');
  assert.ok(p.includes('After broad ecosystem domain is chosen, neutral requests that only ask what exists use discover'));
  assert.ok(p.includes('Evaluative guidance that asks what is good, worthwhile, advisable, suitable, preferable, or worth doing uses recommend + recommendation even when the utterance is grammatically shaped like an existence question'));
});

test('semantic-v23 version is explicit',()=>{
  assert.equal(SEMANTIC_INTERPRETER_VERSION,'semantic-v23');
});
