import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { handler as lineWebhookHandler } from '../netlify/functions/line-webhook';
import { applyOwnerProjectText, handleOwnerProjectText } from '../netlify/functions/_owner-project-os';
import { handleOwnerStaffSlipText } from '../netlify/functions/_owner-expense-intake';
import { parseOwnerPayrollCommand, recordOwnerPayrollFromStoredSlip } from '../netlify/functions/_owner-payroll';
import { parseOwnerStaffTurn, isOwnerScheduleAnswer, isOwnerFamilyConversation } from '../netlify/functions/_owner-staff-intent';

for (const text of ['เจิดเบิก','เจิด เบิก','เจิดเบิกครับ','ทองไทย เจิดเบิก','เบิกให้เจิด']) {
  test('natural employee advance: ' + text, () => {
    assert.deepEqual(parseOwnerStaffTurn(text), { employeeLabel:'เจิด',kind:'unknown',amount:null });
  });
}
test('employee, amount and short type follow-ups are understood without guessing payroll', () => {
  assert.deepEqual(parseOwnerStaffTurn('เจิด เบิก 200 บาท'), {employeeLabel:'เจิด',kind:'unknown',amount:200});
  assert.deepEqual(parseOwnerStaffTurn('พนักงานเบิก'), {employeeLabel:null,kind:'unknown',amount:null});
  assert.equal(parseOwnerStaffTurn('เจิด','พนักงานเบิก')?.employeeLabel,'เจิด');
  assert.equal(parseOwnerStaffTurn('เงินเดือน','เจิดเบิก')?.kind,'salary_advance');
  assert.equal(parseOwnerStaffTurn('ล่วงหน้า','เจิดเบิก')?.kind,'salary_advance');
  assert.equal(parseOwnerStaffTurn('เบิกไปซื้อของ','เจิดเบิก')?.kind,'purchase');
  assert.equal(parseOwnerStaffTurn('เบิกไปซื้อของ','เจิดเบิก')?.employeeLabel,'เจิด');
  assert.equal(parseOwnerStaffTurn('ซื้ออาหารม้า ผจญภัย','เจิดเบิกไปซื้อของ')?.kind,'purchase');
  assert.equal(parseOwnerStaffTurn('เงินเดือน'),null);
});
for (const text of ['เจิดไม่เบิก','เจิดไม่ได้เบิก','เจิดยังไม่เบิก','เจิดจะเบิก','ไม่มีใครเบิก','ไม่ได้ให้เจิดเบิก','พรุ่งนี้เจิดเบิก','เจิดเบิกอะไร','เบิกได้ไหม','แม่ เดี๋ยวคุยกัน']) {
  test('negation, future intent and questions are not payroll: ' + text, () => {
    assert.equal(parseOwnerStaffTurn(text),null);
  });
}
for (const expectedField of ['project_name','work_title','budget','counterparty','payment_plan','schedule','responsible'] as const) {
  test('employee advance cannot overwrite project ' + expectedField, () => {
    const data = {project_name:'เฉลียงไม้',work_title:'ค่าก่อสร้างเฉลียงไม้',budget_amount:100000,installment_count:5};
    assert.deepEqual(applyOwnerProjectText({text:'เจิดเบิก',intent:'investment_plan',data,expectedField}),{data,changed:false});
  });
}
test('a schedule accepts dates and timing, not arbitrary names or financial text', () => {
  for (const text of ['พรุ่งนี้','ภายในเดือนนี้','วันศุกร์','15/11/69','อีก 3 วัน']) assert.equal(isOwnerScheduleAnswer(text),true,text);
  for (const text of ['เจิดเบิก','เจิด','ซื้ออาหารม้า','โอนเงินแล้ว']) assert.equal(isOwnerScheduleAnswer(text),false,text);
  const data = applyOwnerProjectText({text:'เจิด',intent:'investment_plan',data:{project_name:'เฉลียงไม้'},expectedField:'schedule'}).data;
  assert.equal(data.schedule_text,undefined);
});

