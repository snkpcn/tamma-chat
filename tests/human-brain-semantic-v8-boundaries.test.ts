import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSemanticInterpreterPrompt,
  emptySemanticContext,
  SEMANTIC_INTERPRETER_VERSION,
} from '../netlify/functions/_semantic-interpreter';
import { SEMANTIC_EVAL_CORPUS } from './fixtures/semantic-eval-corpus';
import { PHASE_L_SEMANTIC_CASES } from './fixtures/phase-l-semantic-cases';

function byId(id:string){
  const item=[...SEMANTIC_EVAL_CORPUS,...PHASE_L_SEMANTIC_CASES].find(row=>row.id===id);
  assert.ok(item,`missing fixture ${id}`);
  return item;
}

test('semantic-v8 version is explicit',()=>{
  assert.equal(SEMANTIC_INTERPRETER_VERSION,'semantic-v8');
});

test('semantic-v8 doctrine separates recommendation from availability/status after supplied preferences',()=>{
  const prompt=buildSemanticInterpreterPrompt(emptySemanticContext());
  assert.ok(prompt.includes('Recommendation intent outranks incidental availability framing'));
  assert.ok(prompt.includes('party size, nights, budget, dietary needs, pace, or preferences'));
});

test('semantic-v8 doctrine treats ready-to-sell/menu readiness as current availability rather than catalog existence',()=>{
  const prompt=buildSemanticInterpreterPrompt(emptySemanticContext());
  assert.ok(prompt.includes('ready to sell, ready now, available now, sold out, or currently serving'));
  assert.ok(prompt.includes('status + availability'));
});

test('semantic-v8 doctrine treats allergen avoidance as recommendation grounded in ingredients',()=>{
  const prompt=buildSemanticInterpreterPrompt(emptySemanticContext());
  assert.ok(prompt.includes('allergen or dietary-safety avoidance'));
  assert.ok(prompt.includes('recommend + ingredients'));
});

test('semantic-v8 doctrine keeps a requested activity recommendation in activity even when meal sequencing is mentioned',()=>{
  const prompt=buildSemanticInterpreterPrompt(emptySemanticContext());
  assert.ok(prompt.includes('If the customer asks for one activity to fit before/after another experience'));
  assert.ok(prompt.includes('keep domain activity'));
});

test('semantic-v8 doctrine treats conversational continuation as ask/resume rather than generating another recommendation',()=>{
  const prompt=buildSemanticInterpreterPrompt(emptySemanticContext());
  assert.ok(prompt.includes('continue from before / carry on from the previous plan'));
  assert.ok(prompt.includes('action=ask'));
});

test('semantic-v8 doctrine forces vague support to clarify',()=>{
  const prompt=buildSemanticInterpreterPrompt(emptySemanticContext());
  assert.ok(prompt.includes('Generic confusion/help with no concrete object must set needsClarification=true'));
});

test('semantic-v8 doctrine keeps eligibility/can-I-use-this questions informational policy checks',()=>{
  const prompt=buildSemanticInterpreterPrompt(emptySemanticContext());
  assert.ok(prompt.includes('Eligibility/applicability questions about whether a promotion can be used'));
  assert.ok(prompt.includes('ask + policy'));
});

test('semantic-v8 doctrine treats failed/rejected payment next-step questions as remediation guidance, not transaction status',()=>{
  const prompt=buildSemanticInterpreterPrompt(emptySemanticContext());
  assert.ok(prompt.includes('failed/rejected payment artifact and asks what to do next'));
  assert.ok(prompt.includes('ask, not status'));
});

test('semantic-v8 gold adjudication preserves the eight human-grounded boundaries',()=>{
  const checks:Record<string,{domain:string;action:string;need?:string;clarify?:boolean}> = {
    'stay-availability-02':{domain:'stay',action:'recommend',need:'recommendation',clarify:false},
    'l-restaurant-01':{domain:'restaurant',action:'status',need:'availability',clarify:false},
    'l-restaurant-04':{domain:'restaurant',action:'recommend',need:'ingredients',clarify:false},
    'l-journey-04':{domain:'activity',action:'recommend',need:'recommendation',clarify:false},
    'l-journey-07':{domain:'journey',action:'ask',clarify:false},
    'l-support-01':{domain:'support',action:'ask',clarify:true},
    'l-promo-10':{domain:'promotion',action:'ask',clarify:false},
    'l-payment-07':{domain:'payment',action:'ask',clarify:false},
  };
  for(const [id,e] of Object.entries(checks)){
    const item=byId(id);
    assert.equal(item.expected.domain,e.domain,`${id} domain`);
    assert.equal(item.expected.action,e.action,`${id} action`);
    if(e.need) assert.equal(item.simulatedModelOutput.informationNeed,e.need,`${id} informationNeed`);
    if(e.clarify!==undefined) assert.equal(item.expected.needsClarification,e.clarify,`${id} needsClarification`);
  }
});
