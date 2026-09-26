import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSemanticInterpreterPrompt,
  emptySemanticContext,
  parseSemanticTurnResponse,
  SEMANTIC_INTERPRETER_VERSION,
} from '../netlify/functions/_semantic-interpreter';
import { PHASE_L_SEMANTIC_CASES } from './fixtures/phase-l-semantic-cases';

function byId(id:string){
  const item=PHASE_L_SEMANTIC_CASES.find(row=>row.id===id);
  assert.ok(item,`missing fixture ${id}`);
  return item;
}

test('semantic-v22 version is explicit',()=>{
  assert.equal(SEMANTIC_INTERPRETER_VERSION,'semantic-v22');
});

test('semantic-v22 locks the final full-corpus boundaries with honest journey-09 adjudication',()=>{
  assert.deepEqual(byId('l-promo-03').expected,{domain:'promotion',action:'discover',needsClarification:false});
  assert.deepEqual(byId('l-journey-04').expected,{domain:'activity',action:'recommend',needsClarification:false});
  assert.equal(byId('l-journey-04').simulatedModelOutput?.informationNeed,'recommendation');
  assert.deepEqual(byId('l-journey-09').expected,{domain:'activity',action:'recommend',needsClarification:false});
  assert.equal(byId('l-journey-09').simulatedModelOutput?.informationNeed,'recommendation');
  assert.deepEqual(byId('l-payment-07').expected,{domain:'payment',action:'ask',needsClarification:false});
});

test('semantic-v22 promotion ownership outranks the promoted business category',()=>{
  const p=buildSemanticInterpreterPrompt(emptySemanticContext()).replace(/\s+/g,' ');
  assert.ok(p.includes('When the customer is asking for promotions, discounts, offers, or promotion applicability, promotion owns the domain even if a restaurant, stay, activity, cafe, or OTOP unit is named'));
  assert.ok(p.includes('Do not let canonical business-category ownership steal a promotion request'));
});

test('semantic-v22 distinguishes one primary activity from a requested multi-part journey',()=>{
  const p=buildSemanticInterpreterPrompt(emptySemanticContext()).replace(/\s+/g,' ');
  assert.ok(p.includes('If the customer wants one primary activity that should fit before or after a meal, stay, or other event, keep activity even when phrased generically as something to do'));
  assert.ok(p.includes('Use journey only when the multi-part sequence itself is the requested deliverable'));
});

test('semantic-v22 payment remediation keeps payment domain rather than generic support',()=>{
  const p=buildSemanticInterpreterPrompt(emptySemanticContext()).replace(/\s+/g,' ');
  assert.ok(p.includes('A concrete payment artifact or payment failure keeps domain=payment when the customer asks what to do next'));
  assert.ok(p.includes('support is for generic help problems without a more specific owned business domain'));
});

test('semantic-v22 structurally makes recommend imply recommendation facet when model leaves it none',()=>{
  const turn=parseSemanticTurnResponse(JSON.stringify({
    domain:'activity',
    intent:'recommend_light_activity',
    action:'recommend',
    informationNeed:'none',
    entities:{},
    references:[],
    constraints:[],
    confidence:0.9,
    needsClarification:false,
  }),emptySemanticContext());
  assert.equal(turn.action,'recommend');
  assert.equal(turn.informationNeed,'recommendation');
});
