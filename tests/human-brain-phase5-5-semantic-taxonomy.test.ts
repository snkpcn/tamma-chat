import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSemanticInterpreterPrompt,
  emptySemanticContext,
  parseSemanticTurnResponse,
} from '../netlify/functions/_semantic-interpreter';
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


test('Human Brain 5.5: closed information facets canonicalize read-only action labels',()=>{
  const base={
    domain:'stay',
    intent:'room_availability_query',
    entities:{},
    references:[],
    constraints:[],
    confidence:0.9,
    needsClarification:false,
  };

  const availability=parseSemanticTurnResponse(JSON.stringify({
    ...base,
    action:'ask',
    informationNeed:'availability',
  }),emptySemanticContext());
  assert.equal(availability.action,'status');

  const catalog=parseSemanticTurnResponse(JSON.stringify({
    ...base,
    domain:'restaurant',
    intent:'menu_catalog_request',
    action:'recommend',
    informationNeed:'catalog',
  }),emptySemanticContext());
  assert.equal(catalog.action,'discover');

  const recommendation=parseSemanticTurnResponse(JSON.stringify({
    ...base,
    domain:'restaurant',
    intent:'menu_recommendation_request',
    action:'discover',
    informationNeed:'recommendation',
  }),emptySemanticContext());
  assert.equal(recommendation.action,'recommend');
});

test('Human Brain 5.5: closed-facet normalization never rewrites transactional actions',()=>{
  const result=parseSemanticTurnResponse(JSON.stringify({
    domain:'stay',
    intent:'book_if_available',
    action:'book',
    informationNeed:'availability',
    entities:{date:'พรุ่งนี้'},
    references:[],
    constraints:[],
    confidence:0.9,
    needsClarification:false,
  }),emptySemanticContext());

  assert.equal(result.action,'book');
  assert.equal(result.informationNeed,'availability');
});
