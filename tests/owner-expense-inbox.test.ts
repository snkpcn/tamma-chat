import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  classifyOwnerExpensePurpose,
  handleOwnerExpenseText,
  matchOwnerProjectMention,
} from '../netlify/functions/_owner-expense-intake';
import { piiHash } from '../netlify/functions/_operations-db';

test('owner investment classifier separates businesses and investment categories', () => {
  assert.deepEqual(classifyOwnerExpensePurpose('ซื้อเครื่องชง Inthanin'), {
    businessUnit: 'inthanin',
    expenseClass: 'capital_investment',
    expenseCategory: 'kitchen_equipment',
    expenseSubcategory: 'อุปกรณ์ครัว',
    confidence: 0.91,
  });

  assert.deepEqual(classifyOwnerExpensePurpose('ค่าก่อสร้างเฮือนสเตย์'), {
    businessUnit: 'huenstay',
    expenseClass: 'capital_investment',
    expenseCategory: 'construction',
    expenseSubcategory: 'งานก่อสร้าง/ต่อเติม',
    confidence: 0.91,
  });

  assert.deepEqual(classifyOwnerExpensePurpose('ถมที่ลานจอดส่วนกลาง'), {
    businessUnit: 'shared_infrastructure',
    expenseClass: 'capital_investment',
    expenseCategory: 'land_infrastructure',
    expenseSubcategory: 'ที่ดิน/ส่วนกลาง',
    confidence: 0.91,
  });

  assert.deepEqual(classifyOwnerExpensePurpose('ค่าแปรรูปไม้'), {
    businessUnit: null,
    expenseClass: 'capital_investment',
    expenseCategory: 'construction',
    expenseSubcategory: 'งานไม้/แปรรูปไม้',
    confidence: 0.65,
  });
});

test('owner project matching requires an explicit, unique active project name', () => {
  const projects = [
    { id: 'project-1', name: 'เฉลียงไม้', business_unit_code: null, status: 'active' },
    { id: 'project-2', name: 'เฉลียงไม้', business_unit_code: null, status: 'active' },
    { id: 'project-3', name: 'โครงการเก่า', business_unit_code: null, status: 'cancelled' },
  ];

  assert.deepEqual(
    matchOwnerProjectMention('จ่ายค่าแปรรูปไม้ ของโครงการเฉลียงไม้', projects.slice(0, 1)),
    { kind: 'matched', project: projects[0] },
  );
  assert.deepEqual(matchOwnerProjectMention('ซื้อไม้', projects), { kind: 'not_mentioned' });
  assert.deepEqual(
    matchOwnerProjectMention('ค่าใช้จ่ายโครงการเฉลียงไม้', projects),
    { kind: 'ambiguous' },
  );
  assert.deepEqual(
    matchOwnerProjectMention('ของโครงการเก่า', projects),
    { kind: 'not_found' },
  );
});

test('project-mentioned slip links to the existing project instead of asking business again', async t => {
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'https://supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
  t.after(() => {
    if (oldUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
  });

  const userId = 'U-owner-test';
  const intakeId = 'a2a6412b-f08f-424a-be1f-950151f37110';
  const calls: Array<{ url: string; body?: Record<string, unknown> }> = [];
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = String(input);
    let body: Record<string, unknown> | undefined;
    if (typeof init?.body === 'string') body = JSON.parse(init.body) as Record<string, unknown>;
    calls.push({ url, body });

    if (url.includes('/rest/v1/ops_notification_channels?')) {
      return new Response(JSON.stringify([{ team_code: 'owner_general' }]), { status: 200 });
    }
    if (url.includes('/rest/v1/financial_owner_expense_intakes?')) {
      return new Response(JSON.stringify([{
        id: intakeId,
        source_user_hash: piiHash(userId),
        status: 'awaiting_business',
        amount: 1000,
        occurred_on: '2026-10-06',
        document_type: 'transfer_slip',
        purpose_raw: 'จ่ายค่าแปรรูปไม้ ของโครงการเฉลียงไม้',
        business_unit_code: null,
        expense_class: 'uncategorized',
        expense_category: 'other',
        expense_subcategory: null,
        owner_project_id: null,
        owner_project_task_id: null,
        owner_project_installment_id: null,
      }]), { status: 200 });
    }
    if (url.includes('/rest/v1/owner_projects?')) {
      return new Response(JSON.stringify([{
        id: '11e56d02-3bf8-4fe4-be9b-64254d1e0249',
        name: 'เฉลียงไม้',
        business_unit_code: null,
        status: 'active',
      }]), { status: 200 });
    }
    if (url.includes('/rest/v1/rpc/owner_project_link_financial_v1')) {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (url.includes('/rest/v1/rpc/financial_resolve_owner_expense_intake_v1')) {
      return new Response(JSON.stringify({
        ok: true,
        intake_id: intakeId,
        status: 'needs_review',
        amount: 1000,
        business_unit_code: 'other',
        expense_class: 'capital_investment',
        expense_category: 'construction',
      }), { status: 200 });
    }
    throw new Error('Unexpected mocked fetch: ' + url);
  });

  const reply = await handleOwnerExpenseText({
    targetId: 'C-owner-test',
    userId,
    text: 'จ่ายค่าแปรรูปไม้ ของโครงการเฉลียงไม้',
    messageId: 'M-project-expense-test',
    timestamp: Date.parse('2026-10-06T01:31:00Z'),
  });

  assert.match(reply || '', /ผูกยอดกับโครงการแล้ว/u);
  assert.match(reply || '', /โครงการ: เฉลียงไม้/u);
  assert.doesNotMatch(reply || '', /กิจการ\/ส่วนไหน|ตอบได้ เช่น/u);
  const link = calls.find(call => call.url.includes('/rpc/owner_project_link_financial_v1'));
  assert.equal(link?.body?.p_financial_id, intakeId);
  assert.equal(link?.body?.p_project_id, '11e56d02-3bf8-4fe4-be9b-64254d1e0249');
  assert.ok(calls.some(call => call.url.includes('/rpc/financial_resolve_owner_expense_intake_v1')));
  assert.ok(!calls.some(call => call.url.includes('/rpc/financial_stage_owner_expense_purpose_v1')));
});

