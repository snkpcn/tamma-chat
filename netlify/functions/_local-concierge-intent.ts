// Structural classifiers for the Local Concierge question family -- weather
// -condition, region/place, food-culture, visitor-journey, activity-
// suitability, and general-safety questions. Mirrors the SAME discipline
// already established throughout _deterministic-semantic-turn.ts: a small,
// closed set of structural markers (grammatical patterns / bounded
// vocabulary), never a growing table of exact customer phrases -- see the
// Bible's own conversationDoctrine ("Principles, not a phrase list").
//
// This module ONLY classifies. It never decides what to say (that's
// _local-concierge-response.ts) and never touches task/transaction state.
import { isExperienceDiscoveryIntent } from './_experience-discovery';
import { hasCommitMarker } from './_slot-parsers';

export type LocalConciergeCategory =
  | 'weather_condition'
  | 'region_place'
  | 'food_culture'
  | 'visitor_journey'
  | 'activity_suitability'
  | 'safety_uncertainty';

export type LocalConciergeMatch = {
  category: LocalConciergeCategory;
  /** Which outdoor-activity node the question referenced, if any (see
   *  _local-concierge-knowledge.ts's OUTDOOR_SENSITIVE_ACTIVITY_NODES) --
   *  lets the composer name the specific activity instead of speaking only
   *  in generic terms. */
  activityNodeId?: string;
};

// --- structural markers -----------------------------------------------

const WEATHER_CONDITION_MARKER = /ฝนตก|ฝน|แดด(?:แรง|ออก)?|ร้อน(?:มาก|ไหม)?|หนาว(?:ไหม)?|อากาศ|ทางลื่น|โคลน/u;
const QUESTION_SHAPE_MARKER = /ไหม|หรือเปล่า|รึเปล่า|รึยัง|หรือยัง|ดีไหม|ยังไง|ทำอะไร|เตรียมอะไร|ควรทำ/u;

const REGION_MARKER = /อีสาน|ชัยภูมิ|แถวนี้|ที่นี่|ทำมา-ชาติ/u;
const REGION_QUESTION_MARKER = /มีอะไรดี|น่าเที่ยว|ต่างจาก|ฟีล|เป็นยังไง|แนวไหน/u;

const FOOD_CULTURE_MARKER = /อาหารอีสาน|นัว(?:ๆ)?|ปลาร้า|local|ท้องถิ่น(?:แท้)?/iu;
// A menu constraint/recommendation question shaped around WHO is eating,
// not a specific already-selected item -- kept distinct from the existing
// restaurant advisor's own price/dietary-filter path (isRestaurantAdvisorTurn
// in thongthai-chat.ts), which already owns "ไม่กินหมู"-style single-
// constraint statements once a restaurant conversation is active.
const FOOD_VISITOR_MARKER = /ไม่กินเผ็ด|กินอะไรได้|เด็กกิน|เมนูไหน\s*local|มากับแฟน.*สั่ง|มากันหลายคน.*สั่ง/u;

const TIME_BUDGET_MARKER = /มีเวลา\s*\d+\s*(?:ชั่วโมง|ชม\.?)|ครึ่งวัน|เต็มวัน|(\d+)\s*คืน/u;
const JOURNEY_REQUEST_MARKER = /จัดทริป|จัดแผน|จัดโปรแกรม|อยากได้แบบ(?:ชิล|ลุย)|แผนสำรอง/u;
const COMPANION_MARKER = /มากับแฟน|มากับครอบครัว|มากับเด็ก|มากับผู้ใหญ่|พาแฟนมา/u;
// A stated mood/pace preference is, on its own, a strong enough planning
// signal to be a journey request -- "ไม่อยากเดินเยอะ อยากชิล" carries no
// explicit "จัดทริปให้" verb but is unambiguously asking to be matched to
// a suitable plan.
const VISITOR_MOOD_MARKER = /โรแมนติก|ชิล|ผจญภัย|ไม่อยากเดินเยอะ|อยากถ่ายรูป|ลองของ\s*local|พักใจ/u;

const SUITABILITY_QUESTION_MARKER = /ได้ไหม|เหมาะไหม|เหมาะกับ|ยากไหม/u;
const DIFFICULTY_MARKER = /ยาก/u;
const ACTIVITY_NODE_MARKERS: ReadonlyArray<{ id: string; pattern: RegExp }> = [
  { id: 'activity-horse', pattern: /ม้า|ขี่ม้า/u },
  { id: 'activity-atv', pattern: /atv|เอทีวี/iu },
  { id: 'activity-archery', pattern: /ยิงธนู|ธนู/u },
];
const VISITOR_TYPE_MARKER = /เด็ก|ผู้สูงอายุ|มือใหม่/u;

const SAFETY_MARKER = /ปลอดภัยไหม|พื้นลื่น|ทางลื่น|เสี่ยง(?:สุด|ไหม)?|เมาเล่นได้ไหม/u;

// --- explicit-transaction guard -----------------------------------------

