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

test('semantic-v22 version is explicit',()=>{
  assert.equal(SEMANTIC_INTERPRETER_VERSION,'semantic-v22');
});

test('semantic-v22 keeps both remaining v17 full-cert golds unchanged',()=>{
  assert.deepEqual(byId('l-journey-04').expected,{domain:'activity',action:'recommend',needsClarification:false});
  assert.equal(byId('l-journey-04').simulatedModelOutput?.informationNeed,'recommendation');
  assert.deepEqual(byId('l-journey-10').expected,{domain:'journey',action:'recommend',needsClarification:false});
});

test('semantic-v22 decides single requested target before incidental sequence language',()=>{
  const p=buildSemanticInterpreterPrompt(emptySemanticContext()).replace(/\s+/g,' ');
  assert.ok(p.includes('First decide whether the customer is asking you to choose exactly ONE primary offering or to design a MULTI-PART plan'));
  assert.ok(p.includes('Exactly one requested activity remains activity even when it must happen before or after a meal, stay, or other event'));
  assert.ok(p.includes('The second event is only a timing boundary unless the customer asks you to choose, arrange, or coordinate it too'));
});

test('semantic-v22 makes journey composition recommend and reserves discover for existing journey catalogs',()=>{
  const p=buildSemanticInterpreterPrompt(emptySemanticContext()).replace(/\s+/g,' ');
  assert.ok(p.includes('When the requested deliverable is a NEW multi-part plan, itinerary, or coordination of two or more customer goals, use journey + recommend'));
  assert.ok(p.includes('journey + discover is only for browsing already-existing itinerary/package/plan options'));
  assert.ok(p.includes('Named components do not make a new-plan request catalog discovery'));
});
