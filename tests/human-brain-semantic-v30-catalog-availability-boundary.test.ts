import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSemanticInterpreterPrompt,
  emptySemanticContext,
  SEMANTIC_INTERPRETER_VERSION,
} from '../netlify/functions/_semantic-interpreter';
import { PHASE_L_SEMANTIC_CASES } from './fixtures/phase-l-semantic-cases';

test('semantic-v30 keeps the remaining stay gold meaning unchanged', () => {
  const item = PHASE_L_SEMANTIC_CASES.find((row) => row.id === 'l-stay-03');
  assert.ok(item);
  assert.equal(item.expected.domain, 'stay');
  assert.equal(item.expected.action, 'discover');
  assert.equal(item.expected.informationNeed, 'catalog');
});

test('semantic-v30 terminal audit distinguishes configuration existence from live resource state', () => {
  const prompt = buildSemanticInterpreterPrompt(emptySemanticContext()).replace(/\s+/g, ' ');
  assert.ok(prompt.includes('an offering type, configuration, capacity class, or attribute exists in the catalog'));
  assert.ok(prompt.includes('no date, time, current-state, sold-out, free-slot, or booking-state predicate'));
  assert.ok(prompt.includes('status + availability only when the customer asks whether an actual unit or slot is free or usable'));
});

test('semantic-v30 version is explicit', () => {
  assert.equal(SEMANTIC_INTERPRETER_VERSION, 'semantic-v30');
});
