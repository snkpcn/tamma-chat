import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  activityBookingFallbackDraft,
  deterministicGreetingResponse,
  isSimpleGreetingMessage,
} from '../netlify/functions/thongthai-chat';
import type { BrainRequest } from '../netlify/functions/_thongthai-brain-v3';

function request(message: string, userHistory: string[] = []): BrainRequest {
  return {
    message,
    language: 'th',
    guestId: 'guest-greeting-test',
    guestContext: {
      tripDuration: null,
      travelerType: null,
      group: { adults: null, children: null, elderly: null },
      interests: [],
      pace: null,
      budget: null,
      constraints: [],
    },
    journeyContext: {
      currentPlan: null,
      savedPlan: null,
      visitedExperiences: [],
      favorites: [],
      journalEntries: [],
    },
    pageContext: { section: 'home', path: '/' },
    chatHistory: userHistory.map(content => ({ role: 'user' as const, content })),
  };
}

test('a harmless Thai greeting never falls through to the generic clarify copy', () => {
  const response = deterministicGreetingResponse(request('สวัสดี ทดสอบระบบ'));
  assert.ok(response);
  assert.equal(response!.intent, 'greeting');
  assert.match(response!.message, /สวัสดีครับ|ทองไทย/u);
  assert.doesNotMatch(response!.message, /I need one more detail|ขอ.*เพิ่มอีกนิด/u);
});

test('operational turns are not swallowed by the greeting fast path', () => {
  assert.equal(isSimpleGreetingMessage('สวัสดี อยากจองขี่ม้า'), false);
  assert.equal(isSimpleGreetingMessage('hi จองร้านอาหาร'), false);
});

// Real gap: "สวัสดี"/"หวัดดี" glued directly onto a polite particle with no
// space ("สวัสดีครับ", "สวัสดีค่ะ") is the single most common real-world
// Thai greeting -- far more common than the bare word alone -- yet the
// original regex only accepted whitespace/punctuation/end-of-string right
// after "สวัสดี", so this exact phrasing silently missed the fast path
// while the shorter "ดีครับ"/"ดีค่ะ" alternatives (already literal in the
// pattern) worked fine. Locks in that all four polite-particle forms now
// match for both greeting words, and that appending a real operational
// request still correctly defeats the fast path.
test('the glued polite-particle form of สวัสดี/หวัดดี ("สวัสดีครับ", "หวัดดีค่ะ") still matches', () => {
  for (const phrase of ['สวัสดีครับ', 'สวัสดีค่ะ', 'สวัสดีคะ', 'สวัสดีคับ', 'หวัดดีครับ', 'หวัดดีค่ะ']) {
    assert.equal(isSimpleGreetingMessage(phrase), true, phrase);
  }
  assert.equal(isSimpleGreetingMessage('สวัสดีครับ อยากจองขี่ม้า'), false);
  assert.equal(isSimpleGreetingMessage('สวัสดีค่ะ จองห้องพักได้ไหมคะ'), false);
});

test('web chat history fallback starts the real horse booking draft after "อยากขี่ม้า" -> "เอาภาราดร"', () => {
  const draft = activityBookingFallbackDraft(request('เอาภาราดร', ['อยากขี่ม้า']));
  assert.equal(draft?.serviceType, 'activity');
  assert.equal(draft?.resourceCode, 'activity-horse');
  assert.equal(draft?.horseName, 'ภาราดร');
  assert.match(String(draft?.note), /เลือก: ภาราดร \[asset:horse-pharadon\]/u);
});

test('web chat history fallback preserves ภาราดร through slot collection and Thai month dates', () => {
  const draft = activityBookingFallbackDraft(request('ยืนยัน', [
    'อยากขี่ม้า',
    'เอาภาราดร',
    '30 นาที',
    '30 กันยายน 2026 เวลา 10:00',
    '1 คน',
    'SMOKE TEST PHARADON',
    '0999990001',
  ]));
  assert.equal(draft?.horseName, 'ภาราดร');
  assert.equal(draft?.date, '2026-09-30');
  assert.equal(draft?.time, '10:00');
  assert.equal(draft?.durationMinutes, 30);
  assert.equal(draft?.partySize, 1);
  assert.equal(draft?.customerName, 'SMOKE TEST PHARADON');
  assert.equal(draft?.phone, '0999990001');
});

test('web chat history fallback accepts explicit smoke retest identities as booking names', () => {
  const draft = activityBookingFallbackDraft(request('ยืนยัน', [
    'อยากขี่ม้า',
    'เอาภาราดร',
    '30 นาที',
    '2 ตุลาคม 2026 เวลา 10:00',
    '1 คน',
    'SMOKE RETEST PHARADON',
    '0999990011',
  ]));
  assert.equal(draft?.customerName, 'SMOKE RETEST PHARADON');
  assert.equal(draft?.phone, '0999990011');
});

test('web chat history fallback still confirms after initial horse context scrolls out of the UI window', () => {
  const draft = activityBookingFallbackDraft(request('ยืนยัน', [
    'เอาภาราดร',
    '30 นาที',
    '30 กันยายน 2026 เวลา 10:00',
    '1 คน',
    'SMOKE TEST PHARADON',
    '0999990001',
  ]));
  assert.equal(draft?.horseName, 'ภาราดร');
  assert.equal(draft?.durationMinutes, 30);
  assert.equal(draft?.phone, '0999990001');
});

test('web chat-history horse fallback runs before One-Mind cutover can clarify generically', async () => {
  const source = await import('node:fs').then(fs => fs.readFileSync('netlify/functions/thongthai-chat.ts', 'utf8'));
  assert.ok(
    source.indexOf('const earlyActivityFallback = await activityBookingFallbackResponse(request, guestDbId, channel)')
      < source.indexOf("process.env.THONGTHAI_ONE_MIND_CUTOVER === '1'"),
  );
});
