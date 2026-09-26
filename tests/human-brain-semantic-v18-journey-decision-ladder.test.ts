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

test('semantic-v18 version is explicit',()=>{
  assert.equal(SEMANTIC_INTERPRETER_VERSION,'semantic-v18');
});

test('semantic-v18 keeps both remaining full-cert gold labels unchanged',()=>{
  assert.deepEqual(byId('l-journey-04').expected,{domain:'activity',action:'recommend',needsClarification:false});
  assert.equal(byId('l-journey-04').simulatedModelOutput?.informationNeed,'recommendation');
  assert.deepEqual(byId('l-journey-10').expected,{domain:'journey',action:'recommend',needsClarification:false});
});

test('semantic-v18 has one ordered journey-vs-activity decision ladder',()=>{
  const p=buildSemanticInterpreterPrompt(emptySemanticContext()).replace(/\s+/g,' ');
  assert.ok(p.includes('JOURNEY VS SINGLE-ACTIVITY DECISION LADDER'));
  assert.ok(p.includes('Count requested deliverables, not every event noun mentioned'));
  assert.ok(p.includes('ONE requested activity plus another event used only as a timing anchor => domain=activity'));
  assert.ok(p.includes('TWO OR MORE requested business deliverables that the customer wants arranged together => domain=journey'));
  assert.ok(p.includes('When journey composition is the requested deliverable, action=recommend'));
  assert.ok(p.includes('Use discover only when the customer is browsing what options exist without asking you to arrange or compose them'));
});

test('semantic-v18 removes the weaker overlapping final journey rules',()=>{
  const p=buildSemanticInterpreterPrompt(emptySemanticContext());
  assert.equal(p.includes('Creating, arranging, or composing a NEW itinerary or multi-step journey for the customer is recommend, not ask.'),false);
  assert.equal(p.includes('If the customer explicitly asks for one activity as the target and another event is only a timing anchor, stay in activity.'),false);
});
