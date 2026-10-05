import assert from 'node:assert/strict';
import test from 'node:test';
import { A, OWNER_ID, freshDb, ids } from './helpers/pf-pglite';

async function setup() {
  const { db, ledger, rpc } = await freshDb();
  const scb = (await ledger.createAccount({ name: 'SCB', kind: 'BANK', actor: A, ...ids('a') })).account;
  const kbank = (await ledger.createAccount({ name: 'KBank', kind: 'BANK', actor: A, ...ids('a') })).account;
  return { db, ledger, rpc, scb, kbank };
}
const bal = async (ledger: any, id: string) => (await ledger.getBalance(id)) as { balance: number | null; balance_status: string };

test('a new account is UNKNOWN and carries no number (unknown is not zero)', async () => {
  const { ledger, scb } = await setup();
  const b = await bal(ledger, scb.id);
  assert.equal(b.balance_status, 'UNKNOWN');
  assert.equal(b.balance, null);
});

test('owner-confirmed balance is CONFIRMED and expense/income derive from it', async () => {
  const { ledger, scb } = await setup();
  await ledger.setOwnerBalance({ accountId: scb.id, amount: 85000, actor: A, ...ids('b') });
  assert.deepEqual(await bal(ledger, scb.id).then(b => [Number(b.balance), b.balance_status]), [85000, 'CONFIRMED']);
  await ledger.createTransaction({ kind: 'EXPENSE', amount: 18500, accountId: scb.id, category: 'ประกัน', actor: A, ...ids('t') });
  assert.deepEqual(await bal(ledger, scb.id).then(b => [Number(b.balance), b.balance_status]), [66500, 'DERIVED']);
  await ledger.createTransaction({ kind: 'INCOME', amount: 25000, accountId: scb.id, category: 'ค่าเช่า', actor: A, ...ids('t') });
  assert.equal(Number((await bal(ledger, scb.id)).balance), 91500);
});

test('transactions on an UNKNOWN account never invent a balance', async () => {
  const { ledger, scb } = await setup();
  const res = await ledger.createTransaction({ kind: 'EXPENSE', amount: 500, accountId: scb.id, actor: A, ...ids('t') });
  assert.equal(res.transaction.status, 'CONFIRMED');
  const b = await bal(ledger, scb.id);
  assert.equal(b.balance, null);
  assert.equal(b.balance_status, 'UNKNOWN');
});

test('owner restating a balance records an ADJUSTMENT, never a fabricated expense or income', async () => {
  const { ledger, scb } = await setup();
  await ledger.setOwnerBalance({ accountId: scb.id, amount: 80000, actor: A, ...ids('b') });
  const res = await ledger.setOwnerBalance({ accountId: scb.id, amount: 70000, actor: A, ...ids('b') });
  assert.equal(Number(res.delta), -10000);
  const recent = await ledger.getRecentTransactions(10);
  assert.ok(recent.every(t => t.kind === 'ADJUSTMENT'), 'only adjustments exist');
  const summary = await ledger.getSummary('2000-01-01', '2999-12-31');
  assert.equal(Number(summary.expense), 0);
  assert.equal(Number(summary.income), 0);
});

test('expense without an account is PENDING_CLARIFICATION and touches no balance until assigned', async () => {
  const { ledger, scb } = await setup();
  await ledger.setOwnerBalance({ accountId: scb.id, amount: 50000, actor: A, ...ids('b') });
  const res = await ledger.createTransaction({ kind: 'EXPENSE', amount: 18500, accountId: null, category: 'ประกัน', actor: A, ...ids('t') });
  assert.equal(res.transaction.status, 'PENDING_CLARIFICATION');
  assert.equal(Number((await bal(ledger, scb.id)).balance), 50000);
  const assigned = await ledger.assignAccount({ txId: res.transaction.id, accountId: scb.id, actor: A, ...ids('x') });
  assert.equal(assigned.ok, true);
  assert.equal(Number((await bal(ledger, scb.id)).balance), 31500);
  assert.equal((await ledger.assignAccount({ txId: res.transaction.id, accountId: scb.id, actor: A, ...ids('x') })).ok, false);
});

