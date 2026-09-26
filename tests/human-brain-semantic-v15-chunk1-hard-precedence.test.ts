import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSemanticInterpreterPrompt,
  emptySemanticContext,
  SEMANTIC_INTERPRETER_VERSION,
} from '../netlify/functions/_semantic-interpreter';
import { SEMANTIC_EVAL_CORPUS } from './fixtures/semantic-eval-corpus';

function byId(id:string){
  const item=SEMANTIC_EVAL_CORPUS.find(row=>row.id===id);
  assert.ok(item,`missing fixture ${id}`);
  return item;
}

test('semantic-v26 version is explicit',()=>{
  assert.equal(SEMANTIC_INTERPRETER_VERSION,'semantic-v26');
});

test('semantic-v26 honestly adjudicates membership profile readback as ask',()=>{
  const item=byId('membership-02');
  assert.deepEqual(item.expected,{domain:'membership',action:'ask'});
  assert.equal(item.simulatedModelOutput?.action,'ask');
  assert.equal(item.simulatedModelOutput?.informationNeed,'none');
});

test('semantic-v26 final precedence protects how-it-works questions from catalog discovery',()=>{
  const normalized=buildSemanticInterpreterPrompt(emptySemanticContext()).replace(/\s+/g,' ');
  assert.ok(normalized.includes('FINAL SEMANTIC PRECEDENCE CHECK'));
  assert.ok(normalized.includes('How-it-works, instructions, rules, or explanation about one named activity are ask, not discover'));
});

test('semantic-v26 final precedence protects selected-option slot refinement from transaction escalation',()=>{
  const normalized=buildSemanticInterpreterPrompt(emptySemanticContext()).replace(/\s+/g,' ');
  assert.ok(normalized.includes('Selecting an already-presented option and adding only schedule, quantity, or party-size slots remains confirm'));
  assert.ok(normalized.includes('Do not escalate that turn to book/order unless the CURRENT utterance explicitly asks to submit the transaction'));
});

test('semantic-v26 final precedence makes explicit canonical category ownership override venue framing',()=>{
  const normalized=buildSemanticInterpreterPrompt(emptySemanticContext()).replace(/\s+/g,' ');
  assert.ok(normalized.includes('An explicitly named canonical business category owns the domain even when phrased as what is available here'));
  assert.ok(normalized.includes('activity category means domain=activity; ecosystem is only for genuinely cross-business or category-unspecified discovery'));
});
