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

test('semantic-v21 version is explicit',()=>{
  assert.equal(SEMANTIC_INTERPRETER_VERSION,'semantic-v21');
});

test('semantic-v21 preserves broad evaluative golds',()=>{
  for(const id of ['discover-05','discover-06']){
    const item=byId(id);
    assert.equal(item.expected.domain,'ecosystem');
    assert.equal(item.expected.action,'recommend');
    assert.equal(item.simulatedModelOutput?.informationNeed,'recommendation');
  }
});

test('semantic-v21 defines neutral browsing versus evaluative guidance by requested answer',()=>{
  const p=buildSemanticInterpreterPrompt(emptySemanticContext()).replace(/\s+/g,' ');
  assert.ok(p.includes('discover means neutral browsing or listing of what exists, without asking the assistant to judge which options are good, worthwhile, advisable, or preferable'));
  assert.ok(p.includes('recommend means the customer asks for evaluative guidance or curation: which options are good, worthwhile, advisable, suitable, preferable, or worth choosing'));
  assert.ok(p.includes('Recommendation does not require personal preferences, traveler details, or the literal word recommend'));
  assert.ok(p.includes('If a useful answer must make an evaluative judgment or curate a subset rather than merely list the catalog, use recommend + recommendation'));
});
