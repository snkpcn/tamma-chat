import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildInvestmentSnapshot, classifyOwnerBusinessQuestion, handleOwnerBusinessQuestion,
  renderInvestmentOverview, renderInvestmentSnapshot,
} from '../netlify/functions/_owner-business-intelligence';
import { handleOwnerProjectQuery, handleOwnerProjectText } from '../netlify/functions/_owner-project-os';

const exactPrompt = 'ทองไทย สรุปภาพรวมการลงทุนทั้งหมดให้หน่อย แยกตามโครงการและส่วนกลาง บอกงบที่ตั้งไว้ จ่ายจริงแล้วเท่าไหร่ ค้างจ่ายเท่าไหร่ และงวดถัดไปครบกำหนดเมื่อไหร่ ใช้เฉพาะข้อมูลที่บันทึกและยืนยันแล้ว รายการรอยืนยันแยกไว้ ส่วนไหนไม่มีข้อมูลให้บอกว่ายังไม่มี อย่าเดายอด';
const empty = { manual: [], slips: [], legacy: [], adjustments: [] };
const confirmed = { source_channel: 'line', currency: 'THB', id: 'paid', occurred_on: '2026-10-10', amount: 1000, status: 'categorized', review_state: 'confirmed', business_unit_code: 'tamma_restaurant', purpose_raw: 'ค่าไม้', owner_project_id: 'p1' };
const project = { id: 'p1', name: 'เฉลียงไม้', status: 'active', budget_amount: 10000, confirmed_at: '2026-10-01T00:00:00Z', business_unit_code: 'tamma_restaurant' };

test('exact request groups projects and shared costs without extracting a fake project or business filter', () => {
  const intent = classifyOwnerBusinessQuestion(exactPrompt)!;
  assert.equal(intent.investment, true);
  assert.equal(intent.groupByProject, true);
  assert.equal(intent.projectNameQuery, null);
  assert.equal(intent.businessUnit, null);
  assert.deepEqual(intent.investmentTopics, []);
  for (const phrase of ['สรุปภาพรวมลงทุนแยกโครงการกับส่วนกลาง', 'สรุปภาพรวมลงทุน แยกส่วนกลางและโครงการ']) {
    assert.equal(classifyOwnerBusinessQuestion(phrase)?.businessUnit, null);
  }
  for (const phrase of ['สรุปการลงทุนทั้งหมด แยกตามโครงการ', 'สรุปลงทุน แบ่งเป็นโครงการและส่วนกลาง', 'ภาพรวมลงทุน รายโครงการและส่วนกลาง']) {
    assert.equal(classifyOwnerBusinessQuestion(phrase)?.projectNameQuery, null);
  }
});

test('grouping does not remove an explicitly requested business or named-project filter', () => {
  assert.equal(classifyOwnerBusinessQuestion('สรุปการลงทุนเฉพาะส่วนกลางทั้งหมด')?.businessUnit, 'shared_infrastructure');
  assert.equal(classifyOwnerBusinessQuestion('สรุปลงทุนร้านอาหาร แยกตามโครงการและส่วนกลาง')?.businessUnit, 'tamma_restaurant');
  assert.equal(classifyOwnerBusinessQuestion('โครงการเฉลียงไม้ยอดจ่ายเท่าไหร่')?.projectNameQuery, 'เฉลียงไม้');
  assert.equal(classifyOwnerBusinessQuestion('ลงทุนเงินสด 5,000 ซื้อชั้นวาง ตำมา-ชาติ'), null);
});

