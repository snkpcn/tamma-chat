export type OwnerStaffTurn = {
  employeeLabel: string | null;
  kind: 'unknown' | 'salary_advance' | 'salary_payment' | 'purchase';
  amount: number | null;
};

function clean(text: string): string {
  return text.trim().replace(/[๐-๙]/gu, digit => String('๐๑๒๓๔๕๖๗๘๙'.indexOf(digit)))
    .replace(/\s+/g, ' ').replace(/^(?:@?ทองไทย)[\s,:：]*/u, '')
    .replace(/\s*(?:นะครับ|ครับ|คับ|นะคะ|ค่ะ)[.!。]*$/u, '').trim();
}

/** A family-directed group message is not an instruction to the bot. */
export function isOwnerFamilyConversation(rawText: string): boolean {
  const text = rawText.trim();
  if (/^@?ทองไทย(?:[\s,:：]|$)/u.test(text)) return false;
  return /^(?:คุณแม่|คุณพ่อ|แม่|พ่อ)(?:[\s,:：]|ครับ|คับ|คะ|ค่ะ|จ๋า|$)/u.test(text);
}

export function isOwnerStaffCorrectionText(rawText: string): boolean {
  return /ไม่ใช่|(?:แก้|เปลี่ยน)(?:ชื่อ(?:คนเบิก)?(?:เป็น|คือ)?|เป็น)|ไม่ได้เบิก(?:เงินเดือน|[^.!?]{0,30}ซื้อ)[^.!?]*(?:เป็น|แต่|ไปซื้อ|ซื้อ)/u.test(clean(rawText));
}

export function isOwnerStaffAmbiguousText(rawText: string): boolean {
  const text = clean(rawText);
  return /เบิก|เงินเดือน/u.test(text) && /(?:และ|กับ|อีกคน|คนละ|แบ่งให้|ทั้งสอง|ทั้งคู่)/u.test(text);
}

/** Guard also used by legacy payroll, so rejected prose cannot fall through. */
export function isOwnerStaffUnsafeText(rawText: string): boolean {
  const text = clean(rawText);
  return isOwnerFamilyConversation(rawText) || isOwnerStaffAmbiguousText(text)
    || /(?:^|[^\d])-\s*\d/u.test(text)
    || /(?:ไม่ใช่|ยังไม่(?:ได้)?เบิก|ไม่ได้เบิก|ไม่เบิก|ไม่ต้องเบิก|(?:ไม่ได้ให้|ไม่ให้|ไม่มี)[^\n]{0,30}เบิก|(?:จะ|เดี๋ยว|พรุ่งนี้|ค่อย)[^\n]{0,30}(?:เบิก|จ่ายเงินเดือน|โอนเงินเดือน)|ยกเลิก|เท่าไหร่|เท่าไร|เบิกอะไร|ไหม|มั้ย|หรือเปล่า|เหรอ|หรอ|ถามว่า|บอกว่า|\?)/u.test(text);
}

/** Extract only a person label; never retain conversational framing as a name. */
export function normalizeOwnerStaffEmployee(rawLabel: string): string | null {
  const label = rawLabel.trim()
    .replace(/^(?:(?:สลิปนี้|รายการนี้|อันนี้|เงินนี้)(?:คือ|เป็น)?(?:เงิน)?(?:ของ)?|เป็นของ)\s*/u, '')
    .replace(/^(?:พนักงาน|ลูกน้อง)\s*/u, '')
    .replace(/\s*(?:นะครับ|ครับ|คับ|นะคะ|ค่ะ|นะ)$/u, '').trim();
  if (!label || /^(?:ไปซื้อ|ไปจ่าย|เงินเดือน|ซื้อของ|ส่วนกลาง|กิจการ|เบิก|ของ|เป็น|ให้|ค่า)/u.test(label)
    || /^(?:พนักงาน|ลูกน้อง|เงินเดือน|เงิน|ไป|ให้|ซื้อของ|ใคร|ของ|ค่า|ไม่|ยัง)$/u.test(label)
    || /ไม่ใช่|ไม่ได้|ยังไม่|บอกว่า|ถามว่า|คนไหน|อะไร|สลิป|รายการ|อันนี้|(?:และ|กับ|หรือ)/u.test(label)
    || isOwnerFamilyConversation(label)) return null;
  return /^[\p{L}\p{M}][\p{L}\p{M} .-]{0,59}$/u.test(label) ? label : null;
}

