// SNK MONEY x THONGTHAI -- pure helpers (no I/O): money/date parsing, Thai negation,
// account matching, roles and persona-safe reply formatting.  Everything here is
// deterministic so it can be unit tested without a database or an LLM.

export type PfRole = 'OWNER' | 'AUTHORIZED_FINANCE_MEMBER' | 'UNAUTHORIZED_MEMBER';

export type PfAccount = {
  id: string;
  name: string;
  kind?: string;
  balance: number | string | null;
  balance_status: 'CONFIRMED' | 'DERIVED' | 'UNKNOWN';
  balance_confirmed_at?: string | null;
};

// ---------------------------------------------------------------- roles (fail closed)

function idList(value: string | undefined): Set<string> {
  return new Set((value ?? '').split(/[,\s]+/).map(v => v.trim()).filter(Boolean));
}

/** No configured owner id means nobody is an owner: the feature fails closed. */
export function pfRoleFor(userId: string | null | undefined, env: Record<string, string | undefined> = process.env): PfRole {
  const id = (userId ?? '').trim();
  if (!id) return 'UNAUTHORIZED_MEMBER';
  if (idList(env.PF_OWNER_LINE_USER_IDS).has(id)) return 'OWNER';
  if (idList(env.PF_FINANCE_MEMBER_LINE_USER_IDS).has(id)) return 'AUTHORIZED_FINANCE_MEMBER';
  return 'UNAUTHORIZED_MEMBER';
}

export function pfEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return /^(1|true|on|yes)$/i.test((env.SNK_MONEY_ENABLED ?? '').trim());
}

// ---------------------------------------------------------------- dates (Asia/Bangkok)

export function bangkokToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function monthStart(ymd: string): string {
  return `${ymd.slice(0, 7)}-01`;
}

export function monthEnd(ymd: string): string {
  const [y, m] = ymd.split('-').map(Number);
  return `${y}-${String(m).padStart(2, '0')}-${String(daysInMonth(y, m)).padStart(2, '0')}`;
}

export function previousMonthRange(ymd: string): { from: string; to: string } {
  const first = monthStart(ymd);
  const lastOfPrev = addDays(first, -1);
  return { from: monthStart(lastOfPrev), to: lastOfPrev };
}

