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

test('semantic-v23 preserves both remaining v21 full-cert gold meanings',()=>{
  assert.deepEqual(byId('l-cafe-04').expected,{domain:'cafe',action:'ask',needsClarification:true});
  assert.equal(byId('l-cafe-04').simulatedModelOutput?.informationNeed,undefined);

  assert.deepEqual(byId('l-journey-09').expected,{domain:'journey',action:'recommend',needsClarification:false});
  assert.equal(byId('l-journey-09').simulatedModelOutput?.informationNeed,undefined);
});

test('semantic-v23 makes topic-only subject inquiries clarify instead of browsing',()=>{
  const p=buildSemanticInterpreterPrompt(emptySemanticContext()).replace(/\s+/g,' ');
  assert.ok(p.includes('A topic-only inquiry that merely names a subject without asking to browse, choose, check status, price, policy, or another concrete fact must stay ask + none with needsClarification=true'));
  assert.ok(p.includes('Do not infer catalog discovery merely because the named subject is a product, menu class, activity class, room class, promotion class, or other business category'));
});

test('semantic-v23 keeps generic cross-business flow as journey composition',()=>{
  const p=buildSemanticInterpreterPrompt(emptySemanticContext()).replace(/\s+/g,' ');
  assert.ok(p.includes('When the customer asks for an unspecified thing to do so that it flows directly into another business experience, the requested deliverable is the sequence'));
  assert.ok(p.includes('Use journey + recommend for that sequence even when the first leg could individually be an activity'));
});

test('semantic-v23 version is explicit',()=>{
  assert.equal(SEMANTIC_INTERPRETER_VERSION,'semantic-v23');
});