test('transfer moves money between accounts without counting as expense', async () => {
  const { ledger, scb, kbank } = await setup();
  await ledger.setOwnerBalance({ accountId: scb.id, amount: 10000, actor: A, ...ids('b') });
  await ledger.setOwnerBalance({ accountId: kbank.id, amount: 1000, actor: A, ...ids('b') });
  await ledger.createTransaction({ kind: 'TRANSFER', amount: 4000, accountId: scb.id, toAccountId: kbank.id, actor: A, ...ids('t') });
  assert.equal(Number((await bal(ledger, scb.id)).balance), 6000);
  assert.equal(Number((await bal(ledger, kbank.id)).balance), 5000);
  assert.equal(Number((await ledger.getSummary('2000-01-01', '2999-12-31')).expense), 0);
  await assert.rejects(() => ledger.createTransaction({ kind: 'TRANSFER', amount: 1, accountId: scb.id, toAccountId: scb.id, actor: A, ...ids('t') }));
});

test('webhook retry with the same idempotency key records exactly once', async () => {
  const { ledger, scb } = await setup();
  await ledger.setOwnerBalance({ accountId: scb.id, amount: 1000, actor: A, ...ids('b') });
  const same = ids('retry');
  const args = { kind: 'EXPENSE' as const, amount: 100, accountId: scb.id, actor: A, ...same };
  const [r1, r2, r3] = await Promise.all([ledger.createTransaction(args), ledger.createTransaction(args), ledger.createTransaction(args)]);
  assert.equal(r1.transaction.id, r2.transaction.id);
  assert.equal(r2.transaction.id, r3.transaction.id);
  assert.equal(Number((await bal(ledger, scb.id)).balance), 900);
  assert.equal((await ledger.getRecentTransactions(20)).filter(t => t.kind === 'EXPENSE').length, 1);
});

test('void restores the balance, keeps history, and cannot be repeated', async () => {
  const { ledger, scb } = await setup();
  await ledger.setOwnerBalance({ accountId: scb.id, amount: 1000, actor: A, ...ids('b') });
  const tx = (await ledger.createTransaction({ kind: 'EXPENSE', amount: 300, accountId: scb.id, actor: A, ...ids('t') })).transaction;
  const v = await ledger.voidTransaction({ txId: tx.id, reason: 'oops', actor: A, ...ids('v') });
  assert.equal(v.ok, true);
  assert.equal(Number((await bal(ledger, scb.id)).balance), 1000);
  assert.equal((await ledger.voidTransaction({ txId: tx.id, reason: 'again', actor: A, ...ids('v') })).ok, false);
  assert.equal((await ledger.getRecentTransactions(10)).some(t => t.id === tx.id), false, 'voided hidden from recent');
});

test('voiding a movement that predates a later confirmed balance does not disturb that balance', async () => {
  const { ledger, scb } = await setup();
  await ledger.setOwnerBalance({ accountId: scb.id, amount: 1000, actor: A, ...ids('b') });
  const tx = (await ledger.createTransaction({ kind: 'EXPENSE', amount: 300, accountId: scb.id, actor: A, ...ids('t') })).transaction;
  await ledger.setOwnerBalance({ accountId: scb.id, amount: 650, actor: A, ...ids('b') });
  const v = await ledger.voidTransaction({ txId: tx.id, reason: 'x', actor: A, ...ids('v') });
  assert.equal(v.reversal.account_reversed, false);
  assert.equal(Number((await bal(ledger, scb.id)).balance), 650);
});

