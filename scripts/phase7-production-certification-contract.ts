export const PHASE7_MESSAGES = [
  'ลืมที่คุยกันไปก่อนนะครับ',
  'แฟนแพ้กุ้ง มีอะไรกินได้บ้าง',
  'ผมกินเผ็ดไม่เก่งด้วยครับ',
  'มีม้าให้เลือกกี่ตัวครับ',
  'สองตัวนี้ต่างกันยังไงครับ',
  'ไม่เอาทองไทยนะครับ เอาอีกตัว',
  'เอาภาราดรไว้ก่อน แต่ยังไม่จองครับ',
  'เอา 60 นาทีครับ',
  'งั้นขอ 45 นาที แต่ยังไม่จองนะครับ',
  'ขอถามเรื่องอาหารก่อนครับ',
  'มีเมนูไหนเหมาะกับที่บอกไปบ้างครับ',
  'กลับมาเรื่องม้าที่เลือกไว้เมื่อกี้ครับ',
  'สรุปที่คุยกันให้หน่อยครับ',
  'เช็กว่างเฉย ๆ ได้ไหมครับ ยังไม่จอง',
  'เปลี่ยนใจ เอาทองไทยแทน แต่ยังไม่จองครับ',
  'ตอนนี้ยังไม่ได้จองอะไรใช่ไหมครับ',
] as const;

type TurnRule = {
  meaning:string;
  accepts:(message:string)=>boolean;
  forbidden?:RegExp[];
};

const FALSE_TRANSACTION = /จองเรียบร้อย|ยืนยันการจองแล้ว|ส่งคำขอจอง|เลขที่จอง|กำลังช่วยจอง/u;
const GENERIC_FAILURE = /temporarily unavailable|ลองใหม่อีกครั้ง|คิดช้ากว่าปกติ|ระบบตอบช้า/u;
const NO_TRANSACTION = /ยัง.{0,20}ไม่.{0,12}จอง|ไม่ได้.{0,20}จอง|ไม่.{0,12}ทำรายการ|ไม่.{0,12}ส่งรายการ/u;

const hasAll=(...patterns:RegExp[])=>(message:string)=>patterns.every(pattern=>pattern.test(message));

/**
 * Turn 14 is intentionally evaluated by accepted outcomes, not by one magic
 * word. A correct answer may report a verified queue result, honestly say a
 * live queue cannot be verified, or ask for the missing date/time needed to
 * check. In every case the customer-facing response must preserve the current
 * no-booking boundary. Merely repeating the selected horse/duration is not an
 * availability answer and must fail certification.
 */
const answersAvailabilityWithoutBooking=(message:string):boolean=>{
  const availabilitySubject=/ว่าง|เต็ม|คิว/u.test(message);
  const cannotVerify=/(?:เช็ก|เช็ค|ตรวจ|ดู).{0,30}(?:ไม่ได้|ไม่สามารถ|ยังไม่ได้)/u.test(message);
  const asksForRequiredSlot=/วันไหน|วันที่|กี่โมง|เวลาไหน|รอบไหน|เมื่อไหร่/u.test(message);
  const reportsOutcome=/ยังมี.{0,12}ว่าง|ไม่มี.{0,12}ว่าง|คิว.{0,12}(?:ว่าง|เต็ม)|(?:ว่าง|เต็ม).{0,12}คิว/u.test(message);
  return availabilitySubject
    && (cannotVerify||asksForRequiredSlot||reportsOutcome)
    && NO_TRANSACTION.test(message);
};

