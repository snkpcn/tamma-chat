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
  otop: 'OTOP/สินค้าชุมชน',
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

export function composeIncidentResponse(
  match: ServiceFeedbackMatch,
  eventStored: boolean,
  targets: FeedbackTargetResult[],
): string {
  const opener = 'รับเรื่องของหายไว้ให้แล้วครับ ทองไทยจะช่วยประสานทีมตรวจสอบให้ 🙏';
  if (!eventStored) {
    return composeLineShortReply([
      opener,
      'ตอนนี้ระบบบันทึกเคสไม่สำเร็จ รบกวนแจ้งพนักงานหน้างานทันทีเพื่อไม่ให้เสียเวลาค้นหาครับ',
    ]);
  }
  const domainLabel = match.businessUnit !== 'unknown' && match.businessUnit !== 'general'
    ? BUSINESS_UNIT_LABEL_TH[match.businessUnit] : null;
  return composeLineShortReply([
    opener,
    composeNotificationStatusLine(domainLabel, targets),
    'ช่วยบอกของที่หาย จุดที่เห็นครั้งสุดท้าย และเวลาประมาณให้ทองไทยเพิ่มอีกนิดครับ',
  ]);
}

export type SemanticIncidentResponseLanguage = 'th' | 'en' | 'zh' | 'lo' | 'vi';

const SEMANTIC_INCIDENT_UNIT_LABEL: Record<SemanticIncidentResponseLanguage, Partial<Record<BusinessUnit, string>>> = {
  th: {
    restaurant: 'ร้านอาหาร', activity: 'กิจกรรม', stay: 'ที่พัก', cafe: 'คาเฟ่',
    otop: 'OTOP/สินค้าชุมชน', membership: 'ทีมดูแลระบบสมาชิก',
  },
  en: {
    restaurant: 'restaurant', activity: 'activity', stay: 'stay', cafe: 'café',
    otop: 'OTOP', membership: 'membership',
  },
  zh: {
    restaurant: '餐厅', activity: '活动', stay: '住宿', cafe: '咖啡店',
    otop: 'OTOP', membership: '会员服务',
  },
  lo: {
    restaurant: 'ຮ້ານອາຫານ', activity: 'ກິດຈະກຳ', stay: 'ທີ່ພັກ', cafe: 'ຄາເຟ',
    otop: 'OTOP', membership: 'ສະມາຊິກ',
  },
  vi: {
    restaurant: 'nhà hàng', activity: 'hoạt động', stay: 'lưu trú', cafe: 'cà phê',
    otop: 'OTOP', membership: 'thành viên',
  },
};

function semanticIncidentDeliveryLine(
  language: SemanticIncidentResponseLanguage,
  businessUnit: BusinessUnit,
  targets: FeedbackTargetResult[],
): string {
  const ok = (status: FeedbackTargetResult['status']) => status === 'sent' || status === 'duplicate';
  const owner = targets.find(target => target.team === 'owner_general');
  const domain = targets.find(target => target.team !== 'owner_general');
  const ownerOk = owner ? ok(owner.status) : false;
  const domainOk = domain ? ok(domain.status) : false;
  const label = SEMANTIC_INCIDENT_UNIT_LABEL[language][businessUnit] ?? '';

  if (language === 'th') {
    const domainLabel = domain ? (label || 'ที่เกี่ยวข้อง') : null;
    return composeNotificationStatusLine(domainLabel, targets);
  }

  if (!domain) {
    if (ownerOk) {
      if (language === 'zh') return '已发送给负责人核查。';
      if (language === 'lo') return 'ທອງໄທສົ່ງໃຫ້ເຈົ້າຂອງກວດສອບແລ້ວ.';
      if (language === 'vi') return 'Thongthai đã gửi việc này cho chủ sở hữu kiểm tra.';
      return 'Thongthai has sent this to the owner for review.';
    }
    if (language === 'zh') return '通知暂时未发送成功，但事项已记录，团队会继续核查。';
    if (language === 'lo') return 'ການແຈ້ງເຕືອນຍັງບໍ່ສຳເລັດ ແຕ່ລະບົບບັນທຶກເລື່ອງໄວ້ແລ້ວ.';
    if (language === 'vi') return 'Thông báo chưa gửi thành công, nhưng vụ việc đã được ghi nhận để đội ngũ kiểm tra.';
    return 'The notification did not send successfully, but the case is recorded for review.';
  }

  if (domainOk && ownerOk) {
    if (language === 'zh') return `已发送给${label || '相关'}团队和负责人核查。`;
    if (language === 'lo') return `ທອງໄທສົ່ງໃຫ້ທີມ${label || 'ທີ່ກ່ຽວຂ້ອງ'} ແລະເຈົ້າຂອງກວດສອບແລ້ວ.`;
    if (language === 'vi') return `Thongthai đã gửi cho đội ${label || 'liên quan'} và chủ sở hữu kiểm tra.`;
    return `Thongthai has sent this to the ${label || 'relevant'} team and the owner for review.`;
  }
  if (domainOk) {
    if (language === 'zh') return `已发送给${label || '相关'}团队；负责人通知暂未成功。`;
    if (language === 'lo') return `ສົ່ງໃຫ້ທີມ${label || 'ທີ່ກ່ຽວຂ້ອງ'}ແລ້ວ ແຕ່ການແຈ້ງເຈົ້າຂອງຍັງບໍ່ສຳເລັດ.`;
    if (language === 'vi') return `Đã gửi cho đội ${label || 'liên quan'}; thông báo cho chủ sở hữu chưa thành công.`;
    return `It has reached the ${label || 'relevant'} team; the owner notification has not succeeded yet.`;
  }
  if (ownerOk) {
    if (language === 'zh') return '相关团队尚未直接收到通知，但负责人已收到并会核查。';
    if (language === 'lo') return 'ທີມຍັງບໍ່ໄດ້ຮັບໂດຍກົງ ແຕ່ເຈົ້າຂອງໄດ້ຮັບແລ້ວ.';
    if (language === 'vi') return 'Đội liên quan chưa nhận trực tiếp, nhưng chủ sở hữu đã nhận để kiểm tra.';
    return 'The team has not received it directly yet, but the owner has received it for review.';
  }
  if (language === 'zh') return '通知暂时未发送成功，但事项已记录，团队会继续核查。';
  if (language === 'lo') return 'ການແຈ້ງເຕືອນຍັງບໍ່ສຳເລັດ ແຕ່ລະບົບບັນທຶກເລື່ອງໄວ້ແລ້ວ.';
  if (language === 'vi') return 'Thông báo chưa gửi thành công, nhưng vụ việc đã được ghi nhận để đội ngũ kiểm tra.';
  return 'The notification did not send successfully, but the case is recorded for review.';
}

