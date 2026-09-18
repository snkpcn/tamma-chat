export type RestaurantSetItem = { name: string; quantity: number };

export type RestaurantPreorderDraft = {
  date: string | null;
  time: string | null;
  customerName: string | null;
  phone: string | null;
  email: string | null;
  acceptedAt: string;
};

export type RestaurantProposedSetState = {
  source?: string;
  items: RestaurantSetItem[];
  total?: number;
  budget?: number | null;
  partySize?: number | null;
  createdAt?: string;
  preorderDraft?: RestaurantPreorderDraft;
};

export type ParsedRestaurantPreorderTurn = {
  date: string | null;
  time: string | null;
  customerName: string | null;
  phone: string | null;
  email: string | null;
};

const THAI_NUMBER: Record<string, number> = {
  'หนึ่ง': 1, 'สอง': 2, 'สาม': 3, 'สี่': 4, 'ห้า': 5, 'หก': 6,
};

function bangkokDate(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const value = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function addBangkokDays(date: string, days: number): string {
  const base = new Date(`${date}T12:00:00+07:00`);
  const shifted = new Date(base.getTime() + days * 86_400_000);
  return bangkokDate(shifted);
}

function validDate(year: number, month: number, day: number): string | null {
  if (year > 2400) year -= 543;
  if (year < 2000 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const value = `${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  const parsed = new Date(`${value}T12:00:00+07:00`);
  return bangkokDate(parsed) === value ? value : null;
}

function extractDate(message: string, now: Date): string | null {
  const today = bangkokDate(now);
  if (/มะรืน/u.test(message)) return addBangkokDays(today, 2);
  if (/พรุ่งนี้/u.test(message)) return addBangkokDays(today, 1);
  if (/วันนี้/u.test(message)) return today;

  const iso = message.match(/\b(20\d{2}|25\d{2})-(\d{1,2})-(\d{1,2})\b/u);
  if (iso) return validDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const slash = message.match(/(?:^|\s)(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?(?=$|\s)/u);
  if (slash) {
    const currentYear = Number(today.slice(0,4));
    let year = slash[3] ? Number(slash[3]) : currentYear;
    if (year < 100) year += 2000;
    return validDate(year, Number(slash[2]), Number(slash[1]));
  }
  return null;
}

function thaiHourToken(token: string): number | null {
  if (/^\d{1,2}$/.test(token)) return Number(token);
  return THAI_NUMBER[token] ?? null;
}

function extractTime(message: string): string | null {
  const explicit = message.match(/(?:^|\s)([01]?\d|2[0-3])[:.](\d{2})(?=$|\s|น\.?)/u);
  if (explicit) return `${String(Number(explicit[1])).padStart(2,'0')}:${explicit[2]}`;

  if (/เที่ยงครึ่ง/u.test(message)) return '12:30';
  if (/เที่ยง/u.test(message)) return '12:00';

  const afternoon = message.match(/บ่าย\s*(หนึ่ง|สอง|สาม|สี่|ห้า|\d{1,2})(?:\s*โมง)?/u);
  if (afternoon) {
    const hour = thaiHourToken(afternoon[1]);
    if (hour != null && hour >= 1 && hour <= 5) return `${String(hour + 12).padStart(2,'0')}:00`;
  }

  const evening = message.match(/(หนึ่ง|สอง|สาม|สี่|ห้า|\d{1,2})\s*ทุ่ม/u);
  if (evening) {
    const hour = thaiHourToken(evening[1]);
    if (hour != null && hour >= 1 && hour <= 5) return `${String(hour + 18).padStart(2,'0')}:00`;
  }

  const oclock = message.match(/(?:^|\s)([01]?\d|2[0-3])\s*(?:โมง|นาฬิกา)(?=$|\s)/u);
  if (oclock) return `${String(Number(oclock[1])).padStart(2,'0')}:00`;
  return null;
}

function normalizePhone(raw: string): string | null {
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('66') && digits.length >= 11) digits = `0${digits.slice(2)}`;
  return /^0\d{8,9}$/.test(digits) ? digits : null;
}

function extractPhone(message: string): string | null {
  const match = message.match(/(?:\+?66|0)[\d\s-]{8,13}/u);
  return match ? normalizePhone(match[0]) : null;
}

function extractEmail(message: string): string | null {
  const match = message.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu);
  return match?.[0].toLowerCase() ?? null;
}

function stripKnownFields(message: string): string {
  return message
    .replace(/(?:\+?66|0)[\d\s-]{8,13}/gu, ' ')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, ' ')
    .replace(/\b(?:20\d{2}|25\d{2})-\d{1,2}-\d{1,2}\b/gu, ' ')
    .replace(/(?:^|\s)\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?(?=$|\s)/gu, ' ')
    .replace(/(?:^|\s)(?:[01]?\d|2[0-3])[:.]\d{2}(?=$|\s|น\.?)/gu, ' ')
    .replace(/(?:เอา(?:ชุด|เซ็ต)นี้|เอาชุดเมื่อกี้|ชุดเมื่อกี้|เอาตามนี้|ตามนี้|โอเค(?:ชุด|เซ็ต)นี้|ตกลง(?:ชุด|เซ็ต)นี้|จัด(?:ชุด|เซ็ต)นี้|ชุดนี้เลย|เอาโปรนี้|ใช้โปรนี้|รับโปรนี้|เอาสิทธิ์นี้|รับสิทธิ์นี้|รับโปรโมชันนี้|รับโปรโมชั่นนี้|เอาโปรโมชันนี้|เอาโปรโมชั่นนี้|โอเค|พรุ่งนี้|วันนี้|มะรืน|เวลา|รับอาหาร|รับ|ตอน|ประมาณ|ชื่อผู้สั่ง|ชื่อลูกค้า|ผมชื่อ|ฉันชื่อ|ชื่อ)/gu, ' ')
    .replace(/(?:บ่าย\s*(?:หนึ่ง|สอง|สาม|สี่|ห้า|\d{1,2})(?:\s*โมง)?|(?:หนึ่ง|สอง|สาม|สี่|ห้า|\d{1,2})\s*ทุ่ม|เที่ยงครึ่ง|เที่ยง|(?:[01]?\d|2[0-3])\s*(?:โมง|นาฬิกา))/gu, ' ')
    .replace(/[,:;|•·]+/g, ' ')
    // \b relies on \w, which Thai characters never match -- so a bare "\bค่ะ\b"
    // never actually strips an isolated Thai politeness word. Match against
    // whitespace/string boundaries instead.
    .replace(/(?:^|\s)(?:ครับ|ค่ะ|คะ|จ้า|จ้ะ)(?=\s|$)/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractName(message: string, allowLoose: boolean): string | null {
  const explicit = message.match(/(?:ชื่อผู้สั่ง|ชื่อลูกค้า|ผมชื่อ|ฉันชื่อ|ชื่อ)\s*([^\d,;|]{1,60}?)(?=\s*(?:\+?66|0\d|$))/u);
  if (explicit) {
    const value = explicit[1].replace(/(?:^|\s)(?:ครับ|ค่ะ|คะ)(?=\s|$)/gu,' ').trim();
    return value || null;
  }
  if (!allowLoose) return null;
  const residual = stripKnownFields(message);
  if (!residual || residual.length > 60) return null;
  if (/(บาท|เมนู|อาหาร|เผ็ด|ไม่เอา|แพ้|งบ|เพิ่ม|ลด|เปลี่ยน|ยกเลิก|ไม่สั่ง)/u.test(residual)) return null;
  return residual;
}

export function parseRestaurantPreorderTurn(
  message: string,
  current: Partial<RestaurantPreorderDraft> = {},
  now = new Date(),
): ParsedRestaurantPreorderTurn {
  const phone = extractPhone(message);
  const email = extractEmail(message);
  const date = extractDate(message, now);
  const time = extractTime(message);
  const allowLooseName = !current.customerName && message.trim().length <= 80;
  const customerName = extractName(message, allowLooseName);
  return { date, time, customerName, phone, email };
}

export function mergeRestaurantPreorderDraft(
  previous: RestaurantPreorderDraft | undefined,
  parsed: ParsedRestaurantPreorderTurn,
  now = new Date(),
): RestaurantPreorderDraft {
  return {
    date: parsed.date ?? previous?.date ?? null,
    time: parsed.time ?? previous?.time ?? null,
    customerName: parsed.customerName ?? previous?.customerName ?? null,
    phone: parsed.phone ?? previous?.phone ?? null,
    email: parsed.email ?? previous?.email ?? null,
    acceptedAt: previous?.acceptedAt ?? now.toISOString(),
  };
}

export function missingRestaurantPreorderFields(draft: RestaurantPreorderDraft): Array<'date'|'time'|'customerName'> {
  const missing: Array<'date'|'time'|'customerName'> = [];
  if (!draft.date) missing.push('date');
  if (!draft.time) missing.push('time');
  if (!draft.customerName) missing.push('customerName');
  return missing;
}

function formatPickupDate(date: string): string {
  const parsed = new Date(`${date}T12:00:00+07:00`);
  if (Number.isNaN(parsed.valueOf())) return date;
  return new Intl.DateTimeFormat('th-TH', {
    timeZone:'Asia/Bangkok', day:'numeric', month:'short',
  }).format(parsed);
}

export function formatRestaurantSetPrompt(set: RestaurantProposedSetState, draft: RestaurantPreorderDraft): string {
  const missing = missingRestaurantPreorderFields(draft);
  const lines = ['🍽️ รับชุดนี้ครับ'];
  if (typeof set.total === 'number' && Number.isFinite(set.total)) lines.push(`💰 ${Math.round(set.total)} บาท`);
  if (draft.date && draft.time) lines.push(`🕑 ${formatPickupDate(draft.date)} · ${draft.time}`);
  lines.push('');

  if (missing.includes('date') || missing.includes('time')) {
    lines.push('ขอวัน + เวลารับอาหารครับ');
    lines.push('เช่น “พรุ่งนี้ 14:00”');
  } else if (missing.includes('customerName')) {
    lines.push('ขอชื่อผู้สั่งครับ');
    lines.push('พิมพ์ชื่อได้เลย เช่น “นุ๊ก”');
  }
  return lines.join('\n');
}

export function clearRestaurantPreorderDraft(set: RestaurantProposedSetState): RestaurantProposedSetState {
  const { preorderDraft: _draft, ...rest } = set;
  return rest;
}
