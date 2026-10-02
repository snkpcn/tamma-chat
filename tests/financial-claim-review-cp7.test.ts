import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration=readFileSync(
  'supabase/migrations/20261002195500_financial_claim_review_test_v1.sql',
  'utf8',
);

test('CP7 claim review RPC is hard-locked to Inthanin TEST before CP8',()=>{
  assert.match(migration,/financial_review_expense_claim_v1/);
  assert.match(migration,/v_branch_code<>'inthanin_tadtone'/);
  assert.match(migration,/v_close\.environment<>'test'/);
  assert.match(migration,/expense_claim_review_test_only/);
  assert.match(migration,/confirmed_daily_close_is_immutable/);
});

test('CP7 claim approval cannot undercut money already settled',()=>{
  assert.match(migration,/approved_amount_below_already_settled_amount/);
  assert.match(migration,/v_settled>v_amount\+0\.01/);
  assert.match(migration,/accounting_role='cash_settlement'/);
});

test('CP7 reject cannot erase a reimbursement that has already been paid',()=>{
  assert.match(migration,/settled_claim_cannot_be_rejected/);
  assert.match(migration,/if v_settled>0/);
});

test('CP7 review records actor, reason and decision without touching LIVE',()=>{
  assert.match(migration,/approved_by_hash/);
  assert.match(migration,/review_reason/);
  assert.match(migration,/review_decision/);
  assert.doesNotMatch(migration,/environment='live'/);
});
