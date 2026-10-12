import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {piiHash} from '../netlify/functions/_operations-db';
import {handleOwnerEmployeeAdvanceText,handleOwnerEmployeeAdvancePostback,isAuthorizedEmployeeAdvanceActor,employeeAdvancePurchaseCorrection} from '../netlify/functions/_owner-employee-advance';
import {buildOwnerEmployeeAdvanceCard,encodeAdvanceAction,decodeAdvanceAction,type AdvanceProposal,type AdvanceEmployee} from '../netlify/functions/_owner-employee-advance-card';
import {handleOwnerPayrollText,recordOwnerPayrollFromStoredSlip,handleOwnerPayrollImage} from '../netlify/functions/_owner-payroll';
import {prepareSlipProposal} from '../netlify/functions/_owner-slip-review';
import {partitionOwnerSlipMaintenance} from '../netlify/functions/_owner-slip-maintenance';

// Entirely synthetic employee, evidence, amounts, actor and group identities.
const ID='11111111-1111-4111-8111-111111111111', EMP='22222222-2222-4222-8222-222222222222', EMP2='33333333-3333-4333-8333-333333333333';
const date='2026-09-15', at=Date.parse(date+'T06:00:00Z');
const employee:AdvanceEmployee={employee_id:EMP,employee_key:'employee-test',full_name:'ทดสอบ ตัวอย่าง',nickname:'ทดสอบ',business_unit_code:'shared',role_label:'ฝ่ายทดสอบ',month_paid_advance:450};
const proposal:AdvanceProposal={kind:'employee_advance',event_type:'salary_advance',employee_query:'ทดสอบ',employee_id:EMP,business_unit_code:'shared',funding_source:'unknown',amount:125,occurred_on:date,purpose:'ทดสอบเบิกเงินเดือนล่วงหน้า',questions:[],monthly_sum_before:450};
const extraction={document_type:'transfer_slip',document_kind:'transfer_evidence',funds_direction:'outgoing',amount_total:125,document_date_local:date,confidence:0.95,payment_document_count:1};
const input={targetId:'synthetic-owner-group',userId:'synthetic-approver',messageId:'synthetic-message',timestamp:at};
function harness(t:any,options:{rows?:any[];candidates?:AdvanceEmployee[];result?:any;team?:string;staleOnce?:boolean}={}){
  const old={url:process.env.SUPABASE_URL,key:process.env.SUPABASE_SERVICE_ROLE_KEY,owners:process.env.OWNER_FINANCE_LINE_USER_HASHES,pause:process.env.OWNER_SLIP_REVIEW_MAINTENANCE};
  process.env.SUPABASE_URL='https://advance.example.test';process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic-key';process.env.OWNER_FINANCE_LINE_USER_HASHES=piiHash(input.userId)!;
  const groupHash=piiHash(input.targetId),actorHash=piiHash(input.userId);
  let rows=options.rows??[{id:ID,owner_group_hash:groupHash,source_user_hash:actorHash,status:'awaiting_purpose',amount:null,occurred_on:date,created_at:new Date(at-60000).toISOString(),purpose_raw:null,review_state:'draft',review_revision:1,review_data:{purpose:'',project_id:null},extraction_data:extraction}];
  const calls:Array<{path:string,method:string,body:any,url:URL}>=[];let commits=0;
  t.after(()=>{for(const [key,value] of [['SUPABASE_URL',old.url],['SUPABASE_SERVICE_ROLE_KEY',old.key],['OWNER_FINANCE_LINE_USER_HASHES',old.owners],['OWNER_SLIP_REVIEW_MAINTENANCE',old.pause]]){if(value===undefined)delete process.env[key!];else process.env[key!]=value;}});
  t.mock.method(globalThis,'fetch',async(raw:any,init:any={})=>{
    const url=new URL(String(raw)),path=url.pathname,body=init.body?JSON.parse(init.body):undefined;calls.push({path,method:init.method??'GET',body,url});
    if(path.endsWith('/ops_notification_channels'))return Response.json([{team_code:options.team??'owner_general'}]);
    if(path.endsWith('/financial_owner_expense_intakes'))return Response.json(rows);
    if(path.endsWith('/owner_employee_advance_context_v1'))return Response.json({ok:true,candidates:options.candidates??[employee],month_start:'2026-09-01',month_end:'2026-10-01'});
    if(path.endsWith('/financial_stage_owner_employee_advance_v1')){
      const row=rows.find(r=>r.id===body.p_intake_id); assert.equal(body.p_actor_hash,actorHash);assert.equal(body.p_group_hash,groupHash);
      if(row.review_revision!==body.p_revision)return Response.json({conflict:true});
      row.review_data=body.p_proposal;row.review_revision++;row.review_state='draft';
      return Response.json({ok:true,revision:row.review_revision,proposal:row.review_data});
    }
    if(path.endsWith('/financial_confirm_owner_employee_advance_v1')){
      commits++;
      if(options.staleOnce&&commits===1)return Response.json({changed:true});
      rows[0].review_state='confirmed';
      return Response.json(options.result??{ok:true,event_id:'44444444-4444-4444-8444-444444444444',duplicate:commits>1,employee,amount:125,occurred_on:date,funding_source:'business_account',monthly_sum:575});
    }
    if(path.endsWith('/financial_confirm_owner_slip_review_v1')){assert.equal(body.p_cancel,true);rows[0].review_state='cancelled';return Response.json({ok:true,state:'cancelled'});}
    throw new Error('Unexpected request '+path);
  });
  return {calls,rows,groupHash,actorHash,get commits(){return commits;}};
}
const strings=(value:any):string=>JSON.stringify(value);
const actions=(value:any):any[]=>{const found:any[]=[];const visit=(v:any)=>{if(v&&typeof v==='object'){if(v.type==='postback')found.push(decodeAdvanceAction(v.data));Object.values(v).forEach(visit);} };visit(value);return found.filter(Boolean);};
const readyRow=(hashes:{groupHash:any;actorHash:any},changes:any={})=>({id:ID,owner_group_hash:hashes.groupHash,source_user_hash:hashes.actorHash,status:'awaiting_purpose',amount:null,occurred_on:date,created_at:new Date(at-60000).toISOString(),purpose_raw:null,review_state:'draft',review_revision:4,review_data:structuredClone(proposal),extraction_data:structuredClone(extraction),...changes});

