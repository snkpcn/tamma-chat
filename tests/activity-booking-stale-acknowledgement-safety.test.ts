// PR A item 2c: activityFallbackCommit (thongthai-chat.ts) treats a bare
// "ยืนยัน"/"ตกลง"/"โอเค" identically to hasCommitMarker's explicit
// booking-verb phrases ("จองเลย", "ยืนยันจอง"). But activityBookingFallbackDraft
// extracts slot values by scanning the WHOLE joined conversation text, so
// once a genuine slot-filling exchange has ever completed all required
// fields, EVERY later bare acknowledgement -- even one replying to a
// completely unrelated later bot message -- could re-fire that stale draft
// as a fresh, real booking write. The fix (authorizedActivityBookingCommit)
// requires a bare acknowledgement to be a direct reply to this fallback's
// own just-shown ready-to-confirm summary (embedding
// ACTIVITY_BOOKING_CONFIRM_PROMPT_MARKER, which only ever appears in that
// exact summary text); hasCommitMarker's explicit phrases remain sufficient
// on their own, at any point, because they name the transaction itself.
//
// The gate is tested directly (not through the full processThongthaiChatCore
// pipeline) because the language-understanding layer's own ambiguity
// handling for a content-free "โอเค" with no tracked task state is an
// orthogonal concern that would otherwise make an end-to-end test flaky/
// non-deterministic for reasons unrelated to this fix. activityFallbackDraft
// and the legacy fallback family this gates are the REAL, unexported
// production functions (see the explicit end-to-end test at the bottom for
// the one scenario -- an explicit booking verb -- that IS reliably
// deterministic end-to-end).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withHarness, guestId, brainRequest } from './helpers/canonical-core-harness';
import {
  processThongthaiChatCore,
  activityBookingFallbackDraft,
  authorizedActivityBookingCommit,
} from '../netlify/functions/thongthai-chat';
import type { BrainRequest } from '../netlify/functions/_thongthai-brain-v3';

const READY_TO_CONFIRM_SUMMARY = 'สรุปคำขอจองขี่ม้า ภาราดร\nเลือกม้า: ภาราดร\nวันที่: 2026-10-05\nถ้าถูกต้อง พิมพ์ "ยืนยัน" เพื่อส่งคำขอจองเข้าระบบครับ';
const UNRELATED_BOT_REPLY = 'วันนี้อากาศแจ่มใส ไม่มีฝนตกครับ';

const SLOT_FILLING_TURNS = [
  'อยากขี่ม้า',
  'เอาภาราดร',
  '30 นาที',
  '5 ตุลาคม 2026 เวลา 10:00',
  '1 คน ชื่อ SMOKE TEST PHARADON เบอร์ 0999990001',
];

function requestWithHistory(message: string, history: Array<{ role: 'user' | 'assistant'; content: string }>): BrainRequest {
  return {
    message,
    language: 'th',
    guestId: 'guest-fallback-commit-test',
    guestContext: {
      tripDuration: null, travelerType: null, group: { adults: null, children: null, elderly: null },
      interests: [], pace: null, budget: null, constraints: [],
    },
    journeyContext: { currentPlan: null, savedPlan: null, visitedExperiences: [], favorites: [], journalEntries: [] },
    pageContext: { section: 'home', path: '/' },
    chatHistory: history,
  };
}

test('setup check: the full slot-filling turn sequence produces a complete draft (missing nothing)', () => {
  const userTurns = SLOT_FILLING_TURNS;
  const draft = activityBookingFallbackDraft(requestWithHistory(userTurns[userTurns.length - 1]!, userTurns.slice(0, -1).map(content => ({ role: 'user' as const, content }))));
  assert.ok(draft, 'the joined slot-filling turns must produce a draft');
  assert.equal(draft?.horseName, 'ภาราดร');
  assert.equal(draft?.date, '2026-10-05');
  assert.equal(draft?.time, '10:00');
  assert.equal(draft?.durationMinutes, 30);
  assert.equal(draft?.partySize, 1);
  assert.equal(draft?.customerName, 'SMOKE TEST PHARADON');
  assert.equal(draft?.phone, '0999990001');
});

