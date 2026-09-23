// Semantic Hospitality Interpreter -- normalizes messy/typo-heavy Thai and
// extracts structured care/risk/preference signals shared across every
// business unit's care-aware conversation flows. Deliberately NOT a
// domain router: domain selection stays with each domain's own intent
// markers (hasExplicitHorseBookingIntent, BUSINESS_UNIT_MARKERS, etc.);
// this module only answers "what did the customer actually mean," given a
// message, independent of which business unit is asking. Every domain
// that wires this in (horse riding, ATV) gets the SAME entity-extraction
// logic instead of a second hand-rolled copy of "does this mean beginner."
//
// Scope note: this implements the entity-extraction core of the "Semantic
// Hospitality Intelligence" initiative -- fear/confidence, health
// concerns per body part (with negation), experience level, customer type
// (child/elderly, with age when stated), intensity preference, weather/
// ground concern, and safety-question detection, plus a small, DELIBERATELY
// SHORT Thai typo/colloquial normalization table (only entries with no
// other plausible meaning -- e.g. "ขี่มา" is skipped: it can genuinely mean
// "came riding," not just a typo for "ขี่ม้า," so guessing would risk a
// real hallucination the owner explicitly warned against). It does NOT
// attempt a full 12-domain classifier, a confidence-scored NLU engine, or
// coverage for every business unit in the "Next Phase" request -- see
// THONGTHAI_HANDOFF.md's "Semantic Hospitality Intelligence" entry for
// exactly which domains this round wired it into and which remain future
// work, reported honestly rather than claimed complete.

export type FearLevel = 'concerned' | 'not_worried' | null;
export type ExperienceLevel = 'beginner' | 'experienced' | null;
export type BodyPart = 'back' | 'knee' | 'hip' | 'shoulder';
export type HealthConcernMap = Partial<Record<BodyPart, boolean>>;
export type CustomerTypeSignal = { kind: 'elderly' | 'child'; ageYears: number | null } | null;

// --- normalization -----------------------------------------------------

// Only typo/shorthand pairs with NO other plausible reading in this
// domain -- each one checked against a real listed example from the
// owner's spec. Kept short on purpose: a broad fuzzy-matching table risks
// silently "correcting" something the customer actually meant.
const NORMALIZATION_PAIRS: ReadonlyArray<[RegExp, string]> = [
  [/ขี้ม้า/gu, 'ขี่ม้า'],
  [/ทองทัย|ทองไท(?!ย)/gu, 'ทองไทย'],
  [/พาราดร|ภาราดอน/gu, 'ภาราดร'],
  [/กังวน/gu, 'กังวล'],
];

export function normalizeThai(text: string): string {
  let out = text;
  for (const [pattern, replacement] of NORMALIZATION_PAIRS) out = out.replace(pattern, replacement);
  return out;
}

// --- fear / confidence ---------------------------------------------------

// Checked in this order (no-fear first) because "ไม่กังวล"/"ไม่กลัว"
// contain "กังวล"/"กลัว" as substrings -- an un-ordered check would
// misread the negation as the concern itself.
const NO_FEAR_MARKER = /ไม่กังวล|ไม่กลัว|ไม่ค่อยห่วง|(?<!ไม่)(?<!ไม่ค่อย)มั่นใจ/u;
const FEAR_MARKER = /กลัว|ไม่ค่อยมั่นใจ|ไม่มั่นใจ|กังวล/u;

export function interpretFear(text: string): FearLevel {
  const t = normalizeThai(text);
  if (NO_FEAR_MARKER.test(t)) return 'not_worried';
  if (FEAR_MARKER.test(t)) return 'concerned';
  return null;
}

// --- experience level -----------------------------------------------------

const BEGINNER_MARKER = /ไม่เคย|มือใหม่|ครั้งแรก|ขี่ไม่เป็น|ขับไม่เป็น|ขับไม่แข็ง/u;
const EXPERIENCED_MARKER = /เคย(?!ขี่ไม่เป็น)/u;

export function interpretExperience(text: string): ExperienceLevel {
  const t = normalizeThai(text);
  if (BEGINNER_MARKER.test(t)) return 'beginner';
  if (EXPERIENCED_MARKER.test(t)) return 'experienced';
  return null;
}

