import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildWeeklyCashReport,weeklyCashFlex,weeklyWindow,type CashClose} from '../netlify/functions/_inthanin-weekly-cash-report';
import {loadWeeklyCashInput} from '../netlify/functions/_inthanin-weekly-cash';
import {prepareSundayCashReply,finishSundayCashReply,eligibleSundayReceipt,suppressDuplicateSundayReceipt} from '../netlify/functions/_inthanin-weekly-cash-reply';

const INTHANIN_BRANCH_ID='33333333-3333-4333-8333-333333333333';
const INTHANIN_CHANNEL_ID='22222222-2222-4222-8222-222222222222';
const INTHANIN_TARGET_HASH='a'.repeat(64);

// Entirely invented amounts and dates; never copied from a business report.
const closes:CashClose[]=[
 ['05',0,0,0,null],['06',1100,210,11,500],['07',1200,220,12,500],['08',1300,230,13,500],
 ['09',1400,240,14,500],['10',1500,250,15,500],['11',1600,260,16,500],
].map(([day,sales,cash,out,opening],i)=>({id:'close'+i,branch_id:INTHANIN_BRANCH_ID,environment:'live',
 local_date:'2037-10-'+day,status:'draft',net_sales:sales as number,payment_cash:cash as number,
 cash_drawer_outflow_amount:out as number,cash_opening_float:opening as number|null,cash_counted_closing:null,
 operational_metrics:i?{last_line_text_message_id:'fixture-'+i}:{}}));
const input=()=>({branchId:INTHANIN_BRANCH_ID,localDate:'2037-10-11',asOf:'2037-10-11 20:00',closes:structuredClone(closes),movements:[],bag:{bag_balance:123,last_movement_at:'2037-10-01T03:04:05Z'}});

test('Monday through Sunday inclusive, rejecting non-Sunday and invalid dates',()=>{
 assert.deepEqual(weeklyWindow('2037-10-11').dates,['2037-10-05','2037-10-06','2037-10-07','2037-10-08','2037-10-09','2037-10-10','2037-10-11']);
 assert.throws(()=>weeklyWindow('2037-10-12'));assert.throws(()=>weeklyWindow('2037-02-31'));
});
test('synthetic six-day fixture totals are generated cash, never cash collectible or float-deducted',()=>{
 const report=buildWeeklyCashReport(input());
 assert.deepEqual(report.totals,{sales:8100,receipts:1410,expenses:81,pickup:null});
 assert.equal(report.cashGenerated,1329);assert.equal(report.reported,6);assert.equal(report.confirmed,0);
 assert.equal(report.collectionAmount,null);assert.match(report.text,/ยังยืนยันไม่ได้/);
 assert.equal(report.rows[0].sales,null);assert.equal(report.rows[0].status,'missing');
 assert.ok(report.rows.every(r=>r.pickup===null&&r.count===null&&r.variance===null));
 assert.match(report.text,/ไม่พบรายการยืนยัน/);assert.match(report.text,/2,000/);
});
test('explicit zero-sales reporting is preserved while empty draft defaults remain missing',()=>{
 const data=input();data.closes[0].operational_metrics={last_line_text_message_id:'zero-sale-report'};
 const report=buildWeeklyCashReport(data);assert.equal(report.rows[0].sales,0);assert.equal(report.reported,7);
});
test('test environment and other branch records are excluded; duplicate dates rejected',()=>{
 const data=input();data.closes.push({...closes[1],branch_id:'other',net_sales:99999},{...closes[1],environment:'test',net_sales:88888});
 assert.equal(buildWeeklyCashReport(data).totals.sales,8100);
 data.closes.push({...closes[1]});assert.throws(()=>buildWeeklyCashReport(data),/Duplicate/);
});
test('physical counts and opening floats are not summed; recorded pickups retained',()=>{
 const data=input();data.closes.forEach(c=>{c.cash_counted_closing=1500;c.cash_opening_float=700;c.status='confirmed';});
 const result=buildWeeklyCashReport({...data,movements:[{local_date:'2037-10-08',movement_type:'owner_pickup',direction:'bag_out',amount:300,created_at:'2037-10-08T05:00:00Z'}]});
 assert.equal(result.totals.pickup,300);assert.equal(result.rows[3].pickup,300);assert.equal(result.collectionAmount,null);
 assert.match(result.text,/2037-10-11: 1,500/);assert.doesNotMatch(result.text,/10,500/);
});
test('mobile Flex uses two short daily tables without missing-as-zero or extra destinations',()=>{
 const report=buildWeeklyCashReport(input()),flex=weeklyCashFlex(report,'2037-10-11 20:00') as any;
 assert.equal(flex.type,'carousel');assert.equal(flex.contents.length,2);
 assert.equal(flex.contents[0].body.contents.length,10);assert.equal(flex.contents[1].body.contents.length,10);
 assert.match(JSON.stringify(flex),/ยอดเจ้าของรับ: ยังยืนยันไม่ได้/);
 assert.ok(Buffer.byteLength(JSON.stringify(flex))<30000);
});
test('entirely absent data stays null, and partially missing cash fields are not silently summed',()=>{
 const data=input();data.closes=[];const empty=buildWeeklyCashReport(data);
 assert.deepEqual(empty.totals,{sales:null,receipts:null,expenses:null,pickup:null});assert.equal(empty.cashGenerated,null);
 const partial=input();partial.closes[1].cash_drawer_outflow_amount=null;
 const result=buildWeeklyCashReport(partial);assert.equal(result.cashCoveredDays,5);assert.equal(result.cashGenerated,1130);
});

