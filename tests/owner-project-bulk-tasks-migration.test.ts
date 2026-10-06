import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const baseMigrationPath = [
  'supabase/migrations/20261005145713_owner_project_task_os_v1.sql',
  '../project-chat-src/supabase/migrations/20261005145713_owner_project_task_os_v1.sql',
  'supabase/migrations/20261005132314_owner_project_task_os_v1.sql',
].find(existsSync)!;
const baseMigration = readFileSync(baseMigrationPath, 'utf8');
const bulkMigration = readFileSync(
  'supabase/migrations/20261006081244_owner_project_bulk_tasks_v1.sql',
  'utf8',
);

async function database(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create table public.financial_investment_entries(
      id uuid primary key default gen_random_uuid(),
      occurred_on date not null default current_date,
      status text not null default 'recorded'
    );
    create table public.financial_owner_expense_intakes(
      id uuid primary key default gen_random_uuid(),
      occurred_on date not null default current_date,
      status text not null default 'categorized',
      updated_at timestamptz not null default now()
    );
  `);
  await db.exec(baseMigration);
  await db.exec(bulkMigration);
  return db;
}

async function addBulkDraft(db: PGlite): Promise<string> {
  const data = {
    project_name: 'เฉลียงไม้',
    task_kind: 'one_time',
    schedule_text: 'ภายในสัปดาห์นี้',
    due_on: '2026-10-11',
    business_unit_code: 'shared_infrastructure',
    bulk_tasks: [
      { position: 1, title: 'ตัดไม้ตามขนาด' },
      { position: 2, title: 'ทาน้ำยารักษาไม้' },
      { position: 3, title: 'ติดตั้งโครง' },
      { position: 4, title: 'เก็บรายละเอียด' },
    ],
  };
  const inserted = await db.query<{ id: string }>(`
    insert into public.owner_project_conversation_drafts(
      owner_group_hash,actor_hash,intent,status,data,missing_fields,
      source_message_id,last_message_id
    ) values (
      repeat('a',64),repeat('b',64),'one_time_task','awaiting_confirmation',$1::jsonb,
      '{}'::text[],'bulk-start','bulk-start'
    ) returning id
  `, [JSON.stringify(data)]);
  return inserted.rows[0]!.id;
}

test('bulk confirmation creates four ordered pending tasks atomically and retry does not duplicate them', async () => {
  assert.doesNotMatch(bulkMigration, /drop\s+table|delete\s+from/iu);
  const db = await database();
  try {
    const draftId = await addBulkDraft(db);
    const first = await db.query<{ result: any }>(
      'select public.owner_project_confirm_bulk_tasks_v1($1,$2,$3) as result',
      [draftId, 'bulk-confirm', 'b'.repeat(64)],
    );
    assert.equal(first.rows[0]!.result.ok, true);
    assert.equal(first.rows[0]!.result.duplicate, false);
    assert.equal(first.rows[0]!.result.task_count, 4);
    assert.deepEqual(first.rows[0]!.result.tasks.map((task: any) => task.position), [1, 2, 3, 4]);

    const tasks = await db.query<{ title: string; status: string; position: number; due_on: string }>(`
      select title,status,source_batch_position::int as position,due_on::text
      from public.owner_project_tasks order by source_batch_position
    `);
    assert.deepEqual(tasks.rows.map(row => [row.position, row.title, row.status, row.due_on]), [
      [1, 'ตัดไม้ตามขนาด', 'todo', '2026-10-11'],
      [2, 'ทาน้ำยารักษาไม้', 'todo', '2026-10-11'],
      [3, 'ติดตั้งโครง', 'todo', '2026-10-11'],
      [4, 'เก็บรายละเอียด', 'todo', '2026-10-11'],
    ]);

    const retry = await db.query<{ result: any }>(
      'select public.owner_project_confirm_bulk_tasks_v1($1,$2,$3) as result',
      [draftId, 'bulk-confirm-retry', 'b'.repeat(64)],
    );
    assert.equal(retry.rows[0]!.result.duplicate, true);
    assert.equal((await db.query<{ count: number }>('select count(*)::int as count from public.owner_project_tasks')).rows[0]!.count, 4);
  } finally {
    await db.close();
  }
});

test('LINE can complete and reopen only a task from its own group while retaining audit history', async () => {
  const db = await database();
  try {
    const draftId = await addBulkDraft(db);
    const confirmed = await db.query<{ result: any }>(
      'select public.owner_project_confirm_bulk_tasks_v1($1,$2,$3) as result',
      [draftId, 'bulk-confirm-state', 'b'.repeat(64)],
    );
    const taskId = confirmed.rows[0]!.result.tasks[1].id;

    await assert.rejects(
      db.query('select public.owner_project_set_task_state_from_line_v1($1,$2,$3,$4,$5)', [
        taskId, 'wrong-group'.repeat(6), 'done', 'b'.repeat(64), 'wrong-group-message',
      ]),
      /owner_project_task_not_found_for_group/u,
    );

    const done = await db.query<{ result: any }>(
      'select public.owner_project_set_task_state_from_line_v1($1,$2,$3,$4,$5) as result',
      [taskId, 'a'.repeat(64), 'done', 'b'.repeat(64), 'task-done-1'],
    );
    assert.equal(done.rows[0]!.result.duplicate, false);
    assert.equal(done.rows[0]!.result.batch_position, 2);
    assert.equal(done.rows[0]!.result.task_status, 'done');

    const duplicate = await db.query<{ result: any }>(
      'select public.owner_project_set_task_state_from_line_v1($1,$2,$3,$4,$5) as result',
      [taskId, 'a'.repeat(64), 'done', 'b'.repeat(64), 'task-done-retry'],
    );
    assert.equal(duplicate.rows[0]!.result.duplicate, true);

    const reopened = await db.query<{ result: any }>(
      'select public.owner_project_set_task_state_from_line_v1($1,$2,$3,$4,$5) as result',
      [taskId, 'a'.repeat(64), 'todo', 'b'.repeat(64), 'task-reopen-1'],
    );
    assert.equal(reopened.rows[0]!.result.task_status, 'todo');
    const audit = await db.query<{ action: string; source: string; count: number }>(`
      select min(action) as action,min(source) as source,count(*)::int as count
      from public.owner_project_audit_events
      where entity_type='task' and entity_id=$1 and action='status_changed'
    `, [taskId]);
    assert.deepEqual(audit.rows[0], { action: 'status_changed', source: 'line', count: 2 });
  } finally {
    await db.close();
  }
});

test('new bulk and LINE state RPCs are service-role only', async () => {
  const db = await database();
  try {
    const privileges = await db.query<{ bulk_anon: boolean; bulk_service: boolean; state_anon: boolean; state_service: boolean }>(`
      select
        has_function_privilege('anon','public.owner_project_confirm_bulk_tasks_v1(uuid,text,text)','execute') as bulk_anon,
        has_function_privilege('service_role','public.owner_project_confirm_bulk_tasks_v1(uuid,text,text)','execute') as bulk_service,
        has_function_privilege('anon','public.owner_project_set_task_state_from_line_v1(uuid,text,text,text,text)','execute') as state_anon,
        has_function_privilege('service_role','public.owner_project_set_task_state_from_line_v1(uuid,text,text,text,text)','execute') as state_service
    `);
    assert.deepEqual(privileges.rows[0], {
      bulk_anon: false, bulk_service: true, state_anon: false, state_service: true,
    });
  } finally {
    await db.close();
  }
});
