import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSemanticInterpreterPrompt,
  emptySemanticContext,
  SEMANTIC_INTERPRETER_VERSION,
} from '../netlify/functions/_semantic-interpreter';
import { SEMANTIC_EVAL_CORPUS } from './fixtures/semantic-eval-corpus';

test('semantic-v19 version is explicit',()=>{
  assert.equal(SEMANTIC_INTERPRETER_VERSION,'semantic-v19');
});

test('semantic-v19 doctrine locks selection-with-slots and explicit category domain ownership',()=>{
  const prompt=buildSemanticInterpreterPrompt(emptySemanticContext());
  assert.ok(prompt.includes('Selecting a previously presented option while supplying extra scheduling or quantity slots remains confirm'));
  assert.ok(prompt.includes('does not become book/order unless the CURRENT utterance explicitly commits to submit the transaction'));
  assert.ok(prompt.includes('When the CURRENT utterance explicitly names a canonical business category such as activities'));
  assert.ok(prompt.includes('that category owns the domain rather than ecosystem'));
});

test('semantic-v19 keeps both completed-v10 first-chunk gold labels unchanged',()=>{
  const byId=(id:string)=>SEMANTIC_EVAL_CORPUS.find(item=>item.id===id)!;

  const select=byId('restaurant-preorder-followup-01');
  assert.ok(select);
  assert.equal(select.expected.domain,'restaurant');
  assert.equal(select.expected.action,'confirm');

  const catalog=byId('informational-02');
  assert.ok(catalog);
  assert.equal(catalog.expected.domain,'activity');
  assert.equal(catalog.expected.action,'discover');
  assert.equal(catalog.simulatedModelOutput?.informationNeed,'catalog');
});
