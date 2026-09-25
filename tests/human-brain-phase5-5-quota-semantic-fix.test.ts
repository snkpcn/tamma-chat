import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSemanticInterpreterPrompt,
  emptySemanticContext,
  type SemanticTurn,
} from '../netlify/functions/_semantic-interpreter';
import { runSemanticCertification } from '../netlify/functions/_semantic-live-certification';
import { SEMANTIC_EVAL_CORPUS } from './fixtures/semantic-eval-corpus';

function semanticTurn(): SemanticTurn {
  return {
    domain:'ecosystem',
    intent:'broad_experience_discovery',
    action:'discover',
    informationNeed:'catalog',
    entities:{},
    references:[],
    constraints:[],
    confidence:1,
    needsClarification:false,
  };
}

test('Phase 5.5 RED: live certification supports inter-case pacing instead of bursting provider quota', async () => {
  const calledAt:number[]=[];
  await runSemanticCertification({
    profile:'full',
    start:0,
    limit:3,
    availabilityRetries:0,
    interCaseDelayMs:25,
    interpret:async () => {
      calledAt.push(Date.now());
      return semanticTurn();
    },
  });

  assert.equal(calledAt.length,3);
  assert.ok(calledAt[1]! - calledAt[0]! >= 20, 'case 2 must be paced after case 1');
  assert.ok(calledAt[2]! - calledAt[1]! >= 20, 'case 3 must be paced after case 2');
});

test('Phase 5.5 RED: semantic prompt defines broad ecosystem discovery as cross-business meaning, not activity-by-default', () => {
  const prompt=buildSemanticInterpreterPrompt(emptySemanticContext());
  assert.match(
    prompt,
    /broad(?:ly)?[^\n]{0,180}(?:what|things)[^\n]{0,180}do[^\n]{0,180}ecosystem/is,
  );
  assert.match(
    prompt,
    /activity[^\n]{0,220}(?:specific|explicit|anchor)/is,
  );
});

test('Phase 5.5 RED: ambiguous or catalog-shaped gold cases are adjudicated semantically, not kept as stale labels', () => {
  const restaurant=SEMANTIC_EVAL_CORPUS.find(item=>item.id==='restaurant-02');
  assert.ok(restaurant);
  assert.equal(restaurant.expected.action,'discover');
  assert.equal(restaurant.simulatedModelOutput.informationNeed,'catalog');

  const stay=SEMANTIC_EVAL_CORPUS.find(item=>item.id==='stay-02');
  assert.ok(stay);
  assert.equal(stay.context?.activeDomain,'stay');
  assert.equal(stay.expected.action,'status');
  assert.equal(stay.simulatedModelOutput.informationNeed,'availability');
});
