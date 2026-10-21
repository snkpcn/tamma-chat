/** Customer-facing replies for a turn that could not be answered normally,
 *  chosen by the REAL cause and written in the customer's language.
 *
 *  One flat "คิดช้ากว่าปกติ ลองพิมพ์อีกครั้ง" used to cover every failure,
 *  including a conversation that had run out of its AI budget. Retrying can
 *  never help there -- the budget does not come back within the conversation
 *  -- so the customer typed the same thing again and got the same apology.
 *
 *  - budget_exhausted: say plainly that a detailed answer is not possible in
 *    this chat, point to the specific questions that are answered from live
 *    data without the model, and include the verified catalog. Never "retry".
 *  - provider_unavailable: the model is down or slow; retrying can help.
 *  - turn_unfinished: the turn ran out of time. Orders are mentioned only
 *    when the message itself was a transaction.
 *
 *  Every language the site offers (th, en, zh, lo, vi) is written out; any
 *  other falls back to English, never to Thai. */
import type { CustomerLanguage } from './_customer-language';
import { LLMAvailabilityError, LLMBudgetBlockedError } from './_thongthai-model-provider';
import { hasExplicitTransactionIntent } from './_local-concierge-intent';

/** A booking/order/payment request, for the "no duplicate order" wording.
 *  hasExplicitTransactionIntent alone is the strict same-turn COMMIT check
 *  and misses ordinary requests ("ขอจองขี่ม้า 2 คน พรุ่งนี้", "สั่งต้มแซ่บ 1 ที่");
 *  a question about a menu or a price matches neither. */
const TRANSACTION_VERB_RE = /(?:จอง|สั่ง|ชำระ|จ่ายเงิน|โอนเงิน|ยกเลิก|เลื่อน|\b(?:book|booking|order|reserve|reservation|pay|payment|cancel)\b)/iu;
export function isTransactionMessage(message: string): boolean {
  return hasExplicitTransactionIntent(message) || TRANSACTION_VERB_RE.test(message);
}

export type FallbackCause = 'budget_exhausted' | 'provider_unavailable' | 'turn_unfinished';
export type DegradedCategory = 'weather' | 'booking' | 'information' | 'feedback' | 'casual';

type Texts = Partial<Record<CustomerLanguage, string>> & { th: string; en: string };
const pick = (texts: Texts, language: CustomerLanguage): string => texts[language] ?? texts.en;

/** Budget exhaustion surfaces as LLMBudgetBlockedError, which deliberately
 *  still extends LLMAvailabilityError; it must be checked first. */
export function fallbackCauseOf(error: unknown): { cause: 'budget_exhausted' | 'provider_unavailable'; reason: string | null } | null {
  if (error instanceof LLMBudgetBlockedError) return { cause: 'budget_exhausted', reason: error.budgetReason };
  if (error instanceof LLMAvailabilityError) return { cause: 'provider_unavailable', reason: error.message.slice(0, 80) };
  return null;
}

