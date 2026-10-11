import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { piiHash } from '../netlify/functions/_operations-db';
import { handleOwnerPayrollImage, handleOwnerPayrollText, recordOwnerPayrollFromStoredSlip } from '../netlify/functions/_owner-payroll';
import { handleOwnerExpenseImage, handleOwnerExpenseText, handleOwnerPaidExpenseMethodFollowup, handleOwnerRecentSlipProjectPurpose, handleOwnerStaffSlipText } from '../netlify/functions/_owner-expense-intake';
import { normalizeFinancialImageExtraction, type FinancialImageExtraction } from '../netlify/functions/_inthanin-daily-close-image';
import {
  isAuthorizedOwnerPaymentActor, ownerPaymentDocumentGate, ownerPaymentDocumentClarification,
  OWNER_DOCUMENT_KIND_QUESTION, OWNER_FUNDS_DIRECTION_QUESTION, OWNER_NON_PAYMENT_REPLY,
  OWNER_INCOMING_FUNDS_REPLY, OWNER_MULTIPLE_PAYMENTS_REPLY,
} from '../netlify/functions/_owner-payment-document';

const payment = (overrides: Record<string, unknown> = {}): FinancialImageExtraction => normalizeFinancialImageExtraction({
  document_type: 'transfer_slip', document_kind: 'transfer_evidence', funds_direction: 'outgoing',
  amount_total: 5000, document_date_local: '2026-10-11', confidence: 0.98,
  visible_payment_note: 'ค่าอุปกรณ์ไฟฟ้า ตำมาชาติ', payment_document_count: 1,
  ...overrides,
}, 'offline-fixture');

function harness(t: any, extraction: FinancialImageExtraction, options: { failExtraction?: boolean; priorIntake?: Record<string, unknown>; pendingPayroll?: Record<string, unknown> } = {}) {
  const keys = ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','LINE_CHANNEL_ACCESS_TOKEN','GEMINI_API_KEY',
    'OPENAI_API_KEY','OWNER_FINANCE_LINE_USER_HASHES','THONGTHAI_OWNER_SLIP_MODE'];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, {
    SUPABASE_URL: 'https://owner-document-fixture.test', SUPABASE_SERVICE_ROLE_KEY: 'fixture-only',
    LINE_CHANNEL_ACCESS_TOKEN: 'fixture-only', GEMINI_API_KEY: 'fixture-only',
    OWNER_FINANCE_LINE_USER_HASHES: piiHash('fixture-owner')!, THONGTHAI_OWNER_SLIP_MODE: 'active',
  });
  delete process.env.OPENAI_API_KEY;
  t.after(() => { for (const key of keys) {
    if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
  } });
  const calls: Array<{ url: URL; method: string; body: any }> = [];
  t.mock.method(globalThis, 'fetch', async (input: any, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    calls.push({ url, method: init.method ?? 'GET', body });
    if (url.hostname === 'api-data.line.me') return new Response(Buffer.from('offline image fixture'), {
      headers: { 'Content-Type': 'image/png' },
    });
    if (url.hostname === 'generativelanguage.googleapis.com') {
      assert.match(body.contents[0].parts[0].text, /not pages, documents, chat thumbnails/);
      assert.match(body.contents[0].parts[0].text, /Never combine amounts for different people/);
      if (options.failExtraction) return new Response('{}', { status: 503 });
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(extraction) }] } }] });
    }
    assert.equal(url.hostname, 'owner-document-fixture.test', 'No real network or LINE send is allowed');
    if (url.pathname.endsWith('/ops_notification_channels')) return Response.json([{ team_code: 'owner_general' }]);
    if (url.pathname.endsWith('/financial_employee_payroll_events')) return Response.json(options.pendingPayroll ? [options.pendingPayroll] : []);
    if (url.pathname.endsWith('/financial_attach_owner_payroll_slip_v1')) return Response.json({ ok: true, status: 'paid' });
    if (url.pathname.endsWith('/financial_owner_expense_intakes')) return Response.json(options.priorIntake ? [options.priorIntake] : []);
    if (url.pathname.startsWith('/storage/')) return Response.json({});
    if (url.pathname.endsWith('/financial_capture_owner_slip_review_v1')) return Response.json({
      ok: true, intake_id: '11111111-1111-4111-8111-111111111111', status: 'awaiting_purpose',
    });
    if (url.pathname.endsWith('/owner_projects')) return Response.json([]);
    if (url.pathname.endsWith('/financial_stage_owner_slip_review_v1')) return Response.json({
      ok: true, revision: 1, proposal: body.p_proposal,
    });
    throw new Error('Unexpected request in offline fixture: ' + url.pathname);
  });
  return {
    calls,
    run: (input: Partial<Parameters<typeof handleOwnerExpenseImage>[0]> = {}) => handleOwnerExpenseImage({
      targetId: 'fixture-owner-group', userId: 'fixture-owner', messageId: 'fixture-image', intent: 'payment_review', ...input,
    }),
    writes: () => calls.filter(call => call.url.pathname.startsWith('/storage/') || call.url.pathname.includes('/rpc/')),
  };
}

