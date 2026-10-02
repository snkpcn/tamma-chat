import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDailyCloseConfirmCommand } from '../netlify/functions/_inthanin-daily-close-confirm';

test('confirmation commands parse Thai date and strict action',()=>{
  assert.deepEqual(
    parseDailyCloseConfirmCommand('ตรวจปิดวัน 1/10/69'),
    {kind:'validate',localDate:'2026-10-01'},
  );
  assert.deepEqual(
    parseDailyCloseConfirmCommand('ยืนยันปิดวัน 1/10/69'),
    {kind:'confirm',localDate:'2026-10-01'},
  );
  assert.equal(parseDailyCloseConfirmCommand('ปิดวันให้หน่อย'),null);
});

test('confirmation command without date uses Bangkok event date',()=>{
  const timestamp=Date.parse('2026-10-02T17:10:00+07:00');
  assert.deepEqual(
    parseDailyCloseConfirmCommand('ยืนยันปิดยอด',timestamp),
    {kind:'confirm',localDate:'2026-10-02'},
  );
});

test('LINE routes confirmation before Daily Close form/payment generic handlers',()=>{
  const source=readFileSync('netlify/functions/line-webhook.ts','utf8');
  const confirm=source.indexOf('handleCafeTestDailyCloseConfirmText({');
  const form=source.indexOf('handleCafeTestDailyCloseText({');
  const payment=source.indexOf('handleLinePaymentGroupText({');
  assert.ok(confirm>0);
  assert.ok(confirm<form);
  assert.ok(confirm<payment);
});

test('confirmation handler is hard-bound to cafe_test and TEST RPCs',()=>{
  const source=readFileSync('netlify/functions/_inthanin-daily-close-confirm.ts','utf8');
  assert.match(source,/team!=='cafe_test'/);
  assert.match(source,/financial_validate_cafe_test_daily_close_v1/);
  assert.match(source,/financial_confirm_cafe_test_daily_close_v1/);
  assert.match(source,/environment=eq\.test/);
});

test('confirmation migration enforces payment, POS, evidence, claims and cash drawer gates',()=>{
  const source=readFileSync(
    'supabase/migrations/20261002105453_financial_cafe_test_confirmation_adjustment_v1.sql',
    'utf8',
  );
  for(const code of [
    'SALES_PAYMENT_VARIANCE',
    'POS_EVIDENCE_MISSING',
    'POS_SALES_MISMATCH',
    'FINANCIAL_EVIDENCE_NEEDS_REVIEW',
    'EXPENSE_CLAIM_NEEDS_REVIEW',
    'CASH_OPENING_MISSING',
    'CASH_CLOSING_MISSING',
    'CASH_DRAWER_VARIANCE',
  ]){
    assert.match(source,new RegExp(code));
  }
  assert.match(source,/financial_daily_close_owner_v2/);
  assert.match(source,/financial_monthly_owner_v2/);
  assert.match(source,/adjustment_requires_confirmed_close/);
});
