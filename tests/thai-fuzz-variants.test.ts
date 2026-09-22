// PRIORITY 6 (owner-specified): Thai fuzz variants across the SHARED,
// domain-agnostic parsers (_slot-parsers.ts) plus the activity domain's own
// text classifiers, testing structural categories (spacing, date/time
// notation, correction markers, casual/shortened phrasing) rather than
// individual hardcoded phrases -- exactly the owner's own stated
// requirement ("Fix structural categories, not individual phrases").
//
// Systematically checked every variant the owner listed. Most already
// worked correctly (this file documents and locks that in with regression
// tests). One genuine gap was found and fixed while building this file:
// see the "casual/shortened phrasing on an active task" section below.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractDate, extractTime, extractDurationMinutes, hasCorrectionMarker,
} from '../netlify/functions/_slot-parsers';
import { activityDurationFromText, activityDateFromText } from '../netlify/functions/_operations-db';
import { deriveDeterministicSemanticTurn, findKnownActivityAssetSelection } from '../netlify/functions/_deterministic-semantic-turn';
import { emptySemanticContext } from '../netlify/functions/_semantic-interpreter';
import { emptyTaskStateContainer, createActiveTask, type TaskStateContainer } from '../netlify/functions/_task-state';

const NOW = new Date('2026-09-22T10:00:00+07:00');

function activityTaskState(): TaskStateContainer {
  return {
    ...emptyTaskStateContainer(),
    activeTask: createActiveTask({ type: 'activity_booking', sourceChannel: 'line', now: NOW, initialSlots: { resourceCode: 'activity-horse' } }),
  };
}

// ---------------------------------------------------------------------------
// Spacing: a politeness particle glued directly onto the preceding word
// (no space) is the overwhelmingly common real phrasing, not an edge case.
// ---------------------------------------------------------------------------

test('duration parses identically with and without a space before the politeness particle', () => {
  assert.equal(extractDurationMinutes('30 นาทีครับ'), 30);
  assert.equal(extractDurationMinutes('30นาทีครับ'), 30);
  assert.equal(activityDurationFromText('30 นาทีครับ'), 30);
  assert.equal(activityDurationFromText('30นาทีครับ'), 30);
});

test('horse selection parses identically with and without a trailing politeness particle', () => {
  assert.equal(findKnownActivityAssetSelection('เอาภาราดรครับ')?.name, 'ภาราดร');
  assert.equal(findKnownActivityAssetSelection('เอาภาราดร')?.name, 'ภาราดร');
});

// ---------------------------------------------------------------------------
// Thai dates: month name (full and abbreviated) and numeric notation must
// all resolve to the SAME date.
// ---------------------------------------------------------------------------

test('all four Thai date notations for the same calendar date resolve identically', () => {
  const expected = '2026-10-03';
  assert.equal(extractDate('3 ตุลาคม', NOW), expected);
  assert.equal(extractDate('3 ต.ค.', NOW), expected);
  assert.equal(extractDate('03/10', NOW), expected);
  assert.equal(extractDate('3/10', NOW), expected);
  assert.equal(activityDateFromText('3 ตุลาคม'), expected);
  assert.equal(activityDateFromText('3 ต.ค.'), expected);
  assert.equal(activityDateFromText('03/10'), expected);
});

// ---------------------------------------------------------------------------
// Thai times: 24-hour dot/colon notation and a casual hour-name form must
// all resolve to a real time.
// ---------------------------------------------------------------------------

test('dot and colon time notation resolve identically', () => {
  assert.equal(extractTime('13.00'), '13:00');
  assert.equal(extractTime('13:00'), '13:00');
});

test('casual afternoon hour names resolve to the correct 24-hour time', () => {
  assert.equal(extractTime('บ่ายสาม'), '15:00');
  assert.equal(extractTime('บ่ายโมง'), '13:00');
});

