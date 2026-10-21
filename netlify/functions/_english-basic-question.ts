/** Basic English questions answered from live data, without the model.
 *
 *  "What activities do you have?", "How much is horse riding?", "What's on
 *  the menu?" and "What time do you open?" reached the semantic call and
 *  the legacy brain -- two paid calls -- because every deterministic reader
 *  is Thai. Their Thai equivalents were measured on both channels to be
 *  answered from the backend with zero model calls.
 *
 *  A closed set of English question shapes is therefore read as the Thai
 *  question it is, and the turn keeps language 'en': the responders that
 *  answer these four topics render their English form from the same data.
 *  Anything outside these shapes -- a booking, a second question, "today",
 *  a named unit -- returns null and keeps the normal path. */

export type EnglishBasicTopic = 'activities' | 'activity_price' | 'menu' | 'hours' | 'unit_hours';
export type EnglishBasicQuestion = { topic: EnglishBasicTopic; canonical: string };

const ACTIVITIES_CANONICAL = 'มีกิจกรรมอะไรบ้าง';
export const ENGLISH_MENU_CANONICAL = 'มีเมนูอะไรแนะนำบ้าง';
const HOURS_CANONICAL = 'เปิดกี่โมง';

/** The activities in the ecosystem graph, by the Thai name the deterministic
 *  reader knows. */
const ACTIVITY_NAMES: ReadonlyArray<[RegExp, string]> = [
  [/\bhorse(?:\s*(?:back\s*)?riding|\s*ride|s)?\b|\bhorseback(?:\s*riding)?\b/u, 'ขี่ม้า'],
  [/\batvs?\b|\bquad\s*bikes?\b/u, 'ATV'],
  [/\barchery\b/u, 'ยิงธนู'],
  [/\b(?:pedal|duck|swan)\s*boats?\b/u, 'ปั่นเป็ดน้ำ'],
];

/** Shapes that are not a single read-only question. */
const NOT_BASIC = /\b(?:book|booking|reserve|reservation|order|cancel|pay|payment|refund|discount|cheaper|promo(?:tion)?s?|today|tonight|tomorrow|now|and|or|also)\b|\d/u;

const ACTIVITIES_RE = /^(?:so\s+|ok(?:ay)?\s+|and\s+)?(?:what|which)\s+(?:kinds?\s+of\s+|sorts?\s+of\s+)?(?:activities|experiences|things\s+to\s+do)\s+(?:do\s+you\s+(?:have|offer)|are\s+there|can\s+(?:i|we)\s+do)(?:\s+here|\s+there)?$|^what\s+(?:can|could)\s+(?:i|we)\s+do(?:\s+here|\s+there)?$|^what\s+is\s+there\s+to\s+do(?:\s+here|\s+there)?$|^(?:do\s+you\s+have\s+)?any\s+activities$|^(?:what\s+are\s+)?(?:your|the)\s+activities$/u;
const PRICE_RE = /^(?:how\s+much\s+(?:is|does|for|are|do)\b|what(?:'s|\s+is|\s+are)\s+the\s+(?:price|cost|rate)s?\b|(?:price|cost)s?\s+(?:of|for)\b)/u;
const MENU_RE = /^(?:what(?:'s|\s+is)\s+on\s+(?:the|your)\s+menu|(?:can\s+i\s+)?(?:see|show\s+me|view|have)\s+(?:the|your)\s+menu|what\s+(?:food|dishes)\s+do\s+you\s+(?:have|serve|recommend)|what\s+do\s+you\s+recommend\s+(?:to\s+eat|for\s+food)|what\s+(?:food|dishes)\s+(?:is|are)\s+(?:good|recommended)|(?:the\s+)?menu)$/u;
const HOURS_RE = /^(?:what\s+time\s+do\s+you\s+(?:open|close)|when\s+do\s+you\s+(?:open|close)|what\s+(?:are|is)\s+your\s+(?:opening\s+|business\s+)?hours|what\s+are\s+the\s+(?:opening|business)\s+hours|(?:your\s+)?(?:opening|business)\s+hours|hours\s+of\s+operation|what\s+time\s+are\s+you\s+open(?:\s+until)?|how\s+late\s+are\s+you\s+open)$/u;

/** One unit's hours: the café or the restaurant. */
const UNIT_HOURS_RE = /^(?:(?:what\s+time|when)\s+(?:does|do|is)\s+(?:the|your)\s+(?:cafe|café|coffee\s+shop|restaurant)\s+(?:open|close)|(?:what\s+are\s+)?(?:the|your)\s+(?:cafe|café|coffee\s+shop|restaurant)(?:'s)?\s+(?:opening\s+)?hours)$/u;

function normalize(message: string): string {
  return message
    .normalize('NFC')
    .toLowerCase()
    .replace(/[’`]/gu, "'")
    .replace(/\b(?:please|pls|hi|hello|hey|thanks|thank\s+you)\b/gu, ' ')
    .replace(/[?!.,~]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function readEnglishBasicQuestion(message: string): EnglishBasicQuestion | null {
  if (/[^\p{Script=Latin}\p{N}\p{P}\p{Zs}\p{S}]/u.test(message) || message.length > 80) return null;
  const text = normalize(message);
  if (!text || NOT_BASIC.test(text)) return null;
  if (ACTIVITIES_RE.test(text)) return { topic: 'activities', canonical: ACTIVITIES_CANONICAL };
  if (MENU_RE.test(text)) return { topic: 'menu', canonical: ENGLISH_MENU_CANONICAL };
  if (HOURS_RE.test(text)) return { topic: 'hours', canonical: HOURS_CANONICAL };
  const unit = UNIT_HOURS_RE.exec(text);
  if (unit) return { topic: 'unit_hours', canonical: /restaurant/u.test(unit[0]) ? 'ร้านอาหารเปิดกี่โมง' : 'คาเฟ่เปิดกี่โมง' };
  if (PRICE_RE.test(text)) {
    const named = ACTIVITY_NAMES.filter(([pattern]) => pattern.test(text));
    // One activity only: "how much is it" has no referent here, and two
    // activities are two questions.
    if (named.length === 1) return { topic: 'activity_price', canonical: `${named[0]![1]}ราคาเท่าไหร่` };
  }
  return null;
}

/** English display names for the activity ids in the ecosystem graph. The
 *  stored names are Thai; these are labels for the same ids, not facts. */
export const ACTIVITY_ENGLISH_LABELS: Readonly<Record<string, string>> = {
  horse: 'Horse riding',
  atv: 'ATV',
  archery: 'Archery',
  pedal_boat: 'Pedal boat',
};
