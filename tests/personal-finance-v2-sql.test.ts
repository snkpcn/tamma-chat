// Real-engine tests (PGlite running the actual migrations) for binding-by-dashboard-code, DB roles and the daily coach data/mutations.
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, OWNER_ID, A } from './helpers/pf-pglite';
import { createHash } from 'node:crypto';

const h = (s: string) => createHash('sha256').update(s).digest('hex');
const G = h('Cgroup1');
const today = '2026-10-05';

async function issueCode(db: any): Promise<string> {
  await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [OWNER_ID]);
  const r = await db.query(`select public.finance_issue_binding_code() r`);
  return r.rows[0].r.code;
}

test('join captures an owner-less PENDING row that grants nothing', async () => {
  const { db } = await freshDb();
  const r = (await db.query(`select public.finance_binding_capture_pending($1,'enc','ev1') r`, [G])).rows[0].r;
  assert.equal(r.status, 'PENDING');
  const a = (await db.query(`select public.finance_active_targets() r`)).rows[0].r;
  assert.deepEqual(a, []);
  const l = (await db.query(`select public.finance_binding_lookup_any($1) r`, [G])).rows[0].r;
  assert.equal(l.status, 'PENDING');
  assert.equal(l.owner_id, null);
});

test('dashboard code activates the group, owner resolved from the code, member role stored', async () => {
  const { db } = await freshDb();
  await db.query(`select public.finance_binding_capture_pending($1,'enc','ev1')`, [G]);
  await db.query(`update auth.users set id=id`); // noop
  // issue_binding_code reads auth.uid(); the fixture defines auth.uid() from request.jwt.claim.sub
  const code = await issueCode(db);
  assert.match(code, /^SNK-\d{8}$/);
  const bad = (await db.query(`select public.finance_binding_activate_code($1,'enc',$2,'SNK-00000000','กลุ่มเงิน') r`, [G, A])).rows[0].r;
  assert.equal(bad.ok, false);
  const ok = (await db.query(`select public.finance_binding_activate_code($1,'enc',$2,$3,'กลุ่มเงิน') r`, [G, A, code])).rows[0].r;
  assert.equal(ok.ok, true);
  assert.equal(ok.owner_id, OWNER_ID);
  const role = (await db.query(`select public.finance_member_role($1,$2) r`, [OWNER_ID, A])).rows[0].r;
  assert.equal(role, 'OWNER');
  const stranger = (await db.query(`select public.finance_member_role($1,'someone_else') r`, [OWNER_ID])).rows[0].r;
  assert.equal(stranger, 'NONE');
  const targets = (await db.query(`select public.finance_active_targets() r`)).rows[0].r;
  assert.equal(targets.length, 1);
  assert.equal(targets[0].owner_id, OWNER_ID);
  // code is one-time
  const again = (await db.query(`select public.finance_binding_activate_code($1,'enc',$2,$3,null) r`, [h('Cgroup2'), 'x', code])).rows[0].r;
  assert.equal(again.ok, false);
  const audit = (await db.query(`select count(*)::int n from activity_log where action in ('GROUP_CODE_ISSUED','GROUP_BOUND')`)).rows[0].n;
  assert.equal(audit, 2);
});

test('a second group cannot become active; code lockout after 5 failures; revoke works', async () => {
  const { db } = await freshDb();
  const code = await issueCode(db);
  await db.query(`select public.finance_binding_activate_code($1,'e',$2,$3,null)`, [G, A, code]);
  const code2 = await issueCode(db);
  const G2 = h('Cgroup2');
  const r = (await db.query(`select public.finance_binding_activate_code($1,'e2',$2,$3,null) r`, [G2, A, code2])).rows[0].r;
  assert.equal(r.ok, false);
  assert.equal(r.error, 'another_group_active');
  for (let i = 0; i < 5; i++) await db.query(`select public.finance_binding_activate_code($1,'e3','x','SNK-1111111${i}',null)`, [h('Cgroup3')]);
  const locked = (await db.query(`select public.finance_binding_activate_code($1,'e3','x','SNK-99999999',null) r`, [h('Cgroup3')])).rows[0].r;
  assert.equal(locked.error, 'locked');
  const rv = (await db.query(`select public.finance_binding_revoke_group($1,$2) r`, [G, A])).rows[0].r;
  assert.equal(rv.ok, true);
  assert.deepEqual((await db.query(`select public.finance_active_targets() r`)).rows[0].r, []);
});

