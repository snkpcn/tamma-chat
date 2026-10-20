import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCustomerText } from '../netlify/functions/_customer-text';

test('the original typography contract still holds', () => {
  assert.equal(normalizeCustomerText('  สวัสดี  '), 'สวัสดี');
  assert.equal(normalizeCustomerText('๔ คน'), '4 คน');
  assert.equal(normalizeCustomerText('๒๐๒๖-๑๐-๒๐'), '2026-10-20');
  // Invisible separators break Thai routing and must go.
  assert.equal(normalizeCustomerText('จอง​โต๊ะ'), 'จองโต๊ะ');
  assert.equal(normalizeCustomerText('ขี่ม้า⁠ราคา'), 'ขี่ม้าราคา');
});

test('emoji survive normalization', () => {
  assert.equal(normalizeCustomerText('อร่อยมาก 😋'), 'อร่อยมาก 😋');
  // A ZWJ emoji sequence must not be torn apart.
  assert.equal(normalizeCustomerText('👨‍👩‍👧 มา 3 คน'), '👨‍👩‍👧 มา 3 คน');
});

test('elongation collapses to the real word', () => {
  assert.equal(normalizeCustomerText('มีโต๊ะว่างไหมมมม'), 'มีโต๊ะว่างไหม');
  assert.equal(normalizeCustomerText('ขอบคุณครับบบบบ'), 'ขอบคุณครับ');
  assert.equal(normalizeCustomerText('ดีมากกกก'), 'ดีมาก');
  assert.equal(normalizeCustomerText('อร่อยยยย'), 'อร่อย');
  assert.equal(normalizeCustomerText('ไปป่าววววว'), 'ไปป่าว');
});

test('elongation collapse never corrupts a real doubled consonant', () => {
  // Standard Thai genuinely places two identical consonants side by side.
  // Only three or more is emphasis, which is why the threshold is 3.
  for (const word of ['บ้านนอก', 'คุณณัฐ', 'วรรณนา', 'สรรเสริญ', 'ธรรมะ']) {
    assert.equal(normalizeCustomerText(word), word, `${word} must be left alone`);
  }
});

test('"บ่" is read as negation only in unambiguous Isan collocations', () => {
  assert.equal(normalizeCustomerText('บ่มีโต๊ะว่างบ้อ'), 'ไม่มีโต๊ะว่างบ้อ');
  assert.equal(normalizeCustomerText('บ่ได้'), 'ไม่ได้');
  assert.equal(normalizeCustomerText('บ่ต้องจอง'), 'ไม่ต้องจอง');
  assert.equal(normalizeCustomerText('บ่เอาเผ็ด'), 'ไม่เอาเผ็ด');
  assert.equal(normalizeCustomerText('บ่ฮู้'), 'ไม่รู้');
  assert.equal(normalizeCustomerText('บ่สะดวกไปตอนเช้า'), 'ไม่สะดวกไปตอนเช้า');
  assert.equal(normalizeCustomerText('ที่พักบ่แพง'), 'ที่พักไม่แพง');
});

test('ordinary Thai words that merely start with "บ่" are never rewritten', () => {
  // This is the whole reason the negation map is a closed list rather than
  // a /บ่/ prefix rule: each of these would become nonsense.
  const untouched = [
    'มีบ่อปลาไหม',        // บ่อ  = pond
    'มาบ่อยไหม',          // บ่อย = often
    'ไปตอนบ่ายสองโมง',    // บ่าย = afternoon
    'บ่าวสาวมากี่คน',      // บ่าว = young man
    'บ่มมะม่วงไว้กี่วัน',   // บ่ม  = to ripen
    'ลูกค้าบ่นเรื่องที่จอดรถ', // บ่น  = to grumble
  ];
  for (const text of untouched) {
    assert.equal(normalizeCustomerText(text), text, `${text} must survive untouched`);
    assert.ok(!normalizeCustomerText(text).includes('ไม่'), `${text} must not gain a negation`);
  }
});

