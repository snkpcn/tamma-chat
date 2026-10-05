// The 18 natural-language scenarios from the SNK MONEY spec, driven end to end:
// LINE group event -> authz -> interpreter -> real Postgres engine (PGlite running the production migration).
import assert from 'node:assert/strict';
import test from 'node:test';
import { A, ids } from './helpers/pf-pglite';
import { MEMBER, OWNER, STRANGER, assertPersona, harness, type Harness } from './helpers/pf-harness';

async function ready(opts: Parameters<typeof harness>[0] = {}): Promise<Harness> {
  const h = await harness(opts);
  const res = await h.activate();
  assert.match(res.reply ?? '', /ยืนยันกลุ่ม SNK MONEY เรียบร้อย/);
  return h;
}
const say = async (h: Harness, text: string, o: Parameters<Harness['say']>[1] = {}) => {
  const r = await h.say(text, o);
  assertPersona(r.reply);
  return r;
};

test('01 "บัญชีใช้จ่ายตอนนี้เหลือ 85,000" creates the pool and stores an owner-confirmed balance', async () => {
  const h = await ready();
  const r = await say(h, 'บัญชีใช้จ่ายตอนนี้เหลือ 85,000');
  assert.match(r.reply!, /85,000 บาท/);
  const a = await h.account('บัญชีใช้จ่าย');
  assert.equal(a?.balance_status, 'CONFIRMED');
  assert.equal(Number(a?.balance), 85000);
  assert.equal(await h.count('transactions', "status in ('CONFIRMED') and type in ('expense','income')"), 0);
});

test('02 "จ่ายประกัน 18500" without an account is parked, asks once, and "SCB" completes it', async () => {
  const h = await ready();
  await say(h, 'SCB ตอนนี้ 100000');
  await say(h, 'KBank ตอนนี้ 5000');
  const r1 = await say(h, 'จ่ายประกัน 18500');
  assert.match(r1.reply!, /ตัดจากบัญชีไหน/);
  assert.equal(await h.count('transactions', "status='PENDING_CLARIFICATION'"), 1);
  assert.equal(await h.balanceOf('SCB'), 100000, 'no balance moves before the account is known');
  const r2 = await say(h, 'SCB');
  assert.match(r2.reply!, /81,500 บาท/);
  assert.equal(await h.balanceOf('SCB'), 81500);
  assert.equal(await h.count('transactions', "status='PENDING_CLARIFICATION'"), 0);
});

test('03 "ได้เงินค่าเช่า 25000 เข้า SCB" records income against SCB', async () => {
  const h = await ready();
  await say(h, 'ปรับ SCB เหลือ 70000');
  const r = await say(h, 'ได้เงินค่าเช่า 25000 เข้า SCB');
  assert.match(r.reply!, /รับ .*25,000 บาท/);
  assert.equal(await h.balanceOf('SCB'), 95000);
  assert.equal(await h.count('transactions', "type='income' and amount=25000"), 1);
});

test('04 slip image: reads reliable fields only, never invents the purpose, dedupes, then records on answer', async () => {
  const slip = { document_type: 'transfer_slip', amount_total: 18500, document_date_local: '2026-10-04', merchant: 'บริษัท ประกัน จำกัด', reference_number: 'REF-001', bank: 'SCB', confidence: 0.95 };
  const h = await ready({ slips: { 'slip-1': slip, 'slip-blur': { ...slip, amount_total: 900, confidence: 0.3 }, 'slip-2': slip }, images: { 'slip-2': 'image-slip-1' } });
  await say(h, 'SCB ตอนนี้ 100000');

  const blurry = await h.image('slip-blur'); assertPersona(blurry.reply);
  assert.match(blurry.reply!, /ไม่ชัด/);
  assert.equal(await h.count('transactions', "type='expense'"), 0);

  const first = await h.image('slip-1'); assertPersona(first.reply);
  assert.match(first.reply!, /18,500 บาท/);
  assert.match(first.reply!, /ค่าอะไร/);
  assert.equal(await h.count('transactions', "type='expense'"), 0, 'nothing recorded until the owner states the purpose');

  const answer = await say(h, 'ค่าประกัน จาก SCB');
  assert.match(answer.reply!, /เรียบร้อย/);
  const tx = (await h.db.query<any>("select * from transactions where type='expense'")).rows[0];
  assert.equal(Number(tx.amount), 18500);
  assert.equal(tx.slip_ref, 'REF-001');
  assert.ok(tx.file_hash);
  assert.equal(await h.balanceOf('SCB'), 81500);

  const again = await h.image('slip-2'); assertPersona(again.reply);   // same bytes => same hash
  assert.match(again.reply!, /บันทึกไว้แล้ว/);
  assert.equal(await h.count('transactions', "type='expense'"), 1);
});

