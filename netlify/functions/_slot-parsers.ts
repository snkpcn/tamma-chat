// Zero-cost architecture: generic, reusable deterministic slot parsers for
// date/time/count, extracted from _restaurant-preorder-dialog.ts (which now
// imports these instead of keeping its own private copies) so every domain
// shares ONE parser instead of each domain growing its own phrase table.
// Pure, synchronous, no I/O, no LLM call -- safe to run on every turn.

const THAI_NUMBER: Record<string, number> = {
  'หนึ่ง': 1, 'สอง': 2, 'สาม': 3, 'สี่': 4, 'ห้า': 5, 'หก': 6, 'เจ็ด': 7, 'แปด': 8, 'เก้า': 9, 'สิบ': 10,
};

// Full names before their abbreviations so a longer match is never cut short
// by an earlier, shorter alternative in the regex built from this map's keys.
const THAI_MONTH: Record<string, number> = {
  'มกราคม': 1, 'ม.ค.': 1, 'กุมภาพันธ์': 2, 'ก.พ.': 2, 'มีนาคม': 3, 'มี.ค.': 3,
  'เมษายน': 4, 'เม.ย.': 4, 'พฤษภาคม': 5, 'พ.ค.': 5, 'มิถุนายน': 6, 'มิ.ย.': 6,
  'กรกฎาคม': 7, 'ก.ค.': 7, 'สิงหาคม': 8, 'ส.ค.': 8, 'กันยายน': 9, 'ก.ย.': 9,
  'ตุลาคม': 10, 'ต.ค.': 10, 'พฤศจิกายน': 11, 'พ.ย.': 11, 'ธันวาคม': 12, 'ธ.ค.': 12,
};
const THAI_MONTH_PATTERN = new RegExp(
  `(?:^|\\s)(\\d{1,2})\\s*(${Object.keys(THAI_MONTH).map(name => name.replace(/\./gu, '\\.')).join('|')})\\s*(\\d{2,4})?(?=$|\\s)`,
  'u',
);

/** A structural checkout label used to distinguish an explicitly supplied
 * checkout date from a check-in/general date while a Stay task is active. */
export function hasExplicitCheckoutDateMarker(message: string): boolean {
  return /เช(?:็ก|็ค)เอ(?:า|้า)?(?:ต์|ท์)|check[\s-]?out/iu.test(message);
}

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

  // "3 ตุลาคม" / "3 ต.ค." / "3 ตุลาคม 2569" -- a day + Thai month NAME,
  // distinct from the slash/ISO forms above. validDate already normalizes a
  // Buddhist-era year (>2400), so an explicit year here needs no extra
  // conversion before being passed through.
  const thaiMonth = message.match(THAI_MONTH_PATTERN);
  if (thaiMonth) {
    const day = Number(thaiMonth[1]);
    const month = THAI_MONTH[thaiMonth[2]!]!;
    const currentYear = Number(today.slice(0,4));
    let year = thaiMonth[3] ? Number(thaiMonth[3]) : currentYear;
    if (year < 100) year += 2000;
    const resolved = validDate(year, month, day);
    // A bare day+month with no year, already past this year (e.g. asking
    // for "3 ตุลาคม" in November), means next year -- never a date in the
    // customer's past.
    if (resolved && !thaiMonth[3] && resolved < today) {
      return validDate(year + 1, month, day);
    }
    return resolved;
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

  // "บ่ายโมง" (no number at all between บ่าย and โมง) is standard colloquial
  // Thai for 1pm specifically -- the "one" is grammatically implied/omitted
  // before โมง, unlike every other afternoon hour which always states its
  // number ("บ่ายสองโมง"). Checked before the general pattern below so that
  // one doesn't need a number to match.
  if (/บ่ายโมง/u.test(message)) return '13:00';

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
  return /จริง\s*ๆ|ไม่ใช่|แก้เป็น|เปลี่ยน(?:[^,\n]{0,24})?เป็น|เปลี่ยนใจ|ขอแก้/u.test(message);
}

/** A customer explicitly signalling "commit this now" ("จองเลย", "ยืนยันจอง",
 *  "สั่งเลย") rather than merely stating a slot value. This is a small,
 *  closed safety marker, not a growing phrase table: it exists purely so a
 *  zero-LLM slot-fill parser can recognize "this message is trying to do
 *  more than I can safely interpret" and defer (return null) instead of
 *  silently dropping the commit intent by only extracting the slot value. */
