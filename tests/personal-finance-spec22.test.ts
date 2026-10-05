// The owner's 18 acceptance cases (spec §22), in the owner's exact words, plus the other phrases the
// spec gives (§8 continuity/negation, §11 setup, §12 reminder tuning, §16 corrections, §23 binding).
import assert from 'node:assert/strict';
import test from 'node:test';
import { A, ids } from './helpers/pf-pglite';
import { MEMBER, NOW, OWNER, STRANGER, assertPersona, harness, type Harness } from './helpers/pf-harness';
import { runPersonalFinanceReminders } from '../netlify/functions/_personal-finance-reminders';

async function ready(opts: Parameters<typeof harness>[0] = {}): Promise<Harness> {
  const h = await harness(opts);
  await h.activate();
  return h;
}
const say = async (h: Harness, text: string, o: Parameters<Harness['say']>[1] = {}) => {
  const r = await h.say(text, o);
  assertPersona(r.reply);
  return r;
};

test('cases 1-5: confirm 100000 -> insurance -> webhook retry -> rent income -> correction (one ledger story)', async () => {
  const h = await ready();
  // 1
  await say(h, 'SCB เหลือ 100000');
  const scb = await h.account('SCB');
  assert.equal(scb?.balance_status, 'CONFIRMED');
  assert.equal(Number(scb?.balance), 100000);
  // 2
  const exp = await say(h, 'จ่ายค่าประกัน 18500 จาก SCB', { id: 'line-evt-1' });
  assert.match(exp.reply!, /81,500 บาท/);
  assert.equal(await h.balanceOf('SCB'), 81500);
  // 3: LINE retries the very same event
  await say(h, 'จ่ายค่าประกัน 18500 จาก SCB', { id: 'line-evt-1' });
  assert.equal(await h.count('transactions', "type='expense'"), 1);
  assert.equal(await h.balanceOf('SCB'), 81500);
  // 4
  await say(h, 'ได้เงินค่าเช่า 25000 เข้า SCB');
  assert.equal(await h.balanceOf('SCB'), 106500);
  // 5
  const fix = await say(h, 'เมื่อกี้ 25000 ผิด เป็น 24000');
  assert.match(fix.reply!, /24,000 บาท/);
  assert.equal(await h.balanceOf('SCB'), 105500);
  assert.equal(await h.count('transactions', "status='REVERSED'"), 1);
  assert.ok(await h.count('activity_log', "action='TRANSACTION_EDITED'") >= 1);
});

test('case 6: "ยังไม่จ่ายค่ารถนะ" creates no expense', async () => {
  const h = await ready();
  await say(h, 'SCB เหลือ 100000');
  await say(h, 'ยังไม่จ่ายค่ารถนะ');
  assert.equal(await h.count('transactions', "type='expense'"), 0);
  assert.equal(await h.balanceOf('SCB'), 100000);
});

test('cases 7+9: future obligation, then "จ่ายแล้ว" resolves it and asks the account when unknown', async () => {
  const h = await ready();
  await say(h, 'SCB เหลือ 100000');
  await say(h, 'KBank เหลือ 5000');
  const made = await say(h, 'เดือนหน้าวันที่ 15 ต้องจ่ายรถ 35000');
  assert.match(made.reply!, /35,000 บาท/);
  const o = (await h.db.query<any>('select * from recurring_transactions')).rows[0];
  assert.equal(String(o.next_occurrence.toISOString?.() ?? o.next_occurrence).slice(0, 10), '2026-11-15');
  assert.equal(await h.balanceOf('SCB'), 100000, 'a future obligation is not an expense yet');
  // bring it due, as the reminder would have
  await h.db.query("update recurring_transactions set next_occurrence='2026-10-05' where id=$1", [o.id]);
  const ask = await say(h, 'จ่ายแล้ว');
  assert.match(ask.reply!, /ตัดจากบัญชีไหน/);
  assert.equal(await h.balanceOf('SCB'), 100000);
  const done = await say(h, 'scb');
  assert.match(done.reply!, /ปิดรายการ/);
  assert.match(done.reply!, /65,000 บาท/);
  assert.equal(await h.balanceOf('SCB'), 65000);
  assert.equal(await h.count('finance_obligation_payments'), 1);
});