test('only explicit review confirmation or known owner/backoffice legacy classification contributes', () => {
  const snapshot = buildInvestmentSnapshot({ ...empty, slips: [
    confirmed,
    { ...confirmed, id: 'old-owner', review_state: null, classification_source: 'owner', amount: 200 },
    { ...confirmed, id: 'old-office', review_state: null, classification_source: 'backoffice', amount: 300 },
    { ...confirmed, id: 'rule-only', review_state: null, classification_source: 'rule', amount: 400 },
    { ...confirmed, id: 'missing-proof', review_state: null, amount: 500 },
    { ...confirmed, id: 'review', status: 'needs_review', amount: 600 },
    { ...confirmed, id: 'draft', review_state: 'draft', amount: 700 },
    { ...confirmed, id: 'unknown', status: 'unexpected_status', amount: 800 },
    { ...confirmed, id: 'cancelled', status: 'cancelled', amount: 900 },
    { ...confirmed, id: 'cancelled-review', review_state: 'cancelled', amount: 900 },
  ] });
  assert.equal(snapshot.spent, 1500);
  assert.equal(snapshot.pending.length, 5);
  assert.equal(snapshot.evidenceOnly.length, 0);
  assert.equal(snapshot.items.length, 8);
});

test('missing and invalid amounts remain pending and never turn into zero paid', () => {
  for (const amount of [null, undefined, '', 'NaN', -1, Infinity]) {
    const snapshot = buildInvestmentSnapshot({ ...empty, slips: [{ ...confirmed, amount }] });
    const answer = renderInvestmentSnapshot(snapshot, classifyOwnerBusinessQuestion('สรุปลงทุน')!);
    assert.equal(snapshot.counted.length, 0);
    assert.equal(snapshot.pending.length, 1);
    assert.match(answer, /ยอดจ่ายที่ยืนยันแล้ว: ยังไม่มีข้อมูล/u);
    assert.match(answer, /ยังไม่มียอดที่ยืนยัน/u);
    assert.doesNotMatch(answer, /0 บาท/u);
  }
});

test('recorded ledger and explicitly paid legacy rows count; unknown/unpaid/cancelled rows do not', () => {
  const snapshot = buildInvestmentSnapshot({ ...empty,
    manual: [{ id: 'm1', status: 'recorded', amount: 100, business_unit_code: 'inthanin' }, { id: 'm2', status: 'cancelled', amount: 999 }],
    legacy: [
      { source_id: 'l1', status: 'ชำระแล้ว', amount: 200 },
      { source_id: 'l2', status: 'รอชำระ', amount: 300 },
      { source_id: 'l3', status: '', amount: 400 },
      { source_id: 'l4', status: 'ยกเลิก', amount: 999 },
    ],
  });
  assert.equal(snapshot.spent, 300);
  assert.equal(snapshot.pending.length, 2);
});

test('exact ledger/slip source-message identity counts one financial event and preserves provenance', () => {
  const snapshot = buildInvestmentSnapshot({ ...empty,
    manual: [{ id: 'ledger1', source_channel: 'line', source_message_id: 'message1', occurred_on: '2026-10-10', status: 'recorded', amount: 1000, owner_project_id: 'p1', business_unit_code: 'tamma_restaurant', title: 'ค่าไม้จากบัญชี' }],
    slips: [{ ...confirmed, evidence_message_id: 'message1' }, { ...confirmed, evidence_message_id: 'message1' }],
  });
  assert.equal(snapshot.spent, 1000);
  assert.equal(snapshot.items.length, 2, 'same intake id is not repeated');
  assert.equal(snapshot.evidenceOnly.length, 1);
  assert.equal(snapshot.pending.length, 0);
  assert.match(snapshot.evidenceOnly[0]!.reconciliation_note!, /ข้อความต้นทางเดียว/u);
  assert.equal(snapshot.counted[0]!.source_kind, 'manual');
  assert.equal(snapshot.evidenceOnly[0]!.source_kind, 'slip');
});

test('same bank reference within an owner group is evidence once, but amount similarity alone is not identity', () => {
  const base = { ...confirmed, owner_group_hash: 'group1', reference_number: ' REF 1 ' };
  const snapshot = buildInvestmentSnapshot({ ...empty, slips: [
    base,
    { ...base, id: 'duplicate', reference_number: 'ref1' },
    { ...base, id: 'different-ref', reference_number: 'ref2' },
    { ...base, id: 'different-group', owner_group_hash: 'group2' },
  ] });
  assert.equal(snapshot.spent, 3000);
  assert.equal(snapshot.evidenceOnly.length, 1);
});