test('expense-only draft or a cash count is not proof of a zero-sales daily report',()=>{
 const data=input();data.closes[0].cash_drawer_outflow_amount=100;data.closes[0].cash_counted_closing=700;
 const report=buildWeeklyCashReport(data);assert.equal(report.rows[0].sales,null);assert.equal(report.rows[0].expenses,100);assert.equal(report.cashGenerated,1329);assert.equal(report.rows[0].count,700);assert.equal(report.reported,6);
});

const NOW=Date.parse('2037-10-11T11:16:52Z');
const receipt=()=>({targetHash:INTHANIN_TARGET_HASH,eventTimestamp:NOW,receivedAt:NOW,
 close:{dailyCloseId:'close6',localDate:'2037-10-11',environment:'live' as const,status:'draft',messageId:'fixture-source-message'}});
function mockReplySource(mode='success'){
 const saved={fetch:globalThis.fetch,env:{...process.env}};let audit=false;const writes:Array<{path:string,method:string,body:any}>=[];
 process.env.SUPABASE_URL='https://fixture.invalid';process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic-test-only';
 globalThis.fetch=async(url,init)=>{
  const path=String(url),method=init?.method??'GET';
  if(method!=='GET')writes.push({path,method,body:init?.body?JSON.parse(init.body as string):null});
  if(path.includes('financial_daily_close_effective_v1'))return Response.json(mode==='truncated'?Array(1000).fill(closes[0]):closes,{status:mode==='source-error'?503:200});
  if(path.includes('financial_cash_custody_movements'))return Response.json([]);
  if(path.includes('financial_cash_bag_owner_v1'))return Response.json([{bag_balance:123,last_movement_at:'2037-10-01T03:04:05Z'}]);
  if(path.includes('operations_business_branches'))return Response.json([{id:INTHANIN_BRANCH_ID}]);
  if(path.includes('ops_notification_channels'))return Response.json(mode==='unbound'?[]:[{id:INTHANIN_CHANNEL_ID,target_id_hash:INTHANIN_TARGET_HASH}]);
  if(path.includes('ops_notification_deliveries')){
   if(method==='POST'){if(audit)return Response.json([]);audit=true;return Response.json([{id:'delivery1',status:'pending'}]);}
   if(method==='PATCH')return new Response(null,{status:204});
   return Response.json([{payload:{source_message_id:'fixture-source-message'}}]);
  }
  throw new Error('Unexpected request '+path);
 };
 return {writes,restore:()=>{globalThis.fetch=saved.fetch;process.env=saved.env;}};
}
test('eligibility is exact live cafe Sunday text receipt, not confirmation permission or POS image',()=>{
 const event=receipt();assert.equal(eligibleSundayReceipt(event,NOW),true);
 assert.equal(eligibleSundayReceipt({...event,targetHash:'other-group'},NOW),false);
 assert.equal(eligibleSundayReceipt({...event,close:null},NOW),false);
 assert.equal(eligibleSundayReceipt({...event,close:{...event.close,environment:'test'}},NOW),false);
 assert.equal(eligibleSundayReceipt({...event,eventTimestamp:Date.parse('2037-10-10T11:00:00Z')},NOW),false);
 assert.equal(eligibleSundayReceipt({...event,receivedAt:NOW-50000},NOW),false);
 assert.equal(eligibleSundayReceipt({...event,close:{...event.close,localDate:'2037-10-04'}},NOW),false);
});
test('prepares only one carousel, writes operational audit only, dedupes week including failed/uncertain attempts',async()=>{
 const mock=mockReplySource();try{
  const event=receipt(),prepared=await prepareSundayCashReply(event,NOW);assert.ok(prepared&&'message' in prepared);assert.equal(prepared.message.type,'flex');
  assert.equal((prepared.message.contents as any).contents.length,2);
  await finishSundayCashReply(prepared.deliveryId,false);
  assert.deepEqual(await prepareSundayCashReply(event,NOW),{suppressReply:true});
  assert.ok(mock.writes.every(w=>w.path.includes('ops_notification_deliveries')));
  assert.equal(mock.writes[0].body.idempotency_key,'inthanin_weekly_reply:2037-10-11');
  assert.equal(mock.writes[0].body.payload.collection_amount,null);
  assert.equal(mock.writes[0].body.payload.totals.pickup,null);
  assert.ok(mock.writes.every(w=>!JSON.stringify(w.body).includes('replyToken')));
 }finally{mock.restore();}
});
for(const mode of ['unbound','source-error','truncated'])test('fails closed before reserving reply: '+mode,async()=>{
 const mock=mockReplySource(mode);try{await assert.rejects(prepareSundayCashReply(receipt(),NOW));assert.equal(mock.writes.length,0);}finally{mock.restore();}
});
test('mismatched canonical close cannot attach a weekly reply',async()=>{
 const mock=mockReplySource();try{const event=receipt();event.close.dailyCloseId='wrong';await assert.rejects(prepareSundayCashReply(event,NOW),/canonical/);assert.equal(mock.writes.length,0);}finally{mock.restore();}
});
test('no added cron or push code remains; same reply receives at most one new Flex object',()=>{
 const integration=readFileSync('netlify/functions/line-webhook.ts','utf8');
 assert.match(integration,/onRecorded:close=>/);assert.match(integration,/weekly.message/);
 assert.match(integration,/MAX_LINE_MESSAGES = 5/);assert.match(integration,/remainingMessages/);
 const helper=readFileSync('netlify/functions/_inthanin-weekly-cash-reply.ts','utf8');
 assert.doesNotMatch(helper,/api.line.me|message\/push|schedule:/);
 const confirm=readFileSync('netlify/functions/_inthanin-daily-close-confirm.ts','utf8');
 assert.match(confirm,/if\(team==='cafe'&&command.kind==='confirm'\)/);
});
test('read-only preview requires no LINE request and no audit write',async()=>{
 const mock=mockReplySource();try{await loadWeeklyCashInput(new Date('2037-10-11T11:00:00Z'),INTHANIN_BRANCH_ID);assert.equal(mock.writes.length,0);}finally{mock.restore();}
});

