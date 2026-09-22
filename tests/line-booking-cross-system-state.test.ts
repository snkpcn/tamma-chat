// Regression coverage for a real production bug reproduced on LINE: the
// legacy transactional LINE booking flow (_operations-db.ts's
// handleLineBookingMessage) and the One-Mind conversational layer
// (_deterministic-semantic-turn.ts / _dialog-manager.ts / _task-state.ts)
// are two SEPARATE state stores for the same logical activity-booking
// conversation -- this file's own `booking_sessions` row, and
// guest_agent_state's `taskState.activeTask`. A per-message routing gate
// decides turn-by-turn which system answers a given message, so a customer
// selecting a horse ("เอาภาราดรครับ") or stating a duration ("เอา 30 นาทีครับ")
// in wording that does not match this file's OWN start/session patterns
// gets answered by One-Mind, which correctly tracks the selection -- but
// the LEGACY session never learns it. When a later message (a date/time)
// DOES match the legacy gate's own patterns, control flips back here, and
// without a fallback, the legacy flow re-asks for duration -- discarding
// everything the customer already told Thongthai.
//
// Root cause #2, found while diagnosing: `extractDate` (the canonical date
// parser _deterministic-semantic-turn.ts's One-Mind path uses) and
// `bookingDateFromText` (the legacy parser) BOTH only understood numeric
// DD/MM dates and relative words (พรุ่งนี้/วันนี้) -- neither recognized a
// day + Thai month NAME ("3 ตุลาคม"), which is exactly the format the real
// customer used. Fixed in _slot-parsers.ts's extractDate, and the legacy
// parser now falls back to that same shared function instead of a second
// copy of the Thai month lexicon.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractDate, extractTime } from '../netlify/functions/_slot-parsers';
import {
  resolveActivitySlots, type LineBookingSession, type ActivityTaskStateFallback,
} from '../netlify/functions/_operations-db';

const NOW = new Date('2026-09-22T10:00:00+07:00');

