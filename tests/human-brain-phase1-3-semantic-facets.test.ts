import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptySemanticContext,
  parseSemanticTurnResponse,
  type SemanticTurn,
} from '../netlify/functions/_semantic-interpreter';
import { planDialogTurn } from '../netlify/functions/_dialog-manager';
import { emptyConversationContextState } from '../netlify/functions/_conversation-context';
import { emptyTaskStateContainer } from '../netlify/functions/_task-state';

const NOW = new Date('2026-09-26T01:15:00.000Z');

test('Human Brain Phase 1.3 RED: parser preserves closed informationNeed independently from free-form intent wording', () => {
  const raw = JSON.stringify({
    domain: 'restaurant',
    intent: 'table_availability_check',
    action: 'status',
    informationNeed: 'availability',
    entities: { date:'พรุ่งนี้', time:'18:00' },
    references: [],
    constraints: [],
    confidence: 0.98,
    needsClarification: false,
  });

  const turn = parseSemanticTurnResponse(raw, emptySemanticContext());
  assert.equal(turn.informationNeed, 'availability');
});

test('Human Brain Phase 1.3 RED: downstream routing uses closed informationNeed, not an exact model-generated intent label', () => {
  const turn = {
    domain: 'restaurant',
    intent: 'table_availability_check',
    action: 'status',
    informationNeed: 'availability',
    entities: { date:'พรุ่งนี้', time:'18:00' },
    references: [],
    constraints: [],
    confidence: 0.98,
    needsClarification: false,
  } as SemanticTurn;

  const plan = planDialogTurn({
    semanticTurn: turn,
    conversationContext: emptyConversationContextState(NOW),
    taskState: emptyTaskStateContainer(),
    channel: 'line',
    eventId: 'phase1-3-availability',
  }, NOW);

  assert.deepEqual(plan.knowledgeRequests[0]?.needs, ['availability']);
  assert.equal(plan.knowledgeRequests[0]?.intent, 'table_availability_check');
});

test('Human Brain Phase 1.3 RED: unknown informationNeed values are rejected to none instead of becoming routing strings', () => {
  const raw = JSON.stringify({
    domain: 'restaurant',
    intent: 'whatever_the_model_calls_it',
    action: 'ask',
    informationNeed: 'totally_invented_need',
    entities: {},
    references: [],
    constraints: [],
    confidence: 0.9,
    needsClarification: false,
  });
  const turn = parseSemanticTurnResponse(raw, emptySemanticContext());
  assert.equal(turn.informationNeed, 'none');
});