// ---------------------------------------------------------------------------
// Corrections: the structural correction-marker category, not a phrase
// table -- "จริงๆ" and "ไม่ใช่" both work, and both survive being combined
// with the value/name being corrected to.
// ---------------------------------------------------------------------------

test('both correction-marker phrasings are recognized as corrections', () => {
  assert.equal(hasCorrectionMarker('จริงๆ 60 นาที'), true);
  assert.equal(hasCorrectionMarker('ไม่ใช่ เอาทองไทย'), true);
  assert.equal(hasCorrectionMarker('เปลี่ยนเป็น 60 นาที'), true);
});

test('a correction marker does not prevent the corrected value from still parsing', () => {
  assert.equal(extractDurationMinutes('จริงๆ 60 นาที'), 60);
  assert.equal(findKnownActivityAssetSelection('ไม่ใช่ เอาทองไทย')?.name, 'ทองไทย');
});

test('"เวลาเดิม" (same time as before) is honestly NOT a recognized correction marker -- documented gap, not a false positive', () => {
  // This is a reference to a prior value, grammatically distinct from a
  // correction ("changed my mind"). Treating it as a correction with no
  // extractable new value would be worse than the current honest
  // fallback (see activity-16-turn-canonical-state.test.ts's turn 14 for
  // proof this never corrupts the slot it refers to).
  assert.equal(hasCorrectionMarker('เวลาเดิมนะ'), false);
  assert.equal(extractTime('เวลาเดิมนะ'), null);
});

// ---------------------------------------------------------------------------
// Casual/shortened phrasing on an active task: a GENUINE GAP found and
// fixed while building this file. "มีกี่ตัว" (a shortened inventory-count
// question with no activity keyword restated) used to fall through to the
// LLM path even with an activity_booking task already open, because
// detectActivitySideQuestion only ever looked for the topic keyword in
// THIS message. Fixed structurally: it now also accepts the ALREADY-OPEN
// task's own resourceCode as the topic when the message itself doesn't
// restate it -- never guessed when there is no active task to fall back to.
// ---------------------------------------------------------------------------

test('REGRESSION: a shortened inventory-count question with no activity keyword resolves from the ALREADY-OPEN task\'s topic', () => {
  const turn = deriveDeterministicSemanticTurn('มีกี่ตัว', emptySemanticContext(), activityTaskState(), NOW);
  assert.ok(turn, 'must not fall through to the LLM when task context already answers "which activity"');
  assert.equal(turn!.domain, 'activity');
  assert.equal(turn!.intent, 'activity_inventory_count');
  assert.equal(turn!.entities.activityCode, 'horse');
});

test('the same shortened question with NO active task is honestly ambiguous, never guessed', () => {
  const turn = deriveDeterministicSemanticTurn('มีกี่ตัว', emptySemanticContext(), emptyTaskStateContainer(), NOW);
  assert.equal(turn, null, 'with nothing to fall back to, "which activity" is genuinely unknown -- must not guess a default');
});

test('the full topic keyword still works standalone, exactly as before this fix (no regression to the original 87601b0 behavior)', () => {
  const turn = deriveDeterministicSemanticTurn('มีม้ากี่ตัวอะครับ', emptySemanticContext(), emptyTaskStateContainer(), NOW);
  assert.ok(turn);
  assert.equal(turn!.intent, 'activity_inventory_count');
  assert.equal(turn!.entities.activityCode, 'horse');
});

test('casual price and domain-switch phrasing resolve correctly without special-casing', () => {
  const priceOnTask = deriveDeterministicSemanticTurn('แล้วราคาอะ', emptySemanticContext(), activityTaskState(), NOW);
  assert.ok(priceOnTask);
  assert.equal(priceOnTask!.intent, 'ask_price');

  const restaurantSwitch = deriveDeterministicSemanticTurn('ร้านมีไรกิน', emptySemanticContext(), activityTaskState(), NOW);
  assert.ok(restaurantSwitch);
  assert.equal(restaurantSwitch!.domain, 'restaurant');
});