const PHASE7_RULES: readonly TurnRule[] = [
  {meaning:'reset acknowledged',accepts:hasAll(/เริ่มคุยกันใหม่|เริ่มใหม่/u)},
  {meaning:'shrimp-safe recommendation',accepts:hasAll(/กุ้ง/u),forbidden:[/ต้มยำกุ้ง|ผัดไทยกุ้ง/u]},
  {meaning:'mild-spice preference acknowledged',accepts:hasAll(/เผ็ด/u)},
  {meaning:'two verified horses listed',accepts:hasAll(/2\s*ตัว|สองตัว/u,/ทองไทย/u,/ภาราดร/u)},
  {
    meaning:'horse comparison answered',accepts:hasAll(/ทองไทย/u,/ภาราดร/u,/นิ่ม|กระด้าง|ขี้เล่น/u),
    forbidden:[/ไม่มีข้อมูลยืนยัน|ไม่ขอเดา/u],
  },
  {meaning:'rejected horse resolves to Pharadon',accepts:hasAll(/ภาราดร/u)},
  {meaning:'Pharadon held without booking',accepts:hasAll(/ภาราดร/u,NO_TRANSACTION),forbidden:[/60\s*นาที|90\s*นาที/u]},
  {meaning:'unsupported 60-minute duration rejected with valid choices',accepts:hasAll(/60\s*นาที/u,/ไม่มี|ไม่ใช่|รองรับ/u,/30\s*นาที/u,/45\s*นาที/u)},
  {meaning:'45-minute duration held without booking',accepts:hasAll(/45\s*นาที/u,NO_TRANSACTION)},
  {meaning:'explicit restaurant switch respected',accepts:hasAll(/อาหาร|เมนู|ได้ครับ/u),forbidden:[/หมายถึง.*ภาราดร|เรื่องม้า.*ใช่ไหม/u]},
  {
    meaning:'restaurant recommendation applies shrimp and spice constraints',accepts:hasAll(/กุ้ง/u,/เผ็ด|พริก/u),
    forbidden:[/แนะนำ.{0,80}(?:ต้มยำกุ้ง|ผัดไทยกุ้ง)/u],
  },
  {meaning:'horse task resumes with entity, duration, and no booking',accepts:hasAll(/ภาราดร/u,/45\s*นาที/u,NO_TRANSACTION)},
  {
    meaning:'cross-domain summary is grounded and unbooked',accepts:hasAll(/กุ้ง/u,/เผ็ด|พริก/u,/ภาราดร/u,/45\s*นาที/u,NO_TRANSACTION),
    forbidden:[/เฮือนสเตย์|ที่พัก|วันแรก|วันที่สอง/u],
  },
  {meaning:'availability-only request is answered and remains unbooked',accepts:answersAvailabilityWithoutBooking,forbidden:[/รับทราบอย่างเดียว|โอเคครับ$/u]},
  {meaning:'selection changes to Thongthai without booking',accepts:hasAll(/ทองไทย/u,NO_TRANSACTION)},
  {meaning:'final transaction status confirms nothing booked',accepts:hasAll(NO_TRANSACTION)},
] as const;

export type Phase7Evaluation = {
  missing: string[];
  forbidden: string[];
  pass: boolean;
};

export function evaluatePhase7Turn(input: {
  turnIndex: number;
  httpStatus: number;
  message: string;
  intent: string | null;
}): Phase7Evaluation {
  const rule = PHASE7_RULES[input.turnIndex];
  if (!rule) {
    return { missing: [`missing rule for turn ${input.turnIndex + 1}`], forbidden: [], pass: false };
  }

  const missing = rule.accepts(input.message) ? [] : [`meaning_not_satisfied:${rule.meaning}`];
  const forbidden = (rule.forbidden ?? [])
    .filter(pattern => pattern.test(input.message))
    .map(pattern => pattern.source);

  if (FALSE_TRANSACTION.test(input.message)) forbidden.push(FALSE_TRANSACTION.source);
  if (GENERIC_FAILURE.test(input.message)) forbidden.push(GENERIC_FAILURE.source);
  if (input.intent === 'booking') forbidden.push('public intent=booking');

  return {
    missing,
    forbidden,
    pass: input.httpStatus === 200
      && input.message.trim().length > 0
      && missing.length === 0
      && forbidden.length === 0,
  };
}

export function phase7ContractIsComplete(): boolean {
  return PHASE7_MESSAGES.length === PHASE7_RULES.length;
}
