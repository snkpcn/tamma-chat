// Zero-cost architecture: generic, reusable deterministic slot parsers for
// date/time/count, extracted from _restaurant-preorder-dialog.ts (which now
// imports these instead of keeping its own private copies) so every domain
// shares ONE parser instead of each domain growing its own phrase table.
// Pure, synchronous, no I/O, no LLM call -- safe to run on every turn.

const THAI_NUMBER: Record<string, number> = {
  'หนึ่ง': 1, 'สอง': 2, 'สาม': 3, 'สี่': 4, 'ห้า': 5, 'หก': 6, 'เจ็ด': 7, 'แปด': 8, 'เก้า': 9, 'สิบ': 10,
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

export function extractDate(message: string, now: Date = new Date()): string | null {
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

function thaiNumberToken(token: string): number | null {
  if (/^\d{1,2}$/.test(token)) return Number(token);
  return THAI_NUMBER[token] ?? null;
}

export function extractTime(message: string): string | null {
  const explicit = message.match(/(?:^|\s)([01]?\d|2[0-3])[:.](\d{2})(?=$|\s|น\.?)/u);
  if (explicit) return `${String(Number(explicit[1])).padStart(2,'0')}:${explicit[2]}`;

  if (/เที่ยงครึ่ง/u.test(message)) return '12:30';
  if (/เที่ยง/u.test(message)) return '12:00';

  const afternoon = message.match(/บ่าย\s*(หนึ่ง|สอง|สาม|สี่|ห้า|\d{1,2})(?:\s*โมง)?/u);
  if (afternoon) {
    const hour = thaiNumberToken(afternoon[1]);
    if (hour != null && hour >= 1 && hour <= 5) return `${String(hour + 12).padStart(2,'0')}:00`;
  }

  const evening = message.match(/(หนึ่ง|สอง|สาม|สี่|ห้า|\d{1,2})\s*ทุ่ม/u);
  if (evening) {
    const hour = thaiNumberToken(evening[1]);
    if (hour != null && hour >= 1 && hour <= 5) return `${String(hour + 18).padStart(2,'0')}:00`;
  }

  const oclock = message.match(/(?:^|\s)([01]?\d|2[0-3])\s*(?:โมง|นาฬิกา)(?=$|\s)/u);
  if (oclock) return `${String(Number(oclock[1])).padStart(2,'0')}:00`;
  return null;
}

/** "สองคน" / "2 คน" / "3ท่าน" -> a party size. Never matches a bare number
 *  with no person-counting unit, to avoid misreading an unrelated number
 *  (a price, a phone digit) as a headcount. */
export function extractPartySize(message: string): number | null {
  const match = message.match(/(หนึ่ง|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า|สิบ|\d{1,2})\s*(?:คน|ท่าน)/u);
  if (!match) return null;
  const count = thaiNumberToken(match[1]);
  return count != null && count >= 1 && count <= 50 ? count : null;
}

/** A customer explicitly correcting an already-given value ("จริง ๆ สามคน",
 *  "ไม่ใช่ เอาพรุ่งนี้", "แก้เป็นบ่ายสี่") rather than answering a fresh
 *  question. Detection is structural (a small, closed set of correction
 *  markers), never a growing table of full phrases. */
export function hasCorrectionMarker(message: string): boolean {
  return /จริง\s*ๆ|ไม่ใช่|แก้เป็น|เปลี่ยนเป็น|ขอแก้/u.test(message);
}

/** A customer explicitly signalling "commit this now" ("จองเลย", "ยืนยันจอง",
 *  "สั่งเลย") rather than merely stating a slot value. This is a small,
 *  closed safety marker, not a growing phrase table: it exists purely so a
 *  zero-LLM slot-fill parser can recognize "this message is trying to do
 *  more than I can safely interpret" and defer (return null) instead of
 *  silently dropping the commit intent by only extracting the slot value. */
export function hasCommitMarker(message: string): boolean {
  return /จองเลย|ยืนยันจอง|สั่งเลย|ยืนยันการจอง|ยืนยันการสั่ง/u.test(message);
}
