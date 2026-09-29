// Phase 6 connected production acceptance.
//
// This is intentionally one sequential, read-only conversation through the
// real production HTTP gateway. No turn contains transaction authorization,
// so a booking/order/payment/inventory write is never permitted. The script
// checks the response semantics and public intent on every turn; persisted
// state and operational side effects are verified separately in the core
// regression suite and, for a production run, with read-only database queries
// against this synthetic guest marker.

const PRODUCTION_URL = process.env.THONGTHAI_PRODUCTION_URL
  ?? 'https://tamma-chat.netlify.app/.netlify/functions/thongthai-chat';

const MESSAGES = [
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

type ChatMessage = { role: 'user' | 'assistant'; content: string };
type Payload = Record<string, unknown> & { message?: unknown; intent?: unknown };
type TurnRule = { required?: RegExp[]; forbidden?: RegExp[] };

const FALSE_TRANSACTION = /จองเรียบร้อย|ยืนยันการจองแล้ว|ส่งคำขอจอง|เลขที่จอง|กำลังช่วยจอง/u;
const GENERIC_FAILURE = /temporarily unavailable|ลองใหม่อีกครั้ง|คิดช้ากว่าปกติ|ระบบตอบช้า/u;

const RULES: readonly TurnRule[] = [
  { required: [/เริ่มคุยกันใหม่|เริ่มใหม่/u] },
  { required: [/กุ้ง/u], forbidden: [/ต้มยำกุ้ง|ผัดไทยกุ้ง/u] },
  { required: [/เผ็ด/u] },
  { required: [/2\s*ตัว|สองตัว/u, /ทองไทย/u, /ภาราดร/u] },
  {
    required: [/ทองไทย/u, /ภาราดร/u, /นิ่ม|กระด้าง|ขี้เล่น/u],
    forbidden: [/ไม่มีข้อมูลยืนยัน|ไม่ขอเดา/u],
  },
  { required: [/ภาราดร/u] },
  { required: [/ภาราดร/u], forbidden: [/60\s*นาที|90\s*นาที/u] },
  { required: [/60\s*นาที/u, /ไม่มี|ไม่ใช่|รองรับ/u, /30\s*นาที/u, /45\s*นาที/u] },
  { required: [/45\s*นาที/u] },
  { required: [/อาหาร|เมนู|ได้ครับ/u], forbidden: [/หมายถึง.*ภาราดร|เรื่องม้า.*ใช่ไหม/u] },
  {
    required: [/กุ้ง/u, /เผ็ด/u],
    forbidden: [/แนะนำ.{0,80}(?:ต้มยำกุ้ง|ผัดไทยกุ้ง)/u],
  },
  { required: [/ภาราดร/u, /45\s*นาที/u] },
  {
    required: [/กุ้ง/u, /เผ็ด/u, /ภาราดร/u, /45\s*นาที/u, /ยัง.*ไม่.*จอง|ไม่ได้.*จอง/u],
    forbidden: [/เฮือนสเตย์|ที่พัก|วันแรก|วันที่สอง/u],
  },
  { required: [/ว่าง|วัน|วันที่/u], forbidden: [/รับทราบอย่างเดียว|โอเคครับ$/u] },
  { required: [/ทองไทย/u, /ยัง.*ไม่.*จอง|ไม่ได้.*จอง/u] },
  { required: [/ยัง.*ไม่.*จอง|ไม่ได้.*จอง/u] },
] as const;

function productionGuestId(): string {
  const suffix = BigInt(Date.now()).toString(16).slice(-12).padStart(12, '0');
  return `f6f6f6f6-0251-4f6f-8f6f-${suffix}`;
}

async function main(): Promise<void> {
  const guestId = productionGuestId();
  const history: ChatMessage[] = [];
  const results: Array<Record<string, unknown>> = [];

  for (let index = 0; index < MESSAGES.length; index += 1) {
    const userMessage = MESSAGES[index]!;
    const response = await fetch(PRODUCTION_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        guestId,
        eventId: `phase6-production-${guestId}-${index + 1}`,
        message: userMessage,
        language: 'th',
        chatHistory: history,
        guestContext: {
          tripDuration: null, travelerType: null,
          group: { adults: null, children: null, elderly: null },
          interests: [], pace: null, budget: null, constraints: [],
        },
        journeyContext: {
          currentPlan: null, savedPlan: null,
          visitedExperiences: [], favorites: [], journalEntries: [],
        },
        pageContext: { section: 'line' },
      }),
    });
    const payload = await response.json().catch(() => ({})) as Payload;
    const message = typeof payload.message === 'string' ? payload.message : '';
    const intent = typeof payload.intent === 'string' ? payload.intent : null;
    const rule = RULES[index]!;
    const missing = (rule.required ?? []).filter(pattern => !pattern.test(message)).map(pattern => pattern.source);
    const forbidden = (rule.forbidden ?? []).filter(pattern => pattern.test(message)).map(pattern => pattern.source);
    if (FALSE_TRANSACTION.test(message)) forbidden.push(FALSE_TRANSACTION.source);
    if (GENERIC_FAILURE.test(message)) forbidden.push(GENERIC_FAILURE.source);
    if (intent === 'booking') forbidden.push('public intent=booking');
    const pass = response.status === 200 && message.trim().length > 0 && missing.length === 0 && forbidden.length === 0;
    const result = {
      turn: index + 1,
      guestId,
      request: userMessage,
      httpStatus: response.status,
      intent,
      response: message,
      missing,
      forbidden,
      pass,
    };
    results.push(result);
    console.log(JSON.stringify(result));
    if (!pass) {
      console.error(JSON.stringify({ kind: 'PHASE6_PRODUCTION_SMOKE_FAILED', guestId, turn: index + 1, missing, forbidden }, null, 2));
      process.exit(1);
    }
    history.push({ role: 'user', content: userMessage });
    history.push({ role: 'assistant', content: message });
  }

  console.log(JSON.stringify({
    kind: 'PHASE6_PRODUCTION_SMOKE_ACCEPTANCE',
    productionUrl: PRODUCTION_URL,
    guestId,
    total: results.length,
    passed: results.filter(result => result.pass).length,
    failed: results.filter(result => !result.pass).length,
    falseTransactionsDetected: 0,
  }, null, 2));
}

main().catch(error => {
  console.error('PHASE6_PRODUCTION_SMOKE_CRASHED', error instanceof Error ? error.message : error);
  process.exit(1);
});