test('04b slip that matches a due obligation offers to close it instead of creating a duplicate expense', async () => {
  const slip = { document_type: 'transfer_slip', amount_total: 3000, document_date_local: '2026-10-05', merchant: 'การไฟฟ้า', reference_number: 'E1', bank: 'KBank', confidence: 0.9 };
  const h = await ready({ slips: { s1: slip } });
  await say(h, 'SCB ตอนนี้ 10000');
  await h.ledger.createRecurring({ title: 'ค่าไฟ', kind: 'EXPENSE', amount: 3000, frequency: 'MONTHLY', firstDue: '2026-10-07', actor: A, ...ids('o') });
  const r = await h.image('s1'); assertPersona(r.reply);
  assert.match(r.reply!, /ตรงกับรายการ “ค่าไฟ”/);
  const done = await say(h, 'ใช่ จาก SCB');
  assert.match(done.reply!, /ปิดรายการ “ค่าไฟ”/);
  assert.equal(await h.balanceOf('SCB'), 7000);
  assert.equal(await h.count('transactions', "type='expense'"), 1);
});

test('05 "จ่ายแล้ว" resolves the due item, asks the account if unknown, and advances the next due date', async () => {
  const h = await ready();
  await say(h, 'SCB ตอนนี้ 20000');
  await say(h, 'KBank ตอนนี้ 5000');
  await h.ledger.createRecurring({ title: 'ค่าไฟ', kind: 'EXPENSE', amount: 3000, frequency: 'MONTHLY', firstDue: '2026-10-05', actor: A, ...ids('o') });
  const r1 = await say(h, 'จ่ายแล้ว');
  assert.match(r1.reply!, /ตัดจากบัญชีไหน/);
  assert.equal(await h.count('transactions', "type='expense'"), 0, 'not closed until the account is known');
  const r2 = await say(h, 'SCB');
  assert.match(r2.reply!, /ปิดรายการ “ค่าไฟ”/);
  assert.match(r2.reply!, /งวดถัดไป 5 พ\.ย\./);
  assert.equal(await h.balanceOf('SCB'), 17000);
  const up = await h.ledger.listUpcoming('2026-10-05', '2026-11-30');
  assert.equal(up[0].due_date, '2026-11-05');
});

test('06 "ปรับ SCB เหลือ 70000" records an adjustment and never a fabricated expense', async () => {
  const h = await ready();
  await say(h, 'ปรับ SCB เหลือ 80000');
  const r = await say(h, 'ปรับ SCB เหลือ 70000');
  assert.match(r.reply!, /ปรับยอด/);
  assert.match(r.reply!, /ไม่ได้สร้างรายจ่าย/);
  assert.equal(await h.balanceOf('SCB'), 70000);
  assert.equal(await h.count('transactions', "type in ('expense','income')"), 0);
});

test('07 "เดือนนี้หมดไปเท่าไหร่" summarises recorded spending', async () => {
  const h = await ready();
  await say(h, 'SCB ตอนนี้ 100000');
  await say(h, 'จ่ายค่าน้ำมัน 1,200 จาก SCB');
  await say(h, 'กินข้าว 300 จาก SCB');
  await say(h, 'ได้เงินค่าเช่า 5000 เข้า SCB');
  const r = await say(h, 'เดือนนี้หมดไปเท่าไหร่');
  assert.match(r.reply!, /รายจ่าย 1,500 บาท/);
  assert.match(r.reply!, /รายรับ 5,000 บาท/);
  assert.match(r.reply!, /ไม่ใช่ยอดจากธนาคาร/);
});

