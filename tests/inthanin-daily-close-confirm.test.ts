import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDailyCloseCommand } from '../netlify/functions/_inthanin-daily-close-confirm';

test('Café TEST close commands support today and explicit Thai dates',()=>{
  const ts=Date.parse('2026-10-02T10:00:00Z');
  assert.deepEqual(parseDailyCloseCommand('ตรวจปิดวัน',ts),{
    kind:'check',localDate:'2026-10-02',
  });
  assert.deepEqual(parseDailyCloseCommand('ยืนยันปิดวัน 1/10/69',ts),{
    kind:'confirm',localDate:'2026-10-01',
  });
  assert.deepEqual(parseDailyCloseCommand('เช็คปิดวัน 2/10/2569',ts),{
    kind:'check',localDate:'2026-10-02',
  });
});

test('unrelated staff chat is not consumed as a close command',()=>{
  assert.equal(parseDailyCloseCommand('วันนี้ขายดีมากครับ'),null);
  assert.equal(parseDailyCloseCommand('ยืนยันรายการนี้'),null);
});

test('LINE route checks Daily Close confirm before payment/fuel/generic ops handlers',()=>{
  const source=readFileSync('netlify/functions/line-webhook.ts','utf8');
  const confirm=source.indexOf('handleCafeTestDailyCloseConfirmText({');
  const payment=source.indexOf('handleLinePaymentGroupText({');
  const fuel=source.indexOf('handleLineFuelText({');
  const generic=source.lastIndexOf('handleLineOpsGroupMessage({');
  assert.ok(confirm>0);
  assert.ok(confirm<payment);
  assert.ok(confirm<fuel);
  assert.ok(confirm<generic);
});

test('confirmation handler is hard-bound to Café TEST and canonical 3-arg RPC',()=>{
  const source=readFileSync('netlify/functions/_inthanin-daily-close-confirm.ts','utf8');
  assert.match(source,/team!=='cafe_test'/);
  assert.match(source,/financial_reconcile_daily_close_v1/);
  assert.match(source,/financial_confirm_cafe_test_daily_close_v1/);
  assert.match(source,/p_source:'line'/);
});

test('CP6 migration requires POS evidence, payment reconciliation, cash reconciliation and append-only adjustment batches',()=>{
  const engine=readFileSync(
    'supabase/migrations/20261002112402_financial_daily_close_reconcile_confirm_adjust_v1.sql',
    'utf8'
  );
  assert.match(engine,/pos_evidence_missing/);
  assert.match(engine,/sales_payment_variance/);
  assert.match(engine,/cash_drawer_variance/);
  assert.match(engine,/financial_add_daily_close_adjustment_batch_v1/);
  assert.match(engine,/batch_id/);
  assert.match(engine,/original_gross_sales/);
});

test('confirmation unification removes the ambiguous 2-arg overload',()=>{
  const source=readFileSync(
    'supabase/migrations/20261002112637_financial_daily_close_confirmation_unify_v1.sql',
    'utf8'
  );
  assert.match(source,/drop function if exists public\.financial_confirm_cafe_test_daily_close_v1\(uuid,text\)/i);
  assert.match(source,/financial_confirm_cafe_test_daily_close_v1\(p_daily_close_id uuid, p_actor_hash text, p_source text DEFAULT 'line'/);
});


test('legacy single-field adjustment RPC is removed so it cannot bypass atomic reconciliation',()=>{
  const source=readFileSync(
    'supabase/migrations/20261002113658_financial_drop_legacy_single_adjustment_v1.sql',
    'utf8'
  );
  assert.match(source,/drop function if exists public\.financial_add_cafe_test_adjustment_v1/i);
});