test('quotation collage metadata dominates contradictory slip type, page count and displayed totals', () => {
  // Synthetic extraction transcribed from the acceptance screenshot's situation, not a live OCR claim.
  const quote = payment({ document_type: 'transfer_slip', document_kind: 'quotation',
    amount_total: 95000, payment_document_count: 3,
    visible_payment_note: 'ของช่างไม้ 5000 ของพี่ต๊อด 90000 ครับ ตามสัญญา',
  });
  assert.equal(quote.document_type, 'other');
  assert.equal(quote.amount_total, null);
  assert.equal(quote.payment_document_count, 0);
  assert.equal(quote.funds_direction, 'unknown');
  assert.equal(quote.expense_category, null);
  assert.equal(ownerPaymentDocumentGate(quote).kind, 'non_payment');
  assert.equal(ownerPaymentDocumentGate(quote, { fundsDirection: 'outgoing' }).kind, 'non_payment');
  assert.doesNotMatch(ownerPaymentDocumentClarification(ownerPaymentDocumentGate(quote)), /หลายสลิป|95,000|95000/);
});

test('unpaid invoice and contract cannot become outgoing payment evidence', () => {
  for (const document_kind of ['unpaid_invoice','contract']) {
    const extraction = payment({ document_kind, payment_document_count: 2 });
    assert.equal(extraction.amount_total, null);
    assert.equal(extraction.payment_document_count, 0);
    assert.equal(ownerPaymentDocumentGate(extraction, { fundsDirection: 'outgoing' }).kind, 'non_payment');
  }
});

test('raw out-of-enum nonpayment document_type is preserved as kind and normalized to compatible other', () => {
  for (const document_type of ['quotation','unpaid_invoice','contract']) {
    const extraction = normalizeFinancialImageExtraction({ document_type, amount_total: 90000, payment_document_count: 2 }, 'fixture');
    assert.equal(extraction.document_kind, document_type);
    assert.equal(extraction.document_type, 'other');
    assert.equal(extraction.amount_total, null);
  }
});

test('unknown evidence never becomes a payment because an amount, direction, bank or memo is provided', () => {
  const extraction = payment({ document_kind: 'unknown', amount_total: 95000,
    visible_payment_note: 'ของช่างไม้ 5000 ของพี่ต๊อด 90000 ครับ ตามสัญญา', bank: 'fixture bank',
  });
  assert.equal(ownerPaymentDocumentGate(extraction, { fundsDirection: 'outgoing' }).kind, 'needs_document_kind');
  assert.equal(ownerPaymentDocumentClarification(ownerPaymentDocumentGate(extraction)), OWNER_DOCUMENT_KIND_QUESTION);
});

test('new missing metadata fails closed while raw legacy transfer and paid receipt rows remain readable', () => {
  const normalized = normalizeFinancialImageExtraction({ document_type: 'transfer_slip', amount_total: 5000, confidence: 0.98 }, 'fixture');
  assert.equal(normalized.document_kind, 'unknown');
  assert.equal(normalized.funds_direction, 'unknown');
  assert.equal(ownerPaymentDocumentGate(normalized).kind, 'needs_document_kind');
  for (const document_type of ['transfer_slip','purchase_receipt','expense_receipt'] as const) {
    const legacy = { ...payment(), document_type };
    delete legacy.document_kind; delete legacy.funds_direction;
    assert.equal(ownerPaymentDocumentGate(legacy).kind, 'payment_evidence');
  }
  const legacyUnknown = { ...payment(), document_type: 'other' as const };
  delete legacyUnknown.document_kind; delete legacyUnknown.funds_direction;
  assert.equal(ownerPaymentDocumentGate(legacyUnknown).kind, 'needs_document_kind');
});

