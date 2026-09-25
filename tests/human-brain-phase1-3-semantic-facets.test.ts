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

function plan(turn: SemanticTurn) {
  return planDialogTurn({
    semanticTurn: turn,
    conversationContext: emptyConversationContextState(NOW),
    taskState: emptyTaskStateContainer(),
    channel: 'line',
    eventId: 'phase1-3-information-facet',
  }, NOW);
}

test('Human Brain Phase 1.3: parser preserves closed informationNeed independently from free-form intent wording', () => {
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
  assert.equal(turn.intent, 'table_availability_check');
  assert.equal(turn.informationNeed, 'availability');
});

test('Human Brain Phase 1.3: equivalent free-form intent labels route identically through closed informationNeed', () => {
  for (const intent of [
    'table_availability_check',
    'restaurant_table_availability',
    'is_there_a_table',
  ]) {
    const turn: SemanticTurn = {
      domain: 'restaurant',
      intent,
      action: 'status',
      informationNeed: 'availability',
      entities: { date:'พรุ่งนี้', time:'18:00' },
      references: [],
      constraints: [],
      confidence: 0.98,
      needsClarification: false,
    };

    const dialog = plan(turn);
    assert.deepEqual(dialog.knowledgeRequests[0]?.needs, ['availability'], intent);
    assert.equal(dialog.knowledgeRequests[0]?.intent, intent);
  }
});

test('Human Brain Phase 1.3: unknown informationNeed values are normalized to none, never arbitrary routing strings', () => {
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

test('Human Brain Phase 1.3 compatibility: mature turns without informationNeed keep old order-status behavior', () => {
  const turn: SemanticTurn = {
    domain: 'restaurant',
    intent: 'check_my_order',
    action: 'status',
    entities: {},
    references: [],
    constraints: [],
    confidence: 0.9,
    needsClarification: false,
  };
  assert.deepEqual(plan(turn).knowledgeRequests[0]?.needs, ['order_status']);
});