// --- health concerns, per body part, with negation ------------------------

// "ขา" (leg) is folded into the 'knee' bucket -- the schema only tracks
// back/knee/hip/shoulder and a bare "leg" complaint is closest to a knee/
// mobility concern; documented here rather than silently guessed.
const BODY_PART_PATTERNS: ReadonlyArray<{ part: BodyPart; pattern: string }> = [
  { part: 'back', pattern: 'หลัง' },
  { part: 'knee', pattern: 'เข่า' },
  { part: 'knee', pattern: 'ขา' },
  { part: 'hip', pattern: 'สะโพก' },
  { part: 'shoulder', pattern: 'ไหล่' },
];

function bodyPartConcern(text: string, partPattern: string): boolean | null {
  // Negation checked FIRST: "ไม่ปวดหลัง" also contains the substring
  // "ปวดหลัง" the positive pattern below matches, so checking positive
  // first would misclassify a denial as a concern.
  const negative = new RegExp(`ไม่(?:ปวด|เจ็บ)${partPattern}|${partPattern}(?:ไม่มีปัญหา|โอเคดี|ปกติดี)`, 'u');
  if (negative.test(text)) return false;
  const positive = new RegExp(`(?:ปวด|เจ็บ)${partPattern}|${partPattern}(?:ไม่ดี|ไม่ค่อยดี|เคยเดี้ยง|ไม่ค่อยไหว)`, 'u');
  if (positive.test(text)) return true;
  return null;
}

export function interpretHealthConcerns(text: string): HealthConcernMap {
  const t = normalizeThai(text);
  const result: HealthConcernMap = {};
  for (const { part, pattern } of BODY_PART_PATTERNS) {
    const concern = bodyPartConcern(t, pattern);
    if (concern === null) continue;
    // A part already marked true (e.g. เข่า) is never downgraded by a
    // later, looser pattern for the same bucket (e.g. ขา) matching false.
    if (result[part] === true && concern === false) continue;
    result[part] = concern;
  }
  return result;
}

/** True if the message denies EVERY body-part concern it names, with no
 *  positive concern anywhere and no bare "no concern at all" phrasing --
 *  a coarser signal for flows that only need one none/present answer
 *  rather than a per-part breakdown (mirrors the existing horse-care
 *  flow's parseHealthConcern shape). */
export function interpretOverallHealthConcern(text: string): 'none' | 'present' | null {
  const t = normalizeThai(text);
  const parts = interpretHealthConcerns(t);
  const values = Object.values(parts);
  if (values.some(v => v === true)) return 'present';
  if (values.length > 0 && values.every(v => v === false)) return 'none';
  if (/ไม่(?:มี|กังวล|ปวด|เจ็บ)(?:อะไร|ปัญหา)?(?:ครับ|ค่ะ|คะ|คับ)?$/u.test(t.trim())) return 'none';
  if (/กังวล(?:เรื่อง)?(?:การ)?ทรงตัว/u.test(t)) return 'present';
  return null;
}

// --- customer type (elderly / child, with age if stated) ------------------

// Bare "แม่"/"พ่อ" is genuinely risky (แม่ครัว, แม่บ้าน, แม่น้ำ, พ่อครัว,
// พ่อค้า all contain it as a false-positive substring) -- bounded to a
// standalone person-reference immediately followed by a verb/negation
// that only makes sense addressed to a person, never a compound noun.
const ELDERLY_MARKER = /(?:พา)?(?:แม่|พ่อ)(?=อยาก|จะ|ขอ|ไม่|เดิน|ขี่|มา(?!ก)|ไป|พา)|ผู้สูงอายุ|คุณยาย|คุณตา|คุณแม่|คุณพ่อ/u;
// "ลูก" (one's own child) bare is risky the same way "แม่"/"พ่อ" is --
// ลูกค้า (customer), ลูกทีม (teammate), ลูกน้อง (subordinate), ลูกบอล
// (ball) all contain it as a false-positive substring -- bounded the same
// way: a standalone person-reference immediately followed by an age/verb
// that only makes sense addressed to a person.
const CHILD_WITH_AGE_RE = /(?:เด็ก|ลูก)\s*(\d{1,2})\s*ขวบ/u;
const CHILD_MARKER = /เด็ก|ลูก(?=อยาก|จะ|ขอ|ไม่|ขี่|เดิน|มา(?!ก))/u;

