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

test('semantic-v25 preserves the three remaining v24 gold meanings',()=>{
  assert.deepEqual(byId('discover-07').expected,{domain:'ecosystem',action:'discover'});
  assert.deepEqual(byId('otop-02').expected,{domain:'otop',action:'order'});
  assert.deepEqual(byId('restaurant-constraint-01').expected,{domain:'restaurant',action:'provide_information'});
});

test('semantic-v25 separates speech act from payload and constraints',()=>{
  const p=buildSemanticInterpreterPrompt(emptySemanticContext()).replace(/\s+/g,' ');
  assert.ok(p.includes('Separate the user speech act from payload details'));
  assert.ok(p.includes('Companion, traveler, party size, budget, dietary, preference, or other payload details may populate entities or constraints without changing the requested action'));
  assert.ok(p.includes('A neutral browse request remains discover even when it also carries companion or traveler metadata'));
});

test('semantic-v25 recognizes constraint-only continuation as provide information',()=>{
  const p=buildSemanticInterpreterPrompt(emptySemanticContext()).replace(/\s+/g,' ');
  assert.ok(p.includes('When an active recommendation or selection flow is awaiting preferences or constraints and the CURRENT utterance supplies only those parameters, use provide_information'));
  assert.ok(p.includes('Do not turn a constraint-supply turn into recommend merely because the supplied data will later be used to make a recommendation'));
});

test('semantic-v25 preserves explicit transaction intent with missing target slots',()=>{
  const p=buildSemanticInterpreterPrompt(emptySemanticContext()).replace(/\s+/g,' ');
  assert.ok(p.includes('An explicit transaction directive remains order or book even when the exact product or offering has not yet been selected'));
  assert.ok(p.includes('Missing target selection is a slot or clarification problem for deterministic downstream handling, not a reason to reinterpret the turn as discover + catalog'));
});

test('semantic-v25 version is explicit',()=>{
  assert.equal(SEMANTIC_INTERPRETER_VERSION,'semantic-v25');
});
