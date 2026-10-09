import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildInvestmentSnapshot,
  buildSalesSnapshot,
  classifyOwnerBusinessQuestion,
  handleOwnerBusinessQuestion,
  matchOwnerProjectQuery,
  renderOwnerProjectSpend,
  renderInvestmentSnapshot,
  renderSalesSnapshot,
} from '../netlify/functions/_owner-business-intelligence';

test('owner questions understand natural investment and sales wording without stealing write commands', () => {
  const investment = classifyOwnerBusinessQuestion('ก่อสร้างครัวลงทุนไปเท่าไหร่แล้ว');
  assert.equal(investment?.investment, true);
  assert.deepEqual(investment?.investmentTopics, ['construction', 'kitchen']);

  const overview = classifyOwnerBusinessQuestion('ลงทุนอะไรไปบ้าง สรุปให้หน่อย');
  assert.equal(overview?.investment, true);
  assert.deepEqual(overview?.investmentTopics, []);

  const today = classifyOwnerBusinessQuestion('วันนี้ยอดขายเป็นไง');
  assert.equal(today?.salesPeriod, 'today');
  assert.equal(today?.businessUnit, null);

  const cafe = classifyOwnerBusinessQuestion('วันนี้ Inthanin ขายได้เท่าไหร่');
  assert.equal(cafe?.salesPeriod, 'today');
  assert.equal(cafe?.businessUnit, 'inthanin');

  const month = classifyOwnerBusinessQuestion('ยอดขายเดือนนี้ทั้งหมดเท่าไหร่');
  assert.equal(month?.salesPeriod, 'month');

  assert.equal(
    classifyOwnerBusinessQuestion('ลงทุนเงินสด 5,000 ซื้อชั้นวาง ตำมา-ชาติ'),
    null,
    'typed investment writes must continue to the intake handler',
  );
});

test('Owner asks project spend by a unique short project name and only linked rows are included', () => {
  const intent = classifyOwnerBusinessQuestion('โครงการไม้ยอดจ่ายเท่าไหร่');
  assert.equal(intent?.investment, true);
  assert.equal(intent?.projectNameQuery, 'ไม้');

  const projects = [
    { id: 'wood-project', name: 'เฉลียงไม้', status: 'active', budget_amount: 10_000 },
    { id: 'cancelled-wood', name: 'โรงไม้เก่า', status: 'cancelled', budget_amount: 0 },
  ];
  const match = matchOwnerProjectQuery(intent!.projectNameQuery!, projects);
  assert.equal(match.kind, 'matched');
  if (match.kind !== 'matched') return;

  const snapshot = buildInvestmentSnapshot({
    manual: [],
    slips: [
      { id: 'slip-wood', occurred_on: '2026-10-06', purpose_raw: 'ค่าแปรรูปไม้', expense_category: 'construction', amount: 1_000, status: 'needs_review', owner_project_id: 'wood-project' },
      { id: 'slip-other', occurred_on: '2026-10-06', purpose_raw: 'ค่าปรับปรุง', expense_category: 'construction', amount: 9_000, status: 'categorized', owner_project_id: 'other-project' },
    ],
    legacy: [{ source_id: 'legacy-kitchen', occurred_on: '2026-09-26', title: 'ก่อสร้างครัว', amount: 100_000, budget_amount: 300_000, status: 'ชำระแล้ว' }],
    adjustments: [],
  });
  const answer = renderOwnerProjectSpend(match.project, snapshot);
  assert.match(answer, /โครงการ เฉลียงไม้/u);
  assert.match(answer, /ยอดจ่ายแล้ว: 1,000 บาท/u);
  assert.match(answer, /งบโครงการ: 10,000 บาท · เหลือตามงบ: 9,000 บาท/u);
  assert.doesNotMatch(answer, /ค่าปรับปรุง/u);
  assert.doesNotMatch(answer, /100,000/u);
  assert.match(answer, /รอตรวจหมวด\/กิจการ/u);
});

test('short project query asks for the full name when more than one active project matches', () => {
  assert.equal(classifyOwnerBusinessQuestion('โครงการไม้จ่ายแล้วเท่าไหร่')?.projectNameQuery, 'ไม้');
  const match = matchOwnerProjectQuery('ไม้', [
    { id: 'porch', name: 'เฉลียงไม้', status: 'active' },
    { id: 'yard', name: 'ลานไม้', status: 'active' },
  ]);
  assert.equal(match.kind, 'ambiguous');
});

