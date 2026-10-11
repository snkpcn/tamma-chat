import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {partitionOwnerSlipMaintenance,notifyOwnerSlipMaintenance,OWNER_SLIP_MAINTENANCE_REPLY} from '../netlify/functions/_owner-slip-maintenance';
import {handler} from '../netlify/functions/line-webhook';
import {handleOwnerSlipReviewText} from '../netlify/functions/_owner-slip-review';
import {handleOwnerExpenseImage} from '../netlify/functions/_owner-expense-intake';
import {piiHash} from '../netlify/functions/_operations-db';

const paused={THONGTHAI_OWNER_SLIP_MODE:'paused'};
const image={type:'message',replyToken:'fixture-reply',timestamp:Date.parse('2026-10-11T12:00:00Z'),
  source:{type:'group',groupId:'owner-group',userId:'owner'},message:{type:'image',id:'fixture-image'}};
const text=(value:string)=>({...image,message:{type:'text',id:'fixture-text',text:value}});
const review={...text('ตรวจสลิป'),message:{type:'text',id:'fixture-review',text:'ตรวจสลิป',quotedMessageId:'1234567890'}};
const draft={id:'aaaaaa11-1111-4111-8111-111111111111',source_user_hash:'hash-owner',status:'awaiting_purpose'};
const deps={team:async(target:string)=>target==='owner-group'?'owner_general':'cafe_test',
  payrollPending:async()=>false,pendingIntakes:async()=>[draft],actorHash:()=> 'hash-owner'};

test('active/unconfigured gate preserves routing without new lookups',async()=>{
 for(const env of [{},{THONGTHAI_OWNER_SLIP_MODE:'active'}]){
  const r=await partitionOwnerSlipMaintenance([image],env,{...deps,team:async()=>{throw Error('must not read');}});
  assert.deepEqual(r.allowed,[image]);assert.deepEqual(r.blocked,[]);
 }
});
test('paused/invalid configuration rejects explicit image review while leaving unsolicited images and payroll alone',async()=>{
 for(const mode of ['paused','typo',''])assert.deepEqual((await partitionOwnerSlipMaintenance([review],{THONGTHAI_OWNER_SLIP_MODE:mode},deps)).blocked,[review]);
 assert.deepEqual((await partitionOwnerSlipMaintenance([image],paused,deps)).allowed,[image]);
 assert.deepEqual((await partitionOwnerSlipMaintenance([image],paused,{...deps,payrollPending:async()=>true})).allowed,[image]);
 const others=[{...image,source:{...image.source,groupId:'cafe'}},{...image,source:{type:'user',userId:'customer'}},
   {...image,type:'postback'},text('ผูกทีม owner_general')];
 assert.deepEqual((await partitionOwnerSlipMaintenance(others,paused,deps)).allowed,others);
});
test('pending explicit confirmations, corrections and bot-addressed notes are rejected while ordinary conversation stays quiet',async()=>{
 const events=[text('ยืนยัน #AAAAAA v2'),text('#AAAAAA แก้เป็นค่าไฟ'),text('ยกเลิก #AAAAAA'),text('ทองไทย #AAAAAA อุปกรณ์ช่างไม้')];
 assert.deepEqual((await partitionOwnerSlipMaintenance(events,paused,deps)).blocked,events);
 const unrelated=[text('ยอดขายวันนี้เท่าไร'),text('#BBBBBB สรุปโครงการ'),text('อุปกรณ์ช่างไม้')];
 assert.deepEqual((await partitionOwnerSlipMaintenance(unrelated,paused,{...deps,pendingIntakes:async()=>[]})).allowed,unrelated);
 assert.equal((await partitionOwnerSlipMaintenance([text('อุปกรณ์ช่างไม้')],paused,{...deps,actorHash:()=> 'someone-else'})).blocked.length,0);
 assert.deepEqual((await partitionOwnerSlipMaintenance([text('ทองไทย อุปกรณ์ช่างไม้')],paused,deps)).allowed,[text('ทองไทย อุปกรณ์ช่างไม้')]);
});
test('resume cutoff rejects old or undated slip deliveries rather than auto-confirming them',async()=>{
 const env={THONGTHAI_OWNER_SLIP_MODE:'active',THONGTHAI_OWNER_SLIP_RESUME_AFTER:'2026-10-11T12:00:00Z'};
 const fresh={...review,timestamp:review.timestamp+1};
 const missing={...review,timestamp:undefined};
 const result=await partitionOwnerSlipMaintenance([review,missing,fresh],env,deps);
 assert.deepEqual(result.blocked,[review,missing]);assert.deepEqual(result.allowed,[fresh]);
 assert.equal((await partitionOwnerSlipMaintenance([fresh],{...env,THONGTHAI_OWNER_SLIP_RESUME_AFTER:'invalid'},deps)).blocked.length,1);
});
test('rejection is explicit and missing/failed notices never count as acknowledged',async()=>{
 const replies:string[]=[];
 await notifyOwnerSlipMaintenance([image],async(_token,message)=>{replies.push(message);});
 assert.deepEqual(replies,[OWNER_SLIP_MAINTENANCE_REPLY]);
 assert.match(replies[0],/ยังไม่ถูกรับเข้าระบบ/);assert.match(replies[0],/ส่งรูปพร้อมโน้ตหรือคำยืนยันใหม่/);
 await assert.rejects(()=>notifyOwnerSlipMaintenance([{...image,replyToken:undefined}],async()=>{}));
 await assert.rejects(()=>notifyOwnerSlipMaintenance([image],async()=>{throw Error('notice failure');}));
});