test('correction reverses the original, posts the replacement and links both', async () => {
  const { ledger, scb } = await setup();
  await ledger.setOwnerBalance({ accountId: scb.id, amount: 100000, actor: A, ...ids('b') });
  const tx = (await ledger.createTransaction({ kind: 'EXPENSE', amount: 18500, accountId: scb.id, category: 'ประกัน', actor: A, ...ids('t') })).transaction;
  const fix = await ledger.correctTransaction({ txId: tx.id, amount: 15800, actor: A, ...ids('c') });
  assert.equal(fix.ok, true);
  assert.equal(Number((await bal(ledger, scb.id)).balance), 84200);
  assert.equal(fix.original.status, 'REVERSED');
  assert.equal(fix.original.replaced_by_id, fix.transaction.id);
  assert.equal(fix.transaction.category, 'ประกัน');
});

test('category change is an audited in-place relabel with no balance effect', async () => {
  const { ledger, scb } = await setup();
  await ledger.setOwnerBalance({ accountId: scb.id, amount: 1000, actor: A, ...ids('b') });
  const tx = (await ledger.createTransaction({ kind: 'EXPENSE', amount: 100, accountId: scb.id, category: 'ค่าอาหาร', actor: A, ...ids('t') })).transaction;
  const res = await ledger.updateTransactionMeta({ txId: tx.id, category: 'ค่าเดินทาง', actor: A, ...ids('m') });
  assert.equal(res.transaction.category, 'ค่าเดินทาง');
  assert.equal(Number((await bal(ledger, scb.id)).balance), 900);
});

test('ledger rows are never hard-deleted, adjustments are immutable anchors, audit is append-only', async () => {
  const { ledger, scb, db } = await setup();
  const set = await ledger.setOwnerBalance({ accountId: scb.id, amount: 500, actor: A, ...ids('b') });
  const tx = (await ledger.createTransaction({ kind: 'EXPENSE', amount: 100, accountId: scb.id, actor: A, ...ids('t') })).transaction;
  await assert.rejects(() => db.query('delete from transactions where id=$1', [tx.id]), /never_hard_deleted/);
  await assert.rejects(() => db.query('delete from transactions where id=$1', [set.adjustment_id]), /never_hard_deleted/);
  await assert.rejects(() => db.query('update transactions set amount=1 where id=$1', [set.adjustment_id]), /adjustments_are_immutable/);
  await assert.rejects(() => db.query("update transactions set archived_at=now() where id=$1", [set.adjustment_id]), /adjustments_are_immutable|archived_matches_status/);
  await assert.rejects(() => db.query('update transactions set seq=999999 where id=$1', [tx.id]), /(seq_is_immutable|only be updated to DEFAULT)/);
  await assert.rejects(() => db.query("delete from activity_log where metadata->>'domain'='finance'"), /append-only/);
  await assert.rejects(() => db.query("update activity_log set action='x' where metadata->>'domain'='finance'"), /append-only/);
});

test('every mutation writes an owner-scoped audit event with before/after, channel and message id', async () => {
  const { ledger, scb, db } = await setup();
  const owner = OWNER_ID;
  await ledger.setOwnerBalance({ accountId: scb.id, amount: 1000, actor: A, message: 'line-msg-1', idem: 'k1' });
  const tx = (await ledger.createTransaction({ kind: 'EXPENSE', amount: 100, accountId: scb.id, actor: A, ...ids('t') })).transaction;
  await ledger.voidTransaction({ txId: tx.id, reason: 'r', actor: A, ...ids('v') });
  const rows = (await db.query<{ action: string; owner_id: string; metadata: any }>("select action, owner_id, metadata from activity_log where metadata->>'domain'='finance' order by id")).rows;
  const actions = rows.map(r => r.action);
  for (const expected of ['ACCOUNT_CREATED', 'BALANCE_SET', 'TRANSACTION_CREATED', 'TRANSACTION_VOIDED']) assert.ok(actions.includes(expected), expected);
  assert.ok(rows.every(r => r.owner_id === owner));
  const bc = rows.find(r => r.action === 'BALANCE_SET')!;
  assert.equal(bc.metadata.after.balance, 1000);
  assert.equal(bc.metadata.before.balance_status, 'UNKNOWN');
  assert.equal(bc.metadata.message_id, 'line-msg-1');
  assert.equal(bc.metadata.channel, 'LINE');
  assert.equal(bc.metadata.meta.reason, 'OWNER_RECONCILIATION');
});

