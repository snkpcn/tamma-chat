// Composes the customer-facing acknowledgment for a classified service-
// feedback message (see _service-mind-feedback-intent.ts). Same shape
// discipline as _local-concierge-response.ts: short, warm, natural Thai,
// never robotic over-apologizing, never overpromising a specific outcome
// the system can't actually guarantee (see THONGTHAI_BRAIN.md's
// Operational Truth Doctrine -- never say something succeeded before it
// actually did).
import type { ServiceFeedbackMatch, BusinessUnit } from './_service-mind-feedback-intent';
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

// A safety report escalates to BOTH the relevant domain team and
// owner_general (see _ops-notifications.ts's needsOwnerEscalation) -- the
// reply must say precisely which of those two actually got the message,
// never a blanket "ส่งเรียบร้อยแล้ว" that overclaims one half of a partial
// delivery (Operational Truth Doctrine). Kept to 2 short lines (see
// THONGTHAI_HANDOFF.md's "Post-PR67 Polish" LINE-brevity rules) --
// safety acknowledgment first, one honest status line second.
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

  const isSent = (status: FeedbackTargetResult['status']) => status === 'sent' || status === 'duplicate';
  const domainLabel = match.businessUnit !== 'unknown' && match.businessUnit !== 'general'
    ? BUSINESS_UNIT_LABEL_TH[match.businessUnit] : '';
  const domainTarget = targets.find(t => t.team !== 'owner_general');
  const ownerTarget = targets.find(t => t.team === 'owner_general');
  const domainOk = domainTarget ? isSent(domainTarget.status) : false;
  const ownerOk = ownerTarget ? isSent(ownerTarget.status) : false;

  let statusLine: string;
  if (!domainTarget) {
    // business_unit itself routes straight to owner_general (general/
    // membership/system/unknown) -- no separate domain team to mention.
    statusLine = ownerOk
      ? 'ทองไทยส่งให้เจ้าของตรวจสอบแล้วครับ'
      : 'ตอนนี้ระบบแจ้งเตือนไม่สำเร็จ ทองไทยบันทึกเรื่องไว้แล้ว เดี๋ยวให้ทีมตรวจสอบครับ';
  } else if (domainOk && ownerOk) {
    statusLine = `ทองไทยส่งให้ทีม${domainLabel || 'ที่เกี่ยวข้อง'}และเจ้าของตรวจสอบแล้วครับ`;
  } else if (domainOk && !ownerOk) {
    statusLine = `ทองไทยส่งให้ทีม${domainLabel || 'ที่เกี่ยวข้อง'}แล้วครับ ส่วนแจ้งเจ้าของยังไม่สำเร็จ ทีมจะตรวจสอบต่อครับ`;
  } else if (!domainOk && ownerOk) {
    statusLine = 'ทีมยังไม่ได้รับแจ้งโดยตรง แต่ทองไทยส่งให้เจ้าของตรวจสอบแล้วครับ';
  } else {
    statusLine = 'ตอนนี้ระบบแจ้งเตือนทีมไม่สำเร็จ ทองไทยบันทึกเรื่องไว้แล้ว เดี๋ยวให้ทีมตรวจสอบครับ';
  }
  return composeLineShortReply([opener, hedgeLine, statusLine]);
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