export function interpretCustomerType(text: string): CustomerTypeSignal {
  const t = normalizeThai(text);
  const childAgeMatch = t.match(CHILD_WITH_AGE_RE);
  if (childAgeMatch) return { kind: 'child', ageYears: Number(childAgeMatch[1]) };
  if (CHILD_MARKER.test(t)) return { kind: 'child', ageYears: null };
  if (ELDERLY_MARKER.test(t)) return { kind: 'elderly', ageYears: null };
  return null;
}

// --- intensity preference / weather-ground / safety question --------------

const GENTLE_MARKER = /ไม่โหด|ไม่เอาโหด|ไม่หนัก|ชิล|เบา\s*ๆ/u;
const WEATHER_GROUND_MARKER = /ฝนตก|ฝนเพิ่ง|พื้นลื่น|หลังฝน/u;
const SAFETY_QUESTION_MARKER = /ปลอดภัยไหม|ปลอดภัยหรือเปล่า|อันตรายไหม|เสี่ยงไหม|ปลอดภัยที่สุด/u;
const SPEED_FEAR_MARKER = /กลัวเร็ว|กลัวความเร็ว|ขอช้า\s*ๆ/u;
const LOW_WALKING_MARKER = /เดินน้อย|ไม่อยากเดินเยอะ|เดินไม่สะดวก|เดินไม่ไหว|เดินลำบาก|เดินไม่ค่อยไหว/u;

export function prefersGentleIntensity(text: string): boolean {
  return GENTLE_MARKER.test(normalizeThai(text));
}

export function prefersLowWalking(text: string): boolean {
  return LOW_WALKING_MARKER.test(normalizeThai(text));
}

export function mentionsWeatherGroundConcern(text: string): boolean {
  return WEATHER_GROUND_MARKER.test(normalizeThai(text));
}

export function asksIfSafe(text: string): boolean {
  return SAFETY_QUESTION_MARKER.test(normalizeThai(text));
}

export function mentionsSpeedFear(text: string): boolean {
  return SPEED_FEAR_MARKER.test(normalizeThai(text));
}

// --- activity goal / preference / support-request signals -----------------

// What the customer actually wants out of a risky/physical activity --
// distinct from experience/fear: someone can be an experienced rider who
// JUST wants a photo, or a total beginner who wants the full ride. Never
// assumed from experience level alone.
export type ActivityGoal = 'photo_only' | 'touch_only' | 'full_activity';

const PHOTO_ONLY_MARKER = /ถ่ายรูป(?:กับม้า|กับธนู)?เฉย\s*ๆ|ขอแค่ถ่ายรูป|แค่ถ่ายรูป/u;
const TOUCH_ONLY_MARKER = /ดูม้าเฉย\s*ๆ|ให้อาหารม้า|ลูบม้า|ไม่ขี่.*(?:ดู|ให้อาหาร)/u;

export function interpretActivityGoal(text: string): ActivityGoal | null {
  if (PHOTO_ONLY_MARKER.test(text)) return 'photo_only';
  if (TOUCH_ONLY_MARKER.test(text)) return 'touch_only';
  return null;
}

// A stated preference between two named horses' ride feel -- "เอาตัวนิ่ม
// กว่า"/"เอาตัวที่นิ่งกว่า" (softer/calmer) vs. "เอาตัวที่ขี่แน่นกว่า"
// (firmer). Only ever used to help the customer pick between the two REAL
// configured horses (see _local-concierge-knowledge.ts's HORSE_FACTS) --
// never to invent a claim beyond what's configured.
export type FirmnessPreference = 'softer' | 'firmer' | null;

const SOFTER_MARKER = /นิ่มกว่า|นิ่งกว่า|เอาตัวที่นิ่ม|เอาตัวที่เบา/u;
const FIRMER_MARKER = /แน่นกว่า|กระด้างกว่า|เอาตัวที่แรง/u;

