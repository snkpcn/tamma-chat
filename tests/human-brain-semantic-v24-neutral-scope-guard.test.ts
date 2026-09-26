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

test('semantic-v28 preserves the two remaining v23 gold meanings',()=>{
  assert.deepEqual(byId('discover-04').expected,{domain:'ecosystem',action:'discover'});
  assert.deepEqual(byId('discover-07').expected,{domain:'ecosystem',action:'discover'});
});

test('semantic-v28 treats generic action predicates as broad ecosystem scope',()=>{
  const p=buildSemanticInterpreterPrompt(emptySemanticContext()).replace(/\s+/g,' ');
  assert.ok(p.includes('A generic action predicate describes what the customer wants to do; it is not a canonical business-category noun'));
  assert.ok(p.includes('Without an explicit category, named offering, or already-grounded category context, keep broad something-to-do requests in ecosystem'));
});

test('semantic-v28 does not turn companion context into evaluation by itself',()=>{
  const p=buildSemanticInterpreterPrompt(emptySemanticContext()).replace(/\s+/g,' ');
  assert.ok(p.includes('Traveler, companion, family, couple, age, or group context alone does not make a neutral browse request evaluative'));
  assert.ok(p.includes('Use recommend only when the CURRENT utterance asks for judgment, suitability, preference-sensitive choice, what is good, or another evaluative decision'));
});

test('semantic-v28 version is explicit',()=>{
  assert.equal(SEMANTIC_INTERPRETER_VERSION, 'semantic-v30');
});
