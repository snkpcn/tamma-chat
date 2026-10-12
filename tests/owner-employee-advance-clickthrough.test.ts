import test from 'node:test';
import assert from 'node:assert/strict';
import { handleOwnerDocumentIntent } from '../netlify/functions/_owner-document-intent';
import { handleOwnerExpenseImage } from '../netlify/functions/_owner-expense-intake';
import { decodeOwnerDocumentAction } from '../netlify/functions/_owner-document-intent-ui';
import { piiHash } from '../netlify/functions/_operations-db';
import { ownerSlipReplyCard, handleOwnerSlipPostback } from '../netlify/functions/_owner-slip-cards';
import { handleOwnerEmployeeAdvancePostback, handleOwnerEmployeeAdvanceText, openOwnerEmployeeAdvanceReview } from '../netlify/functions/_owner-employee-advance';
import { decodeAdvanceAction } from '../netlify/functions/_owner-employee-advance-card';
import { decodeOwnerSlipAction, encodeOwnerSlipAction } from '../netlify/functions/_owner-slip-review-ui';
import { employeeClickthroughDatabase, eventInput, evidenceSnapshot, SYNTHETIC as S } from './helpers/employee-advance-clickthrough-db';

type Card = any;
function collect(card: Card, key: string): any[] {
  if (!card || typeof card !== 'object') return [];
  return Object.entries(card).flatMap(([name, value]) => [...(name === key ? [value] : []), ...collect(value, key)]);
}
const visible = (card: Card) => collect(card, 'text').concat(collect(card, 'label')).join('\n');
const buttons = (card: Card) => collect(card, 'action').filter(a => a?.type === 'postback')
  .map(a => ({ ...a, decoded: decodeAdvanceAction(a.data) ?? decodeOwnerSlipAction(a.data) }));
function button(card: Card, action: string, value?: string) {
  const found = buttons(card).filter(b => b.decoded?.action === action && (value === undefined || b.decoded.value === value));
  assert.equal(found.length, 1, `Expected one visible ${action} button, got ${found.length}: ${visible(card)}`);
  return found[0];
}
const has = (card: Card, action: string) => buttons(card).some(b => b.decoded?.action === action);
let message = 0;
async function click(card: Card, action: string, value?: string, overrides: Record<string, unknown> = {}) {
  const input = { ...eventInput, messageId: 'synthetic-click-' + (++message), data: button(card, action, value).data, ...overrides };
  return input.data.startsWith('owner-advance:') ? handleOwnerEmployeeAdvancePostback(input) : handleOwnerSlipPostback(input);
}
function review(row: any) {
  return ownerSlipReplyCard({ ...eventInput, messageId: 'synthetic-review-' + (++message),
    text: 'ตรวจสลิป #' + row.id.replace(/-/g, '').slice(0, 6).toUpperCase() + ' · ฉบับ ' + row.review_revision + ' (ยังไม่บันทึกรายจ่าย)\n' });
}
async function assertNoMoney(h: Awaited<ReturnType<typeof employeeClickthroughDatabase>>, baseline: any) {
  assert.deepEqual(await h.moneyCounts(), baseline);
  assert.equal(h.calls.filter(c => c.path === 'rpc/financial_confirm_owner_employee_advance_v1').length, 0);
  assert.equal(h.calls.filter(c => c.path === 'rpc/financial_confirm_owner_slip_review_v1' && !c.body.p_cancel).length, 0);
}
async function bindAlias(h: Awaited<ReturnType<typeof employeeClickthroughDatabase>>, employeeId = S.employeeId, alias = S.alias) {
  await h.db.query(`update public.financial_owner_employee_profiles set salary_advance_aliases=$3::text[],
    salary_advance_alias_approval_ref='synthetic-alias-owner-approval' where owner_group_hash=$1 and employee_id=$2`,
    [h.groupHash, employeeId, [alias]]);
}
async function manualReady(h: Awaited<ReturnType<typeof employeeClickthroughDatabase>>, card?: Card) {
  card ??= await review(await h.seedDraft());
  card = await click(card, 'employee_advance');
  card = await click(card, 'employee', S.employeeId);
  return click(card, 'salary');
}

