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

test('semantic-v28 preserves the four semantic-v25 live-failure boundary gold meanings',()=>{
  assert.deepEqual(byId('discover-05').expected,{domain:'ecosystem',action:'recommend'});
  assert.deepEqual(byId('discover-06').expected,{domain:'ecosystem',action:'recommend'});
  assert.deepEqual(byId('discover-07').expected,{domain:'ecosystem',action:'discover'});
  assert.deepEqual(byId('informational-02').expected,{domain:'activity',action:'discover'});
});

test('semantic-v28 preserves inherent evaluation after contextual metadata is removed',()=>{
  const p=buildSemanticInterpreterPrompt(emptySemanticContext()).replace(/\s+/g,' ');
  assert.ok(p.includes('Remove only contextual metadata, then classify the semantic remainder'));
  assert.ok(p.includes('An evaluative property of the requested possibilities remains recommend'));
  assert.ok(p.includes('Metadata neutrality must never erase evaluation already expressed by the request itself'));
});

test('semantic-v28 resolves an explicit category noun before venue framing or generic predicates',()=>{
  const p=buildSemanticInterpreterPrompt(emptySemanticContext()).replace(/\s+/g,' ');
  assert.ok(p.includes('Resolve explicit category nouns before interpreting place framing or generic action predicates'));
  assert.ok(p.includes('An explicit canonical category noun anchors its own business domain'));
  assert.ok(p.includes('A place reference such as here or nearby does not widen that explicit category back to ecosystem'));
});

test('semantic-v28 version is explicit',()=>{
  assert.equal(SEMANTIC_INTERPRETER_VERSION, 'semantic-v30');
});
