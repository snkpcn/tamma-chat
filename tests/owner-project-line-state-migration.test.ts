import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const basePath=[
  'supabase/migrations/20261005145713_owner_project_task_os_v1.sql',
  '../project-chat-src/supabase/migrations/20261005145713_owner_project_task_os_v1.sql',
  'supabase/migrations/20261005132314_owner_project_task_os_v1.sql',
].find(existsSync)!;
const base=readFileSync(basePath,'utf8');
const lineState=readFileSync('supabase/migrations/20261006120000_owner_project_line_state_v1.sql','utf8');

test('LINE project completion checks every task, audits once, and respects the Owner group boundary',async()=>{
  assert.doesNotMatch(lineState,/drop\s+table|delete\s+from/iu);
  const db=new PGlite();
  try{
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create table public.financial_investment_entries(id uuid primary key default gen_random_uuid(),occurred_on date not null default current_date,status text not null default 'recorded');
      create table public.financial_owner_expense_intakes(id uuid primary key default gen_random_uuid(),occurred_on date not null default current_date,status text not null default 'categorized',updated_at timestamptz not null default now());
    `);
    await db.exec(base);
    await db.exec(lineState);
    const project=(await db.query<{id:string}>(`
      insert into public.owner_projects(owner_group_hash,name,normalized_name,status,source_channel)
      values(repeat('a',64),'เฉลียงไม้','เฉลียงไม้','active','line') returning id
    `)).rows[0]!.id;
    await db.query(`insert into public.owner_project_tasks(project_id,title,status,source_channel)
      values($1,'เฉลียงไม้ให้ลูกค้านั่ง','todo','line')`,[project]);
    const call=(message:string,state='completed',group='a'.repeat(64))=>db.query<{result:any}>(
      'select public.owner_project_set_project_state_from_line_v1($1,$2,$3,$4,$5) as result',
      [project,group,state,'b'.repeat(64),message],
    );
    const blocked=(await call('first')).rows[0]!.result;
    assert.equal(blocked.blocked,true);
    assert.equal(blocked.pending_count,1);
    assert.equal((await db.query<{status:string}>('select status from public.owner_projects where id=$1',[project])).rows[0]!.status,'active');
    assert.equal((await db.query<{count:number}>("select count(*)::int as count from public.owner_project_audit_events where entity_type='project'")).rows[0]!.count,0);
    await assert.rejects(call('wrong-group','completed','c'.repeat(64)),/owner_project_not_found_for_group/u);

    await db.query("update public.owner_project_tasks set status='done' where project_id=$1",[project]);
    const closed=(await call('close')).rows[0]!.result;
    assert.equal(closed.project_status,'completed');
    assert.equal(closed.duplicate,false);
    assert.equal((await call('close')).rows[0]!.result.duplicate,true);
    const audit=await db.query<{count:number;source:string;message_id:string}>(`
      select count(*)::int as count,min(source) as source,min(message_id) as message_id
      from public.owner_project_audit_events where entity_type='project' and entity_id=$1
    `,[project]);
    assert.deepEqual(audit.rows[0],{count:1,source:'line',message_id:'close'});
    assert.equal((await call('reopen','active')).rows[0]!.result.project_status,'active');
    assert.equal((await db.query<{status:string}>('select status from public.owner_project_tasks where project_id=$1',[project])).rows[0]!.status,'done');
    const privileges=await db.query<{anon:boolean;authenticated:boolean;service:boolean}>(`
      select has_function_privilege('anon','public.owner_project_set_project_state_from_line_v1(uuid,text,text,text,text)','execute') as anon,
      has_function_privilege('authenticated','public.owner_project_set_project_state_from_line_v1(uuid,text,text,text,text)','execute') as authenticated,
      has_function_privilege('service_role','public.owner_project_set_project_state_from_line_v1(uuid,text,text,text,text)','execute') as service
    `);
    assert.deepEqual(privileges.rows[0],{anon:false,authenticated:false,service:true});
  }finally{await db.close()}
});