function session(overrides: Partial<LineBookingSession> = {}): LineBookingSession {
  return {
    service_type: 'activity', resource_code: 'activity-horse', requested_date: null, requested_time: null,
    end_date: null, party_size: null, quantity: 1, special_request: null, status: 'collecting', booking_code: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Root cause #2: Thai month-name date parsing
// ---------------------------------------------------------------------------

test('extractDate recognizes a day + Thai month name, not only numeric/relative dates', () => {
  assert.equal(extractDate('3 ตุลาคม', NOW), '2026-10-03');
  assert.equal(extractDate('3 ต.ค.', NOW), '2026-10-03');
  assert.equal(extractDate('3 ตุลาคม เวลา 13.00', NOW), '2026-10-03');
  assert.equal(extractDate('นัดวันที่ 15 มกราคม 2570 ครับ', NOW), '2027-01-15');
});

test('extractDate rolls a bare day+month with no year to next year once it has already passed', () => {
  // NOW is 2026-09-22; "3 มกราคม" with no year must mean 2027, not a date
  // already 8 months in the past.
  assert.equal(extractDate('3 มกราคม', NOW), '2027-01-03');
});

test('extractDate still returns null for unrelated text (no false positives from the new month pattern)', () => {
  assert.equal(extractDate('อยากขี่ม้า', NOW), null);
  assert.equal(extractDate('มีม้ากี่ตัวครับ', NOW), null);
});

test('extractTime already correctly parsed "13.00" -- confirms the bug was date-side, not time-side', () => {
  assert.equal(extractTime('3 ตุลาคม เวลา 13.00'), '13:00');
});

// ---------------------------------------------------------------------------
// Root cause #1: cross-system slot loss, and its fix (resolveActivitySlots)
// ---------------------------------------------------------------------------

test('REGRESSION: the exact reported bug -- duration/asset collected by One-Mind must survive into the legacy flow', () => {
  // State exactly as it would be after "มีม้ากี่ตัวครับ" -> "ตัวไหนนิสัยดีครับ"
  // (both answered by One-Mind, never touching the legacy session) ->
  // "งั้นเอาภาราดรครับ" and "เอา 30 นาทีครับ" (ALSO answered by One-Mind, since
  // neither message matches this file's own start/session patterns -- see
  // shouldConsumeLegacyLineBookingTurn). The legacy session, if one exists at
  // all at this point, only ever has the activity type set.
  const legacySession = session({ requested_date: null, requested_time: null, quantity: 1, special_request: null });
  // What One-Mind's ActiveTask actually collected across those turns.
  const taskFallback: ActivityTaskStateFallback = {
    resourceCode: 'activity-horse', durationMinutes: 30, date: null, time: null, partySize: null,
    asset: { name: 'ภาราดร', assetCode: 'horse-pharadon' },
  };

  // The turn that flips control back to the legacy flow (it recognizes the
  // time even though its own date parser alone would have missed the Thai
  // month name before this fix).
  const resolved = resolveActivitySlots('3 ตุลาคม เวลา 13.00', legacySession, taskFallback);

  assert.equal(resolved.resourceCode, 'activity-horse', 'activity type must be known');
  assert.equal(resolved.durationMinutes, 30, 'duration collected earlier by One-Mind must not be lost');
  assert.deepEqual(resolved.selectedAsset, { name: 'ภาราดร', assetCode: 'horse-pharadon' }, 'ภาราดร must not silently revert to no selection (or to ทองไทย)');
  assert.equal(resolved.requestedDate, '2026-10-03', 'the just-stated date must parse');
  assert.equal(resolved.requestedTime, '13:00', 'the just-stated time must parse');

  // This is the exact condition the bug's own reply branch checks --
  // proving the fix means this branch can no longer fire for this turn.
  assert.notEqual(resolved.durationMinutes, null, 'must NOT re-ask "เลือกระยะเวลา 30, 60 หรือ 90 นาทีได้เลย"');
});

test('without the task-state fallback, the same turn would reproduce the bug (proves the fallback is load-bearing, not incidental)', () => {
  const legacySession = session({ requested_date: null, requested_time: null, quantity: 1, special_request: null });
  const resolved = resolveActivitySlots('3 ตุลาคม เวลา 13.00', legacySession, null);
  assert.equal(resolved.durationMinutes, null, 'with no fallback source, duration is genuinely unknown -- this is the exact bug state');
});

test('correction: "เปลี่ยนเป็น 60 นาที" updates duration only, horse selection survives', () => {
  const legacySession = session({ requested_date: '2026-10-03', requested_time: '13:00', quantity: 30, special_request: 'activity_asset:horse-pharadon:%E0%B8%A0%E0%B8%B2%E0%B8%A3%E0%B8%B2%E0%B8%94%E0%B8%A3' });
  const resolved = resolveActivitySlots('เปลี่ยนเป็น 60 นาที', legacySession, null);
  assert.equal(resolved.durationMinutes, 60, 'the explicit correction must win over the previously stored 30');
  assert.deepEqual(resolved.selectedAsset, { name: 'ภาราดร', assetCode: 'horse-pharadon' }, 'horse selection must survive a duration-only correction');
  assert.equal(resolved.requestedDate, '2026-10-03', 'date must survive a duration-only correction');
  assert.equal(resolved.requestedTime, '13:00', 'time must survive a duration-only correction');
});

test('correction: "เปลี่ยนเป็นทองไทย" updates the horse only, duration/date/time survive', () => {
  const legacySession = session({
    requested_date: '2026-10-03', requested_time: '13:00', quantity: 30,
    special_request: 'activity_duration:30;activity_asset:horse-pharadon:%E0%B8%A0%E0%B8%B2%E0%B8%A3%E0%B8%B2%E0%B8%94%E0%B8%A3',
  });
  const resolved = resolveActivitySlots('เปลี่ยนเป็นทองไทย', legacySession, null);
  assert.deepEqual(resolved.selectedAsset, { name: 'ทองไทย', assetCode: 'horse-thongthai' }, 'the explicit correction must win over the previously stored ภาราดร');
  assert.equal(resolved.durationMinutes, 30, 'duration must survive an asset-only correction');
  assert.equal(resolved.requestedDate, '2026-10-03', 'date must survive an asset-only correction');
  assert.equal(resolved.requestedTime, '13:00', 'time must survive an asset-only correction');
});

test('a session round-trip (serialize the marker, restore it, next turn) never drops a previously known field', () => {
  // Round-trips exactly like activity-asset-selection-booking.test.ts's own
  // marker tests, but exercised through the actual resolveActivitySlots
  // cascade this bugfix added, with a session that already carries both
  // duration and asset via the smuggled special_request marker (the
  // self-healing persistence path: once resolveActivitySlots merges a
  // task-state fallback in, saveActivityProgress persists it back into this
  // same marker, so a THIRD system flip no longer needs the fallback at all).
  const restoredSession = session({
    requested_date: '2026-10-03', requested_time: null, quantity: 30,
    special_request: 'activity_duration:30;activity_asset:horse-pharadon:%E0%B8%A0%E0%B8%B2%E0%B8%A3%E0%B8%B2%E0%B8%94%E0%B8%A3',
  });
  const resolved = resolveActivitySlots('เวลา 14.00 แทน', restoredSession, null);
  assert.equal(resolved.durationMinutes, 30, 'duration restored from the session marker must survive an unrelated time correction');
  assert.deepEqual(resolved.selectedAsset, { name: 'ภาราดร', assetCode: 'horse-pharadon' }, 'asset restored from the session marker must survive an unrelated time correction');
  assert.equal(resolved.requestedDate, '2026-10-03', 'date restored from the session must survive');
  assert.equal(resolved.requestedTime, '14:00', 'the new time must be picked up');
});

test('this turn\'s own text always wins over both the session and the task-state fallback', () => {
  const legacySession = session({ quantity: 30 });
  const taskFallback: ActivityTaskStateFallback = {
    resourceCode: 'activity-horse', durationMinutes: 90, date: null, time: null, partySize: null, asset: null,
  };
  const resolved = resolveActivitySlots('เอา 60 นาทีครับ', legacySession, taskFallback);
  assert.equal(resolved.durationMinutes, 60, 'a value stated in the current message must never be shadowed by an older session or task-state value');
});

test('with nothing known anywhere, resolution is honestly all-null rather than guessing', () => {
  const resolved = resolveActivitySlots('สวัสดีครับ', null, null);
  assert.deepEqual(resolved, {
    resourceCode: null, durationMinutes: null, requestedDate: null, requestedTime: null, partySize: null, selectedAsset: null,
  });
});