const COMMIT_MARKER_RE = /จอง(?:จริง)?เลย|ส่งจองจริง|ยืนยัน(?:การ)?จอง|สั่งเลย|ยืนยัน(?:การ)?สั่ง(?:ซื้อ)?|ส่งเข้าระบบ(?:เลย)?|ส่งคำขอ(?:จอง|สั่ง)?(?:จริง)?/gu;
// A commit phrase immediately preceded by a negation ("ไม่ต้องจองเลย", "ยัง
// ไม่ยืนยันจอง") is being explicitly DECLINED, not requested -- the bare
// substring match above alone would misread "don't book it at all" as an
// explicit commit, exactly inverted from what the customer said. Same
// structural before-the-match negation check the asset/entity name
// matchers in _deterministic-semantic-turn.ts already use.
const NEGATED_BEFORE_COMMIT_RE = /(?:ไม่ต้อง|ไม่ได้|ไม่เอา|ไม่)\s*$/u;

function lastCommitMarkerIndex(message: string): number {
  let match: RegExpExecArray | null;
  let last = -1;
  COMMIT_MARKER_RE.lastIndex = 0;
  while ((match = COMMIT_MARKER_RE.exec(message))) {
    const before = message.slice(Math.max(0, match.index - 12), match.index);
    if (!NEGATED_BEFORE_COMMIT_RE.test(before)) last = Math.max(last, match.index);
  }
  return last;
}

export function hasCommitMarker(message: string): boolean {
  return lastCommitMarkerIndex(message) >= 0;
}

const TRANSACTION_QUESTION_MARKER_RE =
  /[?？]|ไหม|ไหน|มั้ย|หรือเปล่า|รึเปล่า|ยังไง|อย่างไร|เมื่อไหร่|เมื่อไร|กี่โมง|เท่าไหร่|เท่าไร/u;

const NEGATED_TRANSACTION_MENTION_RE =
  /(?:ยัง\s*)?(?:ไม่ได้(?:คิดจะ|คิด|จะ|ให้)?|ไม่(?:ได้|ต้อง|เอา|อยาก|จะ)?)\s*(?:ยืนยัน(?:การ)?)?\s*(?:จอง|สั่ง)/gu;
const NEGATED_BEFORE_TRANSACTION_VERB_RE =
  /(?:ยัง\s*)?(?:ไม่ได้(?:คิดจะ|คิด|จะ|ให้)?|ไม่(?:ได้|ต้อง|เอา|อยาก|จะ)?)\s*(?:ยืนยัน(?:การ)?)?\s*$/u;

function transactionVerbIsInsideProhibition(message:string,index:number):boolean {
  const prefix=message.slice(Math.max(0,index-64),index);
  const boundaries=[
    prefix.lastIndexOf('แต่'),
    prefix.lastIndexOf('แล้ว'),
    prefix.lastIndexOf('จากนั้น'),
    prefix.lastIndexOf(','),
    prefix.lastIndexOf('，'),
    prefix.lastIndexOf(';'),
    prefix.lastIndexOf('\n'),
    prefix.lastIndexOf('.'),
    prefix.lastIndexOf('!'),
    prefix.lastIndexOf('?'),
    prefix.lastIndexOf('？'),
  ];
  const boundary=Math.max(...boundaries);
  const clause=prefix.slice(boundary+1);
  return /ห้าม[^\n,.!?？;]{0,48}$/u.test(clause);
}
// State-navigation wording must be adjacent to the transaction verb. The old
// broad `(?:จอง|สั่ง).*ต่อ` shape also matched the `ต่อ` inside `ติดต่อ`,
// incorrectly stripping consent from a cafe request such as "สั่งกาแฟ แล้ว
// ให้ทีมติดต่อกลับ".
const RESUME_TRANSACTION_RE = /กลับ.*(?:จอง|สั่ง)|(?:จอง|สั่ง)(?:\s|รายการ)*ต่อ(?:$|\s|ครับ|ค่ะ|นะ)/u;

function lastAffirmativeTransactionVerbIndex(message: string): number {
  let last = lastCommitMarkerIndex(message);
  for (const match of message.matchAll(/จอง|สั่ง/gu)) {
    const index = match.index ?? -1;
    if (index < 0) continue;
    const before = message.slice(Math.max(0, index - 24), index);
    if (NEGATED_BEFORE_TRANSACTION_VERB_RE.test(before)
        || transactionVerbIsInsideProhibition(message,index)) continue;

    const around = message.slice(Math.max(0, index - 16), Math.min(message.length, index + 24));
    // Returning to an unfinished transaction conversation is state navigation,
    // not a fresh write authorization.
    if (RESUME_TRANSACTION_RE.test(around)) continue;

    const after = message.slice(index, Math.min(message.length, index + 40));
    if (TRANSACTION_QUESTION_MARKER_RE.test(after)) continue;
    last = Math.max(last, index);
  }
  return last;
}

/** Closed safety vocabulary for explicitly withholding/revoking transaction
 * consent. This does not infer a business intent; it only answers the
 * dangerous yes/no question "did the CURRENT text explicitly say not to
 * book/order yet?". Shared by semantic reconciliation and deterministic
 * provider-outage fallback so both enforce the same transaction boundary. */
