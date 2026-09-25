import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSemanticInterpreterPrompt,
  emptySemanticContext,
} from '../netlify/functions/_semantic-interpreter';
import { PHASE_L_SEMANTIC_CASES } from './fixtures/phase-l-semantic-cases';
import { SEMANTIC_EVAL_CORPUS } from './fixtures/semantic-eval-corpus';

function byId(id:string){
  const item=[...SEMANTIC_EVAL_CORPUS,...PHASE_L_SEMANTIC_CASES].find(row=>row.id===id);
  assert.ok(item,`missing fixture ${id}`);
  return item;
}

test('Phase 5.8 RED: cross-cutting promotion questions stay in promotion even when they name restaurant/activity/stay',()=>{
  const prompt=buildSemanticInterpreterPrompt(emptySemanticContext());
  assert.match(prompt,/promotion[sS]{0,420}cross-cutting/i);
  assert.match(prompt,/promotion[sS]{0,420}(?:restaurant|activity|stay)[sS]{0,420}domain "promotion"/i);
});

test('Phase 5.8 RED: journey means itinerary/sequence composition, ecosystem means broad browse without plan composition',()=>{
  const prompt=buildSemanticInterpreterPrompt(emptySemanticContext());
  assert.match(prompt,/journey[sS]{0,500}(?:plan|itinerary|sequence|trip)/i);
  assert.match(prompt,/ecosystem[sS]{0,500}(?:browse|discovery)[sS]{0,500}journey/i);
});

test('Phase 5.8 RED: physical product stock uses inventory, not generic availability',()=>{
  const prompt=buildSemanticInterpreterPrompt(emptySemanticContext());
  assert.match(prompt,/inventory[sS]{0,360}(?:physical|product|stock)/i);
  assert.match(prompt,/(?:room|table|time|resource)[sS]{0,360}availability/i);
});

test('Phase 5.8 RED: membership signup and permission-to-change are not booking/modify overreads',()=>{
  const prompt=buildSemanticInterpreterPrompt(emptySemanticContext());
  assert.match(prompt,/membership[sS]{0,420}signup[sS]{0,420}confirm/i);
  assert.match(prompt,/can[sS]{0,160}change[sS]{0,260}policy/i);
});

test('Phase 5.8 RED: remaining Phase-L gold is human-grounded',()=>{
  const expected:Record<string,{domain?:string;action?:string;need?:string;contextDomain?:string}> = {
    'l-stay-06':{domain:'stay',action:'modify'},
    'l-member-04':{domain:'membership',action:'ask',need:'policy'},
    'l-otop-03':{domain:'otop',action:'status',need:'inventory'},
    'l-cafe-03':{domain:'cafe',action:'discover',need:'catalog'},
    'l-cafe-04':{domain:'cafe',action:'ask'},
    'l-journey-04':{domain:'activity',action:'recommend',need:'recommendation'},
    'l-journey-06':{domain:'journey',action:'modify'},
    'l-topic-activity-01':{domain:'activity',action:'discover',contextDomain:'stay'},
    'l-promo-09':{domain:'promotion',action:'ask',need:'policy'},
  };
  for(const [id,e] of Object.entries(expected)){
    const item=byId(id);
    if(e.domain) assert.equal(item.expected.domain,e.domain,`${id} domain`);
    if(e.action) assert.equal(item.expected.action,e.action,`${id} action`);
    if(e.need) assert.equal(item.simulatedModelOutput.informationNeed,e.need,`${id} informationNeed`);
    if(e.contextDomain) assert.equal(item.context?.activeDomain,e.contextDomain,`${id} context`);
  }
});

test('Phase 5.8 RED: explicit journey planning fixtures keep journey domain while broad low-effort recommendation stays ecosystem',()=>{
  for(const id of ['l-journey-01','l-journey-02','l-journey-03','l-journey-08','l-journey-09','l-journey-10']){
    assert.equal(byId(id).expected.domain,'journey',id);
  }
  assert.equal(byId('l-activity-09').expected.domain,'ecosystem');
});
