import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyOwnerExpensePurpose } from '../netlify/functions/_owner-expense-intake';

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
});

test('owner expense inbox stores first and asks both purpose and business before it categorizes', () => {
  const intake = readFileSync('netlify/functions/_owner-expense-intake.ts', 'utf8');
  assert.match(intake, /สลิปนี้จ่ายค่าอะไร และเป็นของกิจการ\/ส่วนไหนครับ/u);
  assert.match(intake, /financial_capture_owner_expense_slip_v1/);
  assert.match(intake, /financial_stage_owner_expense_purpose_v1/);
  assert.match(intake, /financial_resolve_owner_expense_intake_v1/);
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
