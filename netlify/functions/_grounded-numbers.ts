/** Numbers in a model-written reply must come from what the model was given.
 *
 *  The grounded composer already rejects a fact key it was not supplied, but
 *  the sentence itself was unchecked: "ขี่ม้า 30 นาที 350 บาท" passes with
 *  the real usedFactKeys and a price nobody stored. This reads the numeric
 *  claims a customer acts on -- money, clock times, durations, percentages --
 *  and returns those that appear neither in the supplied facts nor in the
 *  customer's own words. A computed figure (a total, a converted time) is
 *  not in the facts and is reported too: the caller falls back to the
 *  deterministic renderer rather than trust arithmetic it cannot verify. */

const MONEY_RE = /(?:฿\s*(\d[\d,]*(?:\.\d+)?))|(\d[\d,]*(?:\.\d+)?)\s*(?:บาท|thb|baht|฿)/giu;
const PERCENT_RE = /(\d+(?:\.\d+)?)\s*(?:%|เปอร์เซ็นต์|percent)/giu;
const DURATION_RE = /(\d+(?:\.\d+)?)\s*(?:นาที|ชั่วโมง|ชม\.|minutes?|mins?|hours?|hrs?)(?![a-z])/giu;
// "10:00", or "10.00 น." -- a bare "1.30" is too ambiguous to read as a time.
const CLOCK_RE = /(?<![\d.:])([01]?\d|2[0-3])(?::([0-5]\d)|\.([0-5]\d)\s*(?:น\.|นาฬิกา))/gu;
const ISO_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/gu;

export type NumericClaim = { kind: 'money' | 'percent' | 'duration' | 'time'; text: string; value: string };

const plain = (value: string) => {
  const n = Number(value.replace(/,/gu, ''));
  return Number.isFinite(n) ? String(n) : value;
};
const clock = (hour: string, minute: string) => `${Number(hour)}:${minute}`;

export function numericClaims(message: string): NumericClaim[] {
  const claims: NumericClaim[] = [];
  for (const m of message.matchAll(MONEY_RE)) claims.push({ kind: 'money', text: m[0], value: plain(m[1] ?? m[2]!) });
  for (const m of message.matchAll(PERCENT_RE)) claims.push({ kind: 'percent', text: m[0], value: plain(m[1]!) });
  for (const m of message.matchAll(DURATION_RE)) claims.push({ kind: 'duration', text: m[0], value: plain(m[1]!) });
  for (const m of message.matchAll(CLOCK_RE)) claims.push({ kind: 'time', text: m[0], value: clock(m[1]!, m[2] ?? m[3]!) });
  return claims;
}

/** Every number and clock time a value carries, however deeply nested. */
function collect(value: unknown, numbers: Set<string>, times: Set<string>, depth = 0): void {
  if (depth > 16 || value == null) return;
  if (typeof value === 'number') { if (Number.isFinite(value)) numbers.add(String(value)); return; }
  if (typeof value === 'string') {
    // A timestamp (alone or inside a fact key) grounds its Bangkok local time
    // only -- never "10" or "22" as a price or a percentage.
    const rest = value.replace(ISO_RE, iso => {
      const at = new Date(iso);
      if (Number.isFinite(at.getTime())) {
        const local = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false }).format(at);
        const [h, m] = local.split(':');
        times.add(clock(h!, m!));
      }
      return ' ';
    });
    for (const m of rest.matchAll(/(\d{1,2}):([0-5]\d)/gu)) times.add(clock(m[1]!, m[2]!));
    for (const m of rest.matchAll(/\d[\d,]*(?:\.\d+)?/gu)) numbers.add(plain(m[0]));
    return;
  }
  if (Array.isArray(value)) { for (const item of value) collect(item, numbers, times, depth + 1); return; }
  if (typeof value === 'object') for (const item of Object.values(value as Record<string, unknown>)) collect(item, numbers, times, depth + 1);
}

export function ungroundedNumericClaims(
  message: string,
  supplied: { facts: unknown[]; customerText: string[] },
): NumericClaim[] {
  const claims = numericClaims(message);
  if (!claims.length) return [];
  const numbers = new Set<string>();
  const times = new Set<string>();
  for (const fact of supplied.facts) collect(fact, numbers, times);
  for (const text of supplied.customerText) collect(text, numbers, times);
  return claims.filter(claim => {
    if (claim.kind === 'time') return !times.has(claim.value);
    if (numbers.has(claim.value)) return false;
    // "1 ชั่วโมง" is grounded by a stored 60-minute option, and back.
    if (claim.kind === 'duration') {
      const n = Number(claim.value);
      const asHours = /ชั่วโมง|ชม\.|hour|hr/iu.test(claim.text);
      return !numbers.has(String(asHours ? n * 60 : n / 60));
    }
    return true;
  });
}
