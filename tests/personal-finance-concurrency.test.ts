// REAL concurrency tests: a real PostgreSQL server (embedded-postgres) with many simultaneous connections running the actual
// migrations -- duplicate LINE events, repeated / simultaneous transaction requests, balance consistency, opposing transfers
// (deadlocks), idempotency keys, locking, once-per-day claims and one-time codes.  Nothing here touches production.
//
// embedded-postgres refuses to run as root and is intentionally NOT a package.json dependency (it downloads a server binary and
// must not slow or risk the Netlify build).  Without it these tests SKIP.  To run them:
//   npm i --no-save embedded-postgres pg   &&   (as a non-root user)  node --import tsx --test tests/personal-finance-concurrency.test.ts
// or, when installed elsewhere:  PF_PGTEST_DIR=/path/with/node_modules node --import tsx --test ...
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { PfBindingClient, PfLedger, type Rpc } from '../netlify/functions/_personal-finance-ledger';
import { handlePersonalFinanceEvent, type PfDeps } from '../netlify/functions/_personal-finance';
import { BASE_SCHEMA, MIGRATION, MIGRATION_V2, OWNER_ID } from './helpers/pf-pglite';

const req = createRequire(process.env.PF_PGTEST_DIR ? join(process.env.PF_PGTEST_DIR, 'x.js') : import.meta.url);
let skipReason: string | null = null;
let pool: any;
let server: any;
let dir = '';
const A = 'actor_hash_owner';

function param(value: unknown): unknown {
  if (value === undefined) return null;
  if (Array.isArray(value)) return `{${value.join(',')}}`;
  if (value !== null && typeof value === 'object') return JSON.stringify(value);
  return value;
}
const rpc: Rpc = async (fn, args) => {
  const keys = Object.keys(args);
  const res = await pool.query(`select public.${fn}(${keys.map((k, n) => `${k} => $${n + 1}`).join(', ')}) as r`, keys.map(k => param(args[k])));
  return res.rows[0]?.r ?? null;
};
const ledger = () => new PfLedger(rpc, OWNER_ID);
const sha = (v: string) => createHash('sha256').update(v.trim().toLowerCase()).digest('hex');
const num = (v: unknown) => Number(v);

async function reset() {
  await pool.query(`truncate public.transactions, public.finance_idempotency, public.finance_obligation_payments, public.finance_reminder_deliveries,
    public.recurring_transactions, public.finance_pending_states, public.finance_binding_codes, public.finance_binding_attempts, public.finance_members,
    public.finance_coach_deliveries, public.finance_day_closes, public.finance_channel_bindings, public.activity_log restart identity cascade`);
  await pool.query('delete from public.financial_accounts');
}

async function account(name: string, balance: number): Promise<string> {
  const l = ledger();
  const a = (await l.createAccount({ name, actor: A, message: `acct-${name}`, idem: `acct-${name}-${Math.random()}` })).account;
  await l.setOwnerBalance({ accountId: a.id, amount: balance, actor: A, message: `bal-${name}`, idem: `bal-${name}-${Math.random()}` });
  return a.id;
}
async function balance(id: string): Promise<number> {
  return num((await pool.query('select current_balance from public.financial_accounts where id=$1', [id])).rows[0].current_balance);
}

