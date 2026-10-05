// SNK MONEY x THONGTHAI -- the daily life + money coach.
//
// Thongthai is the owner's daily coach in the verified SNK MONEY group: ONE morning brief built from real SNK LIFE OS data
// (priorities, tasks, schedule, goals, money due), the owner reports the day naturally, and ONE evening close that starts
// from the ledger (income / expense / derived balances) and today's tasks.
//
//   * all data comes from Postgres (finance_coach_* RPCs); nothing here computes a balance or invents a task
//   * delivery goes ONLY to the ACTIVE finance binding, at most once per owner/kind/Bangkok-day (claimed in Postgres)
//   * owner replies ("ยอดตรง", "จริงเหลือ 80200", "ข้อ 2 เสร็จแล้ว", "ย้ายไปพรุ่งนี้", "ปิดวัน") are parsed by rules here and
//     executed by audited, idempotent RPCs; a stated balance that differs becomes an OWNER_RECONCILIATION adjustment, never an expense

import {
  addDays, bangkokToday, finalizeReply, findAmounts, money, normalizeText, numberOrNull, resolveAccount, thaiDate,
  type PfAccount,
} from './_personal-finance-core';
import { PfBindingClient, PfLedger, type Rpc, type UpcomingItem } from './_personal-finance-ledger';

type Json = Record<string, any>;

// ================================================================== recurring schedule (ported from SNK LIFE OS lib/recurrence.ts)

type Rule = { freq: 'daily' | 'weekly' | 'monthly' | 'yearly'; interval: number; byweekday?: number[]; until?: string | null; count?: number | null };

function parseRule(raw: string | null | undefined): Rule | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && parsed.freq ? (parsed as Rule) : null;
  } catch { return null; }
}

/** Same algorithm as the app's generateOccurrences (UTC arithmetic), so the brief matches the Schedule page. */
export function generateOccurrences(masterStart: Date, rule: Rule, rangeStart: Date, rangeEnd: Date): Date[] {
  const results: Date[] = [];
  const until = rule.until ? new Date(`${rule.until}T23:59:59.999Z`) : null;
  const maxCount = rule.count && rule.count > 0 ? rule.count : Infinity;
  const horizon = new Date(masterStart);
  horizon.setUTCFullYear(horizon.getUTCFullYear() + 20);
  const hardStop = until && until < horizon ? until : horizon;
  const push = (d: Date) => { if (d >= rangeStart && d <= rangeEnd) results.push(new Date(d)); };

  if (rule.freq === 'weekly' && rule.byweekday && rule.byweekday.length > 0) {
    const days = [...new Set(rule.byweekday)].sort((a, b) => a - b);
    const weekStart = new Date(masterStart);
    weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay());
    let emitted = 0;
    let weeks = 0;
    while (weekStart <= hardStop && emitted < maxCount && weeks < 5200) {
      for (const wd of days) {
        const day = new Date(weekStart);
        day.setUTCDate(day.getUTCDate() + wd);
        day.setUTCHours(masterStart.getUTCHours(), masterStart.getUTCMinutes(), masterStart.getUTCSeconds(), masterStart.getUTCMilliseconds());
        if (day < masterStart || day > hardStop) continue;
        emitted++;
        if (emitted > maxCount) break;
        push(day);
        if (results.length >= 2000) return results;
      }
      weekStart.setUTCDate(weekStart.getUTCDate() + 7 * Math.max(1, rule.interval));
      weeks++;
      if (weekStart > rangeEnd && weekStart > hardStop) break;
    }
    return results;
  }

  let cursor = new Date(masterStart);
  let index = 0;
  while (cursor <= hardStop && index < maxCount && index < 2000) {
    push(cursor);
    index++;
    const next = new Date(cursor);
    const step = Math.max(1, rule.interval || 1);
    if (rule.freq === 'daily') next.setUTCDate(next.getUTCDate() + step);
    else if (rule.freq === 'weekly') next.setUTCDate(next.getUTCDate() + 7 * step);
    else if (rule.freq === 'monthly') next.setUTCMonth(next.getUTCMonth() + step);
    else if (rule.freq === 'yearly') next.setUTCFullYear(next.getUTCFullYear() + step);
    if (cursor > rangeEnd && next > rangeEnd && index >= maxCount) break;
    if (cursor > rangeEnd && !rule.count && !rule.until) break;
    cursor = next;
  }
  return results;
}

export type DayEvent = { title: string; start: string; allDay: boolean; location: string | null };

/** Bangkok wall-clock "HH:MM" of an instant. */
export function bangkokClock(iso: string): string {
  return new Date(new Date(iso).getTime() + 7 * 3600_000).toISOString().slice(11, 16);
}

