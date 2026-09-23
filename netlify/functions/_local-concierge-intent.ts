// Structural classifiers for the Local Concierge question family --
// location, weather-condition, region/place, food-culture, visitor-
// journey, activity-suitability, horse-comparison, and general-safety
// questions. Mirrors the SAME discipline already established throughout
// _deterministic-semantic-turn.ts: a small, closed set of structural
// markers (grammatical patterns / bounded vocabulary), never a growing
// table of exact customer phrases -- see the Bible's own
// conversationDoctrine ("Principles, not a phrase list").
//
// This module ONLY classifies. It never decides what to say (that's
// _local-concierge-response.ts) and never touches task/transaction state.
import { isExperienceDiscoveryIntent } from './_experience-discovery';
import { hasCommitMarker } from './_slot-parsers';

export type LocalConciergeCategory =
  | 'location'
  | 'weather_condition'
  | 'region_place'
  | 'food_culture'
  | 'visitor_journey'
  | 'activity_suitability'
  | 'horse_comparison'
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

const LOCATION_MARKER = /โลเคชั่น|โลเคชัน|อยู่ที่ไหน|อยู่ไหน|ไปยังไง|ปักหมุด|ใกล้อะไร|เส้นทาง/u;

// "แดดแรงปะ" -- "ปะ" is the colloquial, sentence-final shorthand for "ไหม"
// (matches this codebase's existing precedent of recognizing informal
// sentence-final question particles, e.g. HOW_IT_WORKS_MARKER's "ไง" in
// _deterministic-semantic-turn.ts). อีสาน/อิสาน are both real, common
// spellings of the same region name -- not a typo to "fix", both are
// structural anchors here.
const WEATHER_CONDITION_MARKER = /ฝนตก|ฝน|แดด(?:แรง|ออก)?|ร้อน(?:มาก|ไหม)?|หนาว(?:ไหม)?|ลมแรง|อากาศ|ทางลื่น|โคลน/u;
const QUESTION_SHAPE_MARKER = /ไหม|ปะ(?:\s|$)|หรือเปล่า|รึเปล่า|รึยัง|หรือยัง|ดีไหม|ยังไง|ทำอะไร|เตรียมอะไร|ควรทำ/u;

const REGION_MARKER = /อีสาน|อิสาน|ชัยภูมิ|แถวนี้|ที่นี่|ทำมา-ชาติ/u;
// "มีไรดี"/"มีไรบ้าง" are the colloquial contraction of "มีอะไรดี"/"มีอะไรบ้าง"
// (อะไร -> ไร), the SAME contraction _experience-discovery.ts's own
// normalizeThaiDiscoveryText already treats as equivalent for its own
// intent -- recognized directly here as its own marker alternative rather
// than duplicating that normalizer.
const REGION_QUESTION_MARKER = /มีอะไรดี|มีไรดี|มีอะไรบ้าง|มีไรบ้าง|น่าเที่ยว|ต่างจาก|ฟีล|เป็นยังไง|แนวไหน/u;

const FOOD_CULTURE_MARKER = /อาหารอีสาน|นัว(?:ๆ)?|ปลาร้า|local|ท้องถิ่น(?:แท้)?/iu;
// A menu constraint/recommendation question shaped around WHO is eating or
// WHAT they can't eat, not a specific already-selected item -- kept
// distinct from the existing restaurant advisor's own price/dietary-filter
// path (isRestaurantAdvisorTurn in thongthai-chat.ts), which already owns
// "ไม่กินหมู"-style single-constraint statements once a restaurant
// conversation is active. Checked BEFORE visitor_journey below so a food-
// specific verb (กิน/สั่ง) wins over the more generic companion/journey
// category when both are present ("มากับแฟนกินอะไรดี").
const FOOD_VISITOR_MARKER = /ไม่กินเผ็ด|ไม่กินปลาร้า|กินอะไรได้|กินอะไรดี|เด็กกิน|เมนูไหน\s*local|มากับแฟน.*(?:สั่ง|กิน)|มากันหลายคน.*(?:สั่ง|กิน)/u;