test('new transfer evidence requires explicit outgoing perspective and incoming funding cannot be reclassified by outgoing context', () => {
  const unknown = payment({ funds_direction: 'unknown' });
  assert.equal(ownerPaymentDocumentGate(unknown).kind, 'needs_funds_direction');
  assert.equal(ownerPaymentDocumentClarification(ownerPaymentDocumentGate(unknown)), OWNER_FUNDS_DIRECTION_QUESTION);
  assert.equal(ownerPaymentDocumentGate(unknown, { fundsDirection: 'outgoing' }).kind, 'payment_evidence');
  assert.equal(ownerPaymentDocumentGate(unknown, { fundsDirection: 'incoming' }).kind, 'incoming_funds');
  assert.equal(ownerPaymentDocumentGate(payment({ funds_direction: 'incoming' }), { fundsDirection: 'outgoing' }).kind, 'incoming_funds');
});

test('mixed or low confidence evidence cannot be captured and genuine multiple transactions cannot be combined', () => {
  assert.equal(ownerPaymentDocumentGate(payment({ confidence: 0.79 })).kind, 'needs_document_kind');
  assert.equal(ownerPaymentDocumentGate(payment({ document_kind: 'paid_receipt' })).kind, 'needs_document_kind');
  const multiple = payment({ payment_document_count: 2, amount_total: 95000 });
  assert.equal(multiple.amount_total, null);
  assert.equal(multiple.visible_payment_note, null);
  assert.deepEqual(ownerPaymentDocumentGate(multiple), {
    kind: 'multiple_payment_evidence', documentKind: 'transfer_evidence', paymentCount: 2,
  });
  assert.equal(ownerPaymentDocumentGate(payment({ payment_document_count: 0 })).kind, 'needs_document_kind');
});

test('only exact configured owner identities authorize payment handling; investor/group membership never does', () => {
  assert.equal(isAuthorizedOwnerPaymentActor('owner', {}), false);
  assert.equal(isAuthorizedOwnerPaymentActor('owner', { OWNER_FINANCE_LINE_USER_HASHES: ' , ' }), false);
  assert.equal(isAuthorizedOwnerPaymentActor('owner', { OWNER_FINANCE_LINE_USER_HASHES: piiHash('owner') + ', ' + piiHash('second-owner') }), true);
  assert.equal(isAuthorizedOwnerPaymentActor('owner', { LINE_OPS_ADMIN_USER_IDS: 'owner' }), false);
  for (const invalid of ['owner', piiHash('owner')!.toUpperCase(), piiHash('owner')! + ',invalid']) {
    assert.equal(isAuthorizedOwnerPaymentActor('owner', { OWNER_FINANCE_LINE_USER_HASHES: invalid }), false);
  }
  for (const user of [null, undefined, '', 'owner ', 'investor-aunt']) {
    assert.equal(isAuthorizedOwnerPaymentActor(user, { OWNER_FINANCE_LINE_USER_HASHES: piiHash('owner')! }), false);
  }
});

test('ordinary images remain quiet with zero OCR, image fetch, database lookup or persistent draft', async t => {
  const h = harness(t, payment());
  assert.equal(await h.run({ intent: undefined }), null);
  assert.equal(h.calls.length, 0);
});

test('new investor participant cannot trigger any image processing even with an explicit payment request', async t => {
  const h = harness(t, payment());
  assert.equal(await h.run({ userId: 'fixture-investor-aunt' }), null);
  delete process.env.OWNER_FINANCE_LINE_USER_HASHES;
  assert.equal(await h.run(), null);
  assert.equal(h.calls.length, 0);
});

test('targeted quotation collage gets one concise explanation and no capture, storage or review write', async t => {
  const h = harness(t, payment({ document_kind: 'quotation', amount_total: 95000, payment_document_count: 2 }));
  assert.equal(await h.run(), OWNER_NON_PAYMENT_REPLY);
  assert.deepEqual(h.writes(), []);
  assert.ok(!h.calls.some(call => call.url.hostname === 'api.line.me'));
});

test('targeted unreadable image asks document kind without creating a blank draft', async t => {
  const h = harness(t, payment({ document_type: 'other', document_kind: 'unknown', payment_document_count: 3 }));
  assert.equal(await h.run(), OWNER_DOCUMENT_KIND_QUESTION);
  assert.deepEqual(h.writes(), []);
});