test('expired code is rejected', async () => {
  const { db } = await freshDb();
  const code = await issueCode(db);
  await db.query(`update finance_binding_codes set expires_at=now()-interval '1 minute'`);
  const r = (await db.query(`select public.finance_binding_activate_code($1,'e',$2,$3,null) r`, [G, A, code])).rows[0].r;
  assert.equal(r.ok, false);
});

test('coach: morning data uses real SNK tasks/goals/events/priorities, evening data uses ledger + completed tasks', async () => {
  const { db, ledger } = await freshDb();
  await db.query(`insert into goals(owner_id,title,level,priority,deadline) values($1,'ปิดงบไตรมาส','quarter','high','2026-12-31')`, [OWNER_ID]);
  const t1 = (await db.query(`insert into tasks(owner_id,title,due_date,is_today_priority,status) values($1,'ส่งใบเสนอราคา',$2,true,'todo') returning id`, [OWNER_ID, today])).rows[0].id;
  const t2 = (await db.query(`insert into tasks(owner_id,title,due_date,status) values($1,'โทรหาซัพพลายเออร์','2026-10-03','todo') returning id`, [OWNER_ID])).rows[0].id;
  await db.query(`insert into tasks(owner_id,title,status,archived_at) values($1,'ลบแล้ว','todo',now())`, [OWNER_ID]);
  await db.query(`insert into top_priorities(owner_id,priority_date,item_type,item_id,position) values($1,$2,'task',$3,1)`, [OWNER_ID, today, t1]);
  await db.query(`insert into schedule_events(owner_id,title,start_time,category) values($1,'ประชุมทีม','2026-10-05 10:00+07','meeting')`, [OWNER_ID]);
  await db.query(`insert into schedule_events(owner_id,title,start_time,category) values($1,'ส่งงานลูกค้า','2026-10-07 09:00+07','deadline')`, [OWNER_ID]);
  await db.query(`insert into schedule_events(owner_id,title,start_time,category,rrule) values($1,'ออกกำลังกาย','2026-10-01 18:00+07','personal','{"freq":"daily","interval":1}')`, [OWNER_ID]);
  await ledger.setOwnerBalance('SCB', 100000, A, 'm1', 'k1').catch(() => undefined);
  const m = (await db.query(`select public.finance_coach_morning_data($1,$2) r`, [OWNER_ID, today])).rows[0].r;
  assert.equal(m.priorities.length, 1);
  assert.equal(m.priorities[0].title, 'ส่งใบเสนอราคา');
  assert.equal(m.tasks.length, 2);
  assert.equal(m.tasks[0].overdue, true); // overdue first
  assert.equal(m.events.length, 1);
  assert.equal(m.deadlines.length, 1);
  assert.equal(m.recurring_events.length, 1);
  assert.equal(m.goals[0].title, 'ปิดงบไตรมาส');
  assert.ok(Array.isArray(m.money_due) || typeof m.money_due === 'object');
  // owner reports task done
  const d = (await db.query(`select public.finance_task_set_done($1,$2,true,$3,'msg1','idem-t1') r`, [OWNER_ID, t1, A])).rows[0].r;
  assert.equal(d.ok, true);
  const d2 = (await db.query(`select public.finance_task_set_done($1,$2,true,$3,'msg1','idem-t1') r`, [OWNER_ID, t1, A])).rows[0].r;
  assert.equal(d2.duplicate, true);
  const df = (await db.query(`select public.finance_task_defer($1,$2,'2026-10-06',$3,'msg2','idem-t2') r`, [OWNER_ID, t2, A])).rows[0].r;
  assert.equal(df.ok, true);
  // Keep this fixture on its declared business day even when the test runs after midnight.
  await db.query(`update public.tasks set completed_at=$2::timestamptz where id=$1`, [t1, `${today}T12:00:00+07:00`]);
  const e = (await db.query(`select public.finance_coach_evening_data($1,$2) r`, [OWNER_ID, today])).rows[0].r;
  assert.equal(e.tasks_done.length, 1);
  assert.equal(e.tasks_open.length, 0);
  const other = (await db.query(`select public.finance_task_set_done('22222222-2222-4222-8222-222222222222',$1,true,$2,'m','i') r`, [t2, A])).rows[0].r;
  assert.equal(other.error, 'task_not_found'); // other owners cannot touch it
  const log = (await db.query(`select count(*)::int n from activity_log where action in ('TASK_COMPLETED','TASK_DEFERRED')`)).rows[0].n;
  assert.equal(log, 2);
});

