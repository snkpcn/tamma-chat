import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFinalCustomerMessage } from '../netlify/functions/thongthai-chat';

test('Phase 6.2 final gateway strips Thai polite residue from English on every channel',()=>{
  for(const channel of ['line','web','facebook'] as const){
    const value=normalizeFinalCustomerMessage(
      'A 30-minute horse ride is THB 300 per personครับ.',
      'en',
      channel,
    );
    assert.equal(value,'A 30-minute horse ride is THB 300 per person.');
  }
});

test('Phase 6.2 final gateway strips Thai polite residue from Chinese clarification',()=>{
  const value=normalizeFinalCustomerMessage(
    '有的ครับ。请告诉我入住和退房日期。',
    'zh',
    'facebook',
  );
  assert.equal(value,'有的。请告诉我入住和退房日期。');
});

test('Phase 6.2 final gateway preserves Thai male polite voice',()=>{
  const value=normalizeFinalCustomerMessage(
    'ได้ค่ะ เดี๋ยวเช็กให้คะ',
    'th',
    'line',
  );
  assert.equal(value,'ได้ครับ เดี๋ยวเช็กให้ครับ');
});