const TIME_BUDGET_MARKER = /มีเวลา\s*\d+\s*(?:ชั่วโมง|ชม\.?)|ครึ่งวัน|เต็มวัน|ค้างคืน|(\d+)\s*คืน/u;
const JOURNEY_REQUEST_MARKER = /จัดทริป|จัดแผน|จัดโปรแกรม|อยากได้แบบ(?:ชิล|ลุย)|แผนสำรอง/u;
// Bare companion/party mentions -- per the owner's explicit instruction,
// these must get a helpful concierge response even with NO other signal in
// the same message ("มากับแฟน" alone, "พาแม่มา" alone). Broadened from an
// earlier, more conservative version that required pairing with a planning
// verb; the risk of an incidental mention (e.g. inside a food-specific
// question) is handled by checking food_culture first, not by under-
// matching here.
const COMPANION_MARKER = /มากับ(?:แฟน|ครอบครัว|เด็ก|ผู้ใหญ่|เพื่อน|แม่|พ่อ|ลูก)|มีเด็ก|มีผู้สูงอายุ|พา(?:แฟน|แม่|พ่อ|ลูก)มา/u;
// A stated mood/pace preference is, on its own, a strong enough planning
// signal to be a journey request -- "ไม่อยากเดินเยอะ อยากชิล" carries no
// explicit "จัดทริปให้" verb but is unambiguously asking to be matched to
// a suitable plan.
const VISITOR_MOOD_MARKER = /โรแมนติก|ชิล|ลุย|ผจญภัย|ไม่อยากเดินเยอะ|อยากถ่ายรูป|ลองของ\s*local|พักใจ/u;

const SUITABILITY_QUESTION_MARKER = /ได้ไหม|เหมาะไหม|เหมาะกับ|ยากไหม/u;
const DIFFICULTY_MARKER = /ยาก/u;
const ACTIVITY_NODE_MARKERS: ReadonlyArray<{ id: string; pattern: RegExp }> = [
  { id: 'activity-horse', pattern: /ม้า|ขี่ม้า/u },
  { id: 'activity-atv', pattern: /atv|เอทีวี/iu },
  { id: 'activity-archery', pattern: /ยิงธนู|ธนู/u },
];
const VISITOR_TYPE_MARKER = /เด็ก|ผู้สูงอายุ|มือใหม่/u;

const SAFETY_MARKER = /ปลอดภัยไหม|พื้นลื่น|ทางลื่น|เสี่ยง(?:สุด|ไหม)?|เมาเล่นได้ไหม/u;

// Horse ride-feel / choice questions -- uses the owner's OWN configured
// facts (see _local-concierge-knowledge.ts's HORSE_FACTS), never a guess.
// Deliberately excludes anything the EXISTING One-Mind compare-entities
// path already owns (temperament/beginner-suitability/age/sex/size/weight
// -- see detectCompareEntities's COMPARE_ATTRIBUTE_KEYWORDS in
// _deterministic-semantic-turn.ts) so this module never answers a question
// about an UNCONFIGURED attribute with configured-but-irrelevant ride-feel
// data, and never steals a case the existing mechanism already correctly
// declines honestly.
const HORSE_NAME_MARKER = /ภาราดร|ทองไทย/u;
const HORSE_RIDE_FEEL_MARKER = /ขี่(?:นิ่ม|กระด้าง)|ขี่ยังไง|ขี่แบบไหน|ต่างกัน/u;
const HORSE_CHOICE_MARKER = /ตัวไหนดี|ควรเลือกตัวไหน|เลือกตัวไหนดี/u;
// A single named horse's personality question ("ทองไทยนิสัยเป็นไง") --
// deliberately a DIFFERENT shape than the "ตัวไหน + attribute" comparison
// HORSE_ATTRIBUTE_EXCLUSION_MARKER defers to detectCompareEntities for
// (that shape always needs COMPARE_MARKER too, so it can never collide
// with this one), just the horse's proper name asked about directly.
const HORSE_NAMED_PERSONALITY_MARKER = /นิสัยเป็น(?:ไง|ยังไง)/u;
// "ขอเปรียบเทียบม้าสองตัว" -- scoped to an actual horse/riding mention so a
// generic "เปรียบเทียบ" elsewhere (e.g. comparing room rates) is never
// misread as a horse question.
const HORSE_MENTION_MARKER = /ม้า|ภาราดร|ทองไทย/u;
const COMPARE_REQUEST_MARKER = /เปรียบเทียบ/u;
const HORSE_ATTRIBUTE_EXCLUSION_MARKER = /นิสัย|อารมณ์|มือใหม่|เริ่มต้น|หัดขี่|อายุ|เพศ|ขนาด|น้ำหนัก/u;

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
 * Order matters: more specific categories are checked before the broader
 * ones they'd otherwise also match.
 */
