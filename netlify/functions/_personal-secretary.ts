// SNK LIFE OS x THONGTHAI -- deterministic CEO secretary.
//
// Language is interpreted here, but all durable state, dedupe, idempotency and
// audit writes are performed by the SNK LIFE OS Postgres RPCs.  This module
// extends the canonical tasks/schedule/goals tables; it never creates a second
// task system and it never performs money arithmetic.

import { addDays, finalizeReply, findAmounts, knownAccountFromText, normalizeText, thaiDate } from './_personal-finance-core';
import { parseDueDate } from './_personal-finance-nlu';
import { PfLedger } from './_personal-finance-ledger';

type Json = Record<string, any>;

export type SecretaryItemKind =
  | 'CALENDAR_EVENT' | 'TASK' | 'DEADLINE_TASK' | 'RECURRING_TASK'
  | 'DAILY_FOLLOW_UP' | 'FINANCIAL_OBLIGATION' | 'WAITING' | 'GOAL';

export type SecretaryItem = Json & {
  kind: SecretaryItemKind;
  title: string;
  source_index: number;
};

export type SecretaryParse = { items: SecretaryItem[]; error?: 'too_many_items' };
export type SecretaryCtx = {
  ledger: PfLedger;
  actor: string;
  messageId: string;
  today: string;
  isOwner: boolean;
};

export type SecretaryOutcome = { reply: string } | null;

const THAI_NUMBER: Record<string, number> = {
  ศูนย์: 0, หนึ่ง: 1, แรก: 1, สอง: 2, สาม: 3, สี่: 4, ห้า: 5,
  หก: 6, เจ็ด: 7, แปด: 8, เก้า: 9, สิบ: 10,
};
const WEEKDAY: Record<string, number> = { อาทิตย์: 0, จันทร์: 1, อังคาร: 2, พุธ: 3, พฤหัส: 4, พฤหัสบดี: 4, ศุกร์: 5, เสาร์: 6 };
const FINANCE_WORD = /(ยอด|บาท|฿|บัญชี|เงิน|รายรับ|รายจ่าย|โอน|ชำระ|จ่ายแล้ว|ยังไม่จ่าย)/;
const TASK_DONE = /(?:เสร็จแล้ว|เสร็จละ|เรียบร้อย(?:แล้ว)?|จบแล้ว|ปิดงาน(?:นี้)?ได้|ผ่านแล้ว)/;
const REFERENCE = /(?:อันนี้|อันนั้น|เรื่องนี้|งานนี้|เมื่อกี้|เมื่อสักครู่)/;

function isoDateParts(ymd: string): [number, number, number] {
  const [y, m, d] = ymd.split('-').map(Number);
  return [y, m, d];
}

