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
