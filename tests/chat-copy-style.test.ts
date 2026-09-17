import { test } from 'node:test';
import assert from 'node:assert/strict';
import { polishCustomerMessage, splitCustomerMessageForLine } from '../netlify/functions/_chat-copy-style';

test('customer copy removes raw markdown but preserves readable spacing', () => {
  const value = [
    '## เมนูแนะนำ',
    '',
    '- **ลาบปลาช่อน** — 189 บาท',
    '- `ตำซั่วปลาร้า` — 89 บาท',
    '',
    '',
    'เลือกได้ตามชอบครับ',
  ].join('\n');
  assert.equal(
    polishCustomerMessage(value, 'line'),
    ['เมนูแนะนำ','','• ลาบปลาช่อน — 189 บาท','• ตำซั่วปลาร้า — 89 บาท','','เลือกได้ตามชอบครับ'].join('\n'),
  );
});

test('web copy keeps URLs byte-for-byte while cleaning presentation markup', () => {
  const url = 'https://tamma-chat.netlify.app/account.html?code=12345678&from=line';
  const value = `**สมัครสมาชิก**\n\n${url}`;
  const polished = polishCustomerMessage(value, 'web');
  assert.match(polished, /^สมัครสมาชิก/);
  assert.ok(polished.includes(url));
});

test('markdown tables become compact plain text instead of raw pipe syntax', () => {
  const value = '| เมนู | ราคา |\n| --- | --- |\n| ลาบไก่ | 159 บาท |';
  assert.equal(
    polishCustomerMessage(value, 'facebook'),
    'เมนู · ราคา\n\nลาบไก่ · 159 บาท',
  );
});

test('operational labels get restrained useful emoji without decorating every bullet', () => {
  const value = ['รายการ', '- เมนูหนึ่ง', '- เมนูสอง', 'สถานะ: รอร้านยืนยัน', 'รวม 587 บาท'].join('\n');
  const polished = polishCustomerMessage(value, 'line');
  assert.match(polished, /• เมนูหนึ่ง/);
  assert.match(polished, /• เมนูสอง/);
  assert.match(polished, /📌 สถานะ: รอร้านยืนยัน/);
  assert.match(polished, /💰 รวม 587 บาท/);
  assert.equal((polished.match(/📌/g) ?? []).length, 1);
  assert.equal((polished.match(/💰/g) ?? []).length, 1);
});

test('LINE splitting favours paragraph boundaries and never drops content', () => {
  const paragraphs = Array.from({length:8}, (_, index) => `ส่วนที่ ${index + 1} ${'ข้อมูล'.repeat(90)}`);
  const input = paragraphs.join('\n\n');
  const polished = polishCustomerMessage(input, 'line');
  const chunks = splitCustomerMessageForLine(input, 700, 5);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every(chunk => chunk.length > 0));
  assert.ok(chunks.every(chunk => chunk.length <= 4900));
  assert.equal(chunks.join('\n\n').replace(/\n{3,}/g,'\n\n'), polished);
});

test('callers cannot inflate ordinary LINE bubbles past the phone readability cap', () => {
  const input = Array.from({length:18}, (_, index) => `ช่วง ${index + 1} ${'ข้อความอ่านง่าย '.repeat(8)}`).join('\n\n');
  const chunks = splitCustomerMessageForLine(input, 1800, 5);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every(chunk => chunk.length <= 1100));
});

test('short LINE replies stay one bubble', () => {
  assert.deepEqual(splitCustomerMessageForLine('เรียบร้อยครับ ✅\nรอร้านรับออเดอร์'), ['เรียบร้อยครับ ✅\nรอร้านรับออเดอร์']);
});