// A local-concierge-shaped question must never swallow a message that ALSO
// carries an explicit transaction/commit signal -- "ฝนตกไหม ยืนยัน" or
// "มีเวลา 3 ชั่วโมง จองขี่ม้าเลย" must still reach whatever already
// correctly handles booking/redemption/signup (see Gates 1-3's own
// exactly-once/no-premature-transaction proofs); this module must yield
// (return null), never answer instead of routing. Reuses hasCommitMarker
// (the SAME "จองเลย/สั่งเลย"-class marker _deterministic-semantic-turn.ts
// already uses) plus the small set of additional explicit markers this
// family of questions can plausibly be glued onto in one message.
const BARE_CONFIRM_MARKER = /(?:^|\s)(?:ยืนยัน|confirm)(?:\s|$|ครับ|ค่ะ|คะ|คับ)/iu;
const EXPLICIT_SIGNUP_MARKER = /สมัครสมาชิก/u;
const EXPLICIT_BOOK_NOW_MARKER = /จอง.{0,15}เลย/u;
// Structurally mirrors RESTAURANT_SET_ACCEPT_RE (thongthai-chat.ts) and
// isPromotionAcceptIntent's ACCEPT_RE (_promotion-dialog.ts) -- kept as its
// own small marker here rather than importing those (thongthai-chat.ts
// itself imports FROM this module, so importing back would be circular),
// same vocabulary, same "customer is accepting a proposed set/promo" shape.
const ACCEPT_OFFER_MARKER = /เอา(?:ชุด|เซ็ต)นี้|เอาชุดเมื่อกี้|ชุดเมื่อกี้|เอาตามนี้|โอเค(?:ชุด|เซ็ต)นี้|ตกลง(?:ชุด|เซ็ต)นี้|จัด(?:ชุด|เซ็ต)นี้|ชุดนี้เลย|เอาโปรนี้|ใช้โปรนี้|รับโปรนี้|เอาสิทธิ์นี้/u;

export function hasExplicitTransactionIntent(message: string): boolean {
  return hasCommitMarker(message)
    || BARE_CONFIRM_MARKER.test(message)
    || EXPLICIT_SIGNUP_MARKER.test(message)
    || EXPLICIT_BOOK_NOW_MARKER.test(message)
    || ACCEPT_OFFER_MARKER.test(message);
}

// --- classification -------------------------------------------------------

function findActivityNode(message: string): string | undefined {
  return ACTIVITY_NODE_MARKERS.find(item => item.pattern.test(message))?.id;
}

/**
 * Classifies a message into ONE local-concierge category, or null if it
 * doesn't structurally match any of them. Never called with an explicit
 * transaction marker present -- callers must check
 * hasExplicitTransactionIntent first (kept as the caller's explicit
 * responsibility, not hidden inside this function, so a caller can log/
 * trace the yield decision separately from "didn't match at all").
 *
 * Order matters: more specific categories (activity_suitability, which
 * requires BOTH a condition/visitor-type marker AND a named activity) are
 * checked before the broader ones they'd otherwise also match.
 */
export function classifyLocalConciergeQuestion(message: string): LocalConciergeMatch | null {
  const text = message.trim();
  if (!text) return null;

  // Activity suitability: a condition (weather) or visitor-type marker,
  // combined with a suitability-question shape, about a NAMED activity --
  // checked first since it's the most specific ("ฝนตกขี่ม้าได้ไหม" would
  // otherwise also match the bare weather_condition category below).
  const activityNode = findActivityNode(text);
  if (activityNode && SUITABILITY_QUESTION_MARKER.test(text)
    && (WEATHER_CONDITION_MARKER.test(text) || VISITOR_TYPE_MARKER.test(text) || DIFFICULTY_MARKER.test(text))) {
    return { category: 'activity_suitability', activityNodeId: activityNode };
  }

  // Safety/uncertainty: general safety questions not already owned by the
  // existing entity-comparison path (detectCompareEntities/
  // cannot_verify_comparison in _deterministic-semantic-turn.ts already
  // correctly handles "ตัวไหนนิสัยดีกว่า"-style comparisons -- this
  // category is deliberately narrower, for questions with no comparison
  // shape at all).
  if (SAFETY_MARKER.test(text)) {
    return { category: 'safety_uncertainty', activityNodeId: activityNode };
  }

  // Weather/condition: a condition marker with a question shape, not
  // attached to a named activity (that's activity_suitability above).
  if (WEATHER_CONDITION_MARKER.test(text) && QUESTION_SHAPE_MARKER.test(text)) {
    return { category: 'weather_condition' };
  }

  // Visitor journey: an explicit time budget, journey-planning verb, or a
  // stated mood/pace preference is a strong enough planning signal on its
  // own. A bare companion marker ("มากับแฟน") is deliberately NOT enough by
  // itself (too generic, could appear incidentally) -- it must pair with a
  // planning verb or a visitor-type marker (e.g. "มีเด็กด้วย").
  if ((TIME_BUDGET_MARKER.test(text) || JOURNEY_REQUEST_MARKER.test(text) || VISITOR_MOOD_MARKER.test(text))
    && !isExperienceDiscoveryIntent(text)) {
    return { category: 'visitor_journey' };
  }
  if (COMPANION_MARKER.test(text) && (JOURNEY_REQUEST_MARKER.test(text) || VISITOR_TYPE_MARKER.test(text))) {
    return { category: 'visitor_journey' };
  }

  // Food culture: broad Isan-food-style questions, or a visitor-constraint-
  // shaped food question -- deliberately distinct from the restaurant
  // advisor's own single-constraint mid-conversation path (isRestaurantAdvisorTurn),
  // which already owns "ไม่กินหมู" once a restaurant conversation is active.
  if (FOOD_CULTURE_MARKER.test(text) || FOOD_VISITOR_MARKER.test(text)) {
    return { category: 'food_culture' };
  }

  // Region/place: excludes anything the existing broad ecosystem-discovery
  // matcher already owns (isExperienceDiscoveryIntent), so "มาครั้งแรกมี
  // อะไรแนะนำ" keeps going through its own established deterministic
  // handler rather than being duplicated here.
  if (REGION_MARKER.test(text) && REGION_QUESTION_MARKER.test(text) && !isExperienceDiscoveryIntent(text)) {
    return { category: 'region_place' };
  }

  return null;
}
