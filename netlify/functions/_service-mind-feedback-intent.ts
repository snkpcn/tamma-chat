// Service Mind — feedback classification + structured extraction. Detects
// when a customer message is a compliment, complaint, suggestion, safety
// issue, or feedback about Thongthai itself; infers business unit and
// severity; and extracts person/role mentions, business-unit keywords,
// sentiment keywords, issue-category keywords, and named business assets
// for the Feedback Operations backoffice dashboard. Same discipline as
// every other classifier in this codebase (_local-concierge-intent.ts,
// _deterministic-semantic-turn.ts): a small, closed set of structural/
// vocabulary markers, never a growing phrase table -- see
// THONGTHAI_BRAIN.md's conversationDoctrine.
//
// This module ONLY classifies/extracts. It never decides what to say
// (that's _service-mind-feedback-response.ts) and never writes anything
// (that's _service-mind-feedback-events.ts).
import { hasCommitMarker } from './_slot-parsers';

export type FeedbackType = 'compliment' | 'complaint' | 'suggestion' | 'safety_issue' | 'system_feedback';
export type BusinessUnit = 'restaurant' | 'activity' | 'stay' | 'cafe' | 'membership' | 'system' | 'general' | 'unknown';
export type Severity = 'low' | 'normal' | 'high' | 'urgent';
export type PersonMentionKind = 'named' | 'role';
export type PersonMention = { label: string; kind: PersonMentionKind };
export type IssueKeyword =
  | 'service' | 'delay' | 'cleanliness' | 'safety' | 'food_quality' | 'staff_behavior'
  | 'pricing' | 'booking' | 'payment' | 'communication' | 'system_error'
  | 'activity_condition' | 'accessibility' | 'child_safety' | 'elderly_comfort';

export type ServiceFeedbackMatch = {
  feedbackType: FeedbackType;
  businessUnit: BusinessUnit;
  severity: Severity;
  /** A staff member's name/honorific-name if the customer mentioned one
   *  (e.g. "พี่เจิด") -- never guessed, only extracted when actually
   *  present in the message. Mirrors personMentions[0] when a person was
   *  found; kept as its own field for backward compatibility with the
   *  Phase 1 response composer, which only ever needed one name. */
  staffName: string | null;
  /** Structured extraction for the backoffice dashboard -- see
   *  extractFeedbackKeywords's own doc comment for what each field means
   *  and the entity rules (never over-accuse a person) it follows. */
  personMentions: PersonMention[];
  businessUnitMentions: string[];
  sentimentKeywords: string[];
  issueKeywords: IssueKeyword[];
  namedAssets: string[];
  keywordSummary: { topPositive: string[]; topNegative: string[] };
};

// --- structural markers -----------------------------------------------

// A real medical/physical emergency in progress always outranks every
// other classification -- checked first, and forces severity 'urgent'
// regardless of what else the message contains.
const URGENT_SAFETY_MARKER = /ไฟไหม้|ไฟลุก|ไฟช็อต|ไฟรั่ว|บาดเจ็บ|เลือดออก|อุบัติเหตุ|หมดสติ|แพ้อาหารรุนแรง|ทำให้แพ้|ช็อกอา|โดนไฟดูด|จมน้ำ/u;

// A safety CONCERN reported after the fact ("พื้นลื่นมาก น่ากลัว") --
// distinct from _local-concierge-intent.ts's safety_uncertainty (a
// customer asking "is it safe" BEFORE doing something) -- this is a
// customer reporting a scary/risky condition they already experienced or
// observed, which needs to reach staff, not just get general guidance.
// "มีปัญหาระหว่างทาง" (a problem occurred MID-activity) is deliberately its
// own, more specific safety marker than the plain "มีปัญหา" complaint
// marker below -- a problem during an outdoor activity is a safety
// concern; a problem reported with no such context is an equipment/
// service complaint.
const SAFETY_CONCERN_MARKER = /พื้นลื่น(?:มาก)?|น่ากลัว|เกือบ(?:ล้ม|ตก|ชน)|ไม่ปลอดภัย|เสี่ยงอันตราย|อันตรายมาก|มีปัญหาระหว่างทาง|ดูเหนื่อย/u;

