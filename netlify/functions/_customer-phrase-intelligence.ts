// Master Roadmap Phase 2 -- Customer Intelligence Memory. Classifies a
// customer message for service-useful signal: a normalized PREFERENCE
// (durable, worth remembering per-guest -- an allergy, a mobility need,
// a pace, a fear), or a one-off PHRASE/DEMAND/RISK signal (worth
// counting in aggregate for a future owner dashboard, not worth
// permanently attaching to one guest).
//
// EXTENDS the existing customer memory foundation (_customer-db.ts's
// GuestContext/guest_memory), per the owner's explicit Phase 2
// instruction -- does NOT create a parallel memory system. Every
// PREFERENCE this module detects maps to a key ALREADY in (or newly
// added to) _customer-db.ts's own CONSTRAINTS/PACES/TRAVELER_TYPES
// allowed-value sets, so it flows through the SAME
// dedupeAllowed/guest_memory upsert path every other preference
// (interests, trip duration, budget) already uses. This module only
// classifies; it never writes anything itself (that's
// _customer-db.ts's capturePreferenceSignals) and never decides
// customer-facing wording (that stays with each domain responder,
// which reads guestContext.constraints the same way it already does
// for a same-turn "แพ้กุ้ง" mention).
//
// Same discipline as every other classifier in this codebase: a small,
// closed set of structural/vocabulary markers, never a growing phrase
// table.
export type PreferenceSignal = {
  /** Constraint keys (from _customer-db.ts's CONSTRAINTS set) to add. */
  addConstraints: string[];
  /** Constraint keys to remove -- a correction ("จริง ๆ กินเผ็ดได้นิดหน่อย"
   *  after previously saying "กินเผ็ดไม่ได้") updates memory by REMOVING
   *  the outdated constraint, rather than maintaining a numeric
   *  confidence score the existing schema has no field for -- see this
   *  module's own header comment on why that's the right-sized fix. */
  removeConstraints: string[];
  /** A new pace value (from PACES), if the message signals one. */
  pace: string | null;
  /** A new travelerType value (from TRAVELER_TYPES), if signaled. */
  travelerType: string | null;
};

export type IntelligenceSignal = {
  /** 'phrase' for a normalized preference/vocabulary signal (also
   *  logged in aggregate even when it maps to a durable preference --
   *  the SAME phrase said by many guests is exactly what "top repeated
   *  phrases" needs); 'demand' for a recommendation-style request with
   *  no durable preference attached; 'risk' for a safety/mobility/
   *  allergy/bot-quality signal worth an owner-facing risk-insight
   *  counter. */
  eventType: 'phrase' | 'demand' | 'risk';
  category: string;
  domain: 'activity' | 'restaurant' | 'stay' | 'cafe' | 'system' | 'general';
};

export function extractPreferenceSignal(message: string): PreferenceSignal {
  const text = message.trim();
  const addConstraints: string[] = [];
  const removeConstraints: string[] = [];
  let pace: string | null = null;
  let travelerType: string | null = null;

  // Correction FIRST -- "จริง ๆ กินเผ็ดได้นิดหน่อย" must win over the bare
  // "กินเผ็ด" substring it contains, or the constraint would be re-added
  // in the same breath it was just removed.
  if (/(?:จริง ๆ|จริงๆ|แก้ไข|เปลี่ยนใจ).{0,12}(?:กินเผ็ดได้|ทานเผ็ดได้)/u.test(text)) {
    removeConstraints.push('no_spicy');
  } else {
    if (/กินไม่เผ็ด|เผ็ดไม่ได้|ไม่กินเผ็ด|ไม่ทานเผ็ด|ทานเผ็ดไม่ได้|ไม่ใส่พริก/u.test(text)) addConstraints.push('no_spicy');
  }

  // Plain protein/ingredient avoidance -- a PREFERENCE ("ไม่กินไก่"), not
  // an allergy statement ("แพ้กุ้ง", handled separately below). All map
  // to keys already in _customer-db.ts's own CONSTRAINTS set (added
  // pre-Phase-2, alongside every other protein exclusion the restaurant
  // advisor already understands from a same-turn mention via
  // _restaurant-intelligence.ts's own hasNegative) -- this only makes
  // them durable across sessions, no new memory key needed. Real
  // production gap this closes: "ไม่กินไก่" sent as its own message was
  // correctly filtered for THAT turn (ephemeral, from the message text
  // itself) but never persisted, so it would be forgotten in a later
  // session.
  if (/ไม่กินไก่|ไม่เอาไก่|งดไก่/u.test(text)) addConstraints.push('no_chicken');
  if (/ไม่กินหมู|ไม่เอาหมู|งดหมู/u.test(text)) addConstraints.push('no_pork');
  if (/ไม่กินเนื้อ(?:วัว)?|ไม่เอาเนื้อ(?:วัว)?|งดเนื้อ(?:วัว)?/u.test(text)) addConstraints.push('no_beef');
  if (/ไม่กินกุ้ง|ไม่เอากุ้ง|งดกุ้ง/u.test(text) && !/แพ้กุ้ง/u.test(text)) addConstraints.push('no_shrimp');

  if (/เอาแบบไม่โหด|ไม่เอาโหด|ไม่เอาหนัก/u.test(text)) addConstraints.push('low_intensity');
  if (/กลัวตก/u.test(text)) addConstraints.push('fear_of_falling');
  if (/กลัวเร็ว/u.test(text)) addConstraints.push('fear_of_speed');
  if (/เดินไม่ไหว|เดินไกลไม่ได้|เดินไม่ได้ไกล|เดินนานไม่ได้/u.test(text)) addConstraints.push('limited_walking');
  if (/แพ้กุ้ง/u.test(text)) addConstraints.push('shrimp_allergy');
  // Bare "แพ้อาหาร" (no specific ingredient, no "รุนแรง" severity word --
  // that combination is Phase 1's own severe_allergy_medical escalation
  // boundary, a completely different concern from ordinary preference
  // memory) -- a mild, general food-allergy mention worth remembering
  // for future menu filtering.
  if (/แพ้อาหาร(?!รุนแรง)/u.test(text) && !/แพ้กุ้ง/u.test(text)) addConstraints.push('food_allergy');
  if (/พาแม่มา|มากับแม่|มากับคุณแม่/u.test(text)) addConstraints.push('elderly_friendly');
  if (/เด็กอยากลอง|พาลูกมา|มากับลูก/u.test(text)) addConstraints.push('child_friendly');
  if (/ตอบยาวไป|ยาวเกินไป|ตอบสั้น ๆ|ตอบสั้นๆ/u.test(text)) addConstraints.push('prefers_short_replies');

  if (/(?:เอา|ขอ)?แบบชิล\s*ๆ?|ขอชิล\s*ๆ?/u.test(text)) pace = 'relaxed';

  if (/มาเป็นครอบครัว|มากันทั้งครอบครัว/u.test(text)) travelerType = 'family';
  if (/มาเดท|มากับแฟน/u.test(text)) travelerType = 'couple';

  return { addConstraints, removeConstraints, pace, travelerType };
}

