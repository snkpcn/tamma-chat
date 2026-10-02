import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source=readFileSync(
  'supabase/migrations/20261002125500_financial_cafe_test_claim_review_v1.sql',
  'utf8',
);

test('CP7 claim review is hard locked to Café TEST and service role',()=>{
  assert.match(source,/claim_review_test_only/);
  assert.match(source,/confirmed_daily_close_is_immutable/);
  assert.match(source,/grant execute .*service_role/i);
  assert.match(source,/revoke all .* from anon/i);
  assert.match(source,/revoke all .* from authenticated/i);
});

test('approved reimbursement clears the ledger review blocker atomically',()=>{
  assert.match(source,/financial_review_cafe_test_expense_claim_v1/);
  assert.match(source,/approval_status=p_decision/);
  assert.match(source,/approved_amount=case when p_decision='approved' then claimed_amount else 0 end/);
  assert.match(source,/metadata=.*-'needs_review'/s);
  assert.match(source,/claim_review_status/);
  assert.match(source,/financial_reconcile_daily_close_v1/);
});

test('a reimbursement already settled from a transfer slip cannot be rejected afterward',()=>{
  assert.match(source,/accounting_role='cash_settlement'/);
  assert.match(source,/settled_claim_cannot_reject/);
});