test('filled-purpose revision-2 draft: visible buttons select existing employee, review totals and confirm exactly once', async t => {
  const h = await employeeClickthroughDatabase(t);
  const original = await h.seedDraft();
  const baseline = await h.moneyCounts();
  assert.equal(original.review_revision, 2);
  assert.equal(original.review_data.business_unit_code, 'shared');
  assert.equal(original.review_data.project_id, null);
  assert.ok(original.review_data.purpose);
  const generic = await review(original);
  assert.equal(button(generic, 'employee_advance').label, 'เงินเบิกพนักงาน');
  const chooser = await click(generic, 'employee_advance');
  assert.equal(chooser?.type, 'flex');
  assert.equal(has(chooser, 'confirm'), false);
  assert.equal(buttons(chooser).filter(b => b.decoded?.action === 'employee').length, 2);
  await assertNoMoney(h, baseline);
  const converted = await h.getIntake();
  assert.equal(converted.review_data.kind, 'employee_advance');
  assert.equal(converted.review_revision, 3);
  assert.deepEqual(evidenceSnapshot(converted), evidenceSnapshot(original));
  const typeCard = await click(chooser, 'employee', S.employeeId);
  assert.equal(has(typeCard, 'salary'), true);
  assert.equal(has(typeCard, 'purchase'), true);
  assert.equal(has(typeCard, 'confirm'), false);
  await assertNoMoney(h, baseline);
  const ready = await click(typeCard, 'salary');
  for (const value of ['ตัวอย่างเอ ทดสอบ', 'ฝ่ายตัวอย่าง', 'ส่วนกลาง', '640 บาท', '125 บาท', '765 บาท', 'คาดการณ์', 'ยังไม่ระบุ']) {
    assert.ok(visible(ready).includes(value), value);
  }
  assert.doesNotMatch(visible(ready), /เงินเดือนสุทธิ:|เงินเดือนคงเหลือ/u);
  assert.equal((await h.getIntake()).review_data.funding_source, 'unknown');
  await assertNoMoney(h, baseline);
  const receipt = await click(ready, 'confirm');
  const commit = h.calls.find(c => c.path === 'rpc/financial_confirm_owner_employee_advance_v1')!;
  assert.equal(commit.result.monthly_sum, 765);
  assert.ok(visible(receipt).includes(commit.result.monthly_sum + ' บาท'));
  assert.match(visible(receipt), /ที่บันทึกจริง/);
  assert.doesNotMatch(visible(receipt), /คาดการณ์|ยืนยันบันทึก/);
  assert.equal(buttons(receipt).length, 0);
  const saved = await h.getIntake();
  assert.deepEqual(evidenceSnapshot(saved), evidenceSnapshot(original));
  assert.equal(saved.review_state, 'confirmed');
  assert.equal(saved.payroll_event_id, commit.result.event_id);
  const event = (await h.db.query<any>('select * from public.financial_employee_payroll_events where id=$1', [saved.payroll_event_id])).rows[0];
  assert.equal(event.employee_id, S.employeeId);
  assert.equal(event.source_intake_id, original.id);
  assert.equal(event.funding_source, 'unknown');
  assert.deepEqual(event.slip_extracted_data, original.extraction_data);
  assert.equal(Number(event.amount), 125);
  assert.deepEqual(await h.moneyCounts(), { paid: 2, investments: 0, expenses: 0 });
  const repeat = await click(ready, 'confirm');
  assert.match(visible(repeat), /บันทึกแล้ว|บันทึกเงินเบิกแล้ว/);
  assert.deepEqual(await h.moneyCounts(), { paid: 2, investments: 0, expenses: 0 });
  assert.equal((await h.db.query<any>(`select count(*) as n from public.financial_employee_advance_audit_events where action='confirmed'`)).rows[0].n, 1);
});

test('employee entry is reachable from every generic selection, error and final summary card', async t => {
  const h = await employeeClickthroughDatabase(t);
  const baseline = await h.moneyCounts();
  const views = ['business', 'project', 'category', 'destination', 'installment', 'error', 'review'];
  for (const [index, view] of views.entries()) {
    const id = '61000000-0000-4000-8000-' + String(index + 1).padStart(12, '0');
    const row = await h.seedDraft({ id, proposal: { questions: view === 'error' ? ['รายละเอียดตัวอย่างยังไม่ครบ'] : [], review_choices: {
      business: 'shared', project: null, category: 'consumables', destination: 'operating_expense', installment: null,
    } } });
    // Open current screens using canonical existing generic navigation. The next
    // employee action must be obtained from the returned visible payload.
    const data = encodeOwnerSlipAction({ id, revision: 2, action: 'show_' + (view === 'error' ? 'review' : view) });
    const card = await handleOwnerSlipPostback({ ...eventInput, data, messageId: 'synthetic-open-' + view });
    assert.equal(button(card, 'employee_advance').label, 'เงินเบิกพนักงาน', view);
    const chooser = await click(card, 'employee_advance');
    assert.equal(buttons(chooser).filter(b => b.decoded?.action === 'employee').length, 2, view);
    const after = await h.getIntake(id);
    assert.equal(after.review_data.kind, 'employee_advance');
    assert.deepEqual(evidenceSnapshot(after), evidenceSnapshot(row));
    await assertNoMoney(h, baseline);
  }
});

