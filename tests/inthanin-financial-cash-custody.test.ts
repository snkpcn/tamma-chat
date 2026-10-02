import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql=readFileSync('supabase/migrations/20261002133000_financial_cash_custody_bag_v1.sql','utf8');

test('cash custody separates drawer sweep from economic expense',()=>{
  assert.match(sql,/movement_type.*drawer_to_bag/s);
  assert.match(sql,/'is_expense',false/);
  assert.match(sql,/accounting_role.*memo/s);
  assert.match(sql,/payment_method.*cash/s);
});

test('cash bag tracks owner pickup without treating pickup as drawer expense',()=>{
  assert.match(sql,/financial_record_cash_bag_pickup_v1/);
  assert.match(sql,/'owner_pickup','bag_out'/);
  assert.match(sql,/cash_pickup_exceeds_bag_balance/);
});

test('cash custody is TEST-only until CP8 and service-role only',()=>{
  assert.match(sql,/cash_custody_test_only/);
  assert.match(sql,/grant execute .*service_role/i);
  assert.match(sql,/revoke all .* from anon/i);
  assert.match(sql,/revoke all .* from authenticated/i);
});
