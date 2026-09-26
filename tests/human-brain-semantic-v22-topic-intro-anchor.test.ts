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

test('semantic-v22 keeps vague topic introduction as ask + clarification',()=>{
  const item=byId('l-cafe-04');
  assert.equal(item.message,'อยากถามเรื่องเครื่องดื่มเย็น');
  assert.equal(item.expected.domain,'cafe');
  assert.equal(item.expected.action,'ask');
  assert.equal(item.expected.needsClarification,true);
});

test('semantic-v22 honestly adjudicates one activity with a meal anchor as activity recommendation',()=>{
  const item=byId('l-journey-09');
  assert.equal(item.message,'มีอะไรทำแล้วไปกินข้าวต่อได้พอดี');
  assert.equal(item.expected.domain,'activity');
  assert.equal(item.expected.action,'recommend');
  assert.equal(item.simulatedModelOutput?.informationNeed,'recommendation');
});

test('semantic-v22 precedence separates topic introduction from catalog browsing and preserves one-target meal anchors',()=>{
  const p=buildSemanticInterpreterPrompt(emptySemanticContext()).replace(/\s+/g,' ');
  assert.ok(p.includes('A vague topic introduction or request to ask about a subject is ask and needs clarification when no concrete information need is stated'));
  assert.ok(p.includes('Do not turn a topic introduction into discover + catalog merely because the topic names a product or menu category'));
  assert.ok(p.includes('When the customer wants one primary activity and mentions a later meal only as a timing or sequencing anchor, keep the domain activity rather than journey'));
});
