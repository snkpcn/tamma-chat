import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSemanticInterpreterPrompt,
  emptySemanticContext,
  SEMANTIC_INTERPRETER_VERSION,
} from '../netlify/functions/_semantic-interpreter';
import { semanticTemperatureForCaller } from '../netlify/functions/_thongthai-model-provider';
import { SEMANTIC_EVAL_CORPUS } from './fixtures/semantic-eval-corpus';

function byId(id:string){
  const item=SEMANTIC_EVAL_CORPUS.find(row=>row.id===id);
  assert.ok(item,`missing fixture ${id}`);
  return item;
}

test('semantic-v15 version is explicit',()=>{
  assert.equal(SEMANTIC_INTERPRETER_VERSION,'semantic-v15');
});

test('semantic-v15 honestly adjudicates membership profile readback while keeping the other three live golds',()=>{
  assert.deepEqual(byId('membership-02').expected,{domain:'membership',action:'ask'});
  assert.equal(byId('membership-02').simulatedModelOutput?.informationNeed,undefined);
  assert.deepEqual(byId('activity-archery-01').expected,{domain:'activity',action:'ask'});
  assert.deepEqual(byId('restaurant-preorder-followup-01').expected,{domain:'restaurant',action:'confirm'});
  assert.deepEqual(byId('informational-02').expected,{domain:'activity',action:'discover'});
  assert.equal(byId('informational-02').simulatedModelOutput?.informationNeed,'catalog');
});

test('semantic-v15 puts category ownership, how-to, selection gating, and readback ahead of broad defaults',()=>{
  const prompt=buildSemanticInterpreterPrompt(emptySemanticContext()).replace(/\s+/g,' ');
  assert.ok(prompt.includes('HARD SEMANTIC PRIORITIES'));
  assert.ok(prompt.includes('กิจกรรม/activity/activities -> activity'));
  assert.ok(prompt.includes('Venue framing never widens an explicitly named canonical category back to ecosystem'));
  assert.ok(prompt.includes('A HOW-TO / process / explanation question about one known offering is ask'));
  assert.ok(prompt.includes('Slot values alone NEVER imply book/order and NEVER imply an availability check'));
  assert.ok(prompt.includes('Reading back an existing profile/account/record is ask'));
});

test('semantic-v15 semantic classification is deterministic but customer response brain keeps its prior sampling behavior',()=>{
  assert.equal(semanticTemperatureForCaller('semantic-interpreter'),0);
  assert.equal(semanticTemperatureForCaller('semantic-certification-group'),0);
  assert.equal(semanticTemperatureForCaller('thongthai-brain-v3'),undefined);
  assert.equal(semanticTemperatureForCaller('line-webhook'),undefined);
});