test('balance invariants are enforced by the database and only the engine may write balance columns', async () => {
  const { db, scb } = await setup();
  await assert.rejects(() => db.query('update financial_accounts set current_balance=0 where id=$1', [scb.id]), /engine_managed/);
  await assert.rejects(() => db.query("update financial_accounts set balance_status='CONFIRMED' where id=$1", [scb.id]), /engine_managed/);
  await assert.rejects(() => db.query("insert into financial_accounts(owner_id,name,current_balance,balance_status) values($1,'X',5,'CONFIRMED')", [OWNER_ID]), /engine_managed/);
  // even with the engine flag, the shape constraint still holds: a number must carry a status and UNKNOWN carries no number
  await db.query("select set_config('snk.finance_engine','1',false)");
  await assert.rejects(() => db.query('update financial_accounts set current_balance=0 where id=$1', [scb.id]), /unknown_iff_null/);
  await assert.rejects(() => db.query("update financial_accounts set balance_status='CONFIRMED' where id=$1", [scb.id]), /unknown_iff_null/);
});

test('rows written from the dashboard (authenticated, RLS) flow through the SAME balance derivation and are audited', async () => {
  const { db, ledger, scb } = await setup();
  await ledger.setOwnerBalance({ accountId: scb.id, amount: 10000, actor: A, ...ids('b') });
  const asOwner = async <T>(fn: () => Promise<T>): Promise<T> => {
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${OWNER_ID}',false);`);
    try { return await fn(); } finally { await db.exec('reset role'); }
  };
  const ins = await asOwner(() => db.query<{ id: string }>("insert into transactions(type,amount,account_id,description) values('expense',2500,$1,'ui row') returning id", [scb.id]));
  assert.equal(Number((await ledger.getBalance(scb.id) as any).balance), 7500);
  await asOwner(() => db.query('update transactions set amount=3000 where id=$1', [ins.rows[0].id]));
  assert.equal(Number((await ledger.getBalance(scb.id) as any).balance), 7000, 'editing in the dashboard re-derives the balance');
  await asOwner(() => db.query('update transactions set archived_at=now() where id=$1', [ins.rows[0].id]));
  const after = (await ledger.getBalance(scb.id)) as any;
  assert.equal(Number(after.balance), 10000, 'archiving restores it');
  assert.equal(after.balance_status, 'CONFIRMED');
  const audit = (await db.query<{ action: string; metadata: any }>("select action, metadata from activity_log where metadata->>'channel'='dashboard' order by id")).rows;
  assert.deepEqual(audit.map(r => r.action), ['TRANSACTION_CREATED', 'TRANSACTION_EDITED', 'TRANSACTION_VOIDED']);
  // clients can never write the balance columns themselves
  await asOwner(async () => { await assert.rejects(() => db.query('update financial_accounts set current_balance=1 where id=$1', [scb.id]), /engine_managed/); });
});

