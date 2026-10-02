import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyThongthaiCharacterKernel } from '../netlify/functions/_thongthai-character-kernel';

test('character kernel removes unasked provider jargon and protects canonical names', () => {
  const text = applyThongthaiCharacterKernel({
    message:'จากข้อมูลล่าสุด (openweathermap): เมฆมากครับ น้องการาดรขี่นิ่มกว่าครับ',
    customerMessage:'ตอนนี้ฝนตกไหมครับ',
    language:'th',
    channel:'line',
  });
  assert.doesNotMatch(text,/openweathermap/iu);
  assert.doesNotMatch(text,/จากข้อมูลล่าสุด/u);
  assert.match(text,/ภาราดร/u);
  assert.match(text,/ครับ$/u);
});

test('character kernel makes emergency copy plain and keeps male ending', () => {
  const text = applyThongthaiCharacterKernel({
    message:'รับเรื่องแล้วครับ 🚨🙏 ทีมกำลังดูครับ 😊',
    customerMessage:'มีคนบาดเจ็บเลือดออกครับ',
    language:'th',
    channel:'web',
  });
  assert.doesNotMatch(text,/🚨|🙏|😊/u);
  assert.match(text,/ครับ$/u);
});

test('character kernel adds paragraph rhythm to dense Thai phone copy', () => {
  const text = applyThongthaiCharacterKernel({
    message:'มีสินค้าอยู่ครับ ราคาเช็กได้ครับ ส่งรูปให้ดูได้ครับ ถ้าอยากดูหลายมุมบอกได้ครับ',
    customerMessage:'มีขายไหมครับ',
    language:'th',
    channel:'facebook',
  });
  assert.match(text,/\n\n/u);
  assert.match(text,/ครับ$/u);
});