export function classifyLocalConciergeQuestion(message: string): LocalConciergeMatch | null {
  const text = message.trim();
  if (!text) return null;

  // Location: checked first -- a request for the Maps link/directions is
  // never ambiguous with anything else in this family.
  if (LOCATION_MARKER.test(text)) {
    return { category: 'location' };
  }

  // Horse ride-feel/choice: checked before activity_suitability/safety so
  // "ตัวไหนขี่นิ่มกว่า" gets the real configured ride-feel facts, not a
  // generic activity answer. Yields on anything the existing compare-
  // entities mechanism already correctly owns (see
  // HORSE_ATTRIBUTE_EXCLUSION_MARKER's own comment above).
  if ((!HORSE_ATTRIBUTE_EXCLUSION_MARKER.test(text)
      && (HORSE_RIDE_FEEL_MARKER.test(text) || (HORSE_NAME_MARKER.test(text) && HORSE_CHOICE_MARKER.test(text))
        || (findActivityNode(text) === 'activity-horse' && HORSE_CHOICE_MARKER.test(text))))
    || (HORSE_NAME_MARKER.test(text) && HORSE_NAMED_PERSONALITY_MARKER.test(text))
    || (HORSE_MENTION_MARKER.test(text) && COMPARE_REQUEST_MARKER.test(text))) {
    return { category: 'horse_comparison' };
  }

  // Activity suitability: a condition (weather) or visitor-type marker,
  // combined with a suitability-question shape, about a NAMED activity --
  // checked before the bare weather_condition category below.
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

  // Food culture: broad Isan-food-style questions, or a visitor-constraint-
  // shaped food question -- checked before visitor_journey so a food-
  // specific verb wins over a generic companion/mood match.
  if (FOOD_CULTURE_MARKER.test(text) || FOOD_VISITOR_MARKER.test(text)) {
    return { category: 'food_culture' };
  }

  // Visitor journey: an explicit time budget, journey-planning verb, a
  // stated mood/pace preference, or a bare companion/party mention -- all
  // treated as a sufficient planning signal on their own per the owner's
  // explicit instruction that a bare "มากับแฟน" must get a helpful
  // concierge response, not a generic non-answer.
  if ((TIME_BUDGET_MARKER.test(text) || JOURNEY_REQUEST_MARKER.test(text) || VISITOR_MOOD_MARKER.test(text)
    || COMPANION_MARKER.test(text)) && !isExperienceDiscoveryIntent(text)) {
    return { category: 'visitor_journey' };
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

/**
 * True when the message's SHAPE is a horse info/comparison question (the
 * SAME 'horse_comparison' markers classifyLocalConciergeQuestion already
 * uses -- never a second, independently-drifting marker set). Exported so
 * any horse-SELECTION path can refuse to ever read such a question as
 * selecting/reselecting a horse.
 *
 * This matters even when a horse-booking task is ALREADY open: a
 * selection path that treats "any mention of a horse's name" as
 * "continuing the active task" will otherwise let a later comparison
 * question naming BOTH horses ("ทองไทยกับภาราดรต่างกันยังไง", asked right
 * after already selecting ทองไทย) silently re-select whichever horse
 * happens to be named LAST in the text -- a real production incident,
 * not a hypothetical (see thongthai-chat.ts's activityBookingFallbackDraft,
 * the first caller of this guard).
 */
export function isHorseInfoOrComparisonQuestion(text: string): boolean {
  return classifyLocalConciergeQuestion(text)?.category === 'horse_comparison';
}

// "ตัวไหน" + an attribute keyword (นิสัย/มือใหม่/อายุ/...) -- the SAME shape
// detectCompareEntities (_deterministic-semantic-turn.ts) owns and
// classifyLocalConciergeQuestion deliberately yields on via
// HORSE_ATTRIBUTE_EXCLUSION_MARKER above. Exported so a horse-SELECTION
// guard can ALSO recognize this shape and stay out of its way -- naming
// both horses in a temperament/beginner-suitability comparison
// ("ภาราดรกับทองไทยตัวไหนนิสัยดีกว่า") must reach detectCompareEntities's
// honest "ไม่มีข้อมูล" decline, never get intercepted as an ambiguous
// selection attempt just because activityAssetFromText happens to match
// a horse's name inside it.
const COMPARE_ENTITIES_SHAPE_MARKER = /ตัวไหน|อันไหน|ชิ้นไหน/u;
export function isCompareEntitiesAttributeQuestion(text: string): boolean {
  return COMPARE_ENTITIES_SHAPE_MARKER.test(text) && HORSE_ATTRIBUTE_EXCLUSION_MARKER.test(text);
}
