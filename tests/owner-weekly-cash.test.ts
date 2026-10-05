import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildOwnerWeeklyCashSummary,
  ownerWeeklyCashWindow,
} from '../netlify/functions/_ops-notifications';

test('weekly owner cash window covers the six completed days before Sunday', () => {
  assert.deepEqual(ownerWeeklyCashWindow('2026-10-11'), {
    startDate: '2026-10-05',
    endDate: '2026-10-11',
    expectedDates: [
      '2026-10-05', '2026-10-06', '2026-10-07',
      '2026-10-08', '2026-10-09', '2026-10-10',
    ],
  });
});

test('weekly owner cash summary reports only ready cash and exposes incomplete close days', () => {
  const branches = [{ id: 'branch-1', code: 'inthanin_tadtone', name: 'Inthanin Café ตาดโตน' }];
  const closes = [
    {
      branch_id: 'branch-1', local_date: '2026-10-05', status: 'confirmed', payment_cash: 400,
      cash_opening_float: 2_000, cash_counted_closing: 2_000,
    },
    {
      branch_id: 'branch-1', local_date: '2026-10-06', status: 'draft', payment_cash: 620,
      cash_opening_float: 700, cash_counted_closing: null,
    },
  ];
  const text = buildOwnerWeeklyCashSummary({
    localDate: '2026-10-11',
    branches,
    closes,
    bags: [{
      branch_code: 'inthanin_tadtone', branch_name: 'Inthanin Café ตาดโตน',
      bag_balance: 260, total_swept_to_bag: 260, total_owner_pickup: 0,
      last_movement_at: '2026-10-02T17:55:55.194997+00:00',
    }],
  });

  assert.match(text, /ยอดพร้อมรับตามถุงเงินสด: 260 บาท/u);
  assert.match(text, /Inthanin Café ตาดโตน · 260 บาท/u);
  assert.match(text, /มีข้อมูลปิดยอด 2\/6 วัน · ยืนยันแล้ว 1 วัน/u);
  assert.match(text, /ยังไม่มีข้อมูลเงินสดครบ 5 วัน/u);
  assert.match(text, /วันที่ข้อมูลไม่ครบจะยังไม่ถูกบวกเพื่อป้องกันยอดผิด/u);
  assert.doesNotMatch(text, /ยอดพร้อมรับตามถุงเงินสด: 880 บาท/u);
});

test('scheduled function runs Sundays at 13:00 Bangkok and delivery is owner-only and idempotent', () => {
  const scheduled = readFileSync('netlify/functions/owner-weekly-cash.ts', 'utf8');
  const notifications = readFileSync('netlify/functions/_ops-notifications.ts', 'utf8');
  assert.match(scheduled, /schedule:\s*'0 6 \* \* 0'/u);
  assert.match(scheduled, /Sunday 06:00 UTC = Sunday 13:00 Asia\/Bangkok/u);
  assert.match(notifications, /financial_cash_bag_owner_v1\?environment=eq\.live/u);
  assert.match(notifications, /financial_daily_closes\?environment=eq\.live/u);
  assert.match(notifications, /teamCode: 'owner_general'/u);
  assert.match(notifications, /idempotencyKey: `owner_weekly_cash:\$\{localDate\}`/u);
  assert.match(notifications, /deliveryType: 'daily_summary'/u);
  assert.doesNotMatch(scheduled, /financial_record_cash_bag_pickup/u, 'reminder must never record a pickup automatically');
});
