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

test('semantic-v24 preserves the remaining v23 live-failure gold meanings',()=>{
  assert.deepEqual(byId('discover-04').expected,{domain:'ecosystem',action:'discover'});
  assert.deepEqual(byId('discover-07').expected,{domain:'ecosystem',action:'discover'});
});

test('semantic-v24 keeps generic action verbs inside broad ecosystem scope',()=>{
  const p=buildSemanticInterpreterPrompt(emptySemanticContext()).replace(/\s+/g,' ');
  assert.ok(p.includes('Generic experience verbs alone do not narrow ecosystem scope to activity'));
  assert.ok(p.includes('Require an explicit activity category, named activity offering, or clearly activity-bounded subject before using domain=activity'));
});

test('semantic-v24 treats companion context as constraints, not recommendation intent',()=>{
  const p=buildSemanticInterpreterPrompt(emptySemanticContext()).replace(/\s+/g,' ');
  assert.ok(p.includes('Companion or group context by itself is a constraint, not recommendation intent'));
  assert.ok(p.includes('A neutral what-is-there-to-do request remains ecosystem + discover when companion context is merely supplied'));
  assert.ok(p.includes('Move to recommend only when the CURRENT utterance asks what is good, suitable, advisable, preferable, recommended, or asks the assistant to choose'));
});

test('semantic-v24 version is explicit',()=>{
  assert.equal(SEMANTIC_INTERPRETER_VERSION,'semantic-v24');
});