test('a bare "โอเค" directly replying to the bot\'s OWN ready-to-confirm summary IS authorized', () => {
  const history: Array<{ role: 'user' | 'assistant'; content: string }> = [
    ...SLOT_FILLING_TURNS.map(content => ({ role: 'user' as const, content })),
    { role: 'assistant', content: READY_TO_CONFIRM_SUMMARY },
  ];
  for (const ack of ['โอเค', 'ตกลง', 'ยืนยัน', 'โอเคครับ']) {
    assert.equal(authorizedActivityBookingCommit(requestWithHistory(ack, history)), true, ack);
  }
});

test('a bare "โอเค" replying to a LATER, UNRELATED bot message is NOT authorized (stale draft must not silently execute)', () => {
  const history: Array<{ role: 'user' | 'assistant'; content: string }> = [
    ...SLOT_FILLING_TURNS.map(content => ({ role: 'user' as const, content })),
    { role: 'assistant', content: READY_TO_CONFIRM_SUMMARY },
    { role: 'user', content: 'วันนี้ฝนตกไหมครับ' },
    { role: 'assistant', content: UNRELATED_BOT_REPLY },
  ];
  for (const ack of ['โอเค', 'ตกลง', 'ยืนยัน']) {
    assert.equal(authorizedActivityBookingCommit(requestWithHistory(ack, history)), false, ack);
  }
});

test('a bare "โอเค" with NO chatHistory at all (the real LINE production shape) is NOT authorized', () => {
  assert.equal(authorizedActivityBookingCommit(requestWithHistory('โอเค', [])), false);
});

test('an explicit booking verb ("จองเลย"/"ยืนยันจอง") remains authorized on its own, with no summary reply required', () => {
  for (const message of ['จองเลย', 'ยืนยันจอง', 'ยืนยันการจอง']) {
    assert.equal(authorizedActivityBookingCommit(requestWithHistory(message, [])), true, message);
    assert.equal(authorizedActivityBookingCommit(requestWithHistory(message, [
      { role: 'user', content: 'x' }, { role: 'assistant', content: UNRELATED_BOT_REPLY },
    ])), true, message);
  }
});

test('end-to-end: an explicit booking verb in a single message still executes a real booking through the full pipeline', async () => {
  const RESOURCE_ROW = { id: 'res-horse-1', code: 'activity-horse', name: 'ขี่ม้า', metadata: {} };
  const SCHEDULE_ROWS = [
    { id: 'sched-1', start_at: '2026-10-06T10:00:00+07:00', end_at: '2026-10-06T10:30:00+07:00', capacity_total: 2, capacity_reserved: 0 },
    { id: 'sched-2', start_at: '2026-10-06T10:30:00+07:00', end_at: '2026-10-06T11:00:00+07:00', capacity_total: 2, capacity_reserved: 0 },
  ];
  await withHarness(async harness => {
    const gid = guestId('activity-fallback-commit-e2e-explicit');
    const message = 'อยากขี่ม้า เอาภาราดร วันที่ 2026-10-06 เวลา 10:00 ระยะเวลา 30 นาที จำนวน 1 คน ชื่อสมชาย เบอร์ 0812345678 จองเลย';
    const r = await processThongthaiChatCore(brainRequest(message, gid, 'web'), 'evt-explicit');
    assert.equal(r.statusCode, 200);
    assert.equal(harness.postsTo('bookings').length, 1,
      'hasCommitMarker\'s explicit booking-verb phrases must remain sufficient on their own, end-to-end');
  }, { serviceResources: [RESOURCE_ROW], serviceSchedules: SCHEDULE_ROWS });
});
