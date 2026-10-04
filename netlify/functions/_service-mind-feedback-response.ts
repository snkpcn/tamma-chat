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
  const domainLabel = match.businessUnit !== 'unknown' && match.businessUnit !== 'general'
    ? BUSINESS_UNIT_LABEL_TH[match.businessUnit] : null;

  if (match.severity === 'urgent') {
    const opener = 'ทองไทยรับเรื่องด่วนแล้วครับ';
    const immediate = 'ถ้ายังมีอันตรายอยู่ ให้หยุดกิจกรรม ออกจากจุดเสี่ยง และเรียกพนักงานหน้างานทันทีครับ';
    const emergency = 'ถ้ามีผู้บาดเจ็บ หมดสติ หายใจผิดปกติ หรือเลือดออกมาก โทร 1669 ทันที; ถ้าเป็นไฟไหม้ โทร 199 ครับ';
    if (!eventStored) {
      return composeLineShortReply([
        opener,
        immediate,
        emergency,
        'ตอนนี้ระบบบันทึกเคสไม่สำเร็จ กรุณาแจ้งพนักงานหรือเจ้าหน้าที่หน้างานโดยตรงทันทีครับ',
      ]);
    }
    return composeLineShortReply([
      opener,
      immediate,
      emergency,
      composeNotificationStatusLine(domainLabel, targets),
    ]);
  }

  const opener = 'ขอบคุณที่แจ้งนะครับ เรื่องความปลอดภัยทองไทยรับไว้ก่อนเลยครับ';
  const hedgeLine = 'สภาพจริงหน้างานต้องให้ทีมตรวจอีกทีเพื่อความชัวร์ครับ';

  if (!eventStored) {
    return composeLineShortReply([
      opener,
      'ตอนนี้ระบบบันทึกเรื่องไม่สำเร็จ รบกวนแจ้งพนักงานหน้างานโดยตรงเพื่อความชัวร์ครับ',
    ]);
  }

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
  const issues = new Set(match.issueKeywords);
  const domainLabel = match.businessUnit !== 'unknown' && match.businessUnit !== 'general'
    ? BUSINESS_UNIT_LABEL_TH[match.businessUnit] : null;

  if (issues.has('missing_person')) {
    const lines = [
      'ทองไทยรับเรื่องคนพลัดหลงเป็นเรื่องด่วนแล้วครับ',
      'ให้อยู่ที่จุดที่ปลอดภัยและแจ้งพนักงานหน้างานทันที อย่าแยกย้ายกันค้นหาแบบไม่มีจุดนัดหมายครับ',
      'ถ้าเป็นเด็ก ผู้สูงอายุ หรือผู้ที่ต้องการการดูแล และยังหาไม่พบ ให้โทร 191 ได้ทันทีครับ',
    ];
    if (!eventStored) {
      lines.push('ตอนนี้ระบบบันทึกเคสไม่สำเร็จ กรุณาแจ้งพนักงานหรือเจ้าหน้าที่หน้างานโดยตรงทันทีครับ');
      return composeLineShortReply(lines);
    }
    lines.push(composeNotificationStatusLine(domainLabel, targets));
    lines.push('ช่วยบอกชื่อหรือลักษณะ จุดที่เห็นครั้งสุดท้าย และเวลาประมาณครับ');
    return composeLineShortReply(lines);
  }

  if (issues.has('threat_security')) {
    const lines = [
      'ทองไทยรับเรื่องความปลอดภัยนี้ไว้แล้วครับ',
      'ถ้ายังมีคนคุกคาม ข่มขู่ หรือเสี่ยงทำร้าย ให้ไปอยู่กับพนักงานหรือจุดที่มีคนทันที และอย่าเผชิญหน้าครับ',
      'ถ้าอันตรายกำลังเกิดขึ้น โทร 191 ได้ทันทีครับ',
    ];
    if (!eventStored) {
      lines.push('ตอนนี้ระบบบันทึกเคสไม่สำเร็จ กรุณาแจ้งพนักงานหรือเจ้าหน้าที่โดยตรงทันทีครับ');
      return composeLineShortReply(lines);
    }
    lines.push(composeNotificationStatusLine(domainLabel, targets));
    return composeLineShortReply(lines);
  }

  if (issues.has('food_illness')) {
    const lines = [
      'ทองไทยรับเรื่องอาการหลังรับประทานอาหารไว้แล้วครับ',
      'หยุดรับประทานรายการที่สงสัยไว้ก่อน และแจ้งพนักงานหน้างานทันทีครับ',
      'ถ้ามีหายใจลำบาก หน้าหรือปากบวม หมดสติ หรืออาการรุนแรง โทร 1669 ทันทีครับ',
    ];
    if (!eventStored) {
      lines.push('ตอนนี้ระบบบันทึกเคสไม่สำเร็จ กรุณาแจ้งพนักงานหรือเจ้าหน้าที่หน้างานโดยตรงทันทีครับ');
      return composeLineShortReply(lines);
    }
    lines.push(composeNotificationStatusLine(domainLabel, targets));
    lines.push('ถ้าสะดวก บอกเมนูที่ทานและเวลาที่เริ่มมีอาการให้ทองไทยเพิ่มในเคสครับ');
    return composeLineShortReply(lines);
  }

  const opener = 'รับเรื่องของหายไว้ให้แล้วครับ ทองไทยจะช่วยประสานทีมตรวจสอบให้ครับ';
  if (!eventStored) {
    return composeLineShortReply([
      opener,
      'ตอนนี้ระบบบันทึกเคสไม่สำเร็จ รบกวนแจ้งพนักงานหน้างานทันทีเพื่อไม่ให้เสียเวลาค้นหาครับ',
    ]);
  }
  return composeLineShortReply([
    opener,
    composeNotificationStatusLine(domainLabel, targets),
    'ช่วยบอกของที่หาย จุดที่เห็นครั้งสุดท้าย และเวลาประมาณให้ทองไทยเพิ่มอีกนิดครับ',
  ]);
}