/** Today's events: one-off events plus recurring occurrences (minus skipped / with modified exceptions). */
export function eventsForDay(data: Json, today: string): DayEvent[] {
  const out: DayEvent[] = [];
  for (const e of (data.events ?? []) as Json[]) {
    out.push({ title: String(e.title), start: String(e.start_time), allDay: Boolean(e.all_day), location: e.location ?? null });
  }
  const rangeStart = new Date(`${today}T00:00:00+07:00`);
  const rangeEnd = new Date(`${today}T23:59:59.999+07:00`);
  const exceptions = (data.occurrence_exceptions ?? []) as Json[];
  for (const master of (data.recurring_events ?? []) as Json[]) {
    const rule = parseRule(master.rrule);
    if (!rule) continue;
    for (const occ of generateOccurrences(new Date(String(master.start_time)), rule, rangeStart, rangeEnd)) {
      const key = occ.toISOString().slice(0, 10);
      const ex = exceptions.find(x => x.master_event_id === master.id && String(x.occurrence_date).slice(0, 10) === key);
      if (ex?.action === 'skipped') continue;
      if (ex?.action === 'modified' && ex.status === 'cancelled') continue;
      const start = ex?.action === 'modified' && ex.start_time ? String(ex.start_time) : occ.toISOString();
      out.push({ title: String(ex?.title ?? master.title), start, allDay: Boolean(master.all_day), location: ex?.location ?? master.location ?? null });
    }
  }
  return out.sort((a, b) => (a.allDay === b.allDay ? a.start.localeCompare(b.start) : a.allDay ? -1 : 1));
}

// ================================================================== composition

export type CoachItem = { n: number; id: string; title: string };
export type CoachContext = { stage: 'MORNING' | 'EVENING'; date: string; items: CoachItem[]; asked: Array<{ id: string; name: string; balance: number | null }> };

const WEEKDAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
function weekdayName(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}
function bangkokHour(now: Date): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', hour12: false }).format(now)) % 24;
}

function dueLabel(i: Pick<UpcomingItem, 'days_until' | 'overdue' | 'due_date'>): string {
  if (i.overdue) return `เลยกำหนด ${Math.abs(i.days_until)} วัน`;
  if (i.days_until === 0) return 'วันนี้';
  if (i.days_until === 1) return 'พรุ่งนี้';
  return `อีก ${i.days_until} วัน (${thaiDate(i.due_date)})`;
}
function dueLine(i: Pick<UpcomingItem, 'title' | 'kind' | 'amount' | 'days_until' | 'overdue' | 'due_date'>): string {
  const verb = i.kind === 'INCOME' ? 'รับ' : 'จ่าย';
  return `• ${dueLabel(i)} — ${verb} ${i.title} ${i.amount !== null && i.amount !== undefined ? money(i.amount) : '(ยังไม่ระบุจำนวน)'}`;
}

function balanceLine(accounts: Json[]): string | null {
  if (!accounts.length) return null;
  const known = accounts.filter(a => a.balance_status !== 'UNKNOWN' && numberOrNull(a.balance) !== null);
  const unknown = accounts.filter(a => !(a.balance_status !== 'UNKNOWN' && numberOrNull(a.balance) !== null));
  const parts: string[] = [];
  if (known.length) parts.push(known.map(a => `${a.name} ${money(a.balance)}${a.balance_status === 'DERIVED' ? ' (คำนวณ)' : ''}`).join(' • '));
  if (unknown.length) parts.push(`ยังไม่ทราบยอด: ${unknown.map(a => a.name).join(', ')}`);
  return parts.join('\n   ');
}