test('approved exact saved alias goes directly to employee and authoritative preview without loading projects', async t => {
  const h = await employeeClickthroughDatabase(t);
  await bindAlias(h);
  const original = await h.seedDraft({ note: S.alias });
  const baseline = await h.moneyCounts();
  h.faults.catalogue = true;
  const card = await review(original);
  assert.equal(card.type, 'flex');
  assert.equal(has(card, 'confirm'), true);
  for (const text of ['ตัวอย่างเอ ทดสอบ', '640 บาท', '765 บาท']) assert.ok(visible(card).includes(text));
  const staged = await h.getIntake();
  assert.equal(staged.review_data.employee_id, S.employeeId);
  assert.equal(staged.review_data.event_type, 'salary_advance');
  assert.equal(staged.review_data.alias_inference.normalized_alias, S.alias);
  assert.equal(staged.review_data.alias_inference.approval_ref, 'synthetic-alias-owner-approval');
  assert.deepEqual(evidenceSnapshot(staged), evidenceSnapshot(original));
  assert.equal(h.calls.some(c => c.path === 'owner_projects'), false);
  await assertNoMoney(h, baseline);
});

test('unknown and ambiguous employee notes require explicit type; bad OCR name has an unfiltered button escape', async t => {
  const h = await employeeClickthroughDatabase(t);
  const baseline = await h.moneyCounts();
  await h.seedDraft({ note: 'ตัวอย่างผิดเบิก' });
  const filtered = await review(await h.getIntake());
  assert.equal(filtered?.type, 'flex');
  assert.equal(has(filtered, 'confirm'), false);
  const all = await click(filtered, 'show_employee');
  assert.equal(buttons(all).filter(b => b.decoded?.action === 'employee').length, 2);
  const type = await click(all, 'employee', S.employeeId);
  assert.equal(has(type, 'salary'), true);
  assert.equal((await h.getIntake()).review_data.event_type, 'unknown');
  await assertNoMoney(h, baseline);
  assert.equal((await h.db.query<any>('select count(*) as n from tamma_chart_os.employees')).rows[0].n, 2);
});

test('duplicate private aliases stay ambiguous and explicit employee choice never silently approves salary', async t => {
  const h = await employeeClickthroughDatabase(t);
  await bindAlias(h);
  await bindAlias(h, S.secondEmployeeId);
  const row = await h.seedDraft({ note: S.alias });
  const baseline = await h.moneyCounts();
  const card = await review(row);
  assert.equal(has(card, 'confirm'), false);
  assert.equal(buttons(card).filter(b => b.decoded?.action === 'employee').length, 2);
  const selected = await click(card, 'employee', S.secondEmployeeId);
  assert.equal(has(selected, 'salary'), true);
  assert.equal((await h.getIntake()).review_data.employee_id, S.secondEmployeeId);
  assert.equal((await h.getIntake()).review_data.event_type, 'unknown');
  assert.equal((await h.getIntake()).review_data.alias_inference ?? null, null);
  await assertNoMoney(h, baseline);
});

test('purchase button returns the same evidence to expense review without choosing a ledger or confirming salary', async t => {
  const h = await employeeClickthroughDatabase(t);
  const original = await h.seedDraft();
  const baseline = await h.moneyCounts();
  let card = await click(await review(original), 'employee_advance');
  card = await click(card, 'employee', S.employeeId);
  const result = await click(card, 'purchase');
  assert.equal(result?.type, 'flex');
  assert.equal(buttons(result).some(b => b.data.startsWith('owner-advance:')), false);
  const after = await h.getIntake();
  assert.notEqual(after.review_data.kind, 'employee_advance');
  assert.match(after.review_data.purpose, /ซื้อ|สำรองจ่าย/);
  assert.equal(after.review_data.expense_class, 'uncategorized');
  assert.ok(after.review_data.questions.length, 'Unknown purchase details still require explicit review');
  assert.deepEqual(evidenceSnapshot(after), evidenceSnapshot(original));
  await assertNoMoney(h, baseline);
});

test('old generic view and generic confirm buttons reopen latest employee card, never post a generic expense', async t => {
  const h = await employeeClickthroughDatabase(t);
  const row = await h.seedDraft({ proposal: { questions: [], review_choices: {
    business: 'shared', project: null, category: 'consumables', destination: 'operating_expense', installment: null,
  } } });
  const baseline = await h.moneyCounts();
  const generic = await review(row);
  const oldConfirm = button(generic, 'confirm').data;
  const oldView = button(generic, 'show_project').data;
  const employee = await manualReady(h, generic);
  const currentRevision = (await h.getIntake()).review_revision;
  for (const data of [oldView, oldConfirm]) {
    const latest = await handleOwnerSlipPostback({ ...eventInput, data, messageId: 'synthetic-old-' + (++message) });
    assert.equal(latest?.type, 'flex');
    assert.match(visible(latest), /ตัวอย่างเอ ทดสอบ/);
    assert.ok(buttons(latest).every(b => b.data.startsWith('owner-advance:') && b.decoded.revision === currentRevision));
    assert.equal((await h.getIntake()).review_revision, currentRevision);
  }
  assert.equal(has(employee, 'confirm'), true);
  await assertNoMoney(h, baseline);
});

