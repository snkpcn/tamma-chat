import test from 'node:test';
import assert from 'node:assert/strict';

import { isPreparedTransactionStatusCheck } from '../netlify/functions/_thongthai-prepare-fastpath-v2';

test('prepared transaction status readback recognizes booking/order/inquiry existence questions', () => {
  for (const message of [
    'ตอนนี้ยังไม่มีการจองที่พักจริงถูกสร้างใช่ไหมครับ',
    'ตอนนี้ยังไม่มีออเดอร์ร้านอาหารถูกสร้างจริงใช่ไหมครับ',
    'ตอนนี้ยังไม่มีออเดอร์ OTOP ถูกสร้างจริงใช่ไหมครับ',
    'ตอนนี้ยังไม่มีคำถามจริงถูกส่งให้ทีมคาเฟ่ใช่ไหมครับ',
  ]) {
    assert.equal(isPreparedTransactionStatusCheck(message), true, message);
  }
});

test('prepared transaction status readback does not steal ordinary discovery or new transaction turns', () => {
  for (const message of [
    'มีห้องอะไรบ้างครับ',
    'เมนูไหนอร่อย',
    'ขอจองที่พักพรุ่งนี้ครับ',
    'ยืนยันส่งคำถาม',
    'เอาไว้ก่อนครับ',
  ]) {
    assert.equal(isPreparedTransactionStatusCheck(message), false, message);
  }
});