export function composeMorning(data: Json, extraReminders: UpcomingItem[] = []): { text: string; context: CoachContext } {
  const today = String(data.today);
  const items: CoachItem[] = [];
  const seen = new Set<string>();
  const add = (id: string, title: string): number | null => {
    if (seen.has(id)) return null;
    seen.add(id);
    items.push({ n: items.length + 1, id, title });
    return items.length;
  };

  const lines: string[] = [`อรุณสวัสดิ์ครับ วัน${weekdayName(today)}ที่ ${thaiDate(today)}`];
  const tasks = (data.tasks ?? []) as Json[];
  const priorities = ((data.priorities ?? []) as Json[]).filter(p => p.title);

  // focus = the owner's own top priorities; otherwise the most pressing task
  const focus: string[] = [];
  for (const p of priorities) {
    const n = p.item_type === 'task' && p.item_id ? add(String(p.item_id), String(p.title)) : null;
    focus.push(`${n ? `${n}. ` : '• '}${p.title}${p.done ? ' ✅' : ''}`);
  }
  if (!focus.length && tasks.length) {
    const t = tasks[0];
    const n = add(String(t.id), String(t.title));
    focus.push(`${n}. ${t.title}${t.overdue ? ' (เลยกำหนด)' : ''}`);
  }
  if (focus.length) lines.push('🎯 โฟกัสวันนี้', ...focus);

  const rest = tasks.filter(t => !seen.has(String(t.id)));
  if (rest.length) {
    lines.push('📋 งานที่ต้องจัดการ');
    for (const t of rest.slice(0, 8)) {
      const n = add(String(t.id), String(t.title));
      lines.push(`${n}. ${t.title}${t.overdue ? ' (เลยกำหนด)' : t.due_time ? ` (${String(t.due_time).slice(0, 5)})` : ''}`);
    }
    if (rest.length > 8) lines.push(`…และอีก ${rest.length - 8} งานใน SNK LIFE OS`);
  }

  const events = eventsForDay(data, today);
  if (events.length) {
    lines.push('📅 ตารางวันนี้');
    for (const e of events.slice(0, 8)) lines.push(`• ${e.allDay ? 'ทั้งวัน' : bangkokClock(e.start)} ${e.title}${e.location ? ` @${e.location}` : ''}`);
  }
  const deadlines = (data.deadlines ?? []) as Json[];
  if (deadlines.length) {
    lines.push('⏳ ใกล้ถึงกำหนดส่ง');
    for (const d of deadlines.slice(0, 4)) lines.push(`• ${d.title} (${thaiDate(bangkokDateOf(String(d.start_time)))})`);
  }

  const due = ((data.money_due ?? []) as UpcomingItem[]).filter(i => i.days_until <= 3);
  const ids = new Set(due.map(i => i.obligation_id));
  const further = extraReminders.filter(i => !ids.has(i.obligation_id));
  const money_lines = [...due, ...further].map(dueLine);
  const accounts = ((data.accounts?.accounts ?? []) as Json[]);
  const bal = balanceLine(accounts);
  if (money_lines.length || bal) {
    lines.push('💰 การเงิน');
    if (money_lines.length) lines.push(...money_lines.slice(0, 8));
    else lines.push('• ไม่มีรายการต้องจ่ายใน 3 วันนี้');
    if (bal) lines.push(`• ยอดที่ผมมี: ${bal}`);
  }

  const goals = ((data.goals ?? []) as Json[]).slice(0, 2);
  if (goals.length) lines.push(`🏁 เป้าหมายสำคัญ: ${goals.map(g => g.title).join(' • ')}`);

  if (lines.length === 1) lines.push('วันนี้ยังไม่มีงานค้าง นัดหมาย หรือรายการต้องจ่ายใน SNK LIFE OS ครับ');
  lines.push('ระหว่างวันบอกผมได้เลยครับ เช่น “ข้อ 1 เสร็จแล้ว” หรือ “จ่ายค่าไฟ 1200”');
  const context: CoachContext = { stage: 'MORNING', date: today, items, asked: [] };
  return { text: finalizeReply(lines.join('\n')), context };
}

function bangkokDateOf(iso: string): string {
  return new Date(new Date(iso).getTime() + 7 * 3600_000).toISOString().slice(0, 10);
}

export function composeEvening(data: Json): { text: string; context: CoachContext } {
  const today = String(data.today);
  const lines: string[] = [`สรุปปิดวัน ${weekdayName(today)}ที่ ${thaiDate(today)} ครับ`];

  const income = Number(data.income ?? 0);
  const expense = Number(data.expense ?? 0);
  lines.push('💰 วันนี้');
  lines.push(`• รายรับ ${money(income)} (${data.income_count ?? 0} รายการ)  • รายจ่าย ${money(expense)} (${data.expense_count ?? 0} รายการ)`);
  if (Number(data.pending_clarification) > 0) lines.push(`⏳ มี ${data.pending_clarification} รายการที่ยังไม่ได้ระบุบัญชี บอกผมได้เลยครับ`);

  const due = (data.money_due ?? []) as UpcomingItem[];
  if (due.length) {
    lines.push('🧾 ถึงกำหนด/เลยกำหนด', ...due.slice(0, 6).map(dueLine), 'จ่ายแล้วพิมพ์ “จ่ายแล้ว” ได้เลยครับ');
  }

  const accounts = (data.accounts ?? []) as Json[];
  const bal = balanceLine(accounts.map(a => ({ name: a.name, balance: a.balance, balance_status: a.balance_status })));
  if (bal) lines.push(`🏦 ยอดตามที่ผมบันทึก: ${bal}`);
  const asked = accounts
    // only a DERIVED balance (movements since the last confirmation) is worth asking about
    .filter(a => a.moved_today && a.balance_status === 'DERIVED' && numberOrNull(a.balance) !== null)
    .slice(0, 3)
    .map(a => ({ id: String(a.id), name: String(a.name), balance: numberOrNull(a.balance) }));
  if (asked.length) {
    lines.push(`❓ ยอดจริงในแอปธนาคารตรงกับนี้ไหมครับ (ผมไม่เชื่อมธนาคาร ถามเพื่อให้ยอดถูกต้อง) ตอบ “ยอดตรง” หรือ “${asked[0].name} จริงเหลือ …”`);
  }

  const done = (data.tasks_done ?? []) as Json[];
  if (done.length) lines.push(`✅ เสร็จวันนี้ ${done.length} งาน: ${done.slice(0, 5).map(t => t.title).join(' • ')}`);
  const open = ((data.tasks_open ?? []) as Json[]).slice(0, 8);
  const items: CoachItem[] = open.map((t, i) => ({ n: i + 1, id: String(t.id), title: String(t.title) }));
  if (items.length) {
    lines.push('📌 ยังไม่เสร็จ', ...items.map(i => `${i.n}. ${i.title}`));
    lines.push('ตอบ “ข้อ 2 เสร็จแล้ว” / “ย้ายไปพรุ่งนี้” (ย้ายทั้งหมด) / “ข้อ 2 ย้ายไปพรุ่งนี้” ได้เลยครับ');
  } else if (!done.length) {
    lines.push('วันนี้ไม่มีงานค้างใน SNK LIFE OS ครับ');
  }
  lines.push('พิมพ์ “ปิดวัน” เมื่อเสร็จครับ');
  return { text: finalizeReply(lines.join('\n')), context: { stage: 'EVENING', date: today, items, asked } };
}

