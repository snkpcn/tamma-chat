// Composes the customer-facing acknowledgment for a classified service-
// feedback message (see _service-mind-feedback-intent.ts). Same shape
// discipline as _local-concierge-response.ts: short, warm, natural Thai,
// never robotic over-apologizing, never overpromising a specific outcome
// the system can't actually guarantee (see THONGTHAI_BRAIN.md's
// Operational Truth Doctrine -- never say something succeeded before it
// actually did).
import type { ServiceFeedbackMatch, BusinessUnit } from './_service-mind-feedback-intent';

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

export function composeSafetyIssueResponse(match: ServiceFeedbackMatch, notificationQueued: boolean): string {
  const lines = [
    'ขอบคุณที่แจ้งนะครับ 🙏 เรื่องความปลอดภัยทองไทยขอรับไว้ก่อนเลยครับ',
    'สภาพพื้นจริงหน้างานต้องให้ทีมดูอีกทีเพื่อความชัวร์ครับ',
    routingLine(notificationQueued),
  ];
  if (match.businessUnit !== 'unknown') {
    lines.splice(1, 0, `ทองไทยแจ้งทีม${BUSINESS_UNIT_LABEL_TH[match.businessUnit]}ให้ตรวจสอบหน้างานครับ`);
  }
  return lines.join(' ');
}

export function composeSystemFeedbackResponse(notificationQueued: boolean): string {
  return [
    'ขอบคุณที่บอกนะครับ 🙏 ทองไทยจะเอาไปปรับปรุงครับ',
    'ถ้าอยากให้ตอบสั้นลง ละเอียดขึ้น หรือแนะนำแนวอื่น บอกทองไทยได้เลยครับ',
    routingLine(notificationQueued),
  ].join(' ');
}

export function composeServiceFeedbackResponse(match: ServiceFeedbackMatch, notificationQueued: boolean): string {
  switch (match.feedbackType) {
    case 'complaint': return composeComplaintResponse(match, notificationQueued);
    case 'compliment': return composeComplimentResponse(match, notificationQueued);
    case 'suggestion': return composeSuggestionResponse(notificationQueued);
    case 'safety_issue': return composeSafetyIssueResponse(match, notificationQueued);
    case 'system_feedback': return composeSystemFeedbackResponse(notificationQueued);
  }
}
