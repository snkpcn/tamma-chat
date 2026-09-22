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

// "อยากขี่ม้า" alone -- deliberately narrower than
// _local-concierge-intent.ts's ACTIVITY_NODE_MARKERS matching (which
// covers ม้า/ขี่ม้า as part of larger structural categories like
// activity_suitability/horse_comparison); this only claims the bare,
// unstructured "I want to ride" statement, replacing what would otherwise
// be a plain asset-inventory listing with a caring question about
// experience/preferred feel first (matches Section 1's own D example).
const ACTIVITY_INTENT_START_MARKER = /^(?:อยากขี่ม้า|อยากลองขี่ม้า)[\s.ๆ!]*$/u;

export function isActivityIntentStartMessage(message: string): boolean {
  return ACTIVITY_INTENT_START_MARKER.test(message.trim());
}

export function composeActivityIntentStartResponse(): string {
  return 'ได้เลยครับ 😊 เคยขี่ม้ามาก่อนไหมครับ หรืออยากได้ฟีลชิล ๆ เป็นหลัก เดี๋ยวทองไทยช่วยเลือกให้เหมาะครับ';
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