test('extraction provider failure falls back to one neutral clarification without any financial write', async t => {
  const h = harness(t, payment(), { failExtraction: true });
  t.mock.method(console, 'error', () => {});
  assert.equal(await h.run(), OWNER_DOCUMENT_KIND_QUESTION);
  assert.deepEqual(h.writes(), []);
});

test('targeted transfer with unknown direction requests direction before storing anything', async t => {
  const h = harness(t, payment({ funds_direction: 'unknown' }));
  assert.equal(await h.run(), OWNER_FUNDS_DIRECTION_QUESTION);
  assert.deepEqual(h.writes(), []);
});

test('incoming investor funds stay out of expense capture even under payment review intent', async t => {
  const h = harness(t, payment({ funds_direction: 'incoming' }));
  assert.equal(await h.run(), OWNER_INCOMING_FUNDS_REPLY);
  assert.deepEqual(h.writes(), []);
});

test('document help intent cannot create an expense even for clear outgoing payment evidence', async t => {
  const h = harness(t, payment());
  assert.match((await h.run({ intent: 'document_help' }))!, /ต้องการให้ตรวจรายการจ่าย/);
  assert.deepEqual(h.writes(), []);
});

test('genuine multiple payment slips request separation before any storage or capture', async t => {
  const h = harness(t, payment({ payment_document_count: 2, amount_total: 95000 }));
  assert.equal(await h.run(), OWNER_MULTIPLE_PAYMENTS_REPLY);
  assert.deepEqual(h.writes(), []);
});

test('explicit authorized outgoing review alone can create a draft and never confirms it', async t => {
  const h = harness(t, payment({ funds_direction: 'unknown' }));
  const reply = await h.run({ fundsDirection: 'outgoing' });
  assert.match(reply!, /ยังไม่บันทึกรายจ่าย/);
  const capture = h.calls.find(call => call.url.pathname.endsWith('/financial_capture_owner_slip_review_v1'));
  assert.ok(capture);
  assert.equal(capture.body.p_extraction.amount_total, 5000);
  assert.equal(capture.body.p_extraction.funds_direction, 'outgoing');
  assert.equal(h.calls.filter(call => call.url.pathname.endsWith('/financial_stage_owner_slip_review_v1')).length, 1);
  assert.ok(!h.calls.some(call => /financial_confirm|financial_resolve|investment_entries|ledger_entries/.test(call.url.pathname)));
});

test('extraction guidance distinguishes completed payment evidence, unpaid proposals and funds direction', () => {
  const source = readFileSync('netlify/functions/_inthanin-daily-close-image.ts', 'utf8');
  assert.match(source, /Multiple pages of one document do not imply multiple slips/);
  assert.match(source, /Do not treat incoming investor funding or owner contributions as expenses/);
  assert.match(source, /not a payment request, pending screen, quotation/);
  assert.match(source, /Distinguish the document itself from a transfer memo mentioning a contract/);
});


test('a legacy unknown draft cannot resurface as a blank payment summary on duplicate image lookup', async t => {
  const legacy = { ...payment(), document_type: 'other' as const, amount_total: null };
  delete legacy.document_kind; delete legacy.funds_direction;
  const h = harness(t, payment(), { priorIntake: {
    id: 'b6d75100-0000-4000-8000-000000000000', status: 'awaiting_purpose', amount: null,
    document_type: 'other', extraction_data: legacy,
  } });
  assert.equal(await h.run(), OWNER_DOCUMENT_KIND_QUESTION);
  assert.deepEqual(h.writes(), []);
  assert.ok(!h.calls.some(call => call.url.hostname === 'api-data.line.me'));
});

test('a known quotation draft stays nonpayment on duplicate image lookup', async t => {
  const h = harness(t, payment(), { priorIntake: {
    id: 'b6d75100-0000-4000-8000-000000000000', status: 'awaiting_purpose', amount: null,
    document_type: 'other', extraction_data: payment({ document_kind: 'quotation' }),
  } });
  assert.equal(await h.run(), OWNER_NON_PAYMENT_REPLY);
  assert.deepEqual(h.writes(), []);
});


