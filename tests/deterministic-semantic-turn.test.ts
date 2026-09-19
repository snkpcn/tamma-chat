import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveDeterministicSemanticTurn } from '../netlify/functions/_deterministic-semantic-turn';
import { emptySemanticContext, type SemanticContext, type SemanticContextEntity } from '../netlify/functions/_semantic-interpreter';
import { createActiveTask, emptyTaskStateContainer, type TaskStateContainer } from '../netlify/functions/_task-state';

const NOW = new Date('2026-09-19T05:00:00.000Z'); // Bangkok: 2026-09-19 12:00

function horseEntity(overrides: Partial<SemanticContextEntity> = {}): SemanticContextEntity {
  return { id: 'activity_asset:horse-01', type: 'activity_asset', name: 'ภาราดร', domain: 'activity', source: 'catalog', canonical: true, ...overrides };
}

test('no context, broad discovery phrasing derives ecosystem/discover with zero ambiguity', () => {
  const turn = deriveDeterministicSemanticTurn('มีไรทำมั่ง', emptySemanticContext(), emptyTaskStateContainer());
  assert.ok(turn);
  assert.equal(turn!.domain, 'ecosystem');
  assert.equal(turn!.action, 'discover');
  assert.equal(turn!.needsClarification, false);
});

test('a message naming a known activity narrows to the activity domain (discover, no task created)', () => {
  const turn = deriveDeterministicSemanticTurn('ม้าล่ะ', emptySemanticContext(), emptyTaskStateContainer());
  assert.ok(turn);
  assert.equal(turn!.domain, 'activity');
  assert.equal(turn!.action, 'discover');
});

test('selecting a recently-shown entity by name resolves deterministically, with no active task yet', () => {
  const context: SemanticContext = { activeDomain: 'activity', recentEntities: [horseEntity()] };
  const turn = deriveDeterministicSemanticTurn('เอาภาราดร', context, emptyTaskStateContainer());
  assert.ok(turn);
  assert.equal(turn!.action, 'confirm');
  assert.equal(turn!.domain, 'activity');
  assert.equal(turn!.references.length, 1);
  assert.equal(turn!.references[0]!.resolvedEntityId, 'activity_asset:horse-01');
  assert.equal(turn!.needsClarification, false);
});

test('a date + party size turn against an active task fills both slots deterministically', () => {
  const taskState: TaskStateContainer = {
    ...emptyTaskStateContainer(),
    activeTask: createActiveTask({
      type: 'activity_booking', sourceChannel: 'line', now: NOW,
      initialSlots: { resourceCode: 'activity_asset:horse-01' },
    }),
  };
  const turn = deriveDeterministicSemanticTurn('พรุ่งนี้สองคน', emptySemanticContext(), taskState);
  assert.ok(turn);
  assert.equal(turn!.action, 'provide_information');
  assert.equal(turn!.domain, 'activity');
  assert.equal(turn!.entities.date, '2026-09-20');
  assert.equal(turn!.entities.partySize, 2);
});

test('a bare time turn against an active task fills only the time slot', () => {
  const taskState: TaskStateContainer = {
    ...emptyTaskStateContainer(),
    activeTask: createActiveTask({ type: 'activity_booking', sourceChannel: 'line', now: NOW }),
  };
  const turn = deriveDeterministicSemanticTurn('บ่ายสามได้ปะ', emptySemanticContext(), taskState);
  assert.ok(turn);
  assert.equal(turn!.entities.time, '15:00');
  assert.equal(Object.keys(turn!.entities).length, 1);
});

test('an explicit correction against an active task is flagged correct_previous, not a fresh slot fill', () => {
  const taskState: TaskStateContainer = {
    ...emptyTaskStateContainer(),
    activeTask: createActiveTask({ type: 'activity_booking', sourceChannel: 'line', now: NOW, initialSlots: { partySize: 2 } }),
  };
  const turn = deriveDeterministicSemanticTurn('จริง ๆ สามคน', emptySemanticContext(), taskState);
  assert.ok(turn);
  assert.equal(turn!.action, 'correct_previous');
  assert.equal(turn!.entities.partySize, 3);
});

test('genuinely unclassifiable text with no active task and no context returns null (never guesses)', () => {
  const turn = deriveDeterministicSemanticTurn('อยากได้อะไรสักอย่างที่ทำให้ฉันมีความสุข', emptySemanticContext(), emptyTaskStateContainer());
  assert.equal(turn, null);
});

test('an active task with unparseable free text returns null rather than fabricating slot values', () => {
  const taskState: TaskStateContainer = {
    ...emptyTaskStateContainer(),
    activeTask: createActiveTask({ type: 'activity_booking', sourceChannel: 'line', now: NOW }),
  };
  const turn = deriveDeterministicSemanticTurn('ขอคิดดูก่อนนะ', emptySemanticContext(), taskState);
  assert.equal(turn, null);
});

test('empty/whitespace message never derives a turn', () => {
  assert.equal(deriveDeterministicSemanticTurn('   ', emptySemanticContext(), emptyTaskStateContainer()), null);
});

// A "จองเลย"-style explicit commit signal is never silently reduced to a
// mere slot update -- that would drop the customer's actual booking intent.
// It must defer (null) so the caller either asks the real model (if
// available) or asks one honest clarifying/confirming question -- never a
// fabricated commitment derived by a zero-LLM parser.
test('an explicit commit marker ("จองเลย") on an active task defers instead of reducing to a bare slot update', () => {
  const taskState: TaskStateContainer = {
    ...emptyTaskStateContainer(),
    activeTask: createActiveTask({ type: 'activity_booking', sourceChannel: 'line', now: NOW }),
  };
  const turn = deriveDeterministicSemanticTurn('จองเลย บ่ายสาม', emptySemanticContext(), taskState);
  assert.equal(turn, null);
});
