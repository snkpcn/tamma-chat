import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(
  'supabase/migrations/20261005145713_owner_project_task_os_v1.sql',
  'utf8',
);
const indexMigration = readFileSync(
  'supabase/migrations/20261005150008_owner_project_os_fk_indexes_v1.sql',
  'utf8',
);
const expenseLineMigration = readFileSync(
  'supabase/migrations/20261006025000_owner_expense_line_reclassification_v1.sql',
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
      business_unit_code text not null default 'other',
      title text not null default 'รายการทดสอบ',
      category text not null default 'other',
      amount numeric(14,2) not null default 1,
      payment_method text not null default 'cash',
      vendor_name text,
      notes text,
      source_channel text not null default 'backoffice',
      owner_group_hash text,
      source_message_id text,
      source_user_hash text,
      status text not null default 'recorded',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique(source_channel,source_message_id)
    );
    create table public.financial_investment_entry_audit_events(
      id uuid primary key default gen_random_uuid(),
      entry_id uuid not null,
      action text not null,
      source text not null,
      actor_hash text,
      message_id text,
      before_data jsonb not null default '{}'::jsonb,
      after_data jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );
    create table public.financial_owner_expense_intakes(
      id uuid primary key default gen_random_uuid(),
      occurred_on date not null default current_date,
      amount numeric(14,2),
      business_unit_code text,
      expense_class text,
      expense_category text,
      expense_subcategory text,
      purpose_raw text,
      vendor_label text,
      classification_source text,
      classification_confidence numeric,
      categorized_at timestamptz,
      status text not null default 'categorized',
      updated_at timestamptz not null default now()
    );
    create table public.financial_owner_expense_audit_events(
      id uuid primary key default gen_random_uuid(),
      intake_id uuid not null references public.financial_owner_expense_intakes(id) on delete restrict,
      action text not null,
      source text not null,
      actor_hash text,
      message_id text,
      reason text,
      before_data jsonb not null default '{}'::jsonb,
      after_data jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );
    create function public.financial_record_investment_v1(
      p_occurred_on date,p_business_unit_code text,p_title text,p_category text,
      p_amount numeric,p_payment_method text,p_vendor_name text,p_notes text,
      p_source_channel text,p_owner_group_hash text,p_source_message_id text,p_actor_hash text
    ) returns jsonb language plpgsql as $$
    declare v_id uuid;
    begin
      select id into v_id from public.financial_investment_entries
      where source_channel=p_source_channel and source_message_id=p_source_message_id;
      if v_id is not null then return jsonb_build_object('ok',true,'duplicate',true,'id',v_id); end if;
      insert into public.financial_investment_entries(
        occurred_on,business_unit_code,title,category,amount,payment_method,vendor_name,notes,
        source_channel,owner_group_hash,source_message_id,source_user_hash
      ) values (
        p_occurred_on,p_business_unit_code,p_title,p_category,p_amount,p_payment_method,p_vendor_name,p_notes,
        p_source_channel,p_owner_group_hash,p_source_message_id,p_actor_hash
      ) returning id into v_id;
      return jsonb_build_object('ok',true,'duplicate',false,'id',v_id);
    end $$;
  `);
  await db.exec(migration);
  await db.exec(indexMigration);
  await db.exec(expenseLineMigration);
  return db;
}

async function addDraft(db: PGlite, messageId: string, budget: number) {
  const data = {
    project_name: 'ครัวใหม่', work_title: `งานครัว ${messageId}`,
    task_kind: 'one_time', budget_amount: budget,
    counterparty_name: 'ช่างสมชาย', installment_count: 3,
    payment_method: 'transfer', first_installment_on: '2026-10-10',
    due_on: '2026-12-10', schedule_text: 'เสร็จภายในเดือนธันวาคม',
  };
  const inserted = await db.query<{ id: string }>(`
    insert into public.owner_project_conversation_drafts(
      owner_group_hash,actor_hash,intent,status,data,missing_fields,
      source_message_id,last_message_id
    ) values (
      repeat('a',64),repeat('b',64),'new_project','awaiting_confirmation',$1::jsonb,
      '{}'::text[],$2,$2
    ) returning id
  `, [JSON.stringify(data), messageId]);
  return inserted.rows[0]!.id;
}

test('Owner LINE category confirmation updates one reviewed slip once and records an audit', async () => {
  const db = await database();
  try {
    const inserted = await db.query<{ id: string }>(`
      insert into public.financial_owner_expense_intakes(
        amount,business_unit_code,expense_class,expense_category,expense_subcategory,
        purpose_raw,status
      ) values (
        1000,'other','capital_investment','construction','งานไม้/แปรรูปไม้',
        'จ่ายค่าแปรรูปไม้ ของโครงการเฉลียงไม้','needs_review'
      ) returning id
    `);
    const id = inserted.rows[0]!.id;

    const first = await db.query<{ result: any }>(`
      select public.financial_reclassify_owner_expense_from_line_v1(
        $1,'shared_infrastructure','capital_investment','construction','งานไม้/แปรรูปไม้',$2,$3
      ) as result
    `, [id,'owner-hash','line-message-1']);
    assert.equal(first.rows[0]!.result.duplicate, false);
    assert.equal(first.rows[0]!.result.status, 'categorized');

    const retry = await db.query<{ result: any }>(`
      select public.financial_reclassify_owner_expense_from_line_v1(
        $1,'shared_infrastructure','capital_investment','construction','งานไม้/แปรรูปไม้',$2,$3
      ) as result
    `, [id,'owner-hash','line-message-1']);
    assert.equal(retry.rows[0]!.result.duplicate, true);

    const row = await db.query<{ count: number; amount: string; status: string; business_unit_code: string }>(`
      select count(*)::int as count, min(amount)::text as amount, min(status) as status,
             min(business_unit_code) as business_unit_code
      from public.financial_owner_expense_intakes where id=$1
    `, [id]);
    assert.deepEqual(row.rows[0], {
      count: 1, amount: '1000.00', status: 'categorized', business_unit_code: 'shared_infrastructure',
    });
    const audit = await db.query<{ count: number; source: string; message_id: string }>(`
      select count(*)::int as count, min(source) as source, min(message_id) as message_id
      from public.financial_owner_expense_audit_events
      where intake_id=$1 and action='reclassified'
    `, [id]);
    assert.deepEqual(audit.rows[0], { count: 1, source: 'line', message_id: 'line-message-1' });

    const privileges = await db.query<{ anon: boolean; service: boolean }>(`
      select
        has_function_privilege('anon','public.financial_reclassify_owner_expense_from_line_v1(uuid,text,text,text,text,text,text)','execute') as anon,
        has_function_privilege('service_role','public.financial_reclassify_owner_expense_from_line_v1(uuid,text,text,text,text,text,text)','execute') as service
    `);
    assert.equal(privileges.rows[0]!.anon, false);
    assert.equal(privileges.rows[0]!.service, true);
  } finally {
    await db.close();
  }
});

test('migration confirms drafts transactionally, splits exact installments, and is idempotent', async () => {
  const db = await database();
  try {
    const draftId = await addDraft(db, 'start-1', 100_000);
    const first = await db.query<{ result: any }>(
      `select public.owner_project_confirm_draft_v1($1,$2,$3) as result`,
      [draftId, 'confirm-1', 'b'.repeat(64)],
    );
    assert.equal(first.rows[0]!.result.ok, true);
    assert.equal(first.rows[0]!.result.duplicate, false);

    const installments = await db.query<{ count: number; total: string }>(`
      select count(*)::int as count, sum(amount)::text as total
      from public.owner_project_installments
    `);
    assert.equal(installments.rows[0]!.count, 3);
    assert.equal(Number(installments.rows[0]!.total), 100_000);

    const duplicate = await db.query<{ result: any }>(
      `select public.owner_project_confirm_draft_v1($1,$2,$3) as result`,
      [draftId, 'confirm-retry', 'b'.repeat(64)],
    );
    assert.equal(duplicate.rows[0]!.result.duplicate, true);
    assert.equal((await db.query<{ count: number }>('select count(*)::int as count from public.owner_project_tasks')).rows[0]!.count, 1);

    const secondDraft = await addDraft(db, 'start-2', 12_000);
    await db.query(`select public.owner_project_confirm_draft_v1($1,$2,$3)`, [
      secondDraft, 'confirm-2', 'b'.repeat(64),
    ]);
    assert.equal((await db.query<{ count: number }>('select count(*)::int as count from public.owner_projects')).rows[0]!.count, 1);
    assert.equal((await db.query<{ count: number }>('select count(*)::int as count from public.owner_project_tasks')).rows[0]!.count, 2);
    assert.equal((await db.query<{ count: number }>('select count(*)::int as count from public.owner_project_installments')).rows[0]!.count, 6);
  } finally {
    await db.close();
  }
});

test('migration keeps data private, retains history, and audits cancellation instead of deleting', async () => {
  assert.doesNotMatch(migration+'\n'+indexMigration, /drop\s+table|delete\s+from/iu);
  const db = await database();
  try {
    const privileges = await db.query<{ anon: boolean; service: boolean }>(`
      select
        has_function_privilege('anon','public.owner_project_confirm_draft_v1(uuid,text,text)','execute') as anon,
        has_function_privilege('service_role','public.owner_project_confirm_draft_v1(uuid,text,text)','execute') as service
    `);
    assert.equal(privileges.rows[0]!.anon, false);
    assert.equal(privileges.rows[0]!.service, true);

    const draftId = await addDraft(db, 'start-cancel', 20_000);
    const confirmed = await db.query<{ result: any }>(
      `select public.owner_project_confirm_draft_v1($1,$2,$3) as result`,
      [draftId, 'confirm-cancel', 'b'.repeat(64)],
    );
    const taskId = confirmed.rows[0]!.result.task_id;
    await db.query(
      `select public.owner_project_backoffice_update_v1('task',$1,$2::jsonb,$3,$4)`,
      [taskId, JSON.stringify({ status: 'cancelled' }), 'ลงรายการผิด', 'backoffice-test'],
    );
    const task = await db.query<{ status: string }>('select status from public.owner_project_tasks where id=$1', [taskId]);
    assert.equal(task.rows[0]!.status, 'cancelled');
    const audit = await db.query<{ action: string; reason: string }>(`
      select action,reason from public.owner_project_audit_events
      where entity_type='task' and entity_id=$1 order by created_at desc limit 1
    `, [taskId]);
    assert.deepEqual(audit.rows[0], { action: 'cancelled', reason: 'ลงรายการผิด' });
  } finally {
    await db.close();
  }
});

test('follow-up migration covers project OS foreign keys without dropping existing indexes', async () => {
  const db=await database();
  try{
    const names=await db.query<{indexname:string}>(`
      select indexname from pg_indexes where schemaname='public'
        and indexname in (
          'owner_project_installments_project_due_idx',
          'owner_project_drafts_confirmed_project_idx',
          'owner_project_drafts_confirmed_task_idx',
          'owner_project_messages_draft_idx',
          'financial_investment_entries_owner_project_task_idx',
          'financial_investment_entries_owner_project_installment_idx',
          'financial_owner_expense_owner_project_task_idx',
          'financial_owner_expense_owner_project_installment_idx'
        )
    `);
    assert.equal(names.rows.length,8);
  }finally{await db.close()}
});

test('financial edits and cancellations are reasoned, audited, and never delete the source row', async () => {
  const db = await database();
  try {
    const inserted = await db.query<{ id: string }>(`
      insert into public.financial_investment_entries(
        business_unit_code,title,category,amount,payment_method,source_channel
      ) values ('tamma_restaurant','ชั้นเตรียมครัว','equipment',1200,'cash','backoffice')
      returning id
    `);
    const id = inserted.rows[0]!.id;
    const privileges = await db.query<{ anon: boolean; service: boolean }>(`
      select
        has_function_privilege('anon','public.owner_project_update_financial_v1(text,uuid,text,jsonb,text,text)','execute') as anon,
        has_function_privilege('service_role','public.owner_project_update_financial_v1(text,uuid,text,jsonb,text,text)','execute') as service
    `);
    assert.equal(privileges.rows[0]!.anon, false);
    assert.equal(privileges.rows[0]!.service, true);

    await db.query(`select public.owner_project_update_financial_v1('investment_entry',$1,'update',$2::jsonb,$3,$4)`, [
      id, JSON.stringify({ title: 'ชั้นเตรียมครัวสแตนเลส', amount: 2400 }), 'แก้ยอดตามใบเสร็จ', 'backoffice-test',
    ]);
    const updated = await db.query<{ title: string; amount: string; status: string }>(
      'select title,amount::text,status from public.financial_investment_entries where id=$1', [id],
    );
    assert.deepEqual(updated.rows[0], { title: 'ชั้นเตรียมครัวสแตนเลส', amount: '2400.00', status: 'recorded' });

    await db.query(`select public.owner_project_update_financial_v1('investment_entry',$1,'cancel','{}'::jsonb,$2,$3)`, [
      id, 'รายการซ้ำกับใบเสร็จหลัก', 'backoffice-test',
    ]);
    const cancelled = await db.query<{ count: number; status: string }>(`
      select count(*)::int as count,min(status) as status
      from public.financial_investment_entries where id=$1
    `, [id]);
    assert.deepEqual(cancelled.rows[0], { count: 1, status: 'cancelled' });
    const audit = await db.query<{ action: string; reason: string }>(`
      select action,reason from public.owner_project_audit_events
      where entity_type='expense_link' and entity_id=$1 order by created_at desc limit 1
    `, [id]);
    assert.deepEqual(audit.rows[0], { action: 'cancelled', reason: 'รายการซ้ำกับใบเสร็จหลัก' });
    assert.equal((await db.query<{ count: number }>(`
      select count(*)::int as count from public.financial_investment_entry_audit_events
      where entry_id=$1 and action='cancelled'
    `, [id])).rows[0]!.count, 1);
  } finally {
    await db.close();
  }
});

test('Owner expense slip corrections update the shared record and keep a before/after audit', async () => {
  const db = await database();
  try {
    const inserted = await db.query<{ id: string }>(`
      insert into public.financial_owner_expense_intakes(
        amount,business_unit_code,expense_class,expense_category,purpose_raw,status
      ) values (500,'tamma_restaurant','capital_investment','equipment','อุปกรณ์ครัว','categorized')
      returning id
    `);
    const id = inserted.rows[0]!.id;
    await db.query(`select public.owner_project_update_financial_v1('owner_expense',$1,'update',$2::jsonb,$3,$4)`, [
      id, JSON.stringify({ amount: 750, purpose_raw: 'อุปกรณ์ครัวตามสลิป', expense_category: 'kitchen_equipment' }),
      'แก้ยอดตามสลิปจริง', 'backoffice-test',
    ]);
    const row = await db.query<{ amount: string; purpose_raw: string; expense_category: string }>(`
      select amount::text,purpose_raw,expense_category
      from public.financial_owner_expense_intakes where id=$1
    `, [id]);
    assert.deepEqual(row.rows[0], { amount: '750.00', purpose_raw: 'อุปกรณ์ครัวตามสลิป', expense_category: 'kitchen_equipment' });
    const audit = await db.query<{ action: string; reason: string; before_amount: string; after_amount: string }>(`
      select action,reason,before_data->>'amount' as before_amount,after_data->>'amount' as after_amount
      from public.owner_project_audit_events
      where entity_type='expense_link' and entity_id=$1 order by created_at desc limit 1
    `, [id]);
    assert.deepEqual(audit.rows[0], {
      action: 'updated', reason: 'แก้ยอดตามสลิปจริง', before_amount: '500.00', after_amount: '750.00',
    });
  } finally {
    await db.close();
  }
});

test('Backoffice investment creation and project link succeed together and roll back together', async () => {
  const db = await database();
  try {
    const draftId = await addDraft(db, 'start-linked-entry', 20_000);
    const confirmed = await db.query<{ result: any }>(
      'select public.owner_project_confirm_draft_v1($1,$2,$3) as result',
      [draftId, 'confirm-linked-entry', 'b'.repeat(64)],
    );
    const projectId = confirmed.rows[0]!.result.project_id;
    const taskId = confirmed.rows[0]!.result.task_id;
    const installmentId = (await db.query<{ id: string }>(
      'select id from public.owner_project_installments where task_id=$1 order by installment_no limit 1', [taskId],
    )).rows[0]!.id;
    const args = [
      '2026-10-05', 'tamma_restaurant', 'อุปกรณ์ทดลอง', 'equipment', 5000, 'cash', null, null,
      'backoffice-request-1', 'actor-hash', projectId, taskId, installmentId,
    ];
    const recorded = await db.query<{ result: any }>(`
      select public.owner_project_record_investment_v1(
        $1::date,$2,$3,$4,$5::numeric,$6,$7,$8,$9,$10,$11::uuid,$12::uuid,$13::uuid
      ) as result
    `, args);
    assert.equal(recorded.rows[0]!.result.ok, true);
    assert.equal(recorded.rows[0]!.result.link.ok, true);
    const linked = await db.query<{ count: number; project_id: string; task_id: string; installment_id: string }>(`
      select count(*)::int as count,min(owner_project_id::text) as project_id,
             min(owner_project_task_id::text) as task_id,min(owner_project_installment_id::text) as installment_id
      from public.financial_investment_entries where source_message_id='backoffice-request-1'
    `);
    assert.deepEqual(linked.rows[0], { count: 1, project_id: projectId, task_id: taskId, installment_id: installmentId });

    await assert.rejects(db.query(`
      select public.owner_project_record_investment_v1(
        $1::date,$2,$3,$4,$5::numeric,$6,$7,$8,$9,$10,$11::uuid,$12::uuid,$13::uuid
      )
    `, ['2026-10-05','tamma_restaurant','ควร rollback','equipment',7000,'cash',null,null,'backoffice-request-2','actor-hash','00000000-0000-4000-8000-000000000000',null,null]));
    assert.equal((await db.query<{ count: number }>(`
      select count(*)::int as count from public.financial_investment_entries where source_message_id='backoffice-request-2'
    `)).rows[0]!.count, 0);
  } finally {
    await db.close();
  }
});
