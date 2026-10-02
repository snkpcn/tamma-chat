import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  matchingSafeExtraction,
  normalizeFinancialImageExtraction,
} from '../netlify/functions/_inthanin-daily-close-image';

test('normalizes a clear transfer slip without retaining personal account names',()=>{
  const x=normalizeFinancialImageExtraction({
    document_type:'transfer_slip',
    amount_total:'720.00',
    document_date_local:'2026-10-02',
    bank:'KBank',
    reference_number:'ABC123',
    expense_category:null,
    confidence:0.97,
    note:'โอนสำเร็จ',
  },'test-model');
  assert.equal(x.document_type,'transfer_slip');
  assert.equal(x.amount_total,720);
  assert.equal(x.document_date_local,'2026-10-02');
  assert.equal(x.bank,'KBank');
  assert.equal(x.confidence,0.97);
});

test('low-confidence image is forced to other so it cannot auto-match money',()=>{
  const x=normalizeFinancialImageExtraction({
    document_type:'purchase_receipt',
    amount_total:500,
    confidence:0.61,
  },'test-model');
  const safe=matchingSafeExtraction(x);
  assert.equal(safe.document_type,'other');
  assert.match(safe.note||'',/Auto-match disabled/);
});

test('high-confidence receipt remains eligible for exact-amount matching',()=>{
  const x=normalizeFinancialImageExtraction({
    document_type:'purchase_receipt',
    amount_total:500,
    expense_category:'ingredients',
    confidence:0.95,
  },'test-model');
  assert.equal(matchingSafeExtraction(x).document_type,'purchase_receipt');
  assert.equal(x.expense_category,'ingredients');
});

test('unknown document/category values are normalized conservatively',()=>{
  const x=normalizeFinancialImageExtraction({
    document_type:'random_document',
    amount_total:-5,
    expense_category:'random_category',
    confidence:9,
  },'test-model');
  assert.equal(x.document_type,'other');
  assert.equal(x.amount_total,null);
  assert.equal(x.expense_category,null);
  assert.equal(x.confidence,1);
});

test('LINE image router checks Café TEST evidence before settlement/fuel handlers',()=>{
  const source=readFileSync('netlify/functions/line-webhook.ts','utf8');
  const cafe=source.indexOf('handleCafeTestDailyCloseImage({');
  const settlement=source.indexOf('handleSettlementTransferProofImage({');
  const fuel=source.indexOf('handleLineFuelImage({');
  assert.ok(cafe>0);
  assert.ok(cafe<settlement);
  assert.ok(cafe<fuel);
});

test('Café TEST image handler hard-requires cafe_test binding and TEST-only RPC',()=>{
  const source=readFileSync('netlify/functions/_inthanin-daily-close-image.ts','utf8');
  assert.match(source,/team !== 'cafe_test'/);
  assert.match(source,/financial_attach_cafe_test_evidence_v1/);
  assert.match(source,/financial-evidence/);
  assert.doesNotMatch(source,/environment\s*:\s*['"]live['"]/);
});

test('migration encodes no-double-count rules for receipt and reimbursement slip',()=>{
  const source=readFileSync(
    'supabase/migrations/20261002103432_financial_cafe_test_image_evidence_v1.sql',
    'utf8',
  );
  assert.match(source,/exact_amount_unique_economic_event/);
  assert.match(source,/exact_amount_unique_employee_reimbursement/);
  assert.match(source,/cash_settlement/);
  assert.match(source,/matched_claim/);
  assert.match(source,/matched_ledger/);
  assert.match(source,/image_sha256/);
});


test('text Daily Close ingestion rematches evidence that arrived before the form',()=>{
  const source=readFileSync('netlify/functions/_inthanin-daily-close-line.ts','utf8');
  assert.match(source,/financial_rematch_cafe_test_day_evidence_v1/);
  assert.match(source,/rematchedEvidence/);
});

test('rematch migration is TEST-only and creates reimbursement settlement without duplicating expense',()=>{
  const source=readFileSync(
    'supabase/migrations/20261002104147_financial_cafe_test_evidence_rematch_v1.sql',
    'utf8',
  );
  assert.match(source,/rematch_test_only/);
  assert.match(source,/cash_settlement/);
  assert.match(source,/matched_claim/);
  assert.match(source,/matched_ledger/);
  assert.match(source,/on conflict \(source_channel,source_message_id,source_item_key\)/i);
});