test('alias removal between preview and confirmation cannot write and refresh asks salary type again', async t => {
  const h = await employeeClickthroughDatabase(t);
  await bindAlias(h);
  const card = await review(await h.seedDraft({ note: S.alias }));
  const baseline = await h.moneyCounts();
  assert.equal(has(card, 'confirm'), true);
  await h.db.query(`update public.financial_owner_employee_profiles set salary_advance_aliases='{}',
    salary_advance_alias_approval_ref=null where owner_group_hash=$1 and employee_id=$2`, [h.groupHash, S.employeeId]);
  const changed = await click(card, 'confirm');
  assert.deepEqual(await h.moneyCounts(), baseline);
  assert.equal(has(changed, 'confirm'), false);
  assert.equal(has(changed, 'salary'), true);
  assert.equal((await h.getIntake()).review_data.alias_inference ?? null, null);
  assert.equal((await h.getIntake()).review_data.event_type, 'unknown');
  assert.equal(h.calls.filter(c => c.path === 'rpc/financial_confirm_owner_employee_advance_v1').length, 1);
  const manual = await click(changed, 'salary');
  assert.equal(has(manual, 'confirm'), true);
  assert.equal((await h.getIntake()).review_data.alias_inference ?? null, null);
  assert.deepEqual(await h.moneyCounts(), baseline);
});

test('changed database month total refreshes before a new owner confirmation; receipt uses that DB result', async t => {
  const h = await employeeClickthroughDatabase(t);
  let card = await manualReady(h);
  await h.db.query(`insert into public.financial_employee_payroll_events
    (employee_id,owner_group_hash,event_type,employee_key,employee_label,amount,event_date,status,funding_source)
    values($1,$2,'salary_advance','synthetic-worker-a','ตัวอย่างเอ ทดสอบ',20,'2026-10-08','paid','unknown')`,
    [S.employeeId, h.groupHash]);
  const baseline = await h.moneyCounts();
  card = await click(card, 'confirm');
  assert.deepEqual(await h.moneyCounts(), baseline);
  assert.match(visible(card), /660 บาท/);
  assert.match(visible(card), /785 บาท/);
  assert.equal(h.calls.filter(c => c.path === 'rpc/financial_confirm_owner_employee_advance_v1').length, 1);
  const receipt = await click(card, 'confirm');
  const last = h.calls.filter(c => c.path === 'rpc/financial_confirm_owner_employee_advance_v1').at(-1)!;
  assert.equal(last.result.monthly_sum, 785);
  assert.match(visible(receipt), /785 บาท/);
  assert.doesNotMatch(visible(receipt), /765 บาท|คาดการณ์/);
  assert.deepEqual(await h.moneyCounts(), { paid: 3, investments: 0, expenses: 0 });
});

test('owner identity, group, message identity, stale revision and maintenance cutoff cannot stage a conversion', async t => {
  const h = await employeeClickthroughDatabase(t);
  await h.seedDraft();
  const original = await h.getIntake();
  const baseline = await h.moneyCounts();
  const input = { ...eventInput, intakeId: S.intakeId, revision: 2, entry: 'manual_button' as const };
  for (const change of [{ userId: 'synthetic-other-participant' }, { targetId: 'synthetic-wrong-group' },
    { messageId: null }, { revision: -1 }, { revision: 1 }]) {
    await openOwnerEmployeeAdvanceReview({ ...input, ...change });
    assert.equal((await h.getIntake()).review_revision, 2);
  }
  process.env.OWNER_FINANCE_LINE_USER_HASHES = h.actorHash + ',' + piiHash('synthetic-second-owner');
  await openOwnerEmployeeAdvanceReview(input);
  process.env.OWNER_FINANCE_LINE_USER_HASHES = h.actorHash;
  process.env.THONGTHAI_OWNER_SLIP_RESUME_AFTER = new Date(S.timestamp + 1).toISOString();
  await openOwnerEmployeeAdvanceReview(input);
  assert.deepEqual(await h.getIntake(), original);
  assert.equal(h.calls.some(c => c.path === 'rpc/financial_stage_owner_employee_advance_v1'), false);
  await assertNoMoney(h, baseline);
});

test('quotation, incoming transfer and multiple-payment evidence never expose the employee payment shortcut', async t => {
  const h = await employeeClickthroughDatabase(t);
  await bindAlias(h);
  const baseline = await h.moneyCounts();
  for (const [index, extraction] of [
    { document_kind: 'quotation' }, { funds_direction: 'incoming' }, { payment_document_count: 2 },
  ].entries()) {
    const id = '71000000-0000-4000-8000-' + String(index + 1).padStart(12, '0');
    await h.seedDraft({ id, note: S.alias, extraction });
    const data = encodeOwnerSlipAction({ id, revision: 2, action: 'show_review' });
    const card = await handleOwnerSlipPostback({ ...eventInput, data, messageId: 'synthetic-document-' + index });
    assert.equal(has(card, 'employee_advance'), false);
    assert.equal(has(card, 'confirm'), false);
    const forced = await openOwnerEmployeeAdvanceReview({ ...eventInput, intakeId: id, revision: 2, entry: 'manual_button' });
    assert.equal(has(forced, 'confirm'), false);
    assert.equal((await h.getIntake(id)).review_revision, 2);
  }
  await assertNoMoney(h, baseline);
});