test('unauthorized group members cannot mutate through any legacy owner expense text entry point', async t => {
  const h = harness(t, payment());
  const base = { targetId: 'fixture-owner-group', userId: 'fixture-investor-aunt', messageId: 'fixture-text' };
  assert.equal(await handleOwnerExpenseText({ ...base, text: 'จ่ายค่าอุปกรณ์ 5000 ตำมาชาติ' }), null);
  assert.equal(await handleOwnerPaidExpenseMethodFollowup({ ...base, text: 'เงินสด' }), null);
  assert.equal(await handleOwnerRecentSlipProjectPurpose({ ...base, text: 'ค่าอุปกรณ์ โครงการตำมาชาติ' }), null);
  assert.equal(await handleOwnerStaffSlipText({ ...base, text: 'เจิดเบิกไปซื้อของ Inthanin' }), null);
  assert.equal(h.calls.length, 0);
});

test('missing financial owner configuration closes every legacy text mutation route', async t => {
  const h = harness(t, payment());
  delete process.env.OWNER_FINANCE_LINE_USER_HASHES;
  const base = { targetId: 'fixture-owner-group', userId: 'fixture-owner', messageId: 'fixture-text' };
  assert.equal(await handleOwnerExpenseText({ ...base, text: 'ลงทุนเงินสด 5000 ซื้อชั้นวาง ตำมาชาติ' }), null);
  assert.equal(await handleOwnerPaidExpenseMethodFollowup({ ...base, text: 'โอนเงิน' }), null);
  assert.equal(await handleOwnerRecentSlipProjectPurpose({ ...base, text: 'ค่าอุปกรณ์ โครงการตำมาชาติ' }), null);
  assert.equal(await handleOwnerStaffSlipText({ ...base, text: 'เจิดเบิกไปซื้อของ Inthanin' }), null);
  assert.equal(h.calls.length, 0);
});

test('recent project continuation excludes reviewed drafts before reaching legacy financial resolution', async t => {
  const h = harness(t, payment(), { priorIntake: {
    id: 'b6d75100-0000-4000-8000-000000000000', source_user_hash: piiHash('fixture-owner'),
    status: 'awaiting_purpose', review_state: 'draft', amount: null,
    document_type: 'other', created_at: new Date().toISOString(),
  } });
  assert.equal(await handleOwnerRecentSlipProjectPurpose({ targetId: 'fixture-owner-group', userId: 'fixture-owner',
    messageId: 'fixture-text', text: 'ค่าอุปกรณ์ โครงการตำมาชาติ' }), null);
  const read = h.calls.find(call => call.url.pathname.endsWith('/financial_owner_expense_intakes'));
  assert.equal(read?.url.searchParams.get('review_state'), 'is.null');
  assert.deepEqual(h.writes(), []);
});

test('legacy expense and staff selectors defensively exclude review drafts even if returned by a stub', async t => {
  const h = harness(t, payment(), { priorIntake: {
    id: 'b6d75100-0000-4000-8000-000000000000', source_user_hash: piiHash('fixture-owner'),
    status: 'awaiting_purpose', review_state: 'draft', amount: null,
    document_type: 'other', created_at: new Date().toISOString(),
  } });
  const base = { targetId: 'fixture-owner-group', userId: 'fixture-owner', messageId: 'fixture-text' };
  assert.equal(await handleOwnerExpenseText({ ...base, text: '#B6D751 ของช่างไม้ 5000 ของพี่ต๊อด 90000 ตามสัญญา' }), null);
  await handleOwnerStaffSlipText({ ...base, text: '#B6D751 เจิดเบิกไปซื้อของ Inthanin' });
  assert.deepEqual(h.writes(), []);
});


const targetedPayroll = () => ({
  id: 'fixture-payroll', event_type: 'salary_payment', employee_label: 'fixture-employee', employee_key: 'fixture-employee',
  amount: 5000, event_date: '2026-10-11', pay_period: null, status: 'awaiting_slip',
  owner_group_hash: piiHash('fixture-owner-group'), created_by_hash: piiHash('fixture-owner'), created_at: new Date().toISOString(),
});
const payrollInput = { targetId: 'fixture-owner-group', userId: 'fixture-owner', messageId: 'fixture-payroll-image' };

test('unauthorized group members cannot initiate payroll, deduct advances, process images or reuse stored slips', async t => {
  const h = harness(t, payment(), { pendingPayroll: targetedPayroll() });
  const userId = 'fixture-investor-aunt';
  assert.equal(await handleOwnerPayrollImage({ ...payrollInput, userId }), null);
  assert.equal(await handleOwnerPayrollText({ ...payrollInput, userId, text: 'หักเบิก เจิด 5000' }), null);
  assert.equal(await handleOwnerPayrollText({ ...payrollInput, userId, text: 'จ่ายเงินเดือน เจิด 5000' }), null);
  assert.match(await recordOwnerPayrollFromStoredSlip({ targetId: payrollInput.targetId, userId,
    intakeId: 'fixture-intake', employeeLabel: 'เจิด', eventType: 'salary_payment' }), /ยังไม่ได้เปิดสิทธิ์/);
  assert.equal(h.calls.length, 0);
});

