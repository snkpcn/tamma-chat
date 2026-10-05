import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { composeEvening, composeMorning } from '../netlify/functions/_personal-finance-coach';
import { handleSecretaryText, parseSecretaryBatch, type SecretaryCtx } from '../netlify/functions/_personal-secretary';
import { harness, OWNER } from './helpers/pf-harness';
import { A, BASE_SCHEMA, freshDb, MIGRATION, MIGRATION_V2, MIGRATION_V3, OWNER_ID } from './helpers/pf-pglite';

const TODAY = '2026-10-05';
const MISSION_BATCH = `อาทิตย์นี้
- ทำ SNK MONEY ให้จบ
- นัดช่าง
- รายงาน MBA
- เช็ก WW ทุกวันจนเสร็จ
- วันที่ 10 จ่ายประกัน 18500
- วันที่ 15 กรุงเทพ 10 โมง
เตือน SNK MONEY ทุกวันจนกว่าจะเสร็จ
MBA สำคัญสุด`;

function ctx(ledger: SecretaryCtx['ledger'], messageId: string, today = TODAY, actor = A): SecretaryCtx {
  return { ledger, actor, messageId, today, isOwner: true };
}

async function count(db: Awaited<ReturnType<typeof freshDb>>['db'], table: string, owner: string): Promise<number> {
  const row = await db.query<{ n: number }>(`select count(*)::int n from public.${table} where owner_id=$1`, [owner]);
  return row.rows[0].n;
}

