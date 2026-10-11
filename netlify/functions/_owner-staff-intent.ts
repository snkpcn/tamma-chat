export type OwnerStaffTurn = {
  employeeLabel: string | null;
  kind: 'unknown' | 'salary_advance' | 'salary_payment' | 'purchase';
  amount: number | null;
};

function clean(text: string): string {
  return text.trim().replace(/\s+/g, ' ').replace(/^(?:@?ทองไทย)[\s,:：]*/u, '')
    .replace(/\s*(?:นะครับ|ครับ|คับ|นะคะ|ค่ะ)[.!。]*$/u, '').trim();
}

function employee(text: string): string | null {
  const label = text.trim().replace(/^(?:พนักงาน|ลูกน้อง)\s*/u, '').trim();
  if (!label || /^(?:ไปซื้อ|ไปจ่าย|เงินเดือน|ซื้อของ|ส่วนกลาง|กิจการ|เบิก)/u.test(label) || /^(?:พนักงาน|ลูกน้อง|เงินเดือน|เงิน|ไป|ให้|ซื้อของ|ใคร|ของ|ค่า|ไม่|ยัง)$/u.test(label)) return null;
  return /^[\p{L}\p{M}][\p{L}\p{M} .-]{0,59}$/u.test(label) ? label : null;
}

/** Ordinary Thai around a slip. A bare "เบิก" never implies salary. */
export function parseOwnerStaffTurn(rawText: string, priorPurpose?: string | null): OwnerStaffTurn | null {
  const text = clean(rawText);
  if (/(?:ยังไม่(?:ได้)?เบิก|ไม่ได้เบิก|ไม่เบิก|ไม่ต้องเบิก|(?:ไม่ได้ให้|ไม่ให้|ไม่มี)[^\n]{0,30}เบิก|(?:จะ|เดี๋ยว|พรุ่งนี้)[^\n]{0,30}เบิก|จะเบิก|ยกเลิก|เท่าไหร่|เท่าไร|เบิกอะไร|เบิกได้ไหม|\?)/u.test(text)) return null;
  const prior = priorPurpose ? parseOwnerStaffTurn(priorPurpose) : null;
  const hasAdvance = /เบิก/u.test(text);
  const isSalaryReply = /^(?:เป็น)?(?:เบิก)?เงินเดือน(?:ล่วงหน้า)?(?:\s|$)|^ล่วงหน้า$/u.test(text);
  const isPurchaseReply = /(?:เบิก(?:เงิน)?(?:ไป)?ซื้อ|เบิก(?:เงิน)?(?:ไป)?จ่าย|เบิกไป|ไปซื้อ|ซื้อของ|สำรองจ่าย)/u.test(text);
  const isBusinessReply = /^(?:เป็น|ของ)?(?:กิจการ|ร้าน)?\s*(?:ส่วนกลาง|ครัว|ร้านอาหาร|ร้านกาแฟ|อินทนิล|อินทนิน|inthanin|ตำมา[\s-]*ชาติ|เฮือนสเตย์|ผจญภัย|otop)\s*$/iu.test(text);
  const isPurchaseDetail = Boolean(prior?.kind === 'purchase'
    && /ซื้อ|ค่า|ของกิจการ|ของร้าน|อินทนิล|อินทนิน|inthanin|ตำมา|เฮือนสเตย์|ผจญภัย|ส่วนกลาง/iu.test(text));
  const isAmountReply = Boolean(prior && /^[\d,]+(?:\.\d{1,2})?\s*(?:บาท)?$/u.test(text));
  const isSalaryPayment = /^(?:จ่าย|โอน)เงินเดือน/u.test(text);
  const isNameReply = Boolean(prior && !prior.employeeLabel && employee(text)
    && !/เงินเดือน|ซื้อ|จ่าย|ส่วนกลาง|กิจการ|ร้าน|โครงการ/u.test(text));
  if (!hasAdvance && !isSalaryPayment && !(prior && (isSalaryReply || isPurchaseReply || isNameReply || isBusinessReply || isPurchaseDetail || isAmountReply))) return null;

  const kind: OwnerStaffTurn['kind'] = isPurchaseReply ? 'purchase'
    : isSalaryPayment ? 'salary_payment'
    : (/เบิกเงินเดือน|เงินเดือนล่วงหน้า/u.test(text) || (prior && isSalaryReply)) ? 'salary_advance'
    : prior?.kind ?? 'unknown';
  const before = text.match(/^([\p{L}\p{M} .-]{1,60}?)\s*(?:ขอ)?เบิก/u)?.[1];
  const after = text.match(/^(?:เบิก(?:เงินเดือน(?:ล่วงหน้า)?|เงินล่วงหน้า|เงิน)?(?:ให้)?|(?:จ่าย|โอน)เงินเดือน)\s*([\p{L}\p{M} .-]+?)(?=\s+\d|$)/u)?.[1];
  const employeeLabel = employee(before ?? '') ?? employee(after ?? '')
    ?? (isNameReply ? employee(text) : null) ?? prior?.employeeLabel ?? null;
  const amountText = text.match(/(?:^|\s)([\d,]+(?:\.\d{1,2})?)(?:\s*บาท)?(?:\s|$)/u)?.[1];
  const number = amountText ? Number(amountText.replace(/,/g, '')) : null;
  const amount = number !== null && Number.isFinite(number) && number > 0 ? number : null;
  return { employeeLabel, kind, amount };
}

/** Financial turns must never fill arbitrary fields of a construction draft. */
export function isOwnerFinancialTopic(rawText: string): boolean {
  const text = clean(rawText);
  return /เบิก|เงินเดือน|สลิป|ใบเสร็จ|สำรองจ่าย|คืนเงิน|ชำระ|^(?:จ่าย(?:เงิน|ค่า)|โอน(?:เงิน|จ่าย)|ซื้อ)/u.test(text);
}

export function isOwnerScheduleAnswer(rawText: string): boolean {
  const text = clean(rawText);
  return !isOwnerFinancialTopic(text)
    && /(?:วันนี้|พรุ่งนี้|มะรืน|เมื่อวาน|วัน(?:จันทร์|อังคาร|พุธ|พฤหัส|ศุกร์|เสาร์|อาทิตย์|ที่)|เดือน|สัปดาห์|อาทิตย์นี้|อาทิตย์หน้า|ภายใน|ก่อน|หลัง|กำหนด|เริ่ม|สิ้น|ต้น|กลาง|ทุกวัน|ทุกเดือน|อีก\s*\d+\s*(?:วัน|คืน|เดือน|สัปดาห์)|\d{1,2}[\/.-]\d{1,2}|^\d+\s*(?:วัน|คืน|เดือน|สัปดาห์)$)/u.test(text);
}