test('later and cancellation stay reachable without financial posting or evidence loss', async t => {
  const h = await employeeClickthroughDatabase(t);
  const original = await h.seedDraft();
  const baseline = await h.moneyCounts();
  const card = await click(await review(original), 'employee_advance');
  await click(card, 'later');
  assert.equal((await h.getIntake()).review_state, 'draft');
  const cancelled = await click(card, 'cancel');
  assert.equal((await h.getIntake()).review_state, 'cancelled');
  assert.equal(buttons(cancelled).length, 0);
  assert.deepEqual(evidenceSnapshot(await h.getIntake()), evidenceSnapshot(original));
  await assertNoMoney(h, baseline);
});

test('lost confirmation response never fabricates a success card or retries the financial command', async t => {
  const h = await employeeClickthroughDatabase(t);
  const card = await manualReady(h);
  h.faults.loseConfirmResponse = true;
  let response: Card;
  try { response = await click(card, 'confirm'); }
  catch (error) { assert.match((error as Error).message, /Synthetic lost confirmation response/); }
  assert.doesNotMatch(visible(response), /บันทึกเงินเบิกแล้ว|ที่บันทึกจริง/);
  assert.equal(h.calls.filter(c => c.path === 'rpc/financial_confirm_owner_employee_advance_v1').length, 1);
  assert.deepEqual(await h.moneyCounts(), { paid: 2, investments: 0, expenses: 0 });
  const retry = await click(card, 'confirm');
  assert.match(visible(retry), /765 บาท/);
  assert.deepEqual(await h.moneyCounts(), { paid: 2, investments: 0, expenses: 0 });
});


test('image receipt is inert; deliberate review and the real signed outgoing button capture SQL evidence then open an approved alias card', async t => {
  const h = await employeeClickthroughDatabase(t);
  await bindAlias(h);
  const baseline = await h.moneyCounts();
  const imageMessageId = '900000000000001';
  h.faults.catalogue = true;
  h.document.extraction = {
    document_type: 'transfer_slip', document_kind: 'transfer_evidence', funds_direction: 'unknown',
    payment_document_count: 1, confidence: 0.99, amount_total: 125, document_date_local: S.date,
    reference_number: 'SYNTHETIC-NEW-REVIEW-REF', visible_payment_note: S.alias,
  };
  assert.equal(await handleOwnerExpenseImage({ ...eventInput, messageId: imageMessageId }), null);
  assert.equal(h.calls.length, 0);
  assert.equal(h.document.imageReads, 0);
  assert.equal(h.document.ocrReads, 0);
  const direction = await handleOwnerDocumentIntent({ ...eventInput, text: 'ตรวจสลิป', quotedMessageId: imageMessageId });
  assert.equal(direction?.type, 'flex');
  assert.equal(h.document.uploads.length, 0);
  assert.equal((await h.db.query<any>('select count(*) as n from public.financial_owner_expense_intakes')).rows[0].n, 0);
  const outgoing = collect(direction, 'action').find(a => a.type === 'postback' && a.label === 'จ่ายออก');
  assert.ok(outgoing, 'Actual direction card must contain the outgoing postback');
  assert.deepEqual(decodeOwnerDocumentAction({ data: outgoing.data, targetId: S.targetId, userId: S.userId }),
    { imageMessageId, action: 'outgoing_payment' });
  await assertNoMoney(h, baseline);
  const card = await handleOwnerDocumentIntent({ ...eventInput, messageId: 'synthetic-outgoing-click', data: outgoing.data });
  assert.equal(card?.type, 'flex');
  assert.equal(has(card, 'confirm'), true);
  assert.match(visible(card), /ตัวอย่างเอ ทดสอบ/);
  assert.match(visible(card), /640 บาท/);
  assert.match(visible(card), /765 บาท/);
  assert.equal(h.document.uploads.length, 1);
  assert.equal(h.calls.some(c => c.path === 'owner_projects'), false);
  const intakes = (await h.db.query<any>('select * from public.financial_owner_expense_intakes')).rows;
  assert.equal(intakes.length, 1);
  assert.equal(intakes[0].evidence_message_id, imageMessageId);
  assert.equal(intakes[0].extraction_data.visible_payment_note, S.alias);
  assert.equal(intakes[0].extraction_data.funds_direction, 'outgoing');
  assert.equal(intakes[0].review_data.employee_id, S.employeeId);
  assert.equal(intakes[0].review_data.alias_inference.normalized_alias, S.alias);
  const stage = h.calls.filter(c => c.path === 'rpc/financial_stage_owner_employee_advance_v1').at(-1)!;
  assert.equal(stage.body.p_message_id, 'synthetic-outgoing-click');
  assert.equal(h.calls.filter(c => c.path === 'rpc/financial_capture_owner_slip_review_v1').length, 1);
  await assertNoMoney(h, baseline);
});

