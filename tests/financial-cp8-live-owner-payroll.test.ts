import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseOwnerPayrollCommand } from '../netlify/functions/_owner-payroll';

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
});

test('payroll privacy is hard-routed to owner_general and separate storage',()=>{
  const payroll=readFileSync('netlify/functions/_owner-payroll.ts','utf8');
  const webhook=readFileSync('netlify/functions/line-webhook.ts','utf8');
  const migration=readFileSync('supabase/migrations/20261002134500_financial_cp8_live_owner_payroll_v1.sql','utf8');

  assert.match(payroll,/team!=='owner_general'/);
  assert.match(payroll,/owner-payroll-evidence/);
  assert.match(payroll,/privacy_scope','owner_only'/);
  assert.match(webhook,/handleOwnerPayrollImage/);
  assert.match(webhook,/handleOwnerPayrollText/);
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
  assert.doesNotMatch(payroll,/financial_daily_ledger_entries/);
});
