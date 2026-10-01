import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  THONGTHAI_FACEBOOK_PERSONA_NAME,
  THONGTHAI_FACEBOOK_PERSONA_PROFILE_URL,
  detectFacebookLanguage,
  extractFacebookTextEvents,
  facebookGuestId,
  findThongthaiPersonaId,
  splitFacebookText,
  verifyFacebookSignature,
} from '../netlify/functions/_facebook-messenger-adapter';

test('facebookGuestId is stable and UUID-shaped', () => {
  const first = facebookGuestId('fake-user-id');
  const second = facebookGuestId('fake-user-id');
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('verifyFacebookSignature validates x-hub-signature-256', () => {
  const body = JSON.stringify({ object: 'page', entry: [] });
  const secret = 'unit-test-value';
  const digest = createHmac('sha256', secret).update(body, 'utf8').digest('hex');
  assert.equal(verifyFacebookSignature(body, `sha256=${digest}`, secret), true);
  assert.equal(verifyFacebookSignature(body + 'x', `sha256=${digest}`, secret), false);
});

test('extractFacebookTextEvents keeps configured-page text events only', () => {
  const payload = {
    object: 'page',
    entry: [
      {
        id: 'page-123',
        messaging: [
          {
            sender: { id: 'user-1' },
            recipient: { id: 'page-123' },
            timestamp: 1760000000000,
            message: { mid: 'm-1', text: 'สวัสดีครับ' },
          },
          {
            sender: { id: 'user-2' },
            recipient: { id: 'page-123' },
            message: { mid: 'm-2', text: 'echo', is_echo: true },
          },
        ],
      },
      {
        id: 'page-other',
        messaging: [
          {
            sender: { id: 'user-3' },
            recipient: { id: 'page-other' },
            message: { mid: 'm-3', text: 'wrong page' },
          },
        ],
      },
    ],
  };

  const events = extractFacebookTextEvents(payload, 'page-123');
  assert.equal(events.length, 1);
  assert.equal(events[0]!.text, 'สวัสดีครับ');
  assert.equal(events[0]!.eventId, 'm-1');
});

test('language detection and message splitting stay within transport limits', () => {
  assert.equal(detectFacebookLanguage('สวัสดีครับ'), 'th');
  assert.equal(detectFacebookLanguage('hello'), 'en');
  const chunks = splitFacebookText('a'.repeat(4300), 1900);
  assert.equal(chunks.length, 3);
  assert.ok(chunks.every(chunk => chunk.length <= 1900));
  assert.equal(chunks.join('').length, 4300);
});


test('Thongthai Messenger persona uses the locked Thongthai profile asset', () => {
  assert.equal(THONGTHAI_FACEBOOK_PERSONA_NAME, 'ทองไทย');
  assert.equal(
    THONGTHAI_FACEBOOK_PERSONA_PROFILE_URL,
    'https://tamma-chat.netlify.app/assets/thongthai/thongthai-default.webp',
  );
  assert.equal(
    findThongthaiPersonaId({
      data: [
        { id: 'persona-other', name: 'Staff' },
        { id: 'persona-thongthai', name: 'ทองไทย' },
      ],
    }),
    'persona-thongthai',
  );
  assert.equal(findThongthaiPersonaId({ data: [] }), null);
});
