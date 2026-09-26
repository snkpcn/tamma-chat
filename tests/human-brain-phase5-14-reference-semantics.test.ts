import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSemanticInterpreterPrompt,
  emptySemanticContext,
  SEMANTIC_INTERPRETER_VERSION,
} from '../netlify/functions/_semantic-interpreter';

test('semantic-v7 locks short topic follow-up vs invented availability',()=>{
  const prompt=buildSemanticInterpreterPrompt(emptySemanticContext());
  assert.equal(SEMANTIC_INTERPRETER_VERSION,'semantic-v8');
  assert.ok(prompt.includes('bare topic/resource follow-up does NOT imply current'));
  assert.ok(prompt.includes('do not invent status + availability'));
});

test('semantic-v7 locks exact named selection among multiple recent candidates',()=>{
  const prompt=buildSemanticInterpreterPrompt(emptySemanticContext());
  assert.ok(prompt.includes('explicitly NAMES one exact recent entity'));
  assert.ok(prompt.includes('that is confirm'));
  assert.ok(prompt.includes('reference value'));
});

test('semantic-v7 distinguishes candidate-slot question from slot supply',()=>{
  const prompt=buildSemanticInterpreterPrompt(emptySemanticContext());
  assert.ok(prompt.includes('candidate slot value phrased as a QUESTION'));
  assert.ok(prompt.includes('status + availability'));
  assert.ok(prompt.includes('It is NOT provide_information'));
});

test('semantic-v7 explicit attribute comparison outranks recommendation',()=>{
  const prompt=buildSemanticInterpreterPrompt(emptySemanticContext());
  assert.ok(prompt.includes('Explicit attribute comparison outranks recommendation'));
  assert.ok(prompt.includes('use compare'));
  assert.ok(prompt.includes('Use recommend when they ask what they SHOULD choose'));
});
