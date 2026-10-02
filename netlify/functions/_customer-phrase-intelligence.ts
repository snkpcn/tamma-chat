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
    removeConstraints.push('no_spicy', 'mild_spice');
  } else {
    if (/กินไม่เผ็ด|เผ็ดไม่ได้|ไม่กินเผ็ด|ไม่ทานเผ็ด|ทานเผ็ดไม่ได้|ไม่ใส่พริก/u.test(text)) addConstraints.push('no_spicy');
    else if (/(?:กิน|ทาน)เผ็ดไม่เก่ง|ไม่ค่อย(?:กิน|ทาน)?เผ็ด|(?:กิน|ทาน)เผ็ดได้นิดหน่อย|ไม่เผ็ดมาก/u.test(text)) addConstraints.push('mild_spice');
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
  // Correction FIRST, same discipline as no_spicy's own correction above
  // -- "จริง ๆ กินไก่ได้" must win and never also re-add no_chicken (it
  // contains no "ไม่กินไก่"/"ไม่เอาไก่"/"งดไก่" substring, so there's no
  // clash, but the removal itself still needs to be explicit here).
  if (/(?:จริง ๆ|จริงๆ|แก้ไข|เปลี่ยนใจ).{0,12}(?:กินไก่ได้|ทานไก่ได้)/u.test(text)) removeConstraints.push('no_chicken');
  else if (/ไม่กินไก่|ไม่เอาไก่|งดไก่/u.test(text)) addConstraints.push('no_chicken');
  if (/(?:จริง ๆ|จริงๆ|แก้ไข|เปลี่ยนใจ).{0,12}(?:กินหมูได้|ทานหมูได้)/u.test(text)) removeConstraints.push('no_pork');
  else if (/ไม่กินหมู|ไม่เอาหมู|งดหมู/u.test(text)) addConstraints.push('no_pork');
  if (/(?:จริง ๆ|จริงๆ|แก้ไข|เปลี่ยนใจ).{0,12}(?:กินเนื้อได้|ทานเนื้อได้)/u.test(text)) removeConstraints.push('no_beef');
  else if (/ไม่กินเนื้อ(?:วัว)?|ไม่เอาเนื้อ(?:วัว)?|งดเนื้อ(?:วัว)?/u.test(text)) addConstraints.push('no_beef');
  if (/(?:จริง ๆ|จริงๆ|แก้ไข|เปลี่ยนใจ).{0,12}(?:กินกุ้งได้|ทานกุ้งได้)/u.test(text)) removeConstraints.push('no_shrimp');
  else if (/ไม่กินกุ้ง|ไม่เอากุ้ง|งดกุ้ง/u.test(text) && !/แพ้กุ้ง/u.test(text)) addConstraints.push('no_shrimp');

  if (/(?:เอา|ขอ)แบบไม่โหด|ไม่เอาโหด|ไม่เอาหนัก/u.test(text)) addConstraints.push('low_intensity');
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

  if (/มาเป็นครอบครัว|มากันทั้งครอบครัว|มากับครอบครัว/u.test(text)) travelerType = 'family';
  if (/มาเดท|มากับแฟน/u.test(text)) travelerType = 'couple';
  if (/มาคนเดียว|มาเที่ยวคนเดียว|ไปคนเดียว/u.test(text)) travelerType = 'solo';
  if (/มากับเพื่อน|มากันกับเพื่อน|แก๊งเพื่อน/u.test(text)) travelerType = 'friends';
  if (/มากับบริษัท|บริษัท.*มา|กรุ๊ปบริษัท|ทีมงาน.*มา|สัมมนา|กรุ๊ปใหญ่/u.test(text)) travelerType = 'group';

  // Café conversational preferences. These intentionally distinguish
  // preference from allergy/medical claims and are safe to remember across
  // transport channels.
  if (/ไม่(?:กิน|ดื่ม)กาแฟ|ไม่เอากาแฟ/u.test(text)) addConstraints.push('no_coffee');
  if (/(?:กลับมา|ดู|เอา).{0,10}กาแฟ(?:ก็ได้|ได้)|กินกาแฟได้|ดื่มกาแฟได้/u.test(text)) removeConstraints.push('no_coffee');
  if (/หวานน้อย|ไม่หวานมาก|ไม่ค่อยหวาน/u.test(text)) addConstraints.push('low_sweet');
  if (/ไม่ขมมาก|ไม่เอาขมมาก|ไม่ค่อยขม/u.test(text)) addConstraints.push('low_bitter');
  if (/ไม่เอานมวัว|ไม่ค่อยอยาก(?:กิน|ดื่ม)นมวัว|งดนมวัว/u.test(text)) addConstraints.push('no_cow_milk');
  if (/ไม่ใส่น้ำตาล|ไม่เอาน้ำตาล|งดน้ำตาล/u.test(text)) addConstraints.push('no_sugar');

  if (/มีเด็กมาด้วย|พาเด็กมา|เด็กมาด้วย/u.test(text)) addConstraints.push('child_friendly');
  if (/มือใหม่|ไม่เคยขี่ม้า|ไม่เคยขับ\s*(?:ATV|เอทีวี)/iu.test(text)) addConstraints.push('beginner_friendly');
  if (/ถ้าฝนตกไม่สะดวก|ไม่สะดวกถ้าฝนตก|ไม่อยากทำกิจกรรมตอนฝนตก|แพ้ฝน/u.test(text)) addConstraints.push('rain_sensitive');

  return { addConstraints, removeConstraints, pace, travelerType };
}

