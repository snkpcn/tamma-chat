// SNK MONEY x THONGTHAI -- conversational understanding.
//
// The interpreter only PROPOSES a structured intent.  It never touches a balance and never
// does arithmetic: amounts must literally appear in the owner's message, and the backend
// (Postgres engine) is the only thing that moves money.
//
//   1. deterministic rules first (cheap, predictable, fully tested)
//   2. LLM JSON fallback for finance-looking text the rules cannot place (injectable, capped
//      at "medium" confidence so a model-proposed write always asks for confirmation)

import {
  amountAppearsIn,
  extractAmount,
  findAccountMention,
  findAmounts,
  guessCategory,
  isCorrectionCue,
  isNegated,
  knownAccountFromText,
  nextDayOfMonth,
  normalizeText,
  resolveAccount,
  addDays,
  type FoundAmount,
  type PfAccount,
} from './_personal-finance-core';

export type Confidence = 'high' | 'medium' | 'low';
export type Frequency = 'ONE_TIME' | 'WEEKLY' | 'MONTHLY' | 'YEARLY' | 'CUSTOM_DAYS' | 'INSTALLMENT';
export type Horizon = 'today' | 'tomorrow' | 'this_week' | 'next_week' | 'this_month' | 'next_month' | 'days';
export type Period = 'today' | 'this_week' | 'this_month' | 'last_month';

export type PfIntent =
  | { kind: 'SET_BALANCE'; amount: number; accountHint: string | null; accountKind: string | null }
  | { kind: 'EXPENSE'; amount: number; accountHint: string | null; category: string | null; title: string | null; date: string | null }
  | { kind: 'INCOME'; amount: number; accountHint: string | null; category: string | null; title: string | null; date: string | null }
  | { kind: 'TRANSFER'; amount: number; fromHint: string | null; toHint: string | null }
  | {
      kind: 'CREATE_RECURRING'; title: string; direction: 'EXPENSE' | 'INCOME'; amount: number | null; frequency: Frequency;
      intervalDays: number | null; dayOfMonth: number | null; firstDue: string | null; installments: number | null;
      accountHint: string | null; category: string | null;
    }
  | { kind: 'MARK_PAID'; titleHint: string | null; accountHint: string | null; amount: number | null }
  | { kind: 'VOID_LAST' }
  | { kind: 'CORRECT_LAST'; amount: number }
  | { kind: 'CHANGE_CATEGORY_LAST'; category: string; from: string | null }
  | { kind: 'CHANGE_ACCOUNT_LAST'; accountHint: string }
  | { kind: 'QUERY_BALANCE'; accountHint: string | null }
  | { kind: 'QUERY_SUMMARY'; period: Period }
  | { kind: 'QUERY_UPCOMING'; horizon: Horizon; days: number | null }
  | { kind: 'QUERY_RECENT' }
  | { kind: 'QUERY_FORECAST'; horizon: Horizon; days: number | null }
  | { kind: 'CREATE_ACCOUNT'; name: string; accountKind: string | null }
  | { kind: 'CREATE_CATEGORY'; name: string }
  | { kind: 'SET_REMINDER_DAYS'; days: number[] }
  | { kind: 'BULK_VOID'; period: Period }
  | { kind: 'SET_BALANCES'; items: Array<{ name: string; amount: number }> }
  | { kind: 'OBLIGATION_REMINDERS'; titleHint: string | null; days: number[] }
  | { kind: 'OBLIGATION_SILENCE'; titleHint: string | null }
  | { kind: 'OBLIGATION_RESCHEDULE'; titleHint: string | null; dayOfMonth: number }
  | { kind: 'CHANGE_DATE_LAST'; date: string }
  | { kind: 'ACK_MORNING' }
  | { kind: 'HELP' }
  | { kind: 'NEGATED' }
  | { kind: 'UNSUPPORTED_BULK' }
  | { kind: 'UNCLEAR'; financeCue: boolean; hint?: string }
  | { kind: 'NONE' };

export type Interpretation = { intent: PfIntent; confidence: Confidence; source: 'rules' | 'llm' };

export type NluContext = {
  today: string;
  accounts: PfAccount[];
  hasLastTransaction: boolean;
};

const FINANCE_CUE = /(บาท|฿|เงิน|บัญชี|จ่าย|ชำระ|โอน|รายรับ|รายจ่าย|ยอด|เหลือ|ค่า[ก-๙]|ผ่อน|งวด|ประกัน|สลิป|ภาษี|ดอกเบี้ย|ออมสิน|scb|kbank|กสิกร|ไทยพาณิชย์)/i;

function result(intent: PfIntent, confidence: Confidence): Interpretation {
  return { intent, confidence, source: 'rules' };
}