export function interpretFirmnessPreference(text: string): FirmnessPreference {
  if (SOFTER_MARKER.test(text)) return 'softer';
  if (FIRMER_MARKER.test(text)) return 'firmer';
  return null;
}

const WEIGHT_OR_SIZE_MARKER = /ตัวใหญ่|น้ำหนักเยอะ|น้ำหนักตัวเยอะ|(?<!ไม่)อ้วน/u;

export function mentionsWeightOrSizeConcern(text: string): boolean {
  return WEIGHT_OR_SIZE_MARKER.test(text);
}

const SUPPORT_REQUEST_MARKER = /ให้คนจูง|มีคนจูงไหม|มีคนช่วยจูง|คนช่วยประคอง/u;

export function mentionsSupportRequest(text: string): boolean {
  return SUPPORT_REQUEST_MARKER.test(text);
}

const BRAKE_QUESTION_MARKER = /เบรกไม่เป็น|เบรกไม่ทัน|ถ้าเบรก/u;

export function mentionsBrakeQuestion(text: string): boolean {
  return BRAKE_QUESTION_MARKER.test(text);
}

const CHILD_PASSENGER_MARKER = /เด็กซ้อน|ซ้อนเฉย\s*ๆ|เด็กนั่งได้ไหม/u;

export function mentionsChildPassengerQuestion(text: string): boolean {
  return CHILD_PASSENGER_MARKER.test(text);
}

const WANTS_INTENSE_MARKER = /อยากมันส์|เร็ว\s*ๆ|เอาแบบมันส์|โหด\s*ๆ|รถแรงไหม/u;

export function wantsIntenseExperience(text: string): boolean {
  return WANTS_INTENSE_MARKER.test(text);
}

// --- the combined frame ---------------------------------------------------

export type SemanticFrame = {
  rawText: string;
  normalizedText: string;
  fear: FearLevel;
  experience: ExperienceLevel;
  healthConcerns: HealthConcernMap;
  overallHealthConcern: 'none' | 'present' | null;
  customerType: CustomerTypeSignal;
  prefersGentle: boolean;
  weatherGroundConcern: boolean;
  asksIfSafe: boolean;
  speedFear: boolean;
};

export function interpretMessage(text: string): SemanticFrame {
  const normalizedText = normalizeThai(text);
  return {
    rawText: text,
    normalizedText,
    fear: interpretFear(text),
    experience: interpretExperience(text),
    healthConcerns: interpretHealthConcerns(text),
    overallHealthConcern: interpretOverallHealthConcern(text),
    customerType: interpretCustomerType(text),
    prefersGentle: prefersGentleIntensity(text),
    weatherGroundConcern: mentionsWeatherGroundConcern(text),
    asksIfSafe: asksIfSafe(text),
    speedFear: mentionsSpeedFear(text),
  };
}

// --- shared "never overclaim safety" wording -------------------------------

/** The one honest answer to "ปลอดภัยไหม"/"ขอแบบปลอดภัยที่สุด" across every
 *  risky activity -- never a guarantee, always: team assesses/supervises,
 *  start slow, customer should tell staff their concerns. Shared so horse
 *  riding, ATV, and any future risky-activity domain say the same true
 *  thing instead of each inventing its own (possibly overclaiming)
 *  wording. `activityLabel` is the Thai activity name to slot into the
 *  sentence (e.g. "ขี่ม้า", "ขับ ATV"). */
export function noSafetyGuaranteeMessage(activityLabel: string): string {
  return `ทองไทยไม่กล้าการันตีว่าปลอดภัย 100% นะครับ แต่ทีมงานจะช่วยประเมินและดูแลใกล้ ๆ ตลอดตอน${activityLabel} เริ่มจากช้า ๆ ก่อนได้ครับ ถ้ามีเรื่องกังวลหรือสุขภาพอะไรเป็นพิเศษ บอกทีมงานก่อนเริ่มได้เลยนะครับ จะได้ดูแลได้ตรงจุดครับ`;
}
