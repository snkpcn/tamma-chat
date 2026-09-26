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

test('semantic-v28 version is explicit',()=>{
  assert.equal(SEMANTIC_INTERPRETER_VERSION,'semantic-v28');
});

test('semantic-v28 honestly adjudicates evaluative broad requests as recommendation',()=>{
  const local=byId('discover-05');
  assert.equal(local.message,'แถวนี้ทำไรดี');
  assert.equal(local.expected.domain,'ecosystem');
  assert.equal(local.expected.action,'recommend');
  assert.equal(local.simulatedModelOutput?.informationNeed,'recommendation');

  const onsite=byId('discover-06');
  assert.equal(onsite.message,'ที่นี่มีอะไรน่าทำ');
  assert.equal(onsite.expected.domain,'ecosystem');
  assert.equal(onsite.expected.action,'recommend');
  assert.equal(onsite.simulatedModelOutput?.informationNeed,'recommendation');
});

test('semantic-v28 keeps bare discovery with companion context as discovery',()=>{
  const partner=byId('discover-07');
  assert.equal(partner.message,'พาแฟนมา มีไรทำ');
  assert.deepEqual(partner.expected,{domain:'ecosystem',action:'discover'});
});

test('semantic-v28 final precedence separates broad browsing from evaluative choosing',()=>{
  const p=buildSemanticInterpreterPrompt(emptySemanticContext()).replace(/\s+/g,' ');
  assert.ok(p.includes('For broad ecosystem requests, asking what exists or what there is to do remains discover even when traveler or companion context is present'));
  assert.ok(p.includes('Move to recommend when the CURRENT utterance asks what is good, worth doing, suitable, recommended, or asks the assistant to choose'));
});
