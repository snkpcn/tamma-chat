import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { expenseCategory } from '../netlify/functions/_inthanin-daily-close-text';

test('transfer purpose classifier maps normal shop wording into canonical categories',()=>{
  assert.equal(expenseCategory('ค่านมเมจิ'),'ingredients');
  assert.equal(expenseCategory('สั่งแก้วพลาสติก'),'packaging');
  assert.equal(expenseCategory('ค่าซ่อมเครื่องชง'),'maintenance');
  assert.equal(expenseCategory('ค่าไฟร้าน'),'utilities');
  assert.equal(expenseCategory('ค่าส่งของ'),'transport');
  assert.equal(expenseCategory('ค่าธรรมเนียมธนาคาร'),'fees');
});

test('unmatched transfer slip opens a group-scoped follow-up instead of creating an expense blindly',()=>{
  const image=readFileSync('netlify/functions/_inthanin-daily-close-image.ts','utf8');
  const followup=readFileSync('netlify/functions/_inthanin-transfer-followup.ts','utf8');
  const migration=readFileSync('supabase/migrations/20261002143000_financial_transfer_purpose_followup_v1.sql','utf8');

  assert.match(image,/result\.evidence_type==='transfer_slip'/);
  assert.match(image,/result\.match_status==='unmatched'/);
  assert.match(image,/openTransferPurposeFollowup/);
  assert.match(followup,/สลิป .* นี้จ่ายค่าอะไรครับ/u);
  assert.match(followup,/จัด Category และผูกสลิปให้เอง/u);
  assert.match(migration,/financial_transfer_followups/);
  assert.match(migration,/status='awaiting_description'/);
});

test('the next natural group reply resolves oldest pending slip and creates one categorized economic event',()=>{
  const followup=readFileSync('netlify/functions/_inthanin-transfer-followup.ts','utf8');
  const webhook=readFileSync('netlify/functions/line-webhook.ts','utf8');
  const migration=readFileSync('supabase/migrations/20261002143000_financial_transfer_purpose_followup_v1.sql','utf8');

  assert.match(followup,/expenseCategory\(description\)/);
  assert.match(followup,/financial_resolve_transfer_followup_v1/);
  assert.match(migration,/'vendor_payment',v_category,'economic_event'/);
  assert.match(migration,/'funding','owner_transfer'/);
  assert.match(migration,/match_reason='user_described_transfer_purpose'/);
  assert.match(migration,/source_item_key.*transfer_purpose/s);

  const closePos=webhook.indexOf('handleCafeTestDailyCloseConfirmText');
  const purposePos=webhook.indexOf('handleTransferPurposeText');
  const paymentPos=webhook.indexOf('handleLinePaymentGroupText');
  assert.ok(closePos>=0 && purposePos>closePos && paymentPos>purposePos);
});

test('payroll-like purpose is never resolved into the staff-visible Inthanin ledger',()=>{
  const followup=readFileSync('netlify/functions/_inthanin-transfer-followup.ts','utf8');
  assert.match(followup,/เงินเดือน\|เบิกเงิน\|ค่าแรง\|ค่าจ้าง\|payroll\|salary/);
  assert.match(followup,/กลุ่ม Owner เท่านั้น/u);
});
