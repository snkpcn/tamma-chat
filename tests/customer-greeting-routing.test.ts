import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deterministicGreetingResponse,
  isSimpleGreetingMessage,
} from '../netlify/functions/thongthai-chat';
import type { BrainRequest } from '../netlify/functions/_thongthai-brain-v3';

function request(message: string): BrainRequest {
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
    chatHistory: [],
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
