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
  assert.equal(SEMANTIC_INTERPRETER_VERSION, 'semantic-v30');
});

test('semantic-v28 preserves the three v22 live-failure gold meanings',()=>{
  assert.deepEqual(byId('discover-04').expected,{domain:'ecosystem',action:'discover'});
  for(const id of ['discover-05','discover-06']){
    assert.equal(byId(id).expected.domain,'ecosystem');
    assert.equal(byId(id).expected.action,'recommend');
    assert.equal(byId(id).simulatedModelOutput?.informationNeed,'recommendation');
  }
});

test('semantic-v28 decides broad scope before answer type without lexical category guessing',()=>{
  const p=buildSemanticInterpreterPrompt(emptySemanticContext()).replace(/\s+/g,' ');
  assert.ok(p.includes('Decide DOMAIN SCOPE before ACTION for broad experience requests'));
  assert.ok(p.includes('Generic do, play, visit, or experience wording is not an explicit activity-category request'));
  assert.ok(p.includes('Only an explicit canonical category noun, named offering, or clearly bounded business subject narrows broad ecosystem scope'));
});

test('semantic-v28 makes evaluative guidance outrank catalog browsing after scope is chosen',()=>{
  const p=buildSemanticInterpreterPrompt(emptySemanticContext()).replace(/\s+/g,' ');
  assert.ok(p.includes('After domain scope is chosen, decide the requested ANSWER TYPE'));
  assert.ok(p.includes('Neutral listing of what exists is discover'));
  assert.ok(p.includes('asking which possibilities are good, worthwhile, advisable, suitable, or worth doing is recommend + recommendation'));
  assert.ok(p.includes('Do not downgrade evaluative guidance to discover + catalog merely because the utterance also asks what exists'));
});