test('re-reviewing existing saved evidence uses the actual event identity and opens the same alias draft without OCR or capture', async t => {
  const h = await employeeClickthroughDatabase(t);
  await bindAlias(h);
  const imageMessageId = '900000000000002';
  const original = await h.seedDraft({ note: S.alias, evidenceMessageId: imageMessageId });
  const baseline = await h.moneyCounts();
  const card = await handleOwnerDocumentIntent({ ...eventInput, messageId: 'synthetic-rereview-message',
    text: 'ตรวจสลิป', quotedMessageId: imageMessageId });
  assert.equal(card?.type, 'flex');
  assert.equal(has(card, 'confirm'), true);
  assert.match(visible(card), /ตัวอย่างเอ ทดสอบ/);
  const after = await h.getIntake();
  assert.deepEqual(evidenceSnapshot(after), evidenceSnapshot(original));
  assert.equal(after.review_revision, 3);
  assert.equal(after.review_message_id, 'synthetic-rereview-message');
  assert.equal(h.document.imageReads, 0);
  assert.equal(h.document.uploads.length, 0);
  assert.equal(h.calls.some(c => c.path === 'rpc/financial_capture_owner_slip_review_v1'), false);
  await assertNoMoney(h, baseline);
});


test('multiple drafts render only an intake chooser and convert only the draft explicitly clicked', async t => {
  const h = await employeeClickthroughDatabase(t);
  await bindAlias(h);
  const first = await h.seedDraft({ note: S.alias });
  const second = await h.seedDraft({ id: '81000000-0000-4000-8000-000000000002', note: S.alias });
  const baseline = await h.moneyCounts();
  const chooser = await ownerSlipReplyCard({ ...eventInput,
    text: 'มีหลายสลิปครับ กรุณาระบุรหัสรายการเดียว: #510000 / #810000' });
  assert.equal(chooser.type, 'flex');
  assert.equal((chooser.contents as any).type, 'carousel');
  assert.equal(buttons(chooser).filter(b => b.decoded?.action === 'show_review').length, 2);
  assert.equal(h.calls.some(c => c.path === 'rpc/financial_stage_owner_employee_advance_v1'), false);
  assert.equal((await h.getIntake(first.id)).review_revision, 2);
  assert.equal((await h.getIntake(second.id)).review_revision, 2);
  const choice = buttons(chooser).find(b => b.decoded?.action === 'show_review' && b.decoded.id === second.id)!;
  const card = await handleOwnerSlipPostback({ ...eventInput, messageId: 'synthetic-select-one-intake', data: choice.data });
  assert.equal(has(card, 'confirm'), true);
  assert.equal((await h.getIntake(first.id)).review_revision, 2);
  assert.equal((await h.getIntake(second.id)).review_revision, 3);
  assert.deepEqual(evidenceSnapshot(await h.getIntake(second.id)), evidenceSnapshot(second));
  await assertNoMoney(h, baseline);
});

test('explicit employee change clears inferred salary; stale employee and confirm buttons cannot overwrite the new review', async t => {
  const h = await employeeClickthroughDatabase(t);
  await bindAlias(h);
  const first = await review(await h.seedDraft({ note: S.alias }));
  const baseline = await h.moneyCounts();
  const chooser = await click(first, 'show_employee');
  const second = await click(chooser, 'employee', S.secondEmployeeId);
  const current = await h.getIntake();
  assert.equal(current.review_data.employee_id, S.secondEmployeeId);
  assert.equal(current.review_data.event_type, 'unknown');
  assert.equal(current.review_data.alias_inference ?? null, null);
  assert.equal(has(second, 'salary'), true);
  for (const [card, action, value] of [[chooser, 'employee', S.employeeId], [first, 'confirm', undefined]] as const) {
    const latest = await click(card, action, value);
    assert.equal(has(latest, 'confirm'), false);
    assert.match(visible(latest), /ตัวอย่างบี ทดสอบ/);
    assert.equal((await h.getIntake()).review_revision, current.review_revision);
    assert.equal((await h.getIntake()).review_data.employee_id, S.secondEmployeeId);
  }
  await assertNoMoney(h, baseline);
});

