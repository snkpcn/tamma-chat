// Service Mind — feedback classification. Detects when a customer message
// is a compliment, complaint, suggestion, safety issue, or feedback about
// Thongthai itself, and infers which business unit and how urgently it
// needs staff attention. Same discipline as every other classifier in this
// codebase (_local-concierge-intent.ts, _deterministic-semantic-turn.ts):
// a small, closed set of structural/vocabulary markers, never a growing
// phrase table -- see THONGTHAI_BRAIN.md's conversationDoctrine.
//
// This module ONLY classifies. It never decides what to say (that's
// _service-mind-feedback-response.ts) and never writes anything
// (that's _service-mind-feedback-events.ts).
import { hasCommitMarker } from './_slot-parsers';

export type FeedbackType = 'compliment' | 'complaint' | 'suggestion' | 'safety_issue' | 'system_feedback';
export type BusinessUnit = 'restaurant' | 'activity' | 'stay' | 'cafe' | 'membership' | 'system' | 'general' | 'unknown';
export type Severity = 'low' | 'normal' | 'high' | 'urgent';

export type ServiceFeedbackMatch = {
  feedbackType: FeedbackType;
  businessUnit: BusinessUnit;
  severity: Severity;
  /** A staff member's name/honorific-name if the customer mentioned one
   *  (e.g. "พี่เจิด") -- never guessed, only extracted when actually
   *  present in the message. */
  staffName: string | null;
};

// --- structural markers -----------------------------------------------

// A real medical/physical emergency in progress always outranks every
// other classification -- checked first, and forces severity 'urgent'
// regardless of what else the message contains.
const URGENT_SAFETY_MARKER = /ไฟไหม้|ไฟลุก|ไฟช็อต|บาดเจ็บ|เลือดออก|อุบัติเหตุ|หมดสติ|แพ้อาหารรุนแรง|ช็อกอา|โดนไฟดูด|จมน้ำ/u;

// A safety CONCERN reported after the fact ("พื้นลื่นมาก น่ากลัว") --
// distinct from _local-concierge-intent.ts's safety_uncertainty (a
// customer asking "is it safe" BEFORE doing something) -- this is a
// customer reporting a scary/risky condition they already experienced or
// observed, which needs to reach staff, not just get general guidance.
const SAFETY_CONCERN_MARKER = /พื้นลื่น(?:มาก)?|น่ากลัว|เกือบ(?:ล้ม|ตก|ชน)|ไม่ปลอดภัย|เสี่ยงอันตราย|อันตรายมาก/u;

const COMPLAINT_MARKER = /แย่มาก|แย่จัง|ห่วย|รอนาน|นานมาก|ไม่พอใจ|ผิดหวัง|ไม่ประทับใจ|บริการแย่|ไม่(?:ค่อย)?สะอาด|สกปรก|เย็นชา|หยาบคาย|ไม่สุภาพ|ตำหนิ|ร้องเรียน/u;
const COMPLIMENT_MARKER = /ดูแลดีมาก|ดูแลดี|ประทับใจ|ชื่นชม|ขอชม|เก่งมาก|น่ารักมาก|บริการดี(?:มาก)?|ดีมากเลย|ยอดเยี่ยม/u;
const SUGGESTION_MARKER = /น่าจะมี|เสนอแนะ|ข้อเสนอแนะ|อยากให้มี|เสนอไอเดีย|ลองทำ.*ดูไหม|น่าจะเพิ่ม/u;

// Feedback specifically about Thongthai's OWN answers/behavior (not the
// physical business) -- "ทองไทยตอบยาวไป", "ทองไทยเข้าใจผิด".
const SYSTEM_FEEDBACK_MARKER = /ทองไทย(?:ตอบ|เข้าใจ|ช้า|งง|พิมพ์|แชท)|บอทตอบ|แชทบอท(?:ตอบ|ช้า)|ระบบแชท/u;

// --- business-unit inference --------------------------------------------