function replacementForCorrection(text: string): string | null {
  return text.match(/^ไม่ใช่.+?(?:[,，]\s*|\s+)?(?:แต่(?:เป็น)?|เป็น)\s*(.+)$/u)?.[1]
    ?? text.match(/^(?:แก้|เปลี่ยน)ชื่อ(?:คนเบิก)?(?:เป็น|คือ)?\s*(.+)$/u)?.[1]
    ?? text.match(/^(?:แก้|เปลี่ยน)เป็น\s*(.+)$/u)?.[1]
    ?? text.match(/^ไม่ใช่(?:เบิก)?เงินเดือน(?:ล่วงหน้า)?\s*[,，]?\s*(?:แต่)?\s*(ไปซื้อ.+|ซื้อ.+|สำรองจ่าย.*)$/u)?.[1]
    ?? text.match(/^.*?ไม่ได้เบิก(?:เงินเดือน|[^.!?]{0,30}ซื้อ)[^.!?]*?(?:แต่(?:เป็น)?|เป็น)\s*(.+)$/u)?.[1]
    ?? null;
}

function amountFromText(text: string): number | 'invalid' | null {
  // Joined Thai such as "เจิดเบิก200บาท" must still participate in slip matching.
  // Dates/pay-period labels are not amounts.
  const withoutDates = text.replace(/\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\d{1,2}[-.]\d{1,2}[-.]\d{2,4}/gu, '')
    .replace(/วันที่\s*\d+/gu, '')
    .replace(/(?:^|\s)(?:เดือน|ปี)\s*[\p{L}\p{M}]*\s*\d+/gu, '');
  const amountText = withoutDates.match(/\d[\d,]*(?:\.\d+)?/u)?.[0];
  if (amountText) {
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/u.test(amountText)) return 'invalid';
    const value = Number(amountText.replace(/,/g, ''));
    return Number.isFinite(value) && value > 0 ? value : 'invalid';
  }
  const words = text.match(/((?:(?:ศูนย์|หนึ่ง|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า|เอ็ด|ยี่|สิบ|ร้อย|พัน|หมื่น|แสน|ล้าน))+)\s*บาท/u)?.[1];
  if (!words) return null;
  const digits: Record<string,number> = {ศูนย์:0,หนึ่ง:1,สอง:2,สาม:3,สี่:4,ห้า:5,หก:6,เจ็ด:7,แปด:8,เก้า:9,เอ็ด:1,ยี่:2};
  const scales: Record<string,number> = {สิบ:10,ร้อย:100,พัน:1000,หมื่น:10000,แสน:100000,ล้าน:1000000};
  let total = 0, pending: number | null = null;
  for (const word of words.match(/ศูนย์|หนึ่ง|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า|เอ็ด|ยี่|สิบ|ร้อย|พัน|หมื่น|แสน|ล้าน/gu) ?? []) {
    if (digits[word] !== undefined) pending = digits[word]!;
    else if (word === 'ล้าน') { total = (total + (pending ?? 0) || 1) * 1000000; pending = null; }
    else { total += (pending ?? 1) * scales[word]!; pending = null; }
  }
  const value = total + (pending ?? 0);
  return value > 0 ? value : 'invalid';
}