test('same bank reference with conflicting amounts is excluded until reconciled', () => {
  const snapshot = buildInvestmentSnapshot({ ...empty, slips: [
    { ...confirmed, owner_group_hash: 'group1', reference_number: 'ref1' },
    { ...confirmed, id: 'conflict', owner_group_hash: 'group1', reference_number: 'ref1', amount: 2000 },
  ] });
  assert.equal(snapshot.spent, 0);
  assert.equal(snapshot.counted.length, 0);
  assert.equal(snapshot.pending.length, 2);
  assert.ok(snapshot.pending.every(item => item.reconciliation_note?.includes('ต้องตรวจสอบก่อนรวมยอด')));
});

test('unresolved legacy aggregate overlap never becomes an additive grand total', () => {
  const snapshot = buildInvestmentSnapshot({ ...empty,
    legacy: [{ source_id: 'legacy-kitchen', occurred_on: '2026-09-26', title: 'ก่อสร้างครัว', category: 'construction', business_unit_code: 'tamma_restaurant', amount: 100000, status: 'ชำระแล้ว' }],
    slips: [
      { ...confirmed, id: 's1', amount: 50000, purpose_raw: 'ก่อสร้างครัว งวดสอง', owner_group_hash: 'group1', reference_number: 'ref1' },
      { ...confirmed, id: 's2', amount: 50000, purpose_raw: 'ก่อสร้างครัว งวดสอง', owner_group_hash: 'group1', reference_number: 'ref1' },
    ],
  });
  assert.equal(snapshot.spent, 100000);
  assert.equal(snapshot.evidenceOnly.length, 1);
  assert.equal(snapshot.pending.length, 1);
  const answer = renderInvestmentOverview(snapshot, classifyOwnerBusinessQuestion(exactPrompt)!, [project], []);
  assert.match(answer, /ยังยืนยันยอดลงทุนทั้งหมดไม่ได้/u);
  assert.match(answer, /ต้องกระทบยอดก่อนรวมเพิ่ม/u);
  assert.doesNotMatch(answer, /ยอดจ่ายที่ยืนยันแล้ว: (150,000|200,000)/u);
});

test('grouped paid totals partition projects, shared costs and unallocated business costs without guessing links', () => {
  const snapshot = buildInvestmentSnapshot({ ...empty, slips: [
    confirmed,
    { ...confirmed, id: 'shared', owner_project_id: null, business_unit_code: 'shared_infrastructure', amount: 200, purpose_raw: 'ส่วนกลาง' },
    { ...confirmed, id: 'cafe', owner_project_id: null, business_unit_code: 'inthanin', amount: 300, purpose_raw: 'เครื่องร้านกาแฟ' },
    { ...confirmed, id: 'pending', status: 'needs_review', amount: 9000 },
  ] });
  const answer = renderInvestmentOverview(snapshot, classifyOwnerBusinessQuestion(exactPrompt)!, [project], [
    { id: 'i1', project_id: 'p1', title: 'งวดสอง', amount: 3000, paid_amount: 1000, due_on: '2026-10-20', status: 'due' },
    { id: 'paid', project_id: 'p1', title: 'งวดแรก', amount: 1000, paid_amount: 1000, due_on: '2026-10-01', status: 'paid' },
    { id: 'cancelled', project_id: 'p1', title: 'ยกเลิก', amount: 9999, paid_amount: 0, due_on: '2026-10-02', status: 'cancelled' },
  ]);
  assert.match(answer, /ยอดจ่ายที่ยืนยันแล้ว: 1,500 บาท/u);
  assert.match(answer, /โครงการ เฉลียงไม้/u);
  assert.match(answer, /งบโครงการที่ยืนยัน: 10,000 บาท/u);
  assert.match(answer, /ยอดคงค้างตามงวดที่บันทึก: 2,000 บาท/u);
  assert.match(answer, /งวดสอง · 2026-10-20/u);
  assert.match(answer, /ส่วนกลาง · ยังไม่ผูกโครงการ/u);
  assert.match(answer, /Inthanin · ยังไม่ผูกโครงการ/u);
  assert.match(answer, /รอยืนยัน\/ตรวจข้อมูล 1 รายการ/u);
  assert.doesNotMatch(answer, /ยอดคงค้างตามงวดที่บันทึก: 9,000 บาท/u, 'budget minus spending is not payable');
});

