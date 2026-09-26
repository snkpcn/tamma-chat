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

test('semantic-v17 honestly adjudicates l-journey-09 as one activity with a meal timing anchor',()=>{
  const item=byId('l-journey-09');
  assert.equal(item.expected.domain,'activity');
  assert.equal(item.expected.action,'recommend');
});

test('semantic-v17 keeps promotion ownership when a promotion is scoped to one business unit',()=>{
  const normalized=buildSemanticInterpreterPrompt(emptySemanticContext()).replace(/\s+/g,' ');
  assert.ok(normalized.includes('A promotion, discount, offer, or benefit remains domain=promotion when that is the PRIMARY thing being requested'));
  assert.ok(normalized.includes('Scoping that promotion to activity, restaurant, stay, cafe, or OTOP does not transfer domain ownership to the scoped business'));
});

test('semantic-v17 keeps payment remediation in payment rather than generic support',()=>{
  const normalized=buildSemanticInterpreterPrompt(emptySemanticContext()).replace(/\s+/g,' ');
  assert.ok(normalized.includes('A failed, rejected, or invalid payment artifact remains domain=payment when the customer asks what to do next'));
  assert.ok(normalized.includes('Use support only when the primary request is generic assistance rather than payment remediation'));
});

test('semantic-v17 structurally pairs recommend with recommendation informationNeed when the model omits the facet',()=>{
  const turn=parseSemanticTurnResponse(JSON.stringify({
    domain:'activity',
    intent:'recommend_light_activity',
    action:'recommend',
    informationNeed:'none',
    entities:{},
    references:[],
    constraints:['low_effort'],
    confidence:0.95,
    needsClarification:false,
  }),emptySemanticContext());
  assert.equal(turn.action,'recommend');
  assert.equal(turn.informationNeed,'recommendation');
});
