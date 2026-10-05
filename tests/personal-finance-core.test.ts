import assert from 'node:assert/strict';
import test from 'node:test';
import {
  amountAppearsIn, bangkokToday, describeBalance, extractAmount, finalizeReply, findAmounts, isNegated, isNo, isYes,
  knownAccountFromText, money, monthEnd, nextDayOfMonth, pfEnabled, pfRoleFor, resolveAccount, weekRange, guessCategory, normalizeText,
  type PfAccount,
} from '../netlify/functions/_personal-finance-core';

const acc = (name: string, balance: number | null = null): PfAccount => ({
  id: name, name, balance, balance_status: balance === null ? 'UNKNOWN' : 'CONFIRMED',
});

test('amounts: Thai/commas/units are parsed; dates, counts and durations are not money', () => {
  assert.equal(extractAmount('เหลือ 85,000'), 85000);
  assert.equal(extractAmount('จ่ายประกัน 18500 บาท'), 18500);
  assert.equal(extractAmount('ได้ ๒๕๐๐๐ บาท'), 25000);
  assert.equal(extractAmount('2 หมื่น'), 20000);
  assert.equal(extractAmount('ค่าเน็ต 599 ทุกวันที่ 5'), 599);
  assert.deepEqual(findAmounts('ผ่อนรถ 12000 ทุกเดือนวันที่ 25 อีก 24 งวด').map(a => a.value), [12000]);
  assert.deepEqual(findAmounts('ทุก 10 วัน 500').map(a => a.value), [500]);
  assert.deepEqual(findAmounts('นัด 25/10 เวลา 10:30'), []);
  assert.equal(extractAmount('จ่ายไปเยอะเลย'), null);
  assert.deepEqual(findAmounts('SCB 120000 KBank 45000').map(a => a.value), [120000, 45000], 'the K of KBank is not a thousands unit');
  assert.equal(extractAmount('5k'), 5000);
  assert.ok(amountAppearsIn('จ่าย 1,200 บาท', 1200));
  assert.ok(!amountAppearsIn('จ่าย 1,200 บาท', 1300));
});

test('negation is detected without catching ordinary payment statements', () => {
  for (const t of ['ไม่ได้จ่ายประกันนะ', 'ยังไม่จ่ายค่าไฟ', 'ยังไม่ได้โอน', 'อย่าลงนะ', 'ไม่ต้องบันทึก']) assert.ok(isNegated(t), t);
  for (const t of ['จ่ายประกัน 18500', 'จ่ายแล้ว', 'ได้เงิน 500']) assert.ok(!isNegated(t), t);
  assert.ok(isYes('ยืนยัน') && isYes('ใช่ครับ') && !isYes('ไม่'));
  assert.ok(!isYes('ครับ') && !isYes('ได้') && !isYes('555'), 'filler words must never confirm a pending write');
  assert.ok(isNo('ไม่') && isNo('ยกเลิกครับ') && !isNo('ใช่'));
});

test('roles fail closed: no configured ids means nobody is owner', () => {
  assert.equal(pfRoleFor('U1', {}), 'UNAUTHORIZED_MEMBER');
  assert.equal(pfRoleFor('U1', { PF_OWNER_LINE_USER_IDS: 'U1, U2' }), 'OWNER');
  assert.equal(pfRoleFor('U3', { PF_OWNER_LINE_USER_IDS: 'U1', PF_FINANCE_MEMBER_LINE_USER_IDS: 'U3' }), 'AUTHORIZED_FINANCE_MEMBER');
  assert.equal(pfRoleFor(null, { PF_OWNER_LINE_USER_IDS: 'U1' }), 'UNAUTHORIZED_MEMBER');
  assert.equal(pfEnabled({}), false);
  assert.equal(pfEnabled({ SNK_MONEY_ENABLED: '0' }), false);
  assert.equal(pfEnabled({ SNK_MONEY_ENABLED: '1' }), true);
});

test('Bangkok dates and calendar helpers', () => {
  assert.equal(bangkokToday(new Date('2026-10-05T18:30:00Z')), '2026-10-06');
  assert.equal(nextDayOfMonth('2026-10-05', 5), '2026-10-05');
  assert.equal(nextDayOfMonth('2026-10-05', 4), '2026-11-04');
  assert.equal(nextDayOfMonth('2026-01-31', 31, true), '2026-02-28');
  assert.equal(monthEnd('2026-02-10'), '2026-02-28');
  assert.deepEqual(weekRange('2026-10-07'), { from: '2026-10-05', to: '2026-10-11' });
});

test('account resolution: exact, bank aliases, ambiguity and unknown', () => {
  const list = [acc('SCB'), acc('KBank'), acc('บัญชีใช้จ่าย'), acc('SCB ออมทรัพย์')];
  assert.equal((resolveAccount('กสิกร', list) as any).account.name, 'KBank');
  assert.equal(resolveAccount('scb', list).kind, 'one');
  assert.equal(resolveAccount('ไทยพาณิชย์', list).kind, 'one');
  assert.equal(resolveAccount('บัญชีใช้จ่าย', list).kind, 'one');
  assert.equal(resolveAccount('กรุงไทย', list).kind, 'none');
  assert.equal(resolveAccount('SCB', [acc('SCB เงินเดือน'), acc('SCB ออมทรัพย์')]).kind, 'ambiguous');
  assert.equal(knownAccountFromText('เข้า K+')?.name, 'KBank');
  assert.equal(knownAccountFromText('จ่ายค่าไฟ'), null);
});

test('categories, money and balance wording never present unknown as zero', () => {
  assert.equal(guessCategory('จ่ายประกันรถ'), 'ประกัน');
  assert.equal(guessCategory('เติมน้ำมัน'), 'ค่าน้ำมัน');
  assert.equal(money(85000), '85,000 บาท');
  assert.equal(money(null), 'ไม่ทราบ');
  assert.match(describeBalance(acc('KBank')), /ยังไม่ทราบยอด/);
  assert.doesNotMatch(describeBalance(acc('KBank')), /\b0 บาท/);
  assert.match(describeBalance(acc('SCB', 70000)), /70,000 บาท/);
  assert.equal(normalizeText('  ๑๒๓   ก '), '123 ก');
});

test('persona: never feminine particles, always closes with ครับ', () => {
  assert.equal(finalizeReply('เรียบร้อยค่ะ'), 'เรียบร้อยครับ');
  assert.equal(finalizeReply('ได้เลยนะคะ'), 'ได้เลยนะครับ');
  assert.equal(finalizeReply('บันทึกแล้ว'), 'บันทึกแล้วครับ');
  assert.equal(finalizeReply('บันทึกแล้วครับ'), 'บันทึกแล้วครับ');
});