test('08 "อาทิตย์หน้ามีอะไรต้องจ่าย" lists next week only', async () => {
  const h = await ready();
  await h.ledger.createRecurring({ title: 'ค่าเน็ต', kind: 'EXPENSE', amount: 599, frequency: 'MONTHLY', firstDue: '2026-10-14', actor: A, ...ids('o') });
  await h.ledger.createRecurring({ title: 'ภาษีที่ดิน', kind: 'EXPENSE', amount: 4000, frequency: 'ONE_TIME', firstDue: '2026-10-30', actor: A, ...ids('o') });
  const r = await say(h, 'อาทิตย์หน้ามีอะไรต้องจ่าย');
  assert.match(r.reply!, /ค่าเน็ต/);
  assert.doesNotMatch(r.reply!, /ภาษีที่ดิน/);
});

test('09 "เมื่อกี้ลงผิด ยกเลิกรายการล่าสุด" voids the latest record and restores the balance', async () => {
  const h = await ready();
  await say(h, 'SCB ตอนนี้ 50000');
  await say(h, 'จ่ายค่าอาหาร 700 จาก SCB');
  assert.equal(await h.balanceOf('SCB'), 49300);
  const r = await say(h, 'เมื่อกี้ลงผิด ยกเลิกรายการล่าสุด');
  assert.match(r.reply!, /ยกเลิกรายการ/);
  assert.equal(await h.balanceOf('SCB'), 50000);
  assert.equal(await h.count('transactions', "status='VOIDED'"), 1);
  assert.equal(await h.count('transactions'), 2, 'adjustment + voided expense: history is kept, nothing deleted');
});

test('10 "เปลี่ยนจากค่าอาหารเป็นค่าเดินทาง" relabels the latest record', async () => {
  const h = await ready();
  await say(h, 'SCB ตอนนี้ 50000');
  await say(h, 'กินข้าว 120 จาก SCB');
  const r = await say(h, 'เปลี่ยนจากค่าอาหารเป็นค่าเดินทาง');
  assert.match(r.reply!, /ค่าเดินทาง/);
  const tx = (await h.db.query<any>("select c.name from transactions t join transaction_categories c on c.id=t.category_id where t.type='expense'")).rows[0];
  assert.equal(tx.name, 'ค่าเดินทาง');
  assert.equal(await h.balanceOf('SCB'), 49880);
});

test('11 negation: "ไม่ได้จ่ายประกันนะ" records nothing', async () => {
  const h = await ready();
  await say(h, 'SCB ตอนนี้ 50000');
  const r = await say(h, 'ไม่ได้จ่ายประกันนะ');
  assert.match(r.reply!, /ไม่ได้บันทึก/);
  assert.equal(await h.count('transactions', "type='expense'"), 0);
  assert.equal(await h.balanceOf('SCB'), 50000);
});

test('12 negation: "ยังไม่จ่ายค่าไฟ" leaves the obligation due and untouched', async () => {
  const h = await ready();
  await h.ledger.createRecurring({ title: 'ค่าไฟ', kind: 'EXPENSE', amount: 3000, frequency: 'MONTHLY', firstDue: '2026-10-05', actor: A, ...ids('o') });
  await say(h, 'ยังไม่จ่ายค่าไฟ');
  assert.equal(await h.count('finance_obligation_payments'), 0);
  assert.equal(await h.count('transactions', "type='expense'"), 0);
  assert.equal((await h.ledger.listUpcoming('2026-10-05', '2026-10-31'))[0].due_date, '2026-10-05');
});

test('13 LINE webhook redelivery of the same message records once', async () => {
  const h = await ready();
  await say(h, 'SCB ตอนนี้ 10000');
  const a = await say(h, 'จ่ายค่าอาหาร 100 จาก SCB', { id: 'dup-1' });
  const b = await say(h, 'จ่ายค่าอาหาร 100 จาก SCB', { id: 'dup-1' });
  assert.equal(await h.count('transactions', "type='expense'"), 1);
  assert.equal(await h.balanceOf('SCB'), 9900);
  assert.equal(a.reply, b.reply);
});

