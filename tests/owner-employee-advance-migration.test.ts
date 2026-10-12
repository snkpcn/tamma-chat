import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const SQL=readFileSync(new URL('../supabase/proposals/owner_employee_advance_v1.sql',import.meta.url),'utf8');
const G='synthetic-owner-group-0001', OTHER='synthetic-owner-group-0002', ACTOR='synthetic-owner-actor';
const E='10000000-0000-4000-8000-000000000001', R='10000000-0000-4000-8000-000000000002';
const UPDATED='2026-10-09T00:00:00.000Z';
async function database(){
 const db=new PGlite();
 await db.exec(`
 create role anon; create role authenticated; create role service_role bypassrls;
 create schema tamma_chart_os;
 create table tamma_chart_os.employees(id uuid primary key,restaurant_id uuid,full_name text,nickname text,
 wage_amount numeric,status text,updated_at timestamptz);
 create table public.financial_owner_expense_intakes(id uuid primary key,owner_group_hash text,source_channel text default 'line',source_user_hash text,
 evidence_message_id text,evidence_sha256 text,occurred_on date,amount numeric,currency text default 'THB',document_type text,reference_number text,
 purpose_raw text,business_unit_code text,expense_class text,expense_category text,expense_subcategory text,
 status text,extraction_confidence numeric,extraction_data jsonb default '{}',storage_bucket text,storage_path text,mime_type text,
 review_state text,review_revision integer default 0,review_data jsonb default '{}',review_message_id text,created_at timestamptz default now(),updated_at timestamptz);
 create function public.draft_guard() returns trigger language plpgsql as $$begin
 if old.review_state='draft' and new.review_state='draft' and (new.amount is distinct from old.amount or new.status in ('categorized','needs_review'))
 then raise exception 'draft_cannot_write_money'; end if; return new; end$$;
 create trigger draft_guard before update on public.financial_owner_expense_intakes for each row execute function public.draft_guard();
 create table public.financial_employee_payroll_events(id uuid primary key default gen_random_uuid(),event_type text not null,employee_label text not null,employee_key text not null,
 amount numeric not null check(amount>0),event_date date not null,pay_period text,funding_source text not null default 'owner_personal'
 constraint financial_employee_payroll_events_funding_source_check check(funding_source in ('owner_personal','business_account','cash','other')),
 status text not null,source_channel text not null default 'line',source_message_id text,owner_group_hash text not null,created_by_hash text,
 slip_message_id text,slip_sha256 text,storage_bucket text,storage_path text,mime_type text,slip_amount numeric,slip_confidence numeric,
 slip_extracted_data jsonb not null default '{}',metadata jsonb not null default '{}',review_reason text,created_at timestamptz default now(),updated_at timestamptz default now());
 create table public.financial_owner_expense_audit_events(id uuid primary key default gen_random_uuid(),intake_id uuid,action text,source text,actor_hash text,message_id text,reason text,before_data jsonb,after_data jsonb,created_at timestamptz default now());
 create table public.financial_investment_entries(id uuid primary key default gen_random_uuid(),owner_group_hash text,status text,source_channel text,source_message_id text);
 grant usage on schema tamma_chart_os to service_role;
 grant select,update on tamma_chart_os.employees to service_role;
 grant select,insert,update on all tables in schema public to service_role;
 insert into tamma_chart_os.employees values('${E}','${R}','Synthetic Employee','Worker',12000,'ทำงานอยู่','2026-09-01T00:00:00Z');
 `);
 await db.exec(SQL);
 return db;
}
async function rpc(db:PGlite,name:string,args:any[]){
 const q=await db.query<{v:any}>(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as v`,args.map(x=>x && typeof x==='object'?JSON.stringify(x):x)); return q.rows[0].v;
}
async function bind(db:PGlite){await db.query(`insert into public.financial_owner_employee_profiles(owner_group_hash,employee_id,employee_key,business_unit_code,role_label,approval_ref) values($1,$2,'worker','shared_infrastructure','Groundskeeper','test-profile-approval')`,[G,E]);}
async function intake(db:PGlite,n:number,amount=250,reference='BANK-REF-'+n){
 const id='20000000-0000-4000-8000-'+String(n).padStart(12,'0'), msg='slip-'+n, sha=n.toString(16).padStart(64,'0');
 await db.query(`insert into public.financial_owner_expense_intakes(id,owner_group_hash,source_user_hash,evidence_message_id,evidence_sha256,occurred_on,amount,document_type,reference_number,purpose_raw,status,extraction_confidence,extraction_data,storage_bucket,storage_path,mime_type,updated_at)
 values($1,$2,$3,$4,$5,'2026-10-09',$6,'transfer_slip',$7,'salary advance','awaiting_business',0.99,$8,'owner-expense-evidence',$9,'image/jpeg',$10)`,
 [id,G,ACTOR,msg,sha,amount,reference,JSON.stringify({amount_total:amount,document_date_local:'2026-10-09',reference_number:reference}),'synthetic/'+id+'.jpg',UPDATED]);
 return {id,msg,sha,amount,reference};
}
function proposal(x:any,extra:any={}){return {kind:'employee_advance',event_type:'salary_advance',employee_query:'Worker',employee_id:E,business_unit_code:'shared_infrastructure',funding_source:'unknown',amount:x.amount,occurred_on:'2026-10-09',purpose:'Salary advance',questions:[],monthly_sum_before:null,...extra};}
async function stage(db:PGlite,x:any,extra:any={},revision=0,message='stage-'+x.id){return rpc(db,'financial_stage_owner_employee_advance_v1',[x.id,G,ACTOR,message,revision,proposal(x,extra)]);}
async function confirm(db:PGlite,x:any,revision=1,message='confirm-'+x.id){return rpc(db,'financial_confirm_owner_employee_advance_v1',[x.id,G,ACTOR,revision,message]);}
function importRow(x:any,funding='unknown'){return {intake_id:x.id,employee_id:E,expected_restaurant_id:R,expected_employee_full_name:'Synthetic Employee',expected_salary:12000,expected_employee_updated_at:'2026-09-01T00:00:00Z',employee_key:'worker',business_unit_code:'shared_infrastructure',role_label:'Groundskeeper',expected_reference:x.reference,expected_evidence_message_id:x.msg,expected_evidence_sha256:x.sha,expected_review_revision:0,expected_updated_at:UPDATED,amount:x.amount,occurred_on:'2026-10-09',funding_source:funding};}
async function imported(db:PGlite,rows:any[],approval='test-chat-approval'){return rpc(db,'financial_import_owner_employee_advances_v1',[G,approval,null,rows,rows.reduce((sum,r)=>sum+r.amount,0)]);}
async function count(db:PGlite,table:string){const q=await db.query<{n:number}>(`select count(*) as n from public.${table}`);return Number(q.rows[0].n);}

test('proposal compiles; no new client RPC access or SECURITY DEFINER functions',async()=>{
 const db=await database(); try {
 const q=await db.query<any>(`select proname,prosecdef,has_function_privilege('anon',oid,'execute') as anon,has_function_privilege('authenticated',oid,'execute') as auth from pg_proc where proname like '%employee_advance%v1'`);
 assert.ok(q.rows.length>=5); for(const row of q.rows){assert.equal(row.prosecdef,false);assert.equal(row.anon,false);assert.equal(row.auth,false);}
 await db.exec('set role anon'); await assert.rejects(()=>rpc(db,'owner_employee_advance_context_v1',[G,null,null,'2026-10-09']),/permission denied/);
 }finally{await db.close();}
});

test('staging preserves original money and identity, creates no payroll event',async()=>{
 const db=await database();try{await bind(db);const x=await intake(db,1);const a=await stage(db,x);assert.equal(a.revision,1);assert.equal(a.proposal.monthly_sum_before,0);
 assert.equal(await count(db,'financial_employee_payroll_events'),0);
 const q=await db.query<any>('select amount,status,review_state from public.financial_owner_expense_intakes where id=$1',[x.id]);assert.equal(Number(q.rows[0].amount),250);assert.equal(q.rows[0].status,'awaiting_business');assert.equal(q.rows[0].review_state,'draft');
 await assert.rejects(()=>rpc(db,'financial_confirm_owner_employee_advance_v1',[x.id,G,'wrong-actor',1,'wrong-confirm']),/owner_review_identity_mismatch/);
 const repeat=await stage(db,x);assert.equal(repeat.duplicate,true);assert.equal(repeat.revision,1);
 }finally{await db.close();}
});

test('unknown kind and employee can be parked, but cannot confirm',async()=>{
 const db=await database();try{const x=await intake(db,1);const a=await stage(db,x,{event_type:'unknown',employee_id:null,business_unit_code:null});assert.ok(a.proposal.questions.length>=2);
 await assert.rejects(()=>confirm(db,x),/advance_review_incomplete/);assert.equal(await count(db,'financial_employee_payroll_events'),0);
 }finally{await db.close();}
});

test('confirmation is atomic, truthfully funded, evidence-preserving and idempotent',async()=>{
 const db=await database();try{await bind(db);const x=await intake(db,1);await db.exec('set role service_role');await stage(db,x,{funding_source:'business_account'});const a=await confirm(db,x);
 assert.equal(a.ok,true);assert.equal(a.monthly_sum,250);assert.equal(a.funding_source,'business_account');assert.equal(a.employee.employee_id,E);
 const q=await db.query<any>('select * from public.financial_owner_expense_intakes where id=$1',[x.id]);assert.equal(q.rows[0].status,'cancelled');assert.equal(Number(q.rows[0].amount),250);assert.equal(q.rows[0].storage_path,'synthetic/'+x.id+'.jpg');assert.equal(q.rows[0].review_data.payment_cancelled,false);
 const again=await confirm(db,x,1,'second-click');assert.equal(again.duplicate,true);assert.equal(await count(db,'financial_employee_payroll_events'),1);assert.equal(await count(db,'financial_employee_advance_audit_events'),2);
 }finally{await db.close();}
});

test('same-day equal payments with different evidence remain distinct; stale monthly card is refreshed',async()=>{
 const db=await database();try{await bind(db);const a=await intake(db,1),b=await intake(db,2);await stage(db,a);await stage(db,b);await confirm(db,a);
 const stale=await confirm(db,b);assert.equal(stale.changed,true);assert.equal(stale.monthly_sum,250);assert.equal(await count(db,'financial_employee_payroll_events'),1);
 await stage(db,b,{},1,'restage-second');const result=await confirm(db,b,2);assert.equal(result.monthly_sum,500);
 }finally{await db.close();}
});

test('normalized reference duplicate is blocked even with different message and image',async()=>{
 const db=await database();try{await bind(db);const a=await intake(db,1,250,' BankREF '),b=await intake(db,2,250,'bankref');await stage(db,a);await confirm(db,a);await stage(db,b);
 assert.equal((await confirm(db,b)).duplicate_transaction,true);assert.equal(await count(db,'financial_employee_payroll_events'),1);
 }finally{await db.close();}
});

test('amount/date tampering, cross-group access, investment copies are refused',async()=>{
 const db=await database();try{await bind(db);const x=await intake(db,1);
 await assert.rejects(()=>stage(db,x,{amount:999}),/advance_amount_evidence_mismatch/);
 await assert.rejects(()=>stage(db,x,{occurred_on:'2026-10-08'}),/advance_date_evidence_mismatch/);
 await assert.rejects(()=>rpc(db,'financial_stage_owner_employee_advance_v1',[x.id,OTHER,ACTOR,'bad-group',0,proposal(x)]),/owner_review_identity_mismatch/);
 await stage(db,x);await db.query(`insert into public.financial_investment_entries(owner_group_hash,status,source_channel,source_message_id) values($1,'recorded','line',$2)`,[G,x.msg]);
 await assert.rejects(()=>confirm(db,x),/evidence_already_counted_as_investment/);
 }finally{await db.close();}
});

test('audited batch links the existing employee, retains unknown funding, retries without duplication',async()=>{
 const db=await database();try{const a=await intake(db,1,120),b=await intake(db,2,130),c=await intake(db,3,140);const rows=[importRow(a,'business_account'),importRow(b,'business_account'),importRow(c)];
 const result=await imported(db,rows);assert.equal(result.total,390);assert.equal(result.results[2].monthly_sum,390);assert.equal(await count(db,'financial_owner_employee_profiles'),1);
 const ev=await db.query<any>('select source_channel,created_by_hash,funding_source,metadata from public.financial_employee_payroll_events order by amount');
 assert.deepEqual(ev.rows.map(r=>r.funding_source),['business_account','business_account','unknown']);for(const r of ev.rows){assert.equal(r.source_channel,'backoffice');assert.equal(r.created_by_hash,null);assert.equal(r.metadata.approval_ref,'test-chat-approval');}
 const retry=await imported(db,rows);assert.ok(retry.results.every((r:any)=>r.duplicate));assert.equal(await count(db,'financial_employee_payroll_events'),3);assert.equal(await count(db,'financial_employee_advance_audit_events'),4);
 }finally{await db.close();}
});

test('a stale row rolls back the entire batch, including profile and audits',async()=>{
 const db=await database();try{const a=await intake(db,1,120),b=await intake(db,2,130);const rows=[importRow(a),{...importRow(b),expected_updated_at:'2026-10-08T00:00:00Z'}];
 await assert.rejects(()=>imported(db,rows),/source_intake_changed/);assert.equal(await count(db,'financial_employee_payroll_events'),0);assert.equal(await count(db,'financial_owner_employee_profiles'),0);assert.equal(await count(db,'financial_employee_advance_audit_events'),0);
 const q=await db.query<any>('select status from public.financial_owner_expense_intakes');assert.ok(q.rows.every(r=>r.status==='awaiting_business'));
 }finally{await db.close();}
});

test('month totals include explicitly mapped legacy names, exclude other groups and distinguish outstanding',async()=>{
 const db=await database();try{await bind(db);
 for(const r of [[G,'salary_advance','paid',900,'2026-10-02'],[G,'salary_advance','paid',800,'2026-09-02'],[G,'advance_deduction','recorded',100,'2026-10-03'],[OTHER,'salary_advance','paid',9999,'2026-10-02']]){
 await db.query(`insert into public.financial_employee_payroll_events(owner_group_hash,event_type,status,amount,event_date,employee_key,employee_label) values($1,$2,$3,$4,$5,'worker','Worker')`,r);}
 const c=await rpc(db,'owner_employee_advance_context_v1',[G,'Worker',null,'2026-10-09']);assert.equal(c.selected.month_paid_advance,900);assert.equal(c.selected.advance_outstanding,1600);
 }finally{await db.close();}
});

test('contradictory document metadata and absent evidence date never produce a payment',async()=>{
 const db=await database();try{await bind(db);const invalid=[{document_kind:'quotation'},{document_kind:'unknown'},{funds_direction:'incoming'},{payment_document_count:2},{payment_document_count:0},{document_date_local:null}];
 for(let i=0;i<invalid.length;i++){const x=await intake(db,i+1);await db.query('update public.financial_owner_expense_intakes set extraction_data=extraction_data||$2::jsonb where id=$1',[x.id,JSON.stringify(invalid[i])]);
 const s=await stage(db,x);assert.ok(s.proposal.questions.length>0);await assert.rejects(()=>confirm(db,x),/advance_review_incomplete/);}
 assert.equal(await count(db,'financial_employee_payroll_events'),0);
 }finally{await db.close();}
});

test('generic classification cannot bypass salary review, while cancellation and explicit purchase correction work',async()=>{
 const db=await database();try{const x=await intake(db,1);
 await db.query(`update public.financial_owner_expense_intakes set extraction_data=extraction_data||'{"visible_payment_note":"ทดสอบเบิกเงินเดือนล่วงหน้า ส่วนกลาง"}'::jsonb,purpose_raw=null where id=$1`,[x.id]);
 await assert.rejects(()=>db.query(`update public.financial_owner_expense_intakes set status='categorized' where id=$1`,[x.id]),/salary_advance_requires_payroll_review/);
 await db.query(`update public.financial_owner_expense_intakes set status='cancelled' where id=$1`,[x.id]);
 await db.query(`update public.financial_owner_expense_intakes set status='categorized',review_data='{"purpose":"ไม่ใช่เบิกเงินเดือน ไปซื้อของส่วนกลาง"}'::jsonb where id=$1`,[x.id]);
 const y=await intake(db,2);await db.query(`update public.financial_owner_expense_intakes set purpose_raw='พนักงานเบิก 250' where id=$1`,[y.id]);
 await assert.rejects(()=>db.query(`update public.financial_owner_expense_intakes set status='categorized' where id=$1`,[y.id]),/salary_advance_requires_payroll_review/);
 }finally{await db.close();}
});

test('later generic expense copies of paid payroll evidence are blocked',async()=>{
 const db=await database();try{const x=await intake(db,1);await imported(db,[importRow(x)]);const y=await intake(db,2,250,x.reference);
 await assert.rejects(()=>db.query(`update public.financial_owner_expense_intakes set status='categorized',purpose_raw='ซื้อของ' where id=$1`,[y.id]),/evidence_already_counted_as_payroll/);
 }finally{await db.close();}
});

test('changed affiliation, employee record or removed mapping refreshes the card without financial writes',async()=>{
 const db=await database();try{await bind(db);const x=await intake(db,1);await stage(db,x);
 await db.query(`update public.financial_owner_employee_profiles set business_unit_code='tamma_restaurant' where employee_id=$1`,[E]);assert.equal((await confirm(db,x)).changed,true);
 await db.query(`update public.financial_owner_employee_profiles set active=false where employee_id=$1`,[E]);const gone=await confirm(db,x);assert.equal(gone.changed,true);assert.equal(gone.employee_missing,true);assert.equal(await count(db,'financial_employee_payroll_events'),0);
 }finally{await db.close();}
});

test('audited compensation retains evidence, voids only bookkeeping and requires manual reconciliation',async()=>{
 const db=await database();try{const x=await intake(db,1);const result=await imported(db,[importRow(x)]);const id=result.results[0].event_id;
 const q=await db.query<any>('select updated_at from public.financial_employee_payroll_events where id=$1',[id]);
 const args=[id,G,'test-reversal-approval',null,'Synthetic correction',q.rows[0].updated_at,1];
 const r=await rpc(db,'financial_revert_owner_employee_advance_v1',args);assert.equal(r.ok,true);assert.equal(r.payment_cancelled,false);assert.equal(r.monthly_sum,0);
 assert.equal(await count(db,'financial_employee_payroll_events'),1);assert.equal(await count(db,'financial_employee_advance_audit_events'),3);
 const source=await db.query<any>('select * from public.financial_owner_expense_intakes where id=$1',[x.id]);assert.equal(source.rows[0].storage_path,'synthetic/'+x.id+'.jpg');assert.equal(Number(source.rows[0].amount),250);assert.equal(source.rows[0].payroll_event_id,id);assert.equal(source.rows[0].review_data.reconciliation_required,true);
 assert.equal((await rpc(db,'financial_revert_owner_employee_advance_v1',args)).duplicate,true);
 }finally{await db.close();}
});

test('compensation refuses changed event/revision and subsequent payroll settlement',async()=>{
 const db=await database();try{const x=await intake(db,1);const result=await imported(db,[importRow(x)]);const id=result.results[0].event_id;
 const q=await db.query<any>('select updated_at from public.financial_employee_payroll_events where id=$1',[id]);
 await assert.rejects(()=>rpc(db,'financial_revert_owner_employee_advance_v1',[id,G,'undo',null,'reason','2000-01-01T00:00:00Z',1]),/reversal_event_changed/);
 await assert.rejects(()=>rpc(db,'financial_revert_owner_employee_advance_v1',[id,G,'undo',null,'reason',q.rows[0].updated_at,999]),/reversal_intake_changed/);
 await db.query(`insert into public.financial_employee_payroll_events(owner_group_hash,employee_id,event_type,status,amount,event_date,employee_key,employee_label) values($1,$2,'advance_deduction','recorded',10,'2026-10-10','worker','Worker')`,[G,E]);
 await assert.rejects(()=>rpc(db,'financial_revert_owner_employee_advance_v1',[id,G,'undo',null,'reason',q.rows[0].updated_at,1]),/payroll_settlement_requires_manual_reconciliation/);
 }finally{await db.close();}
});

test('legacy writes cannot evade image/message uniqueness when a bank reference is absent',async()=>{
 const db=await database();try{
 await db.query(`insert into public.financial_employee_payroll_events(owner_group_hash,event_type,status,amount,event_date,employee_key,employee_label,slip_message_id,slip_sha256) values($1,'salary_advance','paid',100,'2026-10-09','worker','Worker','first-message','image-hash')`,[G]);
 await assert.rejects(()=>db.query(`insert into public.financial_employee_payroll_events(owner_group_hash,event_type,status,amount,event_date,employee_key,employee_label,slip_message_id,slip_sha256) values($1,'salary_advance','paid',100,'2026-10-09','worker','Worker','different-message','image-hash')`,[G]),/financial_payroll_slip_sha_unique_v2/);
 await assert.rejects(()=>db.query(`insert into public.financial_employee_payroll_events(owner_group_hash,event_type,status,amount,event_date,employee_key,employee_label,slip_message_id,slip_sha256) values($1,'salary_advance','paid',100,'2026-10-09','worker','Worker','first-message','different-image')`,[G]),/financial_payroll_slip_message_unique_v2/);
 }finally{await db.close();}
});

test('later investment copies of paid payroll are blocked even for backoffice imports',async()=>{
 const db=await database();try{const x=await intake(db,1);await imported(db,[importRow(x)]);
 await assert.rejects(()=>db.query(`insert into public.financial_investment_entries(owner_group_hash,status,source_channel,source_message_id) values($1,'recorded','line',$2)`,[G,x.msg]),/evidence_already_counted_as_payroll/);
 }finally{await db.close();}
});

test('missing nickname cannot permit a foreign legacy employee key; salary unit stays unknown without confirmation',async()=>{
 const db=await database();try{const x=await intake(db,1);await db.query('update tamma_chart_os.employees set nickname=null where id=$1',[E]);
 await assert.rejects(()=>imported(db,[{...importRow(x),employee_key:'unrelated-worker'}]),/employee_key_mismatch/);
 await imported(db,[{...importRow(x),employee_key:'synthetic employee'}]);const c=await rpc(db,'owner_employee_advance_context_v1',[G,null,E,'2026-10-09']);assert.equal(c.selected.monthly_salary,null);assert.equal(c.selected.salary_basis,'unit_unknown');
 }finally{await db.close();}
});

test('investment-first evidence blocks payroll irrespective of the representation source channel',async()=>{
 const db=await database();try{const x=await intake(db,1);
 await db.query(`insert into public.financial_investment_entries(owner_group_hash,status,source_channel,source_message_id) values($1,'recorded','backoffice',$2)`,[G,x.msg]);
 await assert.rejects(()=>imported(db,[importRow(x)]),/evidence_already_counted_as_investment/);
 assert.equal(await count(db,'financial_employee_payroll_events'),0);assert.equal(await count(db,'financial_owner_employee_profiles'),0);
 }finally{await db.close();}
});