const PROVIDER_UNAVAILABLE: Record<DegradedCategory, Texts> = {
  weather: {
    th: 'ตอนนี้ทองไทยเช็กสภาพอากาศไม่ทันครับ ลองถามอีกครั้งในอีกสักครู่ หรือเช็กแอปพยากรณ์อากาศคู่กันไปก่อนนะครับ',
    en: 'I can’t check the weather right now. Please ask again in a moment, or check a weather app in the meantime.',
    zh: '现在暂时查不到天气。请稍后再问，或先看一下天气应用。',
    lo: 'ຕອນນີ້ຍັງກວດສອບສະພາບອາກາດບໍ່ໄດ້. ກະລຸນາຖາມໃໝ່ອີກຈັກໜ້ອຍ ຫຼື ເບິ່ງແອັບພະຍາກອນອາກາດໄປກ່ອນ.',
    vi: 'Hiện tôi chưa kiểm tra được thời tiết. Vui lòng hỏi lại sau ít phút hoặc xem ứng dụng thời tiết trước.',
  },
  booking: {
    th: 'ตอนนี้ระบบจองของทองไทยตอบช้ากว่าปกติครับ ข้อมูลที่พิมพ์มายังไม่หายไปไหน ลองส่งอีกครั้งในอีกสักครู่นะครับ',
    en: 'The booking system is responding slowly right now. What you typed hasn’t been lost — please send it again in a moment.',
    zh: '预订系统现在反应较慢。您输入的内容没有丢失，请稍后再发送一次。',
    lo: 'ລະບົບຈອງຕອບຊ້າກວ່າປົກກະຕິ. ຂໍ້ຄວາມທີ່ພິມມາຍັງບໍ່ເສຍ ກະລຸນາສົ່ງໃໝ່ອີກຈັກໜ້ອຍ.',
    vi: 'Hệ thống đặt chỗ đang phản hồi chậm. Nội dung bạn nhập chưa bị mất, vui lòng gửi lại sau ít phút.',
  },
  // A question about the shop (hours, menu, prices) that is not a booking:
  // "ระบบจอง" would describe a system the customer never used.
  information: {
    th: 'ตอนนี้ทองไทยดึงข้อมูลมาตอบคำถามนี้ไม่ทันครับ ลองถามอีกครั้งในอีกสักครู่นะครับ',
    en: 'I couldn’t get the information to answer this just now. Please ask again in a moment.',
    zh: '现在暂时取不到回答这个问题所需的信息，请稍后再问。',
    lo: 'ຕອນນີ້ຍັງດຶງຂໍ້ມູນມາຕອບຄຳຖາມນີ້ບໍ່ທັນ ກະລຸນາຖາມໃໝ່ອີກຈັກໜ້ອຍ.',
    vi: 'Hiện tôi chưa lấy được thông tin để trả lời câu này. Vui lòng hỏi lại sau ít phút.',
  },
  feedback: {
    th: 'ขอบคุณสำหรับข้อความนี้ครับ ตอนนี้ระบบตอบช้ากว่าปกติเล็กน้อย รบกวนส่งอีกครั้งในอีกสักครู่ เพื่อให้ทองไทยรับเรื่องไว้อย่างถูกต้องครับ',
    en: 'Thank you for this message. The system is a little slow right now — please send it again in a moment so I can record it properly.',
    zh: '谢谢您的留言。系统现在有点慢，请稍后再发送一次，以便正确记录。',
    lo: 'ຂອບໃຈສຳລັບຂໍ້ຄວາມນີ້. ຕອນນີ້ລະບົບຊ້າເລັກນ້ອຍ ກະລຸນາສົ່ງໃໝ່ອີກຈັກໜ້ອຍ ເພື່ອບັນທຶກໄວ້ຢ່າງຖືກຕ້ອງ.',
    vi: 'Cảm ơn tin nhắn của bạn. Hệ thống đang hơi chậm, vui lòng gửi lại sau ít phút để tôi ghi nhận chính xác.',
  },
  casual: {
    th: 'ทองไทยอยู่นี่ครับ แต่ตอนนี้คิดช้ากว่าปกตินิดหนึ่ง ลองพิมพ์อีกครั้งในอีกสักครู่นะครับ 😊',
    en: 'I’m here, but I’m a little slower than usual right now. Please try again in a moment 😊',
    zh: '我在这里，不过现在反应比平时慢一点，请稍后再试 😊',
    lo: 'ທອງໄທຢູ່ນີ້ ແຕ່ຕອນນີ້ຕອບຊ້າກວ່າປົກກະຕິໜ້ອຍໜຶ່ງ ກະລຸນາລອງໃໝ່ອີກຈັກໜ້ອຍ 😊',
    vi: 'Tôi vẫn ở đây, nhưng hiện phản hồi chậm hơn bình thường một chút. Vui lòng thử lại sau ít phút 😊',
  },
};

/** The same message arrived twice (its eventId was already claimed). */
const DUPLICATE_DELIVERY: Texts = {
  th: 'ข้อความนี้ส่งเข้ามาซ้ำครับ ทองไทยรับไว้แล้วรอบหนึ่ง ถ้ายังไม่เห็นคำตอบ พิมพ์ถามใหม่ได้เลยครับ',
  en: 'This message arrived twice; I already received it once. If you don’t see my answer, just ask again.',
  zh: '这条消息重复发送了两次，我已经收到过一次。如果没看到回复，请再问一次。',
  lo: 'ຂໍ້ຄວາມນີ້ສົ່ງມາຊ້ຳ ທອງໄທໄດ້ຮັບແລ້ວຮອບໜຶ່ງ. ຖ້າຍັງບໍ່ເຫັນຄຳຕອບ ພິມຖາມໃໝ່ໄດ້ເລີຍ.',
  vi: 'Tin nhắn này đã được gửi hai lần; tôi đã nhận một lần rồi. Nếu bạn chưa thấy câu trả lời, hãy hỏi lại nhé.',
};

export function duplicateDeliveryMessage(language: CustomerLanguage): string {
  return pick(DUPLICATE_DELIVERY, language);
}