test('case 8: a due reminder reaches only the verified SNK MONEY group', async () => {
  const h = await ready();
  await h.ledger.createRecurring({ title: 'ค่างวดรถ', kind: 'EXPENSE', amount: 35000, frequency: 'MONTHLY', firstDue: '2026-10-06', actor: A, ...ids('o') });
  const pushed: string[] = [];
  const out = await runPersonalFinanceReminders({
    rpc: h.deps.rpc, now: () => NOW, enabled: true, hash: h.deps.hash,
    decrypt: v => v.slice(4), push: async to => { pushed.push(to); },
  });
  assert.equal(out.sent, 1);
  assert.deepEqual(pushed, ['C_snk_money_group_0000000000000001']);
});

test('case 10: "ปรับ SCB เหลือ 70000" is an ADJUSTMENT, never a faked expense', async () => {
  const h = await ready();
  await say(h, 'SCB เหลือ 100000');
  await say(h, 'ปรับ SCB เหลือ 70000');
  assert.equal(await h.balanceOf('SCB'), 70000);
  assert.equal(await h.count('transactions', "type='adjustment'"), 2);
  assert.equal(await h.count('transactions', "type='expense'"), 0);
  const adj = (await h.db.query<any>("select * from activity_log where action='BALANCE_ADJUSTED'")).rows[0];
  assert.equal(adj.metadata.before.balance, 100000);
  assert.equal(adj.metadata.after.balance, 70000);
  assert.equal(adj.metadata.meta.reason, 'OWNER_RECONCILIATION');
  assert.equal(adj.metadata.meta.previous_balance, 100000);
  assert.equal(adj.metadata.meta.new_balance, 70000);
});

test('case 11: the same slip twice never double-debits', async () => {
  const slip = { document_type: 'transfer_slip', amount_total: 25000, document_date_local: '2026-10-04', merchant: 'สมชาย', reference_number: 'R9', bank: 'KBank', confidence: 0.9 };
  const h = await ready({ slips: { a: slip, b: slip }, images: { b: 'image-a' } });
  await say(h, 'SCB เหลือ 100000');
  const first = await h.image('a');
  assert.match(first.reply!, /เป็นค่าอะไร/, 'purpose is asked, not invented');
  await say(h, 'ค่าก่อสร้าง จาก SCB');
  assert.equal(await h.balanceOf('SCB'), 75000);
  const second = await h.image('b');
  assert.match(second.reply!, /บันทึกไว้แล้ว/);
  assert.equal(await h.balanceOf('SCB'), 75000);
  assert.equal(await h.count('transactions', "type='expense'"), 1);
});

test('cases 12-13: this-month spend and next-week obligations come from the structured DB', async () => {
  const h = await ready();
  await say(h, 'SCB เหลือ 100000');
  await say(h, 'จ่ายค่าอาหาร 400 จาก SCB');
  const spent = await say(h, 'เดือนนี้หมดไปเท่าไหร่');
  assert.match(spent.reply!, /รายจ่าย 400 บาท/);
  await h.ledger.createRecurring({ title: 'ค่าเน็ต', kind: 'EXPENSE', amount: 599, frequency: 'MONTHLY', firstDue: '2026-10-14', actor: A, ...ids('o') });
  assert.match((await say(h, 'อาทิตย์หน้ามีอะไรต้องจ่าย')).reply!, /ค่าเน็ต.*599/);
});

test('cases 14-15: unauthorized member learns nothing and changes nothing', async () => {
  const h = await ready();
  await say(h, 'SCB เหลือ 100000');
  const ask = await say(h, 'ตอนนี้มีเงินเท่าไหร่', { user: STRANGER });
  assert.doesNotMatch(ask.reply ?? '', /100,000|SCB/);
  const debit = await say(h, 'หัก SCB 10000', { user: STRANGER });
  assert.doesNotMatch(debit.reply ?? '', /100,000|90,000/);
  assert.equal(await h.balanceOf('SCB'), 100000);
  assert.equal(await h.count('transactions', "type='expense'"), 0);
  // the same words from the owner do work
  const owner = await say(h, 'หัก SCB 10000');
  assert.match(owner.reply!, /90,000 บาท/);
});

test('case 16: "ไม่ใช่ SCB เมื่อกี้จ่ายเงินสด" moves the last payment to cash and restores SCB', async () => {
  const h = await ready();
  await say(h, 'SCB เหลือ 100000');
  await say(h, 'เงินสด เหลือ 5000');
  await say(h, 'จ่ายค่าอาหาร 500 จาก SCB');
  assert.equal(await h.balanceOf('SCB'), 99500);
  const r = await say(h, 'ไม่ใช่ SCB เมื่อกี้จ่ายเงินสด');
  assert.match(r.reply!, /เงินสด/);
  assert.equal(await h.balanceOf('SCB'), 100000);
  assert.equal(await h.balanceOf('เงินสด'), 4500);
  const alt = await say(h, 'ไม่ได้จ่ายจาก เงินสด จ่ายจาก SCB');
  assert.match(alt.reply!, /SCB/);
  assert.equal(await h.balanceOf('SCB'), 99500);
  assert.equal(await h.balanceOf('เงินสด'), 5000);
});

