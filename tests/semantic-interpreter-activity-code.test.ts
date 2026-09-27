// Human Core PR C: the semantic interpreter's canonicalizeEntityAliases now
// recognizes activityCode (and common alias spellings/casing the model or
// an older prompt path might use) so a real model reply naming an activity
// TYPE (not a specific named asset) produces the SAME closed
// entities.activityCode field the deterministic layer already produces --
// letting deriveSemanticMeaning (see _semantic-meaning.ts) derive a real
// focusKind:'entity_type' instead of collapsing every activity discovery
// turn into the same undifferentiated scope.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSemanticTurnResponse, emptySemanticContext } from '../netlify/functions/_semantic-interpreter';
import { deriveSemanticMeaning } from '../netlify/functions/_semantic-meaning';

function modelReply(entities: Record<string, unknown>): string {
  return JSON.stringify({
    domain: 'activity', intent: 'activity_type_discovery', action: 'discover', informationNeed: 'catalog',
    entities, references: [], constraints: [], confidence: 0.95, needsClarification: false,
  });
}

test('a direct entities.activityCode from the model passes through and normalizes case', () => {
  const turn = parseSemanticTurnResponse(modelReply({ activityCode: 'HORSE' }), emptySemanticContext());
  assert.equal(turn.entities.activityCode, 'horse');
});

test('alias spellings (activity_type, activity_code) are canonicalized to activityCode', () => {
  for (const key of ['activity_type', 'activity_code']) {
    const turn = parseSemanticTurnResponse(modelReply({ [key]: 'atv' }), emptySemanticContext());
    assert.equal(turn.entities.activityCode, 'atv', key);
  }
});

test('end-to-end: a model activityCode reply yields a real entity_type focus, not a collapsed domain-wide guess', () => {
  const turn = parseSemanticTurnResponse(modelReply({ activityCode: 'archery' }), emptySemanticContext());
  const meaning = deriveSemanticMeaning(turn);
  assert.equal(meaning.focusKind, 'entity_type');
  assert.equal(meaning.focusValue, 'archery');
  assert.equal(meaning.scopeBreadth, 'focused');
});

test('no activityCode stated: a genuine whole-domain browse still derives domain-wide, unaffected', () => {
  const turn = parseSemanticTurnResponse(modelReply({}), emptySemanticContext());
  assert.equal(turn.entities.activityCode, undefined);
  const meaning = deriveSemanticMeaning(turn);
  assert.equal(meaning.focusKind, 'domain');
  assert.equal(meaning.scopeBreadth, 'domain_wide');
});
