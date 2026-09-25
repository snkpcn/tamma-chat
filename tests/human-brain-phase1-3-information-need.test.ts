import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSemanticTurnResponse,
  emptySemanticContext,
  type SemanticTurn,
} from '../netlify/functions/_semantic-interpreter';
import {
  planDialogTurn,
} from '../netlify/functions/_dialog-manager';
import {
  emptyConversationContextState,
} from '../netlify/functions/_conversation-context';
import {
  emptyTaskStateContainer,
} from '../netlify/functions/_task-state';

const NOW = new Date('2026-09-26T01:10:00.000Z');

function plan(turn: SemanticTurn) {
  return planDialogTurn({
    semanticTurn: turn,
    conversationContext: emptyConversationContextState(NOW),
    taskState: emptyTaskStateContainer(),
    channel: 'line',
    eventId: 'human-brain-phase1-3',
  }, NOW);
}

test('Human Brain Phase 1.3 RED: parser preserves closed informationNeed independently of free-form intent wording', () => {
  const turn = parseSemanticTurnResponse(JSON.stringify({
    domain: 'restaurant',
    intent: 'table_availability_check',
    action: 'status',
    informationNeed: 'availability',
    entities: { date: 'พรุ่งนี้', time: '18:00' },
    references: [],
    constraints: [],
    confidence: 0.97,
    needsClarification: false,
  }), emptySemanticContext());

  assert.equal(turn.intent, 'table_availability_check');
  assert.equal(turn.informationNeed, 'availability');
});

test('Human Brain Phase 1.3 RED: downstream routes by informationNeed, not an exact free-form intent label', () => {
  const labels = [
    'table_availability_check',
    'restaurant_table_availability',
    'is_there_a_table',
  ];

  for (const intent of labels) {
    const turn = {
      domain: 'restaurant',
      intent,
      action: 'status',
      informationNeed: 'availability',
      entities: { date: 'พรุ่งนี้', time: '18:00' },
      references: [],
      constraints: [],
      confidence: 0.96,
      needsClarification: false,
    } as SemanticTurn;

    const dialog = plan(turn);
    assert.equal(dialog.knowledgeRequests.length, 1, intent);
    assert.deepEqual(dialog.knowledgeRequests[0]?.needs, ['availability'], intent);
  }
});

test('Human Brain Phase 1.3 guard: old turns without informationNeed keep backward-compatible deterministic behavior', () => {
  const oldTurn: SemanticTurn = {
    domain: 'restaurant',
    intent: 'check_my_order',
    action: 'status',
    entities: {},
    references: [],
    constraints: [],
    confidence: 0.9,
    needsClarification: false,
  };

  const dialog = plan(oldTurn);
  assert.deepEqual(dialog.knowledgeRequests[0]?.needs, ['order_status']);
});

test('Human Brain Phase 1.3 guard: invalid informationNeed is rejected by parser, never trusted as routing input', () => {
  const turn = parseSemanticTurnResponse(JSON.stringify({
    domain: 'restaurant',
    intent: 'whatever',
    action: 'status',
    informationNeed: 'drop_database',
    entities: {},
    references: [],
    constraints: [],
    confidence: 0.9,
    needsClarification: false,
  }), emptySemanticContext());

  assert.equal(turn.informationNeed, undefined);
});