test('owner expense inbox stores first and asks both purpose and business before it categorizes', () => {
  const intake = readFileSync('netlify/functions/_owner-expense-intake.ts', 'utf8');
  assert.match(intake, /สลิปนี้จ่ายค่าอะไร และเป็นของกิจการ\/ส่วนไหนครับ/u);
  assert.match(intake, /financial_capture_owner_expense_slip_v1/);
  assert.match(intake, /financial_stage_owner_expense_purpose_v1/);
  assert.match(intake, /financial_resolve_owner_expense_intake_v1/);
  assert.match(intake, /owner_project_link_financial_v1/);
  assert.match(intake, /ผูกยอดกับโครงการแล้วครับ/u);
  assert.match(intake, /financial_mark_owner_expense_not_expense_v1/);
  assert.match(intake, /owner-expense-evidence/);
  assert.match(intake, /x-upsert': 'false'/);
});

test('Owner Group expense routing runs after owner read intelligence and before cafe Daily Close', () => {
  const webhook = readFileSync('netlify/functions/line-webhook.ts', 'utf8');
  const payrollImage = webhook.lastIndexOf('handleOwnerPayrollImage');
  const expenseImage = webhook.lastIndexOf('handleOwnerExpenseImage');
  const cafeImage = webhook.lastIndexOf('handleCafeTestDailyCloseImage');
  const payrollText = webhook.lastIndexOf('handleOwnerPayrollText');
  const intelligenceText = webhook.lastIndexOf('handleOwnerBusinessQuestion');
  const expenseText = webhook.lastIndexOf('handleOwnerExpenseText');
  const dailyCloseText = webhook.lastIndexOf('handleCafeTestDailyCloseText');
  assert.ok(payrollImage >= 0 && expenseImage > payrollImage && cafeImage > expenseImage);
  assert.ok(payrollText >= 0 && intelligenceText > payrollText && expenseText > intelligenceText && dailyCloseText > expenseText);
});

test('database migration is additive, private, deduplicated, and keeps an audit trail', () => {
  const migration = readFileSync('supabase/migrations/20261005080000_owner_group_expense_inbox_v1.sql', 'utf8');
  assert.match(migration, /create table if not exists public\.financial_owner_expense_intakes/);
  assert.match(migration, /create table if not exists public\.financial_owner_expense_audit_events/);
  assert.match(migration, /owner-expense-evidence',false/);
  assert.match(migration, /financial_owner_expense_group_image_unique/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /grant execute on function public\.financial_capture_owner_expense_slip_v1[\s\S]*to service_role/);
  assert.match(migration, /before_data jsonb/);
  assert.match(migration, /financial_mark_owner_expense_not_expense_v1/);
  assert.doesNotMatch(migration, /drop\s+table/iu);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.financial_/iu);

  const rlsPolicy = readFileSync('supabase/migrations/20261005081000_owner_group_expense_deny_client_policy_v1.sql', 'utf8');
  assert.match(rlsPolicy, /as restrictive/iu);
  assert.match(rlsPolicy, /using \(false\)/iu);
});

test('backoffice cancellation removes a wrong item from active totals but retains evidence and audit', () => {
  const migration = readFileSync(
    'supabase/migrations/20261005112859_owner_expense_backoffice_cancel_v1.sql',
    'utf8',
  );
  assert.match(migration, /financial_cancel_owner_expense_intake_v1/);
  assert.match(migration, /set status='cancelled',updated_at=now\(\)/);
  assert.match(migration, /'source','backoffice'|'cancelled',\s*'backoffice'/s);
  assert.match(migration, /'evidence_retained',true/);
  assert.match(migration, /grant execute[\s\S]*to service_role/);
  assert.doesNotMatch(migration, /delete\s+from/iu);
  assert.doesNotMatch(migration, /storage\.objects/iu);
});