function weekdayOf(ymd: string): number {
  const [y, m, d] = isoDateParts(ymd);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function upcomingWeekday(today: string, wanted: number, forceNext = false): string {
  let delta = (wanted - weekdayOf(today) + 7) % 7;
  if (forceNext || delta === 0) delta += 7;
  return addDays(today, delta);
}

function endOfThisWeek(today: string): string {
  const delta = (7 - weekdayOf(today)) % 7;
  return addDays(today, delta);
}

function parseThaiNumber(raw: string): number | null {
  if (/^\d+$/.test(raw)) return Number(raw);
  return THAI_NUMBER[raw] ?? null;
}

export function parseSecretaryDate(text: string, today: string): string | null {
  const normalized = normalizeText(text);
  const direct = parseDueDate(normalized, today).date;
  if (direct) return direct;
  const weekday = normalized.match(/(?:วัน)?(อาทิตย์|จันทร์|อังคาร|พุธ|พฤหัสบดี|พฤหัส|ศุกร์|เสาร์)(นี้|หน้า)?/);
  if (weekday) return upcomingWeekday(today, WEEKDAY[weekday[1]], weekday[2] === 'หน้า');
  if (/(?:อาทิตย์|สัปดาห์)หน้า/.test(normalized)) return addDays(today, 7);
  return null;
}

export function parseSecretaryTime(text: string): string | null {
  const t = normalizeText(text);
  const colon = t.match(/(?:เวลา\s*)?(\d{1,2})[.:](\d{2})/);
  if (colon) {
    const h = Number(colon[1]); const m = Number(colon[2]);
    if (h <= 23 && m <= 59) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  if (/เที่ยง(?:ตรง)?/.test(t)) return '12:00';
  const afternoon = t.match(/บ่าย\s*(โมง|\d{1,2}|หนึ่ง|สอง|สาม|สี่|ห้า)/);
  if (afternoon) {
    const n = afternoon[1] === 'โมง' ? 1 : parseThaiNumber(afternoon[1]);
    if (n !== null && n >= 1 && n <= 5) return `${String(12 + n).padStart(2, '0')}:00`;
  }
  const evening = t.match(/(\d{1,2}|หนึ่ง|สอง|สาม|สี่|ห้า)\s*ทุ่ม/);
  if (evening) {
    const n = parseThaiNumber(evening[1]);
    if (n !== null && n >= 1 && n <= 5) return `${18 + n}:00`;
  }
  const dawn = t.match(/ตี\s*(\d{1,2}|หนึ่ง|สอง|สาม|สี่|ห้า)/);
  if (dawn) {
    const n = parseThaiNumber(dawn[1]);
    if (n !== null && n >= 1 && n <= 5) return `0${n}:00`;
  }
  const hour = t.match(/(\d{1,2})\s*โมง(?:เช้า)?/);
  if (hour && Number(hour[1]) <= 23) return `${String(Number(hour[1])).padStart(2, '0')}:00`;
  return null;
}

function stripTemporal(text: string): string {
  return text
    .replace(/(?:วันนี้|พรุ่งนี้|มะรืน|อาทิตย์นี้|สัปดาห์นี้|อาทิตย์หน้า|สัปดาห์หน้า)/g, ' ')
    .replace(/วันที่\s*\d{1,2}(?:\/\d{1,2}(?:\/\d{2,4})?)?/g, ' ')
    .replace(/\d{1,2}\/\d{1,2}(?:\/\d{2,4})?/g, ' ')
    .replace(/(?:เวลา\s*)?\d{1,2}[.:]\d{2}|บ่าย\s*(?:โมง|\d{1,2}|หนึ่ง|สอง|สาม|สี่|ห้า)|(?:\d{1,2}|หนึ่ง|สอง|สาม|สี่|ห้า)\s*ทุ่ม|ตี\s*(?:\d{1,2}|หนึ่ง|สอง|สาม|สี่|ห้า)|\d{1,2}\s*โมง(?:เช้า)?|เที่ยง(?:ตรง)?/g, ' ');
}

function cleanTitle(text: string, mode: 'normal' | 'finance' | 'followup' = 'normal'): string {
  let t = stripTemporal(normalizeText(text))
    .replace(/^(?:[-•*]|\d+[.)])\s*/, '')
    .replace(/(?:ทุกวันจนกว่า(?:จะ)?เสร็จ|ทุกวันจนเสร็จ|ทุกวัน|ทุกสัปดาห์|ทุกอาทิตย์|ทุกเดือน)/g, ' ')
    .replace(/(?:สำคัญที่สุด|สำคัญสุด|เป็นข้อหนึ่ง|เป็นอันดับหนึ่ง|ไม่รีบ|ทำก่อน|พักไว้ก่อน)/g, ' ')
    .replace(/(?:เตือนก่อน\s*\d+\s*ชั่วโมง)/g, ' ')
    .replace(/(?:นะ|หน่อย|ด้วย|ครับ)\s*$/g, ' ')
    .replace(/\s+/g, ' ').trim();
  if (mode === 'finance') {
    t = t.replace(/^(?:ต้อง)?(?:จ่าย|ชำระ)\s*/, '').trim();
    if (amountOutsideDateTime(text) !== null) t = t.replace(/(?:\s+|^)\d[\d,]*(?:\.\d+)?\s*(?:บาท|฿)?$/, '').trim();
  }
  if (mode === 'followup') t = t.replace(/^(?:ช่วย)?(?:เตือน|ตาม|ติดตาม)\s*/, '').trim();
  return t.slice(0, 160);
}

function amountOutsideDateTime(text: string): number | null {
  const monetary = normalizeText(text).match(/(\d[\d,]*(?:\.\d+)?)\s*(?:บาท|฿)/);
  if (monetary) return Number(monetary[1].replace(/,/g, ''));
  const stripped = stripTemporal(text);
  const amounts = findAmounts(stripped);
  return amounts.length ? amounts[0].value : null;
}

function recurrenceOf(text: string): Json | null {
  if (/ทุกวัน/.test(text)) return { freq: 'daily', interval: 1 };
  if (/(?:ทุกสัปดาห์|ทุกอาทิตย์)/.test(text)) return { freq: 'weekly', interval: 1 };
  if (/ทุกเดือน/.test(text)) return { freq: 'monthly', interval: 1 };
  return null;
}

function lineToItem(raw: string, index: number, today: string, inheritedDue: string | null): SecretaryItem | null {
  const text = normalizeText(raw.replace(/^(?:[-•*]|\d+[.)])\s*/, ''));
  if (!text || /^(?:เตือนและจัดให้ด้วย|จัดให้ด้วย|ฝากจัดให้ด้วย)$/.test(text)) return null;

  const explicitDate = parseSecretaryDate(text, today);
  const due = explicitDate ?? inheritedDue;
  const time = parseSecretaryTime(text);
  const followup = /(?:เตือน|ตาม|ติดตาม|เช็ก|ตรวจ).*(?:ทุกวัน.*(?:จน|จนกว่า).*(?:เสร็จ|จบ)|ทุกวันจน(?:กว่า)?เสร็จ)|ทุกวัน.*(?:จน|จนกว่า).*(?:เสร็จ|จบ)/.test(text);
  const priority = /(?:สำคัญที่สุด|สำคัญสุด|เป็นข้อหนึ่ง|เป็นอันดับหนึ่ง)/.test(text);
  const lowPriority = /(?:ไม่รีบ|ไว้ทีหลัง)/.test(text);
  const waiting = /(?:^|\s)(?:รอ|ติด)(?:\s|\S)/.test(text);
  const isGoal = /^(?:เป้าหมาย|goal)\s*/i.test(text);
  const moneyObligation = Boolean(due && /(?:ต้อง)?(?:จ่าย|ชำระ)|ค่าประกัน|ค่างวด|ค่าเช่า|ภาษี|ประกัน/.test(text)
    && !/(?:จ่ายแล้ว|ชำระแล้ว|ยังไม่จ่าย)/.test(text));
  const appointment = Boolean(due && !moneyObligation
    && (time || /(?:มีนัด|นัดกับ|ประชุม|พบ|บิน|เดินทาง|กรุงเทพ|เข้าเรียน|พรีเซนต์)/.test(text)));

  let kind: SecretaryItemKind = 'TASK';
  if (followup) kind = 'DAILY_FOLLOW_UP';
  else if (moneyObligation) kind = 'FINANCIAL_OBLIGATION';
  else if (appointment) kind = 'CALENDAR_EVENT';
  else if (isGoal) kind = 'GOAL';
  else if (waiting) kind = 'WAITING';
  else if (recurrenceOf(text)) kind = 'RECURRING_TASK';
  else if (due || /(?:กำหนดส่ง|เดดไลน์|deadline|ภายใน)/i.test(text)) kind = 'DEADLINE_TASK';

  let title = cleanTitle(text, kind === 'FINANCIAL_OBLIGATION' ? 'finance' : kind === 'DAILY_FOLLOW_UP' ? 'followup' : 'normal');
  if (isGoal) title = title.replace(/^(?:เป้าหมาย|goal)\s*[:：-]?\s*/i, '');
  if (waiting) title = title.split(/\s+(?:รอ|ติด)\s*/)[0].replace(/(?:ส่งแล้ว|ส่งไปแล้ว)\s*$/, '').trim() || title;
  if (!title) return null;

  const item: SecretaryItem = { kind, title, source_index: index };
  if (priority) { item.owner_priority = 100; item.priority = 'high'; item.priority_reason = 'เจ้าของกำหนดให้สำคัญที่สุด'; }
  if (lowPriority) { item.owner_priority = 0; item.priority_reason = 'เจ้าของระบุว่าไม่รีบ'; }

  if (kind === 'CALENDAR_EVENT') {
    if (!due) return null;
    item.start_at = `${due}T${time ?? '09:00'}:00+07:00`;
    item.category = /(?:กำหนดส่ง|deadline|เดดไลน์)/i.test(text) ? 'deadline' : /(?:นัด|ประชุม|พบ)/.test(text) ? 'meeting' : 'personal';
    if (recurrenceOf(text)) item.recurrence = recurrenceOf(text);
  } else if (kind === 'FINANCIAL_OBLIGATION') {
    if (!due) return null;
    item.due_date = due;
    item.amount = amountOutsideDateTime(text);
    item.money_kind = 'EXPENSE';
    item.frequency = /ทุกเดือน/.test(text) ? 'MONTHLY' : /(?:ทุกสัปดาห์|ทุกอาทิตย์)/.test(text) ? 'WEEKLY' : 'ONE_TIME';
  } else if (kind !== 'GOAL') {
    if (due) item.due_date = due;
    if (time) item.due_time = `${time}:00`;
    if (recurrenceOf(text)) item.recurrence = recurrenceOf(text);
    if (kind === 'DAILY_FOLLOW_UP') item.follow_up = true;
    if (kind === 'WAITING') {
      const wait = text.match(/(?:รอ|ติด)\s*(.+?)(?:นะ|ครับ)?$/);
      if (/ติด/.test(wait?.[0] ?? '')) { item.state = 'BLOCKED'; item.blocker = wait?.[1] ?? 'รอแก้ปัญหา'; }
      else { item.state = 'WAITING'; item.waiting_for = wait?.[1] ?? 'ข้อมูลจากคนอื่น'; }
    }
  } else if (due) item.due_date = due;
  return item;
}