// ================================================================== delivery (cron)

export type CoachKind = 'MORNING' | 'EVENING';
export type CoachDeps = {
  rpc: Rpc;
  push: (groupId: string, text: string) => Promise<void>;
  decrypt: (value: string) => string | null;
  hash: (value: string) => string | null;
  now: () => Date;
  enabled: boolean;
  log?: (event: string, data: Record<string, unknown>) => void;
};
export type CoachResult = { skipped?: string; targets: number; sent: number; failed: number; already: number };

/** Local-time windows (Asia/Bangkok).  The scheduler fires hourly; the claim makes each window send at most once per day. */
export const COACH_WINDOW: Record<CoachKind, [number, number]> = { MORNING: [7, 11], EVENING: [21, 24] };

export async function runCoach(kind: CoachKind, deps: CoachDeps, opts: { ignoreWindow?: boolean } = {}): Promise<CoachResult> {
  const result: CoachResult = { targets: 0, sent: 0, failed: 0, already: 0 };
  if (!deps.enabled) return { ...result, skipped: 'disabled' };
  const hour = bangkokHour(deps.now());
  const [from, to] = COACH_WINDOW[kind];
  if (!opts.ignoreWindow && (hour < from || hour >= to)) return { ...result, skipped: 'outside_window' };
  const log = deps.log ?? (() => undefined);

  const targets = await new PfBindingClient(deps.rpc).activeTargets();
  if (!targets.length) return { ...result, skipped: 'no_active_group' };
  const today = bangkokToday(deps.now());

  for (const target of targets) {
    result.targets++;
    const groupId = target.group_id_enc ? deps.decrypt(target.group_id_enc) : null;
    // Defence in depth: the decrypted id must hash to the ACTIVE binding it came from.
    if (!groupId || deps.hash(groupId) !== target.group_id_hash) { log('PF_COACH_TARGET_MISMATCH', {}); result.failed++; continue; }
    const ledger = new PfLedger(deps.rpc, target.owner_id);
    const claim = await ledger.coachClaim(kind, today);
    if (!claim.claimed || !claim.delivery_id) { result.already++; continue; }
    const reminders: Awaited<ReturnType<PfLedger['claimReminders']>> = [];
    try {
      let composed: { text: string; context: CoachContext };
      if (kind === 'MORNING') {
        // due reminders fold into the brief so the owner gets one message, not two
        reminders.push(...await ledger.claimReminders(today, 50));
        const extra: UpcomingItem[] = reminders.map(r => ({
          obligation_id: r.obligation_id, title: r.title, kind: r.kind as 'EXPENSE' | 'INCOME', amount: r.amount, due_date: r.due_date,
          days_until: r.days_until, overdue: r.overdue, frequency: '', default_account_id: null, projected: false,
        }));
        composed = composeMorning(await ledger.coachMorningData(today), extra);
      } else {
        composed = composeEvening(await ledger.coachEveningData(today));
      }
      await ledger.dayCloseSetContext(today, composed.context as unknown as Json);
      await deps.push(groupId, composed.text);
      await ledger.coachFinish(claim.delivery_id, true);
      for (const r of reminders) await ledger.finishReminder(r.delivery_id, true);
      result.sent++;
    } catch (error) {
      const reason = error instanceof Error ? error.message.slice(0, 200) : 'coach_failed';
      log('PF_COACH_FAILED', { kind, reason });
      try { await ledger.coachFinish(claim.delivery_id, false, reason); } catch { /* retried by the next run */ }
      for (const r of reminders) { try { await ledger.finishReminder(r.delivery_id, false, reason); } catch { /* ignore */ } }
      result.failed++;
    }
  }
  return result;
}

// ================================================================== owner replies

