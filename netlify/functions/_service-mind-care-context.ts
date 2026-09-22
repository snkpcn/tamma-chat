// Service Mind -- care-aware wording for family/children/elderly/mobility
// context. Closes the specific gap the owner flagged: these messages were
// falling through to the generic local-concierge visitor_journey/food_
// culture/activity_suitability composers, which are correct but don't
// explicitly voice comfort/pace/safety care the way a real host would.
//
// Deliberately its OWN narrow module, not a change to
// _local-concierge-intent.ts/_local-concierge-response.ts -- these
// classifiers only claim messages that combine a child/elderly/mobility
// marker with something else (a family context, a mobility statement, an
// activity interest, a named-activity suitability question, or a food
// constraint), and are checked EARLY (before local-concierge, before
// One-Mind) so they win precedence without local-concierge's own files
// ever needing to change. A message without one of these specific
// combinations (e.g. a bare "มากับแฟน มีเวลา 3 ชั่วโมง", no child/elderly
// word at all) is untouched and falls through to local-concierge exactly
// as before.
export type CareContextCategory =
  | 'family_elderly_children'
  | 'low_walking'
  | 'child_activity'
  | 'elderly_activity_suitability'
  | 'child_food_constraint';

export type CareContextMatch = {
  category: CareContextCategory;
  /** Which companion word the message used ("แม่"/"พ่อ"/generic elderly),
   *  so the response can address them naturally instead of a generic
   *  "ผู้สูงอายุ" when the customer already named who they mean. */
  elderlyCompanionLabel: string | null;
  /** The named activity for elderly_activity_suitability, if any. */
  activityLabel: string | null;
};

// --- structural markers -----------------------------------------------

const CHILD_MARKER = /เด็ก/u;
// Bounded to actual companion phrases, never bare "แม่"/"พ่อ" -- those
// syllables appear inside many unrelated Thai words (แม่ครัว, แม่บ้าน,
// พ่อค้า) and a bare marker would false-positive constantly.
const ELDERLY_COMPANION_MARKER = /(พาแม่มา|พาพ่อมา|คุณแม่|คุณพ่อ|ผู้สูงอายุ)/u;
const FAMILY_MARKER = /ครอบครัว/u;
const MOBILITY_MARKER = /ไม่อยากเดินเยอะ|เดินไม่สะดวก|เดินไม่ไหว|เดินลำบาก|เดินไม่ค่อยไหว/u;
const ACTIVITY_INTEREST_MARKER = /อยากทำกิจกรรม|อยากเล่น|อยากลอง/u;
const SUITABILITY_QUESTION_MARKER = /ได้ไหม|เหมาะไหม|เหมาะกับ/u;
const FOOD_CONSTRAINT_MARKER = /ไม่กินเผ็ด|ไม่ทานเผ็ด|แพ้อาหาร|ไม่กินปลาร้า/u;

const ACTIVITY_LABELS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  { pattern: /ขี่ม้า|ม้า/u, label: 'ขี่ม้า' },
  { pattern: /atv|เอทีวี/iu, label: 'ATV' },
  { pattern: /ยิงธนู|ธนู/u, label: 'ยิงธนู' },
];

function findActivityLabel(text: string): string | null {
  return ACTIVITY_LABELS.find(item => item.pattern.test(text))?.label ?? null;
}

function elderlyCompanionLabelFrom(text: string): string | null {
  if (/พาแม่มา|คุณแม่/u.test(text)) return 'คุณแม่';
  if (/พาพ่อมา|คุณพ่อ/u.test(text)) return 'คุณพ่อ';
  if (/ผู้สูงอายุ/u.test(text)) return 'ผู้สูงอายุ';
  return null;
}

/**
 * Classifies a message into ONE care-context category, or null if it
 * doesn't combine a child/elderly/mobility marker with anything else this
 * module owns. Order matters: most specific (a named-activity suitability
 * question) is checked first so it doesn't get claimed by the broader
 * family_elderly_children category.
 */