test('missing budgets, missing installments and missing amount/date are not zero or inferred due dates', () => {
  const snapshot = buildInvestmentSnapshot(empty);
  const unknownProject = { ...project, budget_amount: null };
  const answer = renderInvestmentOverview(snapshot, classifyOwnerBusinessQuestion(exactPrompt)!, [unknownProject], [
    { id: 'i1', project_id: 'p1', title: 'ยังไม่ทราบ', amount: null, paid_amount: 0, due_on: null, status: 'planned' },
  ]);
  assert.match(answer, /งบที่ยืนยัน: ยังไม่มีข้อมูล/u);
  assert.match(answer, /จ่ายที่ยืนยันแล้ว: ยังไม่มีข้อมูล/u);
  assert.match(answer, /ยอดคงค้างตามงวด: ยังไม่มีข้อมูลครบ/u);
  assert.match(answer, /กำหนดงวดถัดไป: ยังไม่มีข้อมูล/u);
  assert.doesNotMatch(answer, /0 บาท/u);
  const zeroBudget = renderInvestmentOverview(snapshot, classifyOwnerBusinessQuestion(exactPrompt)!, [{ ...project, budget_amount: 0 }], []);
  assert.match(zeroBudget, /งบโครงการที่ยืนยัน: 0 บาท/u, 'explicit stored zero budget remains distinguishable');
});

async function mockedReads<T>(fixtures: Record<string, unknown[]>, action: (calls: URL[]) => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const calls: URL[] = [];
  process.env.SUPABASE_URL = 'https://investment-fixture.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-fixture-key';
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(init?.method ?? 'GET', 'GET', 'report must be read-only');
    const url = new URL(String(input));
    assert.equal(url.hostname, 'investment-fixture.invalid', 'no real network');
    calls.push(url);
    const name = url.pathname.split('/').at(-1)!;
    if (name === 'ops_notification_channels') return Response.json([{ team_code: 'owner_general', enabled: true }]);
    assert.ok(name in fixtures, 'unexpected read ' + name);
    return Response.json(fixtures[name]);
  }) as typeof fetch;
  try { return await action(calls); }
  finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  }
}

const fixtures = {
  financial_investment_entries: [], financial_owner_expense_intakes: [confirmed],
  financial_investment_legacy_v1: [], financial_investment_legacy_adjustment_audit_events: [],
  owner_projects: [project], owner_project_installments: [],
};

test('exact LINE prompt reaches read-only overview with confirmation/provenance fields selected', async () => {
  await mockedReads(fixtures, async calls => {
    assert.equal(await handleOwnerProjectQuery({ targetId: 'fixture-group', text: exactPrompt }), null);
    assert.equal(await handleOwnerProjectText({ targetId: 'fixture-group', userId: 'fixture-owner', messageId: 'fixture-message', text: exactPrompt }), null);
    const answer = await handleOwnerBusinessQuestion({ targetId: 'fixture-group', text: exactPrompt });
    assert.match(answer!, /ยอดจ่ายที่ยืนยันแล้ว: 1,000 บาท/u);
    assert.match(answer!, /โครงการ เฉลียงไม้/u);
    assert.doesNotMatch(answer!, /ยังไม่พบโครงการชื่อ/u);
    const intake = calls.find(url => url.pathname.endsWith('/financial_owner_expense_intakes'))!;
    assert.match(intake.searchParams.get('select')!, /review_state,classification_source/u);
    assert.match(intake.searchParams.get('select')!, /reference_number,evidence_sha256/u);
    assert.match(intake.searchParams.get('or')!, /review_state.eq.draft/u);
    const installment = calls.find(url => url.pathname.endsWith('/owner_project_installments'))!;
    assert.match(installment.searchParams.get('select')!, /paid_amount/u);
  });
});