export type CoachIntent =
  | { kind: 'DAY_CLOSE' }
  | { kind: 'RECONCILE_START' }
  | { kind: 'RECONCILE_MATCH' }
  | { kind: 'RECONCILE_ACTUAL'; amount: number; accountHint: string | null }
  | { kind: 'TASK_DONE'; numbers: number[]; title: string | null }
  | { kind: 'TASK_NOT_DONE'; numbers: number[] }
  | { kind: 'TASK_DEFER'; numbers: number[]; title: string | null }
  | { kind: 'TASK_TODAY'; numbers: number[] };

const NUM_WORDS: Record<string, number> = { หนึ่ง: 1, สอง: 2, สาม: 3, สี่: 4, ห้า: 5, หก: 6, เจ็ด: 7, แปด: 8, เก้า: 9, สิบ: 10 };

function parseNumbers(text: string): number[] {
  const m = /ข้อ\s*((?:\d+|หนึ่ง|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า|สิบ)(?:\s*(?:,|และ|กับ|แล้วก็|\/|&)?\s*(?:\d+|หนึ่ง|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า|สิบ))*)/.exec(text);
  if (!m) return [];
  const out: number[] = [];
  for (const tok of m[1].match(/\d+|หนึ่ง|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า|สิบ/g) ?? []) out.push(/\d/.test(tok) ? Number(tok) : NUM_WORDS[tok]);
  return [...new Set(out)].filter(n => n >= 1 && n <= 50);
}

const DAY_CLOSE_RE = /^(?:ปิดวัน|ปิดวันนี้|จบวัน|วันนี้พอแล้ว|พอแล้ววันนี้|วันนี้พอ|พอแล้วสำหรับวันนี้)\s*(?:นะ|ครับ)?$/;
const MATCH_RE = /^(?:ยอดตรง|ตรงแล้ว|ตรงครับ|ตรงทุกบัญชี|ยอดถูก(?:ต้อง)?(?:แล้ว)?|ยอดตรงกัน|ตรง)\s*(?:ครับ|นะ)?$/;
const DONE_RE = /(?:เสร็จแล้ว|เสร็จละ|เสร็จเรียบร้อย|ทำแล้ว|เรียบร้อยแล้ว|ทำเสร็จ|ทำเสร็จแล้ว|เสร็จ)/;
const NOT_DONE_RE = /(?:ยังไม่เสร็จ|ยังไม่ได้ทำ|ไม่เสร็จ|ยังไม่ได้)/;
const DEFER_RE = /(?:ย้าย|ยก|เลื่อน)(?:งาน)?(?:ที่เหลือ|ทั้งหมด|ที่ค้าง)?(?:ไป|ไปทำ)?\s*(?:วัน)?พรุ่งนี้/;

/** Rules only.  Returns null for anything that is not clearly a coach phrase (it then falls through to the finance interpreter). */
export function interpretCoachText(raw: string, opts: { hasContext: boolean } = { hasContext: true }): CoachIntent | null {
  const t = normalizeText(raw).replace(/[!！。]+$/g, '').trim();
  if (!t) return null;
  if (DAY_CLOSE_RE.test(t)) return { kind: 'DAY_CLOSE' };
  if (/^กระทบยอด(?:วันนี้)?$/.test(t)) return { kind: 'RECONCILE_START' };
  if (MATCH_RE.test(t) && (t !== 'ตรง' || opts.hasContext)) return { kind: 'RECONCILE_MATCH' };

  const actual = /^(?:(.{1,30}?)\s*)?(?:ยอด)?จริง(?:ๆ)?\s*(?:ๆ)?\s*(?:เหลือ|คือ|อยู่ที่|เป็น)?\s*(.*)$/.exec(t);
  if (actual && /\d/.test(actual[2])) {
    const amounts = findAmounts(actual[2]);
    if (amounts.length === 1) {
      const hint = (actual[1] ?? '').replace(/^(?:บัญชี|ใน|ที่)\s*/, '').replace(/(?:ยอด|ที่|ใน)$/, '').trim();
      return { kind: 'RECONCILE_ACTUAL', amount: amounts[0].value, accountHint: hint && hint.length <= 24 ? hint : null };
    }
  }

  if (findAmounts(t).length > 0 && !/ข้อ\s*\d/.test(t)) return null;      // money talk is never a task command
  const numbers = parseNumbers(t);

  if (DEFER_RE.test(t)) return { kind: 'TASK_DEFER', numbers, title: numbers.length ? null : taskTitleFrom(t, DEFER_RE) };
  if (numbers.length && /(?:สำคัญ|ด่วน|ทำก่อน|เร่งด่วน)/.test(t) && !NOT_DONE_RE.test(t)) return { kind: 'TASK_TODAY', numbers };
  if (NOT_DONE_RE.test(t)) return numbers.length ? { kind: 'TASK_NOT_DONE', numbers } : null;
  if (DONE_RE.test(t) && !/จ่าย|โอน|ชำระ|ได้เงิน|รับเงิน/.test(t)) {
    if (numbers.length) return { kind: 'TASK_DONE', numbers, title: null };
    const title = taskTitleFrom(t, DONE_RE);
    if (title) return { kind: 'TASK_DONE', numbers: [], title };
    return opts.hasContext && /^(?:เสร็จแล้ว|เสร็จละ|ทำแล้ว|เรียบร้อยแล้ว)$/.test(t) ? { kind: 'TASK_DONE', numbers: [], title: null } : null;
  }
  return null;
}

