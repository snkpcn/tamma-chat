import assert from 'node:assert/strict';
import test from 'node:test';
import { A, freshDb, ids } from './helpers/pf-pglite';

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
  assert.equal(res.transaction.from_effect, null);
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

test('money fields are immutable and rows cannot be hard deleted; audit is append-only', async () => {
  const { ledger, scb, db } = await setup();
  const tx = (await ledger.createTransaction({ kind: 'EXPENSE', amount: 100, accountId: scb.id, actor: A, ...ids('t') })).transaction;
  await assert.rejects(() => db.query('update pf_transactions set amount=1 where id=$1', [tx.id]), /immutable/);
  await assert.rejects(() => db.query('delete from pf_transactions where id=$1', [tx.id]), /never hard-deleted/);
  await assert.rejects(() => db.query('delete from pf_audit_events'), /append-only/);
  await assert.rejects(() => db.query("update pf_audit_events set action='x'"), /append-only/);
  await assert.rejects(() => db.query('truncate pf_audit_events'), /append-only/);
});

test('every mutation writes an audit event with before/after', async () => {
  const { ledger, scb, db } = await setup();
  await ledger.setOwnerBalance({ accountId: scb.id, amount: 1000, actor: A, ...ids('b') });
  const tx = (await ledger.createTransaction({ kind: 'EXPENSE', amount: 100, accountId: scb.id, actor: A, ...ids('t') })).transaction;
  await ledger.voidTransaction({ txId: tx.id, reason: 'r', actor: A, ...ids('v') });
  const actions = (await db.query<{ action: string }>('select action from pf_audit_events order by created_at, id')).rows.map(r => r.action);
  for (const expected of ['ACCOUNT_CREATED', 'BALANCE_SET', 'TRANSACTION_CREATED', 'TRANSACTION_VOIDED']) assert.ok(actions.includes(expected), expected);
  const bc = (await db.query<{ before_data: any; after_data: any }>("select before_data, after_data from pf_audit_events where action='BALANCE_SET'")).rows[0];
  assert.equal(bc.after_data.balance, 1000);
  assert.equal(bc.before_data.balance_status, 'UNKNOWN');
});

test('account balance/unknown invariant is enforced by the database', async () => {
  const { db, scb } = await setup();
  await assert.rejects(() => db.query("update pf_accounts set balance=0 where id=$1", [scb.id]), /pf_accounts_unknown_iff_null_balance/);
  await assert.rejects(() => db.query("update pf_accounts set balance_status='CONFIRMED' where id=$1", [scb.id]), /pf_accounts_unknown_iff_null_balance/);
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

test('RLS and grants: nothing is reachable by anon/authenticated; service_role goes through RPCs', async () => {
  const { db } = await setup();
  const tables = (await db.query<{ relname: string; rowsecurity: boolean }>("select c.relname, c.relrowsecurity as rowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname like 'pf\\_%'")).rows;
  assert.ok(tables.length >= 11);
  for (const t of tables) assert.equal(t.rowsecurity, true, `${t.relname} must have RLS enabled`);
  for (const role of ['anon', 'authenticated']) {
    for (const t of tables) {
      const g = await db.query<{ ok: boolean }>("select has_table_privilege($1, 'public.'||$2, 'select,insert,update,delete') as ok", [role, t.relname]);
      assert.equal(g.rows[0].ok, false, `${role} must have no privilege on ${t.relname}`);
    }
    const fn = await db.query<{ ok: boolean }>("select has_function_privilege($1,'public.pf_set_balance(uuid,numeric,text,text,text,text)','execute') as ok", [role]);
    assert.equal(fn.rows[0].ok, false);
  }
  const svcWrite = await db.query<{ ok: boolean }>("select has_table_privilege('service_role','public.pf_transactions','insert') as ok");
  assert.equal(svcWrite.rows[0].ok, false, 'service_role writes only through RPCs');
  const svcExec = await db.query<{ ok: boolean }>("select has_function_privilege('service_role','public.pf_set_balance(uuid,numeric,text,text,text,text)','execute') as ok");
  assert.equal(svcExec.rows[0].ok, true);
  const internal = await db.query<{ ok: boolean }>("select has_function_privilege('service_role','public.pf_i_post_tx(text,numeric,uuid,uuid,uuid,text,text,date,text,text,text,text,text,uuid,date,uuid,boolean)','execute') as ok");
  assert.equal(internal.rows[0].ok, false, 'internal helpers are not callable by clients');
});