const BUSINESS_UNIT_MARKERS: ReadonlyArray<{ unit: BusinessUnit; pattern: RegExp }> = [
  // "ครัว" (kitchen) is deliberately NOT a bare marker here -- "ครอบครัว"
  // (family) contains it as a substring ("ครอบ" + "ครัว"), a real false-
  // positive collision confirmed while testing; "พ่อครัว"/"แม่ครัว" (chef)
  // are unambiguous compounds and safe to keep.
  { unit: 'restaurant', pattern: /ร้านอาหาร|อาหาร|เมนู|พนักงานเสิร์ฟ|รออาหาร|คิดเงิน|แคชเชียร์|เบียร์สด|พ่อครัว|แม่ครัว|เสิร์ฟ/u },
  { unit: 'activity', pattern: /ขี่ม้า|ม้า|ภาราดร|atv|เอทีวี|ยิงธนู|กิจกรรม|ไกด์|กลางแจ้ง/iu },
  { unit: 'stay', pattern: /ห้องพัก|เช็คอิน|เช็กอิน|เช็คเอาท์|เช็กเอาท์|แม่บ้าน|ที่พัก|เฮือน(?:สเตย์)?|ห้องน้ำในห้อง/u },
  { unit: 'cafe', pattern: /คาเฟ่|inthanin|อินทนิน|กาแฟ|เครื่องดื่ม/iu },
  { unit: 'membership', pattern: /สมาชิก|แต้ม|สิทธิ์|โปรโมชั่น|จ่ายเงิน|ชำระเงิน|บัตร/u },
  { unit: 'system', pattern: /ทองไทย(?:ตอบ|เข้าใจ|ช้า|งง)|บอทตอบ|แชทบอท|ระบบแชท|เว็บไซต์|แอป/iu },
];

function inferBusinessUnit(message: string): BusinessUnit {
  const hit = BUSINESS_UNIT_MARKERS.find(item => item.pattern.test(message));
  return hit?.unit ?? 'unknown';
}

// --- staff-name extraction ----------------------------------------------

// Only extracts a name that's ACTUALLY present after a staff honorific --
// never guesses, never invents. Non-greedy, bounded by the next common
// trailing word/whitespace/end-of-string (Thai has no spaces between
// words, so without this the capture would run on and swallow the rest
// of the sentence). "พี่เจิดดูแลดีมาก" -> "พี่เจิด".
const STAFF_NAME_RE = /(พี่|คุณ|น้อง)([ก-๙a-zA-Z]+?)(?=ดูแล|บริการ|เสิร์ฟ|ต้อนรับ|ช่วย|แนะนำ|เก่ง|น่ารัก|\s|$|ครับ|ค่ะ|คะ|คับ)/u;

function extractStaffName(message: string): string | null {
  const match = message.match(STAFF_NAME_RE);
  return match ? `${match[1]}${match[2]}` : null;
}

// --- classification -------------------------------------------------------

/**
 * Classifies a message as service feedback, or null if it doesn't
 * structurally match any feedback category. Deliberately does NOT check
 * hasExplicitTransactionIntent -- feedback must win precedence over a
 * bare "ยืนยัน" that happens to trail a complaint ("บริการแย่มาก ยืนยัน"
 * is a complaint, not a booking confirmation). The caller is responsible
 * for placing this classifier early enough in the routing chain that a
 * match here is never reached by transaction-processing code at all (see
 * its wiring in thongthai-chat.ts).
 */
export function classifyServiceFeedback(message: string): ServiceFeedbackMatch | null {
  const text = message.trim();
  if (!text) return null;

  const businessUnit = inferBusinessUnit(text);
  const staffName = extractStaffName(text);

  // Urgent safety always wins, regardless of what else the message says.
  if (URGENT_SAFETY_MARKER.test(text)) {
    return { feedbackType: 'safety_issue', businessUnit, severity: 'urgent', staffName };
  }
  if (SAFETY_CONCERN_MARKER.test(text)) {
    return { feedbackType: 'safety_issue', businessUnit, severity: 'high', staffName };
  }

  if (COMPLAINT_MARKER.test(text)) {
    // A complaint carrying a hard commit phrase in the SAME message
    // ("จองเลย"/"สั่งเลย") is still a complaint first -- but note it's
    // extremely rare for a real complaint to also contain one of these
    // (they're strong booking-action verbs, not ambiguous words like
    // "ยืนยัน"), so this is a defensive severity bump only, not a
    // reclassification away from complaint.
    const severity = hasCommitMarker(text) ? 'high' : 'normal';
    return { feedbackType: 'complaint', businessUnit, severity, staffName };
  }

  if (SYSTEM_FEEDBACK_MARKER.test(text)) {
    return { feedbackType: 'system_feedback', businessUnit: 'system', severity: 'low', staffName };
  }

  if (COMPLIMENT_MARKER.test(text)) {
    return { feedbackType: 'compliment', businessUnit, severity: 'low', staffName };
  }

  if (SUGGESTION_MARKER.test(text)) {
    return { feedbackType: 'suggestion', businessUnit, severity: 'low', staffName };
  }

  return null;
}
