// Service Mind -- two small, deliberately narrow conversational moments
// that today fall through to the LLM with no deterministic handling:
// (1) a truly bare "I want to visit" message with no other signal at all
//     (Section 1: before conversation -- ask ONE good question instead of
//     a generic/no-op reply), and
// (2) a bare "thank you" closing a conversation (Section 3: after
//     conversation -- warm close, at most a light feedback invitation,
//     never spammed).
// Both are intentionally narrow markers, not general-purpose classifiers
// -- anything with additional structure (a companion mention, a time
// budget, a named business/activity) already has its own, better-fitting
// handler elsewhere (_local-concierge-intent.ts's visitor_journey, the
// activity/restaurant deterministic responders, etc.) and must keep
// winning those cases; this module only catches the truly bare, otherwise-
// unhandled shape.
import { isExperienceDiscoveryIntent } from './_experience-discovery';

// "จะไปเที่ยว" / "อยากไปเที่ยว" alone, nothing else structural in the
// message (no companion, no time budget, no named business/activity --
// those already route correctly elsewhere). Deliberately excludes
// anything isExperienceDiscoveryIntent already owns.
const VAGUE_VISIT_MARKER = /^(?:จะไปเที่ยว|อยากไปเที่ยว|อยากเที่ยว)[\s.ๆ!]*$/u;

export function isVagueVisitIntentMessage(message: string): boolean {
  const text = message.trim();
  if (!text) return false;
  return VAGUE_VISIT_MARKER.test(text) && !isExperienceDiscoveryIntent(text);
}

export function composeVagueVisitIntentResponse(): string {
  return 'ได้เลยครับ 😊 มากับใครบ้างครับ คู่รัก ครอบครัว เพื่อน หรือมาคนเดียว เดี๋ยวทองไทยจัดแผนให้เข้ากับคนที่มาด้วยครับ';
}

// "อยากกิน" alone -- no menu item, no constraint, nothing else structural
// (a message WITH more structure, e.g. "อยากกินอีสาน ไม่กินเผ็ด", already
// correctly routes to _local-concierge-intent.ts's food_culture category,
// which this must not steal from). Confirmed empirically that without
// this, a bare "อยากกิน" risks the generic LLM-unavailable apology rather
// than a real question -- there was no deterministic scaffolding for this
// exact bare shape before.
const FOOD_INTENT_START_MARKER = /^(?:อยากกิน|หิว(?:มาก|จัง)?|อยากทานข้าว|อยากทานอาหาร)[\s.ๆ!]*$/u;

export function isFoodIntentStartMessage(message: string): boolean {
  return FOOD_INTENT_START_MARKER.test(message.trim());
}

export function composeFoodIntentStartResponse(): string {
  return 'ได้เลยครับ ทานเผ็ดได้ไหมครับ แล้วมีใครแพ้อาหารหรือไม่ทานปลาร้าไหมครับ เดี๋ยวทองไทยช่วยเลือกให้ครับ';
}

// "อยากขี่ม้า"/"อยากลองขี่ม้า"/"ขี่ม้าได้ไหม"/"มีกิจกรรมขี่ม้าไหม", optionally
// with one short qualifier appended (มือใหม่/มีเด็กไปด้วย/มีผู้สูงอายุไปด้วย)
// -- deliberately narrower than _local-concierge-intent.ts's
// ACTIVITY_NODE_MARKERS matching (which covers ม้า/ขี่ม้า as part of
// larger structural categories like activity_suitability/horse_comparison);
// this only claims the bare, unstructured "I want to ride" statement (plus
// that one qualifier), replacing what would otherwise be a plain
// asset-inventory listing -- or, over LINE, the legacy booking flow's
// "เลือกระยะเวลา" prompt (see shouldConsumeLegacyLineBookingTurn's own
// guard in _operations-db.ts) -- with a caring question about experience/
// party size first (matches Section 1's own D example).
const ACTIVITY_INTENT_START_PHRASE = '(?:อยากขี่ม้า|อยากลองขี่ม้า|ขี่ม้าได้ไหม|มีกิจกรรมขี่ม้าไหม)';
const ACTIVITY_INTENT_QUALIFIER_PHRASE = '(?:มือใหม่|มีเด็ก(?:ไปด้วย)?|เด็กไปด้วย|มีผู้สูงอายุ(?:ไปด้วย)?|ผู้สูงอายุไปด้วย)';
const ACTIVITY_INTENT_START_MARKER = new RegExp(
  `^${ACTIVITY_INTENT_START_PHRASE}(?:\\s+${ACTIVITY_INTENT_QUALIFIER_PHRASE})?[\\s.ๆ!?？]*$`,
  'u',
);

