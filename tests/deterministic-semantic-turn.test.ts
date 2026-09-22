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

test('production broad-discovery variants derive ecosystem/discover without a model', () => {
  for (const message of ['แถวนี้ทำไรดี', 'พาแฟนมา มีไรแนะนำ', 'มาครั้งแรกแนะนำหน่อย']) {
    const turn = deriveDeterministicSemanticTurn(message, emptySemanticContext(), emptyTaskStateContainer());
    assert.ok(turn, message);
    assert.equal(turn!.domain, 'ecosystem', message);
    assert.equal(turn!.action, 'discover', message);
  }
});

test('a message naming a known activity narrows to the activity domain (discover, no task created)', () => {
  const turn = deriveDeterministicSemanticTurn('ม้าล่ะ', emptySemanticContext(), emptyTaskStateContainer());
  assert.ok(turn);
  assert.equal(turn!.domain, 'activity');
  assert.equal(turn!.action, 'discover');
});

test('production read-only business domains derive deterministically instead of falling to provider outage', () => {
  const cases = [
    ['มีห้องพรุ่งนี้ไหม', 'stay', 'ask'],
    ['เช็คอินกี่โมง', 'stay', 'ask'],
    ['มี room service ไหม', 'stay', 'ask'],
    ['มีของฝากอะไรบ้าง', 'otop', 'discover'],
    ['มีลาเต้ไหม', 'cafe', 'ask'],
    ['สมัครสมาชิกยังไง', 'membership', 'ask'],
    ['เช็คสถานะสมาชิกได้ไหม', 'membership', 'status'],
  ] as const;

  for (const [message, domain, action] of cases) {
    const turn = deriveDeterministicSemanticTurn(message, emptySemanticContext(), emptyTaskStateContainer());
    assert.ok(turn, message);
    assert.equal(turn!.domain, domain, message);
    assert.equal(turn!.action, action, message);
    assert.equal(turn!.needsClarification, false, message);
  }
});