/** weekday of a YYYY-MM-DD (0 = Sunday). */
export function weekday(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Monday-based week containing `ymd`. */
export function weekRange(ymd: string): { from: string; to: string } {
  const offset = (weekday(ymd) + 6) % 7;
  const from = addDays(ymd, -offset);
  return { from, to: addDays(from, 6) };
}

/** Next calendar date on/after `today` whose day-of-month is `dom` (clamped to the month length). */
export function nextDayOfMonth(today: string, dom: number, forceNextMonth = false): string {
  const [y, m, d] = today.split('-').map(Number);
  const pick = (yy: number, mm: number) => `${yy}-${String(mm).padStart(2, '0')}-${String(Math.min(dom, daysInMonth(yy, mm))).padStart(2, '0')}`;
  const thisMonth = pick(y, m);
  if (!forceNextMonth && Math.min(dom, daysInMonth(y, m)) >= d) return thisMonth;
  return m === 12 ? pick(y + 1, 1) : pick(y, m + 1);
}

// ---------------------------------------------------------------- text normalisation

const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';

export function normalizeText(text: string): string {
  return text
    .replace(/[๐-๙]/g, ch => String(THAI_DIGITS.indexOf(ch)))
    .replace(/[​‌‍﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------- amounts

export type FoundAmount = { value: number; index: number; end: number; raw: string };

const UNIT: Record<string, number> = { พัน: 1_000, หมื่น: 10_000, แสน: 100_000, ล้าน: 1_000_000, k: 1_000 };

/**
 * Money-looking numbers only.  Day-of-month ("วันที่ 5"), counts ("24 งวด", "ทุก 10 วัน"),
 * times and dates ("25/10") are not amounts.
 */
export function findAmounts(input: string): FoundAmount[] {
  const text = normalizeText(input);
  const out: FoundAmount[] = [];
  const re = /(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s*(พัน|หมื่น|แสน|ล้าน|[kK](?![A-Za-z]))?/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const before = text.slice(Math.max(0, match.index - 12), match.index);
    const after = text.slice(match.index + match[0].length, match.index + match[0].length + 8);
    const raw = match[0];
    if (/(?:วันที่|ทุกวันที่|งวดที่|ทุก|ภายใน|อีก)\s*$/.test(before) && !/^\s*(?:บาท|฿)/.test(after)) continue;
    if (/^\s*(?:วัน(?!ที่)|งวด|เดือน|ปี|สัปดาห์|อาทิตย์|ครั้ง|%|โมง|น\.|นาที|ชั่วโมง|:|\/)/.test(after) && !/^\s*(?:บาท)/.test(after)) continue;
    if (/[/:]\s*$/.test(before)) continue;
    const base = Number(`${match[1].replace(/,/g, '')}${match[2] ? '.' + match[2] : ''}`);
    const unit = match[3] ? UNIT[match[3].toLowerCase()] ?? UNIT[match[3]] : 1;
    const value = Math.round(base * unit * 100) / 100;
    if (!Number.isFinite(value) || value <= 0) continue;
    out.push({ value, index: match.index, end: match.index + raw.length, raw });
  }
  return out;
}

export function extractAmount(text: string): number | null {
  const found = findAmounts(text);
  return found.length ? found[0].value : null;
}

/** The amount the owner typed must literally be present: the LLM can never invent one. */
export function amountAppearsIn(text: string, amount: number): boolean {
  return findAmounts(text).some(a => Math.abs(a.value - amount) < 0.005);
}

// ---------------------------------------------------------------- negation / polarity

/** "ไม่ได้จ่ายประกัน", "ยังไม่จ่าย", "ยังไม่ได้โอน", "ไม่ต้องบันทึก", "อย่าลง" */
export function isNegated(text: string): boolean {
  const t = normalizeText(text);
  return /(?:ยัง)?ไม่(?:ได้)?\s*(?:จ่าย|ชำระ|โอน|ซื้อ|ได้รับ|รับ|ใช้|เสีย|ลง|บันทึก|หัก|ตัด)|อย่า\s*(?:ลง|บันทึก|จด|หัก|ตัด)|ไม่ต้อง(?:ลง|บันทึก|จด|หัก|ตัด)|ยังไม่(?:ถึง)?(?:ได้)?(?:จ่าย|ชำระ|โอน)|เอาไว้ก่อน|รอก่อน|ยังก่อน|ไม่ใช่(?:รายจ่าย|รายรับ|ค่าใช้จ่าย)/.test(t);
}

/** "ไม่ใช่ ...", "ไม่ถูก", "ผิด" -- the owner is rejecting the previous record, not creating a new one. */
export function isCorrectionCue(text: string): boolean {
  return /(?:ไม่ใช่|ไม่ถูก|ผิด|ที่จริง|จริง ?ๆ แล้ว|แก้เป็น|แก้ใหม่|ต้องเป็น)/.test(normalizeText(text));
}

export function isYes(text: string): boolean {
  return /^(?:ใช่|ใช่แล้ว|ตกลง|ยืนยัน|โอเค|ok|okay|yes|ถูกต้อง|ถูก)[\s!.ครับนะ]*$/i.test(normalizeText(text));
}

export function isNo(text: string): boolean {
  return /^(?:ไม่|ไม่ใช่|ไม่เอา|ไม่ต้อง|ยกเลิก|no|n|ไม่ครับ|ไม่ใช่ครับ|ไม่ต้องครับ|ช่างมัน|ปล่อยไว้)[\s!.ครับนะ]*$/i.test(normalizeText(text));
}

// ---------------------------------------------------------------- accounts

const ACCOUNT_ALIAS_GROUPS: Array<{ canonical: string; kind: string; aliases: string[] }> = [
  { canonical: 'SCB', kind: 'BANK', aliases: ['scb', 'ไทยพาณิชย์', 'เอสซีบี', 'scb easy'] },
  { canonical: 'KBank', kind: 'BANK', aliases: ['kbank', 'kasikorn', 'กสิกร', 'เคแบงก์', 'k plus', 'k+', 'kplus'] },
  { canonical: 'BBL', kind: 'BANK', aliases: ['bbl', 'bangkok bank', 'กรุงเทพ', 'ธนาคารกรุงเทพ'] },
  { canonical: 'KTB', kind: 'BANK', aliases: ['ktb', 'krungthai', 'กรุงไทย'] },
  { canonical: 'Krungsri', kind: 'BANK', aliases: ['krungsri', 'bay', 'กรุงศรี'] },
  { canonical: 'TTB', kind: 'BANK', aliases: ['ttb', 'ทีทีบี', 'ทหารไทย', 'ธนชาต'] },
  { canonical: 'GSB', kind: 'BANK', aliases: ['gsb', 'ออมสิน'] },
  { canonical: 'UOB', kind: 'BANK', aliases: ['uob', 'ยูโอบี'] },
  { canonical: 'เงินสด', kind: 'CASH', aliases: ['เงินสด', 'cash', 'กระเป๋าเงิน', 'เงินในกระเป๋า'] },
  { canonical: 'PromptPay', kind: 'WALLET', aliases: ['promptpay', 'พร้อมเพย์', 'truemoney', 'ทรูมันนี่', 'rabbit line pay'] },
];

function key(value: string): string {
  return normalizeText(value).toLowerCase().replace(/\s+/g, ' ');
}

function groupOf(value: string): (typeof ACCOUNT_ALIAS_GROUPS)[number] | null {
  const k = key(value);
  if (!k) return null;
  return ACCOUNT_ALIAS_GROUPS.find(g => g.aliases.some(a => key(a) === k) || key(g.canonical) === k) ?? null;
}

/** Bank / cash names the owner can mention without ever creating the account first. */
export function knownAccountFromText(text: string): { name: string; kind: string } | null {
  const t = key(text);
  for (const g of ACCOUNT_ALIAS_GROUPS) {
    for (const alias of g.aliases) {
      const a = key(alias);
      if (/^[a-z0-9+ ]+$/.test(a)) {
        const re = new RegExp(`(^|[^a-z0-9])${a.replace(/[+]/g, '\\+')}($|[^a-z0-9])`, 'i');
        if (re.test(t)) return { name: g.canonical, kind: g.kind };
      } else if (t.includes(a)) {
        return { name: g.canonical, kind: g.kind };
      }
    }
  }
  return null;
}

export type AccountMatch =
  | { kind: 'one'; account: PfAccount }
  | { kind: 'none' }
  | { kind: 'ambiguous'; candidates: PfAccount[] };

/** Matches a typed account hint to the tracked accounts: exact, alias group, then unique containment. */
export function resolveAccount(hint: string | null | undefined, accounts: PfAccount[]): AccountMatch {
  const q = key(hint ?? '');
  if (!q) return { kind: 'none' };
  const exact = accounts.filter(a => key(a.name) === q);
  if (exact.length === 1) return { kind: 'one', account: exact[0] };
  const qg = groupOf(q);
  if (qg) {
    const byGroup = accounts.filter(a => groupOf(a.name)?.canonical === qg.canonical || key(a.name).includes(key(qg.canonical)) || qg.aliases.some(al => key(a.name).includes(key(al))));
    if (byGroup.length === 1) return { kind: 'one', account: byGroup[0] };
    // an alias ("ไทยพาณิชย์") prefers the account literally named by the canonical name ("SCB")
    const canonical = byGroup.filter(a => key(a.name) === key(qg.canonical));
    if (canonical.length === 1) return { kind: 'one', account: canonical[0] };
    if (byGroup.length > 1) return { kind: 'ambiguous', candidates: byGroup };
  }
  const contains = accounts.filter(a => key(a.name).includes(q) || (q.length >= 3 && q.includes(key(a.name))));
  if (contains.length === 1) return { kind: 'one', account: contains[0] };
  if (contains.length > 1) return { kind: 'ambiguous', candidates: contains };
  return { kind: 'none' };
}

/** Which tracked account (if any) does a free-text message mention? */
export function findAccountMention(text: string, accounts: PfAccount[]): AccountMatch {
  const t = key(text);
  const hits = new Map<string, PfAccount>();
  for (const account of accounts) {
    const name = key(account.name);
    if (name && t.includes(name)) hits.set(account.id, account);
  }
  const known = knownAccountFromText(text);
  if (known) {
    const m = resolveAccount(known.name, accounts);
    if (m.kind === 'one') hits.set(m.account.id, m.account);
    if (m.kind === 'ambiguous') for (const c of m.candidates) hits.set(c.id, c);
  }
  const list = [...hits.values()];
  if (list.length === 1) return { kind: 'one', account: list[0] };
  if (list.length > 1) return { kind: 'ambiguous', candidates: list };
  return { kind: 'none' };
}

export function numberOrNull(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------- categories

const CATEGORY_KEYWORDS: Array<{ category: string; words: string[] }> = [
  { category: 'ประกัน', words: ['ประกัน'] },
  { category: 'ค่าน้ำมัน', words: ['น้ำมัน', 'เติมน้ำมัน', 'ปตท', 'บางจาก', 'shell'] },
  { category: 'ค่าน้ำ ค่าไฟ', words: ['ค่าไฟ', 'ค่าน้ำ', 'การไฟฟ้า', 'ประปา', 'ไฟฟ้า'] },
  { category: 'ค่าโทรศัพท์/อินเทอร์เน็ต', words: ['เน็ต', 'อินเทอร์เน็ต', 'wifi', 'ค่ามือถือ', 'ค่าโทร', 'ais', 'true', 'dtac'] },
  { category: 'ผ่อนชำระ', words: ['ผ่อน', 'งวด', 'สินเชื่อ'] },
  { category: 'ค่าอาหาร', words: ['อาหาร', 'ข้าว', 'กาแฟ', 'กิน', 'ร้านอาหาร', 'ชานม', 'เครื่องดื่ม', 'ขนม'] },
  { category: 'ค่าเดินทาง', words: ['เดินทาง', 'แท็กซี่', 'taxi', 'grab', 'bts', 'mrt', 'ทางด่วน', 'ค่ารถ', 'ตั๋ว', 'เครื่องบิน'] },
  { category: 'สุขภาพ', words: ['หมอ', 'ยา', 'โรงพยาบาล', 'ทันตกรรม', 'ตรวจสุขภาพ'] },
  { category: 'ของใช้ในบ้าน', words: ['ของใช้', 'ซูเปอร์', 'ซุปเปอร์', 'โลตัส', 'บิ๊กซี', 'makro'] },
  { category: 'บันเทิง', words: ['หนัง', 'เกม', 'netflix', 'spotify', 'ดูหนัง'] },
  { category: 'การศึกษา', words: ['ค่าเทอม', 'ค่าเรียน', 'คอร์ส', 'หนังสือ'] },
  { category: 'ภาษี', words: ['ภาษี'] },
  { category: 'ค่าเช่า', words: ['ค่าเช่า', 'ค่าห้อง'] },
  { category: 'เงินเดือน', words: ['เงินเดือน'] },
  { category: 'ปันผล/ดอกเบี้ย', words: ['ปันผล', 'ดอกเบี้ย'] },
];

export function guessCategory(text: string): string | null {
  const t = key(text);
  for (const entry of CATEGORY_KEYWORDS) {
    if (entry.words.some(w => t.includes(key(w)))) return entry.category;
  }
  return null;
}

// ---------------------------------------------------------------- persona-safe replies

/** Thongthai speaks as a male assistant: never ค่ะ/คะ, and a Thai reply closes with ครับ. */
export function finalizeReply(text: string): string {
  let out = text.replace(/ค่ะ/g, 'ครับ').replace(/คะ/g, 'ครับ').replace(/นะคะ/g, 'นะครับ').trim();
  if (!/ครับ[\s!.…]*$/.test(out) && /[฀-๿]/.test(out)) out = `${out}ครับ`;
  return out;
}

export function money(value: number | string | null | undefined): string {
  const n = numberOrNull(value);
  if (n === null) return 'ไม่ทราบ';
  return `${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} บาท`;
}

export function thaiDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  return `${d} ${months[m - 1]}`;
}

export function describeBalance(account: Pick<PfAccount, 'name' | 'balance' | 'balance_status'>): string {
  if (account.balance_status === 'UNKNOWN' || numberOrNull(account.balance) === null) {
    return `${account.name}: ยังไม่ทราบยอด (ยังไม่มียอดที่คุณยืนยัน)`;
  }
  const label = account.balance_status === 'CONFIRMED' ? 'ยอดที่คุณยืนยัน' : 'คำนวณจากยอดที่ยืนยัน + รายการที่บันทึก';
  return `${account.name}: ${money(account.balance)} (${label})`;
}

export const PF_CONFIRM_THRESHOLD = 1_000_000;