/** Parses a natural 1–30 item dump.  Repeated/follow-up wording is left with
 * the same canonical key so Postgres attaches policy to the existing task. */
export function parseSecretaryBatch(raw: string, today: string): SecretaryParse {
  const physical = raw.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  const bulletCount = physical.filter(x => /^(?:[-•*]|\d+[.)])\s*/.test(x)).length;
  let inheritedDue: string | null = null;
  const body: string[] = [];
  for (const line of physical) {
    const clean = normalizeText(line);
    if (!/^(?:[-•*]|\d+[.)])\s*/.test(line) && /^(?:วันนี้|พรุ่งนี้|มะรืน)(?:มี|นี้)?\s*[:：]?$/.test(clean)) {
      inheritedDue = parseSecretaryDate(clean, today); continue;
    }
    if (!/^(?:[-•*]|\d+[.)])\s*/.test(line) && /^(?:อาทิตย์|สัปดาห์)นี้\s*[:：]?$/.test(clean)) {
      inheritedDue = endOfThisWeek(today); continue;
    }
    body.push(line);
  }

  const multi = bulletCount >= 2 || body.length >= 2;
  const clearSingle = body.length === 1 && /(?:เตือน|ต้องทำ|ทำ.*(?:วันนี้|พรุ่งนี้|ภายใน)|นัด|กำหนดส่ง|เป้าหมาย|ทุกวันจน|สำคัญสุด)/.test(body[0]);
  if (!multi && !clearSingle) return { items: [] };
  if (body.length > 30) return { items: [], error: 'too_many_items' };

  const items = body.map((line, i) => lineToItem(line, i + 1, today, inheritedDue)).filter((x): x is SecretaryItem => Boolean(x));
  return { items };
}

