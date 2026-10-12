import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { handler as lineWebhookHandler } from '../netlify/functions/line-webhook';
import { applyOwnerProjectText, handleOwnerProjectText } from '../netlify/functions/_owner-project-os';
import { handleOwnerExpenseText, handleOwnerStaffSlipText } from '../netlify/functions/_owner-expense-intake';
import { piiHash } from '../netlify/functions/_operations-db';
import { decodeAdvanceAction, type AdvanceEmployee } from '../netlify/functions/_owner-employee-advance-card';

// Existing successful cases use explicitly authorized synthetic finance owners.
let previousFinanceOwners:string|undefined;
beforeEach(()=>{
 previousFinanceOwners=process.env.OWNER_FINANCE_LINE_USER_HASHES;
 process.env.OWNER_FINANCE_LINE_USER_HASHES=["son-test-user"].map(user=>piiHash(user)).join(',');
});
afterEach(()=>{
 if(previousFinanceOwners===undefined)delete process.env.OWNER_FINANCE_LINE_USER_HASHES;
 else process.env.OWNER_FINANCE_LINE_USER_HASHES=previousFinanceOwners;
});
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

type Slip = {id:string; source_user_hash:string|null; status:string; amount:number|null; created_at:string; purpose_raw:string|null; occurred_on:string; document_type:string;business_unit_code?:string|null;expense_class?:string|null;expense_category?:string|null;expense_subcategory?:string|null;owner_group_hash?:string|null;review_state?:string|null;review_revision?:number;review_data?:any;extraction_data?:any};
const at = Date.parse('2026-10-11T03:00:00Z');
const slip = (overrides:Partial<Slip>={}):Slip => ({
  id:'87044d4b-b8a8-41ab-a393-e8ab8a7b5597', source_user_hash:'mother-hash',
  status:'awaiting_purpose',amount:200,created_at:'2026-10-11T01:13:41Z',
  purpose_raw:null,occurred_on:'2026-10-11',document_type:'transfer_slip',...overrides,
});
function harness(t:any, rows:Slip[], config:{attachStatus?:string;createDuplicate?:boolean;createEventType?:string;tampered?:boolean;uploadStatus?:number;pendingError?:boolean;attachError?:boolean;team?:string;employees?:AdvanceEmployee[]}={}) {
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
        owner_group_hash:piiHash('owner-test-group'),evidence_message_id:'original-line-image',
        evidence_sha256:sha,storage_bucket:'owner-expense-evidence',
        storage_path:'owner-group/2026-10-11/stored.png',mime_type:'image/png',
        extraction_confidence:0.95,extraction_data:{document_type:row.document_type,document_kind:row.document_type==='transfer_slip'?'transfer_evidence':'unknown',funds_direction:row.document_type==='transfer_slip'?'outgoing':'unknown',amount_total:row.amount,confidence:0.95},
      })));
      return Response.json(rows.filter(row=>['awaiting_purpose','awaiting_business'].includes(row.status)));
    }
    if(path.endsWith('/owner_employee_advance_context_v1')){
      const catalog=config.employees??syntheticEmployees;
      const candidates=catalog.filter(employee=>body.p_employee_id?employee.employee_id===body.p_employee_id:
        !body.p_employee_query||employee.nickname===body.p_employee_query);
      return Response.json({ok:true,candidates,month_start:'2026-10-01',month_end:'2026-11-01'});
    }
    if(path.endsWith('/financial_stage_owner_employee_advance_v1')){
      const row=rows.find(row=>row.id===body.p_intake_id);
      assert.ok(row);assert.equal(body.p_group_hash,row.owner_group_hash);assert.equal(body.p_actor_hash,row.source_user_hash);
      assert.equal(body.p_revision,row.review_revision);
      row.review_data=structuredClone(body.p_proposal);row.review_revision!++;row.review_state='draft';
      return Response.json({ok:true,revision:row.review_revision,proposal:row.review_data});
    }
    if(path.endsWith('/financial_confirm_owner_employee_advance_v1')){
      const row=rows.find(row=>row.id===body.p_intake_id);
      assert.ok(row);assert.equal(body.p_group_hash,row.owner_group_hash);assert.equal(body.p_actor_hash,row.source_user_hash);
      assert.equal(body.p_revision,row.review_revision);
      const employee=(config.employees??syntheticEmployees).find(employee=>employee.employee_id===row.review_data.employee_id);
      assert.ok(employee);assert.equal(row.review_data.event_type,'salary_advance');
      const duplicate=row.review_state==='confirmed';row.review_state='confirmed';
      return Response.json({ok:true,event_id:'44444444-4444-4444-8444-444444444444',duplicate,employee,
        amount:row.review_data.amount,occurred_on:row.review_data.occurred_on,
        funding_source:row.review_data.funding_source,monthly_sum:Number(employee.month_paid_advance)+row.review_data.amount});
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
    if(path.endsWith('/owner_projects'))return Response.json([]);
    if(path.endsWith('/financial_stage_owner_expense_purpose_v1')){
      const row=rows.find(row=>row.id===body.p_intake_id);if(row){row.purpose_raw=body.p_purpose;row.status='awaiting_business';row.expense_class=body.p_expense_class;row.expense_category=body.p_expense_category;row.expense_subcategory=body.p_expense_subcategory;}
      return Response.json({ok:true,status:'awaiting_business'});
    }
    if(path==='/v2/bot/message/reply')return Response.json({});
    if(path.endsWith('/financial_resolve_owner_expense_intake_v1')){
      const row=rows.find(row=>row.id===body.p_intake_id);
      if(row){row.purpose_raw=body.p_purpose;row.business_unit_code=body.p_business_unit_code;row.status='needs_review';}
      return Response.json({ok:true,status:'needs_review',intake_id:row?.id,amount:row?.amount,
        business_unit_code:body.p_business_unit_code,expense_class:body.p_expense_class,
        expense_category:body.p_expense_category,expense_subcategory:body.p_expense_subcategory});
    }
    throw new Error('Unexpected route '+path);
  });
  return {calls};
}
const input = {targetId:'owner-test-group',userId:'son-test-user',messageId:'message-staff',timestamp:at};
// Replacement advance cases use a separate, wholly synthetic employee/evidence fixture.
const syntheticEmployees:AdvanceEmployee[]=[
  {employee_id:'22222222-2222-4222-8222-222222222222',employee_key:'synthetic-a',full_name:'ทดสอบ ตัวอย่าง',nickname:'ทดสอบ',business_unit_code:'shared',role_label:'ฝ่ายทดสอบ',month_paid_advance:450},
  {employee_id:'33333333-3333-4333-8333-333333333333',employee_key:'synthetic-b',full_name:'จำลอง ตัวอย่าง',nickname:'จำลอง',business_unit_code:'shared',role_label:'ฝ่ายทดสอบ',month_paid_advance:60},
];
const syntheticSlip=(overrides:Partial<Slip>={}):Slip=>({
  id:'11111111-1111-4111-8111-111111111111',source_user_hash:piiHash(input.userId),owner_group_hash:piiHash(input.targetId),
  status:'awaiting_purpose',amount:125,created_at:new Date(at-60000).toISOString(),purpose_raw:null,
  occurred_on:'2026-10-11',document_type:'transfer_slip',review_state:null,review_revision:1,review_data:null,
  extraction_data:{document_type:'transfer_slip',document_kind:'transfer_evidence',funds_direction:'outgoing',amount_total:125,document_date_local:'2026-10-11',confidence:0.95,payment_document_count:1},
  ...overrides,
});
const noAdvanceMoneyWrite=(calls:Array<{path:string}>)=>assert.ok(!calls.some(call=>/financial_create_owner_payroll_event|financial_attach_owner_payroll_slip|financial_mark_owner_expense_not_expense|financial_confirm_owner_employee_advance/.test(call.path)));
const cardActions=(value:any)=>{
  const result:Array<{data:string;action:NonNullable<ReturnType<typeof decodeAdvanceAction>>}>=[];
  const visit=(item:any)=>{if(!item||typeof item!=='object')return;const action=item.type==='postback'?decodeAdvanceAction(item.data):null;if(action)result.push({data:item.data,action});Object.values(item).forEach(visit);};
  visit(value);return result;
};


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
test('legacy salary follow-up preserves the original slip and requires a staged card',async t=>{
  const row=syntheticSlip({status:'awaiting_business',purpose_raw:'ทดสอบเบิก'}),before=structuredClone(row);
  const h=harness(t,[row]);
  const reply=await handleOwnerStaffSlipText({...input,text:'เงินเดือน'});
  assert.match(reply??'',/ยืนยันจากการ์ดเงินเบิกพนักงาน/);assert.match(reply??'',/ยังไม่บันทึกยอด/);
  assert.deepEqual(row,before);assert.equal(h.calls.filter(call=>call.method==='POST').length,0);
  assert.ok(!h.calls.some(call=>/storage|owner_project/.test(call.path)));
});
test('full natural salary description cannot bypass the card through legacy stored-slip payroll',async t=>{
  const row=syntheticSlip(),before=structuredClone(row),h=harness(t,[row]);
  const reply=await handleOwnerStaffSlipText({...input,text:'ทดสอบเบิกเงินเดือน 125'});
  assert.match(reply??'',/ยังไม่บันทึกยอดจากสลิปอัตโนมัติ/);
  assert.deepEqual(row,before);assert.equal(h.calls.filter(call=>call.method==='POST').length,0);
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
test('a bare business answer releases an unknown advance without repeating its type question or changing it',async t=>{
  const row=slip({status:'awaiting_business',purpose_raw:'เจิดเบิก'});
  const h=harness(t,[row]);
  assert.equal(await handleOwnerStaffSlipText({...input,text:'ส่วนกลาง'}),null);
  assert.equal(await handleOwnerExpenseText({...input,text:'ส่วนกลาง'}),null);
  assert.equal(row.purpose_raw,'เจิดเบิก');
  assert.ok(!h.calls.some(x=>x.method==='POST'));
});
test('salary-payment evidence under review retains the legacy review outcome',async t=>{
  const h=harness(t,[syntheticSlip({purpose_raw:'จ่ายเงินเดือน ทดสอบ'})],{attachStatus:'needs_review'});
  assert.match(await handleOwnerStaffSlipText({...input,text:'จ่ายเงินเดือน ทดสอบ'})??'',/ยังไม่ยืนยันยอด/);
  const create=h.calls.find(call=>call.path.endsWith('/financial_create_owner_payroll_event_v1'))!;
  assert.equal(create.body.p_event_type,'salary_payment');assert.equal(create.body.p_amount,125);
  assert.ok(h.calls.some(call=>call.path.endsWith('/financial_mark_owner_expense_not_expense_v1')));
  assert.ok(!h.calls.some(call=>call.path.endsWith('/financial_employee_advance_owner_v1')));
});
test('salary-payment retry reuses the stable source and skips storage upload',async t=>{
  const row=syntheticSlip(),h=harness(t,[row],{createDuplicate:true});
  assert.match(await recordOwnerPayrollFromStoredSlip({...input,intakeId:row.id,employeeLabel:'ทดสอบ',eventType:'salary_payment'}),/พร้อมสลิปเดิม/);
  const create=h.calls.find(call=>call.path.endsWith('/financial_create_owner_payroll_event_v1'))!;
  assert.equal(create.body.p_message_id,'owner-slip-payroll:'+row.id);assert.equal(create.body.p_event_type,'salary_payment');
  assert.ok(!h.calls.some(call=>call.path.includes('/storage/')));
  assert.ok(h.calls.some(call=>call.path.endsWith('/financial_mark_owner_expense_not_expense_v1')));
});
test('conflicting salary-payment retry never changes an existing payroll type',async t=>{
  const row=syntheticSlip(),h=harness(t,[row],{createDuplicate:true,createEventType:'salary_advance'});
  const reply=await recordOwnerPayrollFromStoredSlip({...input,intakeId:row.id,employeeLabel:'ทดสอบ',eventType:'salary_payment'});
  assert.match(reply,/ข้อมูลไม่ตรงกัน/);
  assert.ok(!h.calls.some(call=>call.path.includes('/storage/')||call.path.endsWith('/financial_mark_owner_expense_not_expense_v1')));
});
test('tampered salary-payment evidence cannot attach or close the original slip',async t=>{
  const row=syntheticSlip(),h=harness(t,[row],{tampered:true});
  await assert.rejects(recordOwnerPayrollFromStoredSlip({...input,intakeId:row.id,employeeLabel:'ทดสอบ',eventType:'salary_payment'}),/hash_mismatch/);
  assert.ok(!h.calls.some(call=>call.path.endsWith('/financial_attach_owner_payroll_slip_v1')||call.path.endsWith('/financial_mark_owner_expense_not_expense_v1')));
});
test('salary-payment attachment error retains the original intake for safe retry',async t=>{
  const row=syntheticSlip(),before=structuredClone(row),h=harness(t,[row],{attachError:true});
  await assert.rejects(recordOwnerPayrollFromStoredSlip({...input,intakeId:row.id,employeeLabel:'ทดสอบ',eventType:'salary_payment'}),/already_used/);
  assert.deepEqual(row,before);assert.ok(!h.calls.some(call=>call.path.endsWith('/financial_mark_owner_expense_not_expense_v1')));
});
test('pending legacy payroll cannot capture a salary advance or alter its slip',async t=>{
  const row=syntheticSlip({purpose_raw:'ทดสอบเบิก'}),before=structuredClone(row),h=harness(t,[row],{pendingError:true});
  assert.match(await handleOwnerStaffSlipText({...input,text:'เงินเดือน'})??'',/ยืนยันจากการ์ดเงินเบิกพนักงาน/);
  assert.deepEqual(row,before);assert.equal(h.calls.filter(call=>call.method==='POST').length,0);
  assert.ok(!h.calls.some(call=>/storage|owner_project/.test(call.path)));
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

test('a name-only legacy salary-advance answer cannot auto-record the saved slip',async t=>{
  const row=syntheticSlip({purpose_raw:'พนักงานเบิกเงินเดือนล่วงหน้า'}),before=structuredClone(row),h=harness(t,[row]);
  assert.match(await handleOwnerStaffSlipText({...input,text:'ทดสอบ'})??'',/ยืนยันจากการ์ดเงินเบิกพนักงาน/);
  assert.deepEqual(row,before);assert.equal(h.calls.filter(call=>call.method==='POST').length,0);
});
test('unreadable amount asks one missing question and preserves salary context',async t=>{
  const h=harness(t,[slip({amount:null,purpose_raw:'เจิดเบิก'})]);
  assert.match(await handleOwnerStaffSlipText({...input,text:'เงินเดือน'})??'',/จำนวนกี่บาท/);
  assert.equal(h.calls.find(x=>x.path.endsWith('/financial_stage_owner_expense_purpose_v1'))?.body.p_purpose,'เจิดเบิกเงินเดือนล่วงหน้า');
  assert.ok(!h.calls.some(x=>x.path.endsWith('/financial_create_owner_payroll_event_v1')));
});
test('owner amount clarification cannot auto-create or attach an unreadable salary advance',async t=>{
  const row=syntheticSlip({amount:null,purpose_raw:'ทดสอบเบิกเงินเดือนล่วงหน้า'}),before=structuredClone(row),h=harness(t,[row]);
  assert.match(await handleOwnerStaffSlipText({...input,text:'125'})??'',/ยังไม่บันทึกยอดจากสลิปอัตโนมัติ/);
  assert.deepEqual(row,before);assert.equal(h.calls.filter(call=>call.method==='POST').length,0);
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
async function deliverAdvancePostback(data:string,messageId:string,userId=input.userId,validSignature=true) {
  const body=JSON.stringify({events:[{type:'postback',webhookEventId:messageId,replyToken:'mock-reply-'+messageId,timestamp:at,
    source:{type:'group',groupId:input.targetId,userId},postback:{data}}]});
  const signature=createHmac('sha256','mock-line-secret').update(body).digest('base64');
  return lineWebhookHandler({httpMethod:'POST',body,headers:{'x-line-signature':validSignature?signature:'invalid'}} as never,{} as never);
}
test('signed LINE stages an employee card and only explicit owner confirmation records the advance',async t=>{
  const row=syntheticSlip(),h=harness(t,[row]);t.mock.method(console,'log',()=>{});
  assert.equal((await deliverStaffWebhook('ทดสอบเบิก','synthetic-first') as any).statusCode,200);
  assert.equal((await deliverStaffWebhook('เงินเดือน','synthetic-salary') as any).statusCode,200);
  const replies=h.calls.filter(call=>call.path==='/v2/bot/message/reply');assert.equal(replies.length,2);
  assert.equal(replies[0].body.messages[0].type,'flex');assert.equal(replies[1].body.messages[0].type,'flex');
  assert.equal(cardActions(replies[0].body).some(item=>item.action.action==='confirm'),false);
  const confirmation=cardActions(replies[1].body).find(item=>item.action.action==='confirm')!;assert.ok(confirmation);
  for(const value of ['ทดสอบ ตัวอย่าง','450 บาท','125 บาท','575 บาท','ยังไม่บันทึกยอด'])assert.ok(JSON.stringify(replies[1].body).includes(value));
  assert.equal(row.review_data.employee_id,syntheticEmployees[0].employee_id);assert.equal(row.review_data.event_type,'salary_advance');
  assert.equal(row.review_state,'draft');noAdvanceMoneyWrite(h.calls);
  assert.equal((await deliverAdvancePostback(confirmation.data,'synthetic-confirm') as any).statusCode,200);
  assert.equal(row.review_state,'confirmed');
  const commits=h.calls.filter(call=>call.path.endsWith('/financial_confirm_owner_employee_advance_v1'));assert.equal(commits.length,1);
  assert.equal(commits[0].body.p_intake_id,row.id);assert.equal(commits[0].body.p_revision,confirmation.action.revision);
  const saved=h.calls.filter(call=>call.path==='/v2/bot/message/reply').at(-1)!.body;
  assert.match(JSON.stringify(saved),/บันทึกเงินเบิกแล้ว/);assert.match(JSON.stringify(saved),/575 บาท/);
  assert.equal(cardActions(saved).length,0);
  assert.ok(!h.calls.some(call=>/create_owner_payroll|attach_owner_payroll|owner_project|snk-money|investment|storage/.test(call.path)));
});
test('signed LINE asks which synthetic slip and performs no draft or money write when ambiguous',async t=>{
  const rows=[syntheticSlip(),syntheticSlip({id:'55555555-5555-4555-8555-555555555555'})],before=structuredClone(rows),h=harness(t,rows);
  t.mock.method(console,'log',()=>{});
  assert.equal((await deliverStaffWebhook('ทดสอบเบิก','synthetic-ambiguous') as any).statusCode,200);
  const replies=h.calls.filter(call=>call.path==='/v2/bot/message/reply');assert.equal(replies.length,1);
  assert.match(replies[0].body.messages[0].text,/หลายสลิป/);
  assert.match(replies[0].body.messages[0].text,/#111111/);assert.match(replies[0].body.messages[0].text,/#555555/);
  assert.deepEqual(rows,before);assert.ok(!h.calls.some(call=>call.method==='POST'&&call.path!=='/v2/bot/message/reply'));
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
test('signed LINE completed advance wording stages an unknown type and never implies a purchase',async t=>{
  const row=syntheticSlip(),h=harness(t,[row]);t.mock.method(console,'log',()=>{});
  await deliverStaffWebhook('ทดสอบเบิกไปแล้วเมื่อวาน','synthetic-completed');
  const reply=h.calls.find(call=>call.path==='/v2/bot/message/reply')!.body;
  assert.equal(row.review_data.event_type,'unknown');assert.equal(row.review_data.employee_id,syntheticEmployees[0].employee_id);
  assert.match(JSON.stringify(reply),/เบิกเงินเดือนล่วงหน้าใช่ไหม/);
  assert.equal(cardActions(reply).some(item=>item.action.action==='confirm'),false);noAdvanceMoneyWrite(h.calls);
  assert.ok(!h.calls.some(call=>call.path.endsWith('/financial_resolve_owner_expense_intake_v1')));
});
test('signed LINE person correction rebinds the same draft to the corrected stable employee without payment',async t=>{
  const row=syntheticSlip(),h=harness(t,[row]);t.mock.method(console,'log',()=>{});
  await deliverStaffWebhook('ทดสอบเบิกเงินเดือน 125','synthetic-initial-person');
  await deliverStaffWebhook('ไม่ใช่ทดสอบ เป็นจำลอง','synthetic-correct-person');
  assert.equal(row.review_data.employee_id,syntheticEmployees[1].employee_id);assert.equal(row.review_data.event_type,'unknown');
  const corrected=h.calls.filter(call=>call.path==='/v2/bot/message/reply').at(-1)!.body;
  assert.equal(cardActions(corrected).some(item=>item.action.action==='confirm'),false);
  await deliverStaffWebhook('เงินเดือน','synthetic-correct-type');
  assert.equal(row.review_data.employee_id,syntheticEmployees[1].employee_id);assert.equal(row.review_data.amount,125);
  assert.equal(row.review_data.monthly_sum_before,60);assert.equal(row.review_state,'draft');
  const stages=h.calls.filter(call=>call.path.endsWith('/financial_stage_owner_employee_advance_v1'));assert.equal(stages.length,3);
  assert.ok(stages.every(call=>call.body.p_intake_id===row.id));noAdvanceMoneyWrite(h.calls);
  assert.ok(!h.calls.some(call=>call.path.includes('/storage/')));
});

for (const text of ['เจิดเบิกเงินเดือน0บาท','เจิดเบิกเงินเดือนศูนย์บาท','เจิดเบิกเงินเดือน200.567บาท','เจิดเบิกเงินเดือน20,0บาท']) {
  test('an invalid stated amount cannot silently fall back to the stored slip: '+text,async t=>{
    assert.equal(parseOwnerStaffTurn(text),null);
    const h=harness(t,[slip({purpose_raw:'เจิดเบิก'})]);
    assert.equal(await handleOwnerStaffSlipText({...input,text}),null);
    assert.ok(!h.calls.some(x=>x.method==='POST'));
  });
}
test('an additional amount is not discarded as a date or pay-period label',async t=>{
  assert.equal(parseOwnerStaffTurn('เจิดเบิกเงินเดือน อีก500บาท')?.amount,500);
  const h=harness(t,[slip()]);
  await handleOwnerStaffSlipText({...input,text:'เจิดเบิกเงินเดือน อีก500บาท'});
  assert.ok(!h.calls.some(x=>x.method==='POST'));
});

for (const text of ['เจิดเบิกเงินเดือน 0 บาท','เจิดเบิกเงินเดือน 200.567 บาท','เบิกเงินเดือน เจิด 20,0 บาท']) {
  test('legacy payroll also rejects invalid money precision and grouping: '+text,()=>{
    assert.equal(parseOwnerPayrollCommand(text),null);
    assert.equal(parseOwnerStaffTurn(text),null);
  });
}

const equipmentSlip=(overrides:Partial<Slip>={}):Slip=>slip({
  id:'a6c43e20-be6c-4ee2-b4a9-32eb424fd07d',amount:6474,
  source_user_hash:piiHash(input.userId),created_at:new Date(at-60000).toISOString(),
  occurred_on:'2026-10-10',...overrides,
});
test('business-only answer is not a payroll type answer for an old staff slip',()=>{
  assert.equal(parseOwnerStaffTurn('ตำมา-ชาติ','เจิดเบิก'),null);
  assert.equal(parseOwnerStaffTurn('Inthanin','เจิดเบิกเงินเดือนล่วงหน้า'),null);
  assert.equal(parseOwnerStaffTurn('Inthanin','เจิดเบิกไปซื้อของ')?.kind,'purchase');
});
for(const text of ['เบิกล่วงหน้า','เบิกเงินเดือนล่วงหน้า','เงินเดือนล่วงหน้า','เงินเดือน']){
  test('legacy short salary type cannot pay either the staff slip or equipment receipt: '+text,async t=>{
    const rows=[syntheticSlip({id:'66666666-6666-4666-8666-666666666666',amount:850,status:'awaiting_business',purpose_raw:'ค่าอุปกรณ์ไฟฟ้า'}),
      syntheticSlip({status:'awaiting_business',purpose_raw:'ทดสอบเบิก'})],before=structuredClone(rows),h=harness(t,rows);
    const reply=await handleOwnerStaffSlipText({...input,text});
    assert.match(reply??'',/ยืนยันจากการ์ดเงินเบิกพนักงาน/);
    assert.deepEqual(rows,before);assert.equal(h.calls.filter(call=>call.method==='POST').length,0);
  });
}
test('a type-only answer cannot overwrite a known non-staff expense as payroll',async t=>{
  const h=harness(t,[equipmentSlip({status:'awaiting_business',purpose_raw:'ค่าอุปกรณ์ไฟฟ้า'})]);
  assert.equal(await handleOwnerStaffSlipText({...input,text:'เบิกเงินเดือนล่วงหน้า'}),null);
  assert.ok(!h.calls.some(x=>x.method==='POST'));
});
test('several staff slips remain ambiguous without listing an unrelated equipment receipt',async t=>{
  const h=harness(t,[equipmentSlip({status:'awaiting_business',purpose_raw:'ค่าอุปกรณ์ไฟฟ้า'}),
    slip({status:'awaiting_business',purpose_raw:'เจิดเบิก'}),
    slip({id:'another-staff-slip',status:'awaiting_business',purpose_raw:'ปอเบิก',amount:300})]);
  const reply=await handleOwnerStaffSlipText({...input,text:'เบิกเงินเดือนล่วงหน้า'});
  assert.match(reply??'',/2 รายการ/);assert.doesNotMatch(reply??'',/6,474/);
  assert.ok(!h.calls.some(x=>x.method==='POST'));
});
test('equipment purpose and its business finish the same slip without reopening the old payroll question',async t=>{
  t.mock.method(Date,'now',()=>at);
  const row=equipmentSlip();
  const h=harness(t,[row,slip({status:'awaiting_business',purpose_raw:'เจิดเบิก',
    source_user_hash:piiHash(input.userId),created_at:new Date(at-120000).toISOString()})]);
  // An explicit selection is retained by the staged expense fields.
  assert.equal(await handleOwnerStaffSlipText({...input,text:'a6c43e ค่าอุปกรณ์ไฟฟ้า'}),null);
  assert.match(await handleOwnerExpenseText({...input,text:'a6c43e ค่าอุปกรณ์ไฟฟ้า'})??'',/กิจการ/);
  assert.equal(await handleOwnerStaffSlipText({...input,text:'ตำมา-ชาติ'}),null);
  const reply=await handleOwnerExpenseText({...input,text:'ตำมา-ชาติ',messageId:'equipment-business'});
  assert.match(reply??'',/6,474 บาท/);assert.match(reply??'',/ตำมา-ชาติ/);
  assert.equal(row.purpose_raw,'ค่าอุปกรณ์ไฟฟ้า');
  assert.equal(row.business_unit_code,'tamma_restaurant');
  const resolve=h.calls.find(x=>x.path.endsWith('/financial_resolve_owner_expense_intake_v1'))!;
  assert.equal(resolve.body.p_intake_id,row.id);assert.equal(resolve.body.p_expense_category,'equipment');
  assert.ok(!h.calls.some(x=>x.path.includes('payroll')));
});
test('business reply to a known equipment expense wins over a pending staff purchase',async t=>{
  t.mock.method(Date,'now',()=>at);
  const h=harness(t,[equipmentSlip({status:'awaiting_business',purpose_raw:'ค่าอุปกรณ์ไฟฟ้า'}),
    slip({status:'awaiting_business',purpose_raw:'เจิดเบิกไปซื้อของ'})]);
  assert.equal(await handleOwnerStaffSlipText({...input,text:'ตำมา-ชาติ'}),null);
  assert.ok(!h.calls.some(x=>x.method==='POST'));
});
test('signed LINE equipment selection remains independent of a staged employee advance',async t=>{
  t.mock.method(Date,'now',()=>at);t.mock.method(console,'log',()=>{});
  const equipment=syntheticSlip({id:'66666666-6666-4666-8666-666666666666',amount:850,extraction_data:{document_type:'transfer_slip',document_kind:'transfer_evidence',funds_direction:'outgoing',amount_total:850,document_date_local:'2026-10-11',confidence:0.95}});
  const staff=syntheticSlip({status:'awaiting_business',purpose_raw:'ทดสอบเบิก'}),h=harness(t,[equipment,staff]);
  await deliverStaffWebhook('#666666 ค่าอุปกรณ์ไฟฟ้า','synthetic-equipment-purpose');
  await deliverStaffWebhook('#666666 ตำมา-ชาติ','synthetic-equipment-business');
  await deliverStaffWebhook('เบิกเงินเดือนล่วงหน้า','synthetic-staff-final');
  const replies=h.calls.filter(call=>call.path==='/v2/bot/message/reply');assert.equal(replies.length,3);
  assert.match(replies[0].body.messages[0].text,/กิจการ/);assert.match(replies[1].body.messages[0].text,/850 บาท/);
  assert.doesNotMatch(replies[1].body.messages[0].text,/ทดสอบ|เบิกเงินเดือน/);
  assert.equal(replies[2].body.messages[0].type,'flex');assert.match(JSON.stringify(replies[2].body),/125 บาท/);
  const resolves=h.calls.filter(call=>call.path.endsWith('/financial_resolve_owner_expense_intake_v1'));
  assert.equal(resolves.length,1);assert.equal(resolves[0].body.p_intake_id,equipment.id);
  const stages=h.calls.filter(call=>call.path.endsWith('/financial_stage_owner_employee_advance_v1'));
  assert.equal(stages.length,1);assert.equal(stages[0].body.p_intake_id,staff.id);
  assert.equal(staff.review_data.employee_id,syntheticEmployees[0].employee_id);assert.equal(staff.review_state,'draft');noAdvanceMoneyWrite(h.calls);
});
test('signed LINE scopes a legacy expense with an explicit six-character slip reference',async t=>{
  t.mock.method(Date,'now',()=>at);t.mock.method(console,'log',()=>{});
  const h=harness(t,[equipmentSlip(),slip({status:'awaiting_business',purpose_raw:'เจิดเบิก'})]);
  await deliverStaffWebhook('#a6c43e ซื้ออุปกรณ์ไฟฟ้า','explicit-equipment-code');
  await deliverStaffWebhook('#a6c43e ตำมา-ชาติ','explicit-code-business');
  const stages=h.calls.filter(x=>x.path.endsWith('/financial_stage_owner_expense_purpose_v1'));
  assert.equal(stages.length,1);assert.equal(stages[0].body.p_intake_id,equipmentSlip().id);
  const resolve=h.calls.find(x=>x.path.endsWith('/financial_resolve_owner_expense_intake_v1'))!;
  assert.equal(resolve.body.p_intake_id,equipmentSlip().id);
  assert.equal(resolve.body.p_business_unit_code,'tamma_restaurant');
  assert.ok(!h.calls.some(x=>x.path.includes('payroll')));
});

test('ordinary purchase wording follows the fresh equipment image rather than the older staff question',async t=>{
  t.mock.method(Date,'now',()=>at);
  const row=equipmentSlip();
  const h=harness(t,[row,slip({status:'awaiting_business',purpose_raw:'เจิดเบิก'})]);
  assert.equal(await handleOwnerStaffSlipText({...input,text:'ซื้ออุปกรณ์ไฟฟ้า'}),null);
  assert.match(await handleOwnerExpenseText({...input,text:'ซื้ออุปกรณ์ไฟฟ้า'})??'',/กิจการ/);
  const stage=h.calls.find(x=>x.path.endsWith('/financial_stage_owner_expense_purpose_v1'))!;
  assert.equal(stage.body.p_intake_id,row.id);
  assert.ok(!h.calls.some(x=>x.path.includes('payroll')));
});
test('a new unclassified image beside an older staff question needs selection before a type-only answer',async t=>{
  const h=harness(t,[equipmentSlip(),slip({status:'awaiting_business',purpose_raw:'เจิดเบิก'})]);
  assert.match(await handleOwnerStaffSlipText({...input,text:'เบิกเงินเดือนล่วงหน้า'})??'',/2 รายการ/);
  assert.ok(!h.calls.some(x=>x.method==='POST'));
});

test('signed LINE completes a saved equipment purpose after a pause without asking it again',async t=>{
  t.mock.method(Date,'now',()=>at);t.mock.method(console,'log',()=>{});
  const row=equipmentSlip({status:'awaiting_business',purpose_raw:'ค่าอุปกรณ์ไฟฟ้า',
    created_at:new Date(at-20*60000).toISOString(),expense_class:'capital_investment',
    expense_category:'equipment',expense_subcategory:'อุปกรณ์/เครื่องมือ'});
  const h=harness(t,[row,slip({status:'awaiting_business',purpose_raw:'เจิดเบิก'})]);
  await deliverStaffWebhook('#a6c43e ตำมา-ชาติ','delayed-equipment-business');
  const reply=h.calls.find(x=>x.path==='/v2/bot/message/reply')!;
  assert.match(reply.body.messages[0].text,/6,474 บาท/);
  assert.match(reply.body.messages[0].text,/ตำมา-ชาติ/);
  assert.doesNotMatch(reply.body.messages[0].text,/เป็นของกิจการ.*ไหน|เงินเดือน/);
  const resolve=h.calls.find(x=>x.path.endsWith('/financial_resolve_owner_expense_intake_v1'))!;
  assert.equal(resolve.body.p_intake_id,row.id);
  assert.equal(resolve.body.p_purpose,'ค่าอุปกรณ์ไฟฟ้า');
  assert.ok(!h.calls.some(x=>x.path.includes('payroll')));
});


test('signed LINE employee-name ambiguity requires selecting an existing stable employee ID',async t=>{
  const employees=[syntheticEmployees[0],{...syntheticEmployees[1],nickname:'ทดสอบ'}];
  const row=syntheticSlip(),h=harness(t,[row],{employees});t.mock.method(console,'log',()=>{});
  await deliverStaffWebhook('ทดสอบเบิกเงินเดือน 125','synthetic-ambiguous-employee');
  const first=h.calls.filter(call=>call.path==='/v2/bot/message/reply').at(-1)!.body;
  assert.equal(row.review_data.employee_id,null);assert.equal(cardActions(first).some(item=>item.action.action==='confirm'),false);
  const choices=cardActions(first).filter(item=>item.action.action==='employee');assert.equal(choices.length,2);
  assert.deepEqual(new Set(choices.map(item=>item.action.value)),new Set(employees.map(employee=>employee.employee_id)));
  const choice=choices.find(item=>item.action.value===syntheticEmployees[1].employee_id)!;
  await deliverAdvancePostback(choice.data,'synthetic-select-employee');
  assert.equal(row.review_data.employee_id,syntheticEmployees[1].employee_id);assert.equal(row.review_data.monthly_sum_before,60);
  const selected=h.calls.filter(call=>call.path==='/v2/bot/message/reply').at(-1)!.body;
  assert.equal(cardActions(selected).filter(item=>item.action.action==='confirm').length,1);noAdvanceMoneyWrite(h.calls);
});

test('signed LINE confirmation denies another participant and non-single-owner configuration',async t=>{
  const row=syntheticSlip(),h=harness(t,[row]);t.mock.method(console,'log',()=>{});
  await deliverStaffWebhook('ทดสอบเบิกเงินเดือน 125','synthetic-owner-draft');
  const first=h.calls.filter(call=>call.path==='/v2/bot/message/reply').at(-1)!.body;
  const confirmation=cardActions(first).find(item=>item.action.action==='confirm')!;assert.ok(confirmation);
  const before=structuredClone(row),callCount=h.calls.length;
  await deliverAdvancePostback(confirmation.data,'synthetic-other-actor','synthetic-other-participant');
  assert.deepEqual(row,before);assert.ok(h.calls.slice(callCount).every(call=>call.path==='/v2/bot/message/reply'||call.path.endsWith('/ops_notification_channels')));
  process.env.OWNER_FINANCE_LINE_USER_HASHES+=','+piiHash('synthetic-second-owner');
  const secondCallCount=h.calls.length;
  await deliverAdvancePostback(confirmation.data,'synthetic-multiple-owners');
  assert.deepEqual(row,before);assert.ok(h.calls.slice(secondCallCount).every(call=>call.path==='/v2/bot/message/reply'||call.path.endsWith('/ops_notification_channels')));
  noAdvanceMoneyWrite(h.calls);
});

test('invalid signed LINE postback cannot read or confirm a real staged draft',async t=>{
  const row=syntheticSlip(),h=harness(t,[row]);t.mock.method(console,'log',()=>{});t.mock.method(console,'error',()=>{});
  await deliverStaffWebhook('ทดสอบเบิกเงินเดือน 125','synthetic-before-invalid-postback');
  const first=h.calls.filter(call=>call.path==='/v2/bot/message/reply').at(-1)!.body;
  const confirmation=cardActions(first).find(item=>item.action.action==='confirm')!;assert.ok(confirmation);
  const before=structuredClone(row),callCount=h.calls.length;
  assert.equal((await deliverAdvancePostback(confirmation.data,'synthetic-invalid-postback',input.userId,false) as any).statusCode,401);
  assert.deepEqual(row,before);assert.equal(h.calls.length,callCount);noAdvanceMoneyWrite(h.calls);
});
