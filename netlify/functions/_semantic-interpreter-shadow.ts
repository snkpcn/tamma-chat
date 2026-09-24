// Shadow/comparison harness for Phase B. This exists ONLY so tests and the eval
// corpus can compare "what would the new semantic interpreter classify" against
// "what would the existing deterministic regex routers decide" -- WITHOUT wiring
// the semantic interpreter into production routing yet (that is Phase G, and only
// after equivalent golden/E2E coverage per THONGTHAI_HANDOFF.md's strangler-migration
// discipline). Production behavior is completely unchanged by this file existing.
//
// The patterns below are read-only copies of the existing legacy routers' own
// matching logic (isExperienceDiscoveryIntent, isPromotionDiscoveryIntent,
// isPromotionAcceptIntent, and thongthai-chat.ts's inline restaurant food-keyword
// check), reused here for honest side-by-side comparison -- not a new router.

import { isExperienceDiscoveryIntent } from './_experience-discovery';
import { isPromotionDiscoveryIntent, isPromotionAcceptIntent, isPromotionMention } from './_promotion-dialog';
import type { SemanticDomain } from './_semantic-interpreter';

// Mirrors thongthai-chat.ts's `explicitFood` regex exactly (see isRestaurantAdvisorTurn).
const LEGACY_EXPLICIT_FOOD_RE = /(ที่ร้าน|ร้านอาหาร|ตำมา-ชาติ|ตำมา|เมนู|อาหาร|กินอะไร|อะไรกิน|อะไรอร่อย|ตำ|ลาบ|น้ำตก|ยำ|ต้มแซ่บ|คอหมู|เสือร้องไห้|ไก่บ้าน|ปลาช่อน|ปลานิล|ข้าวเหนียว|เผ็ด|ปลาร้า|ถั่ว|กุ้ง|ไก่|หมู|เนื้อ)/u;
const LEGACY_NON_RESTAURANT_RE = /(ขี่ม้า|atv|เอทีวี|ยิงธนู|ห้องพัก|ที่พัก|เฮือน|otop|กาแฟ|คาเฟ่)/iu;

export type LegacyShadowResult = {
  /** The domain the current deterministic routers would have effectively acted on,
   *  or null if none of them would have intercepted this message at all (it would
   *  have gone straight to the general LLM brain with no deterministic pre-routing). */
  legacyDomain: SemanticDomain | null;
  /** Which specific legacy function(s) matched, for diagnostics. */
  matchedBy: string[];
};

/** Message-only approximation of the legacy routers. Real production routing for
 *  the restaurant domain also depends on runtime state (an in-progress preorder
 *  draft, a proposed set) that this shadow harness deliberately does not have
 *  access to -- it approximates the message-text-only portion of that decision,
 *  which is enough for corpus-level comparison. */
export function legacyShadowRoute(message: string): LegacyShadowResult {
  const matchedBy: string[] = [];
  let legacyDomain: SemanticDomain | null = null;

  if (isExperienceDiscoveryIntent(message)) {
    matchedBy.push('isExperienceDiscoveryIntent');
    legacyDomain = 'ecosystem';
  }

  if (isPromotionMention(message) && (isPromotionDiscoveryIntent(message) || isPromotionAcceptIntent(message))) {
    matchedBy.push(isPromotionDiscoveryIntent(message) ? 'isPromotionDiscoveryIntent' : 'isPromotionAcceptIntent');
    legacyDomain = 'promotion';
  }

  if (!LEGACY_NON_RESTAURANT_RE.test(message) && !isPromotionMention(message) && LEGACY_EXPLICIT_FOOD_RE.test(message)) {
    matchedBy.push('explicitFood');
    legacyDomain = 'restaurant';
  }

  return { legacyDomain, matchedBy };
}