const COMPLAINT_MARKER = /แย่มาก|แย่จัง|ห่วย|รอนาน|นานมาก|ช้า|ไม่พอใจ|ผิดหวัง|ไม่ประทับใจ|บริการแย่|ไม่(?:ค่อย)?สะอาด|สกปรก|เย็นชา|หยาบคาย|ไม่สุภาพ|พูดไม่ดี|ทำไม่ดี|นิสัยไม่ดี|ตำหนิ|ร้องเรียน|มีปัญหา|ไม่โอเค|ตอบมั่ว|ไม่ตรง|ไม่ขึ้น|ควรแก้|ช่วยปรับ/u;
const COMPLIMENT_MARKER = /ดูแลดีมาก|ดูแลดี|ประทับใจ|ชื่นชม|ขอชม|เก่งมาก|น่ารัก|บริการดี(?:มาก)?|ดีมากเลย|ยอดเยี่ยม|อร่อย|ตอบดี|ช่วยดี/u;
const SUGGESTION_MARKER = /น่าจะมี|เสนอแนะ|ข้อเสนอแนะ|อยากให้|เสนอไอเดีย|ลองทำ.*ดูไหม|น่าจะเพิ่ม|ควรเพิ่ม/u;

// Any phrase where the customer is commenting on THONGTHAI ITSELF (its
// answers, response length/accuracy, or its own conversational behavior)
// -- shared by SYSTEM_FEEDBACK_MARKER below (classification) and the
// 'system' business-unit marker (business_unit inference), so a
// compliment about Thongthai's own answers ("ทองไทยช่วยดีมาก") infers
// business_unit 'system' exactly the same way a complaint about it does.
// Exported so thongthai-chat.ts's activity-booking fallback can use the
// SAME closed marker set to recognize "this is response-quality
// commentary, not a horse-name selection" -- "ทองไทย" is a real, deliberate
// name collision (the bot's own name AND a horse's name), and this is the
// one shared vocabulary both sides must agree on to resolve it.
export const THONGTHAI_RESPONSE_MENTION = /ทองไทยตอบ|ทองไทยเข้าใจ|ทองไทยช้า|ทองไทยงง|ทองไทยพิมพ์|ทองไทยพูดเยอะ|ทองไทยพูดไม่รู้เรื่อง|ทองไทยอธิบาย(?:ไม่รู้เรื่อง|ไม่ชัด|ไม่เข้าใจ)|ทองไทยแนะนำไม่ตรง|ทองไทยช่วยดี|ทองไทยควรถาม|ทองไทยควรตอบ|บอทตอบ|แชทบอท|ระบบแชท|ระบบจอง|เว็บไซต์|เว็บค้าง|line\s*ไม่แจ้งเตือน|แอป/iu;

/** True when the message is commenting on Thongthai's own behavior/
 *  answers -- see THONGTHAI_RESPONSE_MENTION's own doc comment for why
 *  this exists and who else uses it. */
export function mentionsThongthaiResponse(text: string): boolean {
  return THONGTHAI_RESPONSE_MENTION.test(text);
}