test('payroll without a targeted session never fetches an image', async t => {
  const h = harness(t, payment());
  assert.equal(await handleOwnerPayrollImage(payrollInput), null);
  assert.ok(!h.calls.some(call => call.url.hostname === 'api-data.line.me'));
  assert.deepEqual(h.writes(), []);
});

test('another owner session cannot consume the current owner image', async t => {
  const h = harness(t, payment(), { pendingPayroll: { ...targetedPayroll(), created_by_hash: piiHash('another-owner') } });
  assert.equal(await handleOwnerPayrollImage(payrollInput), null);
  assert.ok(!h.calls.some(call => call.url.hostname === 'api-data.line.me'));
  assert.deepEqual(h.writes(), []);
});

test('a foreign group pending payroll result cannot consume an image', async t => {
  const h = harness(t, payment(), { pendingPayroll: { ...targetedPayroll(), owner_group_hash: piiHash('another-group') } });
  assert.equal(await handleOwnerPayrollImage(payrollInput), null);
  assert.ok(!h.calls.some(call => call.url.hostname === 'api-data.line.me'));
  assert.deepEqual(h.writes(), []);
});

for (const [name, overrides, expected] of [
  ['quotation', { document_kind: 'quotation', amount_total: 95000, payment_document_count: 2 }, OWNER_NON_PAYMENT_REPLY],
  ['unknown', { document_kind: 'unknown' }, OWNER_DOCUMENT_KIND_QUESTION],
  ['incoming investor funding', { funds_direction: 'incoming' }, OWNER_INCOMING_FUNDS_REPLY],
  ['multiple transactions', { payment_document_count: 2 }, OWNER_MULTIPLE_PAYMENTS_REPLY],
] as const) {
  test('targeted payroll rejects ' + name + ' before storage or attachment', async t => {
    const h = harness(t, payment(overrides), { pendingPayroll: targetedPayroll() });
    assert.equal(await handleOwnerPayrollImage(payrollInput), expected);
    assert.deepEqual(h.writes(), []);
  });
}

test('targeted authenticated payroll supplies outgoing context and preserves genuine payment handling', async t => {
  const h = harness(t, payment({ funds_direction: 'unknown' }), { pendingPayroll: targetedPayroll() });
  assert.match((await handleOwnerPayrollImage(payrollInput))!, /จับคู่สลิปสำเร็จ/);
  const attach = h.calls.find(call => call.url.pathname.endsWith('/financial_attach_owner_payroll_slip_v1'));
  assert.ok(attach);
  assert.equal(attach.body.p_event_id, 'fixture-payroll');
  assert.equal(attach.body.p_slip_amount, 5000);
  assert.equal(attach.body.p_extracted_data.funds_direction, 'outgoing');
  assert.ok(!h.calls.some(call => call.url.pathname.endsWith('/financial_create_owner_payroll_event_v1')));
});

for (const [name, extraction, expected] of [
  ['quotation', payment({ document_kind: 'quotation' }), OWNER_NON_PAYMENT_REPLY],
  ['unknown with a typed amount', payment({ document_type: 'other', document_kind: 'unknown' }), OWNER_DOCUMENT_KIND_QUESTION],
  ['incoming funds', payment({ funds_direction: 'incoming' }), OWNER_INCOMING_FUNDS_REPLY],
  ['missing extraction', null, OWNER_DOCUMENT_KIND_QUESTION],
] as const) {
  test('stored-slip payroll rejects ' + name + ' before creating a payroll event', async t => {
    const h = harness(t, payment(), { priorIntake: {
      id: 'fixture-intake', status: 'awaiting_purpose', amount: null, document_type: 'other', extraction_data: extraction,
    } });
    assert.equal(await recordOwnerPayrollFromStoredSlip({ targetId: payrollInput.targetId, userId: payrollInput.userId,
      intakeId: 'fixture-intake', employeeLabel: 'เจิด', eventType: 'salary_payment', declaredAmount: 95000 }), expected);
    assert.deepEqual(h.writes(), []);
  });
}