export type SemanticIncidentResponseLanguage = 'th' | 'en' | 'zh' | 'lo' | 'vi' | 'ja' | 'ko';

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
  ja: {
    restaurant: 'レストラン', activity: 'アクティビティ', stay: '宿泊', cafe: 'カフェ',
    otop: 'OTOP', membership: '会員サポート',
  },
  ko: {
    restaurant: '레스토랑', activity: '액티비티', stay: '숙박', cafe: '카페',
    otop: 'OTOP', membership: '회원 지원',
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
      if (language === 'ja') return '担当責任者に確認を依頼しました。';
      if (language === 'ko') return '책임자에게 검토를 요청했습니다.';
      return 'Thongthai has sent this to the owner for review.';
    }
    if (language === 'zh') return '通知暂时未发送成功，但事项已记录，团队会继续核查。';
    if (language === 'lo') return 'ການແຈ້ງເຕືອນຍັງບໍ່ສຳເລັດ ແຕ່ລະບົບບັນທຶກເລື່ອງໄວ້ແລ້ວ.';
    if (language === 'vi') return 'Thông báo chưa gửi thành công, nhưng vụ việc đã được ghi nhận để đội ngũ kiểm tra.';
    if (language === 'ja') return '通知は送信できませんでしたが、確認できるよう案件を記録しました。';
    if (language === 'ko') return '알림 전송에는 실패했지만 검토할 수 있도록 건을 기록했습니다.';
    return 'The notification did not send successfully, but the case is recorded for review.';
  }

  if (domainOk && ownerOk) {
    if (language === 'zh') return `已发送给${label || '相关'}团队和负责人核查。`;
    if (language === 'lo') return `ທອງໄທສົ່ງໃຫ້ທີມ${label || 'ທີ່ກ່ຽວຂ້ອງ'} ແລະເຈົ້າຂອງກວດສອບແລ້ວ.`;
    if (language === 'vi') return `Thongthai đã gửi cho đội ${label || 'liên quan'} và chủ sở hữu kiểm tra.`;
    if (language === 'ja') return `${label || '担当'}チームと責任者に確認を依頼しました。`;
    if (language === 'ko') return `${label || '담당'} 팀과 책임자에게 검토를 요청했습니다.`;
    return `Thongthai has sent this to the ${label || 'relevant'} team and the owner for review.`;
  }
  if (domainOk) {
    if (language === 'zh') return `已发送给${label || '相关'}团队；负责人通知暂未成功。`;
    if (language === 'lo') return `ສົ່ງໃຫ້ທີມ${label || 'ທີ່ກ່ຽວຂ້ອງ'}ແລ້ວ ແຕ່ການແຈ້ງເຈົ້າຂອງຍັງບໍ່ສຳເລັດ.`;
    if (language === 'vi') return `Đã gửi cho đội ${label || 'liên quan'}; thông báo cho chủ sở hữu chưa thành công.`;
    if (language === 'ja') return `${label || '担当'}チームには届いていますが、責任者への通知はまだ成功していません。`;
    if (language === 'ko') return `${label || '담당'} 팀에는 전달됐지만 책임자 알림은 아직 성공하지 못했습니다.`;
    return `It has reached the ${label || 'relevant'} team; the owner notification has not succeeded yet.`;
  }
  if (ownerOk) {
    if (language === 'zh') return '相关团队尚未直接收到通知，但负责人已收到并会核查。';
    if (language === 'lo') return 'ທີມຍັງບໍ່ໄດ້ຮັບໂດຍກົງ ແຕ່ເຈົ້າຂອງໄດ້ຮັບແລ້ວ.';
    if (language === 'vi') return 'Đội liên quan chưa nhận trực tiếp, nhưng chủ sở hữu đã nhận để kiểm tra.';
    if (language === 'ja') return '担当チームにはまだ直接届いていませんが、責任者が確認できる状態です。';
    if (language === 'ko') return '담당 팀에는 아직 직접 전달되지 않았지만 책임자가 검토할 수 있도록 전달됐습니다.';
    return 'The team has not received it directly yet, but the owner has received it for review.';
  }
  if (language === 'zh') return '通知暂时未发送成功，但事项已记录，团队会继续核查。';
  if (language === 'lo') return 'ການແຈ້ງເຕືອນຍັງບໍ່ສຳເລັດ ແຕ່ລະບົບບັນທຶກເລື່ອງໄວ້ແລ້ວ.';
  if (language === 'vi') return 'Thông báo chưa gửi thành công, nhưng vụ việc đã được ghi nhận để đội ngũ kiểm tra.';
  if (language === 'ja') return '通知は送信できませんでしたが、確認できるよう案件を記録しました。';
  if (language === 'ko') return '알림 전송에는 실패했지만 검토할 수 있도록 건을 기록했습니다.';
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
    if (language === 'ja') return '内容は受け取りましたが、システムに記録できませんでした。対応が遅れないよう、現地スタッフへ直接お知らせください。';
    if (language === 'ko') return '내용은 접수했지만 시스템에 저장하지 못했습니다. 처리가 지연되지 않도록 현장 직원에게 직접 알려 주세요.';
    return 'ทองไทยรับเรื่องไว้ครับ แต่ตอนนี้ระบบบันทึกเคสไม่สำเร็จ รบกวนแจ้งพนักงานหน้างานโดยตรงเพื่อไม่ให้การดูแลล่าช้าครับ';
  }

  let opener: string;
  if (language === 'zh') opener = match.feedbackType === 'safety_issue' ? '已记录为安全事项，谢谢你立即告知。' : '已记录这件事，谢谢你直接告诉我。';
  else if (language === 'lo') opener = match.feedbackType === 'safety_issue' ? 'ທອງໄທຮັບເລື່ອງຄວາມປອດໄພໄວ້ແລ້ວ ຂອບໃຈທີ່ແຈ້ງ.' : 'ທອງໄທຮັບເລື່ອງໄວ້ແລ້ວ ຂອບໃຈທີ່ບອກ.';
  else if (language === 'vi') opener = match.feedbackType === 'safety_issue' ? 'Thongthai đã ghi nhận đây là vấn đề an toàn. Cảm ơn bạn đã báo ngay.' : 'Thongthai đã ghi nhận vụ việc. Cảm ơn bạn đã nói thẳng.';
  else if (language === 'en') opener = match.feedbackType === 'safety_issue' ? 'Thongthai has logged this as a safety concern. Thank you for reporting it right away.' : 'Thongthai has logged this for follow-up. Thank you for telling me directly.';
  else if (language === 'ja') opener = match.feedbackType === 'safety_issue' ? '安全上の問題として記録しました。すぐにお知らせいただきありがとうございます。' : '確認対応のため記録しました。率直にお知らせいただきありがとうございます。';
  else if (language === 'ko') opener = match.feedbackType === 'safety_issue' ? '안전 문제로 기록했습니다. 바로 알려 주셔서 감사합니다.' : '후속 확인을 위해 기록했습니다. 솔직하게 알려 주셔서 감사합니다.';
  else opener = match.feedbackType === 'safety_issue'
    ? 'ทองไทยรับเรื่องความปลอดภัยไว้แล้วครับ ขอบคุณที่รีบแจ้งนะครับ'
    : 'ทองไทยรับเรื่องไว้แล้วครับ ขอบคุณที่บอกตรง ๆ นะครับ';

  return composeLineShortReply([
    opener,
    semanticIncidentDeliveryLine(language, match.businessUnit, targets),
  ]);
}