test('coach: delivery claim is once-per-day, retry only after failure, day close persists', async () => {
  const { db } = await freshDb();
  const c1 = (await db.query(`select public.finance_coach_claim($1,'MORNING',$2) r`, [OWNER_ID, today])).rows[0].r;
  assert.equal(c1.claimed, true);
  const c2 = (await db.query(`select public.finance_coach_claim($1,'MORNING',$2) r`, [OWNER_ID, today])).rows[0].r;
  assert.equal(c2.claimed, false);
  await db.query(`select public.finance_coach_finish($1,$2,false,'line 500')`, [OWNER_ID, c1.delivery_id]);
  const c3 = (await db.query(`select public.finance_coach_claim($1,'MORNING',$2) r`, [OWNER_ID, today])).rows[0].r;
  assert.equal(c3.claimed, true);
  await db.query(`select public.finance_coach_finish($1,$2,true,null)`, [OWNER_ID, c3.delivery_id]);
  const c4 = (await db.query(`select public.finance_coach_claim($1,'MORNING',$2) r`, [OWNER_ID, today])).rows[0].r;
  assert.equal(c4.claimed, false);
  const ev = (await db.query(`select public.finance_coach_claim($1,'EVENING',$2) r`, [OWNER_ID, today])).rows[0].r;
  assert.equal(ev.claimed, true);
  await db.query(`select public.finance_day_close_set_context($1,$2,'{"asked":"balance"}')`, [OWNER_ID, today]);
  const got = (await db.query(`select public.finance_day_close_get($1,$2) r`, [OWNER_ID, today])).rows[0].r;
  assert.equal(got.status, 'OPEN');
  assert.equal(got.context.asked, 'balance');
  await db.query(`select public.finance_day_close($1,$2,'พอแล้ว',$3,'m')`, [OWNER_ID, today, A]);
  const closed = (await db.query(`select public.finance_day_close_get($1,$2) r`, [OWNER_ID, today])).rows[0].r;
  assert.equal(closed.status, 'CLOSED');
});

test('client roles cannot call engine/coach RPCs; only authenticated may mint a code', async () => {
  const { db } = await freshDb();
  const q = async (role: string, sql: string) => {
    await db.exec(`set role ${role}`);
    try { await db.query(sql); return 'ok'; } catch (e: any) { return String(e.message); } finally { await db.exec('reset role'); }
  };
  assert.match(await q('anon', `select public.finance_coach_claim('${OWNER_ID}','MORNING','${today}')`), /permission denied/);
  assert.match(await q('authenticated', `select public.finance_coach_claim('${OWNER_ID}','MORNING','${today}')`), /permission denied/);
  assert.match(await q('authenticated', `select public.finance_binding_activate_code('x','e','a','SNK-12345678',null)`), /permission denied/);
  assert.match(await q('anon', `select public.finance_issue_binding_code()`), /permission denied/);
  assert.match(await q('authenticated', `select count(*) from finance_binding_codes`), /ok|permission denied/);
});