test('short follow-ups reuse the active read-only domain when structurally clear', () => {
  const otopContext: SemanticContext = { activeDomain: 'otop', recentEntities: [] };
  const otop = deriveDeterministicSemanticTurn('อันไหนดี', otopContext, emptyTaskStateContainer());
  assert.ok(otop);
  assert.equal(otop!.domain, 'otop');
  assert.equal(otop!.action, 'recommend');

  const cafeContext: SemanticContext = { activeDomain: 'cafe', recentEntities: [] };
  const cafe = deriveDeterministicSemanticTurn('ราคาเท่าไร', cafeContext, emptyTaskStateContainer());
  assert.ok(cafe);
  assert.equal(cafe!.domain, 'cafe');
  assert.equal(cafe!.action, 'ask');
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

test('owner-verified horse names still select the activity resource during provider outage even if recentEntities were not persisted', () => {
  const context: SemanticContext = { activeDomain: 'activity', recentEntities: [] };
  const turn = deriveDeterministicSemanticTurn('เอาภาราดร', context, emptyTaskStateContainer());
  assert.ok(turn);
  assert.equal(turn!.domain, 'activity');
  assert.equal(turn!.action, 'confirm');
  assert.equal(turn!.entities.resourceCode, 'activity-horse');
  assert.equal(turn!.entities.horseName, 'ภาราดร');
});

test('owner-verified horse name plus booking slots in one sentence stays deterministic', () => {
  const context: SemanticContext = { activeDomain: 'activity', recentEntities: [] };
  const turn = deriveDeterministicSemanticTurn(
    'ขี่ม้า 30 นาที เอาภาราดร วันที่ 2026-09-25 เวลา 10:00 จำนวน 1 คน ยืนยันการจอง',
    context,
    emptyTaskStateContainer(),
    NOW,
  );
  assert.ok(turn);
  assert.equal(turn!.domain, 'activity');
  assert.equal(turn!.action, 'book');
  assert.equal(turn!.entities.resourceCode, 'activity-horse');
  assert.equal(turn!.entities.horseName, 'ภาราดร');
  assert.equal(turn!.entities.durationMinutes, 30);
  assert.equal(turn!.entities.date, '2026-09-25');
  assert.equal(turn!.entities.time, '10:00');
  assert.equal(turn!.entities.partySize, 1);
});

test('a bare booking confirmation against an active activity task derives commit deterministically', () => {
  const taskState: TaskStateContainer = {
    ...emptyTaskStateContainer(),
    activeTask: createActiveTask({
      type: 'activity_booking', sourceChannel: 'web', now: NOW,
      initialSlots: { resourceCode: 'activity-horse', horseName: 'ภาราดร', date: '2026-09-25', time: '10:00', durationMinutes: 30, partySize: 1 },
    }),
  };
  const turn = deriveDeterministicSemanticTurn('ยืนยันการจอง', emptySemanticContext(), taskState, NOW);
  assert.ok(turn);
  assert.equal(turn!.domain, 'activity');
  assert.equal(turn!.action, 'book');
  assert.deepEqual(turn!.entities, {});
});

test('a date + party size turn against an active task fills both slots deterministically', () => {
  const taskState: TaskStateContainer = {
    ...emptyTaskStateContainer(),
    activeTask: createActiveTask({
      type: 'activity_booking', sourceChannel: 'line', now: NOW,
      initialSlots: { resourceCode: 'activity_asset:horse-01' },
    }),
  };
  const turn = deriveDeterministicSemanticTurn('พรุ่งนี้สองคน', emptySemanticContext(), taskState, NOW);
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
// With an active task, the deterministic parser can safely preserve both the
// commit action and any slot values stated in the same sentence.
test('an explicit commit marker ("จองเลย") on an active task preserves booking intent and slots', () => {
  const taskState: TaskStateContainer = {
    ...emptyTaskStateContainer(),
    activeTask: createActiveTask({ type: 'activity_booking', sourceChannel: 'line', now: NOW }),
  };
  const turn = deriveDeterministicSemanticTurn('จองเลย บ่ายสาม', emptySemanticContext(), taskState);
  assert.ok(turn);
  assert.equal(turn!.action, 'book');
  assert.equal(turn!.entities.time, '15:00');
});

// ---------------------------------------------------------------------------
// Conversation-coverage hardening: an active task is INTERRUPTIBLE -- these
// classes prove side-questions are recognized structurally (comparison
// markers, attribute keywords, price/how-it-works/availability markers,
// cancel markers), never via a literal phrase table, and never touch task
// state themselves.
// ---------------------------------------------------------------------------

test('a comparison among two same-domain recent entities derives compare with a recognized attribute, no task touched', () => {
  const context: SemanticContext = { activeDomain: 'activity', recentEntities: [horseEntity(), horseEntity({ id: 'activity_asset:horse-02', name: 'ทองไทย' })] };
  const turn = deriveDeterministicSemanticTurn('ตัวไหนนิสัยดีกว่า', context, emptyTaskStateContainer());
  assert.ok(turn);
  assert.equal(turn!.action, 'compare');
  assert.equal(turn!.domain, 'activity');
  assert.equal(turn!.entities.compareAttribute, 'temperament');
  assert.equal(turn!.references[0]!.resolvedEntityIds?.length, 2);
  assert.equal(turn!.needsClarification, false);
});

test('a comparison marker with an unrecognized attribute defers rather than under-specifying the comparison', () => {
  const context: SemanticContext = { activeDomain: 'activity', recentEntities: [horseEntity(), horseEntity({ id: 'activity_asset:horse-02', name: 'ทองไทย' })] };
  const turn = deriveDeterministicSemanticTurn('ตัวไหนดีกว่ากันนะ', context, emptyTaskStateContainer());
  assert.equal(turn, null);
});

test('an activity comparison with too little recent entity context still stays deterministic and grounded', () => {
  const context: SemanticContext = { activeDomain: 'activity', recentEntities: [horseEntity()] };
  const turn = deriveDeterministicSemanticTurn('ตัวไหนนิสัยดีกว่า', context, emptyTaskStateContainer());
  assert.ok(turn);
  assert.equal(turn!.domain, 'activity');
  assert.equal(turn!.action, 'compare');
  assert.equal(turn!.entities.compareAttribute, 'temperament');
  assert.deepEqual(turn!.references, []);
});

test('an activity comparison with missing activeDomain still stays deterministic and grounded', () => {
  const turn = deriveDeterministicSemanticTurn('ตัวไหนนิสัยดีกว่า', emptySemanticContext(), emptyTaskStateContainer());
  assert.ok(turn);
  assert.equal(turn!.domain, 'activity');
  assert.equal(turn!.action, 'compare');
  assert.equal(turn!.entities.compareAttribute, 'temperament');
  assert.deepEqual(turn!.references, []);
});

test('owner-verified horse selection starts an activity task even when recentEntities are missing', () => {
  const turn = deriveDeterministicSemanticTurn('เอาภาราดร', emptySemanticContext(), emptyTaskStateContainer());
  assert.ok(turn);
  assert.equal(turn!.domain, 'activity');
  assert.equal(turn!.action, 'confirm');
  assert.equal(turn!.entities.resourceCode, 'activity-horse');
  assert.equal(turn!.entities.horseName, 'ภาราดร');
});

test('REGRESSION: a correction naming BOTH the rejected and the newly-chosen horse in one message resolves to the one being chosen, never the one being turned down', () => {
  const taskState: TaskStateContainer = {
    ...emptyTaskStateContainer(),
    activeTask: createActiveTask({
      type: 'activity_booking', sourceChannel: 'line', now: NOW,
      initialSlots: { resourceCode: 'activity-horse', horseName: 'ภาราดร', durationMinutes: 60, date: '2026-10-03', time: '13:00', partySize: 2 },
    }),
  };
  // Plain array order used to make ภาราดร (listed first in
  // ACTIVITY_ASSET_SELECTIONS) win regardless of which name the customer
  // was actually negating -- a real production bug found while building
  // the 16-turn canonical-state stress test. Both phrasing orders must
  // resolve correctly, since the fix is structural (negation-immediately-
  // before-the-name), not order-specific.
  for (const message of ['ไม่เอาภาราดรแล้ว เอาทองไทย', 'เอาทองไทย ไม่เอาภาราดรแล้ว']) {
    const turn = deriveDeterministicSemanticTurn(message, emptySemanticContext(), taskState, NOW);
    assert.ok(turn, message);
    assert.equal(turn!.entities.horseName, 'ทองไทย', `${message}: must extract the CHOSEN name, never the rejected one`);
  }
});

test('an inventory-count question on an active activity task stays a side-question instead of resuming missing-field collection', () => {
  const taskState: TaskStateContainer = {
    ...emptyTaskStateContainer(),
    activeTask: createActiveTask({ type: 'activity_booking', sourceChannel: 'line', now: NOW, initialSlots: { resourceCode: 'activity-horse' } }),
  };
  const turn = deriveDeterministicSemanticTurn('มีม้ากี่ตัวอะครับ', emptySemanticContext(), taskState, NOW);
  assert.ok(turn);
  assert.equal(turn!.domain, 'activity');
  assert.equal(turn!.action, 'ask');
  assert.equal(turn!.intent, 'activity_inventory_count');
  assert.equal(turn!.entities.activityCode, 'horse');
  assert.equal(turn!.entities.inventoryCount, true);
});

test('a price question on an active activity task is a side-question, not a slot update', () => {
  const taskState: TaskStateContainer = {
    ...emptyTaskStateContainer(),
    activeTask: createActiveTask({ type: 'activity_booking', sourceChannel: 'line', now: NOW, initialSlots: { resourceCode: 'activity-horse' } }),
  };
  const turn = deriveDeterministicSemanticTurn('มีราคาเท่าไร', emptySemanticContext(), taskState);
  assert.ok(turn);
  assert.equal(turn!.action, 'ask');
  assert.equal(turn!.intent, 'ask_price');
  assert.deepEqual(turn!.entities, {});
});

test('an informal "how does it work" question on an active activity task is a side-question', () => {
  const taskState: TaskStateContainer = {
    ...emptyTaskStateContainer(),
    activeTask: createActiveTask({ type: 'activity_booking', sourceChannel: 'line', now: NOW }),
  };
  const turn = deriveDeterministicSemanticTurn('จะขี่ม้าไง', emptySemanticContext(), taskState);
  assert.ok(turn);
  assert.equal(turn!.action, 'ask');
  assert.equal(turn!.intent, 'ask_how_it_works');
});

test('an availability-status question retains the stated date but is classified as status, not a silent slot fill', () => {
  const taskState: TaskStateContainer = {
    ...emptyTaskStateContainer(),
    activeTask: createActiveTask({ type: 'activity_booking', sourceChannel: 'line', now: NOW }),
  };
  const turn = deriveDeterministicSemanticTurn('พรุ่งนี้ว่างไหม', emptySemanticContext(), taskState, NOW);
  assert.ok(turn);
  assert.equal(turn!.action, 'status');
  assert.equal(turn!.entities.date, '2026-09-20');
});

test('an explicit cancel marker on an active task derives a cancel action', () => {
  const taskState: TaskStateContainer = {
    ...emptyTaskStateContainer(),
    activeTask: createActiveTask({ type: 'activity_booking', sourceChannel: 'line', now: NOW }),
  };
  const turn = deriveDeterministicSemanticTurn('ยกเลิกก่อน', emptySemanticContext(), taskState);
  assert.ok(turn);
  assert.equal(turn!.action, 'cancel');
});

test('a bare duration turn on an active task fills durationMinutes, and a correction updates it', () => {
  const taskState: TaskStateContainer = {
    ...emptyTaskStateContainer(),
    activeTask: createActiveTask({ type: 'activity_booking', sourceChannel: 'line', now: NOW, initialSlots: { durationMinutes: 60 } }),
  };
  const fill = deriveDeterministicSemanticTurn('60 นาที', emptySemanticContext(), taskState);
  assert.ok(fill);
  assert.equal(fill!.entities.durationMinutes, 60);
  assert.equal(fill!.action, 'provide_information');

  const correction = deriveDeterministicSemanticTurn('จริงๆ 90 นาที', emptySemanticContext(), taskState);
  assert.ok(correction);
  assert.equal(correction!.entities.durationMinutes, 90);
  assert.equal(correction!.action, 'correct_previous');
});

test('a price question with no active task and no active domain defers rather than guessing a domain', () => {
  const turn = deriveDeterministicSemanticTurn('มีราคาเท่าไร', emptySemanticContext(), emptyTaskStateContainer());
  assert.equal(turn, null);
});