function cleanTitle(raw: string): string {
  return raw
    .replace(/(?:เดือนหน้า|เดือนนี้|สัปดาห์หน้า|อาทิตย์หน้า|พรุ่งนี้|มะรืน|วันนี้|เมื่อวาน|เมื่อกี้)/g, ' ')
    .replace(/(?:ต้อง)?(?:จ่าย|ชำระ|โอน|ซื้อ|เสียเงิน|เสีย|ได้เงิน|ได้รับ|รับเงิน|ได้)(?:ให้)?/g, ' ')
    .replace(/(?:ทุก(?:วันที่|เดือน|สัปดาห์|อาทิตย์|ปี)?|รายเดือน|รายปี|รายสัปดาห์|ของทุกเดือน|ต่อเดือน)/g, ' ')
    .replace(/(?:จาก|ด้วย|ผ่าน|เข้า|ออกจาก)\s*\S+/g, ' ')
    .replace(/วันที่\s*\d+|\d[\d,]*(?:\.\d+)?|บาท|฿|แล้ว|อีก|งวด|วัน|เดือน|นะ|ครับ|จ้า|หน่อย|ด้วย|ให้/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleFrom(text: string): string | null {
  const t = normalizeText(text);
  const firstAmount = findAmounts(t)[0];
  const before = firstAmount ? t.slice(0, firstAmount.index) : t;
  const fromBefore = cleanTitle(before);
  if (fromBefore.length >= 2) return fromBefore.slice(0, 120);
  const after = firstAmount ? t.slice(firstAmount.end) : '';
  const fromAfter = cleanTitle(after);
  return fromAfter.length >= 2 ? fromAfter.slice(0, 120) : null;
}

function accountHintFromAction(text: string, accounts: PfAccount[]): string | null {
  const m = findAccountMention(text, accounts);
  if (m.kind === 'one') return m.account.name;
  const known = knownAccountFromText(text);
  if (known) return known.name;
  return null;
}

function parseHorizon(t: string): { horizon: Horizon; days: number | null } {
  const days = t.match(/(?:ใน|ภายใน|อีก)\s*(\d{1,3})\s*วัน/);
  if (days) return { horizon: 'days', days: Math.min(Number(days[1]), 120) };
  if (/(เดือนหน้า)/.test(t)) return { horizon: 'next_month', days: null };
  if (/(อาทิตย์หน้า|สัปดาห์หน้า)/.test(t)) return { horizon: 'next_week', days: null };
  if (/(อาทิตย์นี้|สัปดาห์นี้)/.test(t)) return { horizon: 'this_week', days: null };
  if (/(พรุ่งนี้)/.test(t)) return { horizon: 'tomorrow', days: null };
  if (/(วันนี้)/.test(t)) return { horizon: 'today', days: null };
  if (/(เดือนนี้|สิ้นเดือน|ปลายเดือน)/.test(t)) return { horizon: 'this_month', days: null };
  return { horizon: 'days', days: 14 };
}

function parsePeriod(t: string): Period {
  if (/(เดือนที่แล้ว|เดือนก่อน)/.test(t)) return 'last_month';
  if (/(อาทิตย์นี้|สัปดาห์นี้|อาทิตย์ที่แล้ว)/.test(t)) return 'this_week';
  if (/(วันนี้)/.test(t)) return 'today';
  return 'this_month';
}

/** Thai due-date phrases -> YYYY-MM-DD (or null when none is stated). */
export function parseDueDate(text: string, today: string): { date: string | null; dayOfMonth: number | null } {
  const t = normalizeText(text);
  const dom = t.match(/(?:ทุก)?วันที่\s*(\d{1,2})/);
  const slash = t.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (slash) {
    const d = Number(slash[1]);
    const m = Number(slash[2]);
    if (d >= 1 && d <= 31 && m >= 1 && m <= 12) {
      let y = Number(today.slice(0, 4));
      if (slash[3]) y = Number(slash[3]) > 2400 ? Number(slash[3]) - 543 : Number(slash[3]) < 100 ? 2000 + Number(slash[3]) : Number(slash[3]);
      let candidate = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (!slash[3] && candidate < today) candidate = `${y + 1}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      return { date: candidate, dayOfMonth: d };
    }
  }
  if (dom) {
    const day = Number(dom[1]);
    if (day >= 1 && day <= 31) {
      const next = /(เดือนหน้า)/.test(t);
      return { date: nextDayOfMonth(today, day, next), dayOfMonth: day };
    }
  }
  if (/(พรุ่งนี้)/.test(t)) return { date: addDays(today, 1), dayOfMonth: null };
  if (/(มะรืน)/.test(t)) return { date: addDays(today, 2), dayOfMonth: null };
  if (/(วันนี้)/.test(t)) return { date: today, dayOfMonth: null };
  if (/(สิ้นเดือน|ปลายเดือน)/.test(t)) return { date: nextDayOfMonth(today, 31), dayOfMonth: 31 };
  return { date: null, dayOfMonth: null };
}

function lastAmountAfter(t: string, amounts: FoundAmount[], word: RegExp): number | null {
  const m = word.exec(t);
  if (!m) return null;
  const after = amounts.find(a => a.index >= m.index);
  return after ? after.value : null;
}

function accountNameFromBalanceText(prefix: string): string | null {
  const name = normalizeText(prefix)
    .replace(/^(?:ปรับ|แก้|อัพเดต|อัปเดต|ตั้ง|แจ้ง|ยอด|เงิน)(?:\s+|$)/g, '')
    .replace(/(?:ตอนนี้|ล่าสุด|ปัจจุบัน|วันนี้)/g, ' ')
    .replace(/(?:^|\s)(?:ยอด|เงิน)\s*(?:ใน)?$/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return name.length ? name.slice(0, 80) : null;
}

const BALANCE_VERB = /(?:คงเหลือ|ยอดเหลือ|เหลือเงิน|เหลือ|มีเงินอยู่|มีเงิน|ยอดเงิน|ยอดบัญชี|ยอดคงเหลือ)/;

function relativeDate(word: string, today: string): string | null {
  const t = normalizeText(word);
  if (/เมื่อวานซืน/.test(t)) return addDays(today, -2);
  if (/เมื่อวาน/.test(t)) return addDays(today, -1);
  if (/วันนี้/.test(t)) return today;
  const dom = t.match(/วันที่\s*(\d{1,2})/);
  if (dom) {
    const day = Number(dom[1]);
    if (day < 1 || day > 31) return null;
    const [y, m, d] = today.split('-').map(Number);
    const pick = (yy: number, mm: number) => `${yy}-${String(mm).padStart(2, '0')}-${String(Math.min(day, new Date(Date.UTC(yy, mm, 0)).getUTCDate())).padStart(2, '0')}`;
    if (day <= d) return pick(y, m);
    return m === 1 ? pick(y - 1, 12) : pick(y, m - 1);
  }
  return null;
}

const DATE_WORD = '(?:เมื่อวานซืน|เมื่อวาน|วันนี้|วันที่\\s*\\d{1,2})';

function cleanObligationHint(raw: string): string | null {
  const v = normalizeText(raw)
    .replace(/(?:อันนี้|รายการนี้|ตัวนี้|อันนั้น|รายการนั้น|นี้|นะ|ครับ|ก็พอ|พอ|อีก|ให้|หน่อย)/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return v.length >= 2 ? v.slice(0, 80) : null;
}

function parseDayList(raw: string): number[] {
  return [...new Set(raw.split(/[,\s]+/).map(Number).filter(n => Number.isFinite(n) && n >= 0 && n <= 60))].sort((a, b) => b - a);
}

export function interpretWithRules(input: string, ctx: NluContext): Interpretation {
  const t = normalizeText(input);
  if (!t) return result({ kind: 'NONE' }, 'low');
  const amounts = findAmounts(t);
  const amount = amounts.length ? amounts[0].value : null;

  // -- meta / help ---------------------------------------------------------
  if (/(ช่วยอะไรได้บ้าง|ทำอะไรได้บ้าง|วิธีใช้|ใช้ยังไง|คำสั่งทั้งหมด|^help$|^เมนู$)/i.test(t)) return result({ kind: 'HELP' }, 'high');

  // -- high-risk bulk delete of a period (always confirmed by the dispatcher) -----------------------
  const bulk = t.match(/(?:ลบ|ยกเลิก|void)\s*(?:รายการ|ข้อมูล)?\s*ทั้งหมด\s*(เดือนนี้|เดือนที่แล้ว|เดือนก่อน|วันนี้|สัปดาห์นี้|อาทิตย์นี้)/i);
  if (bulk) return result({ kind: 'BULK_VOID', period: parsePeriod(bulk[1]) }, 'high');

  // -- initial setup of several balances in one message ---------------------------------------------
  if (/(?:ตั้ง)?ยอดเริ่มต้น|ตั้งยอด(?:บัญชี)?/.test(t) && amounts.length >= 2) {
    const body = normalizeText(t.replace(/(?:ตั้ง)?ยอดเริ่มต้น|ตั้งยอด(?:บัญชี)?/g, ' '));
    const found = findAmounts(body);
    const items: Array<{ name: string; amount: number }> = [];
    let cursor = 0;
    for (const a of found) {
      const name = body.slice(cursor, a.index).replace(/(?:และ|กับ|เหลือ|มี|เป็น|ที่|ตอนนี้|[,;:=])/g, ' ').replace(/\s+/g, ' ').trim();
      cursor = a.end + (/^\s*บาท/.test(body.slice(a.end)) ? body.slice(a.end).match(/^\s*บาท/)![0].length : 0);
      if (name) items.push({ name: name.slice(0, 80), amount: a.value });
    }
    if (items.length >= 2 && items.length === found.length) return result({ kind: 'SET_BALANCES', items }, 'high');
    return result({ kind: 'UNCLEAR', financeCue: true }, 'low');
  }

  // -- undo / corrections on the most recent record -------------------------
  if (/(?:ยกเลิก|ลบ|ย้อน|void)\s*(?:รายการ|อัน)?\s*ทั้งหมด|ล้างข้อมูล|ลบทุกอย่าง|reset/i.test(t)) return result({ kind: 'UNSUPPORTED_BULK' }, 'high');
  if (/(?:ยกเลิก|ลบ|ย้อน|void)\s*(?:รายการ|อัน)?\s*(?:ล่าสุด|เมื่อกี้|ที่แล้ว|ที่ลงไป|ที่ลงเมื่อกี้|สุดท้าย)/i.test(t)
      || /(?:เมื่อกี้|เมื่อสักครู่|เมื่อตะกี้)\s*ลงผิด/.test(t)) {
    return result({ kind: 'VOID_LAST' }, ctx.hasLastTransaction ? 'high' : 'medium');
  }

  const swap = t.match(/เปลี่ยน(?:หมวด)?(?:จาก)?\s*(.+?)\s*(?:เป็น|ไปเป็น)\s*(.+)$/);
  if (swap && !findAmounts(swap[2]).length) {
    const category = swap[2].replace(/(?:นะ|ครับ|จ้า|หน่อย)\s*$/g, '').trim();
    if (category) return result({ kind: 'CHANGE_CATEGORY_LAST', category: category.slice(0, 80), from: swap[1].trim().slice(0, 80) }, ctx.hasLastTransaction ? 'high' : 'medium');
  }

  // "ไม่ใช่ SCB เมื่อกี้จ่ายเงินสด" / "ไม่ได้จ่ายจาก SCB จ่ายเงินสด": the account AFTER the negated one wins
  const negAcct = t.match(/ไม่(?:ใช่|ได้(?:จ่าย|ตัด|หัก)?(?:จาก)?)\s*(\S+)(.*)$/);
  if (negAcct && !amounts.length) {
    const hint = accountHintFromAction(negAcct[2], ctx.accounts);
    const negated = accountHintFromAction(negAcct[1], ctx.accounts);
    if (hint && hint !== negated && ctx.hasLastTransaction) return result({ kind: 'CHANGE_ACCOUNT_LAST', accountHint: hint }, 'high');
  }
  // "เมื่อกี้ไม่ใช่ค่ารถ เป็นค่าประกัน" -> relabel (or re-account when both sides are accounts)
  const notX = t.match(/ไม่ใช่\s*(.+?)\s*เป็น\s*(.+)$/);
  if (notX && !amounts.length) {
    const to = notX[2].replace(/(?:นะ|ครับ|จ้า)\s*$/g, '').trim();
    const toAcct = accountHintFromAction(to, ctx.accounts);
    const fromAcct = accountHintFromAction(notX[1], ctx.accounts);
    if (toAcct && fromAcct) return result({ kind: 'CHANGE_ACCOUNT_LAST', accountHint: toAcct }, ctx.hasLastTransaction ? 'high' : 'medium');
    if (to) return result({ kind: 'CHANGE_CATEGORY_LAST', category: to.slice(0, 80), from: notX[1].trim().slice(0, 80) }, ctx.hasLastTransaction ? 'high' : 'medium');
  }
  // "เมื่อวานไม่ใช่วันนี้" -> the true date comes first
  const dateFix = t.match(new RegExp(`(${DATE_WORD})\\s*ไม่ใช่\\s*(${DATE_WORD})`));
  if (dateFix) {
    const d = relativeDate(dateFix[1], ctx.today);
    if (d) return result({ kind: 'CHANGE_DATE_LAST', date: d }, ctx.hasLastTransaction ? 'high' : 'medium');
  }
  const dateTo = t.match(new RegExp(`(?:ที่จริง|จริง ?ๆ)?(?:เป็น|ลง)\\s*(${DATE_WORD})`));
  if (dateTo && !amounts.length && /(?:ที่จริง|จริง ?ๆ|แก้|เปลี่ยน|ผิดวัน)/.test(t)) {
    const d = relativeDate(dateTo[1], ctx.today);
    if (d) return result({ kind: 'CHANGE_DATE_LAST', date: d }, ctx.hasLastTransaction ? 'high' : 'medium');
  }

  if (isCorrectionCue(t) && amounts.length) {
    const after = lastAmountAfter(t, amounts, /เป็น/);
    return result({ kind: 'CORRECT_LAST', amount: after ?? amounts[amounts.length - 1].value }, ctx.hasLastTransaction ? 'high' : 'medium');
  }
  if (isCorrectionCue(t) && !amounts.length) {
    const acct = accountHintFromAction(t, ctx.accounts);
    if (acct && /(?:จาก|เข้า|ออก|ตัด|บัญชี)/.test(t)) return result({ kind: 'CHANGE_ACCOUNT_LAST', accountHint: acct }, ctx.hasLastTransaction ? 'high' : 'medium');
  }

  // -- explicit negation: never records anything -----------------------------
  if (isNegated(t)) return result({ kind: 'NEGATED' }, 'high');

  // -- queries ---------------------------------------------------------------
  const questionish = /(เท่าไหร่|เท่าไร|กี่บาท|อะไรบ้าง|มีอะไร|ไหม|มั้ย|หรือเปล่า|หรือยัง|\?|บ้าง)/.test(t);
  if (!amount) {
    if (/(คาดการณ์|ประมาณการ|forecast|ถ้าจ่ายครบ|หลังจ่ายบิล|สิ้นเดือน.*(?:เหลือ|จะเหลือ)|จะเหลือ)/i.test(t)) {
      return result({ kind: 'QUERY_FORECAST', ...parseHorizon(t) }, 'high');
    }
    if (/(ต้องจ่าย|ต้องชำระ|ครบกำหนด|ใกล้ถึง|ถึงกำหนด|บิล|ต้องโอน|รายการที่ต้อง|ค้างจ่าย|ค้างชำระ)/.test(t) && (questionish || /ดู|ขอ|สรุป|เช็ค/.test(t))) {
      return result({ kind: 'QUERY_UPCOMING', ...parseHorizon(t) }, 'high');
    }
    if (/(รายการล่าสุด|ล่าสุดมีอะไร|ลงอะไรไป|ประวัติ|รายการวันนี้|ดูรายการ)/.test(t)) return result({ kind: 'QUERY_RECENT' }, 'high');
    if (/(หมดไป|จ่ายไป|ใช้ไป|ใช้จ่าย|รายจ่าย|รายรับ|รายได้|ได้เงินไป|สรุป(?:เดือน|สัปดาห์|วัน)?)/.test(t) && (questionish || /สรุป|ดู|ขอ/.test(t))) {
      return result({ kind: 'QUERY_SUMMARY', period: parsePeriod(t) }, 'high');
    }
    if (/(ยอด|เหลือ|มีเงิน)/.test(t) && questionish) {
      return result({ kind: 'QUERY_BALANCE', accountHint: accountHintFromAction(t, ctx.accounts) }, 'high');
    }
    if (/(เหลือเท่าไหร่|เหลือเท่าไร|ยอดเท่าไหร่|ยอดเท่าไร|มีเงินเท่าไหร่|มีเท่าไหร่|เช็คยอด|ดูยอด|ยอดคงเหลือ|ยอดเงิน|ยอดบัญชี|เหลือกี่บาท|ขอยอด)/.test(t)) {
      return result({ kind: 'QUERY_BALANCE', accountHint: accountHintFromAction(t, ctx.accounts) }, 'high');
    }
  }

  // -- reminders / structure ---------------------------------------------------
  if (/เตือนตอนเช้า|เตือนเช้า/.test(t)) return result({ kind: 'ACK_MORNING' }, 'high');
  const silence = t.match(/(?:ไม่ต้องเตือน|เลิกเตือน|หยุดเตือน|ปิดเตือน)(.*)$/);
  if (silence) return result({ kind: 'OBLIGATION_SILENCE', titleHint: cleanObligationHint(silence[1]) ?? cleanObligationHint(t.slice(0, silence.index)) }, 'high');
  const remind = t.match(/^(.*?)(?:แจ้ง)?เตือน(?:ก่อน|ล่วงหน้า)?\s*((?:\d{1,2}\s*[,\s]\s*)*\d{1,2})\s*วัน/);
  if (remind) {
    const days = parseDayList(remind[2]);
    const title = cleanObligationHint(remind[1].replace(/ตั้ง/g, ' '));
    if (days.length) return result(title ? { kind: 'OBLIGATION_REMINDERS', titleHint: title, days } : { kind: 'SET_REMINDER_DAYS', days }, 'high');
  }
  const move = t.match(/เลื่อน(.*?)(?:ไป|เป็น)?\s*(?:วันที่)\s*(\d{1,2})/);
  if (move && Number(move[2]) >= 1 && Number(move[2]) <= 31) {
    return result({ kind: 'OBLIGATION_RESCHEDULE', titleHint: cleanObligationHint(move[1].replace(/(?:ไป|เป็น)/g, ' ')), dayOfMonth: Number(move[2]) }, 'high');
  }
  const newAccount = t.match(/^(?:เพิ่ม|สร้าง|เปิด)\s*(?:บัญชี|กระเป๋า|กองทุน)\s*(.{1,60})$/);
  if (newAccount) {
    const known = knownAccountFromText(newAccount[1]);
    return result({ kind: 'CREATE_ACCOUNT', name: (known?.name ?? newAccount[1]).trim(), accountKind: known?.kind ?? null }, 'high');
  }
  const newCategory = t.match(/^(?:เพิ่ม|สร้าง)\s*หมวด(?:หมู่)?\s*(.{1,60})$/);
  if (newCategory) return result({ kind: 'CREATE_CATEGORY', name: newCategory[1].trim() }, 'high');

  // -- payment completion --------------------------------------------------------
  if (/(?:จ่าย|ชำระ|โอน)(?:เงิน)?(?:ให้)?[^\d]{0,40}?แล้ว|(?:จ่าย|ชำระ)เสร็จ|ชำระเรียบร้อย|จ่ายเรียบร้อย|จ่ายครบแล้ว/.test(t) && !/ยังไม่/.test(t)) {
    const acct = accountHintFromAction(t, ctx.accounts);
    const hint = cleanTitle(t.replace(/(?:จาก|ด้วย|ผ่าน|ตัด|เข้า)\s*\S+/g, ' ').replace(/(?:เรียบร้อย|เสร็จ|ครบ)/g, ' '));
    return result({ kind: 'MARK_PAID', titleHint: hint.length >= 2 ? hint.slice(0, 120) : null, accountHint: acct, amount }, 'high');
  }

  // -- owner states a balance -------------------------------------------------------
  const bal = BALANCE_VERB.exec(t);
  if (bal && amount !== null && !/(?:จ่าย|ซื้อ|ได้รับ|ได้เงิน|รับเงิน)/.test(t.slice(0, bal.index).replace(/ใช้จ่าย/g, ''))) {
    const afterVerb = amounts.find(a => a.index >= bal.index) ?? amounts[0];
    const name = accountNameFromBalanceText(t.slice(0, bal.index));
    const known = knownAccountFromText(name ?? t.slice(0, bal.index));
    return result({ kind: 'SET_BALANCE', amount: afterVerb.value, accountHint: known?.name ?? name, accountKind: known?.kind ?? null }, 'high');
  }
  const setTo = t.match(/^(?:ปรับ|แก้|อัพเดต|อัปเดต|ตั้ง)\s*(.+?)\s*(?:เป็น|ที่|=)\s*(?:\d)/);
  if (setTo && amount !== null) {
    const name = accountNameFromBalanceText(setTo[1]);
    const known = knownAccountFromText(name ?? '');
    return result({ kind: 'SET_BALANCE', amount: amounts[amounts.length - 1].value, accountHint: known?.name ?? name, accountKind: known?.kind ?? null }, 'high');
  }

  const nowStated = t.match(/^(.+?)\s*ตอนนี้\s*(?:อยู่ที่|ที่|=|มี)?\s*\d/);
  if (nowStated && amount !== null) {
    const hit = findAccountMention(nowStated[1], ctx.accounts);
    const known = knownAccountFromText(nowStated[1]);
    if (hit.kind === 'one' || known) {
      const name = hit.kind === 'one' ? hit.account.name : known!.name;
      return result({ kind: 'SET_BALANCE', amount: amounts[0].value, accountHint: name, accountKind: known?.kind ?? null }, 'high');
    }
  }

  // -- transfer between tracked accounts ---------------------------------------------
  const transfer = t.match(/โอน(?:เงิน)?\s*(?:จาก)?\s*(.+?)\s*(?:ไป(?:ที่|ยัง)?|เข้า|ให้)\s*(.+)$/);
  if (transfer && amount !== null) {
    const side = (s: string) => {
      const stripped = s.replace(/\d[\d,]*(?:\.\d+)?\s*(?:พัน|หมื่น|แสน|ล้าน|k)?\s*(?:บาท)?/gi, ' ').replace(/บัญชี|นะ|ครับ/g, ' ').trim();
      const m = resolveAccount(stripped, ctx.accounts);
      if (m.kind === 'one') return m.account.name;
      const k = knownAccountFromText(stripped);
      return k ? k.name : null;
    };
    const from = side(transfer[1]);
    const to = side(transfer[2]);
    if (from && to && from !== to) return result({ kind: 'TRANSFER', amount, fromHint: from, toHint: to }, 'high');
  }

  // -- recurring / due obligations ---------------------------------------------------------
  const dueCue = /(ต้องจ่าย|ต้องชำระ|ต้องโอน|ครบกำหนด|ถึงกำหนด|กำหนดจ่าย|กำหนดชำระ|เตือน(?!ล่วง))/.test(t);
  const everyN = t.match(/ทุก\s*(\d{1,3})\s*วัน/);
  const installments = t.match(/(\d{1,3})\s*งวด/);
  let frequency: Frequency | null = null;
  if (installments && /(ผ่อน|งวด)/.test(t)) frequency = 'INSTALLMENT';
  else if (everyN) frequency = 'CUSTOM_DAYS';
  else if (/(ทุกสัปดาห์|ทุกอาทิตย์|รายสัปดาห์)/.test(t)) frequency = 'WEEKLY';
  else if (/(ทุกปี|รายปี)/.test(t)) frequency = 'YEARLY';
  else if (/(ทุกเดือน|รายเดือน|ต่อเดือน|ทุกวันที่|ของทุกเดือน)/.test(t)) frequency = 'MONTHLY';
  if (frequency || (dueCue && parseDueDate(t, ctx.today).date)) {
    const due = parseDueDate(t, ctx.today);
    const title = titleFrom(t);
    const income = /(ได้รับ|รับเงิน|ได้เงิน|เงินเข้า|ค่าเช่าเข้า)/.test(t) && !dueCue;
    if (title && (amount !== null || frequency)) {
      return result({
        kind: 'CREATE_RECURRING', title, direction: income ? 'INCOME' : 'EXPENSE', amount,
        frequency: frequency ?? 'ONE_TIME', intervalDays: everyN ? Number(everyN[1]) : null,
        dayOfMonth: due.dayOfMonth, firstDue: due.date,
        installments: installments ? Number(installments[1]) : null,
        accountHint: accountHintFromAction(t, ctx.accounts), category: guessCategory(t),
      }, due.date ? 'high' : 'medium');
    }
  }

  // -- income ----------------------------------------------------------------------------------
  if (amount !== null && /(ได้เงิน|ได้รับ|รับเงิน|เงินเข้า|ได้ค่า|รายรับ|เงินเดือนเข้า|ปันผล|ดอกเบี้ย|ค่าเช่า(?:เข้า)?เข้า|โอนมา|ลูกค้าโอน|ได้\s)/.test(t)) {
    const dest = t.match(/(?:เข้า|ไปที่|เข้าบัญชี)\s*([^\s\d]+(?:\s?[A-Za-z+]+)?)/);
    const acct = accountHintFromAction(dest ? dest[0] : t, ctx.accounts) ?? accountHintFromAction(t, ctx.accounts);
    return result({
      kind: 'INCOME', amount, accountHint: acct, category: guessCategory(t) ?? 'รายได้อื่น ๆ',
      title: titleFrom(t), date: parseDueDate(t, ctx.today).date,
    }, 'high');
  }

  // -- expense -----------------------------------------------------------------------------------
  if (amount !== null && /(จ่าย|ซื้อ|เสียเงิน|เสีย|ชำระ|เติม|หมดไป|ใช้ไป|กิน|จ้าง|ค่า[ก-๙]|โอนค่า|ผ่อน|หัก|ตัดเงิน)/.test(t)) {
    const hasVerb = /(จ่าย|ซื้อ|เสียเงิน|ชำระ|เติม|หมดไป|ใช้ไป|กิน|จ้าง|โอนค่า|หัก|ตัดเงิน)/.test(t);
    return result({
      kind: 'EXPENSE', amount, accountHint: accountHintFromAction(t, ctx.accounts), category: guessCategory(t),
      title: titleFrom(t), date: parseDueDate(t, ctx.today).date,
    }, hasVerb ? 'high' : 'medium');
  }

  if (amount !== null) return result({ kind: 'UNCLEAR', financeCue: true, hint: 'amount_only' }, 'low');
  return result({ kind: 'UNCLEAR', financeCue: FINANCE_CUE.test(t) }, 'low');
}

// ---------------------------------------------------------------- LLM fallback

export type LlmInterpreter = (text: string, ctx: NluContext) => Promise<Record<string, unknown> | null>;

const LLM_KINDS = new Set([
  'SET_BALANCE', 'EXPENSE', 'INCOME', 'TRANSFER', 'MARK_PAID', 'QUERY_BALANCE', 'QUERY_SUMMARY', 'QUERY_UPCOMING', 'QUERY_RECENT', 'NONE',
]);

function str(value: unknown, max = 120): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
}

/**
 * Turns model output into a vetted intent or null.  Hard rules: only whitelisted kinds, any
 * amount must literally appear in the owner's message (the model cannot invent or compute one),
 * and the result is capped at "medium" so every model-proposed write asks first.
 */
export function validateLlmIntent(raw: Record<string, unknown> | null, text: string): Interpretation | null {
  if (!raw || typeof raw !== 'object') return null;
  const kind = String(raw.kind ?? '').toUpperCase();
  if (!LLM_KINDS.has(kind)) return null;
  const needsAmount = ['SET_BALANCE', 'EXPENSE', 'INCOME', 'TRANSFER'].includes(kind);
  const amount = typeof raw.amount === 'number' ? raw.amount : null;
  if (needsAmount && (amount === null || !amountAppearsIn(text, amount))) return null;
  if (!needsAmount && amount !== null && !amountAppearsIn(text, amount)) return null;
  const accountHint = str(raw.account, 80);
  const category = str(raw.category, 80);
  const title = str(raw.title);
  const wrap = (intent: PfIntent): Interpretation => ({ intent, confidence: 'medium', source: 'llm' });
  switch (kind) {
    case 'SET_BALANCE': return wrap({ kind: 'SET_BALANCE', amount: amount as number, accountHint, accountKind: null });
    case 'EXPENSE': return wrap({ kind: 'EXPENSE', amount: amount as number, accountHint, category, title, date: null });
    case 'INCOME': return wrap({ kind: 'INCOME', amount: amount as number, accountHint, category, title, date: null });
    case 'TRANSFER': {
      const from = str(raw.from_account, 80);
      const to = str(raw.to_account, 80);
      if (!from || !to || from === to) return null;
      return wrap({ kind: 'TRANSFER', amount: amount as number, fromHint: from, toHint: to });
    }
    case 'MARK_PAID': return wrap({ kind: 'MARK_PAID', titleHint: title, accountHint, amount });
    case 'QUERY_BALANCE': return wrap({ kind: 'QUERY_BALANCE', accountHint });
    case 'QUERY_SUMMARY': return wrap({ kind: 'QUERY_SUMMARY', period: 'this_month' });
    case 'QUERY_UPCOMING': return wrap({ kind: 'QUERY_UPCOMING', horizon: 'days', days: 14 });
    case 'QUERY_RECENT': return wrap({ kind: 'QUERY_RECENT' });
    default: return { intent: { kind: 'NONE' }, confidence: 'low', source: 'llm' };
  }
}

const LLM_INSTRUCTIONS = [
  'You turn ONE Thai message from a personal-finance chat into a JSON intent. You do not answer the user.',
  'Return JSON only: {"kind": SET_BALANCE|EXPENSE|INCOME|TRANSFER|MARK_PAID|QUERY_BALANCE|QUERY_SUMMARY|QUERY_UPCOMING|QUERY_RECENT|NONE,',
  '"amount": number|null, "account": string|null, "from_account": string|null, "to_account": string|null, "category": string|null, "title": string|null}.',
  'Rules: copy amounts exactly as written in the message; never compute, sum, estimate or infer a balance;',
  'if the message is negated ("ไม่ได้จ่าย", "ยังไม่จ่าย") or you are unsure, return {"kind":"NONE"}; never invent an account or a purpose.',
].join(' ');

/** Production LLM interpreter (OpenAI Responses API, JSON out).  Returns null on any failure. */
export const openAiInterpreter: LlmInterpreter = async (text, ctx) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: 'gpt-5.6-luna',
        instructions: LLM_INSTRUCTIONS,
        input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify({ message: text.slice(0, 600), known_accounts: ctx.accounts.map(a => a.name).slice(0, 20) }) }] }],
        reasoning: { effort: 'none' },
        max_output_tokens: 300,
        text: { format: { type: 'json_schema', name: 'pf_intent', strict: false, schema: { type: 'object' } } },
      }),
    });
    if (!response.ok) return null;
    const data = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
    let out = data.output_text ?? '';
    if (!out) for (const item of data.output ?? []) for (const part of item.content ?? []) if (part.type === 'output_text' && part.text) out += part.text;
    if (!out) return null;
    return JSON.parse(out.replace(/^```(?:json)?|```$/g, '').trim()) as Record<string, unknown>;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

export async function interpret(text: string, ctx: NluContext, llm: LlmInterpreter | null = openAiInterpreter): Promise<Interpretation> {
  const ruled = interpretWithRules(text, ctx);
  if (ruled.intent.kind !== 'UNCLEAR' || !llm) return ruled;
  if (!(ruled.intent.financeCue)) return ruled;
  try {
    const proposed = validateLlmIntent(await llm(text, ctx), normalizeText(text));
    if (proposed && proposed.intent.kind !== 'NONE') return proposed;
  } catch {
    // fall through to the clarification path
  }
  return ruled;
}

export { extractAmount };