test('legacy UI behaviour is preserved: transfers are now accepted and plain income/expense rows keep working', async () => {
  const { db, ledger, scb, kbank } = await setup();
  await ledger.setOwnerBalance({ accountId: scb.id, amount: 1000, actor: A, ...ids('b') });
  await ledger.setOwnerBalance({ accountId: kbank.id, amount: 0, actor: A, ...ids('b') });
  await db.query("insert into transactions(owner_id,type,amount,account_id,transfer_account_id) values($1,'transfer',400,$2,$3)", [OWNER_ID, scb.id, kbank.id]);
  assert.equal(Number((await ledger.getBalance(scb.id) as any).balance), 600);
  assert.equal(Number((await ledger.getBalance(kbank.id) as any).balance), 400);
  await db.query("insert into transactions(owner_id,type,amount,description) values($1,'income',50,'legacy-style row with no account')", [OWNER_ID]);
  assert.equal(Number((await ledger.getBalance(scb.id) as any).balance), 600, 'account-less rows never touch a balance');
  await assert.rejects(() => db.query("insert into transactions(owner_id,type,amount) values($1,'bogus',1)", [OWNER_ID]), /transactions_type_check/);
});

test('recurring obligation: next due advances monthly with end-of-month clamping', async () => {
  const { ledger, scb } = await setup();
  await ledger.setOwnerBalance({ accountId: scb.id, amount: 100000, actor: A, ...ids('b') });
  const created = await ledger.createRecurring({ title: 'ค่าเน็ต', kind: 'EXPENSE', amount: 599, frequency: 'MONTHLY', dayOfMonth: 31, firstDue: '2026-01-31', defaultAccountId: scb.id, category: 'ค่าโทรศัพท์/อินเทอร์เน็ต', actor: A, ...ids('o') });
  assert.deepEqual(created.obligation.reminder_days, [7, 3, 1, 0]);
  const paid1 = await ledger.markDuePaid({ obligationId: created.obligation.id, actor: A, ...ids('p') });
  assert.equal(paid1.ok, true);
  assert.equal(paid1.obligation.next_due_date, '2026-02-28');
  const paid2 = await ledger.markDuePaid({ obligationId: created.obligation.id, actor: A, ...ids('p') });
  assert.equal(paid2.obligation.next_due_date, '2026-03-31');
  assert.equal(Number((await bal(ledger, scb.id)).balance), 100000 - 599 * 2);
});

test('mark_due_paid asks for what is missing and mutates nothing', async () => {
  const { ledger } = await setup();
  const o = (await ledger.createRecurring({ title: 'ประกันรถ', kind: 'EXPENSE', amount: 18500, frequency: 'YEARLY', firstDue: '2026-10-30', actor: A, ...ids('o') })).obligation;
  const res = await ledger.markDuePaid({ obligationId: o.id, actor: A, ...ids('p') });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'account_required');
  assert.equal((await ledger.getRecentTransactions(10)).length, 0);
  const v = (await ledger.createRecurring({ title: 'ค่าไฟ', kind: 'EXPENSE', amount: null, frequency: 'MONTHLY', firstDue: '2026-10-05', actor: A, ...ids('o') })).obligation;
  assert.equal((await ledger.markDuePaid({ obligationId: v.id, accountId: null, actor: A, ...ids('p') })).error, 'amount_required');
});

test('installments complete after the last payment; one-time completes immediately; no double pay of a due date', async () => {
  const { ledger, scb } = await setup();
  const inst = (await ledger.createRecurring({ title: 'ผ่อนรถ', kind: 'EXPENSE', amount: 12000, frequency: 'INSTALLMENT', installments: 2, firstDue: '2026-10-25', defaultAccountId: scb.id, actor: A, ...ids('o') })).obligation;
  const p1 = await ledger.markDuePaid({ obligationId: inst.id, actor: A, ...ids('p') });
  assert.equal(p1.obligation.status, 'ACTIVE');
  const p2 = await ledger.markDuePaid({ obligationId: inst.id, actor: A, ...ids('p') });
  assert.equal(p2.obligation.status, 'COMPLETED');
  assert.equal((await ledger.markDuePaid({ obligationId: inst.id, actor: A, ...ids('p') })).ok, false);
  const once = (await ledger.createRecurring({ title: 'ภาษี', kind: 'EXPENSE', amount: 5000, frequency: 'ONE_TIME', firstDue: '2026-11-01', defaultAccountId: scb.id, actor: A, ...ids('o') })).obligation;
  assert.equal((await ledger.markDuePaid({ obligationId: once.id, actor: A, ...ids('p') })).obligation.status, 'COMPLETED');
});

