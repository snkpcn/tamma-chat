import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {encodeInthaninDailyCloseAction} from '../netlify/functions/_inthanin-daily-close-card';
import {dailyCloseCardForReceipt,handleDailyCloseCardAction} from '../netlify/functions/_inthanin-daily-close-card-actions';
const INTHANIN_BRANCH_ID='33333333-3333-4333-8333-333333333333';
const INTHANIN_CHANNEL_ID='22222222-2222-4222-8222-222222222222';
const INTHANIN_TARGET_HASH='a'.repeat(64);

const id='11111111-1111-4111-8111-111111111111';
const actor='synthetic-nook-owner',hash=createHash('sha256').update(actor).digest('hex');
const row=()=>({id,branch_id:INTHANIN_BRANCH_ID,local_date:'2037-10-11',environment:'live',status:'draft',revision:2,
 net_sales:1234,payment_cash:434,payment_qr:800,payments_total:1234,sales_payment_variance:0,cash_drawer_outflow_amount:34,
 cash_opening_float:500,cash_counted_closing:900});
function fixture(mode='ready'){
 const original={fetch:globalThis.fetch,env:{...process.env}};const calls:Array<{path:string;body:any}>=[];const current=row();
 process.env.SUPABASE_URL='https://fixture.invalid';process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic-test-only';
 process.env.OWNER_FINANCE_LINE_USER_HASHES=hash;process.env.INTHANIN_DAILY_CLOSE_CARD_CONFIRM_ENABLED='true';
 globalThis.fetch=async(url,init)=>{
  const path=String(url),body=init?.body?JSON.parse(init.body as string):null;calls.push({path,body});
  if(path.includes('operations_business_branches'))return Response.json(mode==='missing-branch'?[]:mode==='ambiguous-branch'?[{id:INTHANIN_BRANCH_ID},{id:INTHANIN_BRANCH_ID}]:[{id:INTHANIN_BRANCH_ID}]);
  if(path.includes('ops_notification_channels'))return Response.json(mode==='unbound'?[]:mode==='ambiguous-channel'?[{id:INTHANIN_CHANNEL_ID,target_id_hash:INTHANIN_TARGET_HASH},{id:INTHANIN_CHANNEL_ID,target_id_hash:INTHANIN_TARGET_HASH}]:[{id:INTHANIN_CHANNEL_ID,target_id_hash:mode==='foreign-channel'?'b'.repeat(64):INTHANIN_TARGET_HASH}]);
  if(path.includes('financial_daily_close_effective_v1'))return Response.json([current]);
  if(path.includes('rpc/financial_reconcile_daily_close_v1'))return Response.json({ok:true,ready_to_confirm:mode!=='blocked',
   blockers:mode==='blocked'?[{code:'cash_counted_closing_missing',message:'ยังไม่มีเงินสดนับจริง'}]:[],warnings:[]});
  if(path.includes('rpc/financial_confirm_inthanin_daily_close_card_v1')){
   assert.equal(body.p_daily_close_id,id);assert.equal(body.p_expected_revision,2);assert.equal(body.p_expected_local_date,'2037-10-11');assert.equal(body.p_actor_hash,hash);
   if(mode==='race'){current.revision=3;return Response.json({confirmed:false,reason:'stale_revision'});}
   current.status='confirmed';current.revision=3;return Response.json({confirmed:true});
  }
  throw new Error('Unexpected network '+path);
 };
 return {calls,current,restore:()=>{globalThis.fetch=original.fetch;process.env=original.env;}};
}
const command=(action:'check'|'edit'|'confirm'='confirm',revision=2)=>encodeInthaninDailyCloseAction({id,localDate:'2037-10-11',revision,action});
const confirmCalls=(calls:Array<{path:string}>)=>calls.filter(c=>c.path.includes('rpc/financial_confirm_'));
test('daily staff receipt validates read-only and returns a card without confirming',async()=>{
 const f=fixture();try{const message=await dailyCloseCardForReceipt({targetHash:INTHANIN_TARGET_HASH,
  close:{dailyCloseId:id,localDate:'2037-10-11',environment:'live',status:'draft',messageId:'fixture-report'}});
  assert.equal(message?.type,'flex');assert.equal(confirmCalls(f.calls).length,0);
  assert.ok(f.calls.every(c=>c.body===null||c.path.includes('rpc/financial_reconcile_daily_close_v1')));
 }finally{f.restore();}
});
test('staff cannot confirm even if group member and button payload is valid',async()=>{
 const f=fixture();try{const result=await handleDailyCloseCardAction({targetHash:INTHANIN_TARGET_HASH,userId:'synthetic-staff',data:command()});
  assert.match(JSON.stringify(result),/คุณนุ๊ก/);assert.equal(f.calls.length,0);
 }finally{f.restore();}
});
test('missing dedicated owner configuration fails closed despite general ops admin membership',async()=>{
 const f=fixture();try{delete process.env.OWNER_FINANCE_LINE_USER_HASHES;process.env.LINE_OPS_ADMIN_USER_IDS=actor;
  await handleDailyCloseCardAction({targetHash:INTHANIN_TARGET_HASH,userId:actor,data:command()});assert.equal(f.calls.length,0);
 }finally{f.restore();}
});
test('owner explicit confirm invokes exact revision-bound RPC once and duplicate old card cannot repeat',async()=>{
 const f=fixture();try{const input={targetHash:INTHANIN_TARGET_HASH,userId:actor,data:command()};
  const result=await handleDailyCloseCardAction(input);assert.match(JSON.stringify(result),/ยืนยันปิดยอด/);assert.equal(confirmCalls(f.calls).length,1);
  await handleDailyCloseCardAction(input);assert.equal(confirmCalls(f.calls).length,1);
 }finally{f.restore();}
});
for(const mode of ['blocked','unbound'])test('does not confirm when '+mode,async()=>{
 const f=fixture(mode);try{await handleDailyCloseCardAction({targetHash:INTHANIN_TARGET_HASH,userId:actor,data:command()});assert.equal(confirmCalls(f.calls).length,0);}finally{f.restore();}
});
test('stale card and inactive confirmation rollout cannot perform financial writes',async()=>{
 const f=fixture();try{await handleDailyCloseCardAction({targetHash:INTHANIN_TARGET_HASH,userId:actor,data:command('confirm',1)});
  delete process.env.INTHANIN_DAILY_CLOSE_CARD_CONFIRM_ENABLED;
  await handleDailyCloseCardAction({targetHash:INTHANIN_TARGET_HASH,userId:actor,data:command()});assert.equal(confirmCalls(f.calls).length,0);
 }finally{f.restore();}
});
test('race rejection produces latest card and never says it confirmed',async()=>{
 const f=fixture('race');try{const result=await handleDailyCloseCardAction({targetHash:INTHANIN_TARGET_HASH,userId:actor,data:command()});
  assert.match(JSON.stringify(result),/ยังไม่ได้ยืนยัน/);assert.equal(f.current.status,'draft');
 }finally{f.restore();}
});
test('edit is a read-only route to existing backoffice; malformed payload does no I/O',async()=>{
 const f=fixture();try{const result=await handleDailyCloseCardAction({targetHash:INTHANIN_TARGET_HASH,userId:actor,data:command('edit')});
  assert.match(JSON.stringify(result),/https:\/\/tamma-backoffice.netlify.app\//);assert.equal(confirmCalls(f.calls).length,0);
  const count=f.calls.length;await handleDailyCloseCardAction({targetHash:INTHANIN_TARGET_HASH,userId:actor,data:'inthanin-close:{"action":"confirm"}'});assert.equal(f.calls.length,count);
 }finally{f.restore();}
});

test('atomic SQL wrapper enforces branch/day/live/revision, canonical readiness, owner actor shape and server-only ACL',async()=>{
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table operations_business_branches(id uuid primary key,code text,active boolean);
 create table financial_daily_closes(id uuid primary key,branch_id uuid,environment text,local_date date,revision int,status text,ready boolean default true);
 create function financial_confirm_inthanin_live_daily_close_v1(uuid,text,text) returns jsonb language plpgsql as $$begin
 if not (select ready from financial_daily_closes where id=$1) then return '{"confirmed":false}'::jsonb;end if;
 update financial_daily_closes set status='confirmed',revision=revision+1 where id=$1;
 return '{"confirmed":true}'::jsonb;end;$$;
 insert into operations_business_branches values('${INTHANIN_BRANCH_ID}','inthanin_tadtone',true);
 insert into financial_daily_closes values('${id}','${INTHANIN_BRANCH_ID}','live','2037-10-11',2,'draft',false);`);
 await db.exec(readFileSync('sql-drafts/inthanin_daily_close_card_confirmation.sql','utf8'));
 const call=async(revision=2,date='2037-10-11',actorHash=hash)=>(await db.query<{result:any}>('select financial_confirm_inthanin_daily_close_card_v1($1,$2,$3,$4) result',[id,date,revision,actorHash])).rows[0].result;
 assert.equal((await call()).confirmed,false);assert.equal((await call(1)).reason,'stale_revision');
 await assert.rejects(call(2,'2037-10-10'),/scope_mismatch/);await assert.rejects(call(2,'2037-10-11','not-owner-hash'),/owner_actor_required/);
 await db.exec(`update financial_daily_closes set ready=true where id='${id}'`);assert.equal((await call()).confirmed,true);
 assert.equal((await call()).reason,'stale_revision');
 const saved=(await db.query<any>('select revision,status from financial_daily_closes')).rows[0];assert.deepEqual(saved,{revision:3,status:'confirmed'});
 const acl=(await db.query<any>("select has_function_privilege('anon','financial_confirm_inthanin_daily_close_card_v1(uuid,date,integer,text)','execute') anon, has_function_privilege('authenticated','financial_confirm_inthanin_daily_close_card_v1(uuid,date,integer,text)','execute') authenticated,has_function_privilege('service_role','financial_confirm_inthanin_daily_close_card_v1(uuid,date,integer,text)','execute') service")).rows[0];
 assert.deepEqual(acl,{anon:false,authenticated:false,service:true});
 }finally{await db.close();}
});

test('recognized missing-critical form gets a safe non-actionable card without a financial record',async()=>{
 const f=fixture();try{const card=await dailyCloseCardForReceipt({targetHash:INTHANIN_TARGET_HASH,close:null,missingText:'ยังขาดวันที่ ยังไม่บันทึกลง Daily Close เพื่อกันยอดผิดครับ'});
  assert.equal(card?.type,'flex');assert.match(JSON.stringify(card),/ยังไม่บันทึก/);assert.doesNotMatch(JSON.stringify(card),/inthanin-close:/);assert.equal(f.calls.length,2);assert.ok(f.calls.every(c=>/ops_notification_channels|operations_business_branches/.test(c.path)));
 }finally{f.restore();}
});
test('expired owner action does not read or confirm',async()=>{
 const f=fixture();try{await handleDailyCloseCardAction({targetHash:INTHANIN_TARGET_HASH,userId:actor,data:command(),receivedAt:Date.now()-50000});assert.equal(f.calls.length,0);}finally{f.restore();}
});

for(const mode of ['unbound','ambiguous-channel','foreign-channel','missing-branch','ambiguous-branch'])test('binding lookup rejects '+mode+' before financial access',async()=>{
 const f=fixture(mode);try{
  await handleDailyCloseCardAction({targetHash:INTHANIN_TARGET_HASH,userId:actor,data:command()});
  assert.ok(!f.calls.some(c=>/financial_/.test(c.path)));
  assert.equal(confirmCalls(f.calls).length,0);
 }finally{f.restore();}
});