test('case 17: "ลบรายการทั้งหมดเดือนนี้" needs explicit confirmation; "ไม่" cancels; only "ยืนยัน" executes', async () => {
  const h = await ready();
  await say(h, 'SCB เหลือ 100000');
  await say(h, 'จ่ายค่าอาหาร 100 จาก SCB');
  await say(h, 'จ่ายค่าอาหาร 200 จาก SCB');
  const ask = await say(h, 'ลบรายการทั้งหมดเดือนนี้');
  assert.match(ask.reply!, /ยกเลิก 2 รายการ/);
  assert.match(ask.reply!, /ยืนยัน/);
  assert.equal(await h.count('transactions', "status='VOIDED'"), 0);
  await say(h, 'ไม่');
  assert.equal(await h.count('transactions', "status='VOIDED'"), 0);
  await say(h, 'ลบรายการทั้งหมดเดือนนี้');
  await say(h, 'ok');   // casual words never confirm a bulk action
  assert.equal(await h.count('transactions', "status='VOIDED'"), 0);
  await say(h, 'ลบรายการทั้งหมดเดือนนี้');
  const done = await say(h, 'ยืนยัน');
  assert.match(done.reply!, /ยกเลิก 2 รายการ/);
  assert.equal(await h.count('transactions', "status='VOIDED'"), 2);
  assert.equal(await h.balanceOf('SCB'), 100000);
});

test('case 18: an account with no confirmed balance is UNKNOWN, not 0', async () => {
  const h = await ready();
  await say(h, 'เพิ่มบัญชี Krungsri');
  const r = await say(h, 'ยอด Krungsri เท่าไหร่');
  assert.match(r.reply!, /ยังไม่ทราบยอด/);
  const a = await h.account('Krungsri');
  assert.equal(a?.balance, null);
  assert.equal(a?.balance_status, 'UNKNOWN');
});

// ---------------------------------------------------------------- other phrases the spec gives

test('§8 continuity: "จ่ายค่ารถ 35000" -> "หักจากบัญชีไหนครับ" -> "scb" finishes the SAME pending transaction', async () => {
  const h = await ready();
  await say(h, 'SCB เหลือ 100000');
  await say(h, 'KBank เหลือ 5000');
  const ask = await say(h, 'จ่ายค่ารถ 35000');
  assert.match(ask.reply!, /ตัดจากบัญชีไหน/);
  await say(h, 'scb');
  assert.equal(await h.balanceOf('SCB'), 65000);
  assert.equal(await h.count('transactions', "type='expense'"), 1);
});

test('§8 no needless question: with exactly one account the answer is known', async () => {
  const h = await ready();
  await say(h, 'บัญชีใช้จ่ายตอนนี้เหลือ 100000');
  const r = await say(h, 'จ่ายประกัน 18500');
  assert.doesNotMatch(r.reply!, /ตัดจากบัญชีไหน|ให้หัก/);
  assert.match(r.reply!, /81,500 บาท/);
  assert.match(r.reply!, /บัญชีใช้จ่าย/);
});

test('§8 reclassify: "เมื่อกี้ไม่ใช่ค่ารถ เป็นค่าประกัน"', async () => {
  const h = await ready();
  await say(h, 'SCB เหลือ 100000');
  await say(h, 'จ่ายค่ารถ 500 จาก SCB');
  await say(h, 'เมื่อกี้ไม่ใช่ค่ารถ เป็นค่าประกัน');
  const c = (await h.db.query<any>("select c.name from transactions t join transaction_categories c on c.id=t.category_id where t.type='expense'")).rows[0];
  assert.equal(c.name, 'ค่าประกัน');
  assert.equal(await h.balanceOf('SCB'), 99500);
});

test('§8 negations: "ไม่ต้องหัก", "เอาไว้ก่อน", "อันนี้ไม่ใช่รายจ่าย" never finalize anything', async () => {
  const h = await ready();
  await say(h, 'SCB เหลือ 100000');
  for (const t of ['ไม่ต้องหัก SCB 500', 'เอาไว้ก่อน', 'อันนี้ไม่ใช่รายจ่าย 500', 'ยังไม่จ่าย']) await say(h, t);
  assert.equal(await h.count('transactions', "type in ('expense','income')"), 0);
  assert.equal(await h.balanceOf('SCB'), 100000);
});