test('voiding an obligation payment re-opens that due date', async () => {
  const { ledger, scb } = await setup();
  const o = (await ledger.createRecurring({ title: 'ค่าเช่า', kind: 'EXPENSE', amount: 3000, frequency: 'MONTHLY', firstDue: '2026-10-05', defaultAccountId: scb.id, actor: A, ...ids('o') })).obligation;
  const paid = await ledger.markDuePaid({ obligationId: o.id, actor: A, ...ids('p') });
  await ledger.voidTransaction({ txId: paid.transaction.id, reason: 'x', actor: A, ...ids('v') });
  const up = await ledger.listUpcoming('2026-10-01', '2026-10-31');
  assert.equal(up[0].due_date, '2026-10-05');
  assert.equal((await ledger.markDuePaid({ obligationId: o.id, actor: A, ...ids('p') })).ok, true);
});

test('duplicate recurring creation returns the existing obligation', async () => {
  const { ledger } = await setup();
  const a = await ledger.createRecurring({ title: 'ค่าเน็ต', kind: 'EXPENSE', amount: 599, frequency: 'MONTHLY', firstDue: '2026-10-05', actor: A, ...ids('o') });
  const b = await ledger.createRecurring({ title: 'ค่าเน็ต', kind: 'EXPENSE', amount: 599, frequency: 'MONTHLY', firstDue: '2026-10-05', actor: A, ...ids('o') });
  assert.equal(a.created, true);
  assert.equal(b.created, false);
  assert.equal(a.obligation.id, b.obligation.id);
});

test('upcoming list projects occurrences, flags overdue, and forecast stays separate from balances', async () => {
  const { ledger, scb } = await setup();
  await ledger.setOwnerBalance({ accountId: scb.id, amount: 10000, actor: A, ...ids('b') });
  await ledger.createRecurring({ title: 'รายสัปดาห์', kind: 'EXPENSE', amount: 100, frequency: 'WEEKLY', firstDue: '2026-10-05', actor: A, ...ids('o') });
  await ledger.createRecurring({ title: 'เลยกำหนด', kind: 'EXPENSE', amount: 50, frequency: 'ONE_TIME', firstDue: '2026-09-30', actor: A, ...ids('o') });
  const items = await ledger.listUpcoming('2026-10-05', '2026-10-19');
  assert.equal(items.filter(i => i.title === 'รายสัปดาห์').length, 3);
  assert.equal(items.find(i => i.title === 'เลยกำหนด')!.overdue, true);
  const f = await ledger.forecast('2026-10-19');
  assert.equal(f.forecast, true);
  assert.equal(Number((await bal(ledger, scb.id)).balance), 10000, 'forecast never edits the current balance');
});

test('summary excludes transfers/adjustments/voided and counts pending clarification', async () => {
  const { ledger, scb } = await setup();
  await ledger.setOwnerBalance({ accountId: scb.id, amount: 10000, actor: A, ...ids('b') });
  await ledger.createTransaction({ kind: 'EXPENSE', amount: 100, accountId: scb.id, category: 'ค่าอาหาร', occurredOn: '2026-10-02', actor: A, ...ids('t') });
  const gone = (await ledger.createTransaction({ kind: 'EXPENSE', amount: 999, accountId: scb.id, occurredOn: '2026-10-02', actor: A, ...ids('t') })).transaction;
  await ledger.voidTransaction({ txId: gone.id, reason: 'x', actor: A, ...ids('v') });
  await ledger.createTransaction({ kind: 'INCOME', amount: 500, accountId: null, occurredOn: '2026-10-03', actor: A, ...ids('t') });
  const s = await ledger.getSummary('2026-10-01', '2026-10-31');
  assert.equal(Number(s.expense), 100);
  assert.equal(Number(s.income), 500);
  assert.equal(Number(s.pending_clarification_count), 1);
});