/** The model's reply named a figure that is not in our data. */
const UNGROUNDED_NUMBER: Texts = {
  th: 'ตัวเลขที่จะตอบเรื่องนี้ ทองไทยยืนยันจากข้อมูลในระบบไม่ได้ครับ ถามแบบเจาะจงได้เลย เช่น ราคากิจกรรม เมนู หรือเวลาเปิด ทองไทยตอบจากข้อมูลจริงได้ทันทีครับ',
  en: 'I can’t confirm the figures for this from our system. Ask something specific — an activity price, the menu, or opening hours — and I’ll answer from our live information.',
  zh: '这个问题涉及的数字，我无法从系统中确认。可以问具体的问题，例如活动价格、菜单或营业时间，我会根据实时信息回答。',
  lo: 'ຕົວເລກຂອງເລື່ອງນີ້ ຍັງຢືນຢັນຈາກລະບົບບໍ່ໄດ້. ຖາມແບບສະເພາະໄດ້ເລີຍ ເຊັ່ນ ລາຄາກິດຈະກຳ ເມນູ ຫຼື ເວລາເປີດ ຈະຕອບຈາກຂໍ້ມູນຈິງທັນທີ.',
  vi: 'Tôi không xác nhận được các con số cho câu này từ hệ thống. Bạn có thể hỏi cụ thể như giá hoạt động, thực đơn hoặc giờ mở cửa, tôi sẽ trả lời theo thông tin thực tế.',
};

export function ungroundedNumberMessage(language: CustomerLanguage): string {
  return pick(UNGROUNDED_NUMBER, language);
}

export function providerUnavailableMessage(category: DegradedCategory, language: CustomerLanguage): string {
  return pick(PROVIDER_UNAVAILABLE[category], language);
}

const BUDGET_EXHAUSTED_LEAD: Texts = {
  th: 'ตอนนี้ทองไทยตอบคำถามแบบนี้ให้ละเอียดในแชตนี้ไม่ได้แล้วครับ แต่ถามแบบเจาะจงได้เลย เช่น ราคากิจกรรม เมนู หรือเวลาเปิด ทองไทยตอบจากข้อมูลจริงได้ทันทีครับ',
  en: 'I can’t give a detailed answer to this in this chat anymore, but you can ask something specific — an activity price, the menu, or opening hours — and I’ll answer from our live information right away.',
  zh: '在这个对话里我已经无法详细回答这类问题，但可以问具体的问题，例如活动价格、菜单或营业时间，我会马上根据实时信息回答。',
  lo: 'ໃນແຊັດນີ້ ທອງໄທຕອບຄຳຖາມແບບນີ້ລະອຽດບໍ່ໄດ້ແລ້ວ ແຕ່ຖາມແບບສະເພາະໄດ້ເລີຍ ເຊັ່ນ ລາຄາກິດຈະກຳ ເມນູ ຫຼື ເວລາເປີດ ຈະຕອບຈາກຂໍ້ມູນຈິງທັນທີ.',
  vi: 'Trong cuộc trò chuyện này tôi không thể trả lời chi tiết câu hỏi kiểu này nữa, nhưng bạn có thể hỏi cụ thể như giá hoạt động, thực đơn hoặc giờ mở cửa, tôi sẽ trả lời ngay theo thông tin thực tế.',
};

/** `catalogLines` are the verified experienceCatalogLines for this turn. */
export function budgetExhaustedMessage(language: CustomerLanguage, catalogLines: string[]): string {
  return [pick(BUDGET_EXHAUSTED_LEAD, language), ...(catalogLines.length ? ['', ...catalogLines] : [])].join('\n');
}

const TURN_UNFINISHED: Texts = {
  th: 'ตอนนี้ทองไทยตอบไม่ทันในรอบนี้ครับ ลองส่งข้อความเดิมอีกครั้งได้เลยครับ',
  en: 'I couldn’t finish answering in time. Please send the same message again.',
  zh: '这次没能及时回复，请再发送一次相同的消息。',
  ja: '今回は時間内にお答えできませんでした。同じメッセージをもう一度送ってください。',
  ko: '이번에는 제때 답변하지 못했습니다. 같은 메시지를 다시 보내 주세요.',
  lo: 'ຮອບນີ້ຕອບບໍ່ທັນ ກະລຸນາສົ່ງຂໍ້ຄວາມເດີມອີກຄັ້ງ.',
  vi: 'Lần này tôi chưa kịp trả lời. Vui lòng gửi lại tin nhắn đó.',
};

/** Web: an uncertain backend failure after a transaction must not invite a
 *  blind resubmission, so staff are asked to check first. */