test('potential read truncation fails closed rather than presenting a partial grand total', async () => {
  await mockedReads({ ...fixtures, financial_investment_entries: Array.from({ length: 1000 }, (_, i) => ({ id: 'm' + i, status: 'recorded', amount: 100 })) }, async () => {
    const answer = await handleOwnerBusinessQuestion({ targetId: 'fixture-group', text: exactPrompt });
    assert.match(answer!, /ดึงข้อมูล.*ไม่ครบ/u);
    assert.doesNotMatch(answer!, /100,000 บาท/u);
  });
});

test('duplicate evidence with conflicting project/business allocation is pending, never assigned arbitrarily', () => {
  for (const changed of [{ owner_project_id: 'p2' }, { business_unit_code: 'inthanin' }]) {
    const snapshot = buildInvestmentSnapshot({ ...empty, slips: [
      { ...confirmed, owner_group_hash: 'group1', reference_number: 'ref1' },
      { ...confirmed, id: 'conflict', owner_group_hash: 'group1', reference_number: 'ref1', ...changed },
    ] });
    assert.equal(snapshot.counted.length, 0);
    assert.equal(snapshot.pending.length, 2);
  }
});

test('duplicate evidence identity is transitive across bank reference and image hash', () => {
  const snapshot = buildInvestmentSnapshot({ ...empty, slips: [
    { ...confirmed, owner_group_hash: 'group1', reference_number: 'ref1' },
    { ...confirmed, id: 'bridge', owner_group_hash: 'group1', reference_number: 'ref1', evidence_sha256: 'same-image' },
    { ...confirmed, id: 'image', owner_group_hash: 'group1', evidence_sha256: 'same-image' },
  ] });
  assert.equal(snapshot.spent, 1000);
  assert.equal(snapshot.evidenceOnly.length, 2);
});

test('paid status alone cannot turn inconsistent or unknown installment balances into zero outstanding', () => {
  for (const amount of [5000, null]) {
    const answer = renderInvestmentOverview(buildInvestmentSnapshot(empty), classifyOwnerBusinessQuestion(exactPrompt)!, [project], [
      { id: 'i1', project_id: 'p1', title: 'งวดแรก', amount, paid_amount: 1000, due_on: '2026-10-20', status: 'paid' },
    ]);
    assert.match(answer, /ยอดคงค้างตามงวด: ยังไม่มีข้อมูลครบ/u);
    assert.match(answer, /ต้องกระทบยอดก่อนสรุปค้างจ่าย/u);
    assert.doesNotMatch(answer, /คงค้าง.*0 บาท/u);
  }
});

test('same source message with conflicting ledger/slip allocation or amounts stays pending', () => {
  for (const changed of [{ amount: 2000 }, { owner_project_id: 'p2' }]) {
    const snapshot = buildInvestmentSnapshot({ ...empty,
      manual: [{ id: 'm1', source_channel: 'line', source_message_id: 'message1', occurred_on: '2026-10-10', status: 'recorded', amount: 1000, owner_project_id: 'p1', business_unit_code: 'tamma_restaurant' }],
      slips: [{ ...confirmed, evidence_message_id: 'message1', ...changed }],
    });
    assert.equal(snapshot.counted.length, 0);
    assert.equal(snapshot.pending.length, 2);
  }
});

test('different descriptions or dates do not prove a restaurant payment is outside its legacy aggregate', () => {
  const snapshot = buildInvestmentSnapshot({ ...empty,
    legacy: [{ source_id: 'l1', title: 'ครัว', amount: 100000, status: 'ชำระแล้ว', business_unit_code: 'tamma_restaurant', occurred_on: '2020-01-01' }],
    slips: [{ ...confirmed, purpose_raw: 'ก่อสร้างงวดสอง', amount: 50000 }],
  });
  assert.equal(snapshot.spent, 100000);
  assert.equal(snapshot.pending.length, 1);
  assert.match(snapshot.pending[0]!.reconciliation_note!, /ต้องกระทบยอด/u);
});