/** Phase 5 semantic-incident acknowledgement. Used only when the semantic
 * supervisor recognized an incident/help/complaint that the earlier raw
 * deterministic guardrails did not. It is intentionally deterministic:
 * business truth and notification truth come from the durable event result,
 * never from an LLM draft. */
export function composeSemanticIncidentResponse(
  match: ServiceFeedbackMatch,
  eventStored: boolean,
  targets: FeedbackTargetResult[],
  language: SemanticIncidentResponseLanguage,
): string {
  if (!eventStored) {
    if (language === 'zh') return '已收到这件事，但系统暂时无法保存记录。为了不耽误处理，请直接告知现场工作人员。';
    if (language === 'lo') return 'ທອງໄທຮັບຮູ້ເລື່ອງແລ້ວ ແຕ່ລະບົບຍັງບັນທຶກເຄສບໍ່ສຳເລັດ ກະລຸນາແຈ້ງພະນັກງານໜ້າງານໂດຍກົງ.';
    if (language === 'vi') return 'Thongthai đã tiếp nhận, nhưng hệ thống chưa lưu được vụ việc. Vui lòng báo trực tiếp cho nhân viên tại chỗ để không chậm xử lý.';
    if (language === 'en') return 'Thongthai has received this, but the system could not save the case. Please tell on-site staff directly so follow-up is not delayed.';
    return 'ทองไทยรับเรื่องไว้ครับ แต่ตอนนี้ระบบบันทึกเคสไม่สำเร็จ รบกวนแจ้งพนักงานหน้างานโดยตรงเพื่อไม่ให้การดูแลล่าช้าครับ';
  }

  let opener: string;
  if (language === 'zh') opener = match.feedbackType === 'safety_issue' ? '已记录为安全事项，谢谢你立即告知。' : '已记录这件事，谢谢你直接告诉我。';
  else if (language === 'lo') opener = match.feedbackType === 'safety_issue' ? 'ທອງໄທຮັບເລື່ອງຄວາມປອດໄພໄວ້ແລ້ວ ຂອບໃຈທີ່ແຈ້ງ.' : 'ທອງໄທຮັບເລື່ອງໄວ້ແລ້ວ ຂອບໃຈທີ່ບອກ.';
  else if (language === 'vi') opener = match.feedbackType === 'safety_issue' ? 'Thongthai đã ghi nhận đây là vấn đề an toàn. Cảm ơn bạn đã báo ngay.' : 'Thongthai đã ghi nhận vụ việc. Cảm ơn bạn đã nói thẳng.';
  else if (language === 'en') opener = match.feedbackType === 'safety_issue' ? 'Thongthai has logged this as a safety concern. Thank you for reporting it right away.' : 'Thongthai has logged this for follow-up. Thank you for telling me directly.';
  else opener = match.feedbackType === 'safety_issue'
    ? 'ทองไทยรับเรื่องความปลอดภัยไว้แล้วครับ ขอบคุณที่รีบแจ้งนะครับ'
    : 'ทองไทยรับเรื่องไว้แล้วครับ ขอบคุณที่บอกตรง ๆ นะครับ';

  return composeLineShortReply([
    opener,
    semanticIncidentDeliveryLine(language, match.businessUnit, targets),
  ]);
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
    case 'incident': return composeIncidentResponse(match, eventResult?.eventId != null, eventResult?.targets ?? []);
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