test('14 unknown balance is reported as unknown, never as 0', async () => {
  const h = await ready();
  await say(h, 'เพิ่มบัญชี KBank');
  const r = await say(h, 'ยอด KBank เท่าไหร่');
  assert.match(r.reply!, /ยังไม่ทราบยอด/);
  assert.doesNotMatch(r.reply!, /\b0 บาท/);
  const spend = await say(h, 'จ่ายค่าอาหาร 100 จาก KBank');
  assert.match(spend.reply!, /ยังไม่มียอดที่คุณยืนยัน/);
  assert.equal(await h.balanceOf('KBank'), null);
});

test('15 recurring creation sets the cadence, default reminders and next due date', async () => {
  const h = await ready();
  const r = await say(h, 'ค่าเน็ต 599 ทุกวันที่ 5');
  assert.match(r.reply!, /ทุกเดือน/);
  assert.match(r.reply!, /7\/3\/1\/0/);
  const o = (await h.db.query<any>('select * from recurring_transactions')).rows[0];
  assert.equal(o.next_occurrence.toISOString?.().slice(0, 10) ?? String(o.next_occurrence).slice(0, 10), '2026-10-05');
  const again = await say(h, 'ค่าเน็ต 599 ทุกวันที่ 5');
  assert.match(again.reply!, /ไม่สร้างซ้ำ/);
  assert.equal(await h.count('recurring_transactions'), 1);
});

test('16 transfers between own accounts are not expenses', async () => {
  const h = await ready();
  await say(h, 'SCB ตอนนี้ 10000');
  await say(h, 'KBank ตอนนี้ 500');
  const r = await say(h, 'โอนจาก SCB ไป KBank 4000');
  assert.match(r.reply!, /ไม่นับเป็นรายจ่าย/);
  assert.equal(await h.balanceOf('SCB'), 6000);
  assert.equal(await h.balanceOf('KBank'), 4500);
});

test('17 unauthorized member gets no finance data and cannot change anything', async () => {
  const h = await ready();
  await say(h, 'SCB ตอนนี้ 77777');
  const r = await say(h, 'ยอดเหลือเท่าไหร่', { user: STRANGER });
  assert.doesNotMatch(r.reply ?? '', /77,777|SCB/);
  assert.match(r.reply!, /เจ้าของและผู้ที่ได้รับสิทธิ์/);
  const w = await say(h, 'ปรับ SCB เหลือ 1', { user: STRANGER });
  assert.doesNotMatch(w.reply ?? '', /77,777/);
  assert.equal(await h.balanceOf('SCB'), 77777);
  const chat = await say(h, 'สวัสดีครับทุกคน', { user: STRANGER });
  assert.equal(chat.reply, null, 'ordinary chat from others is ignored silently');
  assert.ok(await h.count('activity_log', "action='UNAUTHORIZED_ATTEMPT'") >= 2);
});

test('18 vague or low-confidence messages never mutate anything', async () => {
  const h = await ready();
  await say(h, 'SCB ตอนนี้ 10000');
  const before = await h.count('transactions');
  for (const t of ['จ่ายไปเยอะเลย', '18500', 'เงินหมดอีกแล้ว']) {
    const r = await say(h, t);
    assert.ok(r.reply === null || /ยังไม่ได้บันทึก|ขอรายละเอียด/.test(r.reply), `${t} -> ${r.reply}`);
  }
  assert.equal(await h.count('transactions'), before);
  assert.equal(await h.balanceOf('SCB'), 10000);
});

// ---------------------------------------------------------------- policy beyond the 18 cases

test('members can record and read but cannot set balances or rewrite history', async () => {
  const h = await ready();
  await say(h, 'SCB ตอนนี้ 10000');
  const spend = await say(h, 'จ่ายค่าอาหาร 100 จาก SCB', { user: MEMBER });
  assert.match(spend.reply!, /เรียบร้อย/);
  const read = await say(h, 'ยอดเหลือเท่าไหร่', { user: MEMBER });
  assert.match(read.reply!, /9,900 บาท/);
  const set = await say(h, 'ปรับ SCB เหลือ 5', { user: MEMBER });
  assert.match(set.reply!, /เจ้าของกลุ่มเป็นผู้ทำได้เท่านั้น/);
  const undo = await say(h, 'ยกเลิกรายการล่าสุด', { user: MEMBER });
  assert.match(undo.reply!, /เจ้าของกลุ่มเป็นผู้ทำได้เท่านั้น/);
  assert.equal(await h.balanceOf('SCB'), 9900);
});

