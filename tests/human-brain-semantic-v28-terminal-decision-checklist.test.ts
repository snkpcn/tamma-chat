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

test('semantic-v28 preserves the stable browse, evaluation, and commitment gold boundaries',()=>{
  assert.deepEqual(byId('discover-05').expected,{domain:'ecosystem',action:'recommend'});
  assert.deepEqual(byId('discover-06').expected,{domain:'ecosystem',action:'recommend'});
  assert.deepEqual(byId('discover-07').expected,{domain:'ecosystem',action:'discover'});
  assert.deepEqual(byId('otop-02').expected,{domain:'otop',action:'order'});
});

test('semantic-v28 places one terminal decision checklist immediately before the output contract',()=>{
  const p=buildSemanticInterpreterPrompt(emptySemanticContext());
  const terminal=p.lastIndexOf('MANDATORY TERMINAL DECISION CHECKLIST');
  assert.ok(terminal>p.lastIndexOf('FINAL SEMANTIC PRECEDENCE CHECK'));
  assert.ok(terminal<p.lastIndexOf('Return ONLY this JSON object'));
});

test('semantic-v28 terminal checklist locks cross-language evaluation and incomplete commitment',()=>{
  const p=buildSemanticInterpreterPrompt(emptySemanticContext()).replace(/\s+/g,' ');
  assert.ok(p.includes('a qualitative predicate attached directly to a broad action question still asks for judgment'));
  assert.ok(p.includes('An indefinite object or missing item name after an explicit order-placement commitment is a missing slot, not catalog intent'));
  assert.ok(p.includes('informationNeed must mirror the action already chosen and must never reverse it'));
});

test('semantic-v28 version is explicit',()=>{
  assert.equal(SEMANTIC_INTERPRETER_VERSION, 'semantic-v30');
});
