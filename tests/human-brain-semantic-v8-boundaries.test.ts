import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSemanticInterpreterPrompt,
  emptySemanticContext,
  SEMANTIC_INTERPRETER_VERSION,
} from '../netlify/functions/_semantic-interpreter';
import { SEMANTIC_EVAL_CORPUS } from './fixtures/semantic-eval-corpus';
import { PHASE_L_SEMANTIC_CASES } from './fixtures/phase-l-semantic-cases';

test('semantic-v15 version is explicit so live certification cannot inherit semantic-v7 results',()=>{
  assert.equal(SEMANTIC_INTERPRETER_VERSION,'semantic-v15');
});

test('semantic-v15 doctrine locks the eight human-meaning boundaries from completed live v7 certification',()=>{
  const prompt=buildSemanticInterpreterPrompt(emptySemanticContext());
  const required=[
    'CURRENT request for help choosing outranks a prior status or availability turn',
    'ready to sell, serve, use, or provide now',
    'allergy or dietary safety constraint',
    'A time-order constraint by itself does not make the request a journey',
    'Pure continue/resume language does not repeat the previous action',
    'Even when support is the clear domain, a help request with no object or requested outcome still needs clarification',
    'Eligibility or applicability of a promotion, benefit, or permission is an ask + policy question',
    'what to do next after a failure, rejection, or error',
  ];
  for(const rule of required) assert.ok(prompt.includes(rule),rule);
});

test('semantic-v15 keeps the adjudicated live-v7 gold labels unchanged',()=>{
  const cases=[...SEMANTIC_EVAL_CORPUS,...PHASE_L_SEMANTIC_CASES];
  const expected:Record<string,{domain:string;action:string;needsClarification?:boolean;informationNeed?:string}>={
    'stay-availability-02':{domain:'stay',action:'recommend',informationNeed:'recommendation'},
    'l-restaurant-01':{domain:'restaurant',action:'status',needsClarification:false,informationNeed:'availability'},
    'l-restaurant-04':{domain:'restaurant',action:'recommend',needsClarification:false,informationNeed:'ingredients'},
    'l-journey-04':{domain:'activity',action:'recommend',needsClarification:false,informationNeed:'recommendation'},
    'l-journey-07':{domain:'journey',action:'ask',needsClarification:false},
    'l-support-01':{domain:'support',action:'ask',needsClarification:true},
    'l-promo-10':{domain:'promotion',action:'ask',needsClarification:false},
    'l-payment-07':{domain:'payment',action:'ask',needsClarification:false},
  };

  for(const [id,gold] of Object.entries(expected)){
    const item=cases.find(candidate=>candidate.id===id);
    assert.ok(item, `missing corpus case ${id}`);
    assert.equal(item.expected.domain,gold.domain,`${id} domain`);
    assert.equal(item.expected.action,gold.action,`${id} action`);
    if(gold.needsClarification!==undefined){
      assert.equal(item.expected.needsClarification,gold.needsClarification,`${id} clarification`);
    }
    if(gold.informationNeed!==undefined){
      assert.equal(item.simulatedModelOutput?.informationNeed,gold.informationNeed,`${id} informationNeed`);
    }
  }
});