export function isActivityIntentStartMessage(message: string): boolean {
  return ACTIVITY_INTENT_START_MARKER.test(message.trim());
}

export type ActivityIntentQualifier = 'beginner' | 'family' | null;

/** Which of the two care-question branches (if any) the appended
 *  qualifier calls for. Never used to claim a horse is "safer" for either
 *  group -- both branches route the actual judgment to the team, per
 *  Customer Service Doctrine's no-fake-certainty rule. */
export function classifyActivityIntentQualifier(message: string): ActivityIntentQualifier {
  const text = message.trim();
  if (/มือใหม่/u.test(text)) return 'beginner';
  if (/(?:มีเด็ก|เด็กไปด้วย|มีผู้สูงอายุ|ผู้สูงอายุไปด้วย)/u.test(text)) return 'family';
  return null;
}

export function composeActivityIntentStartResponse(qualifier: ActivityIntentQualifier = null): string {
  const intro = [
    'ได้เลยครับ 😊 ที่ทำมา-ชาติมีขี่ม้าให้เลือกกับม้า 2 ตัวครับ',
    '• ทองไทย — ฟีลแน่น ขี่กระด้างกว่านิดนึง คาแรกเตอร์น่ารัก',
    '• ภาราดร — ฟีลนิ่มกว่านิดหน่อย คาแรกเตอร์น่ารักเหมือนกัน',
  ].join('\n');

  if (qualifier === 'beginner') {
    return `${intro}\n\nเป็นมือใหม่ไม่ต้องกังวลครับ ทีมงานจะช่วยดูแลและแนะนำจังหวะที่เหมาะสมให้ครับ แล้วมากันกี่คนครับ?`;
  }
  if (qualifier === 'family') {
    return `${intro}\n\nพาเด็ก/ผู้สูงอายุไปด้วยก็ขี่ได้ครับ ขอถามอายุคร่าว ๆ และเคยขี่ม้ามาก่อนไหมครับ ทีมงานจะช่วยดูแลความปลอดภัยให้เหมาะกับแต่ละท่านครับ`;
  }
  return `${intro}\n\nขอถามนิดนึงนะครับ เคยขี่ม้ามาก่อนไหมครับ แล้วมากี่คนครับ จะได้แนะนำตัวม้าและระยะเวลาให้เหมาะครับ`;
}

const THANK_YOU_MARKER = /^(?:ขอบคุณ(?:ครับ|ค่ะ|คะ|มาก)?|thanks?(?:\s*you)?|thank\s*you)[\s!.ๆ]*$/iu;

export function isThankYouMessage(message: string): boolean {
  return THANK_YOU_MARKER.test(message.trim());
}

/** `invite`: whether to include the light feedback invitation -- the
 *  caller decides this (based on whether one was already shown recently
 *  in this conversation) so this module never has to own session state
 *  itself; see its call site in thongthai-chat.ts for the actual guard. */
export function composeThankYouCloseResponse(invite: boolean): string {
  if (!invite) return 'ยินดีมากครับ 😊 ถ้าอยากให้ช่วยอะไรเพิ่ม บอกทองไทยได้เลยครับ';
  return 'ยินดีมากครับ 😊 ทองไทยช่วยได้ตรงใจไหมครับ ถ้ามีอะไรอยากชม อยากติ หรืออยากฝากถึงเจ้านาย บอกทองไทยได้เลยครับ เดี๋ยวทองไทยส่งต่อให้ครับ';
}
