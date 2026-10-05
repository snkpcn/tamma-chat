import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildOwnerProjectWeeklySummary,
  ownerProjectWeekWindow,
} from '../netlify/functions/_owner-project-weekly';

test('Sunday summary plans the coming Monday through Sunday', () => {
  assert.deepEqual(ownerProjectWeekWindow('2026-10-11'), {
    endingWeekStart: '2026-10-05',
    upcomingStart: '2026-10-12',
    upcomingEnd: '2026-10-18',
  });
});

test('weekly project summary shows unfinished work, overdue work, and installments in easy Thai', () => {
  const text = buildOwnerProjectWeeklySummary({
    localDate: '2026-10-11',
    projects: [{ id: 'p1', name: 'ครัวใหม่', project_code: 'PJ-1', status: 'active', budget_amount: 100_000, due_on: null }],
    tasks: [
      { id: 't1', project_id: 'p1', title: 'เช็กหน้างาน', task_kind: 'weekly', recurrence_weekdays: [1], due_on: null, schedule_text: 'ทุกวันจันทร์', responsible_name: 'แม่', status: 'todo' },
      { id: 't2', project_id: 'p1', title: 'ติดเคาน์เตอร์', task_kind: 'pre_opening', recurrence_weekdays: [], due_on: '2026-10-10', schedule_text: null, responsible_name: null, status: 'in_progress' },
      { id: 't3', project_id: 'p1', title: 'รับเครื่องครัว', task_kind: 'one_time', recurrence_weekdays: [], due_on: '2026-10-15', schedule_text: null, responsible_name: null, status: 'todo' },
    ],
    installments: [
      { id: 'i1', project_id: 'p1', task_id: 't3', installment_no: 1, title: 'งวดที่ 1', amount: 30_000, due_on: '2026-10-14', counterparty_name: 'ช่างสมชาย', status: 'planned' },
    ],
    checkins: [{ task_id: 't1', week_start: '2026-10-05', state: 'pending' }],
  });
  assert.match(text, /งานประจำสัปดาห์ที่ยังไม่กดว่าเสร็จ/u);
  assert.match(text, /เช็กหน้างาน · ครัวใหม่ · แม่/u);
  assert.match(text, /ติดเคาน์เตอร์ · ครัวใหม่ · เลยกำหนด/u);
  assert.match(text, /รับเครื่องครัว · ครัวใหม่/u);
  assert.match(text, /งวดที่ 1 · 30,000 บาท/u);
});

test('Sunday 13:00 owner message appends project summary without weakening cash idempotency', () => {
  const source = readFileSync('netlify/functions/_ops-notifications.ts', 'utf8');
  assert.match(source, /loadOwnerProjectWeeklySummary\(localDate\)/u);
  assert.match(source, /buildOwnerWeeklyCashSummary[\s\S]*projectSummary/u);
  assert.match(source, /idempotencyKey: `owner_weekly_cash:\$\{localDate\}`/u);
});

