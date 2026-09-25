import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSemanticInterpreterPrompt, emptySemanticContext } from '../netlify/functions/_semantic-interpreter';
import { SEMANTIC_EVAL_CORPUS } from './fixtures/semantic-eval-corpus';

function byId(id:string){
  const item=SEMANTIC_EVAL_CORPUS.find(row=>row.id===id);
  assert.ok(item,`missing fixture ${id}`);
  return item;
}

test('Human Brain 5.5 RED: semantic prompt defines broad ecosystem vs specific activity domain without phrase routing',()=>{
  const prompt=buildSemanticInterpreterPrompt(emptySemanticContext());
  assert.match(prompt,/generic.*whole-property.*ecosystem/is);
  assert.match(prompt,/activity.*specific activity.*entity|specific activity.*entity.*activity/is);
  assert.match(prompt,/generic.*do|play|visit.*must not.*activity/is);
});

test('Human Brain 5.5 RED: semantic prompt gives mutually useful discover vs recommend definitions',()=>{
  const prompt=buildSemanticInterpreterPrompt(emptySemanticContext());
  assert.match(prompt,/discover.*catalog|catalog.*discover/is);
  assert.match(prompt,/recommend.*help.*choose|help.*choose.*recommend/is);
  assert.match(prompt,/menu.*what.*available.*discover|discover.*menu.*available/is);
});

test('Human Brain 5.5 RED: semantic prompt separates selection confirmation from transaction execution',()=>{
  const prompt=buildSemanticInterpreterPrompt(emptySemanticContext());
  assert.match(prompt,/confirm.*previously.*presented|previously.*presented.*confirm/is);
  assert.match(prompt,/book.*explicit.*transaction|explicit.*transaction.*book/is);
  assert.match(prompt,/provide_information.*open question|open question.*provide_information/is);
});

test('Human Brain 5.5 RED: availability uses status consistently across domains',()=>{
  for(const id of ['restaurant-table-availability-01','stay-01','stay-02','reference-07','typo-03','topic-switch-01']){
    const item=byId(id);
    assert.equal(item.expected.action,'status',`${id} should use status for availability`);
    assert.equal(item.simulatedModelOutput.action,'status',`${id} simulated output should use status`);
  }
});

test('Human Brain 5.5 RED: context-free elliptical availability does not hallucinate a stay domain',()=>{
  const item=byId('stay-02');
  assert.equal(item.context?.activeDomain,'stay');
});

test('Human Brain 5.5 RED: restaurant catalog browsing is discover, recommendation is reserved for choosing',()=>{
  for(const id of ['restaurant-01','restaurant-02','typo-02','multi-intent-01']){
    const item=byId(id);
    assert.equal(item.expected.action,'discover',`${id} is catalog/options discovery`);
    assert.equal(item.simulatedModelOutput.action,'discover');
  }
});

test('Human Brain 5.5 RED: contextual selection and slot answers retain non-transaction actions',()=>{
  assert.equal(byId('reference-03').expected.action,'confirm');
  assert.equal(byId('reference-04').expected.action,'confirm');
  assert.equal(byId('reference-06').expected.action,'provide_information');
  assert.equal(byId('reference-02').expected.action,'ask');
});