test('weekly count difference follows canonical read-only reconciliation formula when all values known',()=>{
 const data=input();data.closes[6].cash_counted_closing=744;
 const report=buildWeeklyCashReport(data);assert.equal(report.rows[6].variance,0);
 data.closes[6].cash_counted_closing=739;assert.equal(buildWeeklyCashReport(data).rows[6].variance,-5);
});

test('too-old redelivery cannot reserve a weekly audit or consume a reply',async()=>{
 const mock=mockReplySource();try{const event=receipt();event.eventTimestamp=NOW-20*60*1000;
  assert.equal(await prepareSundayCashReply(event,NOW),null);assert.equal(mock.writes.length,0);
 }finally{mock.restore();}
});
test('void rows do not enter the week totals or masquerade as drafts',()=>{
 const data=input();data.closes[6].status='void';const report=buildWeeklyCashReport(data);
 assert.equal(report.rows[6].sales,null);assert.equal(report.rows[6].status,'missing');assert.equal(report.totals.sales,6500);
});
test('concurrent same webhook has exactly one reserved reply; a new form gets only its own daily receipt',async()=>{
 const mock=mockReplySource();try{
  const event=receipt();const outcomes=await Promise.all([prepareSundayCashReply(event,NOW),prepareSundayCashReply(event,NOW)]);
  let replyTokenUsed=false,replyCount=0,weeklyCount=0;
  // Losing duplicate runs first, reproducing the dangerous scheduling order.
  outcomes.sort((a,b)=>Number(Boolean(b&&'suppressReply' in b))-Number(Boolean(a&&'suppressReply' in a)));
  for(const outcome of outcomes){
   if(outcome&&'suppressReply' in outcome)continue;
   assert.equal(replyTokenUsed,false);replyTokenUsed=true;replyCount++;if(outcome)weeklyCount++;
  }
  assert.equal(replyCount,1);assert.equal(weeklyCount,1);
  const newer={...event,close:{...event.close,messageId:'new-sunday-form'}};
  assert.equal(await prepareSundayCashReply(newer,NOW),null);
 }finally{mock.restore();}
});