test('unsafe purpose cannot be approved as an alias or routed into inferred salary', async t => {
  const h = await employeeClickthroughDatabase(t);
  const baseline = await h.moneyCounts();
  const notes = ['ตัวอย่างเอเบิกไปซื้อของ', 'ตัวอย่างเอเบิกค่าน้ำ', 'ตัวอย่างเอเบิกจ่ายคนงาน',
    'ตัวอย่างเอไม่ได้เบิกเงินเดือน', 'พรุ่งนี้ตัวอย่างเอเบิก', 'ตัวอย่างเอเบิกได้ไหม'];
  for (const [index, note] of notes.entries()) {
    await assert.rejects(() => bindAlias(h, S.employeeId, note), /financial_owner_employee_alias_approval_check/);
    const id = '91000000-0000-4000-8000-' + String(index + 1).padStart(12, '0');
    await h.seedDraft({ id, note });
    const result = await openOwnerEmployeeAdvanceReview({ ...eventInput, messageId: 'synthetic-exclusion-' + index,
      intakeId: id, revision: 2, entry: 'saved_note' });
    assert.equal(result, null, note);
    assert.equal((await h.getIntake(id)).review_revision, 2, note);
  }
  await assertNoMoney(h, baseline);
});

test('same nickname stays an explicit stable-ID employee choice followed by a separate salary choice', async t => {
  const h = await employeeClickthroughDatabase(t);
  await h.db.query(`update tamma_chart_os.employees set nickname='ตัวอย่างซ้ำ'`);
  const baseline = await h.moneyCounts();
  const card = await review(await h.seedDraft({ note: 'ตัวอย่างซ้ำเบิก' }));
  const candidates = buttons(card).filter(b => b.decoded?.action === 'employee');
  assert.deepEqual(new Set(candidates.map(b => b.decoded.value)), new Set([S.employeeId, S.secondEmployeeId]));
  assert.equal((await h.getIntake()).review_data.employee_id, null);
  assert.equal(has(card, 'confirm'), false);
  const selected = await click(card, 'employee', S.secondEmployeeId);
  assert.equal(has(selected, 'salary'), true);
  assert.equal((await h.getIntake()).review_data.event_type, 'unknown');
  assert.equal((await h.getIntake()).review_data.employee_id, S.secondEmployeeId);
  await assertNoMoney(h, baseline);
});

test('a safe whole-note alias without staff keywords routes only after private approval', async t => {
  const h = await employeeClickthroughDatabase(t);
  const note = 'ตัวอย่างเอ';
  const row = await h.seedDraft({ note });
  const baseline = await h.moneyCounts();
  const input = { ...eventInput, intakeId: row.id, revision: 2, entry: 'saved_note' as const };
  assert.equal(await openOwnerEmployeeAdvanceReview(input), null);
  assert.equal((await h.getIntake()).review_revision, 2);
  await bindAlias(h, S.employeeId, note);
  h.faults.catalogue = true;
  const card = await review(row);
  assert.equal(has(card, 'confirm'), true);
  assert.equal((await h.getIntake()).review_data.alias_inference.normalized_alias, note);
  assert.equal(h.calls.some(c => c.path === 'owner_projects'), false);
  await assertNoMoney(h, baseline);
});

test('newly reviewed image with an approved non-keyword alias reaches the card even while project catalogue is unavailable', async t => {
  const h = await employeeClickthroughDatabase(t);
  const note = 'ตัวอย่างเอ';
  await bindAlias(h, S.employeeId, note);
  const baseline = await h.moneyCounts();
  h.faults.catalogue = true;
  h.document.extraction = {
    document_type: 'transfer_slip', document_kind: 'transfer_evidence', funds_direction: 'outgoing',
    payment_document_count: 1, confidence: 0.99, amount_total: 125, document_date_local: S.date,
    reference_number: 'SYNTHETIC-NONKEYWORD-REF', visible_payment_note: note,
  };
  const card = await handleOwnerDocumentIntent({ ...eventInput, messageId: 'synthetic-plain-alias-review',
    text: 'ตรวจสลิป', quotedMessageId: '900000000000003' });
  assert.equal(card?.type, 'flex');
  assert.equal(has(card, 'confirm'), true);
  assert.match(visible(card), /765 บาท/);
  assert.equal(h.calls.some(c => c.path === 'owner_projects'), false);
  assert.equal(h.calls.filter(c => c.path === 'rpc/financial_capture_owner_slip_review_v1').length, 1);
  await assertNoMoney(h, baseline);
});