// Feedback specifically about Thongthai's OWN answers/behavior (not the
// physical business) -- requires an actual NEGATIVE (or neutral-
// instructional, e.g. "ควรตอบสั้นกว่านี้") quality descriptor, not just
// the word "ทองไทย"/"ตอบ" alone, so a genuine compliment like
// "ทองไทยตอบดี"/"ทองไทยช่วยดีมาก" is never misclassified here (the bare
// "ทองไทยตอบดี" pre-check and COMPLIMENT_MARKER's own "ตอบดี"/"ช่วยดี"
// must win for those messages -- see classification order below).
const SYSTEM_FEEDBACK_MARKER = /ทองไทยตอบ(?:ยาว(?:ไป)?|ไม่ตรง|สั้นไป|งง|มั่ว)|ทองไทย(?:เข้าใจผิด|ช้า|งง|พิมพ์ผิด|พูดเยอะ(?:ไป)?|พูดไม่รู้เรื่อง|แนะนำไม่ตรง|ควรถาม|ควรตอบ)|ทองไทยอธิบาย(?:ไม่รู้เรื่อง|ไม่ชัด|ไม่เข้าใจ)|บอทตอบ(?:ยาว(?:ไป)?|ช้า|ไม่ตรง|มั่ว)|แชทบอท(?:ตอบ(?:ช้า|ไม่ตรง|ยาว(?:ไป)?|มั่ว)|ค้าง)|ระบบแชทค้าง|ระบบจองใช้ยาก|line\s*ไม่แจ้งเตือน|เว็บค้าง/iu;

// --- business-unit inference --------------------------------------------

const BUSINESS_UNIT_MARKERS: ReadonlyArray<{ unit: BusinessUnit; pattern: RegExp }> = [
  // "ครัว" (kitchen) is deliberately NOT a bare marker here -- "ครอบครัว"
  // (family) contains it as a substring ("ครอบ" + "ครัว"), a real false-
  // positive collision confirmed while testing; "พ่อครัว"/"แม่ครัว" (chef)
  // are unambiguous compounds and safe to keep.
  { unit: 'restaurant', pattern: /ร้านอาหาร|อาหาร|เมนู|พนักงานเสิร์ฟ|รออาหาร|คิดเงิน|แคชเชียร์|เบียร์สด|พ่อครัว|แม่ครัว|เสิร์ฟ/u },
  { unit: 'activity', pattern: /ขี่ม้า|ม้า|ภาราดร|atv|เอทีวี|ยิงธนู|กิจกรรม|ไกด์|คนดูแลม้า|กลางแจ้ง/iu },
  { unit: 'stay', pattern: /ห้องพัก|เช็คอิน|เช็กอิน|เช็คเอาท์|เช็กเอาท์|แม่บ้าน|ที่พัก|เฮือน(?:สเตย์)?|ห้องน้ำในห้อง/u },
  { unit: 'cafe', pattern: /คาเฟ่|inthanin|อินทนิน|กาแฟ|เครื่องดื่ม/iu },
  { unit: 'membership', pattern: /สมาชิก|แต้ม|สิทธิ์|โปรโมชั่น|จ่ายเงิน|ชำระเงิน|บัตร|ราคา/u },
  { unit: 'system', pattern: THONGTHAI_RESPONSE_MENTION },
];

function inferBusinessUnit(message: string): BusinessUnit {
  const hit = BUSINESS_UNIT_MARKERS.find(item => item.pattern.test(message));
  return hit?.unit ?? 'unknown';
}

// --- person/role mention extraction --------------------------------------

// Known role words -- a closed, unambiguous vocabulary. Checked BEFORE any
// name-guessing so a role is never misread as someone's actual name (see
// the "IMPORTANT ENTITY RULES" this follows: "พนักงานพูดไม่ดี" must produce
// an unknown/role mention, never a fabricated name). Ordered longest/most
// specific phrase first so "พนักงานร้านอาหาร" isn't cut short by the bare
// "พนักงาน" alternative matching first.
const ROLE_WORDS: readonly string[] = [
  'พนักงานร้านอาหาร', 'คนดูแลม้า', 'พนักงาน', 'แคชเชียร์', 'ไกด์', 'แม่ครัว', 'แม่บ้าน', 'เจ้าของ', 'ทองไทย',
];