function keyOf(text: string): string {
  return normalizeText(text).toLowerCase()
    .replace(/(?:เตือน|ทุกวัน|จนกว่า(?:จะ)?เสร็จ|จนเสร็จ|ให้จบ|ให้เสร็จ|ทำก่อน|ทำ|เช็ก|ตรวจ|เรื่อง|รายงาน|งาน|นัด)/g, '')
    .replace(/[^a-z0-9ก-๙]+/g, '');
}

function contextIsFresh(context: Json | null | undefined, today?: string): boolean {
  if (context?.date && today && String(context.date).slice(0, 10) === today) return true;
  const value = context?.updated_at ? Date.parse(String(context.updated_at)) : NaN;
  return Number.isFinite(value) && Date.now() - value <= 48 * 3600_000;
}

function referenceNumber(text: string): number | null {
  const match = normalizeText(text).match(/ข้อ\s*(\d+|แรก|หนึ่ง|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า|สิบ)/);
  return match ? parseThaiNumber(match[1]) : null;
}

type Target = { id: string; title: string; type: 'task' | 'event'; start_time?: string; end_time?: string | null; waiting_for?: string | null };

function snapshotTargets(snapshot: Json, type: 'task' | 'event'): Target[] {
  if (type === 'event') return ((snapshot.events ?? []) as Json[]).map(e => ({
    id: String(e.id), title: String(e.title), type, start_time: String(e.start_time), end_time: e.end_time ? String(e.end_time) : null,
  }));
  const all = [...((snapshot.tasks ?? []) as Json[]), ...((snapshot.waiting ?? []) as Json[])];
  const seen = new Set<string>();
  return all.filter(t => !seen.has(String(t.id)) && seen.add(String(t.id))).map(t => ({
    id: String(t.id), title: String(t.title), type, waiting_for: t.waiting_for ? String(t.waiting_for) : null,
  }));
}

function titleHint(text: string): string | null {
  const cleaned = normalizeText(text)
    .replace(/ข้อ\s*(?:\d+|แรก|หนึ่ง|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า|สิบ)/g, ' ')
    .replace(TASK_DONE, ' ')
    .replace(/(?:วันนี้เอา|เอา|อันนี้|อันนั้น|เรื่องนี้|งานนี้|เมื่อกี้|เมื่อสักครู่|สำคัญที่สุด|สำคัญสุด|เป็นข้อหนึ่ง|เป็นอันดับหนึ่ง|ไม่รีบ|ไว้ทีหลัง|พักไว้ก่อน|พรุ่งนี้ค่อยทำ|ยกเลิก|เลื่อนไป.*|เปลี่ยนเป็น.*|หยุดเตือนทุกวัน|ไม่ต้องเตือนแล้ว|เตือนก่อน\s*\d+\s*ชั่วโมง)/g, ' ')
    .replace(/(?:ได้\s*\d{1,3}\s*%\s*แล้ว|เหลือ\s+.+|ยังไม่ได้เริ่ม|รอ\s+.+|ติด\s+.+|ส่งไปแล้ว|ส่ง\s+\S+\s+แล้ว)/g, ' ')
    .replace(/(?:นะ|หน่อย|ครับ)/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned || REFERENCE.test(cleaned)) return null;
  return cleaned.length >= 2 ? cleaned.slice(0, 100) : null;
}

