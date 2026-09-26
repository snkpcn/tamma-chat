import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSemanticInterpreterPrompt,
  emptySemanticContext,
  SEMANTIC_INTERPRETER_VERSION,
} from '../netlify/functions/_semantic-interpreter';
import { SEMANTIC_EVAL_CORPUS } from './fixtures/semantic-eval-corpus';

function byId(id: string) {
  const item = SEMANTIC_EVAL_CORPUS.find((row) => row.id === id);
  assert.ok(item, `missing fixture ${id}`);
  return item;
}

test('semantic-v29 keeps the five live-failure gold decisions unchanged', () => {
  assert.deepEqual(byId('discover-05').expected, { domain: 'ecosystem', action: 'recommend' });
  assert.deepEqual(byId('discover-06').expected, { domain: 'ecosystem', action: 'recommend' });
  assert.deepEqual(byId('multi-intent-01').expected, { domain: 'restaurant', action: 'discover' });
  assert.deepEqual(byId('correction-03').expected, { domain: 'activity', action: 'correct_previous' });
  assert.deepEqual(byId('informational-02').expected, { domain: 'activity', action: 'discover' });
});

test('semantic-v29 terminal audit distinguishes requested judgment from neutral browse', () => {
  const prompt = buildSemanticInterpreterPrompt(emptySemanticContext()).replace(/\s+/g, ' ');
  assert.ok(prompt.includes('the unknown answer itself is qualified as desirable, worthwhile, appealing, or good'));
  assert.ok(prompt.includes('sentence-final evaluative wording modifies the requested choice'));
});

test('semantic-v29 terminal audit preserves primary domain and explicit category ownership', () => {
  const prompt = buildSemanticInterpreterPrompt(emptySemanticContext()).replace(/\s+/g, ' ');
  assert.ok(prompt.includes('A secondary coordinated request does not widen a specific primary domain to ecosystem'));
  assert.ok(prompt.includes('an explicit canonical category noun owns its category domain even inside a general location frame'));
});

test('semantic-v29 terminal audit separates repair from intentional change', () => {
  const prompt = buildSemanticInterpreterPrompt(emptySemanticContext()).replace(/\s+/g, ' ');
  assert.ok(prompt.includes('rejects an earlier value as wrong and supplies its replacement'));
  assert.ok(prompt.includes('correct_previous, not modify'));
});

test('semantic-v29 version is explicit', () => {
  assert.equal(SEMANTIC_INTERPRETER_VERSION, 'semantic-v29');
});