test('Owner LINE project spend question reads the linked Production-shaped expense row', async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'https://supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
  const projectId = '11e56d02-3bf8-4fe4-be9b-64254d1e0249';
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname.split('/').at(-1);
    const rows: Record<string, unknown[]> = {
      ops_notification_channels: [{ id: 'owner-channel', team_code: 'owner_general', target_type: 'group', target_id_enc: 'ciphertext', target_id_hash: 'hash', display_name: 'Owner', enabled: true }],
      financial_investment_entries: [],
      financial_owner_expense_intakes: [{
        id: 'a2a6412b-f08f-424a-be1f-950151f37110', occurred_on: '2026-10-06', business_unit_code: 'other',
        purpose_raw: 'จ่ายค่าแปรรูปไม้ ของโครงการเฉลียงไม้', expense_category: 'construction', amount: '1000.00',
        vendor_label: null, status: 'needs_review', created_at: '2026-10-06T01:30:44Z', owner_project_id: projectId,
      }],
      financial_investment_legacy_v1: [],
      financial_investment_legacy_adjustment_audit_events: [],
      owner_projects: [{ id: projectId, name: 'เฉลียงไม้', status: 'active', budget_amount: null }],
    };
    return new Response(JSON.stringify(rows[path ?? ''] ?? []), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  try {
    const reply = await handleOwnerBusinessQuestion({ targetId: 'Cowner-project-spend-test', text: 'โครงการไม้ยอดจ่ายเท่าไหร่' });
    assert.match(reply ?? '', /โครงการ เฉลียงไม้/u);
    assert.match(reply ?? '', /ยอดจ่ายแล้ว: 1,000 บาท/u);
    assert.match(reply ?? '', /จ่ายค่าแปรรูปไม้ ของโครงการเฉลียงไม้ · 1,000 บาท · รอตรวจหมวด\/กิจการ/u);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  }
});

test('canonical investment answer keeps kitchen actual at 100,000 and treats the 50,000 slip as evidence', () => {
  const snapshot = buildInvestmentSnapshot({
    manual: [],
    legacy: [{
      source_id: '0f740ffe-4683-44fe-ac3e-a881d5e4e9dc',
      occurred_on: '2026-09-26',
      business_unit_code: 'tamma_restaurant',
      title: 'ก่อสร้างครัว',
      category: 'ก่อสร้าง',
      amount: '100000.00',
      budget_amount: '300000.00',
      payment_method: 'โอน',
      status: 'ชำระแล้ว',
      created_at: '2026-09-26T11:12:50.530775Z',
    }],
    slips: [{
      id: 'f0d32c09-0228-438e-9d9e-1bf80cf7e0d4',
      occurred_on: '2026-10-03',
      business_unit_code: 'tamma_restaurant',
      purpose_raw: 'ค่าก่อสร้างงวดสอง ของ ตำมา-ชาติ',
      expense_category: 'construction',
      amount: '50000.00',
      status: 'categorized',
      created_at: '2026-10-05T07:59:11.783061Z',
    }],
    adjustments: [{
      legacy_investment_id: '0f740ffe-4683-44fe-ac3e-a881d5e4e9dc',
      source: 'owner_instruction',
      previous_actual_amount: '50000.00',
      new_actual_amount: '100000.00',
      created_at: '2026-10-05T08:28:29.650221Z',
    }],
  });

  assert.equal(snapshot.spent, 100_000);
  assert.equal(snapshot.budget, 300_000);
  assert.equal(snapshot.remaining, 200_000);
  assert.equal(snapshot.counted.length, 1);
  assert.equal(snapshot.evidenceOnly.length, 1);
  assert.equal(snapshot.evidenceOnly[0]?.amount, 50_000);
  assert.equal(snapshot.evidenceOnly[0]?.counted_in_total, false);

  const intent = classifyOwnerBusinessQuestion('ก่อสร้างครัวลงทุนไปเท่าไหร่แล้ว');
  assert.ok(intent);
  const answer = renderInvestmentSnapshot(snapshot, intent);
  assert.match(answer, /ใช้จริงรวม: 100,000 บาท/u);
  assert.match(answer, /งบที่บันทึก: 300,000 บาท · คงเหลือตามงบ: 200,000 บาท/u);
  assert.match(answer, /หลักฐานประกอบ 1 รายการ รวม 50,000 บาท — ไม่บวกยอดซ้ำ/u);
  assert.doesNotMatch(answer, /ใช้จริงรวม: 150,000 บาท/u);
});

