import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  customerCopyLooksMobileSafe,
  formatCustomerCopy,
  splitCustomerCopyForLine,
} from '../netlify/functions/_customer-copy';

test('normalizes markdown bullets, spacing and operational labels', () => {
  const input = [
    '**สรุปการจอง**',
    '- ห้องพัก 1 หลัง',
    '- ผู้เข้าพัก 2 คน',
    '',
    '',
    'สถานะ: รอทีมยืนยัน',
    'รวม 2,400 บาท',
  ].join('\n');
  const out = formatCustomerCopy(input, { channel:'line' });
  assert.equal(out, [
    'สรุปการจอง',
    '',
    '• ห้องพัก 1 หลัง',
    '• ผู้เข้าพัก 2 คน',
    '',
    '📌 สถานะ: รอทีมยืนยัน',
    '💰 รวม 2,400 บาท',
  ].join('\n'));
});

test('breaks a long Thai wall of text into readable lines without deleting content', () => {
  const input = 'ทองไทยแนะนำให้เริ่มจากโซนอาหารก่อนครับ จากนั้นค่อยไปคาเฟ่ด้านหน้าเพื่อพักสบาย ๆ ครับ ช่วงบ่ายถ้าอยากทำกิจกรรมค่อยเลือกขี่ม้าหรือยิงธนูตามเวลาที่สะดวกครับ ไม่จำเป็นต้องยัดทุกอย่างไว้ในวันเดียวครับ';
  const out = formatCustomerCopy(input, { channel:'line' });
  assert.ok(out.includes('\n'));
  assert.ok(out.includes('ไม่จำเป็นต้องยัดทุกอย่างไว้ในวันเดียวครับ'));
  assert.equal(out.replace(/\s+/g,' ').trim(), input.replace(/\s+/g,' ').trim());
});

test('splits LINE replies into phone-friendly bubbles instead of one giant wall', () => {
  const paragraph = 'รายละเอียดนี้อ่านบนมือถือได้สบายครับ '.repeat(45).trim();
  const chunks = splitCustomerCopyForLine(paragraph, { maxChars:700, maxMessages:5 });
  assert.ok(chunks.length >= 2);
  assert.ok(chunks.length <= 5);
  assert.ok(chunks.every(chunk => chunk.length <= 720));
});

test('preserves URLs and never introduces runaway blank lines or markdown walls', () => {
  const input = 'ดูรายละเอียดได้ที่ https://tamma-chat.netlify.app/account.html\n\n\n**ขั้นตอนต่อไป**\n- เปิดหน้าสมาชิก';
  const out = formatCustomerCopy(input, { channel:'line' });
  assert.match(out, /https:\/\/tamma-chat\.netlify\.app\/account\.html/);
  assert.equal(customerCopyLooksMobileSafe(out), true);
  assert.doesNotMatch(out, /\n{3,}/);
  assert.doesNotMatch(out, /\*\*/);
});

test('keeps emoji restrained and does not decorate bullet items repeatedly', () => {
  const input = ['รายการแนะนำ', '- เมนูหนึ่ง', '- เมนูสอง', 'สถานะ: พร้อม'].join('\n');
  const out = formatCustomerCopy(input, { channel:'line' });
  assert.match(out, /• เมนูหนึ่ง/);
  assert.match(out, /• เมนูสอง/);
  assert.match(out, /📌 สถานะ: พร้อม/);
  assert.equal((out.match(/📌/g) ?? []).length, 1);
});