test('signed webhook: notice failure returns 503 before any unrelated dispatch or financial/provider write',async()=>{
 const oldFetch=globalThis.fetch;
 const keys=['THONGTHAI_OWNER_SLIP_MODE','LINE_CHANNEL_SECRET','LINE_CHANNEL_ACCESS_TOKEN','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'];
 const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 try{
  Object.assign(process.env,{THONGTHAI_OWNER_SLIP_MODE:'paused',LINE_CHANNEL_SECRET:'fixture-secret',
    LINE_CHANNEL_ACCESS_TOKEN:'fixture-token',SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture-service'});
  for(const failure of ['lookup','notice','missing-token','success']){
   const calls:string[]=[];
   globalThis.fetch=async(input,init)=>{
    const url=String(input);calls.push(url);
    if(url.includes('/rest/v1/ops_notification_channels'))return new Response(JSON.stringify([{team_code:'owner_general'}]),{status:failure==='lookup'?500:200});
    if(url.includes('/rest/v1/financial_employee_payroll_events'))return new Response('[]');
    if(url==='https://api.line.me/v2/bot/message/reply'){
      assert.match(String(init?.body),/ยังไม่ถูกรับเข้าระบบ/);
      return new Response('{}',{status:failure==='notice'?500:200});
    }
    throw Error('Unexpected route or write: '+url);
   };
   // Keep a customer in failure batches: it must not dispatch before notices succeed.
   const events=failure==='success'?[review]:[{...review,replyToken:failure==='missing-token'?undefined:review.replyToken},
     {...text('hello'),source:{type:'user',userId:'customer'}}];
   const body=JSON.stringify({events});
   const response:any=await handler({httpMethod:'POST',body,headers:{'x-line-signature':createHmac('sha256','fixture-secret').update(body).digest('base64')}} as any,{} as any,()=>{});
   assert.equal(response.statusCode,failure==='success'?200:503,failure);
   assert.ok(calls.every(url=>url.includes('/rest/v1/ops_notification_channels')||url.includes('/rest/v1/financial_employee_payroll_events')||url==='https://api.line.me/v2/bot/message/reply'));
  }
 }finally{globalThis.fetch=oldFetch;for(const key of keys){if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];}}
});

test('paused review handler needs no new schema; image handler cannot bypass gate after payroll race',async()=>{
 const oldFetch=globalThis.fetch,oldMode=process.env.THONGTHAI_OWNER_SLIP_MODE;
 const oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_SERVICE_ROLE_KEY,oldOwners=process.env.OWNER_FINANCE_LINE_USER_HASHES;
 try{
  process.env.OWNER_FINANCE_LINE_USER_HASHES=piiHash('owner')!;process.env.THONGTHAI_OWNER_SLIP_MODE='paused';process.env.SUPABASE_URL='https://fixture.invalid';process.env.SUPABASE_SERVICE_ROLE_KEY='fixture-only';
  globalThis.fetch=async()=>{throw Error('review must not query missing columns');};
  assert.equal(await handleOwnerSlipReviewText({targetId:'owner-group',text:'ยอดขายวันนี้',messageId:'fixture'}),null);
  globalThis.fetch=async(input)=>{
    assert.ok(String(input).includes('/rest/v1/ops_notification_channels'));
    return new Response(JSON.stringify([{team_code:'owner_general'}]));
  };
  assert.equal(await handleOwnerExpenseImage({targetId:'owner-group',userId:'owner',messageId:'fixture-image',intent:'payment_review'}),OWNER_SLIP_MAINTENANCE_REPLY);
 }finally{
  globalThis.fetch=oldFetch;
  for(const [key,value] of Object.entries({THONGTHAI_OWNER_SLIP_MODE:oldMode,SUPABASE_URL:oldUrl,SUPABASE_SERVICE_ROLE_KEY:oldKey,OWNER_FINANCE_LINE_USER_HASHES:oldOwners})){
    if(value===undefined)delete process.env[key];else process.env[key]=value;
  }
 }
});

