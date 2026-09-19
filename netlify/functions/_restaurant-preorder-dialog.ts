import { extractDate, extractTime } from './_slot-parsers';

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

export function missingRestaurantPreorderFields(draft: RestaurantPreorderDraft): Array<'date'|'time'|'customerName'|'phone'> {
  const missing: Array<'date'|'time'|'customerName'|'phone'> = [];
  if (!draft.date) missing.push('date');
  if (!draft.time) missing.push('time');
  if (!draft.customerName) missing.push('customerName');
  if (!draft.phone) missing.push('phone');
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
  } else if (missing.includes('customerName') || missing.includes('phone')) {
    lines.push('ขอชื่อผู้สั่ง + เบอร์โทรครับ');
    lines.push('เช่น “นุ๊ก 0610169999”');
  }
  return lines.join('\n');
}

export function clearRestaurantPreorderDraft(set: RestaurantProposedSetState): RestaurantProposedSetState {
  const { preorderDraft: _draft, ...rest } = set;
  return rest;
}