test('canonical same-message duplicate is suppressed before source failures or token-budget fallback',()=>{
 const event=receipt();event.close={...event.close,duplicate:true} as typeof event.close;
 assert.equal(suppressDuplicateSundayReceipt(event),true);
 assert.equal(suppressDuplicateSundayReceipt({...event,eventTimestamp:NOW-60000}),true);
 assert.equal(suppressDuplicateSundayReceipt({...event,close:{...event.close,duplicate:false}}),false);
 assert.equal(suppressDuplicateSundayReceipt({...event,eventTimestamp:Date.parse('2037-10-10T11:00:00Z')}),false);
 const source=readFileSync('netlify/functions/line-webhook.ts','utf8');
 const start=source.indexOf('if (dailyCloseReply)');assert.ok(source.indexOf('suppressDuplicateSundayReceipt',start)<source.indexOf('dailyCloseCardForReceipt',start));
});

test('near-expired redelivery leaves reply headroom and cannot reserve the week',async()=>{
 const mock=mockReplySource();try{const event=receipt();event.eventTimestamp=NOW-(20*60*1000-5000);
  assert.equal(await prepareSundayCashReply(event,NOW),null);assert.equal(mock.writes.length,0);
 }finally{mock.restore();}
});

test('valid-shaped foreign group cannot read financial data or reserve a weekly reply',async()=>{
 const mock=mockReplySource();const original=globalThis.fetch;let financialReads=0;
 globalThis.fetch=async(url,init)=>{if(String(url).includes('/financial_'))financialReads++;return original(url,init);};
 try{await assert.rejects(prepareSundayCashReply({...receipt(),targetHash:'b'.repeat(64)},NOW),/binding/);assert.equal(financialReads,0);assert.equal(mock.writes.length,0);}finally{mock.restore();}
});