/**
 * Durable guest memory belongs to the customer, not automatically to every
 * companion mentioned in the sentence. The broad phrase classifier above is
 * intentionally subject-agnostic because same-turn domain responders still
 * need to notice "แฟนแพ้กุ้ง" or "ลูกไม่กินเผ็ด". This wrapper is used ONLY
 * when writing the customer's own durable memory.
 */
const GUEST_MEMORY_COMPANION_RE = /(?:แฟน|ภรรยา|สามี|ลูก|เด็ก|แม่|พ่อ|คุณแม่|คุณพ่อ|เพื่อน)/u;
const GUEST_MEMORY_SELF_RE = /(?:ผม|ฉัน|หนู|ดิฉัน|เราเอง)/u;

const GUEST_SCOPED_CONSTRAINT_PATTERNS: Partial<Record<string,RegExp>> = {
  no_coffee:/ไม่(?:กิน|ดื่ม)กาแฟ|ไม่เอากาแฟ/u,
  low_sweet:/หวานน้อย|ไม่หวานมาก|ไม่ค่อยหวาน/u,
  low_bitter:/ไม่ขมมาก|ไม่เอาขมมาก|ไม่ค่อยขม/u,
  no_cow_milk:/ไม่เอานมวัว|ไม่ค่อยอยาก(?:กิน|ดื่ม)นมวัว|งดนมวัว/u,
  no_sugar:/ไม่ใส่น้ำตาล|ไม่เอาน้ำตาล|งดน้ำตาล/u,
  no_spicy:/กินไม่เผ็ด|เผ็ดไม่ได้|ไม่กินเผ็ด|ไม่ทานเผ็ด|ทานเผ็ดไม่ได้|ไม่ใส่พริก/u,
  mild_spice:/(?:กิน|ทาน)เผ็ดไม่เก่ง|ไม่ค่อย(?:กิน|ทาน)?เผ็ด|(?:กิน|ทาน)เผ็ดได้นิดหน่อย|ไม่เผ็ดมาก/u,
  shrimp_allergy:/แพ้กุ้ง/u,
  food_allergy:/แพ้อาหาร/u,
  no_shrimp:/ไม่กินกุ้ง|ไม่เอากุ้ง|งดกุ้ง/u,
  fear_of_falling:/กลัวตก/u,
  fear_of_speed:/กลัวเร็ว/u,
  limited_walking:/เดินไม่ไหว|เดินไกลไม่ได้|เดินไม่ได้ไกล|เดินนานไม่ได้/u,
};