function localizedRoutingLine(language:SemanticIncidentResponseLanguage, notificationQueued:boolean):string {
  if(language==='th') return routingLine(notificationQueued);
  if(language==='zh') return notificationQueued ? '已发送给相关团队。' : '已记录下来，Thongthai 会转给相关团队。';
  if(language==='lo') return notificationQueued ? 'ສົ່ງໃຫ້ທີມທີ່ກ່ຽວຂ້ອງແລ້ວ.' : 'ບັນທຶກເລື່ອງໄວ້ແລ້ວ ແລະຈະສົ່ງໃຫ້ທີມທີ່ກ່ຽວຂ້ອງ.';
  if(language==='vi') return notificationQueued ? 'Thongthai đã gửi việc này cho đội liên quan.' : 'Thongthai đã ghi nhận và sẽ chuyển cho đội liên quan.';
  if(language==='ja') return notificationQueued ? '担当チームに送信しました。' : '内容を記録し、担当チームに共有します。';
  if(language==='ko') return notificationQueued ? '담당 팀에 전달했습니다.' : '내용을 기록했으며 담당 팀에 전달하겠습니다.';
  return notificationQueued ? 'Thongthai has sent this to the relevant team.' : 'Thongthai has logged this and will pass it to the relevant team.';
}

function localizedFeedbackResponse(
  match:ServiceFeedbackMatch,
  notificationQueued:boolean,
  eventResult:{eventId:string|null;targets:FeedbackTargetResult[]}|undefined,
  language:SemanticIncidentResponseLanguage,
):string {
  if(language==='th') return '';
  if(match.feedbackType==='complaint' || match.feedbackType==='safety_issue' || match.feedbackType==='incident') {
    return composeSemanticIncidentResponse(match,eventResult?.eventId!=null,eventResult?.targets??[],language);
  }
  if(match.feedbackType==='compliment') {
    const opener=language==='zh'?'非常感谢你的表扬 😊'
      :language==='lo'?'ຂອບໃຈຫຼາຍສຳລັບຄຳຊົມ 😊'
      :language==='vi'?'Cảm ơn bạn rất nhiều vì lời khen 😊'
      :language==='ja'?'温かいお言葉をありがとうございます 😊'
      :language==='ko'?'따뜻한 말씀 정말 감사합니다 😊'
      :'Thank you so much for the kind feedback 😊';
    return composeLineShortReply([opener,localizedRoutingLine(language,notificationQueued)]);
  }
  if(match.feedbackType==='suggestion') {
    const opener=language==='zh'?'谢谢你的建议，这个想法很有帮助。'
      :language==='lo'?'ຂອບໃຈສຳລັບຄຳແນະນຳ ໄອເດຍນີ້ມີປະໂຫຍດ.'
      :language==='vi'?'Cảm ơn bạn đã góp ý, ý tưởng này rất hữu ích.'
      :language==='ja'?'ご提案ありがとうございます。とても参考になります。'
      :language==='ko'?'제안해 주셔서 감사합니다. 정말 도움이 됩니다.'
      :'Thanks for the suggestion — that’s genuinely useful.';
    return composeLineShortReply([opener,localizedRoutingLine(language,notificationQueued)]);
  }
  const opener=language==='zh'?'谢谢你直接告诉我，Thongthai 会把这条反馈用于改进。'
    :language==='lo'?'ຂອບໃຈທີ່ບອກກົງໆ ທອງໄທຈະນຳໄປປັບປຸງ.'
    :language==='vi'?'Cảm ơn bạn đã nói thẳng. Thongthai sẽ dùng phản hồi này để cải thiện.'
    :language==='ja'?'率直にお知らせいただきありがとうございます。改善に活かします。'
    :language==='ko'?'솔직하게 알려 주셔서 감사합니다. 개선에 반영하겠습니다.'
    :'Thanks for telling me directly. Thongthai will use this feedback to improve.';
  return composeLineShortReply([opener,localizedRoutingLine(language,notificationQueued)]);
}