function contextTarget(snapshot: Json, type: 'task' | 'event', n: number | null): Target | null {
  const context = snapshot.context as Json | null;
  if (!contextIsFresh(context, String(snapshot.today ?? ''))) return null;
  const batch: Json[] = Array.isArray(context?.last_batch)
    ? context!.last_batch as Json[]
    : Array.isArray(context?.items)
      ? (context!.items as Json[]).map(item => ({ ...item, type: 'task' } as Json))
      : [];
  const row: Json | null = n ? batch.find(x => Number(x.n) === n && x.type === type) ?? null
    : [...batch].reverse().find(x => x.type === type) ?? (context?.last_item_type === type && context.last_item_id ? {
      id: context.last_item_id, title: '', type,
    } : null);
  if (!row?.id) return null;
  // A reference can only resolve to a current, actionable row. A completed,
  // cancelled, archived, or otherwise absent row is stale and must not revive.
  return snapshotTargets(snapshot, type).find(x => x.id === String(row.id)) ?? null;
}

function resolveTarget(snapshot: Json, text: string, type: 'task' | 'event'): { target?: Target; ambiguous?: Target[]; stale?: boolean } {
  const n = referenceNumber(text);
  if (n) {
    const target = contextTarget(snapshot, type, n);
    return target ? { target } : { stale: true };
  }
  const hint = titleHint(text);
  const candidates = snapshotTargets(snapshot, type);
  if (hint) {
    const q = keyOf(hint);
    const hits = candidates.filter(x => {
      const k = keyOf(x.title);
      return k === q || (q.length >= 3 && (k.includes(q) || q.includes(k)));
    });
    if (hits.length === 1) return { target: hits[0] };
    if (hits.length > 1) return { ambiguous: hits };
  }
  const waitingMention = candidates.filter(x => x.waiting_for && normalizeText(text).includes(normalizeText(x.waiting_for)));
  if (waitingMention.length === 1) return { target: waitingMention[0] };
  if (REFERENCE.test(text)) {
    const contextual = contextTarget(snapshot, type, null);
    if (contextual) return { target: contextual };
    return { stale: true };
  }
  return {};
}

function resolutionReply(r: ReturnType<typeof resolveTarget>, noun: string): string {
  if (r.ambiguous?.length) return `หมายถึง${noun}ไหนครับ: ${r.ambiguous.slice(0, 4).map(x => `“${x.title}”`).join(' หรือ ')}`;
  if (r.stale) return `ผมไม่ใช้อ้างอิงเก่ามาเปลี่ยน${noun}ครับ ระบุชื่อ${noun}อีกนิดได้เลย`;
  return `หมายถึง${noun}ไหนครับ บอกชื่อสั้น ๆ ได้เลย ผมยังไม่ได้เปลี่ยนอะไร`;
}

function bangkokWall(iso: string): { date: string; time: string } {
  const shifted = new Date(new Date(iso).getTime() + 7 * 3600_000).toISOString();
  return { date: shifted.slice(0, 10), time: shifted.slice(11, 16) };
}

function localIso(date: string, time: string): string {
  return `${date}T${time}:00+07:00`;
}

async function handleEventCommand(c: SecretaryCtx, text: string, snapshot: Json): Promise<SecretaryOutcome> {
  const resolved = resolveTarget(snapshot, text, 'event');
  if (!resolved.target) return { reply: finalizeReply(resolutionReply(resolved, 'นัด')) };
  const event = resolved.target;
  const patch: Json = {};

  if (/ยกเลิก/.test(text)) patch.cancelled = true;
  if (/(?:ทำทุกวันแทน|เป็นทุกวัน)/.test(text)) patch.recurrence = { freq: 'daily', interval: 1 };
  if (/(?:หยุด.*ทุกวัน|ไม่ต้อง.*ทุกวัน)/.test(text)) patch.recurrence = null;

  if (event.start_time) {
    const old = bangkokWall(event.start_time);
    let date = parseSecretaryDate(text, c.today) ?? old.date;
    if (/(?:เป็น|ไป)(?:อาทิตย์|สัปดาห์)หน้า/.test(text)) date = addDays(old.date, 7);
    const time = parseSecretaryTime(text) ?? old.time;
    if (date !== old.date || time !== old.time) {
      patch.start_at = localIso(date, time);
      if (event.end_time) {
        const duration = new Date(event.end_time).getTime() - new Date(event.start_time).getTime();
        patch.end_at = new Date(new Date(patch.start_at).getTime() + Math.max(0, duration)).toISOString();
      }
    }
    const reminder = normalizeText(text).match(/เตือนก่อน\s*(\d{1,3})\s*ชั่วโมง/);
    if (reminder) patch.reminder_at = new Date(new Date(patch.start_at ?? event.start_time).getTime() - Number(reminder[1]) * 3600_000).toISOString();
  }
  if (!Object.keys(patch).length) return null;
  const result = await c.ledger.secretaryUpdateEvent(event.id, patch, c.actor, c.messageId, `${c.messageId}:event:${event.id}`);
  if (!result.ok) return { reply: finalizeReply('เปลี่ยนนัดไม่สำเร็จครับ ผมยังไม่ได้แก้ข้อมูล') };
  if (patch.cancelled) return { reply: finalizeReply(`ยกเลิก “${event.title}” แล้วครับ`) };
  if (patch.start_at) {
    const wall = bangkokWall(patch.start_at);
    return { reply: finalizeReply(`เลื่อน “${event.title}” เป็น ${thaiDate(wall.date)} เวลา ${wall.time} น. แล้วครับ`) };
  }
  if (patch.reminder_at) return { reply: finalizeReply(`ตั้งเตือน “${event.title}” ก่อน ${normalizeText(text).match(/\d{1,3}/)?.[0]} ชั่วโมงแล้วครับ`) };
  return { reply: finalizeReply(`อัปเดต “${event.title}” แล้วครับ`) };
}