function constraintIsOnlyAboutCompanion(message:string, code:string):boolean{
  const phrase=GUEST_SCOPED_CONSTRAINT_PATTERNS[code];
  if(!phrase)return false;
  const source=phrase.source;
  const scoped=new RegExp(`(?:แฟน|ภรรยา|สามี|ลูก|เด็ก|แม่|พ่อ|คุณแม่|คุณพ่อ|เพื่อน)(.{0,28}?)(?:${source})`,'iu');
  const match=scoped.exec(message);
  if(!match)return false;
  // "มากับแฟน แต่ผมไม่กินกาแฟ" must remain the customer's preference:
  // a self marker between the companion noun and the preference wins.
  if(GUEST_MEMORY_SELF_RE.test(match[1]??''))return false;

  // Shared wording is also customer-owned because the customer explicitly
  // includes themself ("เราสองคน/เราทั้งคู่").
  const around=message.slice(Math.max(0,(match.index??0)-20),(match.index??0)+match[0].length+20);
  if(/เราสองคน|เราทั้งคู่|ทั้งคู่|พวกเรา/u.test(around))return false;
  return GUEST_MEMORY_COMPANION_RE.test(match[0]);
}

export function extractGuestPreferenceSignal(message:string):PreferenceSignal{
  const raw=extractPreferenceSignal(message);
  const addConstraints=raw.addConstraints.filter(code=>!constraintIsOnlyAboutCompanion(message,code));
  const remove=new Set(raw.removeConstraints);

  // Explicit self statements correct stale durable memory even when the same
  // turn also describes a different companion's restriction.
  if(/(?:ผม|ฉัน|หนู|ดิฉัน).{0,18}(?:ชอบกาแฟ|กินกาแฟได้|ดื่มกาแฟได้|เอากาแฟ)/u.test(message)){
    remove.add('no_coffee');
  }
  if(/(?:ผม|ฉัน|หนู|ดิฉัน).{0,18}(?:กินเผ็ดได้|ทานเผ็ดได้)/u.test(message)){
    remove.add('no_spicy'); remove.add('mild_spice');
  }
  if(
    /(?:แฟน|ภรรยา|สามี|ลูก|แม่|พ่อ|เพื่อน).{0,18}แพ้กุ้ง/u.test(message)
    && /(?:ผม|ฉัน|หนู|ดิฉัน).{0,18}(?:กินได้|กินกุ้งได้|ไม่ได้แพ้)/u.test(message)
  ){
    remove.add('shrimp_allergy'); remove.add('no_shrimp');
  }

  return {
    addConstraints:[...new Set(addConstraints)],
    removeConstraints:[...remove],
    pace:raw.pace,
    travelerType:raw.travelerType,
  };
}