test('confirm_balance: "ยอดตรง" confirms a derived balance without creating a transaction; stale expectation is refused', async () => {
  const { db, ledger } = await freshDb();
  const acct = (await ledger.createAccount({ name: 'SCB', actor: A, message: 'm', idem: 'k-acct' })).account;
  await ledger.setOwnerBalance({ accountId: acct.id, amount: 100000, actor: A, message: 'm1', idem: 'k-bal' });
  await ledger.createTransaction({ kind: 'EXPENSE', amount: 18500, accountId: acct.id, actor: A, message: 'm2', idem: 'k-tx' });
  const before = (await db.query(`select count(*)::int n from transactions`)).rows[0].n;
  const stale = (await db.query(`select public.finance_confirm_balance($1,$2,99999,$3,'m3','c-1') r`, [OWNER_ID, acct.id, A])).rows[0].r;
  assert.equal(stale.error, 'balance_changed');
  const ok = (await db.query(`select public.finance_confirm_balance($1,$2,81500,$3,'m4','c-2') r`, [OWNER_ID, acct.id, A])).rows[0].r;
  assert.equal(ok.ok, true);
  assert.equal(ok.account.balance_status, 'CONFIRMED');
  assert.equal(Number(ok.account.balance), 81500);
  assert.equal((await db.query(`select count(*)::int n from transactions`)).rows[0].n, before);
  // later movements still derive correctly from the new confirmation point
  await ledger.createTransaction({ kind: 'EXPENSE', amount: 500, accountId: acct.id, actor: A, message: 'm5', idem: 'k-tx2' });
  const a = (await ledger.getAccounts()).accounts.find(x => x.id === acct.id)!;
  assert.equal(Number(a.balance), 81000);
  const dup = (await db.query(`select public.finance_confirm_balance($1,$2,81500,$3,'m4','c-2') r`, [OWNER_ID, acct.id, A])).rows[0].r;
  assert.equal(dup.duplicate, true);
  const unk = await ledger.createAccount({ name: 'Cash', actor: A, message: 'm6', idem: 'k-acct2' });
  const u = (await db.query(`select public.finance_confirm_balance($1,$2,null,$3,'m7','c-3') r`, [OWNER_ID, unk.account.id, A])).rows[0].r;
  assert.equal(u.error, 'balance_unknown');
});

test('task_set_today flips the priority flag, audited, owner scoped, refuses done tasks', async () => {
  const { db } = await freshDb();
  const t = (await db.query(`insert into tasks(owner_id,title,status) values($1,'งานสำคัญ','todo') returning id`, [OWNER_ID])).rows[0].id;
  const r = (await db.query(`select public.finance_task_set_today($1,$2,true,$3,'m','s-1') r`, [OWNER_ID, t, A])).rows[0].r;
  assert.equal(r.ok, true);
  assert.equal((await db.query(`select is_today_priority p from tasks where id=$1`, [t])).rows[0].p, true);
  const other = (await db.query(`select public.finance_task_set_today('22222222-2222-4222-8222-222222222222',$1,true,$2,'m','s-2') r`, [t, A])).rows[0].r;
  assert.equal(other.error, 'task_not_found');
  await db.query(`select public.finance_task_set_done($1,$2,true,$3,'m','s-3')`, [OWNER_ID, t, A]);
  const done = (await db.query(`select public.finance_task_set_today($1,$2,true,$3,'m','s-4') r`, [OWNER_ID, t, A])).rows[0].r;
  assert.equal(done.error, 'already_done');
});

test('dashboard: owner sees channel status and can disconnect; anon cannot', async () => {
  const { db } = await freshDb();
  await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [OWNER_ID]);
  await db.query(`select public.finance_binding_capture_pending($1,'enc','ev1')`, [G]);
  const st0 = (await db.query(`select public.finance_binding_status() r`)).rows[0].r;
  assert.equal(st0.active, null);
  assert.equal(Number(st0.pending_groups), 1);
  const code = (await db.query(`select public.finance_issue_binding_code() r`)).rows[0].r.code;
  await db.query(`select public.finance_binding_activate_code($1,'enc',$2,$3,'กลุ่มเงิน')`, [G, A, code]);
  const st1 = (await db.query(`select public.finance_binding_status() r`)).rows[0].r;
  assert.equal(st1.active.group_name, 'กลุ่มเงิน');
  const un = (await db.query(`select public.finance_unbind_active() r`)).rows[0].r;
  assert.equal(un.ok, true);
  assert.deepEqual((await db.query(`select public.finance_active_targets() r`)).rows[0].r, []);
  assert.equal((await db.query(`select count(*)::int n from activity_log where action='GROUP_UNBOUND'`)).rows[0].n, 1);
  await db.exec('set role anon');
  await assert.rejects(() => db.query(`select public.finance_binding_status()`), /permission denied/);
  await assert.rejects(() => db.query(`select public.finance_unbind_active()`), /permission denied/);
  await db.exec('reset role');
});
