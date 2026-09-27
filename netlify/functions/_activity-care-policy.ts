// Human Core PR D: static, organization-wide activity care/safety POLICY
// facts, keyed by the three generic activity-care informationNeed buckets
// the semantic supervisor sets directly (safety/suitability/equipment --
// see _semantic-interpreter.ts's SemanticInformationNeed). Every string
// here is moved from the pre-existing legacy raw-text responders in
// thongthai-chat.ts (horseCareFearResponse, horseSafetyQuestionResponse,
// atvCareIntentResponse, archeryCareIntentResponse) -- not invented, not
// per-customer, not a Thai keyword table. These are the same fixed
// reassurance/instruction policies the business already gives every
// customer who asks about this topic for this activity; centralizing them
// here means there is exactly one place this wording lives once the legacy
// responders are retired.
//
// A (resourceCode, bucket) pair with no entry means no verified policy fact
// exists yet for that combination -- the consumer (see
// _response-composer.ts's renderActivityCareResponse) must say it cannot
// verify rather than invent reassurance text; the legacy responder (or a
// plain clarification) remains the fallback for that gap.
import { noSafetyGuaranteeMessage } from './_semantic-hospitality-interpreter';
import type { SemanticInformationNeed } from './_semantic-interpreter';

export type ActivityCareBucket = Extract<SemanticInformationNeed, 'safety' | 'suitability' | 'equipment'>;

const ACTIVITY_LABELS: Record<string, string> = {
  'activity-horse': 'ขี่ม้า',
  'activity-atv': 'ขับ ATV',
  'activity-archery': 'ยิงธนู',
};

const ACTIVITY_CARE_FACTS: Partial<Record<string, Partial<Record<ActivityCareBucket, string>>>> = {
  'activity-horse': {
    suitability: 'เข้าใจครับ ไม่ต้องกังวลนะครับ ทีมจะช่วยดูใกล้ ๆ ให้ตลอดครับ 😊 ถ้ากังวลนิดนึงเรื่องสุขภาพ แนะนำเริ่ม 30 นาทีแบบชิล ๆ ก่อนได้ครับ ทีมจะช่วยดูใกล้ ๆ ตอนขึ้น-ลงม้า และเริ่มช้า ๆ ได้ครับ',
  },
  'activity-atv': {
    suitability: 'เข้าใจครับ ไม่ต้องกังวลนะครับ 😊 ทีมงานจะบรีฟวิธีขับและกติกาความปลอดภัยก่อนเริ่มเสมอ แนะนำให้เริ่มขับช้า ๆ ก่อน ค่อยเพิ่มความเร็วทีหลังได้ครับ เด็กนั่งซ้อนได้บางช่วงอายุ แต่ต้องให้ทีมงานประเมินหน้างานอีกทีครับ ทองไทยไม่ขอการันตีล่วงหน้าครับ',
    equipment: 'ทีมงานจะสอนวิธีเบรกและควบคุมรถก่อนเริ่มเสมอครับ 😊 ความเร็ว/ความมันส์จะปรับตามเส้นทางและการประเมินหน้างานของทีมงานครับ ทองไทยไม่ขอการันตีระดับความเร็วล่วงหน้า แต่ทีมจะช่วยดูให้เหมาะกับคนขับจริง ๆ ครับ ถ้ายังไม่มั่นใจตอนซ้อมสามารถถามทีมงานซ้ำได้เลยครับ',
  },
  'activity-archery': {
    suitability: 'เข้าใจครับ 😊 ทีมงานจะสอนวิธีจับธนูและท่ายิงพื้นฐานก่อนเริ่มเสมอครับ ไม่ต้องกังวลนะครับ ถ้าไหล่หรือแขนไม่ค่อยสะดวก แจ้งทีมงานก่อนเริ่มได้เลยนะครับ ทีมจะช่วยดูท่าและปรับความหนักของธนูให้เหมาะกับตัวได้ครับ ไม่ต้องฝืนถ้าไม่ไหว ผู้ปกครองอยู่ดูใกล้ ๆ เด็กได้เลยครับ',
    equipment: 'ได้เลยครับ 😊 ถ่ายรูปกับธนูได้โดยไม่ต้องยิงเลยครับ ทีมงานช่วยดูแลความปลอดภัยระหว่างถ่ายรูปให้ครับ ส่วนตอนยิงจริงทีมงานจะสอนวิธีจับธนูและกติกาความปลอดภัยก่อนเริ่มเสมอครับ',
  },
};

/** The one closed SOT-code-to-resourceCode mapping -- a fixed, EXHAUSTIVE
 *  3-entry catalog-identity map, not a customer-language table. Unlike
 *  _activity-sot.ts's inline ternary (which defaults anything unrecognized
 *  to 'archery'), this returns null for an unrecognized code: a new/unseen
 *  activity type must fail closed to "no verified fact", never be silently
 *  misidentified as an existing one. */
export function resourceCodeForActivityCode(activityCode: string): string | null {
  if (activityCode === 'atv') return 'activity-atv';
  if (activityCode === 'horse') return 'activity-horse';
  if (activityCode === 'archery') return 'activity-archery';
  return null;
}

export function resolveActivityCareFact(resourceCode: string | null, bucket: ActivityCareBucket): string | null {
  if (bucket === 'safety') {
    return noSafetyGuaranteeMessage(resourceCode ? ACTIVITY_LABELS[resourceCode] ?? 'กิจกรรมนี้' : 'กิจกรรมนี้');
  }
  if (!resourceCode) return null;
  return ACTIVITY_CARE_FACTS[resourceCode]?.[bucket] ?? null;
}
