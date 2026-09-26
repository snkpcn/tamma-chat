import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSemanticInterpreterPrompt,
  emptySemanticContext,
  parseSemanticTurnResponse,
  SEMANTIC_INTERPRETER_VERSION,
} from '../netlify/functions/_semantic-interpreter';
import { SEMANTIC_EVAL_CORPUS } from './fixtures/semantic-eval-corpus';

function byId(id:string){
  const item=SEMANTIC_EVAL_CORPUS.find(row=>row.id===id);
  assert.ok(item,`missing fixture ${id}`);
  return item;
}

test('semantic-v18 version is explicit',()=>{
  assert.equal(SEMANTIC_INTERPRETER_VERSION,'semantic-v18');
});

test('semantic-v18 keeps all five v12 live gold labels unchanged',()=>{
  assert.deepEqual(byId('stay-01').expected,{domain:'stay',action:'status'});
  assert.deepEqual(byId('reference-02').expected,{domain:'activity',action:'ask'});
  assert.deepEqual(byId('journey-01').expected,{domain:'journey',action:'confirm'});
  assert.deepEqual(byId('modify-01').expected,{domain:'activity',action:'ask'});
  assert.deepEqual(byId('informational-01').expected,{domain:'restaurant',action:'ask'});
});

test('semantic-v18 prompt distinguishes availability, identity, save-plan, permission, and venue-domain boundaries',()=>{
  const prompt=buildSemanticInterpreterPrompt(emptySemanticContext());
  assert.ok(prompt.includes('Bare existence questions about reservable resources ask current availability'));
  assert.ok(prompt.includes('A bare identity question like "which one?" asks to identify or disambiguate'));
  assert.ok(prompt.includes('Saving or bookmarking a journey plan is not a booking transaction'));
  assert.ok(prompt.includes('Do not create a prior-context reference merely because the customer mentions a generic booking noun'));
  assert.ok(prompt.includes('an unqualified ร้าน operating-hours question belongs to restaurant'));
});

test('semantic-v18 structurally normalizes modify+policy into a read-only ask',()=>{
  const turn=parseSemanticTurnResponse(JSON.stringify({
    domain:'activity',
    intent:'ask_booking_change_policy',
    action:'modify',
    informationNeed:'policy',
    entities:{},
    references:[],
    constraints:[],
    confidence:0.9,
    needsClarification:false,
  }),emptySemanticContext());
  assert.equal(turn.domain,'activity');
  assert.equal(turn.action,'ask');
  assert.equal(turn.informationNeed,'policy');
});