export function extractIntelligenceSignals(message: string): IntelligenceSignal[] {
  const text = message.trim();
  const signals: IntelligenceSignal[] = [];

  // Preference-shaped phrases are ALSO logged in aggregate as
  // 'phrase' events -- the count of how many guests said the SAME
  // phrase is exactly what a future "top repeated phrases" owner
  // insight needs, independent of whether it also became a durable
  // per-guest preference.
  if (/(?:เอา|ขอ)แบบไม่โหด|ไม่เอาโหด|ไม่เอาหนัก/u.test(text)) signals.push({ eventType: 'phrase', category: 'low_intensity', domain: 'activity' });
  if (/กลัวตก/u.test(text)) signals.push({ eventType: 'risk', category: 'fear_of_falling', domain: 'activity' });
  if (/กลัวเร็ว/u.test(text)) signals.push({ eventType: 'risk', category: 'fear_of_speed', domain: 'activity' });
  if (/เดินไม่ไหว|เดินไกลไม่ได้|เดินไม่ได้ไกล|เดินนานไม่ได้/u.test(text)) signals.push({ eventType: 'risk', category: 'mobility_need', domain: 'general' });
  if (/กินไม่เผ็ด|เผ็ดไม่ได้|ไม่กินเผ็ด|ไม่ทานเผ็ด|ทานเผ็ดไม่ได้|ไม่ใส่พริก|ไม่เผ็ดมาก/u.test(text)) signals.push({ eventType: 'phrase', category: 'low_spice', domain: 'restaurant' });
  if (/ไม่กินไก่|ไม่เอาไก่|งดไก่/u.test(text)) signals.push({ eventType: 'phrase', category: 'no_chicken', domain: 'restaurant' });
  if (/ไม่กินหมู|ไม่เอาหมู|งดหมู/u.test(text)) signals.push({ eventType: 'phrase', category: 'no_pork', domain: 'restaurant' });
  if (/ไม่กินเนื้อ(?:วัว)?|ไม่เอาเนื้อ(?:วัว)?|งดเนื้อ(?:วัว)?/u.test(text)) signals.push({ eventType: 'phrase', category: 'no_beef', domain: 'restaurant' });
  if (/ไม่กินกุ้ง|ไม่เอากุ้ง|งดกุ้ง/u.test(text) && !/แพ้กุ้ง/u.test(text)) signals.push({ eventType: 'phrase', category: 'no_shrimp', domain: 'restaurant' });
  if (/แพ้กุ้ง/u.test(text)) signals.push({ eventType: 'risk', category: 'shrimp_allergy', domain: 'restaurant' });
  if (/แพ้อาหาร/u.test(text)) signals.push({ eventType: 'risk', category: 'food_allergy', domain: 'restaurant' });
  if (/(?:เอา|ขอ)?แบบชิล\s*ๆ?|ขอชิล\s*ๆ?/u.test(text)) signals.push({ eventType: 'phrase', category: 'chill_pace', domain: 'general' });
  if (/เอาที่คนสั่งเยอะ|คนนิยม/u.test(text)) signals.push({ eventType: 'demand', category: 'popular_recommendation_request', domain: 'restaurant' });
  if (/มีอะไรเด็ด|เมนูเด็ด|เด่นร้าน/u.test(text)) signals.push({ eventType: 'demand', category: 'signature_recommendation_request', domain: 'restaurant' });
  if (/พื้นลื่น/u.test(text)) signals.push({ eventType: 'risk', category: 'ground_condition_risk', domain: 'activity' });
  if (/ไม่ปลอดภัย/u.test(text)) signals.push({ eventType: 'risk', category: 'safety_risk', domain: 'general' });
  if (/ตอบยาวไป|ยาวเกินไป/u.test(text)) signals.push({ eventType: 'risk', category: 'bot_quality_length', domain: 'system' });
  if (/อธิบายไม่รู้เรื่อง/u.test(text)) signals.push({ eventType: 'risk', category: 'bot_quality_clarity', domain: 'system' });

  // Phase 3 owner-dashboard taxonomy. These are normalized aggregate
  // categories only; no raw identity is exposed by the dashboard.
  if (/(?:ร้านอาหาร|ตำมา-ชาติ|เมนู|กินอะไร|มีอะไรแนะนำ|อะไรอร่อย)/u.test(text)) {
    signals.push({ eventType: 'demand', category: 'intent_restaurant_recommendation', domain: 'restaurant' });
  }
  if (/(?:คาเฟ่|กาแฟ|อินทนิน|inthanin)/iu.test(text)) {
    signals.push({ eventType: 'demand', category: 'intent_cafe', domain: 'cafe' });
    signals.push({ eventType: 'demand', category: 'interest_cafe', domain: 'cafe' });
  }
  if (/ไม่(?:กิน|ดื่ม)กาแฟ|ไม่เอากาแฟ/u.test(text)) signals.push({ eventType:'phrase', category:'cafe_no_coffee', domain:'cafe' });
  if (/หวานน้อย|ไม่หวานมาก|ไม่ค่อยหวาน/u.test(text)) signals.push({ eventType:'phrase', category:'cafe_low_sweet', domain:'cafe' });
  if (/ไม่ขมมาก|ไม่เอาขมมาก|ไม่ค่อยขม/u.test(text)) signals.push({ eventType:'phrase', category:'cafe_low_bitter', domain:'cafe' });
  if (/ไม่เอานมวัว|ไม่ค่อยอยาก(?:กิน|ดื่ม)นมวัว|งดนมวัว/u.test(text)) signals.push({ eventType:'phrase', category:'cafe_no_cow_milk', domain:'cafe' });
  if (/ไม่ใส่น้ำตาล|ไม่เอาน้ำตาล|งดน้ำตาล/u.test(text)) signals.push({ eventType:'phrase', category:'cafe_no_sugar', domain:'cafe' });
  if (/(?:ขี่ม้า|ม้าตัวไหน|ภาราดร|(?:ทองไทย.*ม้า|ม้า.*ทองไทย))/u.test(text)) {
    signals.push({ eventType: 'demand', category: 'intent_horse', domain: 'activity' });
    signals.push({ eventType: 'demand', category: 'interest_horse', domain: 'activity' });
  }
  if (/\bATV\b|เอทีวี/iu.test(text)) {
    signals.push({ eventType: 'demand', category: 'intent_atv', domain: 'activity' });
    signals.push({ eventType: 'demand', category: 'interest_atv', domain: 'activity' });
  }
  if (/ยิงธนู|ธนู/u.test(text)) {
    signals.push({ eventType: 'demand', category: 'intent_archery', domain: 'activity' });
    signals.push({ eventType: 'demand', category: 'interest_archery', domain: 'activity' });
  }
  if (/เฮือนสเตย์|โฮมสเตย์|homestay|ที่พัก|ห้องพัก/iu.test(text)) {
    signals.push({ eventType: 'demand', category: 'intent_homestay', domain: 'stay' });
    signals.push({ eventType: 'demand', category: 'interest_homestay', domain: 'stay' });
  }
  if (/อยู่ที่ไหน|พิกัด|โลเคชั่น|location|ทางไป|ไปยังไง/iu.test(text)) {
    signals.push({ eventType: 'demand', category: 'intent_location', domain: 'general' });
  }
  if (/อากาศ|ฝนตก|ฝนจะตก|ร้อนไหม|หนาวไหม|weather/iu.test(text)) {
    signals.push({ eventType: 'demand', category: 'intent_weather', domain: 'general' });
  }
  if (/คืนเงิน|รีฟันด์|refund/iu.test(text)) {
    signals.push({ eventType: 'demand', category: 'intent_refund', domain: 'general' });
  }
  if (/ร้องเรียน|บริการแย่|บริการไม่ดี|ไม่พอใจ|แย่มาก/u.test(text)) {
    signals.push({ eventType: 'demand', category: 'intent_complaint', domain: 'general' });
  }
  if (/ไม่ปลอดภัย|บาดเจ็บ|พื้นลื่น|อันตราย|น่ากลัว/u.test(text)) {
    signals.push({ eventType: 'risk', category: 'intent_safety', domain: 'general' });
  }
  if (/จอง|ยกเลิก.*จอง|เลื่อน.*จอง|จอง.*พรุ่งนี้|จอง.*วันนี้/u.test(text)) {
    signals.push({ eventType: 'demand', category: 'intent_booking', domain: 'general' });
  }
  if (/ราคา|กี่บาท|เท่าไหร่|เท่าไร/u.test(text)) {
    signals.push({ eventType: 'demand', category: 'intent_pricing', domain: 'general' });
  }
  if (/ว่างไหม|ว่างมั้ย|มีคิว|คิวว่าง|มีห้อง|ห้องว่าง|เหลือไหม|เหลือมั้ย/u.test(text)) {
    signals.push({ eventType: 'demand', category: 'intent_availability', domain: 'general' });
  }

  // Group type patterns.
  if (/มาคนเดียว|มาเที่ยวคนเดียว|ไปคนเดียว/u.test(text)) signals.push({ eventType:'phrase', category:'group_solo', domain:'general' });
  if (/มาเดท|มากับแฟน/u.test(text)) signals.push({ eventType:'phrase', category:'group_couple', domain:'general' });
  if (/ครอบครัว/u.test(text)) signals.push({ eventType:'phrase', category:'group_family', domain:'general' });
  if (/พาลูกมา|มากับลูก|มีเด็กมาด้วย|พาเด็กมา|เด็กมาด้วย/u.test(text)) signals.push({ eventType:'phrase', category:'group_family_children', domain:'general' });
  if (/พาแม่มา|มากับแม่|คุณแม่|พ่อแม่|ผู้สูงอายุ/u.test(text)) signals.push({ eventType:'phrase', category:'group_elderly_companion', domain:'general' });
  if (/มากับเพื่อน|มากันกับเพื่อน|แก๊งเพื่อน/u.test(text)) signals.push({ eventType:'phrase', category:'group_friends', domain:'general' });
  if (/มากับบริษัท|กรุ๊ปบริษัท|ทีมงาน.*มา|สัมมนา|กรุ๊ปใหญ่/u.test(text)) signals.push({ eventType:'phrase', category:'group_corporate', domain:'general' });

  // Additional owner-facing constraint patterns.
  if (/พาลูกมา|มากับลูก|มีเด็กมาด้วย|พาเด็กมา|เด็กมาด้วย/u.test(text)) signals.push({ eventType:'phrase', category:'children_present', domain:'general' });
  if (/มือใหม่|ไม่เคยขี่ม้า|ไม่เคยขับ\s*(?:ATV|เอทีวี)/iu.test(text)) signals.push({ eventType:'phrase', category:'beginner', domain:'activity' });
  if (/ถ้าฝนตกไม่สะดวก|ไม่สะดวกถ้าฝนตก|ไม่อยากทำกิจกรรมตอนฝนตก|แพ้ฝน/u.test(text)) signals.push({ eventType:'phrase', category:'weather_sensitive', domain:'general' });

  // Food / dish interest: positive wording only, so a negative constraint
  // like "ไม่กินหมู" never inflates pork demand.
  if (/(?:ชอบ|อยากกิน|ขอ|เอา).{0,10}(?:ลาบ)/u.test(text)) signals.push({ eventType:'demand', category:'dish_interest_larb', domain:'restaurant' });
  if (/(?:ชอบ|อยากกิน|ขอ|เอา).{0,10}(?:ส้มตำ|ตำลาว|ตำไทย)/u.test(text)) signals.push({ eventType:'demand', category:'dish_interest_somtam', domain:'restaurant' });
  if (/(?:ชอบ|อยากกิน|ขอ|เอา).{0,10}(?:น้ำตก)/u.test(text)) signals.push({ eventType:'demand', category:'dish_interest_namtok', domain:'restaurant' });
  if (/(?:ชอบ|อยากกิน|ขอ|เอา).{0,10}(?:คอหมู)/u.test(text)) signals.push({ eventType:'demand', category:'dish_interest_grilled_pork_neck', domain:'restaurant' });
  if (!/ไม่กินหมู|ไม่เอาหมู|งดหมู/u.test(text) && /(?:ชอบ|อยากกิน|ขอ|เอา).{0,14}(?:หมู|ลาบหมู|คอหมู)/u.test(text)) signals.push({ eventType:'demand', category:'food_interest_pork', domain:'restaurant' });
  if (!/ไม่กินไก่|ไม่เอาไก่|งดไก่/u.test(text) && /(?:ชอบ|อยากกิน|ขอ|เอา).{0,14}(?:ไก่)/u.test(text)) signals.push({ eventType:'demand', category:'food_interest_chicken', domain:'restaurant' });
  if (!/ไม่กินเนื้อ|ไม่เอาเนื้อ|งดเนื้อ/u.test(text) && /(?:ชอบ|อยากกิน|ขอ|เอา).{0,14}(?:เนื้อ|วัว)/u.test(text)) signals.push({ eventType:'demand', category:'food_interest_beef', domain:'restaurant' });
  if (!/ไม่กินปลา|ไม่เอาปลา|งดปลา/u.test(text) && /(?:ชอบ|อยากกิน|ขอ|เอา).{0,14}(?:ปลา|ปลาช่อน|ปลานิล)/u.test(text)) signals.push({ eventType:'demand', category:'food_interest_fish', domain:'restaurant' });
  if (/อาหารอีสาน|กินอีสาน|แนวอีสาน/u.test(text)) signals.push({ eventType:'demand', category:'food_interest_isan', domain:'restaurant' });

  // Avoid double-counting the same normalized signal within one customer turn.
  return signals.filter((signal, index, all) =>
    all.findIndex(candidate =>
      candidate.eventType === signal.eventType
      && candidate.category === signal.category
      && candidate.domain === signal.domain
    ) === index
  );
}
