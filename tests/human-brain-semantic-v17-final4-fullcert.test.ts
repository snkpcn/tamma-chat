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

test('semantic-v17 version is explicit',()=>{
  assert.equal(SEMANTIC_INTERPRETER_VERSION,'semantic-v17');
});

test('semantic-v17 keeps all four final full-corpus gold labels unchanged',()=>{
  assert.deepEqual(byId('l-promo-03').expected,{domain:'promotion',action:'discover',needsClarification:false});
  assert.deepEqual(byId('l-journey-04').expected,{domain:'activity',action:'recommend',needsClarification:false});
  assert.equal(byId('l-journey-04').simulatedModelOutput?.informationNeed,'recommendation');
  assert.deepEqual(byId('l-journey-09').expected,{domain:'journey',action:'recommend',needsClarification:false});
  assert.deepEqual(byId('l-payment-07').expected,{domain:'payment',action:'ask',needsClarification:false});
});

test('semantic-v17 promotion ownership outranks the promoted business category',()=>{
  const p=buildSemanticInterpreterPrompt(emptySemanticContext()).replace(/\s+/g,' ');
  assert.ok(p.includes('When the customer is asking for promotions, discounts, offers, or promotion applicability, promotion owns the domain even if a restaurant, stay, activity, cafe, or OTOP unit is named'));
  assert.ok(p.includes('Do not let canonical business-category ownership steal a promotion request'));
});

test('semantic-v17 distinguishes one explicit activity target from a generic multi-step flow',()=>{
  const p=buildSemanticInterpreterPrompt(emptySemanticContext()).replace(/\s+/g,' ');
  assert.ok(p.includes('If the customer explicitly asks for one activity as the target and another event is only a timing anchor, stay in activity'));
  assert.ok(p.includes('If the customer instead asks generically for something to do that should flow into another business experience, the requested deliverable is the sequence, so use journey'));
});

test('semantic-v17 payment remediation keeps payment domain rather than generic support',()=>{
  const p=buildSemanticInterpreterPrompt(emptySemanticContext()).replace(/\s+/g,' ');
  assert.ok(p.includes('A concrete payment artifact or payment failure keeps domain=payment when the customer asks what to do next'));
  assert.ok(p.includes('support is for generic help problems without a more specific owned business domain'));
});

test('semantic-v17 structurally makes recommend imply recommendation facet when model leaves it none',()=>{
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