// Only extracts a name that's ACTUALLY present after a staff honorific --
// never guesses, never invents. Non-greedy, bounded by the next common
// trailing word/whitespace/end-of-string (Thai has no spaces between
// words, so without this the capture would run on and swallow the rest
// of the sentence). "พี่เจิดดูแลดีมาก" -> "พี่เจิด".
const STAFF_NAME_RE = /(พี่|คุณ|น้อง)([ก-๙a-zA-Z]+?)(?=ดูแล|บริการ|เสิร์ฟ|ต้อนรับ|ช่วย|แนะนำ|เก่ง|น่ารัก|พูด|ทำ|\s|$|ครับ|ค่ะ|คะ|คับ)/u;

// A bare name (no honorific) immediately followed by a negative-behavior
// verb -- "เจิดพูดไม่ดี". Deliberately narrow: the name token itself is
// still required to not BE one of the known role words (a role complaint
// is never misread as this shape). Anchored to string-start OR a
// preceding whitespace/sentence boundary, not ONLY string-start -- a real
// production row proved a mixed message like "ทองไทยอธิบายไม่รู้เรื่อง
// เจิดนิสัยไม่ดี" needs to find "เจิด" even though it isn't the first
// token in the message.
const BARE_NAME_BEHAVIOR_RE = /(?:^|\s)([ก-๙a-zA-Z]{2,10}?)(?=พูดไม่ดี|ทำไม่ดี|นิสัยไม่ดี|หยาบคาย|ไม่สุภาพ|เย็นชา)/u;

// Real production incident this closes: "ทองไทยอธิบายไม่รู้เรื่อง เจิดนิสัย
// ไม่ดี" was persisted with person_mentions=[{kind:'role',label:'ทองไทย'}]
// only -- the staff mention "เจิด" was silently lost. ROLE_WORDS includes
// 'ทองไทย' (so a complaint ABOUT Thongthai itself is still recorded as a
// role mention), but the old code returned on the FIRST match found
// (role OR named), so a message mentioning BOTH Thongthai's own behavior
// AND a real staff member's name only ever recorded one of them. Now
// checks both independently and returns every mention actually present,
// instead of stopping at the first.
function extractPersonMentions(text: string): PersonMention[] {
  const mentions: PersonMention[] = [];
  const roleHit = ROLE_WORDS.find(role => text.includes(role));
  if (roleHit) mentions.push({ label: roleHit, kind: 'role' });

  const honorificMatch = text.match(STAFF_NAME_RE);
  if (honorificMatch) {
    mentions.push({ label: `${honorificMatch[1]}${honorificMatch[2]}`, kind: 'named' });
  } else {
    const bareMatch = text.match(BARE_NAME_BEHAVIOR_RE);
    if (bareMatch && !ROLE_WORDS.includes(bareMatch[1])) mentions.push({ label: bareMatch[1], kind: 'named' });
  }

  return mentions;
}

// --- keyword extraction (for the backoffice dashboard) -------------------

const BUSINESS_UNIT_MENTION_WORDS: readonly string[] = [
  'ตำมา-ชาติ', 'ร้านอาหาร', 'อาหาร', 'ครัว', 'แคชเชียร์',
  'ขี่ม้า', 'atv', 'เอทีวี', 'ยิงธนู', 'ม้า', 'ภาราดร', 'ไกด์',
  'เฮือนสเตย์', 'บ้านพัก', 'ห้องพัก', 'เช็คอิน', 'เช็กอิน', 'เช็คเอาท์', 'เช็กเอาท์', 'แม่บ้าน',
  'inthanin', 'อินทนิน', 'กาแฟ', 'เครื่องดื่ม',
  'ทองไทย', 'เว็บ', 'line', 'ระบบจอง', 'payment',
];

