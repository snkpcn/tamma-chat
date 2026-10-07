import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handleOwnerPayrollText, parseOwnerPayrollCommand } from '../netlify/functions/_owner-payroll';

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

test('Owner payroll accepts a joined Thai command and does not record its repeated wording twice',async()=>{
  const oldFetch=globalThis.fetch,oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL='https://unit.test';process.env.SUPABASE_SERVICE_ROLE_KEY='service-key';
  let attempts=0;
  globalThis.fetch=(async(input:string|URL|Request)=>{
    const path=new URL(String(input)).pathname;
    if(path.endsWith('/ops_notification_channels'))return new Response(JSON.stringify([{team_code:'owner_general'}]),{status:200});
    if(path.endsWith('/rpc/financial_create_owner_payroll_event_v1')){
      attempts++;
      return attempts===1
        ?new Response(JSON.stringify({ok:true,event_id:'event-1',status:'awaiting_slip',amount:200}),{status:200})
        :new Response('payroll_slip_pending',{status:409});
    }
    if(path.endsWith('/financial_employee_payroll_events'))return new Response(JSON.stringify([{
      id:'event-1',event_type:'salary_advance',employee_label:'เจิด',employee_key:'เจิด',amount:200,
      status:'awaiting_slip',owner_group_hash:'group-hash',created_at:'2026-10-07T11:34:00Z',
    }]),{status:200});
    return new Response('[]',{status:200});
  }) as typeof fetch;
  try{
    const first=await handleOwnerPayrollText({targetId:'owner-group',userId:'owner',text:'เบิกเงินเดือนเจิด 200',messageId:'line-msg-1'});
    const repeat=await handleOwnerPayrollText({targetId:'owner-group',userId:'owner',text:'เจิดเบิกเงินเดือน 200',messageId:'line-msg-2'});
    assert.match(first??'',/เจิด[\s\S]*200 บาท[\s\S]*ส่งรูปสลิป/u);
    assert.match(repeat??'',/รอสลิปอยู่แล้วครับ ไม่เพิ่มยอดซ้ำ/u);
    assert.equal(attempts,2);
  }finally{
    globalThis.fetch=oldFetch;
    if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;
    if(oldKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=oldKey;
  }
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
