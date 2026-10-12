import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handleOwnerPayrollText, parseOwnerPayrollCommand } from '../netlify/functions/_owner-payroll';
import { piiHash } from '../netlify/functions/_operations-db';

test('owner payroll commands parse salary advance payment and deduction',()=>{
  assert.deepEqual(parseOwnerPayrollCommand('เบิกเงินเดือน ปอ 2,000 บาท'),{
    eventType:'salary_advance',employeeLabel:'ปอ',amount:2000,payPeriod:null,
  });
  assert.deepEqual(parseOwnerPayrollCommand('จ่ายเงินเดือน ปอ 15,000 เดือน 2026-10'),{
    eventType:'salary_payment',employeeLabel:'ปอ',amount:15000,payPeriod:'2026-10',
  });
  assert.deepEqual(parseOwnerPayrollCommand('หักเบิก ปอ 2,000'),{
    eventType:'advance_deduction',employeeLabel:'ปอ',amount:2000,payPeriod:null,
  });
  for(const text of ['เบิกเงินเดือนเจิด 200','เจิดเบิกเงินเดือน 200','เจิด เบิกเงินเดือน 200']){
    assert.deepEqual(parseOwnerPayrollCommand(text),{
      eventType:'salary_advance',employeeLabel:'เจิด',amount:200,payPeriod:null,
    },text);
  }
  assert.equal(parseOwnerPayrollCommand('แม่บอกว่าเจิดเบิกเงินเดือน 200'),null);
});

test('legacy joined salary-advance commands never create payroll even when repeated',async t=>{
  const oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_SERVICE_ROLE_KEY,oldOwners=process.env.OWNER_FINANCE_LINE_USER_HASHES;
  process.env.OWNER_FINANCE_LINE_USER_HASHES=piiHash('synthetic-owner')!;
  process.env.SUPABASE_URL='https://unit.test';process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic-key';
  t.after(()=>{for(const [key,value] of [['SUPABASE_URL',oldUrl],['SUPABASE_SERVICE_ROLE_KEY',oldKey],['OWNER_FINANCE_LINE_USER_HASHES',oldOwners]]){
    if(value===undefined)delete process.env[key!];else process.env[key!]=value;
  }});
  const calls:Array<{path:string;method:string}>=[];
  t.mock.method(globalThis,'fetch',async(raw:any,init:any={})=>{
    const path=new URL(String(raw)).pathname;calls.push({path,method:init.method??'GET'});
    assert.ok(path.endsWith('/ops_notification_channels'),'legacy advance must not read or write payroll');
    return Response.json([{team_code:'owner_general'}]);
  });
  for(const [index,text] of ['เบิกเงินเดือนทดสอบ 125','ทดสอบเบิกเงินเดือน 125'].entries()){
    const reply=await handleOwnerPayrollText({targetId:'synthetic-owner-group',userId:'synthetic-owner',text,messageId:'synthetic-message-'+index});
    assert.match(reply??'',/ทดสอบ[\s\S]*125 บาท/u);assert.match(reply??'',/การ์ดเงินเบิก/);assert.match(reply??'',/ยังไม่บันทึกยอด/);
  }
  assert.equal(calls.length,2);assert.ok(calls.every(call=>call.method==='GET'));
});

