import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSemanticInterpreterPrompt,
  emptySemanticContext,
  SEMANTIC_INTERPRETER_VERSION,
} from '../netlify/functions/_semantic-interpreter';
import { SEMANTIC_EVAL_CORPUS } from './fixtures/semantic-eval-corpus';
import { PHASE_L_SEMANTIC_CASES } from './fixtures/phase-l-semantic-cases';

test('semantic-v12 version is explicit',()=>{
  assert.equal(SEMANTIC_INTERPRETER_VERSION,'semantic-v12');
});

test('semantic-v12 doctrine locks the remaining live human-meaning boundaries',()=>{
  const prompt=buildSemanticInterpreterPrompt(emptySemanticContext());
  const required=[
    'asking whether a change is allowed is ask + policy even when phrased with a polite change verb',
    'help me investigate/check this problem',
    'dissatisfaction plus a requested new preference is modify, not correct_previous',
    'asks what activities the venue offers as a category',
    'ready to sell now is availability unless the customer asks about stock/on-hand inventory',
    'asks which concrete menu/items to avoid because of an allergy',
    'one requested activity with a meal only as a timing anchor stays activity',
    'asks what to do next after a failed payment artifact',
    'which product is suitable as a gift is recommend, not catalog discovery',
  ];
  for(const rule of required) assert.ok(prompt.includes(rule),rule);
});

test('semantic-v12 keeps seven model-wrong golds unchanged and honestly adjudicates two ambiguous golds',()=>{
  const cases=[...SEMANTIC_EVAL_CORPUS,...PHASE_L_SEMANTIC_CASES];
  const expected:Record<string,{domain:string;action:string;informationNeed?:string}>={
    'modify-01':{domain:'activity',action:'ask',informationNeed:'policy'},
    'correction-02':{domain:'restaurant',action:'modify'},
    'l-restaurant-01':{domain:'restaurant',action:'status',informationNeed:'availability'},
    'l-restaurant-04':{domain:'restaurant',action:'recommend',informationNeed:'ingredients'},
    'l-journey-04':{domain:'activity',action:'recommend',informationNeed:'recommendation'},
    'l-payment-07':{domain:'payment',action:'ask'},
    'l-otop-07':{domain:'otop',action:'recommend'},
    'support-02':{domain:'support',action:'ask'},
    'informational-02':{domain:'activity',action:'discover',informationNeed:'catalog'},
  };

  for(const [id,gold] of Object.entries(expected)){
    const item=cases.find(candidate=>candidate.id===id);
    assert.ok(item,`missing corpus case ${id}`);
    assert.equal(item.expected.domain,gold.domain,`${id} domain`);
    assert.equal(item.expected.action,gold.action,`${id} action`);
    if(gold.informationNeed!==undefined){
      assert.equal(item.simulatedModelOutput?.informationNeed,gold.informationNeed,`${id} informationNeed`);
    }
  }
});