test('duplicate slip detection by file hash, reference, and amount+date+payee', async () => {
  const { ledger, scb } = await setup();
  await ledger.createTransaction({ kind: 'EXPENSE', amount: 18500, accountId: scb.id, payee: 'บริษัท ประกัน จำกัด', occurredOn: '2026-10-04', slipRef: 'REF123', fileHash: 'hash1', actor: A, ...ids('t') });
  assert.equal((await ledger.findDuplicateSlip({ fileHash: 'hash1' })).reason, 'file_hash');
  assert.equal((await ledger.findDuplicateSlip({ slipRef: 'REF123' })).reason, 'slip_ref');
  assert.equal((await ledger.findDuplicateSlip({ amount: 18500, date: '2026-10-04', payee: 'บริษัท ประกัน จำกัด' })).reason, 'amount_date_payee');
  assert.equal((await ledger.findDuplicateSlip({ amount: 18501, date: '2026-10-04', payee: 'บริษัท ประกัน จำกัด' })).duplicate, false);
});

test('reminders: claimed once per threshold, retried after failure, stop when paid, catch-up sends only the latest crossed threshold', async () => {
  const { ledger, scb } = await setup();
  const o = (await ledger.createRecurring({ title: 'ค่าไฟ', kind: 'EXPENSE', amount: 1000, frequency: 'MONTHLY', firstDue: '2026-10-10', defaultAccountId: scb.id, actor: A, ...ids('o') })).obligation;
  assert.equal((await ledger.claimReminders('2026-10-01')).length, 0, '9 days out: nothing yet');
  const d7 = await ledger.claimReminders('2026-10-03');
  assert.equal(d7.length, 1);
  assert.equal(d7[0].threshold, 7);
  assert.equal((await ledger.claimReminders('2026-10-03')).length, 0, 'no duplicate within the same run window');
  await ledger.finishReminder(d7[0].delivery_id, true);
  assert.equal((await ledger.claimReminders('2026-10-04')).length, 0, 'same threshold already delivered');
  // cron missed 3 and 1 days out: only the most recently crossed threshold (1) is sent
  const late = await ledger.claimReminders('2026-10-09');
  assert.equal(late.length, 1);
  assert.equal(late[0].threshold, 1);
  await ledger.finishReminder(late[0].delivery_id, false, 'line down');
  const retry = await ledger.claimReminders('2026-10-09');
  assert.equal(retry.length, 1, 'failed delivery is retried');
  await ledger.finishReminder(retry[0].delivery_id, true);
  assert.equal((await ledger.claimReminders('2026-10-09')).length, 0);
  const due = await ledger.claimReminders('2026-10-10');
  assert.equal(due[0].threshold, 0);
  await ledger.markDuePaid({ obligationId: o.id, actor: A, ...ids('p') });
  assert.equal((await ledger.claimReminders('2026-10-10')).length, 0, 'paid items stop reminding');
});

test('overdue reminders nag daily for a week then stop', async () => {
  const { ledger } = await setup();
  await ledger.createRecurring({ title: 'ค้าง', kind: 'EXPENSE', amount: 10, frequency: 'ONE_TIME', firstDue: '2026-10-01', actor: A, ...ids('o') });
  const day = async (d: string) => (await ledger.claimReminders(d)).length;
  assert.equal(await day('2026-10-02'), 1);
  assert.equal(await day('2026-10-02'), 0);
  assert.equal(await day('2026-10-03'), 1);
  assert.equal(await day('2026-10-20'), 0);
});

