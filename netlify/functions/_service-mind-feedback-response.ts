// Composes the customer-facing acknowledgment for a classified service-
// feedback message (see _service-mind-feedback-intent.ts). Same shape
// discipline as _local-concierge-response.ts: short, warm, natural Thai,
// never robotic over-apologizing, never overpromising a specific outcome
// the system can't actually guarantee (see THONGTHAI_BRAIN.md's
// Operational Truth Doctrine -- never say something succeeded before it
// actually did).
import type { ServiceFeedbackMatch, BusinessUnit } from './_service-mind-feedback-intent';
import type { EscalationMatch, EscalationCategory } from './_boundary-classifier';
import type { FeedbackTargetResult } from './_ops-notifications';
import { composeLineShortReply } from './_chat-copy-style';

const BUSINESS_UNIT_LABEL_TH: Record<BusinessUnit, string> = {
  restaurant: 'ร้านอาหาร',
  activity: 'กิจกรรม',
  stay: 'ที่พัก',
  cafe: 'คาเฟ่',
  membership: 'ระบบสมาชิก',
  system: 'ระบบทองไทย',
  general: 'ทำมา-ชาติ',
  unknown: '',
};

/** The one honest closing line, chosen by whether the event actually got
 *  queued/sent -- never claims delivery before it happened (per
 *  Operational Truth Doctrine), but also never a bare "อาจจะ" hedge when
 *  it genuinely succeeded. */
function routingLine(notificationQueued: boolean): string {
  return notificationQueued
    ? 'ทองไทยส่งเรื่องให้ทีมที่เกี่ยวข้องแล้วครับ'
    : 'ทองไทยจะส่งต่อให้เจ้านายกับทีมที่เกี่ยวข้องครับ';
}

export function composeComplaintResponse(match: ServiceFeedbackMatch, notificationQueued: boolean): string {
  const lines = ['ขอโทษจริง ๆ ครับที่ทำให้รู้สึกแบบนั้น 🙏 ทองไทยขอรับเรื่องไว้ให้ครับ'];
  if (match.businessUnit === 'unknown') {
    lines.push('เรื่องเกิดที่ส่วนไหนครับ ร้านอาหาร ที่พัก กิจกรรม หรือระบบทองไทย');
  } else {
    lines.push(`ขอรายละเอียดเพิ่มอีกนิดได้ไหมครับ จะได้ส่งต่อให้ทีม${BUSINESS_UNIT_LABEL_TH[match.businessUnit]}ดูแลได้ตรงจุด`);
  }
  lines.push(routingLine(notificationQueued));
  return lines.join(' ');
}

export function composeComplimentResponse(match: ServiceFeedbackMatch, notificationQueued: boolean): string {
  const lines = ['ดีใจมากเลยครับ 😊'];
  if (!match.staffName) {
    lines.push('ถ้าจำชื่อพนักงานหรือโซนที่ดูแลได้ บอกทองไทยได้นะครับ');
  }
  lines.push(`เดี๋ยวทองไทยจะส่งคำชม${match.staffName ? `ถึง${match.staffName}` : ''}ไปให้เจ้านายกับทีมงานครับ ทีมจะได้มีกำลังใจ`);
  if (notificationQueued) lines.push('(' + routingLine(true) + ')');
  return lines.join(' ');
}

export function composeSuggestionResponse(notificationQueued: boolean): string {
  return [
    'ไอเดียดีเลยครับ ขอบคุณมากครับ 😊',
    'ทองไทยจดไว้ส่งให้เจ้านายดูนะครับ',
    routingLine(notificationQueued),
  ].join(' ');
}

/** Shared by every composer that needs to say PRECISELY which
 *  notification target(s) actually sent -- never a blanket "ส่งเรียบร้อย
 *  แล้ว" that overclaims one half of a partial delivery (Operational
 *  Truth Doctrine). `domainLabel` is null when there is no separate
 *  domain team target at all (the message routes to owner_general only). */
