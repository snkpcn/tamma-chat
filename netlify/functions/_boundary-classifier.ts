// Master Roadmap Phase 1 -- Escalation Boundary Policy (see
// THONGTHAI_HANDOFF.md's "Master Roadmap Phase 1" entry for the full
// writeup and the owner's explicit decision this implements).
//
// Owner's decision: for a message naming a topic OUTSIDE Thongthai's
// authority -- money (refund/discount/claim), liability, a safety
// GUARANTEE, a severe medical/pregnancy/injury risk, a reputational
// threat, or an unverified real-time availability question -- Thongthai
// must answer with a deterministic, non-improvised guardrail reply
// FIRST, and must NEVER let the LLM draft a nuanced answer before
// routing to the owner/team. Reason (owner's own words): "These are
// outside Thongthai's authority/control and can create legal,
// financial, safety, or brand risk if the model improvises."
//
// This module ONLY classifies. It never decides wording (that's
// _service-mind-feedback-response.ts's composeEscalationResponse) and
// never writes/notifies anything (that's the EXISTING
// _service-mind-feedback-events.ts's createFeedbackEvent /
// _ops-notifications.ts's notifyFeedbackEventTargets, reused as-is --
// no new notification infrastructure needed for this phase).
//
// Same discipline as every other classifier in this codebase
// (_service-mind-feedback-intent.ts, _local-concierge-intent.ts): a
// small, closed set of structural/vocabulary markers, never a growing
// phrase table.
//
// A real, confirmed gap this closes: _service-mind-feedback-intent.ts's
// own URGENT_SAFETY_MARKER already contains "อุบัติเหตุ" and "แพ้อาหาร
// รุนแรง" (for genuine in-progress-injury/emergency detection), which
// meant "ถ้าเกิดอุบัติเหตุรับผิดชอบไหม" (a LIABILITY QUESTION, nobody is
// actually hurt) and "แพ้อาหารรุนแรง" (said bare, no food/restaurant
// context) were BOTH misclassified as an urgent safety_issue REPORT,
// producing the wrong reply (a ground-condition-check acknowledgment
// for a liability policy question; a "ทีมดูอีกที" filler for a bare
// severe-medical-risk statement). This classifier is checked BEFORE
// deterministicServiceFeedbackResponse in thongthai-chat.ts's
// precedence cascade specifically to intercept these narrow cases
// first -- everything genuinely safety_issue/complaint/compliment/
// suggestion/system_feedback shaped keeps flowing through the EXISTING,
// already-correct classifyServiceFeedback path unchanged.
import type { BusinessUnit } from './_service-mind-feedback-intent';

export type EscalationCategory =
  | 'refund_request'
  | 'special_discount'
  | 'claim_request'
  | 'accident_liability'
  | 'safety_guarantee'
  | 'bad_review_threat'
  | 'severe_allergy_medical'
  | 'unverified_availability';

export type EscalationMatch = {
  category: EscalationCategory;
  /** The domain team to notify alongside (or instead of) owner_general,
   *  when the message itself names one -- null when the message is
   *  generic/bare (routes to owner_general only, or to no one at all
   *  for a pure-answer, non-escalating instance). */
  domainUnit: BusinessUnit | null;
  /** false = a short honest answer accompanies the routing acknowledgment
   *  (matches the roadmap's ANSWER_AND_ESCALATE class); true = pure
   *  "Thongthai will not decide this, routing to owner" acknowledgment
   *  with no attempted answer (ESCALATE class). Naming matches the
   *  roadmap's own class names via this one boolean, since the wording
   *  difference is the only behavioral difference between the two
   *  classes for every category here. */
  pureEscalation: boolean;
  /** false only for the one narrow case the owner's own routing table
   *  calls out as NOT escalating on its own: a bare, generic safety-
   *  guarantee question with no named activity/domain -- Thongthai
   *  still answers honestly (no guarantee) but does not create a
   *  feedback event or notify anyone, per the owner's explicit "If
   *  generic: answer with no guarantee, ask context" instruction. */
  escalates: boolean;
};

// Closed, narrow domain-name vocabulary -- reused ONLY to decide who
// (in addition to owner_general, or instead of no one) should also see
// the escalation, never to answer on the domain's behalf.
const DOMAIN_HINT: ReadonlyArray<readonly [RegExp, BusinessUnit]> = [
  [/ม้า|ขี่ม้า/u, 'activity'],
  [/atv|เอทีวี/iu, 'activity'],
  [/ยิงธนู|ธนู/u, 'activity'],
  [/ร้านอาหาร|อาหาร|กิน|เมนู/u, 'restaurant'],
  [/ที่พัก|ห้องพัก|เฮือน|โฮมสเตย์|homestay/iu, 'stay'],
  [/คาเฟ่|กาแฟ|cafe/iu, 'cafe'],
];

