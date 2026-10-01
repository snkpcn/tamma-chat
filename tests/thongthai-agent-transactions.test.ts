import test from 'node:test';
import assert from 'node:assert/strict';
import { currentTurnExplicitlyConfirmsPreparedBooking } from '../netlify/functions/_thongthai-agent-transactions';

test('prepared activity booking confirmation requires affirmative current-turn booking intent', () => {
  assert.equal(currentTurnExplicitlyConfirmsPreparedBooking('ยืนยันจองครับ'), true);
  assert.equal(currentTurnExplicitlyConfirmsPreparedBooking('จองเลยครับ'), true);
  assert.equal(currentTurnExplicitlyConfirmsPreparedBooking('ยังไม่จองนะ'), false);
  assert.equal(currentTurnExplicitlyConfirmsPreparedBooking('เอาไว้ก่อน ยังไม่จอง'), false);
  assert.equal(currentTurnExplicitlyConfirmsPreparedBooking('จองไหมครับ'), false);
  assert.equal(currentTurnExplicitlyConfirmsPreparedBooking('ไม่ต้องจองเลยครับ'), false);
});