function dayAt(offset: number): string {
  const d = new Date(`${TODAY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

test('numeric balance snapshots bypass secretary task clarification', async () => {
  const ledger = {} as SecretaryCtx['ledger'];
  for (const [index, text] of ['ตอนนี้เหลือ 50000', 'เหลือ 50,000 บาท', 'SCB ตอนนี้เหลือ 50000'].entries()) {
    assert.equal(await handleSecretaryText(ctx(ledger, `balance-${index}`), text), null, text);
  }
});

test('v3 maps legacy task status without changing existing task content or timestamps', async () => {
  const db = new PGlite();
  await db.exec('create role service_role; create role anon; create role authenticated;');
  await db.exec(readFileSync(BASE_SCHEMA, 'utf8'));
  await db.exec(readFileSync(MIGRATION, 'utf8'));
  await db.exec(readFileSync(MIGRATION_V2, 'utf8'));
  await db.query('insert into auth.users(id) values($1)', [OWNER_ID]);
  await db.query(`insert into public.tasks(owner_id,title,status,created_at,updated_at,completed_at)
    values($1,'legacy open','todo','2020-01-01T00:00:00Z','2020-02-01T00:00:00Z',null),
          ($1,'legacy done','done','2020-01-02T00:00:00Z','2020-02-02T00:00:00Z','2020-02-03T00:00:00Z')`, [OWNER_ID]);
  const before = await db.query(`select id::text,title,status,created_at::text,updated_at::text,completed_at::text
    from public.tasks where owner_id=$1 order by title`, [OWNER_ID]);
  await db.exec(readFileSync(MIGRATION_V3, 'utf8'));
  const taskIndex = await db.query<{ n: number }>(`select count(*)::int n from pg_indexes
    where schemaname='public' and indexname='secretary_followup_policies_task_id_idx'`);
  assert.equal(taskIndex.rows[0].n, 1);
  const after = await db.query(`select id::text,title,status,created_at::text,updated_at::text,completed_at::text,secretary_state
    from public.tasks where owner_id=$1 order by title`, [OWNER_ID]);
  assert.deepEqual(after.rows.map(({ secretary_state: _state, ...legacy }) => legacy), before.rows);
  assert.deepEqual(after.rows.map(row => row.secretary_state), ['DONE', 'OPEN']);
  await db.close();
});

test('the weekly owner brief parses tasks, a real appointment, a future bill, linked follow-ups and priority', () => {
  const parsed = parseSecretaryBatch(MISSION_BATCH, TODAY);
  assert.equal(parsed.error, undefined);
  assert.equal(parsed.items.length, 8);
  assert.deepEqual(parsed.items.slice(0, 4).map(item => item.kind), ['DEADLINE_TASK', 'DEADLINE_TASK', 'DEADLINE_TASK', 'DAILY_FOLLOW_UP']);
  assert.equal(parsed.items[1].title, 'นัดช่าง');
  assert.equal(parsed.items[4].kind, 'FINANCIAL_OBLIGATION');
  assert.equal(parsed.items[4].title, 'ประกัน');
  assert.equal(parsed.items[4].amount, 18500);
  assert.equal(parsed.items[4].due_date, '2026-10-10');
  assert.equal(parsed.items[5].kind, 'CALENDAR_EVENT');
  assert.equal(parsed.items[5].start_at, '2026-10-15T10:00:00+07:00');
  assert.equal(parsed.items[6].title, 'SNK MONEY');
  assert.equal(parsed.items[7].title, 'MBA');
  assert.equal(parsed.items[7].owner_priority, 100);
});

test('14-day secretary simulation stays in canonical SNK OS rows and keeps daily summaries concise', async () => {
  const { db, ledger, owner } = await freshDb();
  const first = ctx(ledger, 'weekly-owner-batch-1');
  const accepted = await handleSecretaryText(first, MISSION_BATCH);
  assert.match(accepted?.reply ?? '', /จัดเข้าระบบแล้ว/);
  await handleSecretaryText(first, MISSION_BATCH); // LINE retry: same message/idempotency key
  await handleSecretaryText(ctx(ledger, 'weekly-owner-batch-2'), MISSION_BATCH); // semantic duplicate on a new webhook id

  assert.equal(await count(db, 'tasks', owner), 4);
  assert.equal(await count(db, 'schedule_events', owner), 1);
  assert.equal(await count(db, 'recurring_transactions', owner), 1);
  assert.equal(await count(db, 'transactions', owner), 0, 'a future bill is not a payment event');
  assert.equal(await count(db, 'secretary_followup_policies', owner), 2);

  const insurance = (await db.query<{ title: string; amount: string; due: string }>(
    `select title,amount::text amount,next_occurrence::text due from public.recurring_transactions where owner_id=$1`, [owner],
  )).rows[0];
  assert.deepEqual(insurance, { title: 'ประกัน', amount: '18500', due: '2026-10-10' });
  const mba = (await db.query<{ title: string; owner_priority: number }>(
    `select title,owner_priority from public.tasks where owner_id=$1 and title like '%MBA%'`, [owner],
  )).rows[0];
  assert.equal(mba.owner_priority, 100);

  const taskId = async (key: string) => (await db.query<{ id: string }>(
    `select id from public.tasks where owner_id=$1 and secretary_key=$2`, [owner, key],
  )).rows[0]?.id;
  const snkId = await taskId('snkmoney');
  const wwId = await taskId('ww');
  const mechanicId = await taskId('นัดช่าง');
  const mbaId = await taskId('mba');
  assert.ok(snkId && wwId && mechanicId && mbaId);

  await handleSecretaryText(ctx(ledger, 'progress-snk', dayAt(0)), 'SNK MONEY ได้ 35% แล้ว');
  await handleSecretaryText(ctx(ledger, 'waiting-mechanic', dayAt(1)), 'นัดช่าง รอช่าง');
  let waiting = await ledger.secretarySnapshot(A, dayAt(1));
  assert.ok((waiting.waiting as Array<{ id: string }>).some(item => item.id === mechanicId));
  assert.ok(!(waiting.tasks as Array<{ id: string }>).some(item => item.id === mechanicId));
  const waitingBrief = composeMorning(await ledger.secretaryMorningData('system:coach', dayAt(1)));
  assert.match(waitingBrief.text, /งานที่กำลังรอ/);
  assert.doesNotMatch(waitingBrief.text, /ติดตามวันนี้\n• นัดช่าง/);

  await handleSecretaryText(ctx(ledger, 'unblock-mechanic', dayAt(2)), 'ช่างส่งข้อมูลมาแล้ว');
  let mechanic = (await db.query<{ secretary_state: string; waiting_for: string | null }>(
    `select secretary_state,waiting_for from public.tasks where id=$1`, [mechanicId],
  )).rows[0];
  assert.deepEqual(mechanic, { secretary_state: 'IN_PROGRESS', waiting_for: null });

  await handleSecretaryText(ctx(ledger, 'snooze-mba', dayAt(3)), 'รายงาน MBA พรุ่งนี้ค่อยทำ');
  let mbaState = (await db.query<{ secretary_state: string; status: string; due: string }>(
    `select secretary_state,status,due_date::text due from public.tasks where id=$1`, [mbaId],
  )).rows[0];
  assert.equal(mbaState.secretary_state, 'SNOOZED');
  assert.equal(mbaState.status, 'todo');
  assert.equal(mbaState.due, dayAt(4));

  await handleSecretaryText(ctx(ledger, 'cancel-ww', dayAt(4)), 'ยกเลิกงาน WW');
  await handleSecretaryText(ctx(ledger, 'done-snk', dayAt(5)), 'SNK MONEY เสร็จแล้ว');
  const closed = (await db.query<{ secretary_state: string; status: string; active: boolean }>(
    `select t.secretary_state,t.status,f.active from public.tasks t join public.secretary_followup_policies f on f.task_id=t.id where t.id=$1`, [snkId],
  )).rows[0];
  assert.deepEqual(closed, { secretary_state: 'DONE', status: 'done', active: false });
  const cancelled = (await db.query<{ secretary_state: string; archived: boolean; active: boolean }>(
    `select t.secretary_state,(t.archived_at is not null) archived,f.active from public.tasks t join public.secretary_followup_policies f on f.task_id=t.id where t.id=$1`, [wwId],
  )).rows[0];
  assert.deepEqual(cancelled, { secretary_state: 'CANCELLED', archived: true, active: false });
  assert.equal(await count(db, 'transactions', owner), 0, 'secretary task changes never create money events');

  for (let offset = 0; offset < 14; offset++) {
    const date = dayAt(offset);
    const morning = composeMorning(await ledger.secretaryMorningData('system:coach', date));
    const evening = composeEvening(await ledger.secretaryEveningData('system:coach', date));
    assert.ok(morning.context.items.length <= 3, `morning Top 3 on ${date}`);
    assert.ok(morning.text.split('\n').length <= 18, `morning brief grew too long on ${date}: ${morning.text}`);
    assert.ok(evening.context.items.length <= 3, `evening Top 3 on ${date}`);
    assert.ok(evening.text.includes('ปิดวัน'), `evening close missing on ${date}`);
    assert.ok(!/ค่ะ|คะ/.test(morning.text + evening.text));
  }
  const appointmentDay = composeMorning(await ledger.secretaryMorningData('system:coach', '2026-10-15'));
  assert.match(appointmentDay.text, /10:00 น\. กรุงเทพ/);
  assert.equal(await count(db, 'tasks', owner), 4, '14 daily briefs did not create task rows');
  assert.equal(await count(db, 'recurring_transactions', owner), 1, '14 daily briefs did not create money rows');
});

test('numbered and conversational references stay fresh, similar names ask, and schedule edits require the right event', async () => {
  const { db, ledger, owner } = await freshDb();
  const seed = await ledger.secretaryApplyBatch([
    { kind: 'TASK', title: 'ส่งงานลูกค้า', source_index: 1 },
    { kind: 'TASK', title: 'ส่งงานภาษี', source_index: 2 },
    { kind: 'TASK', title: 'ตรวจงบประมาณ', source_index: 3 },
    { kind: 'TASK', title: 'ตรวจงบระบบ', source_index: 4 },
  ], A, 'seed-tasks', 'seed-tasks:batch', TODAY);
  const firstTask = seed.items[0].id;
  await handleSecretaryText(ctx(ledger, 'that-one'), 'อันนั้น ได้ 60% แล้ว');
  await handleSecretaryText(ctx(ledger, 'just-now'), 'เมื่อกี้ เหลือ ทวนไฟล์แนบ');
  const lastTask = (await db.query<{ secretary_state: string; progress: number; next_action: string }>(
    `select secretary_state,progress,next_action from public.tasks where owner_id=$1 and title='ตรวจงบระบบ'`, [owner],
  )).rows[0];
  assert.deepEqual(lastTask, { secretary_state: 'IN_PROGRESS', progress: 60, next_action: 'ทวนไฟล์แนบ' });

  const coachContext = { stage: 'MORNING', date: TODAY, items: [{ n: 1, id: firstTask, title: 'ส่งงานลูกค้า' }], asked: [] };
  await ledger.dayCloseSetContext(TODAY, coachContext);
  await db.query(`update public.secretary_contexts set updated_at=now()-interval '3 days' where owner_id=$1 and actor_hash=$2`, [owner, A]);

  const complete = await handleSecretaryText(ctx(ledger, 'coach-numbered-done'), 'ข้อ 1 เสร็จแล้ว');
  assert.match(complete?.reply ?? '', /ปิดงาน “ส่งงานลูกค้า”/);
  const doneRow = (await db.query<{ secretary_state: string; status: string }>(`select secretary_state,status from public.tasks where id=$1`, [firstTask])).rows[0];
  assert.deepEqual(doneRow, { secretary_state: 'DONE', status: 'done' });
  await handleSecretaryText(ctx(ledger, 'coach-numbered-done'), 'ข้อ 1 เสร็จแล้ว');
  assert.equal((await db.query<{ n: number }>(`select count(*)::int n from public.activity_log where owner_id=$1 and action='SECRETARY_TASK_UPDATED' and metadata->>'message_id'='coach-numbered-done'`, [owner])).rows[0].n, 1);

  const ambiguousTask = await handleSecretaryText(ctx(ledger, 'ambiguous-similar-task'), 'ตรวจงบ ได้ 20% แล้ว');
  assert.match(ambiguousTask?.reply ?? '', /หมายถึงงานไหน/);
  const similarProgress = await db.query<{ n: number }>(
    `select count(*)::int n from public.tasks where owner_id=$1 and title in ('ตรวจงบประมาณ','ตรวจงบระบบ') and progress is not distinct from null`, [owner],
  );
  assert.equal(similarProgress.rows[0].n, 1, 'the ambiguous update did not change the untouched similar task');

  const staleBatch = await ledger.secretaryApplyBatch([{ kind: 'TASK', title: 'ตรวจยอดสาขา', source_index: 1 }], A, 'stale-seed', 'stale-seed:batch', dayAt(1));
  const staleId = staleBatch.items[0].id;
  await db.query(`update public.secretary_contexts set updated_at=now()-interval '3 days' where owner_id=$1 and actor_hash=$2`, [owner, A]);
  const stale = await handleSecretaryText(ctx(ledger, 'stale-reference', dayAt(1)), 'ข้อแรกเสร็จแล้ว');
  assert.match(stale?.reply ?? '', /อ้างอิงเก่า/);
  assert.equal((await db.query<{ state: string }>(`select secretary_state state from public.tasks where id=$1`, [staleId])).rows[0].state, 'OPEN');

  await ledger.secretaryApplyBatch([
    { kind: 'CALENDAR_EVENT', title: 'ประชุมงบทีม A', start_at: '2026-10-15T10:00:00+07:00', source_index: 1 },
    { kind: 'CALENDAR_EVENT', title: 'ประชุมงบทีม B', start_at: '2026-10-16T10:00:00+07:00', source_index: 2 },
  ], A, 'seed-events', 'seed-events:batch', TODAY);
  const before = await db.query<{ title: string; start_time: string }>(`select title,start_time::text start_time from public.schedule_events where owner_id=$1 order by title`, [owner]);
  const generic = await handleSecretaryText(ctx(ledger, 'generic-reschedule'), 'นัดเลื่อนไปวันศุกร์');
  assert.match(generic?.reply ?? '', /หมายถึงนัดไหน/);
  const ambiguousEvent = await handleSecretaryText(ctx(ledger, 'ambiguous-reschedule'), 'ประชุมงบ เลื่อนไปวันศุกร์');
  assert.match(ambiguousEvent?.reply ?? '', /หมายถึงนัดไหน/);
  const afterAmbiguous = await db.query<{ title: string; start_time: string }>(`select title,start_time::text start_time from public.schedule_events where owner_id=$1 order by title`, [owner]);
  assert.deepEqual(afterAmbiguous.rows, before.rows);

  const explicit = await handleSecretaryText(ctx(ledger, 'explicit-reschedule'), 'ประชุมงบทีม A เลื่อนไปวันศุกร์');
  assert.match(explicit?.reply ?? '', /เลื่อน “ประชุมงบทีม A”/);
  const moved = (await db.query<{ start_time: string }>(`select start_time::text start_time from public.schedule_events where owner_id=$1 and title='ประชุมงบทีม A'`, [owner])).rows[0];
  const movedBangkokDate = new Date(Date.parse(moved.start_time) + 7 * 3600_000).toISOString().slice(0, 10);
  assert.equal(movedBangkokDate, '2026-10-09');
});

test('a timed-out secretary write returns the existing friendly failure and leaves canonical tables untouched', async () => {
  const h = await harness({ pinnedOwner: false });
  await h.raw({ type: 'join', user: null });
  await h.db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [OWNER_ID]);
  const code = (await h.db.query<{ r: { code: string } }>(`select public.finance_issue_binding_code() r`)).rows[0].r.code;
  const activated = await h.say(`ยืนยันกลุ่มการเงิน ${code}`, { user: OWNER });
  assert.match(activated.reply ?? '', /ยืนยันกลุ่ม SNK MONEY เรียบร้อย/);
  const rpc = h.deps.rpc;
  h.deps.rpc = async (name, args) => {
    if (name === 'secretary_apply_batch') throw new Error('simulated database timeout');
    return rpc(name, args);
  };
  const result = await h.say('- ทำงานทดสอบหนึ่ง\n- ทำงานทดสอบสอง');
  assert.match(result.reply ?? '', /บันทึกไม่สำเร็จ/);
  assert.equal(await h.count('tasks', `owner_id='${OWNER_ID}'`), 0);
});