function taskTitleFrom(text: string, re: RegExp): string | null {
  const title = text.replace(re, ' ').replace(/^(?:งาน|ผม|เรา|ได้)\s*/, '').replace(/(?:แล้ว|ละ|นะ|ครับ)\s*$/g, '').trim();
  return title.length >= 3 && title.length <= 80 ? title : null;
}

const keyOf = (s: string) => s.toLowerCase().replace(/\s+/g, '');

export type CoachCtx = { ledger: PfLedger; actor: string; messageId: string; today: string; isOwner: boolean };
export type CoachOutcome = { reply: string } | { delegate: { kind: 'SET_BALANCE'; amount: number; accountHint: string | null; accountKind: null } } | null;

async function loadContext(c: CoachCtx): Promise<CoachContext | null> {
  const row = await c.ledger.dayCloseGet(addDays(c.today, -1));
  const ctx = row?.context as Partial<CoachContext> | undefined;
  if (!row || !ctx || !Array.isArray(ctx.items)) return null;
  return { stage: ctx.stage ?? 'MORNING', date: ctx.date ?? row.local_date, items: ctx.items, asked: Array.isArray(ctx.asked) ? ctx.asked : [] };
}

async function resolveTasks(c: CoachCtx, intent: { numbers: number[]; title?: string | null }, ctx: CoachContext | null): Promise<
  { ok: true; tasks: Array<{ id: string; title: string }> } | { ok: false; reply: string | null }
> {
  if (intent.numbers.length) {
    if (!ctx?.items.length) return { ok: false, reply: 'ผมยังไม่มีรายการงานของวันนี้ให้อ้างเลขข้อครับ ระบุชื่องานได้เลย ผมยังไม่ได้เปลี่ยนอะไร' };
    const tasks: Array<{ id: string; title: string }> = [];
    for (const n of intent.numbers) {
      const item = ctx.items.find(i => i.n === n);
      if (!item) return { ok: false, reply: `ไม่พบข้อ ${n} ในรายการล่าสุดครับ ผมยังไม่ได้เปลี่ยนอะไร` };
      tasks.push({ id: item.id, title: item.title });
    }
    return { ok: true, tasks };
  }
  if (intent.title) {
    const open = await c.ledger.coachOpenTasks(100);
    const q = keyOf(intent.title);
    const hits = open.filter(t => keyOf(t.title).includes(q) || (q.length >= 4 && q.includes(keyOf(t.title))));
    if (hits.length === 1) return { ok: true, tasks: [{ id: hits[0].id, title: hits[0].title }] };
    if (hits.length > 1) return { ok: false, reply: `ชื่อนี้ตรงกับหลายงานครับ (${hits.slice(0, 4).map(h => h.title).join(' • ')}) ระบุให้ชัดขึ้นอีกนิดได้ไหมครับ ผมยังไม่ได้เปลี่ยนอะไร` };
    return { ok: false, reply: null };            // not a task we know: stay silent (ordinary chat)
  }
  if (ctx?.items.length === 1) return { ok: true, tasks: [{ id: ctx.items[0].id, title: ctx.items[0].title }] };
  if (ctx?.items.length) return { ok: false, reply: 'ข้อไหนครับ พิมพ์เช่น “ข้อ 2 เสร็จแล้ว” ผมยังไม่ได้เปลี่ยนอะไร' };
  return { ok: false, reply: null };
}