export function composeNotificationStatusLine(domainLabel: string | null, targets: FeedbackTargetResult[]): string {
  const isSent = (status: FeedbackTargetResult['status']) => status === 'sent' || status === 'duplicate';
  const domainTarget = targets.find(t => t.team !== 'owner_general');
  const ownerTarget = targets.find(t => t.team === 'owner_general');
  const domainOk = domainTarget ? isSent(domainTarget.status) : false;
  const ownerOk = ownerTarget ? isSent(ownerTarget.status) : false;

  if (!domainTarget) {
    return ownerOk
      ? 'ทองไทยส่งให้เจ้าของตรวจสอบแล้วครับ'
      : 'ตอนนี้ระบบแจ้งเตือนไม่สำเร็จ ทองไทยบันทึกเรื่องไว้แล้ว เดี๋ยวให้ทีมตรวจสอบครับ';
  }
  const label = domainLabel || 'ที่เกี่ยวข้อง';
  if (domainOk && ownerOk) return `ทองไทยส่งให้ทีม${label}และเจ้าของตรวจสอบแล้วครับ`;
  if (domainOk && !ownerOk) return `ทองไทยส่งให้ทีม${label}แล้วครับ ส่วนแจ้งเจ้าของยังไม่สำเร็จ ทีมจะตรวจสอบต่อครับ`;
  if (!domainOk && ownerOk) return 'ทีมยังไม่ได้รับแจ้งโดยตรง แต่ทองไทยส่งให้เจ้าของตรวจสอบแล้วครับ';
  return 'ตอนนี้ระบบแจ้งเตือนทีมไม่สำเร็จ ทองไทยบันทึกเรื่องไว้แล้ว เดี๋ยวให้ทีมตรวจสอบครับ';
}

// A safety report escalates to BOTH the relevant domain team and
// owner_general (see _ops-notifications.ts's needsOwnerEscalation) -- the
// reply must say precisely which of those two actually got the message,
// never a blanket "ส่งเรียบร้อยแล้ว" that overclaims one half of a partial
// delivery (Operational Truth Doctrine). Kept to 3 short lines (see
// THONGTHAI_HANDOFF.md's "Post-PR67 Polish" LINE-brevity rules) --
// safety acknowledgment, the no-definite-verdict hedge, then one honest
// status line.
export function composeSafetyIssueResponse(
  match: ServiceFeedbackMatch,
  eventStored: boolean,
  targets: FeedbackTargetResult[],
): string {
  const opener = 'ขอบคุณที่แจ้งนะครับ 🙏 เรื่องความปลอดภัยทองไทยรับไว้ก่อนเลยครับ';
  // Never a real ground-condition/safety verdict from Thongthai itself --
  // this line does double duty: it's the safety-doctrine hedge (no
  // definite "ปลอดภัยแน่นอน"/"พื้นลื่นแน่นอน" claim) AND the honest "a
  // human will actually check" reassurance, for both an on-site safety
  // REPORT and a safety QUESTION (both classify as safety_issue).
  const hedgeLine = 'สภาพพื้นจริงหน้างานต้องให้ทีมดูอีกทีเพื่อความชัวร์ครับ';

  if (!eventStored) {
    // Storage itself failed -- never claim stored or sent (Operational
    // Truth Doctrine's strictest case).
    return composeLineShortReply([
      opener,
      'ตอนนี้ระบบบันทึกเรื่องไม่สำเร็จ ขอโทษด้วยครับ รบกวนแจ้งพนักงานหน้างานโดยตรงเพื่อความชัวร์ครับ',
    ]);
  }

  const domainLabel = match.businessUnit !== 'unknown' && match.businessUnit !== 'general'
    ? BUSINESS_UNIT_LABEL_TH[match.businessUnit] : null;
  return composeLineShortReply([opener, hedgeLine, composeNotificationStatusLine(domainLabel, targets)]);
}

export function composeSystemFeedbackResponse(notificationQueued: boolean): string {
  return [
    'ขอบคุณที่บอกนะครับ 🙏 ทองไทยจะเอาไปปรับปรุงครับ',
    'ถ้าอยากให้ตอบสั้นลง ละเอียดขึ้น หรือแนะนำแนวอื่น บอกทองไทยได้เลยครับ',
    routingLine(notificationQueued),
  ].join(' ');
}

export function composeServiceFeedbackResponse(
  match: ServiceFeedbackMatch,
  notificationQueued: boolean,
  eventResult?: { eventId: string | null; targets: FeedbackTargetResult[] },
): string {
  switch (match.feedbackType) {
    case 'complaint': return composeComplaintResponse(match, notificationQueued);
    case 'compliment': return composeComplimentResponse(match, notificationQueued);
    case 'suggestion': return composeSuggestionResponse(notificationQueued);
    case 'safety_issue': return composeSafetyIssueResponse(match, eventResult?.eventId != null, eventResult?.targets ?? []);
    case 'system_feedback': return composeSystemFeedbackResponse(notificationQueued);
  }
}