test('§11 initial setup of several accounts in one message', async () => {
  const h = await ready();
  const r = await say(h, 'ตั้งยอดเริ่มต้น\nSCB 120000\nKBank 45000\nเงินสด 12000');
  assert.match(r.reply!, /SCB: 120,000 บาท/);
  assert.match(r.reply!, /รวม 177,000 บาท/);
  assert.equal(await h.balanceOf('SCB'), 120000);
  assert.equal(await h.balanceOf('KBank'), 45000);
  assert.equal(await h.balanceOf('เงินสด'), 12000);
  const again = await say(h, 'SCB ตอนนี้เหลือ 92,430');
  assert.match(again.reply!, /ปรับยอด/);
  const adj = (await h.db.query<any>("select * from activity_log where action='BALANCE_ADJUSTED' and entity_type='account'")).rows[0];
  assert.equal(adj.metadata.meta.delta, -27570);
});

test('§12 reminder tuning: per-bill days, silence, reschedule, morning', async () => {
  const h = await ready();
  await say(h, 'SCB เหลือ 100000');
  await h.ledger.createRecurring({ title: 'ค่างวด', kind: 'EXPENSE', amount: 12000, frequency: 'MONTHLY', firstDue: '2026-10-15', actor: A, ...ids('o') });
  await h.ledger.createRecurring({ title: 'ค่าประกัน', kind: 'EXPENSE', amount: 18500, frequency: 'YEARLY', firstDue: '2026-10-18', actor: A, ...ids('o') });
  await say(h, 'ค่างวดนี้เตือนก่อน 3 วันก็พอ');
  assert.deepEqual((await h.db.query<any>("select reminder_days from recurring_transactions where title='ค่างวด'")).rows[0].reminder_days, [3]);
  await say(h, 'ไม่ต้องเตือนค่าประกันอีก');
  assert.deepEqual((await h.db.query<any>("select reminder_days from recurring_transactions where title='ค่าประกัน'")).rows[0].reminder_days, []);
  assert.equal((await h.ledger.claimReminders('2026-10-18')).filter(r => r.title === 'ค่าประกัน').length, 0, 'silenced bills never remind');
  await say(h, 'เลื่อนค่างวดไปวันที่ 20');
  assert.equal(String((await h.db.query<any>("select next_occurrence from recurring_transactions where title='ค่างวด'")).rows[0].next_occurrence.toISOString?.()).slice(0, 10), '2026-10-20');
  assert.match((await say(h, 'เตือนตอนเช้า')).reply!, /08:00/);
  const ambiguous = await say(h, 'ไม่ต้องเตือนอันนี้อีก');
  assert.match(ambiguous.reply!, /ไม่แน่ใจ|หมายถึงรายการไหน|ไม่เตือน/);
});

test('§16 corrections: "จำนวนผิด เป็น 8,900" and "เมื่อวานไม่ใช่วันนี้"', async () => {
  const h = await ready();
  await say(h, 'SCB เหลือ 100000');
  await say(h, 'จ่ายค่าอาหาร 9800 จาก SCB');
  await say(h, 'จำนวนผิด เป็น 8,900');
  assert.equal(await h.balanceOf('SCB'), 91100);
  await say(h, 'เมื่อวานไม่ใช่วันนี้');
  const live = (await h.db.query<any>("select occurred_on from transactions where type='expense' and status='CONFIRMED'")).rows;
  assert.equal(live.length, 1);
  assert.equal(String(live[0].occurred_on.toISOString?.() ?? live[0].occurred_on).slice(0, 10), '2026-10-04');
  assert.equal(await h.balanceOf('SCB'), 91100);
});

test('§5 members: configured finance member can record, cannot bulk-delete or re-balance', async () => {
  const h = await ready();
  await say(h, 'SCB เหลือ 100000');
  assert.match((await say(h, 'จ่ายค่าอาหาร 100 จาก SCB', { user: MEMBER })).reply!, /เรียบร้อย/);
  assert.match((await say(h, 'ลบรายการทั้งหมดเดือนนี้', { user: MEMBER })).reply!, /เจ้าของกลุ่ม/);
  assert.match((await say(h, 'ตั้งยอดเริ่มต้น SCB 1 KBank 2', { user: MEMBER })).reply!, /เจ้าของกลุ่ม/);
  assert.equal(await h.balanceOf('SCB'), 99900);
});