test('today sales answer covers all five businesses and labels draft or missing source records honestly', () => {
  const timestamp = Date.parse('2026-10-05T10:09:00Z');
  const businesses = [
    { code: 'tamma-food', name: 'ตำมา-ชาติ', unit_type: 'restaurant', sort_order: 10 },
    { code: 'tamma-stay', name: 'ทำมา-ชาติ เฮือนสเตย์', unit_type: 'stay', sort_order: 20 },
    { code: 'tamma-adventure', name: 'ทำมา-ชาติ ผจญภัย', unit_type: 'activity', sort_order: 30 },
    { code: 'inthanin', name: 'Inthanin Café', unit_type: 'cafe', sort_order: 40 },
    { code: 'otop', name: 'OTOP / สินค้าชุมชน', unit_type: 'otop', sort_order: 50 },
  ];
  const snapshot = buildSalesSnapshot({
    period: 'today',
    timestamp,
    businesses,
    cafe: [{ local_date: '2026-10-05', net_sales: 0, status: 'draft' }],
    restaurant: [],
    payments: [],
  });

  assert.equal(snapshot.total, 0);
  assert.equal(snapshot.complete, true);
  assert.equal(snapshot.businesses.length, 5);
  const answer = renderSalesSnapshot(snapshot);
  assert.match(answer, /ยอดที่เข้าระบบแล้ว: 0 บาท/u);
  assert.match(answer, /Inthanin Café · 0 บาท \(1 รายการ\) · ยอดปิดร้านยังเป็นฉบับร่าง\/ยังไม่ยืนยัน/u);
  assert.match(answer, /ตำมา-ชาติ — ยังไม่มีรายการขาย/u);
  assert.match(answer, /เฮือนสเตย์ — ยังไม่มียอดชำระที่ตรวจแล้ว/u);
  assert.match(answer, /ผจญภัย — ยังไม่มียอดชำระที่ตรวจแล้ว/u);
  assert.match(answer, /OTOP \/ สินค้าชุมชน — ยังไม่มียอดชำระที่ตรวจแล้ว/u);
  assert.match(answer, /ไม่ใช่ประมาณการ/u);
});

test('sales source contract matches the executive dashboard and remains owner-group only', () => {
  const source = readFileSync('netlify/functions/_owner-business-intelligence.ts', 'utf8');
  assert.match(source, /owner_projects\?status=neq\.cancelled&select=id,name,status,budget_amount/u);
  assert.match(source, /owner_project_id/);
  assert.match(source, /renderOwnerProjectSpend/);
  assert.match(source, /financial_daily_close_owner_v2\?business_unit_code=eq\.inthanin/);
  assert.match(source, /environment=eq\.live/);
  assert.match(source, /status=neq\.void/);
  assert.match(source, /sales\?sale_date=gte\./);
  assert.match(source, /voided_at=is\.null/);
  assert.match(source, /payment_requests\?environment=eq\.live&status=eq\.verified/);
  assert.match(source, /team_code=in\.\(stay,activity,otop\)/);
  assert.match(source, /'Accept-Profile': schema/);
  assert.match(source, /team !== 'owner_general'/);
  assert.doesNotMatch(source, /bookings\?/u, 'booking value must never be reported as realized sales');
});

test('owner read questions route before expense follow-up and cafe Daily Close parsing', () => {
  const webhook = readFileSync('netlify/functions/line-webhook.ts', 'utf8');
  const payroll = webhook.lastIndexOf('handleOwnerPayrollText({');
  const intelligence = webhook.lastIndexOf('handleOwnerBusinessQuestion({');
  const expense = webhook.lastIndexOf('handleOwnerExpenseText({');
  const dailyClose = webhook.lastIndexOf('handleCafeTestDailyCloseText({');
  const project = webhook.lastIndexOf('handleOwnerProjectText({');
  assert.ok(payroll >= 0 && expense > payroll && project > expense && intelligence > project && dailyClose > intelligence);

  const intake = readFileSync('netlify/functions/_owner-expense-intake.ts', 'utf8');
  assert.doesNotMatch(intake, /financial_owner_expense_summary_v1/);
  assert.doesNotMatch(intake, /summaryCommand/);
});