before(async () => {
  try {
    const EmbeddedPostgres = req('embedded-postgres').default ?? req('embedded-postgres');
    const pg = req('pg');
    if (typeof process.getuid === 'function' && process.getuid() === 0) throw new Error('embedded-postgres cannot run as root');
    dir = mkdtempSync(join(tmpdir(), 'pf-pg-'));
    const port = 54000 + Math.floor(Math.random() * 900);
    server = new EmbeddedPostgres({ databaseDir: join(dir, 'db'), user: 'postgres', password: 'pw', port, persistent: false, onLog: () => undefined, onError: () => undefined });
    await server.initialise();
    await server.start();
    pool = new pg.Pool({ host: '127.0.0.1', port, user: 'postgres', password: 'pw', database: 'postgres', max: 24 });
    for (const role of ['service_role', 'anon', 'authenticated']) await pool.query(`create role ${role}`);
    await pool.query(readFileSync(BASE_SCHEMA, 'utf8'));
    await pool.query(readFileSync(MIGRATION, 'utf8'));
    await pool.query(readFileSync(MIGRATION_V2, 'utf8'));
    await pool.query('insert into auth.users(id) values($1)', [OWNER_ID]);
  } catch (error) {
    skipReason = `real-Postgres concurrency tests need embedded-postgres + pg and a non-root user (${error instanceof Error ? error.message.split('\n')[0] : error})`;
  }
});
after(async () => {
  try { await pool?.end(); } catch { /* ignore */ }
  try { await server?.stop(); } catch { /* ignore */ }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const guarded = (name: string, fn: () => Promise<void>) => test(name, async t => {
  if (skipReason) return t.skip(skipReason);
  await reset();
  await fn();
});

guarded('the same idempotency key fired 30x in parallel creates exactly one transaction and one balance change', async () => {
  const scb = await account('SCB', 100000);
  const results = await Promise.all(Array.from({ length: 30 }, () =>
    ledger().createTransaction({ kind: 'EXPENSE', amount: 18500, accountId: scb, actor: A, message: 'line-evt-1', idem: 'line-evt-1:tx' })));
  const ids = new Set(results.map(r => r.transaction.id));
  assert.equal(ids.size, 1);
  assert.equal(results.filter(r => !r.duplicate).length, 1, 'exactly one request does the work');
  assert.equal(num((await pool.query(`select count(*) from public.transactions where type='expense'`)).rows[0].count), 1);
  assert.equal(await balance(scb), 81500);
  assert.equal(num((await pool.query(`select count(*) from public.activity_log where action='TRANSACTION_CREATED'`)).rows[0].count), 1);
});

guarded('60 simultaneous DIFFERENT expenses on one account: no lost update, balance exactly equals the sum', async () => {
  const scb = await account('SCB', 100000);
  await Promise.all(Array.from({ length: 60 }, (_, i) =>
    ledger().createTransaction({ kind: 'EXPENSE', amount: 10 + i, accountId: scb, actor: A, message: `m${i}`, idem: `m${i}:tx` })));
  const total = Array.from({ length: 60 }, (_, i) => 10 + i).reduce((a, b) => a + b, 0);
  assert.equal(await balance(scb), 100000 - total);
  assert.equal(num((await pool.query(`select count(*) from public.transactions where type='expense'`)).rows[0].count), 60);
  const seqs = (await pool.query(`select seq from public.transactions order by seq`)).rows.map((r: any) => num(r.seq));
  assert.equal(new Set(seqs).size, seqs.length, 'seq is unique');
});

guarded('mixed income + expense + transfers in parallel never deadlock and conserve money', async () => {
  const a = await account('SCB', 100000);
  const b = await account('KBank', 50000);
  const jobs: Array<Promise<unknown>> = [];
  for (let i = 0; i < 25; i++) {
    jobs.push(ledger().createTransaction({ kind: 'TRANSFER', amount: 100, accountId: a, toAccountId: b, actor: A, message: `t1-${i}`, idem: `t1-${i}` }));
    jobs.push(ledger().createTransaction({ kind: 'TRANSFER', amount: 70, accountId: b, toAccountId: a, actor: A, message: `t2-${i}`, idem: `t2-${i}` }));
    jobs.push(ledger().createTransaction({ kind: 'EXPENSE', amount: 5, accountId: a, actor: A, message: `e-${i}`, idem: `e-${i}` }));
    jobs.push(ledger().createTransaction({ kind: 'INCOME', amount: 9, accountId: b, actor: A, message: `i-${i}`, idem: `i-${i}` }));
  }
  const settled = await Promise.allSettled(jobs);
  const failed = settled.filter(s => s.status === 'rejected') as PromiseRejectedResult[];
  assert.equal(failed.length, 0, failed.map(f => String(f.reason)).join('; '));
  assert.equal(await balance(a), 100000 - 25 * 100 + 25 * 70 - 25 * 5);
  assert.equal(await balance(b), 50000 + 25 * 100 - 25 * 70 + 25 * 9);
});

guarded('stored balances always equal an independent recomputation from the ledger (confirmed amount + later movements)', async () => {
  const a = await account('SCB', 100000);
  const b = await account('KBank', 20000);
  await Promise.all([
    ...Array.from({ length: 20 }, (_, i) => ledger().createTransaction({ kind: 'EXPENSE', amount: 50, accountId: a, actor: A, message: `x${i}`, idem: `x${i}` })),
    ...Array.from({ length: 10 }, (_, i) => ledger().createTransaction({ kind: 'TRANSFER', amount: 30, accountId: a, toAccountId: b, actor: A, message: `y${i}`, idem: `y${i}` })),
    ...Array.from({ length: 10 }, (_, i) => ledger().createTransaction({ kind: 'INCOME', amount: 40, accountId: b, actor: A, message: `z${i}`, idem: `z${i}` })),
  ]);
  const oracle = await pool.query(`
    select a.id, a.current_balance,
           a.balance_confirmed_amount + coalesce(sum(
             case when t.type='expense' and t.account_id=a.id then -t.amount
                  when t.type='income' and t.account_id=a.id then t.amount
                  when t.type='transfer' and t.account_id=a.id then -t.amount
                  when t.type='transfer' and t.transfer_account_id=a.id then t.amount
                  else 0 end),0) as expected
      from public.financial_accounts a
      left join public.transactions t on t.owner_id=a.owner_id and t.status='CONFIRMED' and t.archived_at is null and t.seq > a.balance_confirmed_seq
       and t.type in ('expense','income','transfer') and (t.account_id=a.id or t.transfer_account_id=a.id)
     group by a.id`);
  assert.equal(oracle.rows.length, 2);
  for (const row of oracle.rows) assert.equal(num(row.current_balance), num(row.expected));
});

guarded('owner states a real balance while expenses are in flight: the result is one of the two serial orders, never a torn value', async () => {
  const scb = await account('SCB', 100000);
  const ops: Array<Promise<unknown>> = Array.from({ length: 15 }, (_, i) => ledger().createTransaction({ kind: 'EXPENSE', amount: 100, accountId: scb, actor: A, message: `p${i}`, idem: `p${i}` }));
  ops.splice(7, 0, ledger().setOwnerBalance({ accountId: scb, amount: 80000, actor: A, message: 'real', idem: 'real-balance' }));
  await Promise.all(ops);
  const final = await balance(scb);
  const after = num((await pool.query(`select count(*) from public.transactions t, public.financial_accounts a where a.id=$1 and t.account_id=a.id and t.type='expense' and t.seq > a.balance_confirmed_seq`, [scb])).rows[0].count);
  assert.equal(final, 80000 - after * 100, 'balance = confirmed amount minus only the expenses recorded after it');
  assert.equal(num((await pool.query(`select count(*) from public.transactions where type='expense'`)).rows[0].count), 15);
});

guarded('duplicate LINE webhook delivery (same message id) handled 12x concurrently records ONE expense', async () => {
  const code = await (async () => {
    await pool.query(`select set_config('request.jwt.claim.sub',$1,false)`, [OWNER_ID]);
    return null;
  })();
  void code;
  const scb = await account('SCB', 100000);
  void scb;
  const GROUP = 'C_concurrency_group_000000000000001';
  const USER = 'U_owner_concurrency_0000000000001';
  const deps: PfDeps = {
    rpc, envOwnerId: OWNER_ID, llm: null, now: () => new Date('2026-10-05T03:00:00Z'),
    env: { PF_OWNER_LINE_USER_IDS: USER }, hash: sha, encrypt: v => `enc:${v}`, isBusinessBound: async () => false,
  };
  const evt = (type: string, id?: string, text?: string) => ({ type, replyToken: 'rt', timestamp: 1, webhookEventId: `we-${id ?? type}`, source: { type: 'group', groupId: GROUP, userId: USER }, message: id ? { id, type: 'text', text } : undefined });
  await handlePersonalFinanceEvent(evt('join') as any, deps);
  await handlePersonalFinanceEvent(evt('message', 'act-1', 'ยืนยันกลุ่มการเงิน') as any, deps);
  assert.equal((await new PfBindingClient(rpc).lookup(sha(GROUP))).status, 'ACTIVE');

  const outs = await Promise.all(Array.from({ length: 12 }, () => handlePersonalFinanceEvent(evt('message', 'same-line-message', 'จ่ายค่าประกัน 18500 จาก SCB') as any, deps)));
  assert.ok(outs.every(o => o.handled));
  assert.equal(num((await pool.query(`select count(*) from public.transactions where type='expense'`)).rows[0].count), 1);
  assert.equal(await balance(scb), 81500);
  const replies = outs.map(o => o.reply ?? '');
  assert.ok(replies.every(r => !/ไม่สำเร็จ/.test(r)), replies.join('\n'));
});

guarded('two different obligations / repeated "paid" taps: balance always equals payments actually recorded', async () => {
  const scb = await account('SCB', 100000);
  const o = await ledger().createRecurring({ title: 'ค่าประกัน', kind: 'EXPENSE', amount: 1000, frequency: 'MONTHLY', firstDue: '2026-10-05', defaultAccountId: scb, actor: A, message: 'rec', idem: 'rec-1' });
  const tries = await Promise.allSettled(Array.from({ length: 8 }, (_, i) =>
    ledger().markDuePaid({ obligationId: o.obligation.id, accountId: scb, amount: 1000, actor: A, message: `pay${i}`, idem: i < 4 ? 'pay-same-key' : `pay-${i}` })));
  assert.equal(tries.filter(t => t.status === 'rejected').length, 0);
  const paid = num((await pool.query(`select count(*) from public.transactions where type='expense'`)).rows[0].count);
  assert.ok(paid >= 1 && paid <= 5, `paid=${paid}`);
  assert.equal(await balance(scb), 100000 - paid * 1000);
  assert.equal(num((await pool.query(`select count(*) from public.finance_obligation_payments`)).rows[0].count), paid);
});

guarded('coach delivery claim: 25 parallel claimers, exactly one wins per (owner, kind, day)', async () => {
  const claims = await Promise.all(Array.from({ length: 25 }, () => ledger().coachClaim('MORNING', '2026-10-05')));
  assert.equal(claims.filter(c => c.claimed).length, 1);
  const evening = await Promise.all(Array.from({ length: 25 }, () => ledger().coachClaim('EVENING', '2026-10-05')));
  assert.equal(evening.filter(c => c.claimed).length, 1);
  assert.equal(num((await pool.query(`select count(*) from public.finance_coach_deliveries`)).rows[0].count), 2);
});

guarded('reminder claims: 15 parallel cron runs deliver each due reminder exactly once', async () => {
  const scb = await account('SCB', 100000);
  for (let i = 0; i < 3; i++) await ledger().createRecurring({ title: `บิล${i}`, kind: 'EXPENSE', amount: 100 + i, frequency: 'MONTHLY', firstDue: '2026-10-05', defaultAccountId: scb, actor: A, message: `r${i}`, idem: `r${i}` });
  const runs = await Promise.all(Array.from({ length: 15 }, () => ledger().claimReminders('2026-10-05', 50)));
  const claimed = runs.flat();
  assert.equal(claimed.length, 3);
  assert.equal(new Set(claimed.map(c => c.delivery_id)).size, 3);
});

guarded('one-time binding code: parallel activation from two groups binds exactly one; the code cannot be reused', async () => {
  await pool.query(`select set_config('request.jwt.claim.sub',$1,false)`, [OWNER_ID]);
  const issued = (await pool.query(`select public.finance_issue_binding_code() r`)).rows[0].r;
  const b = new PfBindingClient(rpc);
  const groups = ['G1', 'G2', 'G3', 'G4'].map(g => sha(`C_${g}`));
  await Promise.all(groups.map(g => b.capture(g, 'enc', 'ev')));
  const results = await Promise.allSettled(groups.map(g => b.activateWithCode(g, 'enc', 'actor', issued.code, null)));
  const ok = results.filter(r => r.status === 'fulfilled' && (r.value as any).ok);
  assert.equal(ok.length, 1);
  assert.equal(num((await pool.query(`select count(*) from public.finance_channel_bindings where status='ACTIVE'`)).rows[0].count), 1);
  assert.equal(num((await pool.query(`select count(*) from public.finance_members`)).rows[0].count), 1);
  const reuse = await b.activateWithCode(sha('C_G9'), 'enc', 'actor', issued.code, null);
  assert.equal(reuse.ok, false);
});

guarded('10 parallel wrong-code attempts lock the group: a later correct code is refused (brute force is bounded)', async () => {
  await pool.query(`select set_config('request.jwt.claim.sub',$1,false)`, [OWNER_ID]);
  const issued = (await pool.query(`select public.finance_issue_binding_code() r`)).rows[0].r;
  const b = new PfBindingClient(rpc);
  const g = sha('C_brute');
  await b.capture(g, 'enc', 'ev');
  await Promise.all(Array.from({ length: 10 }, (_, i) => b.activateWithCode(g, 'enc', 'attacker', `SNK-0000000${i}`, null)));
  const late = await b.activateWithCode(g, 'enc', 'attacker', issued.code, null);
  assert.equal(late.ok, false);
  assert.equal(late.error, 'locked');
});