async function updateTask(c: SecretaryCtx, text: string, snapshot: Json, patch: Json, success: (t: Target) => string): Promise<SecretaryOutcome> {
  const resolved = resolveTarget(snapshot, text, 'task');
  if (!resolved.target) return { reply: finalizeReply(resolutionReply(resolved, 'งาน')) };
  const result = await c.ledger.secretaryUpdateTask(resolved.target.id, patch, c.actor, c.messageId, `${c.messageId}:task:${resolved.target.id}`);
  if (!result.ok) return { reply: finalizeReply('อัปเดตงานไม่สำเร็จครับ ผมยังไม่ได้เปลี่ยนสถานะ') };
  return { reply: finalizeReply(success(resolved.target)) };
}

function uniqueResults(items: Array<{ kind: string; id: string; title: string; created: boolean }>): Array<{ kind: string; id: string; title: string; created: boolean }> {
  const map = new Map<string, { kind: string; id: string; title: string; created: boolean }>();
  for (const item of items) map.set(item.id, map.has(item.id) ? { ...map.get(item.id)!, created: map.get(item.id)!.created || item.created } : item);
  return [...map.values()];
}

/** Owner-only command entry point.  Returns null quickly for ordinary finance/chat turns. */
export async function handleSecretaryText(c: SecretaryCtx, raw: string): Promise<SecretaryOutcome> {
  const text = normalizeText(raw);
  const lines = raw.split(/\r?\n/).filter(x => x.trim());
  const hasCue = lines.length > 1 || /(?:งาน|นัด|ประชุม|เดดไลน์|กำหนดส่ง|เป้าหมาย|เสร็จ|จบแล้ว|ผ่านแล้ว|สำคัญ|ไม่รีบ|พรุ่งนี้ค่อย|พักไว้|รอ|ติด|ทุกวันจน|เตือน.*ทุกวัน|เหลือ\s+\S+|\d{1,3}\s*%|(?:ข้อมูล|ผล|คำตอบ|อนุมัติ).*(?:มาแล้ว|ได้แล้ว)|(?:คนอื่น|ทีม|ช่าง).*(?:ส่งกลับ|ตอบกลับ|เสร็จแล้ว))/i.test(text);
  const looksLikeBalance = /(?:ยอด)?จริง(?:ๆ)?\s*(?:เหลือ|คือ|อยู่ที่|เป็น)\s*[\d๐-๙,]+/.test(text)
    || (Boolean(knownAccountFromText(text)) && /(?:ยอด|เหลือ|คงเหลือ)\s*[\d๐-๙,]+/.test(text))
    || /^(?:(?:ตอนนี้|ยอด(?:คงเหลือ)?|คงเหลือ)\s*)?(?:เหลือ\s*)?[\d๐-๙][\d๐-๙,]*(?:\s*(?:บาท|฿))?$/.test(text);
  if (!hasCue || looksLikeBalance || (FINANCE_WORD.test(text) && !/(?:วันที่|กำหนด|งาน|นัด|เตือน.*ทุกวัน)/.test(text))) return null;
  if (!c.isOwner) return { reply: finalizeReply('เรื่องงานและตารางส่วนตัว เจ้าของกลุ่มเป็นผู้สั่งเปลี่ยนได้ครับ') };

  let snapshot: Json | null = null;
  const getSnapshot = async () => {
    if (snapshot) return snapshot;
    snapshot = await c.ledger.secretarySnapshot(c.actor, c.today);
    if (!contextIsFresh(snapshot.context as Json | null, c.today)) {
      const close = await c.ledger.dayCloseGet(c.today);
      if (close?.local_date && String(close.local_date).slice(0, 10) === c.today && close.context) {
        snapshot.context = close.context as Json;
      }
    }
    return snapshot;
  };

  if (/^ทำไม(?:อันนี้|งานนี้|ข้อ(?:หนึ่ง|แรก|\s*1))?(?:ถึง)?(?:เป็น)?อันดับหนึ่ง/.test(text)) {
    const top = ((await getSnapshot()).top_three ?? [])[0] as Json | undefined;
    return { reply: finalizeReply(top ? `“${top.title}” เป็นอันดับหนึ่ง เพราะ${top.reason}ครับ` : 'ตอนนี้ยังไม่มีงานพร้อมทำให้จัดอันดับครับ') };
  }

  const singleLine = lines.length === 1;
  const eventCommand = singleLine && /(?:เลื่อนไป|เปลี่ยนเป็น|ยกเลิก(?:นัด|ประชุม)|เป็นอาทิตย์หน้า|เป็นสัปดาห์หน้า|เตือนก่อน\s*\d+\s*ชั่วโมง|ทำทุกวันแทน)/.test(text);
  if (eventCommand) {
    const state = await getSnapshot();
    const eventTry = resolveTarget(state, text, 'event');
    if (eventTry.target || /(?:นัด|ประชุม|เตือนก่อน|เลื่อนไป|เปลี่ยนเป็น)/.test(text)) return handleEventCommand(c, text, state);
  }

  if (singleLine && /(?:หยุดเตือนทุกวัน|ไม่ต้องเตือนแล้ว|ไม่ต้องตามแล้ว)/.test(text)) {
    return updateTask(c, text, await getSnapshot(), { followup_active: false }, t => `หยุดติดตาม “${t.title}” แล้วครับ งานยังอยู่แต่จะไม่เตือนรายวัน`);
  }

  if (singleLine && TASK_DONE.test(text) && !/(?:จ่าย|ชำระ|โอน|เงิน|ยอด)/.test(text)) {
    const state = await getSnapshot();
    const resolved = resolveTarget(state, text, 'task');
    if (resolved.target || resolved.ambiguous || resolved.stale) {
      return updateTask(c, text, state, { state: 'DONE', progress: 100 }, t => `ปิดงาน “${t.title}” แล้วครับ และหยุดการติดตามอัตโนมัติแล้ว`);
    }
    return null;
  }

  if (singleLine && /(?:ข้อมูล|ผล|คำตอบ|อนุมัติ).*(?:มาแล้ว|ได้แล้ว)|(?:คนอื่น|claude|ทีม|ช่าง).*(?:ส่งกลับ|ตอบกลับ|เสร็จแล้ว)/i.test(text)) {
    return updateTask(c, text, await getSnapshot(), { state: 'IN_PROGRESS', waiting_for: null, blocker: null }, t => `“${t.title}” กลับมาทำต่อได้แล้วครับ ผมย้ายออกจากรายการรอแล้ว`);
  }

  if (singleLine && /(?:ได้\s*\d{1,3}\s*%\s*แล้ว|เหลือ\s+\S+|ส่งไปแล้ว|ส่ง\s+\S+\s+แล้ว|รอ\s+\S+|ติด\s+\S+|ยังไม่ได้เริ่ม)/.test(text)) {
    const percent = text.match(/ได้\s*(\d{1,3})\s*%/);
    const remaining = text.match(/เหลือ\s+(.+?)(?:นะ|ครับ)?$/);
    const wait = text.match(/รอ\s+(.+?)(?:นะ|ครับ)?$/);
    const blocked = text.match(/ติด\s+(.+?)(?:นะ|ครับ)?$/);
    const sent = text.match(/ส่ง\s*([^\s]+)?\s*แล้ว/);
    const patch: Json = {};
    if (/ยังไม่ได้เริ่ม/.test(text)) { patch.state = 'OPEN'; patch.progress = 0; }
    else if (blocked) { patch.state = 'BLOCKED'; patch.blocker = blocked[1]; }
    else if (wait || sent) { patch.state = 'WAITING'; patch.waiting_for = wait?.[1] ?? sent?.[1] ?? 'การตอบกลับ'; }
    else { patch.state = 'IN_PROGRESS'; }
    if (percent) patch.progress = Math.min(100, Number(percent[1]));
    if (remaining) patch.next_action = remaining[1].trim();
    return updateTask(c, text, await getSnapshot(), patch, t => {
      if (patch.state === 'WAITING') return `รับทราบครับ “${t.title}” อยู่ในสถานะรอ ${patch.waiting_for} ผมจะไม่ถามว่าเสร็จหรือยังซ้ำ ๆ`;
      if (patch.state === 'BLOCKED') return `รับทราบครับ “${t.title}” ติด ${patch.blocker} ผมแยกไว้เป็นงานติดขัดแล้ว`;
      if (patch.progress !== undefined) return `อัปเดต “${t.title}” เป็น ${patch.progress}% แล้วครับ`;
      if (patch.next_action) return `อัปเดต “${t.title}” แล้วครับ ขั้นต่อไปคือ ${patch.next_action}`;
      return `อัปเดต “${t.title}” แล้วครับ`;
    });
  }

  if (singleLine && /(?:วันนี้เอา.+ก่อน|สำคัญที่สุด|สำคัญสุด|เป็นข้อหนึ่ง|เป็นอันดับหนึ่ง|ไม่รีบ|ไว้ทีหลัง)/.test(text)) {
    const low = /(?:ไม่รีบ|ไว้ทีหลัง)/.test(text);
    return updateTask(c, text, await getSnapshot(), {
      owner_priority: low ? 0 : 100,
      priority_reason: low ? 'เจ้าของระบุว่าไม่รีบ' : 'เจ้าของกำหนดให้สำคัญที่สุด',
    }, t => low ? `ลดความเร่งด่วนของ “${t.title}” แล้วครับ` : `ตั้ง “${t.title}” เป็นงานสำคัญที่สุดแล้วครับ`);
  }

  if (singleLine && /(?:พรุ่งนี้ค่อยทำ|พักไว้ก่อน)/.test(text)) {
    const tomorrow = addDays(c.today, 1);
    return updateTask(c, text, await getSnapshot(), {
      state: 'SNOOZED', snoozed_until: `${tomorrow}T08:00:00+07:00`,
      ...(text.includes('พรุ่งนี้') ? { due_date: tomorrow } : {}),
    }, t => `พัก “${t.title}” ไว้ก่อนครับ${text.includes('พรุ่งนี้') ? ` ผมจะเอากลับมาวันที่ ${thaiDate(tomorrow)}` : ''}`);
  }

  if (singleLine && /(?:ยกเลิกงาน|ไม่ต้องทำแล้ว|ตัดงานนี้|^ยกเลิก$)/.test(text)) {
    return updateTask(c, text, await getSnapshot(), { state: 'CANCELLED' }, t => `ยกเลิกงาน “${t.title}” แล้วครับ`);
  }

  if (singleLine && /(?:เตือน|ติดตาม).*(?:ทุกวัน)|(?:ทุกวันจน(?:กว่า)?เสร็จ)/.test(text)) {
    const batch = parseSecretaryBatch(raw, c.today);
    if (batch.items.length) {
      const result = await c.ledger.secretaryApplyBatch(batch.items, c.actor, c.messageId, `${c.messageId}:batch`, c.today);
      const unique = uniqueResults(result.items);
      return { reply: finalizeReply(`ผูกการติดตามรายวันกับ “${unique[0]?.title ?? batch.items[0].title}” แล้วครับ ใช้งานเดิมเพียงรายการเดียว ไม่สร้างงานซ้ำ`) };
    }
  }

  const parsed = parseSecretaryBatch(raw, c.today);
  if (parsed.error === 'too_many_items') return { reply: finalizeReply('รับได้ครั้งละไม่เกิน 30 รายการครับ แบ่งส่งเป็นสองก้อนได้เลย ผมยังไม่ได้บันทึกอะไร') };
  if (!parsed.items.length) return null;

  const result = await c.ledger.secretaryApplyBatch(parsed.items, c.actor, c.messageId, `${c.messageId}:batch`, c.today);
  const unique = uniqueResults(result.items);
  const created = unique.filter(x => x.created).length;
  const updated = unique.length - created;
  const tasks = unique.filter(x => x.kind === 'task').length;
  const events = unique.filter(x => x.kind === 'event').length;
  const obligations = unique.filter(x => x.kind === 'obligation').length;
  const goals = unique.filter(x => x.kind === 'goal').length;
  const parts = [
    `จัดเข้าระบบแล้ว ${unique.length} รายการครับ${updated ? ` (${created} รายการใหม่ • อัปเดตของเดิม ${updated} รายการ)` : ''}`,
    [tasks ? `งาน ${tasks}` : '', events ? `นัด ${events}` : '', obligations ? `รายการเงินที่ถึงกำหนด ${obligations}` : '', goals ? `เป้าหมาย ${goals}` : ''].filter(Boolean).join(' • '),
  ].filter(Boolean);
  if (parsed.items.some(x => x.kind === 'DAILY_FOLLOW_UP')) parts.push('งานที่ให้ตามทุกวันถูกผูกกับงานเดิม ไม่ได้สร้างงานรายวันซ้ำครับ');
  return { reply: finalizeReply(parts.join('\n')) };
}