const POSITIVE_SENTIMENT_WORDS: readonly string[] = [
  'ดีมาก', 'น่ารัก', 'ประทับใจ', 'อร่อย', 'สะอาด', 'ดูแลดี', 'ชอบ', 'สนุก', 'แนะนำดี',
];
const NEGATIVE_SENTIMENT_WORDS: readonly string[] = [
  'แย่', 'ช้า', 'ไม่สะอาด', 'ไม่โอเค', 'ไม่ปลอดภัย', 'พูดไม่ดี', 'แพง', 'งง', 'ตอบมั่ว', 'หาย', 'รอนาน',
];

const ISSUE_KEYWORD_MARKERS: ReadonlyArray<{ issue: IssueKeyword; pattern: RegExp }> = [
  { issue: 'child_safety', pattern: /เด็ก.*(?:ล้ม|เสี่ยง|อันตราย)|เกือบล้ม/u },
  { issue: 'elderly_comfort', pattern: /ผู้สูงอายุ|เดินไม่สะดวก|เดินไม่ไหว/u },
  { issue: 'safety', pattern: /ปลอดภัย|อันตราย|ไฟไหม้|ไฟรั่ว|บาดเจ็บ|เกือบล้ม|เกือบตก/u },
  { issue: 'cleanliness', pattern: /สะอาด|สกปรก/u },
  { issue: 'delay', pattern: /รอนาน|นานมาก|ช้า/u },
  { issue: 'food_quality', pattern: /อาหาร|เมนู|รสชาติ|อร่อย/u },
  { issue: 'staff_behavior', pattern: /พูดไม่ดี|ทำไม่ดี|นิสัยไม่ดี|หยาบคาย|ไม่สุภาพ|เย็นชา|ดูแลดี|น่ารัก/u },
  { issue: 'pricing', pattern: /ราคา|แพง|ไม่ตรง(?:ราคา)?/u },
  { issue: 'booking', pattern: /จอง(?:แล้วไม่ขึ้น)?|ระบบจอง/u },
  { issue: 'payment', pattern: /จ่ายเงิน|ชำระเงิน|payment/iu },
  { issue: 'communication', pattern: /ไม่แจ้งเตือน|ทองไทยตอบ(?:ไม่ตรง|ยาวไป|งง)|ตอบมั่ว/u },
  { issue: 'system_error', pattern: /เว็บค้าง|ระบบแชทค้าง|ระบบจองใช้ยาก|error|บั๊ก/iu },
  { issue: 'activity_condition', pattern: /พื้นลื่น|สภาพพื้น|มีปัญหาระหว่างทาง|ดูเหนื่อย/u },
  { issue: 'accessibility', pattern: /ทางลาด|วีลแชร์|เดินไม่สะดวก/u },
  { issue: 'service', pattern: /บริการ/u },
];

// Horse names/activity assets -- a small closed list, the SAME horses
// _local-concierge-knowledge.ts's HORSE_FACTS already names. "ทองไทย" is
// ambiguous with the bot's own name (a real naming collision in the
// business itself), so it's only counted as the horse asset when a horse/
// riding marker also appears in the same message.
function extractNamedAssets(text: string): string[] {
  const assets: string[] = [];
  if (/ภาราดร/u.test(text)) assets.push('ภาราดร');
  if (/atv|เอทีวี/iu.test(text)) assets.push('ATV');
  if (/ยิงธนู|ธนู/u.test(text)) assets.push('ยิงธนู');
  if (/ทองไทย/u.test(text) && /ม้า|ขี่ม้า/u.test(text)) assets.push('ทองไทย (ม้า)');
  return assets;
}

function extractIssueKeywords(text: string): IssueKeyword[] {
  const found: IssueKeyword[] = [];
  for (const { issue, pattern } of ISSUE_KEYWORD_MARKERS) {
    if (pattern.test(text) && !found.includes(issue)) found.push(issue);
  }
  return found;
}

