// Regression coverage for two independent parsing bugs found while
// diagnosing the original reported production bug (Thongthai re-asking for
// duration after a customer already gave a date+time), and for how they
// combine with PRIORITY 2's mirror (mirror-activity-task-to-legacy-
// session.test.ts) to fix the ORIGINAL reported scenario end-to-end.
//
// Root cause recap: the legacy LINE booking flow's OWN date/duration
// parsers (_operations-db.ts's bookingDateFromText/activityDurationFromText)
// are what run on the CURRENT turn's text when that turn is the one that
// flips control back to the legacy flow (see _line-webhook-core.ts's
// membership -> legacy-booking -> One-Mind routing order) -- the mirror
// only carries forward what an EARLIER turn, handled by One-Mind, already
// collected. Both fixes are structural (a Thai grammatical category / a
// real-world text pattern), never a one-off phrase match.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractDate, extractTime } from '../netlify/functions/_slot-parsers';
import { activityDateFromText, activityDurationFromText } from '../netlify/functions/_operations-db';

const NOW = new Date('2026-09-22T10:00:00+07:00');

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

test('extractTime already correctly parsed "13.00" -- confirms the original bug was date-side, not time-side', () => {
  assert.equal(extractTime('3 ตุลาคม เวลา 13.00'), '13:00');
});

test('activityDateFromText (the legacy flow\'s own parser) now recognizes a day + Thai month name, delegating to the shared parser', () => {
  // activityDateFromText has no injectable `now` (it always resolves
  // against the real current date), so assert on the day/month it must
  // resolve to rather than a fixed year.
  const result = activityDateFromText('3 ตุลาคม');
  assert.notEqual(result, null);
  assert.match(result!, /^\d{4}-10-03$/);
});

test('activityDateFromText no longer misreads a co-occurring TIME ("13.00") as an invalid numeric date and short-circuit before the Thai-month fallback', () => {
  // This is the exact bug: "." is also the time separator, so the old
  // regex (which included "." as a date separator) matched "13.00" as an
  // invalid DD.MM date (month 00) and returned null immediately, never
  // reaching the Thai-month-name fallback for "3 ตุลาคม" earlier in the
  // same message.
  const result = activityDateFromText('3 ตุลาคม เวลา 13.00');
  assert.notEqual(result, null, 'a date stated alongside a time in the same message must still parse');
  assert.match(result!, /^\d{4}-10-03$/, 'must resolve to October 3rd, not be corrupted by the "13.00" time');
});

test('activityDurationFromText accepts "30 นาทีครับ" (politeness particle glued directly to นาที, no space)', () => {
  assert.equal(activityDurationFromText('เอา 30 นาทีครับ'), 30);
  assert.equal(activityDurationFromText('เอา 60 นาทีค่ะ'), 60);
  assert.equal(activityDurationFromText('90 นาทีนะ'), 90);
});

test('activityDurationFromText still returns null for an out-of-range or unrelated number', () => {
  assert.equal(activityDurationFromText('120 นาทีครับ'), null);
  assert.equal(activityDurationFromText('เบอร์ 099999 นาที'), null);
});
