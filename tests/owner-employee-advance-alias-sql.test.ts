import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// Exact structural fixture and real proposal; every identity/transaction is synthetic.
const BASE=readFileSync(new URL('./sql/employee-advance-actual-schema.sql',import.meta.url),'utf8');
const SQL=readFileSync(new URL('../supabase/proposals/owner_employee_advance_v1.sql',import.meta.url),'utf8');
const G='synthetic-alias-owner-group', OTHER='synthetic-alias-other-group', ACTOR='synthetic-alias-owner';
const E='10000000-0000-4000-8000-000000000001', E2='10000000-0000-4000-8000-000000000004';
const R='10000000-0000-4000-8000-000000000002', ALIAS='ตัวอย่างเอเบิก';
async function database(){
 const db=new PGlite();
 await db.exec('create role anon;create role authenticated;create role service_role bypassrls;');
 await db.exec(BASE);
 // The production creator grants ALL table privileges by default. Reproduce
 // those defaults only in this disposable database before creating new objects.
 await db.exec('alter default privileges in schema public grant all on tables to anon,authenticated,service_role; alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;');
 await db.exec(SQL);
 await db.query(`insert into tamma_chart_os.employees(id,restaurant_id,full_name,nickname,wage_amount,employment_type,status,created_at,updated_at)
 values($1,$2,'Synthetic Second','Another',12000,'เงินเดือน','ทำงานอยู่','2026-09-01','2026-09-01')`,[E2,R]);
 return db;
}
async function rpc(db:PGlite,name:string,args:any[]){return (await db.query<{v:any}>(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) v`,args.map(v=>v&&typeof v==='object'?JSON.stringify(v):v))).rows[0].v;}
async function bind(db:PGlite,employee=E,group=G,aliases=[ALIAS],approval='synthetic-alias-approval'){
 await db.query(`insert into public.financial_owner_employee_profiles(owner_group_hash,employee_id,employee_key,business_unit_code,role_label,approval_ref,salary_advance_aliases,salary_advance_alias_approval_ref)
 values($1,$2,$3,'shared_infrastructure','Synthetic role','synthetic-profile-approval',$4::text[],$5)`,[group,employee,employee===E?'worker':'another',aliases,approval]);
}
async function context(db:PGlite,note=ALIAS,group=G,employee:string|null=null){return rpc(db,'owner_employee_advance_context_v1',[group,note,employee,'2026-10-09']);}
async function intake(db:PGlite,n=1,note=ALIAS){
 const id='20000000-0000-4000-8000-'+String(n).padStart(12,'0');
 const extraction={amount_total:125,document_date_local:'2026-10-09',document_kind:'transfer_evidence',funds_direction:'outgoing',payment_document_count:1,visible_payment_note:note};
 await db.query(`insert into public.financial_owner_expense_intakes(id,owner_group_hash,source_user_hash,evidence_message_id,evidence_sha256,occurred_on,amount,document_type,reference_number,purpose_raw,status,review_state,review_revision,review_data,extraction_confidence,extraction_data,storage_bucket,storage_path,mime_type,updated_at)
 values($1,$2,$3,$4,$5,'2026-10-09',null,'transfer_slip',$6,null,'awaiting_business','draft',2,$7,0.99,$8,'owner-expense-evidence',$9,'image/jpeg','2026-10-09T00:00:00Z')`,
 [id,G,ACTOR,'synthetic-alias-slip-'+n,n.toString(16).padStart(64,'0'),'SYNTHETIC-ALIAS-REF-'+n,JSON.stringify({purpose:note,business_unit_code:'shared_infrastructure'}),JSON.stringify(extraction),'synthetic/alias/'+n+'.jpg']);
 return {id,n};
}
function proposal(alias:any,extra:any={}){return {kind:'employee_advance',event_type:'salary_advance',employee_query:ALIAS,employee_id:E,business_unit_code:'shared_infrastructure',funding_source:'unknown',amount:125,occurred_on:'2026-10-09',purpose:'เบิกเงินเดือนล่วงหน้า',alias_inference:alias,...extra};}
async function stage(db:PGlite,x:any,alias:any,extra:any={},revision=2){return rpc(db,'financial_stage_owner_employee_advance_v1',[x.id,G,ACTOR,'synthetic-alias-stage-'+x.n+'-'+revision,revision,proposal(alias,extra)]);}
async function confirm(db:PGlite,x:any,revision=3){return rpc(db,'financial_confirm_owner_employee_advance_v1',[x.id,G,ACTOR,revision,'synthetic-alias-confirm-'+x.n]);}
async function moneyCount(db:PGlite){return Number((await db.query<{n:number}>('select count(*) n from public.financial_employee_payroll_events')).rows[0].n);}

// No production memo, person, source reference, employee ID or amount appears here.
test('alias SQL proposal and unapplied migration stay byte-identical and service-only',async()=>{
 assert.equal(SQL,readFileSync(new URL('../supabase/migrations/20261012063307_owner_employee_advance_v1.sql',import.meta.url),'utf8'));
 const db=await database();try{
 const q=await db.query<any>(`select proname,prosecdef,has_function_privilege('anon',oid,'execute') anon,has_function_privilege('authenticated',oid,'execute') auth from pg_proc where proname like 'financial_employee_advance_%v1'`);
 for(const r of q.rows){assert.equal(r.prosecdef,false);assert.equal(r.anon,false);assert.equal(r.auth,false);}
 }finally{await db.close();}
});

test('new tables reset inherited service-role ALL defaults to precise least privilege',async()=>{
 const db=await database();try{
 const privileges=['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'];
 for(const table of ['financial_owner_employee_profiles','financial_employee_advance_audit_events']){
  const allowed=table==='financial_owner_employee_profiles'?['SELECT','INSERT','UPDATE']:['SELECT','INSERT'];
  for(const role of ['anon','authenticated','service_role'])for(const privilege of privileges){
   const q=await db.query<any>('select has_table_privilege($1,$2,$3) ok',[role,'public.'+table,privilege]);
   assert.equal(q.rows[0].ok,role==='service_role'&&allowed.includes(privilege),role+':'+table+':'+privilege);
  }
 }
 await db.exec('set role service_role');
 await assert.rejects(()=>db.exec('update public.financial_employee_advance_audit_events set before_data=before_data'),/permission denied/);
 await assert.rejects(()=>db.exec('delete from public.financial_employee_advance_audit_events'),/permission denied/);
 await assert.rejects(()=>db.exec('truncate public.financial_employee_advance_audit_events'),/permission denied/);
 await assert.rejects(()=>db.exec('delete from public.financial_owner_employee_profiles'),/permission denied/);
 // Creator defaults themselves remain unchanged for unrelated future objects.
 await db.exec('reset role');
 const acl=await db.query<any>(`select defaclacl::text acl from pg_default_acl where defaclnamespace='public'::regnamespace and defaclobjtype='r'`);
 assert.ok(acl.rows[0].acl.includes('service_role=arwdDxtm'));
 }finally{await db.close();}
});

test('aliases require bounded specific phrases and a separate approval reference',async()=>{
 const db=await database();try{
 for(const aliases of [[''],['เบิก'],['พนักงานเบิก'],['advance'],['เบิกเงินเดือนล่วงหน้า'],['employee advance'],['เงินเดือน'],['salary'],['Workerเบิกค่าน้ำ'],['Workerเบิกซื้อวัสดุ'],['Workerเบิกอุปกรณ์'],['Workerเบิกไปจ่ายคนงาน'],['ไม่ใช่Workerเบิก'],['Workerขอเบิก'],['Workerเบิก?'],[' a '],['Worker เบิก','workerเบิก']]){
  await assert.rejects(()=>bind(db,E,G,aliases),/financial_owner_employee_alias_approval_check/);
 }
 await assert.rejects(()=>bind(db,E,G,[ALIAS],''),/financial_owner_employee_alias_approval_check/);
 await bind(db);assert.equal((await context(db)).alias_resolution.approval_ref,'synthetic-alias-approval');
 }finally{await db.close();}
});

test('whole-note matching changes only whitespace and case, never prose or numbers',async()=>{
 const db=await database();try{
 await bind(db,E,G,['Workerเบิก']);
 for(const note of ['Workerเบิก',' worker เบิก ','WORKER\tเบิก']) assert.equal((await context(db,note)).alias_resolution.employee_id,E);
 for(const note of ['','เบิก','Worker','Workerเบิก 125','Memo:Workerเบิก','ไม่ใช่Workerเบิก','Workerเบิกค่าน้ำ','Workerเบิกไปซื้อของ','Workerเบิก?']) assert.equal((await context(db,note)).alias_resolution,null);
 }finally{await db.close();}
});

test('duplicate, inactive, other-group and mismatched selected identities do not infer salary',async()=>{
 const db=await database();try{
 await bind(db);await bind(db,E2,G);
 const both=await context(db);assert.equal(both.alias_resolution,null);assert.equal(both.candidates.length,2);assert.equal(both.alias_match_count,2);
 assert.equal((await context(db,ALIAS,G,E)).alias_resolution,null,'selected ID cannot hide ambiguous alias');
 await db.query('update public.financial_owner_employee_profiles set active=false where employee_id=$1',[E2]);
 assert.equal((await context(db)).alias_resolution.employee_id,E);assert.equal((await context(db)).alias_match_count,1);
 assert.equal((await context(db,ALIAS,G,E2)).alias_resolution,null);
 assert.equal((await context(db,ALIAS,OTHER)).alias_resolution,null);
 await db.query(`update tamma_chart_os.employees set status='พ้นสภาพ' where id=$1`,[E]);
 assert.equal((await context(db)).alias_resolution,null);
 }finally{await db.close();}
});

test('saved generic draft converts in place with validated provenance, then one manual confirm saves',async()=>{
 const db=await database();try{
 await bind(db);const x=await intake(db);const a=(await context(db)).alias_resolution;
 const before=(await db.query<any>('select * from public.financial_owner_expense_intakes where id=$1',[x.id])).rows[0];
 await db.exec('set role service_role');const s=await stage(db,x,a);
 assert.equal(s.revision,3);assert.equal(s.proposal.alias_source_note,ALIAS);assert.deepEqual(s.proposal.alias_inference,a);assert.equal(s.proposal.questions.length,0);assert.equal(await moneyCount(db),0);
 const after=(await db.query<any>('select * from public.financial_owner_expense_intakes where id=$1',[x.id])).rows[0];
 for(const key of ['id','owner_group_hash','source_user_hash','evidence_message_id','evidence_sha256','storage_path','reference_number','amount','purpose_raw','extraction_data']) assert.deepEqual(after[key],before[key],key);
 const result=await confirm(db,x);assert.equal(result.ok,true);assert.equal(result.monthly_sum,125);assert.equal(result.funding_source,'unknown');
 const ev=(await db.query<any>('select metadata from public.financial_employee_payroll_events')).rows[0];assert.deepEqual(ev.metadata.alias_inference,a);
 const again=await confirm(db,x);assert.equal(again.duplicate,true);assert.equal(await moneyCount(db),1);
 }finally{await db.close();}
});

test('forged replacement purpose, approval or employee cannot manufacture saved-note inference',async()=>{
 const db=await database();try{
 await bind(db);const a=(await context(db)).alias_resolution;const x=await intake(db,1,'ไปซื้อของ');
 let r=await stage(db,x,a,{purpose:ALIAS,alias_source_note:ALIAS});assert.equal(r.alias_invalid,true);
 const y=await intake(db,2);r=await stage(db,y,{...a,approval_ref:'forged'});assert.equal(r.alias_invalid,true);
 r=await stage(db,y,a,{employee_id:E2});assert.equal(r.alias_invalid,true);
 assert.equal(await moneyCount(db),0);
 assert.equal(Number((await db.query<any>('select count(*) n from public.financial_employee_advance_audit_events')).rows[0].n),0);
 }finally{await db.close();}
});

test('reviewed purchase correction wins over the immutable OCR alias',async()=>{
 const db=await database();try{
 await bind(db);const x=await intake(db);const a=(await context(db)).alias_resolution;
 await db.query(`update public.financial_owner_expense_intakes set review_data='{"purpose":"ไม่ใช่เบิกเงินเดือน ไปซื้อของ"}'::jsonb where id=$1`,[x.id]);
 assert.equal((await stage(db,x,a)).alias_invalid,true);assert.equal(await moneyCount(db),0);
 }finally{await db.close();}
});

test('alias removal, approval replacement or new ambiguity invalidate the card without a write',async()=>{
 for(const mutation of ['remove','provenance','duplicate']){
  const db=await database();try{
   await bind(db);const x=await intake(db);await stage(db,x,(await context(db)).alias_resolution);
   if(mutation==='remove')await db.query(`update public.financial_owner_employee_profiles set salary_advance_aliases='{}' where employee_id=$1`,[E]);
   if(mutation==='provenance')await db.query(`update public.financial_owner_employee_profiles set salary_advance_alias_approval_ref='replacement-approval' where employee_id=$1`,[E]);
   if(mutation==='duplicate')await bind(db,E2,G);
   const r=await confirm(db,x);assert.equal(r.changed,true);assert.equal(r.alias_invalid,true);assert.equal(await moneyCount(db),0);
  }finally{await db.close();}
 }
});

test('profile updates advance revision automatically and manual salary selection clears inference',async()=>{
 const db=await database();try{
 await bind(db);const x=await intake(db);await stage(db,x,(await context(db)).alias_resolution);
 await db.query(`update public.financial_owner_employee_profiles set role_label='Revised role' where employee_id=$1`,[E]);
 assert.equal((await context(db)).alias_resolution.profile_revision,2);
 assert.equal((await confirm(db,x)).alias_invalid,true);
 const manual=await stage(db,x,null,{event_type:'salary_advance'},3);assert.equal(manual.proposal.alias_inference,null);assert.equal(manual.revision,4);
 assert.equal((await confirm(db,x,4)).ok,true);assert.equal(await moneyCount(db),1);
 await assert.rejects(()=>db.query(`update public.financial_owner_employee_profiles set revision=1 where employee_id=$1`,[E]),/employee_profile_revision_regressed/);
 }finally{await db.close();}
});

test('explicit manual salary can operate without an alias, while unknown type cannot confirm',async()=>{
 const db=await database();try{
 await bind(db,E,G,[],null as any);const x=await intake(db);const s=await stage(db,x,null,{event_type:'unknown'});
 assert.ok(s.proposal.questions.length);await assert.rejects(()=>confirm(db,x),/advance_review_incomplete/);
 await stage(db,x,null,{event_type:'salary_advance'},3);assert.equal((await confirm(db,x,4)).ok,true);
 }finally{await db.close();}
});

function importRow(x:any){return {intake_id:x.id,employee_id:E,expected_restaurant_id:R,expected_employee_full_name:'Synthetic Employee',expected_salary:12000,expected_employee_updated_at:'2026-09-01T00:00:00Z',employee_key:'worker',business_unit_code:'shared_infrastructure',role_label:'Synthetic role',expected_reference:'SYNTHETIC-ALIAS-REF-'+x.n,expected_evidence_message_id:'synthetic-alias-slip-'+x.n,expected_evidence_sha256:x.n.toString(16).padStart(64,'0'),expected_review_revision:2,expected_updated_at:'2026-10-09T00:00:00Z',amount:125,occurred_on:'2026-10-09',funding_source:'unknown',salary_advance_aliases:[ALIAS],salary_advance_alias_approval_ref:'synthetic-separate-alias-approval'};}
async function imported(db:PGlite,rows:any[]){return rpc(db,'financial_import_owner_employee_advances_v1',[G,'synthetic-import-owner-approval',null,rows,rows.length*125]);}

test('audited optional alias binding uses separate provenance, retries exactly and never overwrites',async()=>{
 const db=await database();try{
 const x=await intake(db),row=importRow(x);await db.exec('set role service_role');
 assert.equal((await imported(db,[row])).ok,true);
 const resolved=(await context(db)).alias_resolution;assert.equal(resolved.approval_ref,'synthetic-separate-alias-approval');
 const audit=(await db.query<any>(`select after_data from public.financial_employee_advance_audit_events where action='profile_bound'`)).rows[0];
 assert.deepEqual(audit.after_data.salary_advance_aliases,[ALIAS]);assert.equal(audit.after_data.salary_advance_alias_approval_ref,'synthetic-separate-alias-approval');
 assert.equal((await imported(db,[row])).results[0].duplicate,true);assert.equal(await moneyCount(db),1);
 await assert.rejects(()=>imported(db,[{...row,salary_advance_aliases:['ตัวอย่างบีเบิก']}]),/employee_profile_changed/);
 assert.equal((await context(db)).alias_resolution.approval_ref,'synthetic-separate-alias-approval');
 }finally{await db.close();}
});

test('invalid alias data on a later import row rolls back earlier financial/profile/audit writes',async()=>{
 const db=await database();try{
 const a=await intake(db),b=await intake(db,2);await db.exec('set role service_role');
 await assert.rejects(()=>imported(db,[importRow(a),{...importRow(b),salary_advance_aliases:[123]}]),/invalid_alias_binding/);
 assert.equal(await moneyCount(db),0);
 assert.equal(Number((await db.query<any>('select count(*) n from public.financial_owner_employee_profiles')).rows[0].n),0);
 assert.equal(Number((await db.query<any>('select count(*) n from public.financial_employee_advance_audit_events')).rows[0].n),0);
 }finally{await db.close();}
});

test('legacy generic expense posting cannot bypass an approved alias, but explicit purchase correction works',async()=>{
 const db=await database();try{
 await bind(db,E,G,['Worker advance']);const x=await intake(db,1,'Worker advance');
 // The original draft guard has already protected money before confirmation.
 // Test the classification trigger after a legacy transition out of draft.
 await db.query(`update public.financial_owner_expense_intakes set review_state=null where id=$1`,[x.id]);
 await assert.rejects(()=>db.query(`update public.financial_owner_expense_intakes set status='categorized' where id=$1`,[x.id]),/salary_advance_requires_payroll_review/);
 await db.query(`update public.financial_owner_expense_intakes set review_data='{"purpose":"ซื้อของส่วนกลาง"}'::jsonb,status='categorized' where id=$1`,[x.id]);
 assert.equal(await moneyCount(db),0);
 }finally{await db.close();}
});
