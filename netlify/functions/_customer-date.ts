/** A calendar date the way a customer reads it, not "2026-10-22".
 *
 *  Thai: "พรุ่งนี้ (พฤ. 22 ต.ค.)", "พฤ. 22 ต.ค."; English: "tomorrow
 *  (Thu 22 Oct)", "Thu 22 Oct". Today, tomorrow and the day after are named
 *  relative to the Bangkok calendar day. A value that is not a YYYY-MM-DD
 *  date is returned unchanged, so callers can pass whatever they hold. */

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/u;
const DAY_MS = 86_400_000;
// Fixed tables: ICU's Thai short weekday ("พฤหัส") is not the customary "พฤ.".
const TH_WEEKDAYS = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const EN_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function bangkokToday(now: Date): number {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(now).split('-').map(Number);
  return Date.UTC(y!, m! - 1, d!);
}

export function formatCustomerDate(value: string, language: string = 'th', now: Date = new Date()): string {
  const match = ISO_DATE_RE.exec(value.trim());
  if (!match) return value;
  const day = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (!Number.isFinite(day)) return value;
  const en = language === 'en';
  // Formatted in UTC: `day` is the calendar date at UTC midnight.
  const at = new Date(day);
  const label = en
    ? `${EN_WEEKDAYS[at.getUTCDay()]} ${at.getUTCDate()} ${EN_MONTHS[at.getUTCMonth()]}`
    : `${TH_WEEKDAYS[at.getUTCDay()]} ${at.getUTCDate()} ${TH_MONTHS[at.getUTCMonth()]}`;
  const offset = Math.round((day - bangkokToday(now)) / DAY_MS);
  const relative = en
    ? ({ 0: 'today', 1: 'tomorrow', 2: 'the day after tomorrow' } as Record<number, string>)[offset]
    : ({ 0: 'วันนี้', 1: 'พรุ่งนี้', 2: 'มะรืนนี้' } as Record<number, string>)[offset];
  return relative ? `${relative} (${label})` : label;
}