type Slip = {id:string; source_user_hash:string|null; status:string; amount:number|null; created_at:string; purpose_raw:string|null; occurred_on:string; document_type:string};
const at = Date.parse('2026-10-11T03:00:00Z');
const slip = (overrides:Partial<Slip>={}):Slip => ({
  id:'87044d4b-b8a8-41ab-a393-e8ab8a7b5597', source_user_hash:'mother-hash',
  status:'awaiting_purpose',amount:200,created_at:'2026-10-11T01:13:41Z',
  purpose_raw:null,occurred_on:'2026-10-11',document_type:'transfer_slip',...overrides,
});
function harness(t:any, rows:Slip[], config:{attachStatus?:string;createDuplicate?:boolean;createEventType?:string;tampered?:boolean;uploadStatus?:number;pendingError?:boolean;attachError?:boolean;team?:string}={}) {
  const oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  const oldSecret=process.env.LINE_CHANNEL_SECRET,oldToken=process.env.LINE_CHANNEL_ACCESS_TOKEN;
  process.env.SUPABASE_URL='https://staff-slip.test';process.env.SUPABASE_SERVICE_ROLE_KEY='mock-key';
  process.env.LINE_CHANNEL_SECRET='mock-line-secret';process.env.LINE_CHANNEL_ACCESS_TOKEN='mock-line-token';
  t.after(()=>{if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;
    if(oldKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=oldKey;
    if(oldSecret===undefined)delete process.env.LINE_CHANNEL_SECRET;else process.env.LINE_CHANNEL_SECRET=oldSecret;
    if(oldToken===undefined)delete process.env.LINE_CHANNEL_ACCESS_TOKEN;else process.env.LINE_CHANNEL_ACCESS_TOKEN=oldToken;});
  const bytes=Buffer.from('synthetic payroll evidence');
  const sha=createHash('sha256').update(bytes).digest('hex');
  const calls:Array<{path:string;method:string;body:any}>=[];
  t.mock.method(globalThis,'fetch',async(input:any,init:any={})=>{
    const url=new URL(String(input));const path=url.pathname;
    const body=typeof init.body==='string'?JSON.parse(init.body):undefined;
    calls.push({path,method:init.method??'GET',body});
    if(path.endsWith('/ops_notification_channels'))return Response.json([{team_code:config.team??'owner_general'}]);
    if(path.endsWith('/financial_owner_expense_intakes')){
      if(url.searchParams.has('id'))return Response.json(rows.filter(row=>url.searchParams.get('id')==='eq.'+row.id).map(row=>({...row,
        owner_group_hash:'irrelevant-returned-group',evidence_message_id:'original-line-image',
        evidence_sha256:sha,storage_bucket:'owner-expense-evidence',
        storage_path:'owner-group/2026-10-11/stored.png',mime_type:'image/png',
        extraction_confidence:0.95,extraction_data:{document_type:'transfer_slip',amount_total:row.amount,confidence:0.95},
      })));
      return Response.json(rows.filter(row=>['awaiting_purpose','awaiting_business'].includes(row.status)));
    }
    if(path.endsWith('/financial_create_owner_payroll_event_v1')){
      if(config.pendingError)return new Response('payroll_slip_pending',{status:400});
      return Response.json({ok:true,event_id:'payroll-event',event_type:config.createEventType??body.p_event_type,
        employee_label:body.p_employee_label,amount:body.p_amount,
        status:config.createDuplicate?'paid':'awaiting_slip',duplicate:config.createDuplicate??false});
    }
    if(path.includes('/storage/v1/object/authenticated/'))return new Response(config.tampered?'tampered':bytes);
    if(path.includes('/storage/v1/object/owner-payroll-evidence/'))return new Response('{}',{status:config.uploadStatus??200});
    if(path.endsWith('/financial_attach_owner_payroll_slip_v1')){
      if(config.attachError)return new Response('payroll_slip_already_used',{status:400});
      return Response.json({ok:true,event_id:'payroll-event',status:config.attachStatus??'paid'});
    }
    if(path.endsWith('/financial_mark_owner_expense_not_expense_v1'))return Response.json({ok:true,status:'cancelled'});
    if(path.endsWith('/financial_employee_advance_owner_v1'))return Response.json([{advance_outstanding:200}]);
    if(path.endsWith('/financial_stage_owner_expense_purpose_v1')){
      const row=rows.find(row=>row.id===body.p_intake_id);if(row){row.purpose_raw=body.p_purpose;row.status='awaiting_business';}
      return Response.json({ok:true,status:'awaiting_business'});
    }
    if(path==='/v2/bot/message/reply')return Response.json({});
    if(path.endsWith('/financial_resolve_owner_expense_intake_v1'))return Response.json({ok:true,status:'needs_review'});
    throw new Error('Unexpected route '+path);
  });
  return {calls};
}
const input = {targetId:'owner-test-group',userId:'son-test-user',messageId:'message-staff',timestamp:at};

test('son can clarify mother slip 106 minutes later, asks type, creates no payroll or project',async t=>{
  const h=harness(t,[slip()]);
  const reply=await handleOwnerStaffSlipText({...input,text:'เจิดเบิก'});
  assert.match(reply??'',/เจิดเบิก 200 บาท/);
  assert.match(reply??'',/เงินเดือนล่วงหน้าหรือเบิกไปซื้อของ/);
  const stage=h.calls.find(x=>x.path.endsWith('/financial_stage_owner_expense_purpose_v1'));
  assert.equal(stage?.body.p_intake_id,slip().id);
  assert.equal(stage?.body.p_expense_class,'uncategorized');
  assert.equal(stage?.body.p_purpose,'เจิดเบิก');
  assert.ok(!h.calls.some(x=>/payroll_event|owner_project|financial_resolve/.test(x.path)));
});
test('generic พนักงานเบิก asks only employee name',async t=>{
  harness(t,[slip()]);
  const reply=await handleOwnerStaffSlipText({...input,text:'พนักงานเบิก'});
  assert.match(reply??'',/200 บาท.*พนักงานคนไหน/);
});
test('missing employee is remembered and a name-only answer keeps slip amount',async t=>{
  harness(t,[slip({status:'awaiting_business',purpose_raw:'พนักงานเบิก'})]);
  const reply=await handleOwnerStaffSlipText({...input,text:'เจิด'});
  assert.match(reply??'',/เจิดเบิก 200 บาท/);
});
test('several slips require selection and perform no writes',async t=>{
  const h=harness(t,[slip(),slip({id:'second-slip',amount:500})]);
  const reply=await handleOwnerStaffSlipText({...input,text:'เจิดเบิก'});
  assert.match(reply??'',/2 รายการ/);
  assert.equal(h.calls.filter(x=>x.method==='POST').length,0);
});
test('an explicit matching amount selects one slip across owners',async t=>{
  const h=harness(t,[slip(),slip({id:'second-slip',amount:500})]);
  const reply=await handleOwnerStaffSlipText({...input,text:'เจิด เบิก 200'});
  assert.match(reply??'',/เจิดเบิก 200 บาท/);
  assert.equal(h.calls.find(x=>x.path.endsWith('/financial_stage_owner_expense_purpose_v1'))?.body.p_intake_id,slip().id);
});
test('equal-amount slips remain ambiguous',async t=>{
  const h=harness(t,[slip(),slip({id:'second-slip'})]);
  assert.match(await handleOwnerStaffSlipText({...input,text:'เจิด เบิก 200'})??'',/2 รายการ/);
  assert.equal(h.calls.filter(x=>x.method==='POST').length,0);
});
test('an old slip is only available through an explicit reference',async t=>{
  const h=harness(t,[slip({created_at:'2026-10-01T00:00:00Z'})]);
  assert.match(await handleOwnerStaffSlipText({...input,text:'เจิดเบิก'})??'',/ยังไม่พบสลิป/);
  assert.equal(h.calls.filter(x=>x.method==='POST').length,0);
  assert.match(await handleOwnerStaffSlipText({...input,text:'#87044d เจิดเบิก'})??'',/เจิดเบิก 200 บาท/);
});
test('a side question or negation makes no financial write',async t=>{
  const h=harness(t,[slip({purpose_raw:'เจิดเบิก'})]);
  for(const text of ['เจิดไม่เบิก','ขี่ม้ากี่บาท','เจิดจะเบิก','เบิกได้ไหม']){
    assert.equal(await handleOwnerStaffSlipText({...input,text}),null);
  }
  assert.equal(h.calls.filter(x=>x.method==='POST').length,0);
});
test('salary follow-up converts original slip once without asking for reupload',async t=>{
  const h=harness(t,[slip({status:'awaiting_business',purpose_raw:'เจิดเบิก'})]);
  const reply=await handleOwnerStaffSlipText({...input,text:'เงินเดือน'});
  assert.match(reply??'',/บันทึกเบิกเงินเดือนล่วงหน้าของ เจิด 200 บาท/);
  assert.match(reply??'',/ไม่เพิ่มเป็นค่าใช้จ่ายร้านหรือเงินลงทุน/);
  const create=h.calls.find(x=>x.path.endsWith('/financial_create_owner_payroll_event_v1'))!;
  assert.equal(create.body.p_employee_label,'เจิด');assert.equal(create.body.p_amount,200);
  assert.equal(create.body.p_message_id,'owner-slip-payroll:'+slip().id);
  const attach=h.calls.find(x=>x.path.endsWith('/financial_attach_owner_payroll_slip_v1'))!;
  assert.equal(attach.body.p_slip_message_id,'original-line-image');
  assert.equal(attach.body.p_storage_bucket,'owner-payroll-evidence');
  const close=h.calls.findIndex(x=>x.path.endsWith('/financial_mark_owner_expense_not_expense_v1'));
  assert.ok(close>h.calls.indexOf(attach));
  assert.ok(!h.calls.some(x=>/financial_resolve|record_line_investment|owner_project/.test(x.path)));
});
test('full natural salary description uses existing slip before legacy text-first payroll',async t=>{
  const h=harness(t,[slip()]);
  const reply=await handleOwnerStaffSlipText({...input,text:'เจิดเบิกเงินเดือน 200'});
  assert.match(reply??'',/พร้อมสลิปเดิม/);
  assert.equal(h.calls.filter(x=>x.path.endsWith('/financial_create_owner_payroll_event_v1')).length,1);
});
test('purchase advance waits for receipts and is excluded from shop costs',async t=>{
  const h=harness(t,[slip({status:'awaiting_business',purpose_raw:'เจิดเบิกไปซื้อของ'})]);
  const reply=await handleOwnerStaffSlipText({...input,text:'ซื้ออาหารม้า ผจญภัย'});
  assert.match(reply??'',/รอใบเสร็จ/);
  const write=h.calls.find(x=>x.path.endsWith('/financial_resolve_owner_expense_intake_v1'))!;
  assert.equal(write.body.p_expense_class,'uncategorized');assert.equal(write.body.p_expense_category,'petty_cash');
  assert.equal(write.body.p_confidence,0.65);
  assert.ok(!h.calls.some(x=>x.path.includes('payroll')));
});
test('a bare business answer does not classify an unknown advance as an expense',async t=>{
  const h=harness(t,[slip({status:'awaiting_business',purpose_raw:'เจิดเบิก'})]);
  assert.match(await handleOwnerStaffSlipText({...input,text:'ส่วนกลาง'})??'',/เงินเดือนล่วงหน้าหรือเบิกไปซื้อของ/);
  assert.ok(!h.calls.some(x=>/financial_resolve|payroll_event/.test(x.path)));
});
test('low-confidence evidence remains under review and does not enter confirmed totals',async t=>{
  const h=harness(t,[slip({purpose_raw:'เจิดเบิก'})],{attachStatus:'needs_review'});
  assert.match(await handleOwnerStaffSlipText({...input,text:'เงินเดือน'})??'',/ยังไม่ยืนยันยอด/);
  assert.ok(h.calls.some(x=>x.path.endsWith('/financial_mark_owner_expense_not_expense_v1')));
  assert.ok(!h.calls.some(x=>x.path.endsWith('/financial_employee_advance_owner_v1')));
});
test('retry of an attached event reuses the stable source, closes original and skips storage upload',async t=>{
  const h=harness(t,[slip({purpose_raw:'เจิดเบิก'})],{createDuplicate:true});
  assert.match(await handleOwnerStaffSlipText({...input,messageId:'retry-message',text:'เงินเดือน'})??'',/พร้อมสลิปเดิม/);
  assert.ok(!h.calls.some(x=>x.path.includes('/storage/')));
  assert.ok(h.calls.some(x=>x.path.endsWith('/financial_mark_owner_expense_not_expense_v1')));
});
test('conflicting payroll retries never change employee or payroll type',async t=>{
  const h=harness(t,[slip()],{createDuplicate:true,createEventType:'salary_payment'});
  const reply=await recordOwnerPayrollFromStoredSlip({...input,intakeId:slip().id,employeeLabel:'เจิด',eventType:'salary_advance'});
  assert.match(reply,/ข้อมูลไม่ตรงกัน/);
  assert.ok(!h.calls.some(x=>x.path.includes('/storage/')||x.path.endsWith('/financial_mark_owner_expense_not_expense_v1')));
});
test('tampered stored evidence cannot attach or close the original slip',async t=>{
  const h=harness(t,[slip()],{tampered:true});
  await assert.rejects(recordOwnerPayrollFromStoredSlip({...input,intakeId:slip().id,employeeLabel:'เจิด',eventType:'salary_advance'}),/hash_mismatch/);
  assert.ok(!h.calls.some(x=>x.path.endsWith('/financial_attach_owner_payroll_slip_v1')||x.path.endsWith('/financial_mark_owner_expense_not_expense_v1')));
});
test('attachment error retains original intake for safe retry',async t=>{
  const h=harness(t,[slip()],{attachError:true});
  await assert.rejects(recordOwnerPayrollFromStoredSlip({...input,intakeId:slip().id,employeeLabel:'เจิด',eventType:'salary_advance'}),/already_used/);
  assert.ok(!h.calls.some(x=>x.path.endsWith('/financial_mark_owner_expense_not_expense_v1')));
});
test('another pending payroll event does not capture this slip or alter project',async t=>{
  const h=harness(t,[slip({purpose_raw:'เจิดเบิก'})],{pendingError:true});
  assert.match(await handleOwnerStaffSlipText({...input,text:'เงินเดือน'})??'',/ก่อนหน้ารอสลิป/);
  assert.ok(!h.calls.some(x=>x.path.includes('/storage/')||x.path.endsWith('/financial_mark_owner_expense_not_expense_v1')));
});
test('other teams cannot enter the private owner staff flow',async t=>{
  const h=harness(t,[slip()],{team:'cafe_test'});
  assert.equal(await handleOwnerStaffSlipText({...input,text:'เจิดเบิก'}),null);
  assert.equal(h.calls.length,1);
});
test('project handler releases a financial topic before it reads or patches the old draft',async t=>{
  const h=harness(t,[slip()]);
  assert.equal(await handleOwnerProjectText({...input,text:'เจิดเบิก'}),null);
  assert.ok(!h.calls.some(x=>x.path.includes('owner_project')));
});

test('known salary type is preserved when employee name is supplied later',async t=>{
  harness(t,[slip({purpose_raw:'พนักงานเบิกเงินเดือนล่วงหน้า'})]);
  assert.match(await handleOwnerStaffSlipText({...input,text:'เจิด'})??'',/บันทึกเบิกเงินเดือนล่วงหน้าของ เจิด 200 บาท/);
});
test('unreadable amount asks one missing question and preserves salary context',async t=>{
  const h=harness(t,[slip({amount:null,purpose_raw:'เจิดเบิก'})]);
  assert.match(await handleOwnerStaffSlipText({...input,text:'เงินเดือน'})??'',/จำนวนกี่บาท/);
  assert.equal(h.calls.find(x=>x.path.endsWith('/financial_stage_owner_expense_purpose_v1'))?.body.p_purpose,'เจิดเบิกเงินเดือนล่วงหน้า');
  assert.ok(!h.calls.some(x=>x.path.endsWith('/financial_create_owner_payroll_event_v1')));
});
test('owner amount clarification still needs evidence review when original slip was unreadable',async t=>{
  const h=harness(t,[slip({amount:null,purpose_raw:'เจิดเบิกเงินเดือนล่วงหน้า'})],{attachStatus:'needs_review'});
  assert.match(await handleOwnerStaffSlipText({...input,text:'200'})??'',/ยังไม่ยืนยันยอด/);
  assert.equal(h.calls.find(x=>x.path.endsWith('/financial_create_owner_payroll_event_v1'))?.body.p_amount,200);
  assert.equal(h.calls.find(x=>x.path.endsWith('/financial_attach_owner_payroll_slip_v1'))?.body.p_slip_amount,null);
});

test('payroll summaries and deductions leave pending staff slips untouched',async t=>{
  const h=harness(t,[slip({purpose_raw:'เจิดเบิก'})]);
  for(const text of ['สรุปเบิกเงินเดือน','ยอดเบิกเงินเดือน','หักเบิก เจิด 200','หักเงินเดือนล่วงหน้า เจิด 200']){
    assert.equal(parseOwnerStaffTurn(text),null);
    assert.equal(await handleOwnerStaffSlipText({...input,text}),null);
  }
  assert.equal(h.calls.filter(x=>x.method==='POST').length,0);
});
test('an unnamed salary payment retains payment kind while asking for a name',async t=>{
  const h=harness(t,[slip()]);
  assert.match(await handleOwnerStaffSlipText({...input,text:'จ่ายเงินเดือน'})??'',/พนักงานคนไหน/);
  assert.equal(h.calls.find(x=>x.path.endsWith('/financial_stage_owner_expense_purpose_v1'))?.body.p_purpose,'จ่ายเงินเดือน พนักงาน');
});
test('a name answer to a salary payment does not become an advance',async t=>{
  const h=harness(t,[slip({purpose_raw:'จ่ายเงินเดือน พนักงาน'})]);
  assert.match(await handleOwnerStaffSlipText({...input,text:'เจิด'})??'',/บันทึกจ่ายเงินเดือนของ เจิด/);
  assert.equal(h.calls.find(x=>x.path.endsWith('/financial_create_owner_payroll_event_v1'))?.body.p_event_type,'salary_payment');
});
test('an unreadable salary payment retains kind before asking only for amount',async t=>{
  const h=harness(t,[slip({amount:null})]);
  const reply=await handleOwnerStaffSlipText({...input,text:'จ่ายเงินเดือน เจิด'});
  assert.match(reply??'',/การจ่ายเงินเดือนของ เจิด/);
  assert.doesNotMatch(reply??'',/ล่วงหน้า/);
  assert.equal(h.calls.find(x=>x.path.endsWith('/financial_stage_owner_expense_purpose_v1'))?.body.p_purpose,'จ่ายเงินเดือน เจิด');
});
test('an explicit salary period is preserved when reusing the original slip',async t=>{
  const h=harness(t,[slip()]);
  await handleOwnerStaffSlipText({...input,text:'จ่ายเงินเดือน เจิด 200 บาท เดือน ตุลาคม 2569'});
  const create=h.calls.find(x=>x.path.endsWith('/financial_create_owner_payroll_event_v1'))!;
  assert.equal(create.body.p_event_type,'salary_payment');
  assert.equal(create.body.p_pay_period,'ตุลาคม 2569');
});

async function deliverStaffWebhook(text:string,messageId:string,validSignature=true) {
  const body=JSON.stringify({events:[{
    type:'message',replyToken:'mock-reply-'+messageId,timestamp:at,
    source:{type:'group',groupId:input.targetId,userId:input.userId},
    message:{id:messageId,type:'text',text},
  }]});
  const signature=createHmac('sha256','mock-line-secret').update(body).digest('base64');
  return lineWebhookHandler({httpMethod:'POST',body,headers:{'x-line-signature':validSignature?signature:'invalid'}} as never,{} as never);
}
test('signed LINE receiver routes a family staff slip through clarification to payroll without project or private transport',async t=>{
  const h=harness(t,[slip({status:'awaiting_business',purpose_raw:'เจิดเบิก'})]);
  t.mock.method(console,'log',()=>{});
  assert.equal((await deliverStaffWebhook('เจิดเบิก','staff-first') as any).statusCode,200);
  assert.equal((await deliverStaffWebhook('เงินเดือน','staff-salary') as any).statusCode,200);
  const replies=h.calls.filter(x=>x.path==='/v2/bot/message/reply');
  assert.equal(replies.length,2);
  assert.match(replies[0].body.messages[0].text,/เจิดเบิก 200 บาท.*เงินเดือนล่วงหน้าหรือเบิกไปซื้อของ/);
  assert.match(replies[1].body.messages[0].text,/บันทึกเบิกเงินเดือนล่วงหน้าของ เจิด 200 บาท/);
  assert.equal(h.calls.filter(x=>x.path.endsWith('/financial_create_owner_payroll_event_v1')).length,1);
  assert.ok(!h.calls.some(x=>/owner_project|snk-money|investment/.test(x.path)));
  assert.equal(replies[1].body.replyToken,'mock-reply-staff-salary');
});
test('signed LINE receiver asks which ambiguous slip and does not create payroll',async t=>{
  const h=harness(t,[slip(),slip({id:'another-slip',amount:500})]);
  t.mock.method(console,'log',()=>{});
  assert.equal((await deliverStaffWebhook('เจิดเบิก','ambiguous') as any).statusCode,200);
  const replies=h.calls.filter(x=>x.path==='/v2/bot/message/reply');
  assert.equal(replies.length,1);
  assert.match(replies[0].body.messages[0].text,/2 รายการ/);
  assert.ok(!h.calls.some(x=>x.method==='POST'&&x.path!=='/v2/bot/message/reply'));
});
test('invalid LINE signature cannot read a staff slip, write a ledger, or send a reply',async t=>{
  const h=harness(t,[slip()]);
  t.mock.method(console,'error',()=>{});
  assert.equal((await deliverStaffWebhook('เจิดเบิก','invalid',false) as any).statusCode,401);
  assert.equal(h.calls.length,0);
});

for (const text of ['สลิปนี้เจิดเบิก','อันนี้ของเจิดนะ เบิกเงินเดือน','รายการนี้เป็นของพนักงานเจิด เบิกเงินเดือน']) {
  test('conversational framing is never included in a payroll name: '+text,()=>{
    assert.equal(parseOwnerStaffTurn(text)?.employeeLabel,'เจิด');
  });
}
for (const text of ['เจิดเบิกไปแล้ว','เจิดเบิกไปแล้วเมื่อวาน','เจิดเบิกไปเมื่อเช้า']) {
  test('completed advance does not imply purchasing: '+text,()=>{
    assert.deepEqual(parseOwnerStaffTurn(text),{employeeLabel:'เจิด',kind:'unknown',amount:null});
  });
}
for (const text of ['ไม่ใช่เจิดเบิก เป็นของช่าง','ไม่ใช่เจิดเบิกเงินเดือน 200','เจิดเบิกใช่ไหม','เจิดเบิกได้มั้ย','ไม่มีใครเบิกเงินเดือน 200','เจิดยังไม่ได้เบิกเงินเดือน 200','แม่ เจิดเบิกเงินเดือน 200','แม่ครับ เจิดเบิกเงินเดือน 200','แม่บอกว่าเจิดเบิกเงินเดือน 200','เจิดกับปอเบิกเงินเดือน 200','เจิดเบิกเงินเดือน -200']) {
  test('unsafe staff prose cannot fall through into legacy payroll: '+text,()=>{
    assert.equal(parseOwnerStaffTurn(text),null);
    assert.equal(parseOwnerPayrollCommand(text),null);
  });
}
for (const [text,amount] of [['เจิดเบิก200บาท',200],['เจิดเบิก๒๐๐บาท',200],['เจิดเบิก200.50บาท',200.5],['เบิกเงินเดือนให้เจิด 200',200],['เจิดเบิกเงินเดือนสองพันบาท',2000]] as const) {
  test('joined amounts and Thai money are checked against the slip: '+text,()=>{
    assert.equal(parseOwnerStaffTurn(text)?.amount,amount);
  });
}
test('a payment recipient is extracted without retaining transfer wording',()=>{
  assert.deepEqual(parseOwnerStaffTurn('โอนให้เจิด 200 เป็นเงินเบิก'),{employeeLabel:'เจิด',kind:'unknown',amount:200});
});
test('employee corrections replace the old name and ask type again instead of inheriting payroll',()=>{
  assert.deepEqual(parseOwnerStaffTurn('ไม่ใช่เจิด เป็นปอ','เจิดเบิกเงินเดือนล่วงหน้า'),{employeeLabel:'ปอ',kind:'unknown',amount:null});
  assert.equal(parseOwnerStaffTurn('เปลี่ยนชื่อคนเบิกเป็นปอ','เจิดเบิก')?.employeeLabel,'ปอ');
});
test('a type correction keeps the person but uses only the positive replacement',()=>{
  assert.deepEqual(parseOwnerStaffTurn('ไม่ใช่เงินเดือน ไปซื้ออาหารม้า','เจิดเบิก'),{employeeLabel:'เจิด',kind:'purchase',amount:null});
  assert.deepEqual(parseOwnerStaffTurn('เจิดไม่ได้เบิกซื้อของ เป็นเงินเดือน','เจิดเบิกไปซื้อของ'),{employeeLabel:'เจิด',kind:'salary_advance',amount:null});
});
test('family-directed prose cannot answer any project field',()=>{
  assert.equal(isOwnerFamilyConversation('แม่ เจิดเบิก'),true);
  assert.equal(isOwnerFamilyConversation('ทองไทย เจิดเบิก'),false);
  for (const expectedField of ['project_name','work_title','budget','counterparty','payment_plan','schedule','responsible'] as const) {
    const data={project_name:'เฉลียงไม้'};
    assert.deepEqual(applyOwnerProjectText({text:'แม่ วันนี้ต้องเสร็จนะ',intent:'investment_plan',data,expectedField}),{data,changed:false});
  }
});
test('correction to a non-staff purpose clears old staff context without any payroll or expense write',async t=>{
  const row=slip({purpose_raw:'เจิดเบิกเงินเดือนล่วงหน้า'});
  const h=harness(t,[row]);
  assert.match(await handleOwnerStaffSlipText({...input,text:'ไม่ใช่เจิดเบิก เป็นของช่าง'})??'',/พักข้อมูลพนักงานเดิม/);
  const stage=h.calls.find(x=>x.path.endsWith('/financial_stage_owner_expense_purpose_v1'))!;
  assert.match(stage.body.p_purpose,/^รอแก้ไขรายละเอียดสลิป:/);
  assert.equal(stage.body.p_confidence,0);
  assert.equal(parseOwnerStaffTurn(row.purpose_raw??''),null);
  assert.equal(await handleOwnerStaffSlipText({...input,text:'เงินเดือน'}),null);
  assert.ok(!h.calls.some(x=>/payroll_event|financial_resolve/.test(x.path)));
});
test('correction to a different employee stages the corrected name and asks type',async t=>{
  const h=harness(t,[slip({purpose_raw:'เจิดเบิกเงินเดือนล่วงหน้า'})]);
  const reply=await handleOwnerStaffSlipText({...input,text:'ไม่ใช่เจิด เป็นปอ'});
  assert.match(reply??'',/ปอเบิก 200 บาท/);
  assert.match(reply??'',/เงินเดือนล่วงหน้าหรือเบิกไปซื้อของ/);
  assert.equal(h.calls.find(x=>x.path.endsWith('/financial_stage_owner_expense_purpose_v1'))?.body.p_purpose,'ปอเบิก');
  assert.ok(!h.calls.some(x=>x.path.includes('payroll')));
});
test('joined conflicting amounts never use a different slip amount for payroll',async t=>{
  const h=harness(t,[slip()]);
  await handleOwnerStaffSlipText({...input,text:'เจิดเบิกเงินเดือน500บาท'});
  assert.ok(!h.calls.some(x=>x.method==='POST'));
});
test('several slips cannot be changed by an unreferenced person correction',async t=>{
  const h=harness(t,[slip({purpose_raw:'เจิดเบิก'}),slip({id:'another-slip',purpose_raw:'เจิดเบิก'})]);
  assert.match(await handleOwnerStaffSlipText({...input,text:'ไม่ใช่เจิด เป็นปอ'})??'',/2 รายการ/);
  assert.ok(!h.calls.some(x=>x.method==='POST'));
});
test('an unrelated project-name correction leaves the pending staff slip untouched',async t=>{
  const h=harness(t,[slip({purpose_raw:'เจิดเบิก'})]);
  assert.equal(await handleOwnerStaffSlipText({...input,text:'ไม่ใช่เฉลียง เป็นครัว'}),null);
  assert.ok(!h.calls.some(x=>x.method==='POST'));
});
test('signed LINE family chat is ignored without changing staff slips or projects',async t=>{
  const h=harness(t,[slip({purpose_raw:'เจิดเบิก'})]);
  t.mock.method(console,'log',()=>{});
  assert.equal((await deliverStaffWebhook('แม่ เจิดเบิกเงินเดือน 200','mother-talk') as any).statusCode,200);
  assert.ok(!h.calls.some(x=>x.method==='POST'));
  assert.ok(!h.calls.some(x=>/financial_owner|owner_project/.test(x.path)));
});
test('signed LINE can clarify completed advances without calling them purchases',async t=>{
  const h=harness(t,[slip()]);
  t.mock.method(console,'log',()=>{});
  await deliverStaffWebhook('เจิดเบิกไปแล้วเมื่อวาน','completed-advance');
  const reply=h.calls.find(x=>x.path==='/v2/bot/message/reply')!;
  assert.match(reply.body.messages[0].text,/เงินเดือนล่วงหน้าหรือเบิกไปซื้อของ/);
  assert.ok(!h.calls.some(x=>x.path.includes('payroll')));
});
test('signed LINE person correction keeps the original evidence and records only the corrected employee after clarification',async t=>{
  const h=harness(t,[slip({purpose_raw:'เจิดเบิก'})]);
  t.mock.method(console,'log',()=>{});
  await deliverStaffWebhook('ไม่ใช่เจิด เป็นปอ','correct-person');
  await deliverStaffWebhook('เงินเดือน','correct-type');
  const creates=h.calls.filter(x=>x.path.endsWith('/financial_create_owner_payroll_event_v1'));
  assert.equal(creates.length,1);
  assert.equal(creates[0].body.p_employee_label,'ปอ');
  assert.equal(creates[0].body.p_amount,200);
  assert.equal(h.calls.find(x=>x.path.endsWith('/financial_attach_owner_payroll_slip_v1'))?.body.p_slip_message_id,'original-line-image');
  assert.equal(h.calls.filter(x=>x.path==='/v2/bot/message/reply').length,2);
});
