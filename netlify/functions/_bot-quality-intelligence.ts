export type BotQualitySignal = {
  eventType: 'phrase' | 'demand' | 'risk';
  category: string;
  domain: 'system';
};

export type BotQualityEvaluationInput = {
  customerMessage: string;
  assistantMessage: string;
  chatHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
};

type QualityDomain = 'restaurant' | 'cafe' | 'activity' | 'stay' | 'location' | 'weather';

function normalized(value: string): string {
  return String(value ?? '').toLowerCase().replace(/\s+/gu, ' ').trim();
}

function explicitDomains(value: string): Set<QualityDomain> {
  const text = normalized(value);
  const out = new Set<QualityDomain>();
  if (/(?:ร้านอาหาร|เมนู|อาหาร|ส้มตำ|ลาบ|ตำมา-ชาติ)/u.test(text)) out.add('restaurant');
  if (/(?:คาเฟ่|กาแฟ|อินทนิน|inthanin)/iu.test(text)) out.add('cafe');
  if (/(?:ขี่ม้า|ภาราดร|\batv\b|เอทีวี|ยิงธนู|ธนู|กิจกรรม)/iu.test(text)) out.add('activity');
  if (/(?:เฮือนสเตย์|โฮมสเตย์|homestay|ห้องพัก|ที่พัก)/iu.test(text)) out.add('stay');
  if (/(?:อยู่ที่ไหน|พิกัด|โลเคชั่น|location|ทางไป|ไปยังไง)/iu.test(text)) out.add('location');
  if (/(?:อากาศ|ฝนตก|ฝนจะตก|ร้อนไหม|หนาวไหม|weather)/iu.test(text)) out.add('weather');
  return out;
}

function hasClearIntent(message: string): boolean {
  return explicitDomains(message).size > 0
    || /(?:คืนเงิน|refund|ร้องเรียน|จอง|ราคา|กี่บาท|ว่างไหม|มีคิว|ไม่ปลอดภัย|บาดเจ็บ|พื้นลื่น)/iu.test(message);
}

function hasUnsupportedClaim(message: string): boolean {
  return /(?:ปลอดภัยแน่นอน|รับประกัน(?:ว่า)?ปลอดภัย|ได้แน่นอน|คืนเงินได้แน่นอน|ยืนยันแทนเจ้าของ)/u.test(message);
}

function hasGenericClarification(message: string): boolean {
  return /(?:ไม่เข้าใจ|หมายถึงเรื่องไหน|ถามเรื่องไหน|ขอรายละเอียดเพิ่ม|ช่วยบอกเพิ่ม|ลองถามใหม่)/u.test(message);
}

function hasBoundaryLanguage(message: string): boolean {
  return /(?:เจ้าของ|ทีม|ตรวจสอบ|เงื่อนไข|ขอไม่ยืนยัน|ไม่ยืนยันแทน|ต้องให้.*ยืนยัน|ส่งเรื่อง)/u.test(message);
}

function hasSafetyHandling(message: string): boolean {
  return /(?:หยุดกิจกรรม|หยุด.*ก่อน|ทีม.*ตรวจสอบ|ตรวจสอบ.*ทีม|หน้างาน|ส่งให้ทีม|ส่งให้.*เจ้าของ|ไม่.*ยืนยัน)/u.test(message);
}

export function evaluateBotQualitySignals(input: BotQualityEvaluationInput): BotQualitySignal[] {
  const customer = normalized(input.customerMessage);
  const assistant = normalized(input.assistantMessage);
  if (!customer || !assistant) return [];

  const signals: BotQualitySignal[] = [];
  const currentDomains = explicitDomains(customer);
  const answerDomains = explicitDomains(assistant);
  const history = input.chatHistory ?? [];
  const previousAssistant = [...history].reverse().find(turn => turn.role === 'assistant')?.content ?? '';
  const previousUser = [...history].reverse().find(turn => turn.role === 'user')?.content ?? '';
  const previousDomains = explicitDomains(previousUser);

  if (hasClearIntent(customer) && hasGenericClarification(assistant)) {
    signals.push({ eventType:'risk', category:'bot_quality_clarification_failure', domain:'system' });
  }

  if (
    currentDomains.size === 1
    && answerDomains.size > 0
    && ![...currentDomains].some(domain => answerDomains.has(domain))
  ) {
    signals.push({ eventType:'risk', category:'bot_quality_wrong_domain', domain:'system' });
  }

  if (previousAssistant && normalized(previousAssistant) === assistant) {
    signals.push({ eventType:'risk', category:'bot_quality_repeated_answer', domain:'system' });
  }

  if (
    currentDomains.size === 1
    && previousDomains.size > 0
    && ![...currentDomains].some(domain => previousDomains.has(domain))
    && [...previousDomains].some(domain => answerDomains.has(domain))
    && ![...currentDomains].some(domain => answerDomains.has(domain))
  ) {
    signals.push({ eventType:'risk', category:'bot_quality_stale_context_hijack', domain:'system' });
  }

  const unsupported = hasUnsupportedClaim(assistant);
  if (unsupported) {
    signals.push({ eventType:'risk', category:'bot_quality_unsupported_claim', domain:'system' });
  }

  if (/(?:คืนเงิน|refund|การชำระ|ชำระเงิน)/iu.test(customer) && !hasBoundaryLanguage(assistant)) {
    signals.push({ eventType:'risk', category:'bot_quality_authority_boundary_failure', domain:'system' });
  }

  const safetyInput = /(?:ไม่ปลอดภัย|บาดเจ็บ|พื้นลื่น|อันตราย|น่ากลัว|แพ้อาหารรุนแรง)/u.test(customer);
  if (safetyInput && !unsupported && hasSafetyHandling(assistant)) {
    signals.push({ eventType:'phrase', category:'bot_quality_safety_handling', domain:'system' });
  }

  if (
    previousAssistant
    && hasGenericClarification(normalized(previousAssistant))
    && hasClearIntent(customer)
    && !hasGenericClarification(assistant)
    && !unsupported
  ) {
    signals.push({ eventType:'phrase', category:'bot_quality_successful_recovery', domain:'system' });
  }

  return signals.filter((signal, index, all) =>
    all.findIndex(candidate => candidate.category === signal.category) === index
  );
}