const TURN_UNFINISHED_TRANSACTION_WEB: Texts = {
  th: 'ตอนนี้ทองไทยตรวจสอบข้อมูลไม่สำเร็จครับ หากเพิ่งส่งคำขอจองหรือสั่งซื้อ ทองไทยยังยืนยันผลไม่ได้ กรุณาให้พนักงานตรวจสอบก่อนส่งคำขอซ้ำครับ',
  en: 'I could not verify the information. If you just submitted a booking or order, please ask staff to check its status before submitting again.',
  zh: '暂时无法核实信息。如果您刚提交预订或订单，请先联系工作人员确认状态，再决定是否重新提交。',
  ja: '情報を確認できませんでした。予約や注文を送信した直後の場合は、再送信する前にスタッフへ状況をご確認ください。',
  ko: '정보를 확인하지 못했습니다. 방금 예약이나 주문을 제출했다면 다시 제출하기 전에 직원에게 상태를 확인해 주세요.',
  lo: 'ຕອນນີ້ຍັງກວດສອບຂໍ້ມູນບໍ່ໄດ້. ຖ້າຫາກສົ່ງຄຳຂໍຈອງ ຫຼື ສັ່ງຊື້ແລ້ວ ກະລຸນາໃຫ້ພະນັກງານກວດສອບສະຖານະກ່ອນສົ່ງຊ້ຳ.',
  vi: 'Hiện tôi chưa xác minh được thông tin. Nếu bạn vừa gửi yêu cầu đặt chỗ hoặc đặt hàng, vui lòng nhờ nhân viên kiểm tra trạng thái trước khi gửi lại.',
};

/** LINE: the turn claim makes a redelivered order idempotent, so resending
 *  is safe and the customer is told so. */
const TURN_UNFINISHED_TRANSACTION_LINE: Texts = {
  th: 'ทองไทยรับข้อความแล้วครับ แต่ระบบตอบกลับไม่ทันในรอบนี้\n\nถ้าเพิ่งส่งคำสั่งเดิมซ้ำ ระบบจะไม่สร้างออเดอร์ซ้ำครับ\nลองส่งข้อความเดิมอีกครั้ง หรือพิมพ์ “ดูออเดอร์ล่าสุด” ได้เลย',
  en: 'I received your message but couldn’t reply in time.\n\nIf you just sent the same request again, no duplicate order will be created.\nSend the same message again, or type “ดูออเดอร์ล่าสุด” to see your latest order.',
  zh: '已收到您的消息，但这次没能及时回复。\n\n如果您刚重复发送了同样的请求，系统不会重复创建订单。\n请再发送一次相同的消息，或输入“ดูออเดอร์ล่าสุด”查看最新订单。',
  lo: 'ໄດ້ຮັບຂໍ້ຄວາມແລ້ວ ແຕ່ຮອບນີ້ຕອບກັບບໍ່ທັນ.\n\nຖ້າຫາກສົ່ງຄຳຂໍເດີມຊ້ຳ ລະບົບຈະບໍ່ສ້າງອໍເດີຊ້ຳ.\nສົ່ງຂໍ້ຄວາມເດີມອີກຄັ້ງ ຫຼື ພິມ “ดูออเดอร์ล่าสุด” ເພື່ອເບິ່ງອໍເດີລ່າສຸດ.',
  vi: 'Tôi đã nhận được tin nhắn nhưng chưa kịp trả lời.\n\nNếu bạn vừa gửi lại cùng một yêu cầu, hệ thống sẽ không tạo đơn trùng.\nHãy gửi lại tin nhắn đó, hoặc gõ “ดูออเดอร์ล่าสุด” để xem đơn gần nhất.',
};

export function turnUnfinishedMessage(language: CustomerLanguage, transactional: boolean, channel: 'web' | 'line'): string {
  if (!transactional) return pick(TURN_UNFINISHED, language);
  return pick(channel === 'line' ? TURN_UNFINISHED_TRANSACTION_LINE : TURN_UNFINISHED_TRANSACTION_WEB, language);
}

const RETRY_LABEL: Texts = { th: 'ลองอีกครั้ง', en: 'Try again', zh: '再试一次', lo: 'ລອງອີກຄັ້ງ', vi: 'Thử lại' };
export function retryLabel(language: CustomerLanguage): string {
  return pick(RETRY_LABEL, language);
}

/** One structured line per fallback, so the monitor and the logs show WHY a
 *  turn was not answered normally. No customer text is logged. */
export function logFallback(fields: {
  cause: FallbackCause; reason: string | null; channel: string; language: CustomerLanguage; eventId: string | null;
}): void {
  console.log('THONGTHAI_FALLBACK', JSON.stringify({
    cause: fields.cause, reason: fields.reason, channel: fields.channel, language: fields.language,
    event_id: fields.eventId?.slice(0, 180) ?? null,
  }));
}
