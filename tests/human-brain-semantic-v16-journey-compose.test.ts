import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSemanticInterpreterPrompt,
  emptySemanticContext,
  SEMANTIC_INTERPRETER_VERSION,
} from '../netlify/functions/_semantic-interpreter';
import { PHASE_L_SEMANTIC_CASES } from './fixtures/phase-l-semantic-cases';

function byId(id:string){
  const item=PHASE_L_SEMANTIC_CASES.find(row=>row.id===id);
  assert.ok(item,`missing fixture ${id}`);
  return item;
}

test('semantic-v25 version is explicit',()=>{
  assert.equal(SEMANTIC_INTERPRETER_VERSION,'semantic-v25');
});

test('semantic-v25 keeps both full-corpus journey compose gold labels unchanged',()=>{
  assert.deepEqual(byId('l-journey-01').expected,{domain:'journey',action:'recommend',needsClarification:false});
  assert.deepEqual(byId('l-journey-10').expected,{domain:'journey',action:'recommend',needsClarification:false});
});

test('semantic-v25 gives new journey composition recommend precedence over generic ask',()=>{
  const normalized=buildSemanticInterpreterPrompt(emptySemanticContext()).replace(/\s+/g,' ');
  assert.ok(normalized.includes('Creating, arranging, or composing a NEW itinerary or multi-step journey for the customer is recommend, not ask'));
  assert.ok(normalized.includes('This includes a duration-bounded plan or a plan that combines multiple requested experiences or business units'));
  assert.ok(normalized.includes('Use ask for retrieving, resuming, explaining, or discussing an existing plan when the customer is not asking you to design a new one'));
});
