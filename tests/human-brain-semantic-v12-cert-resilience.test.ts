import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSemanticInterpreterPrompt,
  emptySemanticContext,
  SEMANTIC_INTERPRETER_VERSION,
} from '../netlify/functions/_semantic-interpreter';
import { SEMANTIC_EVAL_CORPUS } from './fixtures/semantic-eval-corpus';

test('semantic-v12 version is explicit',()=>{
  assert.equal(SEMANTIC_INTERPRETER_VERSION,'semantic-v12');
});

test('semantic-v12 makes single-business catalog ownership explicit even with venue-wide wording',()=>{
  const prompt=buildSemanticInterpreterPrompt(emptySemanticContext());
  assert.ok(prompt.includes('A catalog question about one named business category belongs to that category'));
  assert.ok(prompt.includes('Venue-wide wording such as here, this place, or what do you have here does not broaden it to ecosystem'));
  assert.ok(prompt.includes('Use ecosystem only when the requested set genuinely spans multiple business units'));
});

test('semantic-v12 keeps informational activity catalog gold unchanged',()=>{
  const item=SEMANTIC_EVAL_CORPUS.find(candidate=>candidate.id==='informational-02');
  assert.ok(item);
  assert.equal(item.expected.domain,'activity');
  assert.equal(item.expected.action,'discover');
  assert.equal(item.simulatedModelOutput?.informationNeed,'catalog');
});