/**
 * Extracts every structured field the backoffice "เสียงลูกค้า" dashboard
 * needs (person/role mentions, business-unit keyword hits, sentiment
 * words, issue categories, named assets, and a small top-positive/
 * top-negative rollup) from a single message. Pure, no I/O, same
 * "small closed marker set" discipline as classification above -- this is
 * never a place to guess at something not actually in the text.
 */
export function extractFeedbackKeywords(text: string): {
  personMentions: PersonMention[];
  businessUnitMentions: string[];
  sentimentKeywords: string[];
  issueKeywords: IssueKeyword[];
  namedAssets: string[];
  keywordSummary: { topPositive: string[]; topNegative: string[] };
} {
  const personMentions = extractPersonMentions(text);
  const businessUnitMentions = BUSINESS_UNIT_MENTION_WORDS.filter(word => text.toLowerCase().includes(word.toLowerCase()));
  const positive = POSITIVE_SENTIMENT_WORDS.filter(word => text.includes(word));
  const negative = NEGATIVE_SENTIMENT_WORDS.filter(word => text.includes(word));
  const sentimentKeywords = [...positive, ...negative];
  const issueKeywords = extractIssueKeywords(text);
  const namedAssets = extractNamedAssets(text);

  return {
    personMentions,
    businessUnitMentions,
    sentimentKeywords,
    issueKeywords,
    namedAssets,
    keywordSummary: { topPositive: positive, topNegative: negative },
  };
}

// --- classification -------------------------------------------------------

/**
 * Classifies a message as service feedback, or null if it doesn't
 * structurally match any feedback category. Deliberately does NOT check
 * hasExplicitTransactionIntent -- feedback must win precedence over a
 * bare "ยืนยัน" that happens to trail a complaint ("บริการแย่มาก ยืนยัน"
 * is a complaint, not a booking confirmation). The caller is responsible
 * for placing this classifier early enough in the routing chain that a
 * match here is never reached by transaction-processing code at all (see
 * its wiring in thongthai-chat.ts).
 */
export function classifyServiceFeedback(message: string): ServiceFeedbackMatch | null {
  const text = message.trim();
  if (!text) return null;

  const businessUnit = inferBusinessUnit(text);
  const extraction = extractFeedbackKeywords(text);
  const staffName = extraction.personMentions.find(m => m.kind === 'named')?.label ?? null;

  function withExtraction(feedbackType: FeedbackType, severity: Severity, unit: BusinessUnit = businessUnit): ServiceFeedbackMatch {
    return { feedbackType, businessUnit: unit, severity, staffName, ...extraction };
  }

  // Urgent safety always wins, regardless of what else the message says.
  if (URGENT_SAFETY_MARKER.test(text)) return withExtraction('safety_issue', 'urgent');
  if (SAFETY_CONCERN_MARKER.test(text)) return withExtraction('safety_issue', 'high');

  // Compliments about Thongthai's own answers are checked BEFORE the
  // negative-only SYSTEM_FEEDBACK_MARKER, so "ทองไทยตอบดี" is a compliment,
  // never misread as feedback about response quality.
  if (/ทองไทยตอบดี/u.test(text)) return withExtraction('compliment', 'low');

  if (SYSTEM_FEEDBACK_MARKER.test(text)) return withExtraction('system_feedback', 'low', 'system');

  if (COMPLAINT_MARKER.test(text)) {
    // A complaint carrying a hard commit phrase in the SAME message
    // ("จองเลย"/"สั่งเลย") is still a complaint first -- but note it's
    // extremely rare for a real complaint to also contain one of these
    // (they're strong booking-action verbs, not ambiguous words like
    // "ยืนยัน"), so this is a defensive severity bump only, not a
    // reclassification away from complaint.
    return withExtraction('complaint', hasCommitMarker(text) ? 'high' : 'normal');
  }

  if (COMPLIMENT_MARKER.test(text)) return withExtraction('compliment', 'low');

  if (SUGGESTION_MARKER.test(text)) return withExtraction('suggestion', 'low');

  return null;
}