test('a real ready card rejects another actor, another group, multiple approvers and missing event identity before any confirmation RPC', async t => {
  const h = await employeeClickthroughDatabase(t);
  const card = await manualReady(h);
  const before = await h.getIntake();
  const baseline = await h.moneyCounts();
  for (const changes of [
    { userId: 'synthetic-other-participant' },
    { targetId: 'synthetic-wrong-group' },
    { messageId: null },
  ]) {
    const result = await click(card, 'confirm', undefined, changes);
    assert.doesNotMatch(visible(result), /ตัวอย่างเอ ทดสอบ|640 บาท|765 บาท|ที่บันทึกจริง/);
    assert.deepEqual(await h.getIntake(), before);
  }
  process.env.OWNER_FINANCE_LINE_USER_HASHES = h.actorHash + ',' + piiHash('synthetic-second-owner');
  const denied = await click(card, 'confirm');
  assert.doesNotMatch(visible(denied), /ตัวอย่างเอ ทดสอบ|765 บาท/);
  process.env.OWNER_FINANCE_LINE_USER_HASHES = h.actorHash;
  process.env.THONGTHAI_OWNER_SLIP_RESUME_AFTER = new Date(S.timestamp + 1).toISOString();
  const paused = await click(card, 'confirm');
  assert.match(visible(paused), /พักรับสลิป/);
  assert.deepEqual(await h.getIntake(), before);
  await assertNoMoney(h, baseline);
});


test('manual, saved-alias and text conversion preserve conflicting reviewed amount or date and require correction before staging', async t => {
  const h = await employeeClickthroughDatabase(t);
  await bindAlias(h);
  const baseline = await h.moneyCounts();
  let index = 0;
  for (const route of ['manual', 'alias', 'text']) {
    for (const conflict of [{ amount: 126 }, { occurred_on: '2026-10-08' }]) {
      const id = String(++index).repeat(8) + '-0000-4000-8000-000000000010';
      const original = await h.seedDraft({ id, note: route === 'manual' ? 'รายการตัวอย่างจาก OCR' : S.alias, proposal: conflict });
      let response: Card;
      if (route === 'manual') {
        const current = await handleOwnerSlipPostback({ ...eventInput, messageId: 'synthetic-conflict-view-' + index,
          data: encodeOwnerSlipAction({ id, revision: 2, action: 'show_review' }) });
        response = await click(current, 'employee_advance');
      } else if (route === 'alias') {
        response = await review(original);
      } else {
        response = await handleOwnerEmployeeAdvanceText({ ...eventInput, messageId: 'synthetic-conflict-text-' + index,
          text: '#' + id.replace(/-/g, '').slice(0, 6) + ' ตัวอย่างเอเบิกเงินเดือน' });
      }
      assert.equal(has(response, 'confirm'), false, route);
      const text = visible(response);
      if ('amount' in conflict) { assert.match(text, /125/); assert.match(text, /126/); }
      else { assert.ok(text.includes(S.date)); assert.ok(text.includes('2026-10-08')); }
      assert.deepEqual(await h.getIntake(id), original, route);
    }
  }
  assert.equal(h.calls.some(c => c.path === 'rpc/financial_stage_owner_employee_advance_v1'), false);
  await assertNoMoney(h, baseline);
});

test('duplicate approved non-keyword aliases open an ambiguous employee chooser directly for saved and fresh review', async t => {
  const h = await employeeClickthroughDatabase(t);
  const note = 'ตัวอย่างเอ';
  await bindAlias(h, S.employeeId, note);
  await bindAlias(h, S.secondEmployeeId, note);
  const baseline = await h.moneyCounts();
  h.faults.catalogue = true;
  const existing = await h.seedDraft({ note });
  const savedCard = await review(existing);
  h.document.extraction = {
    document_type: 'transfer_slip', document_kind: 'transfer_evidence', funds_direction: 'outgoing',
    payment_document_count: 1, confidence: 0.99, amount_total: 125, document_date_local: S.date,
    reference_number: 'SYNTHETIC-AMBIGUOUS-NONKEYWORD-REF', visible_payment_note: note,
  };
  const freshCard = await handleOwnerDocumentIntent({ ...eventInput, messageId: 'synthetic-ambiguous-alias-review',
    text: 'ตรวจสลิป', quotedMessageId: '900000000000004' });
  for (const card of [savedCard, freshCard]) {
    assert.equal(card?.type, 'flex');
    const candidates = buttons(card).filter(b => b.decoded?.action === 'employee');
    assert.deepEqual(new Set(candidates.map(b => b.decoded.value)), new Set([S.employeeId, S.secondEmployeeId]));
    assert.equal(has(card, 'confirm'), false);
    assert.equal(buttons(card).some(b => b.data.startsWith('owner-slip:')), false);
    const row = await h.getIntake(candidates[0].decoded.id);
    assert.equal(row.review_data.employee_id, null);
    assert.equal(row.review_data.event_type, 'unknown');
    assert.equal(row.review_data.alias_inference ?? null, null);
  }
  assert.equal(h.calls.some(c => c.path === 'owner_projects'), false);
  assert.deepEqual(evidenceSnapshot(await h.getIntake(existing.id)), evidenceSnapshot(existing));
  assert.equal(h.calls.filter(c => c.path === 'rpc/financial_capture_owner_slip_review_v1').length, 1);
  await assertNoMoney(h, baseline);
});