// Master Roadmap Phase 1 -- deterministic guardrail wording for a
// message naming a topic outside Thongthai's authority (refund/
// discount/claim/liability/safety-guarantee/reputational-threat/severe-
// medical-risk/unverified-availability). The LLM never drafts these --
// this composer is the ENTIRE reply, always, per the owner's explicit
// Phase 1 decision ("Do NOT let the LLM draft a nuanced answer before
// routing"). Wording for refund_request, special_discount,
// accident_liability, and the domain-tied/generic safety_guarantee
// cases is the owner's own verbatim text from that decision; the
// remaining categories (claim_request, bad_review_threat,
// severe_allergy_medical, unverified_availability) were not given
// verbatim text and were written to match the same tone/structure.
const ESCALATION_OPENER: Record<EscalationCategory, string> = {
  refund_request: 'เรื่องคืนเงิน/เงื่อนไขการชำระ ทองไทยขอไม่ยืนยันแทนเจ้าของนะครับ 🙏',
  special_discount: 'ส่วนลดพิเศษอาจต้องให้เจ้าของหรือทีมดูแลราคาเช็กเงื่อนไขให้ครับ 😊',
  claim_request: 'เรื่องเคลม/ค่าเสียหาย ทองไทยขอไม่ตัดสินใจแทนเจ้าของนะครับ 🙏',
  accident_liability: 'เรื่องความรับผิดชอบกรณีอุบัติเหตุ ทองไทยขอไม่ตอบแทนเจ้าของแบบมั่ว ๆ นะครับ 🙏',
  safety_guarantee: 'ทองไทยไม่อยากรับประกันแทนทีมแบบ 100% นะครับ 🙏\nทีมหน้างานจะช่วยประเมินและดูแลตามสถานการณ์จริงให้ดีที่สุดครับ',
  bad_review_threat: 'ขอบคุณที่บอกความรู้สึกตรง ๆ นะครับ 🙏 ทองไทยไม่อยากให้เรื่องนี้ค้างคาใจแน่นอนครับ',
  severe_allergy_medical: 'ขอบคุณที่บอกนะครับ 🙏 เรื่องนี้ทองไทยไม่อยากเดาแทนทีมครับ',
  unverified_availability: 'ห้องว่างช่วงนี้ทองไทยขอเช็กกับทีมให้ชัวร์อีกทีนะครับ 🙏 ไม่อยากเดาให้ผิดพลาดครับ',
};

const ESCALATION_NEXT_QUESTION: Partial<Record<EscalationCategory, string>> = {
  special_discount: 'ขอทราบวัน เวลา และบริการที่สนใจคร่าว ๆ ได้ไหมครับ?',
};

export function composeEscalationResponse(
  match: EscalationMatch,
  eventStored: boolean,
  targets: FeedbackTargetResult[],
): string {
  // The one non-escalating instance: a bare, generic safety-guarantee
  // question with no named activity -- owner's own instruction: "If
  // generic: answer with no guarantee, ask context." No feedback event,
  // no notification, just the honest answer.
  if (match.category === 'safety_guarantee' && !match.escalates) {
    return composeLineShortReply([
      'ทองไทยไม่อยากรับประกันแทนทีมแบบ 100% นะครับ 🙏',
      'ทีมหน้างานจะช่วยประเมินและดูแลตามสถานการณ์จริงให้ดีที่สุดครับ',
      'ถ้ามีเด็ก ผู้สูงอายุ หรือกังวลเรื่องสุขภาพ บอกทองไทยได้เลยครับ เดี๋ยวช่วยส่งให้ทีมดูให้เหมาะครับ',
    ]);
  }

  const opener = ESCALATION_OPENER[match.category];
  if (!eventStored) {
    return composeLineShortReply([
      opener,
      'ตอนนี้ระบบบันทึกเรื่องไม่สำเร็จ ขอโทษด้วยครับ รบกวนแจ้งพนักงานหน้างานโดยตรงเพื่อความชัวร์ครับ',
    ]);
  }
  const domainLabel = match.domainUnit ? BUSINESS_UNIT_LABEL_TH[match.domainUnit] : null;
  return composeLineShortReply([
    opener,
    composeNotificationStatusLine(domainLabel, targets),
    ESCALATION_NEXT_QUESTION[match.category] ?? '',
  ]);
}