test('model-proposed writes are capped at medium: one confirmation, and "ไม่" cancels', async () => {
  const llm = async () => ({ kind: 'EXPENSE', amount: 120, title: 'กาแฟ', account: 'SCB' });
  const h = await ready({ llm });
  await say(h, 'SCB ตอนนี้ 1000');
  const ask = await say(h, 'ซัดกาแฟไป 120 บาท');
  assert.match(ask.reply!, /ถูกต้องไหม/);
  assert.equal(await h.count('transactions', "type='expense'"), 0);
  const no = await say(h, 'ไม่');
  assert.match(no.reply!, /ไม่ได้บันทึก/);
  assert.equal(await h.count('transactions', "type='expense'"), 0);
  await say(h, 'ซัดกาแฟไป 120 บาท');
  const yes = await say(h, 'ยืนยัน');
  assert.match(yes.reply!, /เรียบร้อย/);
  assert.equal(await h.balanceOf('SCB'), 880);
});

test('a model that invents an amount is ignored', async () => {
  const h = await ready({ llm: async () => ({ kind: 'EXPENSE', amount: 5000, title: 'x' }) });
  const r = await say(h, 'ซัดกาแฟไป 120 บาท');
  assert.equal(await h.count('transactions', "type='expense'"), 0);
  assert.match(r.reply!, /ยังไม่ได้บันทึก|ขอรายละเอียด/);
});

test('very large amounts and drastic balance changes need explicit confirmation', async () => {
  const h = await ready();
  await say(h, 'SCB ตอนนี้ 50000');
  const big = await say(h, 'จ่ายค่าบ้าน 2000000 จาก SCB');
  assert.match(big.reply!, /ยืนยัน/);
  assert.equal(await h.count('transactions', "type='expense'"), 0);
  await say(h, 'ไม่');
  const drastic = await say(h, 'SCB ตอนนี้ 500');
  assert.match(drastic.reply!, /ต่างกันมาก/);
  assert.equal(await h.balanceOf('SCB'), 50000);
  await say(h, 'ยืนยัน');
  assert.equal(await h.balanceOf('SCB'), 500);
});

test('bulk wipe requests are refused; balance without an account asks which one', async () => {
  const h = await ready();
  const wipe = await say(h, 'ลบทั้งหมด');
  assert.match(wipe.reply!, /ไม่ได้ครับ/);
  const ask = await say(h, 'ตอนนี้เหลือ 50000');
  assert.match(ask.reply!, /บัญชีไหน/);
  assert.equal(await h.count('financial_accounts'), 0);
  await say(h, 'บัญชีออมทรัพย์');
  assert.equal(await h.balanceOf('บัญชีออมทรัพย์'), 50000);
});

test('correcting an amount reverses the original and keeps history', async () => {
  const h = await ready();
  await say(h, 'SCB ตอนนี้ 100000');
  await say(h, 'จ่ายประกัน 18500 จาก SCB');
  const r = await say(h, 'ไม่ใช่ 18500 เป็น 15800');
  assert.match(r.reply!, /15,800 บาท/);
  assert.equal(await h.balanceOf('SCB'), 84200);
  assert.equal(await h.count('transactions', "status='REVERSED'"), 1);
});

test('a database failure is reported honestly and never as success', async () => {
  const h = await ready();
  const real = h.deps.rpc;
  h.deps.rpc = async (fn, args) => { if (fn === 'finance_record_transaction') throw new Error('db down'); return real(fn, args); };
  const r = await say(h, 'จ่ายค่าอาหาร 100 จาก SCB');
  assert.match(r.reply!, /บันทึกไม่สำเร็จ/);
  assert.doesNotMatch(r.reply!, /เรียบร้อย/);
});