test('many projects produce a bounded LINE report with explicit omitted-group count', () => {
  const projects = Array.from({ length: 180 }, (_, i) => ({ ...project, id: 'p' + i, name: 'โครงการ ' + i }));
  const answer = renderInvestmentOverview(buildInvestmentSnapshot(empty), classifyOwnerBusinessQuestion(exactPrompt)!, projects, []);
  assert.ok(answer.length < 16000);
  assert.match(answer, /ยังไม่ได้แสดงรายละเอียดอีก 168 กลุ่ม/u);
  assert.match(answer, /ยอดด้านบนรวมทุกกลุ่มที่ผ่านการตรวจแล้ว/u);
  assert.match(answer, /ยอดจ่ายที่ยืนยันแล้ว: ยังไม่มีข้อมูล/u);
});

test('ledger source-message aliases reconcile the entire transitive slip component in either order', () => {
  for (const reverse of [false, true]) {
    const slips = [
      { ...confirmed, id: 'slip-a', owner_group_hash: 'group1', reference_number: 'ref1', evidence_message_id: 'message-a' },
      { ...confirmed, id: 'slip-b', owner_group_hash: 'group1', reference_number: 'ref1', evidence_message_id: 'message-b' },
    ];
    if (reverse) slips.reverse();
    const snapshot = buildInvestmentSnapshot({ ...empty,
      manual: [{ id: 'ledger', occurred_on: '2026-10-10', source_channel: 'line', source_message_id: 'message-b', status: 'recorded', amount: 1000, owner_project_id: 'p1', business_unit_code: 'tamma_restaurant' }],
      slips,
    });
    assert.equal(snapshot.spent, 1000);
    assert.equal(snapshot.counted.length, 1);
    assert.equal(snapshot.counted[0]!.source_kind, 'manual');
    assert.equal(snapshot.evidenceOnly.length, 2);
    assert.equal(snapshot.pending.length, 0);
  }
});

test('any conflicting alias quarantines the entire ledger and slip identity component', () => {
  for (const reverse of [false, true]) {
    const slips = [
      { ...confirmed, id: 'slip-a', owner_group_hash: 'group1', reference_number: 'ref1', evidence_message_id: 'message-a' },
      { ...confirmed, id: 'slip-b', owner_group_hash: 'group1', reference_number: 'ref1', evidence_message_id: 'message-b' },
    ];
    if (reverse) slips.reverse();
    const snapshot = buildInvestmentSnapshot({ ...empty,
      manual: [{ id: 'ledger', occurred_on: '2026-10-10', source_channel: 'line', source_message_id: 'message-b', status: 'recorded', amount: 2000, owner_project_id: 'p1', business_unit_code: 'tamma_restaurant' }],
      slips,
    });
    assert.equal(snapshot.counted.length, 0);
    assert.equal(snapshot.spent, 0);
    assert.equal(snapshot.pending.length, 3);
    assert.equal(snapshot.evidenceOnly.length, 0);
  }
});

test('cross-source date or currency conflicts stay pending just like duplicate slip conflicts', () => {
  for (const changed of [{ occurred_on: '2026-10-11' }, { currency: 'USD' }, { currency: '' }]) {
    const snapshot = buildInvestmentSnapshot({ ...empty,
      manual: [{ id: 'ledger', occurred_on: '2026-10-10', source_channel: 'line', source_message_id: 'message1', status: 'recorded', amount: 1000, owner_project_id: 'p1', business_unit_code: 'tamma_restaurant' }],
      slips: [{ ...confirmed, evidence_message_id: 'message1', ...changed }],
    });
    assert.equal(snapshot.counted.length, 0);
    assert.equal(snapshot.pending.length, 2);
  }
});