/** Ordinary Thai around a slip. A bare "เบิก" never implies salary or purchasing. */
export function parseOwnerStaffTurn(rawText: string, priorPurpose?: string | null): OwnerStaffTurn | null {
  if (isOwnerFamilyConversation(rawText)) return null;
  const original = clean(rawText);
  if (/^(?:สรุป|ยอด|หักเบิก|หักเงินเบิก|หักเงินเดือน|รอแก้ไขรายละเอียดสลิป)/u.test(original)) return null;
  const correction = isOwnerStaffCorrectionText(original);
  const replacement = correction ? replacementForCorrection(original) : null;
  if (correction && !replacement) return null;
  const text = replacement ?? original;
  if (isOwnerStaffUnsafeText(text)) return null;
  const prior = priorPurpose ? parseOwnerStaffTurn(priorPurpose) : null;
  const hasAdvance = /เบิก/u.test(text);
  const isSalaryReply = /^(?:เป็น)?(?:เบิก)?เงินเดือน(?:ล่วงหน้า)?(?:\s|$)|^ล่วงหน้า$/u.test(text);
  const isPurchaseReply = /(?:เบิก(?:เงิน)?(?:ไป)?ซื้อ|เบิก(?:เงิน)?(?:ไป)?จ่าย|ไปซื้อ|ซื้อของ|สำรองจ่าย|^(?:เป็น)?(?:ไป)?ซื้อ)/u.test(text);
  const isBusinessReply = /^(?:เป็น|ของ)?(?:กิจการ|ร้าน)?\s*(?:ส่วนกลาง|ครัว|ร้านอาหาร|ร้านกาแฟ|อินทนิล|อินทนิน|inthanin|ตำมา[\s-]*ชาติ|เฮือนสเตย์|ผจญภัย|otop)\s*$/iu.test(text);
  const isPurchaseDetail = Boolean(prior?.kind === 'purchase'
    && /ซื้อ|ค่า|ของกิจการ|ของร้าน|อินทนิล|อินทนิน|inthanin|ตำมา|เฮือนสเตย์|ผจญภัย|ส่วนกลาง/iu.test(text));
  const isAmountReply = Boolean(prior && /^[\d,]+(?:\.\d{1,2})?\s*(?:บาท)?$/u.test(text));
  const isSalaryPayment = /^(?:จ่าย|โอน)เงินเดือน/u.test(text);
  const isNameReply = Boolean(prior && (!prior.employeeLabel || correction) && normalizeOwnerStaffEmployee(text)
    && !/เงินเดือน|ซื้อ|จ่าย|ส่วนกลาง|กิจการ|ร้าน|โครงการ/u.test(text));
  if (!hasAdvance && !isSalaryPayment && !(prior && (isSalaryReply || isPurchaseReply || isNameReply || isBusinessReply || isPurchaseDetail || isAmountReply))) return null;

  const before = text.match(/^([\p{L}\p{M} .-]{1,100}?)\s*(?:ขอ)?เบิก/u)?.[1];
  const after = text.match(/^(?:เบิก(?:เงินเดือน(?:ล่วงหน้า)?|เงินล่วงหน้า|เงิน)?(?:ให้)?|(?:จ่าย|โอน)เงินเดือน)\s*([\p{L}\p{M} .-]+?)(?=\s*\d|$)/u)?.[1];
  const recipient = text.match(/^โอน(?:เงิน)?(?:ไป)?ให้\s*([\p{L}\p{M} .-]+?)(?=\s*\d|\s+เป็นเงิน|\s+เบิก|$)/u)?.[1];
  const named = normalizeOwnerStaffEmployee(before ?? '') ?? normalizeOwnerStaffEmployee(after ?? '')
    ?? normalizeOwnerStaffEmployee(recipient ?? '') ?? (isNameReply ? normalizeOwnerStaffEmployee(text) : null);
  const rejectedPrior = Boolean(correction && prior?.employeeLabel
    && (original.startsWith('ไม่ใช่' + prior.employeeLabel) || original.startsWith('ไม่ใช่ ' + prior.employeeLabel)));
  const employeeLabel = named ?? (rejectedPrior ? null : prior?.employeeLabel ?? null);
  const renamed = Boolean(correction && named && prior?.employeeLabel && named !== prior.employeeLabel);
  const kind: OwnerStaffTurn['kind'] = isPurchaseReply ? 'purchase'
    : isSalaryPayment ? 'salary_payment'
    : (/เบิกเงินเดือน|เงินเดือนล่วงหน้า/u.test(text) || (prior && isSalaryReply)) ? 'salary_advance'
    : renamed ? 'unknown' : prior?.kind ?? 'unknown';
  const amount = amountFromText(text);
  return amount === 'invalid' ? null : { employeeLabel, kind, amount };
}

/** Financial turns must never fill arbitrary fields of a construction draft. */
export function isOwnerFinancialTopic(rawText: string): boolean {
  const text = clean(rawText);
  return /เบิก|เงินเดือน|สลิป|ใบเสร็จ|สำรองจ่าย|คืนเงิน|ชำระ|^(?:จ่าย(?:เงิน|ค่า)|โอน(?:เงิน|จ่าย)|ซื้อ)/u.test(text);
}

export function isOwnerScheduleAnswer(rawText: string): boolean {
  const text = clean(rawText);
  return !isOwnerFinancialTopic(text) && !isOwnerFamilyConversation(rawText)
    && /(?:วันนี้|พรุ่งนี้|มะรืน|เมื่อวาน|วัน(?:จันทร์|อังคาร|พุธ|พฤหัส|ศุกร์|เสาร์|อาทิตย์|ที่)|เดือน|สัปดาห์|อาทิตย์นี้|อาทิตย์หน้า|ภายใน|ก่อน|หลัง|กำหนด|เริ่ม|สิ้น|ต้น|กลาง|ทุกวัน|ทุกเดือน|อีก\s*\d+\s*(?:วัน|คืน|เดือน|สัปดาห์)|\d{1,2}[\/.-]\d{1,2}|^\d+\s*(?:วัน|คืน|เดือน|สัปดาห์)$)/u.test(text);
}