test('payroll privacy is hard-routed to owner_general and separate storage',()=>{
  const payroll=readFileSync('netlify/functions/_owner-payroll.ts','utf8');
  const webhook=readFileSync('netlify/functions/line-webhook.ts','utf8');
  const migration=readFileSync('supabase/migrations/20261002134500_financial_cp8_live_owner_payroll_v1.sql','utf8');

  assert.match(payroll,/team!=='owner_general'/);
  assert.match(payroll,/owner-payroll-evidence/);
  assert.match(migration,/privacy_scope','owner_only'/);
  assert.match(webhook,/handleOwnerPayrollImage/);
  assert.match(webhook,/handleOwnerPayrollText/);
  assert.match(webhook,/PRIVATE_OWNER_PAYROLL_COMMAND/);
  assert.match(webhook,/safeInboundLogText/);
  assert.match(migration,/financial_employee_payroll_events/);
  assert.match(migration,/not_shop_expense/);
  assert.doesNotMatch(migration,/financial_daily_close_id.*financial_employee_payroll_events/);
});

test('real cafe group routes Daily Close and evidence to LIVE variants',()=>{
  const line=readFileSync('netlify/functions/_inthanin-daily-close-line.ts','utf8');
  const image=readFileSync('netlify/functions/_inthanin-daily-close-image.ts','utf8');
  const confirm=readFileSync('netlify/functions/_inthanin-daily-close-confirm.ts','utf8');
  const migration=readFileSync('supabase/migrations/20261002134500_financial_cp8_live_owner_payroll_v1.sql','utf8');

  assert.match(line,/team==='cafe'\?'live':'test'/);
  assert.match(line,/financial_ingest_inthanin_live_text_v1/);
  assert.match(line,/financial_record_cash_sweep_live_v1/);
  assert.match(image,/financial_attach_inthanin_live_evidence_v1/);
  assert.match(confirm,/team==='cafe_test'\?'test':'live'/);
  assert.match(confirm,/team==='cafe'&&command\.kind==='confirm'/);
  assert.match(confirm,/financial_confirm_inthanin_live_daily_close_v1/);
  assert.match(migration,/financial_rematch_inthanin_live_day_evidence_v1/);
});

test('salary advance is not silently turned into shop expense',()=>{
  const payroll=readFileSync('netlify/functions/_owner-payroll.ts','utf8');
  const migration=readFileSync('supabase/migrations/20261002134500_financial_cp8_live_owner_payroll_v1.sql','utf8');

  assert.match(payroll,/ไม่ลงเป็นค่าใช้จ่ายร้าน/u);
  assert.match(migration,/event_type.*salary_advance/s);
  assert.match(migration,/financial_employee_advance_owner_v1/);
  assert.match(migration,/advance_outstanding/);
  const guard=readFileSync('supabase/migrations/20261002141000_financial_cp8_payroll_pending_guard_v1.sql','utf8');
  assert.match(guard,/advance_deduction_exceeds_outstanding/);
  assert.match(guard,/status in \(''awaiting_slip'',''needs_review''\)/);
  assert.doesNotMatch(payroll,/financial_daily_ledger_entries/);
});

test('salary-payment text retains pending-slip duplicate protection',async t=>{
  const oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_SERVICE_ROLE_KEY,oldOwners=process.env.OWNER_FINANCE_LINE_USER_HASHES;
  process.env.OWNER_FINANCE_LINE_USER_HASHES=piiHash('synthetic-owner')!;
  process.env.SUPABASE_URL='https://unit.test';process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic-key';
  t.after(()=>{for(const [key,value] of [['SUPABASE_URL',oldUrl],['SUPABASE_SERVICE_ROLE_KEY',oldKey],['OWNER_FINANCE_LINE_USER_HASHES',oldOwners]]){
    if(value===undefined)delete process.env[key!];else process.env[key!]=value;
  }});
  const writes:any[]=[];
  t.mock.method(globalThis,'fetch',async(raw:any,init:any={})=>{
    const url=new URL(String(raw)),path=url.pathname,body=init.body?JSON.parse(init.body):undefined;
    if(path.endsWith('/ops_notification_channels'))return Response.json([{team_code:'owner_general'}]);
    if(path.endsWith('/financial_create_owner_payroll_event_v1')){
      writes.push(body);assert.equal(body.p_event_type,'salary_payment');assert.equal(body.p_employee_label,'ทดสอบ');assert.equal(body.p_amount,7500);
      return writes.length===1?Response.json({ok:true,event_id:'synthetic-salary-event',status:'awaiting_slip',amount:7500}):new Response('payroll_slip_pending',{status:409});
    }
    if(path.endsWith('/financial_employee_payroll_events'))return Response.json([{
      id:'synthetic-salary-event',event_type:'salary_payment',employee_label:'ทดสอบ',employee_key:'ทดสอบ',amount:7500,
      status:'awaiting_slip',owner_group_hash:piiHash('synthetic-owner-group'),created_at:'2026-10-11T03:00:00Z',
    }]);
    throw new Error('Unexpected salary-payment request '+path);
  });
  const request={targetId:'synthetic-owner-group',userId:'synthetic-owner',text:'จ่ายเงินเดือน ทดสอบ 7500',timestamp:Date.parse('2026-10-11T03:01:00Z')};
  assert.match(await handleOwnerPayrollText({...request,messageId:'synthetic-payment-first'})??'',/ทดสอบ[\s\S]*7,500 บาท[\s\S]*ส่งรูปสลิป/u);
  assert.match(await handleOwnerPayrollText({...request,messageId:'synthetic-payment-repeat'})??'',/รอสลิปอยู่แล้วครับ ไม่เพิ่มยอดซ้ำ/u);
  assert.equal(writes.length,2);assert.notEqual(writes[0].p_message_id,writes[1].p_message_id);
});