test('RLS and grants: new tables are owner-readable at most, clients cannot call the engine, service_role writes only via RPCs', async () => {
  const { db } = await setup();
  const fresh = ['finance_obligation_payments', 'finance_reminder_deliveries', 'finance_idempotency', 'finance_pending_states', 'finance_channel_bindings'];
  const rls = (await db.query<{ relname: string; rowsecurity: boolean }>("select c.relname, c.relrowsecurity as rowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname = any($1)", [fresh])).rows;
  assert.equal(rls.length, fresh.length);
  for (const t of rls) assert.equal(t.rowsecurity, true, `${t.relname} must have RLS enabled`);
  for (const t of fresh) {
    const anon = await db.query<{ ok: boolean }>("select has_table_privilege('anon','public.'||$1,'select,insert,update,delete') as ok", [t]);
    assert.equal(anon.rows[0].ok, false, `anon must have no privilege on ${t}`);
    const authWrite = await db.query<{ ok: boolean }>("select has_table_privilege('authenticated','public.'||$1,'insert') or has_table_privilege('authenticated','public.'||$1,'update') or has_table_privilege('authenticated','public.'||$1,'delete') as ok", [t]);
    assert.equal(authWrite.rows[0].ok, false, `authenticated cannot write ${t}`);
    const svcWrite = await db.query<{ ok: boolean }>("select has_table_privilege('service_role','public.'||$1,'insert') as ok", [t]);
    assert.equal(svcWrite.rows[0].ok, false, `service_role writes ${t} only through the RPCs`);
  }
  const hidden = await db.query<{ ok: boolean }>("select has_table_privilege('authenticated','public.finance_idempotency','select') or has_table_privilege('authenticated','public.finance_pending_states','select') as ok");
  assert.equal(hidden.rows[0].ok, false, 'idempotency and conversation state are not even readable');
  for (const role of ['anon', 'authenticated']) {
    const fn = await db.query<{ ok: boolean }>("select has_function_privilege($1,'public.finance_set_balance(uuid,uuid,numeric,text,text,text,text)','execute') as ok", [role]);
    assert.equal(fn.rows[0].ok, false, `${role} cannot execute the engine`);
  }
  const svcExec = await db.query<{ ok: boolean }>("select has_function_privilege('service_role','public.finance_set_balance(uuid,uuid,numeric,text,text,text,text)','execute') as ok");
  assert.equal(svcExec.rows[0].ok, true);
  const internal = await db.query<{ ok: boolean }>("select bool_or(has_function_privilege('service_role',p.oid,'execute')) as ok from pg_proc p where p.pronamespace='public'::regnamespace and (p.proname like 'finance\\_i\\_%')");
  assert.equal(internal.rows[0].ok, false, 'internal helpers and trigger functions are not callable by clients');
  // an owner sees only their own rows through the views; anon sees nothing
  const views = await db.query<{ ok: boolean }>("select has_table_privilege('anon','public.finance_account_balances_v1','select') as ok");
  assert.equal(views.rows[0].ok, false);
});

test('tenant isolation: another owner cannot see or touch this owner\'s ledger through the RPCs or the views', async () => {
  const { db, ledger, scb, rpc } = await setup();
  await ledger.setOwnerBalance({ accountId: scb.id, amount: 777, actor: A, ...ids('b') });
  const other = '22222222-2222-4222-8222-222222222222';
  await db.query('insert into auth.users(id) values($1)', [other]);
  const intruder = new (ledger.constructor as any)(rpc, other);
  assert.equal((await intruder.getAccounts()).accounts.length, 0);
  assert.equal((await intruder.getBalance(scb.id)).error, 'account_not_found');
  await assert.rejects(() => intruder.setOwnerBalance({ accountId: scb.id, amount: 1, actor: A, ...ids('x') }), /account_not_found/);
  assert.equal((await intruder.voidTransaction({ txId: scb.id, reason: 'x', actor: A, ...ids('x') })).ok, false);
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${other}',false);`);
  const seen = await db.query('select * from finance_account_balances_v1');
  await db.exec('reset role');
  assert.equal(seen.rows.length, 0);
});
