import test from 'node:test';
import assert from 'node:assert/strict';
import { currentTurnExplicitlyConfirmsCafeInquiry } from '../netlify/functions/_thongthai-agent-transactions';

test('cafe inquiry confirmation accepts explicit send-to-team consent', () => {
  assert.equal(currentTurnExplicitlyConfirmsCafeInquiry('ยืนยันส่งคำถามครับ'), true);
  assert.equal(currentTurnExplicitlyConfirmsCafeInquiry('ส่งให้ทีมเลยครับ'), true);
  assert.equal(currentTurnExplicitlyConfirmsCafeInquiry('ส่งเรื่องนี้ให้ทีมเลยครับ'), true);
});

test('cafe inquiry confirmation rejects not-yet/cancel/question wording', () => {
  assert.equal(currentTurnExplicitlyConfirmsCafeInquiry('ยังไม่ส่งนะครับ'), false);
  assert.equal(currentTurnExplicitlyConfirmsCafeInquiry('เอาไว้ก่อนครับ'), false);
  assert.equal(currentTurnExplicitlyConfirmsCafeInquiry('ไม่ต้องส่งครับ'), false);
  assert.equal(currentTurnExplicitlyConfirmsCafeInquiry('ส่งให้ทีมได้ไหมครับ'), false);
});