export async function handleCoachText(c: CoachCtx, text: string, accounts: PfAccount[]): Promise<CoachOutcome> {
  const intent = interpretCoachText(text, { hasContext: true });
  if (!intent) return null;                                   // not a coach phrase: no extra round trip for ordinary finance chat
  let ctx: CoachContext | null = null;
  try { ctx = await loadContext(c); } catch { ctx = null; }
  if (!ctx && !interpretCoachText(text, { hasContext: false })) return null;
  if (!c.isOwner) return { reply: finalizeReply('ขออภัยครับ เรื่องงานประจำวันและการกระทบยอดเจ้าของกลุ่มเป็นผู้ทำได้เท่านั้นครับ') };
  const { ledger } = c;

  switch (intent.kind) {
    case 'RECONCILE_START': {
      const known = accounts.filter(a => a.balance_status !== 'UNKNOWN' && numberOrNull(a.balance) !== null);
      if (!accounts.length) return { reply: finalizeReply('ยังไม่มีบัญชีให้กระทบยอดครับ บอกยอดบัญชีได้เลย เช่น “SCB ตอนนี้เหลือ 100000”') };
      const lines = accounts.map(a => `• ${a.name}: ${a.balance_status === 'UNKNOWN' ? 'ยังไม่ทราบยอด' : money(a.balance)}`);
      await ledger.dayCloseSetContext(c.today, { ...(ctx ?? { stage: 'EVENING', date: c.today, items: [] }), date: c.today, asked: known.slice(0, 5).map(a => ({ id: a.id, name: a.name, balance: numberOrNull(a.balance) })) } as unknown as Json);
      return { reply: finalizeReply(['ยอดตามที่ผมบันทึก (ผมไม่เชื่อมธนาคาร):', ...lines, 'เทียบกับแอปธนาคารแล้วตอบ “ยอดตรง” หรือบอกยอดจริง เช่น “SCB จริงเหลือ 80200” ครับ ส่วนต่างผมจะบันทึกเป็นรายการปรับยอด ไม่ใช่รายจ่าย'].join('\n')) };
    }

    case 'RECONCILE_MATCH': {
      let asked = ctx?.asked ?? [];
      if (!asked.length) {
        const known = accounts.filter(a => a.balance_status !== 'UNKNOWN' && numberOrNull(a.balance) !== null);
        if (known.length !== 1) return { reply: finalizeReply(known.length ? `ยอดตรงของบัญชีไหนครับ (${known.map(a => a.name).join(', ')}) พิมพ์เช่น “กระทบยอด” เพื่อดูยอดทั้งหมดครับ` : 'ยังไม่มียอดให้ยืนยันครับ บอกยอดจริงของบัญชีได้เลย เช่น “SCB ตอนนี้เหลือ 100000”') };
        asked = [{ id: known[0].id, name: known[0].name, balance: null }];
      }
      const done: string[] = [];
      const problems: string[] = [];
      for (const a of asked) {
        const res = await ledger.confirmBalance(a.id, a.balance, c.actor, c.messageId, `${c.messageId}:confirm:${a.id}`);
        if (res.ok && res.account) done.push(`${a.name} ${money(res.account.balance)}`);
        else if (res.error === 'balance_changed') problems.push(`${a.name} ยอดเปลี่ยนไปแล้ว (ตอนนี้ ${money(res.balance)}) บอกยอดจริงอีกครั้งได้เลยครับ`);
        else if (res.error === 'balance_unknown') problems.push(`${a.name} ยังไม่เคยมียอดที่ยืนยัน บอกยอดจริงมาได้เลยครับ`);
        else problems.push(`${a.name} ยืนยันไม่สำเร็จ`);
      }
      const parts: string[] = [];
      if (done.length) parts.push(`รับทราบครับ ยืนยันยอดตรง: ${done.join(' • ')} ✅ (ผมไม่ได้เพิ่มรายการใดๆ)`);
      parts.push(...problems);
      return { reply: finalizeReply(parts.join('\n')) };
    }

    case 'RECONCILE_ACTUAL': {
      let hint = intent.accountHint;
      if (hint) {
        const m = resolveAccount(hint, accounts);
        if (m.kind === 'none') {
          // the "hint" may just be filler words ("ตอนนี้", "ที่ธนาคาร"); fall back to context below
          hint = null;
        } else if (m.kind === 'one') hint = m.account.name;
      }
      if (!hint) {
        const asked = ctx?.asked ?? [];
        const known = accounts.filter(a => a.balance_status !== 'UNKNOWN' && numberOrNull(a.balance) !== null);
        if (asked.length === 1) hint = asked[0].name;
        else if (known.length === 1) hint = known[0].name;
        else return { reply: finalizeReply(`ยอดจริง ${money(intent.amount)} นี้เป็นของบัญชีไหนครับ${accounts.length ? ` (${accounts.map(a => a.name).join(', ')})` : ''} พิมพ์เช่น “SCB จริงเหลือ ${intent.amount}” ผมยังไม่ได้บันทึกอะไร`) };
      }
      return { delegate: { kind: 'SET_BALANCE', amount: intent.amount, accountHint: hint, accountKind: null } };
    }

    case 'TASK_NOT_DONE': {
      const r = await resolveTasks(c, { numbers: intent.numbers }, ctx);
      if (!r.ok) return r.reply ? { reply: finalizeReply(r.reply) } : null;
      return { reply: finalizeReply(`รับทราบครับ ${r.tasks.map(t => `“${t.title}”`).join(', ')} ยังไม่เสร็จ ผมยังไม่เปลี่ยนสถานะ จะให้ย้ายไปพรุ่งนี้ไหมครับ ตอบ “ย้ายไปพรุ่งนี้” หรือ “ข้อ ${intent.numbers[0]} ย้ายไปพรุ่งนี้” ได้เลย`) };
    }

    case 'TASK_DONE': {
      const r = await resolveTasks(c, intent, ctx);
      if (!r.ok) return r.reply ? { reply: finalizeReply(r.reply) } : null;
      const done: string[] = [];
      const missing: string[] = [];
      for (const t of r.tasks) {
        const res = await ledger.taskSetDone(t.id, true, c.actor, c.messageId, `${c.messageId}:done:${t.id}`);
        if (res.ok) done.push(t.title); else missing.push(t.title);
      }
      const parts: string[] = [];
      if (done.length) parts.push(`ปิดงานใน SNK LIFE OS แล้วครับ ✅ ${done.map(d => `“${d}”`).join(', ')}`);
      if (missing.length) parts.push(`หางานนี้ไม่พบแล้วครับ: ${missing.join(', ')}`);
      return { reply: finalizeReply(parts.join('\n')) };
    }

    case 'TASK_TODAY': {
      const r = await resolveTasks(c, { numbers: intent.numbers }, ctx);
      if (!r.ok) return r.reply ? { reply: finalizeReply(r.reply) } : null;
      const ok: string[] = [];
      for (const t of r.tasks) if ((await ledger.taskSetToday(t.id, true, c.actor, c.messageId, `${c.messageId}:today:${t.id}`)).ok) ok.push(t.title);
      return { reply: finalizeReply(ok.length ? `ตั้งเป็นงานสำคัญวันนี้แล้วครับ ${ok.map(t => `“${t}”`).join(', ')}` : 'ตั้งไม่สำเร็จครับ งานอาจเสร็จไปแล้ว') };
    }

    case 'TASK_DEFER': {
      let tasks: Array<{ id: string; title: string }>;
      if (!intent.numbers.length && !intent.title) {
        // "ย้ายไปพรุ่งนี้": every still-open item from the latest brief / close
        const open = new Set((await ledger.coachOpenTasks(200)).map(t => t.id));
        tasks = (ctx?.items ?? []).filter(i => open.has(i.id)).map(i => ({ id: i.id, title: i.title }));
        if (!tasks.length) return { reply: finalizeReply('ไม่มีงานค้างให้ย้ายแล้วครับ') };
      } else {
        const r = await resolveTasks(c, intent, ctx);
        if (!r.ok) return r.reply ? { reply: finalizeReply(r.reply) } : null;
        tasks = r.tasks;
      }
      const tomorrow = addDays(c.today, 1);
      const moved: string[] = [];
      for (const t of tasks) if ((await ledger.taskDefer(t.id, tomorrow, c.actor, c.messageId, `${c.messageId}:defer:${t.id}`)).ok) moved.push(t.title);
      return { reply: finalizeReply(moved.length ? `ย้ายไปพรุ่งนี้ (${thaiDate(tomorrow)}) แล้วครับ: ${moved.map(m => `“${m}”`).join(', ')} พรุ่งนี้เช้าผมจะแจ้งอีกครั้งครับ` : 'ย้ายไม่สำเร็จครับ งานอาจเสร็จไปแล้ว') };
    }

    case 'DAY_CLOSE': {
      const data = await ledger.coachEveningData(c.today);
      const open = ((data.tasks_open ?? []) as Json[]).length;
      await ledger.dayClose(c.today, null, c.actor, c.messageId);
      const parts = [
        `ปิดวัน ${thaiDate(c.today)} เรียบร้อยครับ`,
        `วันนี้ รายรับ ${money(data.income)} • รายจ่าย ${money(data.expense)}${Number(data.pending_clarification) > 0 ? ` • ยังมี ${data.pending_clarification} รายการรอระบุบัญชี` : ''}`,
      ];
      if (open > 0) parts.push(`ยังมีงานค้าง ${open} งาน ผมไม่ได้ย้ายให้เอง พรุ่งนี้เช้าจะแจ้งอีกครั้งครับ`);
      parts.push('พักผ่อนนะครับ');
      return { reply: finalizeReply(parts.join('\n')) };
    }
  }
}

export async function defaultCoachDeps(): Promise<CoachDeps> {
  const { piiHash, decryptPii } = await import('./_operations-db');
  const { supabaseRpc, assertLedgerConfigured } = await import('./_personal-finance-ledger');
  const { pfEnabled } = await import('./_personal-finance-core');
  assertLedgerConfigured();
  return {
    rpc: supabaseRpc,
    decrypt: decryptPii,
    hash: piiHash,
    now: () => new Date(),
    enabled: pfEnabled(),
    log: (event, data) => console.log(event, JSON.stringify(data)),
    push: async (groupId, text) => {
      const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
      if (!token) throw new Error('LINE_CHANNEL_ACCESS_TOKEN is not configured');
      const response = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ to: groupId, messages: [{ type: 'text', text }] }),
      });
      if (!response.ok) throw new Error(`line_push_${response.status}`);
    },
  };
}