export function composeServiceFeedbackResponse(
  match: ServiceFeedbackMatch,
  notificationQueued: boolean,
  eventResult?: { eventId: string | null; targets: FeedbackTargetResult[] },
  language: SemanticIncidentResponseLanguage = 'th',
): string {
  if(language!=='th') return localizedFeedbackResponse(match,notificationQueued,eventResult,language);
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
const ESCALATION_OPENER_EN: Record<EscalationCategory,string> = {
  refund_request:'For refunds or payment terms, Thongthai shouldn’t confirm a decision on the owner’s behalf.',
  special_discount:'A special discount needs the owner or pricing team to check the conditions first.',
  claim_request:'For a claim or compensation request, Thongthai shouldn’t decide on the owner’s behalf.',
  accident_liability:'For accident liability, Thongthai shouldn’t guess or decide on the owner’s behalf.',
  safety_guarantee:'Thongthai can’t guarantee safety 100%. The on-site team needs to assess the actual situation.',
  bad_review_threat:'Thank you for saying how you feel directly. Thongthai doesn’t want this left unresolved.',
  severe_allergy_medical:'Thank you for telling me. This needs the team to check carefully rather than Thongthai guessing.',
  unverified_availability:'Thongthai needs the stay team to verify current room availability rather than guessing.',
};
const ESCALATION_OPENER_ZH: Record<EscalationCategory,string> = {
  refund_request:'退款或付款条件需要由负责人确认，Thongthai 不会代替负责人做决定。',
  special_discount:'特别折扣需要负责人或价格团队先核对条件。',
  claim_request:'理赔或赔偿事项需要由负责人确认，Thongthai 不会代替负责人做决定。',
  accident_liability:'事故责任需要由负责人确认，Thongthai 不会猜测或代替负责人判断。',
  safety_guarantee:'Thongthai 不能保证 100% 安全，现场团队需要根据实际情况评估。',
  bad_review_threat:'谢谢你直接说出感受，Thongthai 不希望这件事一直悬着。',
  severe_allergy_medical:'谢谢你说明情况。这类问题需要团队认真确认，Thongthai 不会猜。',
  unverified_availability:'当前房态需要住宿团队核实，Thongthai 不会猜。',
};
const ESCALATION_OPENER_LO: Record<EscalationCategory,string> = {
  refund_request:'ເລື່ອງຄືນເງິນ ຫຼືເງື່ອນໄຂການຈ່າຍ ທອງໄທບໍ່ຄວນຢືນຢັນແທນເຈົ້າຂອງ.',
  special_discount:'ສ່ວນຫຼຸດພິເສດຕ້ອງໃຫ້ເຈົ້າຂອງ ຫຼືທີມລາຄາກວດເງື່ອນໄຂກ່ອນ.',
  claim_request:'ເລື່ອງເຄລມ ຫຼືຄ່າເສຍຫາຍ ທອງໄທບໍ່ຕັດສິນແທນເຈົ້າຂອງ.',
  accident_liability:'ເລື່ອງຄວາມຮັບຜິດຈາກອຸບັດຕິເຫດ ທອງໄທບໍ່ເດົາ ຫຼືຕັດສິນແທນເຈົ້າຂອງ.',
  safety_guarantee:'ທອງໄທບໍ່ສາມາດຮັບປະກັນຄວາມປອດໄພ 100%. ທີມໜ້າງານຕ້ອງປະເມີນຕາມສະພາບຈິງ.',
  bad_review_threat:'ຂອບໃຈທີ່ບອກຄວາມຮູ້ສຶກກົງໆ ທອງໄທບໍ່ຢາກໃຫ້ເລື່ອງນີ້ຄ້າງ.',
  severe_allergy_medical:'ຂອບໃຈທີ່ແຈ້ງ ເລື່ອງນີ້ຕ້ອງໃຫ້ທີມກວດໃຫ້ຊັດ ທອງໄທບໍ່ເດົາ.',
  unverified_availability:'ຫ້ອງວ່າງຕອນນີ້ຕ້ອງໃຫ້ທີມທີ່ພັກກວດຢືນຢັນ ທອງໄທບໍ່ເດົາ.',
};
const ESCALATION_OPENER_VI: Record<EscalationCategory,string> = {
  refund_request:'Việc hoàn tiền hoặc điều kiện thanh toán cần chủ sở hữu xác nhận; Thongthai không nên quyết định thay.',
  special_discount:'Giảm giá đặc biệt cần chủ sở hữu hoặc đội giá kiểm tra điều kiện trước.',
  claim_request:'Việc khiếu nại bồi thường cần chủ sở hữu xác nhận; Thongthai không quyết định thay.',
  accident_liability:'Trách nhiệm khi xảy ra tai nạn cần chủ sở hữu xác nhận; Thongthai không đoán hay quyết định thay.',
  safety_guarantee:'Thongthai không thể bảo đảm an toàn 100%. Đội tại chỗ cần đánh giá theo tình huống thực tế.',
  bad_review_threat:'Cảm ơn bạn đã nói thẳng cảm nhận. Thongthai không muốn việc này bị bỏ ngỏ.',
  severe_allergy_medical:'Cảm ơn bạn đã cho biết. Việc này cần đội ngũ kiểm tra kỹ, Thongthai không muốn đoán.',
  unverified_availability:'Tình trạng phòng hiện tại cần đội lưu trú kiểm tra xác nhận, Thongthai không muốn đoán.',
};
const ESCALATION_OPENER_JA: Record<EscalationCategory,string> = {
  refund_request:'返金や支払い条件は責任者の確認が必要なため、Thongthai が代理で決定することはできません。',
  special_discount:'特別割引は、責任者または料金担当チームが条件を確認する必要があります。',
  claim_request:'請求や補償については責任者の確認が必要なため、Thongthai が代理で決定することはできません。',
  accident_liability:'事故の責任については、Thongthai が推測したり責任者に代わって判断したりすることはできません。',
  safety_guarantee:'Thongthai は安全を100%保証できません。現地チームが実際の状況を確認する必要があります。',
  bad_review_threat:'率直なお気持ちをお知らせいただきありがとうございます。このままにせず対応します。',
  severe_allergy_medical:'お知らせいただきありがとうございます。推測ではなく、チームが慎重に確認する必要があります。',
  unverified_availability:'現在の空室状況は宿泊チームによる確認が必要なため、推測ではお答えしません。',
};
const ESCALATION_OPENER_KO: Record<EscalationCategory,string> = {
  refund_request:'환불이나 결제 조건은 책임자 확인이 필요하므로 Thongthai가 대신 결정할 수 없습니다.',
  special_discount:'특별 할인은 책임자 또는 가격 담당 팀이 조건을 먼저 확인해야 합니다.',
  claim_request:'청구나 보상 요청은 책임자 확인이 필요하므로 Thongthai가 대신 결정할 수 없습니다.',
  accident_liability:'사고 책임은 Thongthai가 추측하거나 책임자 대신 판단할 수 없습니다.',
  safety_guarantee:'Thongthai는 안전을 100% 보장할 수 없습니다. 현장 팀이 실제 상황을 확인해야 합니다.',
  bad_review_threat:'솔직한 마음을 알려 주셔서 감사합니다. 이 문제가 그대로 남지 않도록 확인하겠습니다.',
  severe_allergy_medical:'알려 주셔서 감사합니다. 추측하지 않고 담당 팀이 신중히 확인해야 하는 내용입니다.',
  unverified_availability:'현재 객실 상황은 숙박 팀의 확인이 필요하므로 추측해서 답하지 않겠습니다.',
};

function localizedEscalationOpener(language:SemanticIncidentResponseLanguage, category:EscalationCategory):string {
  if(language==='en') return ESCALATION_OPENER_EN[category];
  if(language==='zh') return ESCALATION_OPENER_ZH[category];
  if(language==='lo') return ESCALATION_OPENER_LO[category];
  if(language==='vi') return ESCALATION_OPENER_VI[category];
  if(language==='ja') return ESCALATION_OPENER_JA[category];
  if(language==='ko') return ESCALATION_OPENER_KO[category];
  return ESCALATION_OPENER[category];
}

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
  language: SemanticIncidentResponseLanguage = 'th',
): string {
  // The one non-escalating instance: a bare, generic safety-guarantee
  // question with no named activity -- owner's own instruction: "If
  // generic: answer with no guarantee, ask context." No feedback event,
  // no notification, just the honest answer.
  if (match.category === 'safety_guarantee' && !match.escalates) {
    if(language==='zh') return composeLineShortReply(['Thongthai 不能保证 100% 安全。','现场团队需要根据实际情况评估。','如果有儿童、老人或健康方面的顾虑，请告诉我，我会帮你把情况交给团队。']);
    if(language==='lo') return composeLineShortReply(['ທອງໄທບໍ່ສາມາດຮັບປະກັນຄວາມປອດໄພ 100%.','ທີມໜ້າງານຕ້ອງປະເມີນຕາມສະພາບຈິງ.','ຖ້າມີເດັກ ຜູ້ສູງອາຍຸ ຫຼືກັງວົນເລື່ອງສຸຂະພາບ ບອກທອງໄທໄດ້.']);
    if(language==='vi') return composeLineShortReply(['Thongthai không thể bảo đảm an toàn 100%.','Đội tại chỗ cần đánh giá theo tình huống thực tế.','Nếu có trẻ em, người lớn tuổi hoặc lo ngại về sức khỏe, hãy nói cho Thongthai biết để chuyển đúng thông tin cho đội ngũ.']);
    if(language==='en') return composeLineShortReply(['Thongthai can’t guarantee safety 100%.','The on-site team needs to assess the actual conditions.','If children, older guests, or health concerns are involved, tell me and I’ll pass that context to the team.']);
    if(language==='ja') return composeLineShortReply(['Thongthai は安全を100%保証できません。','現地チームが実際の状況を確認する必要があります。','お子様、高齢の方、健康上の心配がある場合は教えてください。チームに正確に共有します。']);
    if(language==='ko') return composeLineShortReply(['Thongthai는 안전을 100% 보장할 수 없습니다.','현장 팀이 실제 상황을 확인해야 합니다.','어린이, 고령자 또는 건강상 우려가 있다면 알려 주세요. 담당 팀에 정확히 전달하겠습니다.']);
    return composeLineShortReply([
      'ทองไทยไม่อยากรับประกันแทนทีมแบบ 100% นะครับ 🙏',
      'ทีมหน้างานจะช่วยประเมินและดูแลตามสถานการณ์จริงให้ดีที่สุดครับ',
      'ถ้ามีเด็ก ผู้สูงอายุ หรือกังวลเรื่องสุขภาพ บอกทองไทยได้เลยครับ เดี๋ยวช่วยส่งให้ทีมดูให้เหมาะครับ',
    ]);
  }

  const opener = localizedEscalationOpener(language,match.category);
  if (!eventStored) {
    const failed=language==='zh'?'现在暂时无法保存这件事。为避免耽误，请直接告知现场工作人员。'
      :language==='lo'?'ຕອນນີ້ລະບົບຍັງບັນທຶກເລື່ອງບໍ່ສຳເລັດ ກະລຸນາແຈ້ງພະນັກງານໜ້າງານໂດຍກົງ.'
      :language==='vi'?'Hiện hệ thống chưa lưu được vụ việc. Vui lòng báo trực tiếp cho nhân viên tại chỗ để không chậm xử lý.'
      :language==='en'?'The case could not be saved right now. Please tell on-site staff directly so follow-up is not delayed.'
      :language==='ja'?'現在、案件を保存できませんでした。対応が遅れないよう、現地スタッフへ直接お知らせください。'
      :language==='ko'?'현재 건을 저장하지 못했습니다. 처리가 지연되지 않도록 현장 직원에게 직접 알려 주세요.'
      :'ตอนนี้ระบบบันทึกเรื่องไม่สำเร็จ ขอโทษด้วยครับ รบกวนแจ้งพนักงานหน้างานโดยตรงเพื่อความชัวร์ครับ';
    return composeLineShortReply([opener,failed]);
  }
  const businessUnit=match.domainUnit??'general';
  const delivery=language==='th'
    ? composeNotificationStatusLine(match.domainUnit ? BUSINESS_UNIT_LABEL_TH[match.domainUnit] : null,targets)
    : semanticIncidentDeliveryLine(language,businessUnit,targets);
  const next=match.category==='special_discount'
    ? language==='zh'?'请告诉我大概的日期、时间和你感兴趣的服务。'
      :language==='lo'?'ຂໍວັນທີ ເວລາ ແລະບໍລິການທີ່ສົນໃຈໂດຍຄອບຄ່າ.'
      :language==='vi'?'Bạn cho Thongthai biết ngày, giờ và dịch vụ quan tâm sơ bộ nhé.'
      :language==='en'?'Please share the approximate date, time, and service you’re interested in.'
      :language==='ja'?'ご希望のおおよその日付、時間、サービスを教えてください。'
      :language==='ko'?'원하는 대략적인 날짜, 시간, 서비스를 알려 주세요.'
      :ESCALATION_NEXT_QUESTION[match.category] ?? ''
    :'';
  return composeLineShortReply([opener,delivery,next]);
}