export function extractIntelligenceSignals(message: string): IntelligenceSignal[] {
  const text = message.trim();
  const signals: IntelligenceSignal[] = [];

  // Preference-shaped phrases are ALSO logged in aggregate as
  // 'phrase' events -- the count of how many guests said the SAME
  // phrase is exactly what a future "top repeated phrases" owner
  // insight needs, independent of whether it also became a durable
  // per-guest preference.
  if (/เอาแบบไม่โหด|ไม่เอาโหด|ไม่เอาหนัก/u.test(text)) signals.push({ eventType: 'phrase', category: 'low_intensity', domain: 'activity' });
  if (/กลัวตก/u.test(text)) signals.push({ eventType: 'risk', category: 'fear_of_falling', domain: 'activity' });
  if (/กลัวเร็ว/u.test(text)) signals.push({ eventType: 'risk', category: 'fear_of_speed', domain: 'activity' });
  if (/เดินไม่ไหว|เดินไกลไม่ได้|เดินไม่ได้ไกล|เดินนานไม่ได้/u.test(text)) signals.push({ eventType: 'risk', category: 'mobility_need', domain: 'general' });
  if (/กินไม่เผ็ด|เผ็ดไม่ได้|ไม่กินเผ็ด|ไม่ทานเผ็ด|ทานเผ็ดไม่ได้|ไม่ใส่พริก/u.test(text)) signals.push({ eventType: 'phrase', category: 'low_spice', domain: 'restaurant' });
  if (/ไม่กินไก่|ไม่เอาไก่|งดไก่/u.test(text)) signals.push({ eventType: 'phrase', category: 'no_chicken', domain: 'restaurant' });
  if (/ไม่กินหมู|ไม่เอาหมู|งดหมู/u.test(text)) signals.push({ eventType: 'phrase', category: 'no_pork', domain: 'restaurant' });
  if (/ไม่กินเนื้อ(?:วัว)?|ไม่เอาเนื้อ(?:วัว)?|งดเนื้อ(?:วัว)?/u.test(text)) signals.push({ eventType: 'phrase', category: 'no_beef', domain: 'restaurant' });
  if (/แพ้กุ้ง/u.test(text)) signals.push({ eventType: 'risk', category: 'shrimp_allergy', domain: 'restaurant' });
  if (/แพ้อาหาร/u.test(text)) signals.push({ eventType: 'risk', category: 'food_allergy', domain: 'restaurant' });
  if (/(?:เอา|ขอ)?แบบชิล\s*ๆ?|ขอชิล\s*ๆ?/u.test(text)) signals.push({ eventType: 'phrase', category: 'chill_pace', domain: 'general' });
  if (/เอาที่คนสั่งเยอะ|คนนิยม/u.test(text)) signals.push({ eventType: 'demand', category: 'popular_recommendation_request', domain: 'restaurant' });
  if (/มีอะไรเด็ด|เมนูเด็ด|เด่นร้าน/u.test(text)) signals.push({ eventType: 'demand', category: 'signature_recommendation_request', domain: 'restaurant' });
  if (/พื้นลื่น/u.test(text)) signals.push({ eventType: 'risk', category: 'ground_condition_risk', domain: 'activity' });
  if (/ไม่ปลอดภัย/u.test(text)) signals.push({ eventType: 'risk', category: 'safety_risk', domain: 'general' });
  if (/ตอบยาวไป|ยาวเกินไป/u.test(text)) signals.push({ eventType: 'risk', category: 'bot_quality_length', domain: 'system' });
  if (/อธิบายไม่รู้เรื่อง/u.test(text)) signals.push({ eventType: 'risk', category: 'bot_quality_clarity', domain: 'system' });

  return signals;
}