function detectDomainHint(text: string): BusinessUnit | null {
  return DOMAIN_HINT.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

const REFUND_RE = /คืนเงิน|ขอเงินคืน|refund/iu;
const SPECIAL_DISCOUNT_RE = /ส่วนลดพิเศษ|ลดพิเศษ|ราคาพิเศษ|ขอลดราคา|ขอส่วนลด/u;
const CLAIM_RE = /ขอเคลม|เคลมประกัน|(?:^|[\s,])เคลม(?:[\s,]|$)/u;
// A LIABILITY QUESTION ("...รับผิดชอบไหม"), not a report that an
// accident already happened -- deliberately requires the question
// particle so a genuine incident report ("เกิดอุบัติเหตุ ช่วยด้วย") keeps
// reaching the real safety_issue path via classifyServiceFeedback's own
// URGENT_SAFETY_MARKER, unaffected by this module.
const ACCIDENT_LIABILITY_RE = /(?:อุบัติเหตุ|เกิดอะไรขึ้น).{0,16}รับผิดชอบ(?:ไหม|มั้ย|หรือเปล่า|รึเปล่า|กี่บาท)?|รับผิดชอบ.{0,16}(?:อุบัติเหตุ|ไหม|มั้ย)/u;
const SAFETY_GUARANTEE_RE = /ปลอดภัย\s*(?:100\s*%|ร้อยเปอร์เซ็นต์)(?:ไหม|มั้ย|หรือเปล่า)?|(?:การันตี|รับประกัน)ความปลอดภัย/u;
const BAD_REVIEW_THREAT_RE = /จะรีวิวแย่|ให้ดาวน้อย|(?:^|[\s,])1\s*ดาว|เขียนรีวิวไม่ดี|รีวิวติดลบ/u;
// Requires an explicit severity qualifier ("รุนแรง") -- a bare
// ingredient-specific allergy statement ("แพ้กุ้ง", no severity word)
// deliberately stays with the restaurant advisor's own real, working
// ingredient-filtering flow (_restaurant-intelligence.ts), which already
// handles it correctly (filters the menu, adds a staff-notify caution).
// "แพ้.{0,10}รุนแรง" matches both "แพ้อาหารรุนแรง" (bare, no ingredient)
// AND "แพ้กุ้งรุนแรง" (a NAMED ingredient the customer themselves flagged
// as severe) -- the severity word is what makes this Thongthai's
// authority boundary, not which ingredient. Also covers pregnancy, a
// standing chronic condition, or a serious injury already sustained.
const SEVERE_ALLERGY_MEDICAL_RE = /แพ้.{0,10}รุนแรง|ภูมิแพ้รุนแรง|ตั้งครรภ์|โรคประจำตัว|เจ็บหนัก|บาดเจ็บสาหัส/u;
const UNVERIFIED_AVAILABILITY_RE = /ห้องว่าง.{0,10}(?:คืนนี้|วันนี้|พรุ่งนี้)|(?:คืนนี้|วันนี้|พรุ่งนี้).{0,10}ห้องว่าง/u;

export function classifyEscalationBoundary(message: string): EscalationMatch | null {
  const text = message.trim();
  if (!text) return null;

  if (REFUND_RE.test(text)) {
    return { category: 'refund_request', domainUnit: null, pureEscalation: true, escalates: true };
  }
  if (SPECIAL_DISCOUNT_RE.test(text)) {
    return { category: 'special_discount', domainUnit: null, pureEscalation: false, escalates: true };
  }
  if (CLAIM_RE.test(text)) {
    return { category: 'claim_request', domainUnit: null, pureEscalation: true, escalates: true };
  }
  if (ACCIDENT_LIABILITY_RE.test(text)) {
    return { category: 'accident_liability', domainUnit: detectDomainHint(text), pureEscalation: true, escalates: true };
  }
  if (SAFETY_GUARANTEE_RE.test(text)) {
    const domain = detectDomainHint(text);
    return { category: 'safety_guarantee', domainUnit: domain, pureEscalation: false, escalates: domain !== null };
  }
  if (BAD_REVIEW_THREAT_RE.test(text)) {
    return { category: 'bad_review_threat', domainUnit: null, pureEscalation: true, escalates: true };
  }
  if (SEVERE_ALLERGY_MEDICAL_RE.test(text)) {
    return { category: 'severe_allergy_medical', domainUnit: detectDomainHint(text), pureEscalation: false, escalates: true };
  }
  if (UNVERIFIED_AVAILABILITY_RE.test(text)) {
    return { category: 'unverified_availability', domainUnit: 'stay', pureEscalation: false, escalates: true };
  }

  return null;
}
