import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptySemanticContext,
  parseSemanticTurnResponse,
} from '../netlify/functions/_semantic-interpreter';
import { deriveDeterministicSemanticTurn } from '../netlify/functions/_deterministic-semantic-turn';
import { createActiveTask, emptyTaskStateContainer } from '../netlify/functions/_task-state';

const activeStayContext = {
  ...emptySemanticContext(),
  activeDomain: 'stay' as const,
  activeTask: {
    type: 'stay_booking',
    domain: 'stay' as const,
    status: 'collecting',
    knownSlots: {
      resourceCode: 'stay-varee',
      date: '2026-10-02',
      partySize: 2,
    },
    missingFields: ['endDate'],
    selectedEntities: [],
    constraints: [],
  },
};

function supervisorOutput(entities: Record<string, unknown> = {}): string {
  return JSON.stringify({
    normalizedMeaning: 'customer supplies checkout date',
    reply: '',
    speechAct: 'statement',
    domain: 'stay',
    intent: 'provide_stay_checkout',
    action: 'provide_information',
    informationNeed: 'none',
    entities,
    references: [],
    constraints: [],
    confidence: 0.96,
    needsClarification: false,
  });
}

test('explicit Thai checkout date fills endDate when supervisor omits the slot', () => {
  const turn = parseSemanticTurnResponse(
    supervisorOutput(),
    activeStayContext,
    'เช็กเอาต์วันที่ 3 ตุลาคม 2569 ครับ',
  );
  assert.equal(turn.entities.endDate, '2026-10-03');
});

test('checkout recovery never overwrites a structured supervisor endDate', () => {
  const turn = parseSemanticTurnResponse(
    supervisorOutput({ endDate: '2026-10-04' }),
    activeStayContext,
    'เช็กเอาต์วันที่ 3 ตุลาคม 2569 ครับ',
  );
  assert.equal(turn.entities.endDate, '2026-10-04');
});

test('a checkout date without an active Stay task cannot manufacture task state', () => {
  const turn = parseSemanticTurnResponse(
    supervisorOutput(),
    emptySemanticContext(),
    'เช็กเอาต์วันที่ 3 ตุลาคม 2569 ครับ',
  );
  assert.equal(turn.entities.endDate, undefined);
});

test('provider fallback maps an explicitly labelled Stay checkout to endDate, never check-in date', () => {
  const now = new Date('2026-09-30T00:00:00Z');
  const activeTask = createActiveTask({
    type: 'stay_booking',
    sourceChannel: 'line',
    now,
    initialSlots: {
      resourceCode: 'stay-varee',
      date: '2026-10-02',
      partySize: 2,
    },
  });
  const taskState = { ...emptyTaskStateContainer(), activeTask };
  const turn = deriveDeterministicSemanticTurn(
    'เช็กเอาต์วันที่ 3 ตุลาคม 2569 ครับ',
    activeStayContext,
    taskState,
    now,
  );
  assert.equal(turn?.entities.endDate, '2026-10-03');
  assert.equal(turn?.entities.date, undefined);
});
