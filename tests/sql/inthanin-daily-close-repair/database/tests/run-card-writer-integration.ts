// Local-only integration: actual SQL writers and card/action code, mocked REST transport.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {buildActualFixture} from './build-actual-fixture.mjs';
import {dailyCloseCardForReceipt,handleDailyCloseCardAction} from '../../../../../netlify/functions/_inthanin-daily-close-card-actions';
import {decodeInthaninDailyCloseAction,encodeInthaninDailyCloseAction} from '../../../../../netlify/functions/_inthanin-daily-close-card';
async function main(){
const db=new PGlite(),originalFetch=globalThis.fetch,originalEnv={...process.env};
const actor='synthetic-owner',hash=createHash('sha256').update(actor).digest('hex'),target='b'.repeat(64),date='2037-01-10';
let confirmCalls=0,loseConfirmResponse=false;const checks:string[]=[];
const query=async(sql:string,args:any[]=[])=> (await db.query(sql,args)).rows as any[];
const rpc=async(name:string,args:any[]=[])=> (await query(`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) r`,args))[0].r;
try{
 await db.exec(buildActualFixture().sql);
 const initial=await rpc('financial_ingest_inthanin_live_text_v1',['synthetic-integration-report',hash,date,{gross_sales:100,payment_cash:100,cash_opening_float:20,cash_counted_closing:120}]);
 const id=initial.daily_close_id,branch=(await query('select branch_id from financial_daily_closes where id=$1',[id]))[0].branch_id;
 await rpc('financial_attach_inthanin_live_evidence_v1',['synthetic-pos',hash,date,'synthetic-pos-sha','financial-evidence','synthetic/pos.jpg','image/jpeg',{document_type:'pos_close',pos_net_sales:100,confidence:0.99,document_date_local:date}]);
 await rpc('financial_dedupe_transfer_followup_expenses_v1',[id]);
 await rpc('financial_record_cash_sweep_live_v1',[id,10,hash,'line']);
 await rpc('financial_rematch_inthanin_live_day_evidence_v1',[id]);
 const final=(await query('select * from financial_daily_closes where id=$1',[id]))[0];assert.ok(final.revision>initial.revision);
 process.env.SUPABASE_URL='https://synthetic.invalid';process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic-fixture-only';process.env.OWNER_FINANCE_LINE_USER_HASHES=hash;process.env.INTHANIN_DAILY_CLOSE_CARD_CONFIRM_ENABLED='true';
 globalThis.fetch=async(url,init)=>{
  const path=String(url),body=init?.body?JSON.parse(init.body as string):null;
  if(path.includes('operations_business_branches'))return Response.json([{id:branch}]);
  if(path.includes('ops_notification_channels'))return Response.json([{id:'00000000-0000-4000-8000-000000000001',target_id_hash:target}]);
  if(path.includes('financial_daily_close_effective_v1'))return Response.json((await query('select to_jsonb(e) row from financial_daily_close_effective_v1 e where id=$1 and branch_id=$2 and local_date=$3 and environment=\'live\'',[id,branch,date])).map(r=>r.row));
  if(path.includes('rpc/financial_reconcile_daily_close_v1'))return Response.json(await rpc('financial_reconcile_daily_close_v1',[body.p_daily_close_id]));
  if(path.includes('rpc/financial_confirm_inthanin_daily_close_card_v1')){
   confirmCalls++;const result=await rpc('financial_confirm_inthanin_daily_close_card_v1',[body.p_daily_close_id,body.p_expected_local_date,body.p_expected_revision,body.p_actor_hash]);
   if(loseConfirmResponse)throw new Error('synthetic response lost after committed write');return Response.json(result);
  }
  throw new Error('Unexpected transport '+path);
 };
 const card=await dailyCloseCardForReceipt({targetHash:target,close:{dailyCloseId:id,localDate:date,environment:'live',status:'draft',messageId:'synthetic-integration-report'}});
 function all(v:any):any[]{return !v||typeof v!=='object'?[]:Array.isArray(v)?v.flatMap(all):[v,...Object.values(v).flatMap(all)];}
 const actions=all(card).filter(n=>n.type==='postback').map(n=>decodeInthaninDailyCloseAction(n.data));assert.ok(actions.length>=2);assert.ok(actions.every(a=>a?.revision===final.revision));checks.push('Receipt card revision equals final persisted revision after actual ingest, attach, dedupe, sweep and rematch.');
 const act=(revision:number)=>({targetHash:target,userId:actor,data:encodeInthaninDailyCloseAction({id,localDate:date,revision,action:'confirm'})});
 await handleDailyCloseCardAction(act(initial.revision));assert.equal(confirmCalls,0);checks.push('Old ingest revision cannot confirm after later writer changes.');
 await handleDailyCloseCardAction(act(final.revision));assert.equal(confirmCalls,0);checks.push('Actual post-sweep cash discrepancy remains blocked.');
 const saved=await rpc('financial_save_inthanin_daily_close_draft_v1',[id,date,'live',final.revision,{cash_counted_closing:110},hash]);assert.equal(saved.saved,true);
 loseConfirmResponse=true;await assert.rejects(handleDailyCloseCardAction(act(saved.close.revision)),/response lost/);assert.equal(confirmCalls,1);
 const state=(await query('select status,revision from financial_daily_closes where id=$1',[id]))[0];assert.equal(state.status,'confirmed');
 loseConfirmResponse=false;const replay=await handleDailyCloseCardAction(act(saved.close.revision));assert.equal(confirmCalls,1);assert.match(JSON.stringify(replay),/ยืนยันปิดวันแล้ว/);checks.push('Commit-before-response failure is recovered by a fresh confirmed card; replay never performs another confirm.');
 console.log(checks.map(c=>'PASS '+c).join('\n'));fs.writeFileSync(new URL('./card-writer-integration-results.json',import.meta.url),JSON.stringify({passed:checks.length,checks,syntheticOnly:true},null,2)+'\n');
}finally{globalThis.fetch=originalFetch;process.env=originalEnv;await db.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