export function classifyCareContext(message: string): CareContextMatch | null {
  const text = message.trim();
  if (!text) return null;

  const hasChild = CHILD_MARKER.test(text);
  const hasElderlyCompanion = ELDERLY_COMPANION_MARKER.test(text);
  const elderlyCompanionLabel = elderlyCompanionLabelFrom(text);

  // Elderly + a suitability question about a NAMED activity -- e.g.
  // "ผู้สูงอายุเล่น ATV ได้ไหม". Checked first: most specific.
  if (hasElderlyCompanion && SUITABILITY_QUESTION_MARKER.test(text)) {
    const activityLabel = findActivityLabel(text);
    if (activityLabel) {
      return { category: 'elderly_activity_suitability', elderlyCompanionLabel, activityLabel };
    }
  }

  // Child + wanting to do an activity -- e.g. "มากับเด็ก อยากทำกิจกรรม".
  if (hasChild && ACTIVITY_INTEREST_MARKER.test(text)) {
    return { category: 'child_activity', elderlyCompanionLabel: null, activityLabel: findActivityLabel(text) };
  }

  // Child + a food constraint -- e.g. "มีเด็ก ไม่กินเผ็ด".
  if (hasChild && FOOD_CONSTRAINT_MARKER.test(text)) {
    return { category: 'child_food_constraint', elderlyCompanionLabel: null, activityLabel: null };
  }

  // A mobility statement specifically about a named companion/elderly
  // person -- e.g. "พาแม่มา ไม่อยากเดินเยอะ". A bare "ไม่อยากเดินเยอะ" with
  // no companion at all is left to local-concierge's own VISITOR_MOOD_MARKER
  // (visitor_journey), which already handles it reasonably as a generic
  // pace preference.
  if (MOBILITY_MARKER.test(text) && (hasElderlyCompanion || hasChild)) {
    return { category: 'low_walking', elderlyCompanionLabel, activityLabel: null };
  }

  // Broadest: a family/companion context naming BOTH children and elderly,
  // or a family context naming either -- e.g. "พาครอบครัวไป มีเด็กกับผู้สูงอายุ".
  if ((hasChild && hasElderlyCompanion) || (FAMILY_MARKER.test(text) && (hasChild || hasElderlyCompanion))) {
    return { category: 'family_elderly_children', elderlyCompanionLabel, activityLabel: null };
  }

  return null;
}

// --- response composition -----------------------------------------------

export function composeFamilyElderlyChildrenResponse(): string {
  return [
    'ได้เลยครับ 😊 ถ้ามีเด็ก ๆ กับผู้สูงอายุ ทองไทยแนะนำแผนเดินสบาย ไม่แน่นเกินไปก่อนครับ',
    'เริ่มจากกินข้าว/นั่งพักในโซนสบาย ๆ แล้วค่อยเลือกกิจกรรมเบา ๆ ตามแรงของทุกคนครับ',
    '',
    'มีใครเดินไม่สะดวก หรือมีอาหารที่แพ้/ไม่ทานเผ็ดไหมครับ',
  ].join('\n');
}

export function composeLowWalkingResponse(match: CareContextMatch): string {
  const who = match.elderlyCompanionLabel ?? 'ท่าน';
  return [
    'ได้เลยครับ แบบนี้ทองไทยจัดสายชิลให้ดีกว่าครับ 😊',
    'เน้นกินข้าว นั่งพัก ดูบรรยากาศ แล้วค่อยเลือกกิจกรรมเบา ๆ ถ้าอากาศดี ไม่ต้องเดินเยอะครับ',
    '',
    `${who}เดินขึ้นลงสะดวกไหมครับ เดี๋ยวทองไทยช่วยจัดให้เบาที่สุด`,
  ].join('\n');
}

export function composeChildActivityResponse(): string {
  return [
    'ได้เลยครับ 😊 ถ้ามีเด็กมาด้วย ทองไทยแนะนำเริ่มจากกิจกรรมเบา ๆ และให้ทีมหน้างานช่วยดูความเหมาะสมอีกที',
    'โดยเฉพาะกิจกรรมกลางแจ้งอย่างขี่ม้า/ATV ต้องดูอากาศกับสภาพพื้นจริงเพื่อความปลอดภัยครับ',
    '',
    'เด็กอายุประมาณกี่ขวบครับ',
  ].join('\n');
}

export function composeElderlyActivitySuitabilityResponse(match: CareContextMatch): string {
  const activity = match.activityLabel ?? 'กิจกรรมนี้';
  const who = match.elderlyCompanionLabel ?? 'ผู้สูงอายุ';
  return [
    `ทองไทยฟันธงแทนทีมงานหน้างานไม่ได้ครับ ขอให้ทีมช่วยดูความเหมาะสมของ${who}หน้างานอีกทีเพื่อความปลอดภัยครับ`,
    `ถ้าอยากได้แบบเบา ๆ ก่อน ทองไทยมีกิจกรรมที่ไม่โลดโผนเท่า${activity}ให้เลือกด้วยครับ`,
    '',
    'อยากให้ทองไทยช่วยแนะนำกิจกรรมเบา ๆ เพิ่มเติมไหมครับ',
  ].join('\n');
}

export function composeChildFoodConstraintResponse(): string {
  return [
    'ได้เลยครับ 😊 มีเด็กมาด้วย ทองไทยแนะนำเมนูรสอ่อน ไม่เผ็ด ให้เด็กทานได้สบายครับ',
    '',
    'มีใครแพ้อาหารหรือมีข้อจำกัดอื่นเพิ่มเติมไหมครับ',
  ].join('\n');
}

export function composeCareContextResponse(match: CareContextMatch): string {
  switch (match.category) {
    case 'family_elderly_children': return composeFamilyElderlyChildrenResponse();
    case 'low_walking': return composeLowWalkingResponse(match);
    case 'child_activity': return composeChildActivityResponse();
    case 'elderly_activity_suitability': return composeElderlyActivitySuitabilityResponse(match);
    case 'child_food_constraint': return composeChildFoodConstraintResponse();
  }
}