test('negation is never stripped off the verb it negates', () => {
  // "บ่แซบ" must not become "บ่อร่อย" (vocabulary applied first) or
  // "อร่อย" (negation lost) -- it means NOT tasty.
  assert.equal(normalizeCustomerText('ส้มตำบ่แซบ'), 'ส้มตำไม่อร่อย');
  assert.equal(normalizeCustomerText('บ่ม่วนเลย'), 'ไม่สนุกเลย');
  assert.equal(normalizeCustomerText('บ่อยากกินเผ็ด'), 'ไม่อยากกินเผ็ด');
  for (const text of ['ส้มตำบ่แซบ', 'บ่ม่วนเลย', 'บ่อยากกินเผ็ด']) {
    assert.ok(normalizeCustomerText(text).startsWith('ไม่') || normalizeCustomerText(text).includes('ไม่'));
  }
});

test('everyday Isan vocabulary reaches the parsers as standard Thai', () => {
  assert.equal(normalizeCustomerText('อยากเบิ่งเมนู'), 'อยากดูเมนู');
  assert.equal(normalizeCustomerText('ส้มตำแซ่บ'), 'ส้มตำอร่อย');
  assert.equal(normalizeCustomerText('ส้มตำแซบหลาย'), 'ส้มตำอร่อยหลาย');
  assert.equal(normalizeCustomerText('ขี่ม้าม่วนบ้อ'), 'ขี่ม้าสนุกบ้อ');
  assert.equal(normalizeCustomerText('อีหลีบ้อ'), 'จริงบ้อ');
  assert.equal(normalizeCustomerText('เฮ็ดจั่งใด'), 'ทำอย่างไร');
  assert.equal(normalizeCustomerText('ราคาเท่าใด๋'), 'ราคาเท่าไหร่');
  assert.equal(normalizeCustomerText('มีอิหยังกินบ้าง'), 'มีอะไรกินบ้าง');
});

test('politeness spellings normalize only at the end of the message', () => {
  assert.equal(normalizeCustomerText('ขอบคุณคร้าบ'), 'ขอบคุณครับ');
  assert.equal(normalizeCustomerText('ขอบคุณคับ'), 'ขอบคุณครับ');
  assert.equal(normalizeCustomerText('ขอบคุณคร้าบบบบ'), 'ขอบคุณครับ');
  assert.equal(normalizeCustomerText('สวัสดีค้าบ!'), 'สวัสดีครับ!');
});

test('a politeness lookalike in the middle of a sentence is left alone', () => {
  // These are the words an unanchored rule would destroy.
  assert.equal(normalizeCustomerText('เสื้อคับไปหน่อย'), 'เสื้อคับไปหน่อย');
  assert.equal(normalizeCustomerText('ค่าอาหารเท่าไหร่'), 'ค่าอาหารเท่าไหร่');
  assert.equal(normalizeCustomerText('ขอคะน้าผัดน้ำมันหอย'), 'ขอคะน้าผัดน้ำมันหอย');
});

test('a real Isan sentence survives end to end', () => {
  assert.equal(
    normalizeCustomerText('อยากเบิ่งเมนูครับ ส้มตำแซ่บบ่ บ่เอาเผ็ดหลายเด้อ'),
    'อยากดูเมนูครับ ส้มตำอร่อยบ่ ไม่เอาเผ็ดหลายเด้อ',
  );
  assert.equal(
    normalizeCustomerText('๒ คนไปตอนบ่ายได้บ่มีที่ว่างคร้าบ'),
    '2 คนไปตอนบ่ายได้ไม่มีที่ว่างครับ',
  );
});

test('normalization is idempotent', () => {
  for (const text of [
    'อยากเบิ่งเมนูครับ ส้มตำแซ่บบ่ บ่เอาเผ็ดหลายเด้อ',
    'มีโต๊ะว่างไหมมมม',
    'ไปตอนบ่ายสองโมง',
    'เสื้อคับไปหน่อย',
  ]) {
    const once = normalizeCustomerText(text);
    assert.equal(normalizeCustomerText(once), once, `re-normalizing ${text} must be a no-op`);
  }
});

test('normalization never empties a non-empty message', () => {
  for (const text of ['บ่', 'คับ', 'แซบ', '😋', 'a', '๑']) {
    assert.ok(normalizeCustomerText(text).length > 0, `${text} must not vanish`);
  }
});