function lastNoTransactionMarkerIndex(message: string): number {
  let last = -1;
  for (const match of message.matchAll(NEGATED_TRANSACTION_MENTION_RE)) {
    last = Math.max(last, match.index ?? -1);
  }
  for (const match of message.matchAll(/ห้าม[^\n,.!?？;]{0,48}(?:ยืนยัน|จอง|สั่ง|ทำรายการ)/gu)) {
    last = Math.max(last, match.index ?? -1);
  }
  for (const match of message.matchAll(/ไว้ก่อน/gu)) {
    const index = match.index ?? -1;
    if (index < 0) continue;
    const before = message.slice(Math.max(0, index - 40), index);
    // Affirmative "จอง...ไว้ก่อน" / "สั่ง...ไว้ก่อน" in the same short
    // clause is a transaction request, e.g. "จองม้าไว้ก่อน".
    const verbIndex = Math.max(before.lastIndexOf('จอง'), before.lastIndexOf('สั่ง'));
    const affirmativeHold = verbIndex >= 0
      && /(?:จอง|สั่ง)[^\n.!?？]{0,32}$/u.test(before)
      && !NEGATED_BEFORE_TRANSACTION_VERB_RE.test(before.slice(0, verbIndex));
    if (affirmativeHold) continue;
    last = Math.max(last, index);
  }
  return last;
}

export function hasExplicitNoTransactionMarker(message: string): boolean {
  const withheldAt = lastNoTransactionMarkerIndex(message);
  if (withheldAt < 0) return false;
  // Same-turn self-corrections are ordered: the latest meaningful signal wins.
  // "ไม่จองอันนี้ แต่จองอีกอัน" commits to the later alternative;
  // "จองเลย ... ยังไม่จอง" revokes the earlier commitment.
  return withheldAt > lastAffirmativeTransactionVerbIndex(message);
}

/** A CURRENT-turn transaction request that is safe to use as write
 * authorization in deterministic paths. Questions, explicit withholding,
 * and "return to the unfinished booking/order" task-control language are
 * never treated as fresh consent. */
export function hasStandaloneTransactionRequest(message: string): boolean {
  // Explicit CURRENT withholding wins over any earlier commit phrase.
  if (hasExplicitNoTransactionMarker(message)) return false;
  if (hasCommitMarker(message)) return true;
  if (!/(?:จอง|สั่ง)/u.test(message)) return false;
  if (RESUME_TRANSACTION_RE.test(message)) return false;
  if (TRANSACTION_QUESTION_MARKER_RE.test(message)) return false;
  return true;
}

/** A customer explicitly asking to cancel/abandon whatever is in progress
 *  ("ยกเลิกก่อน", "ไม่เอาแล้ว"). A small, closed marker, not a phrase table. */
export function hasCancelMarker(message: string): boolean {
  return /ยกเลิก|ไม่เอาแล้ว|ไม่จองแล้ว|ไม่สั่งแล้ว/u.test(message);
}

/** "60 นาที" / "90 นาที" -> a duration in minutes, bounded to a plausible
 *  activity-duration range so an unrelated number (a price, a headcount)
 *  is never misread as a duration. */
export function extractDurationMinutes(message: string): number | null {
  const match = message.match(/(\d{1,3})\s*นาที/u);
  if (!match) return null;
  const minutes = Number(match[1]);
  return minutes >= 5 && minutes <= 600 ? minutes : null;
}

/** Parse a compact Thai stay range such as "17-18 ตุลาคม 2569".  The two
 * dates are normalized through extractDate, so Buddhist-year conversion and
 * calendar validation stay in one place. */
export function extractDateRange(
  message: string,
  now: Date = new Date(),
): { date: string; endDate: string } | null {
  const range = message.match(
    /(?:^|\s)(\d{1,2})\s*(?:-|–|—|ถึง)\s*(\d{1,2})\s*(มกราคม|ม\.ค\.|กุมภาพันธ์|ก\.พ\.|มีนาคม|มี\.ค\.|เมษายน|เม\.ย\.|พฤษภาคม|พ\.ค\.|มิถุนายน|มิ\.ย\.|กรกฎาคม|ก\.ค\.|สิงหาคม|ส\.ค\.|กันยายน|ก\.ย\.|ตุลาคม|ต\.ค\.|พฤศจิกายน|พ\.ย\.|ธันวาคม|ธ\.ค\.)\s*(\d{2,4})?(?=$|\s|[,，])/u,
  );
  if (!range) return null;
  const suffix = `${range[3]}${range[4] ? ` ${range[4]}` : ''}`;
  const date = extractDate(`${range[1]} ${suffix}`, now);
  const endDate = extractDate(`${range[2]} ${suffix}`, now);
  return date && endDate && endDate > date ? { date, endDate } : null;
}
