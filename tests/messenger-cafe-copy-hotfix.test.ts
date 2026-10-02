import { test } from 'node:test';
import assert from 'node:assert/strict';
import { polishCustomerMessage } from '../netlify/functions/_chat-copy-style';

test('Messenger cafe copy never implies a remembered preference before the customer states one', () => {
  const input='รับทราบครับ ตอนนี้ความชอบที่จำไว้คือ ยังไม่ได้เลือกรสชาติหรือเมนูครับ แต่ระบบยังไม่มีข้อมูลเมนู ราคา หรือสต็อกเครื่องดื่มของคาเฟ่ Inthanin ตาดโตนที่ยืนยันครับ';
  const output=polishCustomerMessage(input,'facebook');
  assert.match(output,/คุณยังไม่ได้บอกรสชาติหรือเมนูที่ชอบไว้ครับ/u);
  assert.doesNotMatch(output,/ความชอบที่จำไว้คือ/u);
});