test('draft card clearly separates recorded total, this advance and projected total',()=>{
  const card=buildOwnerEmployeeAdvanceCard({id:ID,revision:4,proposal,employee});
  for(const value of ['ทดสอบ ตัวอย่าง','ฝ่ายทดสอบ','ส่วนกลาง','450 บาท','125 บาท','575 บาท','คาดการณ์','ยังไม่บันทึกยอด','ยังไม่ระบุ'])assert.match(strings(card),new RegExp(value));
  assert.equal(actions(card).filter(a=>a.action==='confirm').length,1);
  assert.doesNotMatch(strings(card),/เงินเดือนคงเหลือ|เงินเดือนสุทธิ:/u);
});
test('confirmed card uses authoritative DB sum and never falls back to the projection',()=>{
  const card=buildOwnerEmployeeAdvanceCard({id:ID,revision:4,proposal,employee,state:'confirmed',monthlySum:610});
  assert.match(strings(card),/610 บาท/);assert.doesNotMatch(strings(card),/575 บาท|คาดการณ์|ยืนยันบันทึก/);assert.equal(actions(card).length,0);
  const missing=buildOwnerEmployeeAdvanceCard({id:ID,revision:4,proposal,employee,state:'confirmed'});
  assert.match(strings(missing),/ยังอ่านยอดสะสมจากฐานข้อมูลไม่ได้/);assert.doesNotMatch(strings(missing),/575 บาท/);
});
test('unknown salary type and unbound or ambiguous employee never have a confirm button',()=>{
  for(const change of [{event_type:'unknown'},{employee_id:null},{monthly_sum_before:null},{business_unit_code:null},{questions:['ต้องตรวจ']},{amount:null}]){
    const card=buildOwnerEmployeeAdvanceCard({id:ID,revision:1,proposal:{...proposal,...change} as AdvanceProposal,employee});
    assert.equal(actions(card).some(a=>a.action==='confirm'),false,JSON.stringify(change));
  }
});
test('canonical button payloads preserve stable ID/revision and reject tampering',()=>{
  const action={id:ID,revision:4,action:'employee' as const,value:EMP};const data=encodeAdvanceAction(action);assert.deepEqual(decodeAdvanceAction(data),action);
  for(const value of [data+' ',data.replace('"revision":4','"revision":4,"revision":5'),data.replace(EMP,'nickname'),data.replace('"employee"','"delete"'),'owner-advance:{}'])assert.equal(decodeAdvanceAction(value),null);
  assert.throws(()=>encodeAdvanceAction({...action,revision:-1}));
});
test('large employee catalogs paginate, use unique IDs, and fit LINE limits',()=>{
  const candidates=Array.from({length:20},(_,n)=>({...employee,employee_id:n%2?EMP:EMP2,full_name:'ทดสอบ'.repeat(50)}));
  const card=buildOwnerEmployeeAdvanceCard({id:ID,revision:1,proposal:{...proposal,employee_id:null},candidates,page:1});
  assert.equal(actions(card).filter(a=>a.action==='employee').length,5);assert.ok(Buffer.byteLength(strings(card))<29000);
  for(const a of actions(card))assert.ok(Buffer.byteLength(encodeAdvanceAction(a))<=300);
});
test('finance authority fails closed for other participants and multiple configured owners',()=>{
  const hash=piiHash(input.userId)!;assert.equal(isAuthorizedEmployeeAdvanceActor(input.userId,{OWNER_FINANCE_LINE_USER_HASHES:hash}),true);
  for(const owners of ['',hash+','+piiHash('another-owner'),'malformed'])assert.equal(isAuthorizedEmployeeAdvanceActor(input.userId,{OWNER_FINANCE_LINE_USER_HASHES:owners}),false);
  assert.equal(isAuthorizedEmployeeAdvanceActor('another-owner',{OWNER_FINANCE_LINE_USER_HASHES:hash}),false);
});
test('bare employee advance only stages a card and asks its type',async t=>{
  const h=harness(t);const card=await handleOwnerEmployeeAdvanceText({...input,text:'ทดสอบเบิก'});
  assert.equal(h.commits,0);assert.equal(actions(card).some(a=>a.action==='salary'),true);assert.equal(actions(card).some(a=>a.action==='confirm'),false);
  assert.equal(h.rows[0].amount,null);assert.equal(h.rows[0].review_data.employee_id,EMP);assert.equal(h.rows[0].review_data.event_type,'unknown');
  assert.ok(h.calls.every(c=>!c.path.includes('create_owner_payroll')&&!c.path.includes('attach_owner_payroll')));
});
test('explicit salary advance resolves an existing employee and stages unknown funding',async t=>{
  const h=harness(t);const card=await handleOwnerEmployeeAdvanceText({...input,text:'ทดสอบเบิกเงินเดือน 125'});
  assert.equal(h.commits,0);assert.equal(h.rows[0].review_data.employee_id,EMP);assert.equal(h.rows[0].review_data.funding_source,'unknown');assert.ok(actions(card).some(a=>a.action==='confirm'));
});
test('same-name employees require stable employee selection',async t=>{
  const h=harness(t,{candidates:[employee,{...employee,employee_id:EMP2,business_unit_code:'adventure'}]});
  const card=await handleOwnerEmployeeAdvanceText({...input,text:'ทดสอบเบิกเงินเดือน 125'});
  assert.equal(h.rows[0].review_data.employee_id,null);assert.equal(actions(card).filter(a=>a.action==='employee').length,2);assert.equal(actions(card).some(a=>a.action==='confirm'),false);
});
test('unbound employee is not created and cannot be confirmed',async t=>{
  const h=harness(t,{candidates:[]});const card=await handleOwnerEmployeeAdvanceText({...input,text:'ทดสอบเบิกเงินเดือน 125'});
  assert.match(strings(card),/ยังไม่พบพนักงาน/);assert.equal(h.rows[0].review_data.employee_id,null);assert.equal(h.commits,0);
});
test('another participant cannot read payroll details or stage/confirm drafts',async t=>{
  const h=harness(t);assert.equal(await handleOwnerEmployeeAdvanceText({...input,userId:'participant',text:'ทดสอบเบิกเงินเดือน 125'}),null);
  const result=await handleOwnerEmployeeAdvancePostback({...input,userId:'participant',data:encodeAdvanceAction({id:ID,revision:4,action:'confirm'})});
  assert.match(strings(result),/เฉพาะเจ้าของที่มีสิทธิ์/);assert.equal(h.calls.length,0);
});
test('wrong group and wrong source actor cannot operate a draft',async t=>{
  const h=harness(t);h.rows[0].owner_group_hash='other-group';
  assert.match(strings(await handleOwnerEmployeeAdvancePostback({...input,data:encodeAdvanceAction({id:ID,revision:1,action:'confirm'})})),/ไม่พบการ์ด/);assert.equal(h.commits,0);
  h.rows[0].owner_group_hash=h.groupHash;h.rows[0].source_user_hash='someone-else';
  assert.match(strings(await handleOwnerEmployeeAdvancePostback({...input,data:encodeAdvanceAction({id:ID,revision:1,action:'confirm'})})),/ไม่พบการ์ด/);assert.equal(h.commits,0);
});
test('stale card revisions never write a financial event',async t=>{
  const h=harness(t);h.rows[0]=readyRow(h);
  const result=await handleOwnerEmployeeAdvancePostback({...input,data:encodeAdvanceAction({id:ID,revision:3,action:'confirm'})});
  assert.match(strings(result),/ข้อมูลเปลี่ยน/);assert.equal(h.commits,0);
});
test('explicit confirm returns the saved database total and exact funding source',async t=>{
  const h=harness(t);h.rows[0]=readyRow(h);
  const result=await handleOwnerEmployeeAdvancePostback({...input,data:encodeAdvanceAction({id:ID,revision:4,action:'confirm'})});
  assert.equal(h.commits,1);assert.match(strings(result),/บันทึกเงินเบิกแล้ว|575 บาท|บัญชีกิจการ/);assert.equal(actions(result).length,0);
});
test('repeat confirmation is idempotent and reports authoritative existing total',async t=>{
  const h=harness(t);h.rows[0]=readyRow(h);const data=encodeAdvanceAction({id:ID,revision:4,action:'confirm'});
  await handleOwnerEmployeeAdvancePostback({...input,data});const repeat=await handleOwnerEmployeeAdvancePostback({...input,messageId:'repeat',data});
  assert.equal(h.commits,2);assert.match(strings(repeat),/รายการนี้บันทึกแล้ว/);assert.equal(actions(repeat).length,0);
});
test('changed database monthly balance re-stages a new revision for approval',async t=>{
  const h=harness(t,{staleOnce:true,candidates:[{...employee,month_paid_advance:500}]});h.rows[0]=readyRow(h);
  const result=await handleOwnerEmployeeAdvancePostback({...input,data:encodeAdvanceAction({id:ID,revision:4,action:'confirm'})});
  assert.equal(h.commits,1);assert.equal(h.rows[0].review_state,'draft');assert.equal(h.rows[0].review_revision,5);assert.match(strings(result),/500 บาท|625 บาท/);
});
test('missing authoritative sum does not claim a successful saved amount',async t=>{
  const h=harness(t,{result:{ok:true,event_id:'event',employee,amount:125,occurred_on:date}});h.rows[0]=readyRow(h);
  const result=await handleOwnerEmployeeAdvancePostback({...input,data:encodeAdvanceAction({id:ID,revision:4,action:'confirm'})});
  assert.match(strings(result),/ยังยืนยันผลบันทึกหรือยอดสะสม/);assert.doesNotMatch(strings(result),/575 บาท|บันทึกเงินเบิกแล้ว/);
});
for(const document_kind of ['quotation','unpaid_invoice','contract','unknown'])test('non-payment '+document_kind+' cannot stage salary payment',async t=>{
  const h=harness(t);h.rows[0].extraction_data={...extraction,document_kind};
  await handleOwnerEmployeeAdvanceText({...input,text:'ทดสอบเบิกเงินเดือน 125'});
  assert.equal(h.calls.some(c=>c.path.endsWith('/financial_stage_owner_employee_advance_v1')),false);assert.equal(h.commits,0);
});
test('amount mismatch and multiple candidate slips require clarification',async t=>{
  const h=harness(t);const mismatch=await handleOwnerEmployeeAdvanceText({...input,text:'ทดสอบเบิกเงินเดือน 126'});assert.match(strings(mismatch),/ไม่ตรงกับสลิป/);
  h.rows.push({...h.rows[0],id:'55555555-5555-4555-8555-555555555555'});
  const multiple=await handleOwnerEmployeeAdvanceText({...input,text:'ทดสอบเบิกเงินเดือน 125'});assert.match(strings(multiple),/หลายสลิป/);assert.equal(h.commits,0);
});
test('later keeps draft; cancel closes only the chosen draft without money write',async t=>{
  const h=harness(t);h.rows[0]=readyRow(h);
  await handleOwnerEmployeeAdvancePostback({...input,data:encodeAdvanceAction({id:ID,revision:4,action:'later'})});assert.equal(h.rows[0].review_state,'draft');
  const result=await handleOwnerEmployeeAdvancePostback({...input,data:encodeAdvanceAction({id:ID,revision:4,action:'cancel'})});assert.equal(h.rows[0].review_state,'cancelled');assert.equal(h.commits,0);assert.equal(actions(result).length,0);
});
test('funding selection changes only the staged proposal and bumps revision',async t=>{
  const h=harness(t);h.rows[0]=readyRow(h);
  await handleOwnerEmployeeAdvancePostback({...input,data:encodeAdvanceAction({id:ID,revision:4,action:'funding',value:'business_account'})});
  assert.equal(h.rows[0].review_data.funding_source,'business_account');assert.equal(h.rows[0].review_revision,5);assert.equal(h.commits,0);
});
test('legacy text and stored-slip APIs cannot auto-create salary advances',async t=>{
  const h=harness(t);
  assert.match(await handleOwnerPayrollText({...input,text:'เบิกเงินเดือน ทดสอบ 125'})??'',/ยังไม่บันทึกยอด/);
  assert.match(await recordOwnerPayrollFromStoredSlip({...input,intakeId:ID,employeeLabel:'ทดสอบ',eventType:'salary_advance'}),/ยังไม่บันทึกยอด/);
  assert.equal(h.calls.some(c=>c.method==='POST'),false);
});
test('image receipt for a legacy advance session cannot attach/auto-pay',async t=>{
  const oldOwners=process.env.OWNER_FINANCE_LINE_USER_HASHES,oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.OWNER_FINANCE_LINE_USER_HASHES=piiHash(input.userId)!;process.env.SUPABASE_URL='https://advance.example.test';process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic-key';
  t.after(()=>{for(const [k,v] of [['OWNER_FINANCE_LINE_USER_HASHES',oldOwners],['SUPABASE_URL',oldUrl],['SUPABASE_SERVICE_ROLE_KEY',oldKey]]){if(v===undefined)delete process.env[k!];else process.env[k!]=v;}});
  const calls:string[]=[];t.mock.method(globalThis,'fetch',async(raw:any)=>{const path=new URL(String(raw)).pathname;calls.push(path);if(path.endsWith('/ops_notification_channels'))return Response.json([{team_code:'owner_general'}]);if(path.endsWith('/financial_employee_payroll_events'))return Response.json([{id:ID,event_type:'salary_advance'}]);throw Error('unexpected image/write');});
  assert.equal(await handleOwnerPayrollImage({...input,messageId:'synthetic-image'}),null);assert.equal(calls.length,2);
});
test('webhook routes employee card before generic review and legacy payroll',()=>{
  const source=readFileSync('netlify/functions/line-webhook.ts','utf8');
  assert.ok(source.indexOf('const advanceReply=')<source.indexOf('const slipReviewReply ='));
  assert.ok(source.indexOf('const advanceCard=')<source.indexOf('const ownerSlipCard='));
  const generic=readFileSync('netlify/functions/_owner-slip-cards.ts','utf8');assert.match(generic,/kind==='employee_advance'/);
});
test('salary advance OCR cannot be prepared as a generic expense or investment',()=>{
  const p=prepareSlipProposal({note:'ทดสอบเบิกเงินเดือนล่วงหน้า ส่วนกลาง',extraction:extraction as any,projects:[],installments:[],choices:{business:'shared',project:null,category:'staff',destination:'operating_expense'}});
  assert.equal(p.expense_class,'uncategorized');assert.ok(p.questions.length);assert.match(p.questions.join(' '),/เงินเบิกพนักงาน/);
});
test('an existing OCR salary draft can move into the dedicated employee review',async t=>{
  const h=harness(t);h.rows[0].review_data={purpose:'ทดสอบเบิกเงินเดือนล่วงหน้า ส่วนกลาง',project_id:null,questions:[]};
  const card=await handleOwnerEmployeeAdvanceText({...input,text:'ทดสอบเบิกเงินเดือน 125'});
  assert.equal(h.rows[0].review_data.kind,'employee_advance');assert.ok(actions(card).some(a=>a.action==='confirm'));assert.equal(h.commits,0);
});
test('unreadable payment date never uses the upload date to choose a month',async t=>{
  const h=harness(t);h.rows[0].extraction_data={...extraction,document_date_local:null};
  const card=await handleOwnerEmployeeAdvanceText({...input,text:'ทดสอบเบิกเงินเดือน 125'});
  assert.equal(h.rows[0].review_data.occurred_on,null);assert.equal(actions(card).some(a=>a.action==='confirm'),false);assert.match(strings(card),/รอตรวจวันที่/);
});
test('monthly summary and unrelated messages are not swallowed by pending advance cards',async t=>{
  const h=harness(t);h.rows[0]=readyRow(h);h.rows.push({...readyRow(h),id:EMP2});
  for(const text of ['สรุปเบิกเงินเดือน','ยอดเบิกเงินเดือน','สวัสดีครับ'])assert.equal(await handleOwnerEmployeeAdvanceText({...input,text}),null);
});
test('pre-resume confirmation is rejected even when revision is current',async t=>{
  const h=harness(t);h.rows[0]=readyRow(h);const old=process.env.THONGTHAI_OWNER_SLIP_RESUME_AFTER;
  process.env.THONGTHAI_OWNER_SLIP_RESUME_AFTER=new Date(at+1000).toISOString();t.after(()=>{if(old===undefined)delete process.env.THONGTHAI_OWNER_SLIP_RESUME_AFTER;else process.env.THONGTHAI_OWNER_SLIP_RESUME_AFTER=old;});
  const card=await handleOwnerEmployeeAdvancePostback({...input,data:encodeAdvanceAction({id:ID,revision:4,action:'confirm'})});
  assert.match(strings(card),/พักรับสลิป/);assert.equal(h.commits,0);
});
test('maintenance preflight blocks advance callbacks before processing a batch',async()=>{
  const event={type:'postback',source:{type:'group',groupId:'synthetic-owner-group'},timestamp:at,postback:{data:encodeAdvanceAction({id:ID,revision:4,action:'confirm'})}};
  const result=await partitionOwnerSlipMaintenance([event],{THONGTHAI_OWNER_SLIP_MODE:'paused'},{team:async()=> 'owner_general',payrollPending:async()=>false,pendingIntakes:async()=>[],actorHash:()=>null});
  assert.deepEqual(result.blocked,[event]);assert.equal(result.allowed.length,0);
});
test('a referenced advance card can be reopened without creating another draft',async t=>{
  const h=harness(t);h.rows[0]=readyRow(h);const card=await handleOwnerEmployeeAdvanceText({...input,text:'#111111 สรุป'});
  assert.equal(actions(card).some(a=>a.action==='confirm'),true);assert.equal(h.calls.some(c=>c.path.includes('financial_stage')),false);
});
test('generic employee advance still requires choosing a person when only one is mapped',async t=>{
  const h=harness(t);const card=await handleOwnerEmployeeAdvanceText({...input,text:'พนักงานเบิก'});
  assert.equal(h.rows[0].review_data.employee_id,null);assert.equal(actions(card).filter(a=>a.action==='employee').length,1);assert.equal(h.commits,0);
});
test('paused unrelated owner chat stays quiet without reading review schema',async t=>{
  const h=harness(t);const old=process.env.THONGTHAI_OWNER_SLIP_MODE;process.env.THONGTHAI_OWNER_SLIP_MODE='paused';
  t.after(()=>{if(old===undefined)delete process.env.THONGTHAI_OWNER_SLIP_MODE;else process.env.THONGTHAI_OWNER_SLIP_MODE=old;});
  assert.equal(await handleOwnerEmployeeAdvanceText({...input,text:'สวัสดี'}),null);assert.equal(h.calls.some(c=>c.path.includes('financial_')),false);
});
test('purchase correction drops negated salary wording before expense classification',()=>{
  for(const text of ['ไม่ใช่เงินเดือน ไปซื้อของ ส่วนกลาง','ไม่ใช่เบิกเงินเดือน แต่ไปซื้อปุ๋ยส่วนกลาง']){
    const note=employeeAdvancePurchaseCorrection(text,'พนักงานตัวอย่าง');assert.doesNotMatch(note,/เงินเดือน/);
    const p=prepareSlipProposal({note,extraction:extraction as any,projects:[],installments:[]});
    assert.notEqual(p.expense_category,'staff');assert.ok(p.questions.length);
  }
});
