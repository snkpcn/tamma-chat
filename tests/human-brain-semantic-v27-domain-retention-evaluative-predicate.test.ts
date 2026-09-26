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

test('semantic-v28 preserves all semantic-v26 chunk-one failure gold meanings',()=>{
  assert.deepEqual(byId('discover-05').expected,{domain:'ecosystem',action:'recommend'});
  assert.deepEqual(byId('journey-01').expected,{domain:'journey',action:'confirm'});
  assert.deepEqual(byId('journey-02').expected,{domain:'journey',action:'ask'});
  assert.deepEqual(byId('cancel-01').expected,{domain:'stay',action:'cancel'});
  assert.deepEqual(byId('modify-01').expected,{domain:'activity',action:'ask'});
});

test('semantic-v28 keeps recognizable business domains when record identity is missing',()=>{
  const p=buildSemanticInterpreterPrompt(emptySemanticContext()).replace(/\s+/g,' ');
  assert.ok(p.includes('Determine domain from the explicit semantic business object before checking whether a specific record identifier is available'));
  assert.ok(p.includes('Missing record identity can require clarification, but it must not erase a recognizable business domain'));
  assert.ok(p.includes('Use unknown only when no business subject can be identified from the current utterance or grounded context'));
});

test('semantic-v28 treats embedded qualitative judgment as recommendation',()=>{
  const p=buildSemanticInterpreterPrompt(emptySemanticContext()).replace(/\s+/g,' ');
  assert.ok(p.includes('An embedded request for qualitative judgment is recommend even when no separate recommendation verb appears'));
  assert.ok(p.includes('The grammatical shape of a broad what-to-do question does not make it neutral when the requested answer is an opinion about desirability'));
});

test('semantic-v28 version is explicit',()=>{
  assert.equal(SEMANTIC_INTERPRETER_VERSION,'semantic-v28');
});
