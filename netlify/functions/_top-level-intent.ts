// PHASE 2 STABILIZATION — TOP-LEVEL SEMANTIC INTENT GATE
//
// Purpose:
// The product already has strong domain responders, but some of them still
// activate on lexical tokens before the whole sentence's meaning is known.
// The concrete production failure was "ขอโลเคชั่นหน่อยทองไทย": the word
// "ทองไทย" (assistant name AND horse name) hijacked the turn into horse
// selection even though the sentence was clearly a location request.
//
// This gate is intentionally SMALL and high-confidence. It does not replace
// downstream domain interpretation. It only protects a few top-level intents
// whose meaning should win before narrow token-based responders.
//
// Important:
// - Safety / escalation policy still runs before this gate in the main cascade.
// - Restaurant's own dietary-intent gate remains authoritative for food.
// - A bare "เอาทองไทย" is left HORSE_RELATED/ambiguous for the existing horse
//   selection clarifier to resolve using conversation/task context.
// - Unknown text returns OTHER and follows the existing pipeline unchanged.

export type TopLevelSemanticIntent =
  | 'LOCATION_REQUEST'
  | 'WEATHER_REQUEST'
  | 'BOT_ADDRESS'
  | 'HORSE_RELATED'
  | 'GENERAL_RECOMMENDATION'
  | 'OTHER';

const LOCATION_MARKER =
  /(?:โลเค(?:ชั่น|ชัน)|location|พิกัด|แผนที่|อยู่ที่ไหน|อยู่ไหน|ไปยังไง|ไปอย่างไร|นำทาง|ทางไป|ส่ง(?:โลเค|พิกัด)|ขอ(?:โลเค|พิกัด|แผนที่))/iu;

const WEATHER_MARKER =
  /(?:ฝน(?:ตก)?|อากาศ|พยากรณ์|อุณหภูมิ|กี่องศา|ร้อน(?:ไหม|มั้ย)?|หนาว(?:ไหม|มั้ย)?|weather)/iu;

const HORSE_CONTEXT_MARKER =
  /(?:ขี่ม้า|จองม้า|อยาก.*ม้า|ม้า(?:ทองไทย|ภาราดร)|ขี่(?:ทองไทย|ภาราดร)|เลือก(?:ม้า\s*)?(?:ทองไทย|ภาราดร)|เอา(?:ม้า\s*)?(?:ทองไทย|ภาราดร)|ภาราดร)/u;

// "ทองไทย" by itself is NOT horse context because it is also the assistant's
// own name. These markers describe talking TO the assistant/about its answer.
const BOT_ADDRESS_MARKER =
  /(?:ทองไทย(?:\s*)?(?:ช่วย|แนะนำ|ตอบ|อธิบาย|บอก|ดู|เช็ก|สวัสดี|ขอบคุณ)|(?:ช่วย|แนะนำ|ตอบ|อธิบาย|บอก|เช็ก|ขอบคุณ)\s*ทองไทย|ครับทองไทย|ค่ะทองไทย|นะทองไทย|หน่อยทองไทย)/u;

const GENERAL_RECOMMEND_MARKER =
  /^(?:มีอะไรแนะนำ|แนะนำหน่อย|ช่วยแนะนำหน่อย|ทองไทยแนะนำหน่อย)(?:ครับ|ค่ะ|คะ|คับ|นะ|หน่อย)?[\s?.!]*$/u;

export function classifyTopLevelSemanticIntent(message: string): TopLevelSemanticIntent {
  const text = String(message ?? '').trim();
  if (!text) return 'OTHER';

  // Whole-sentence intent outranks name/entity tokens. This ordering is the
  // central product rule this gate exists to enforce.
  if (LOCATION_MARKER.test(text)) return 'LOCATION_REQUEST';
  if (WEATHER_MARKER.test(text)) return 'WEATHER_REQUEST';

  // Explicit horse/riding language can legitimately use "ทองไทย" as a horse.
  if (HORSE_CONTEXT_MARKER.test(text)) return 'HORSE_RELATED';

  // Otherwise, assistant-address language wins over the lexical horse-name hit.
  if (text.includes('ทองไทย') && BOT_ADDRESS_MARKER.test(text)) return 'BOT_ADDRESS';

  if (GENERAL_RECOMMEND_MARKER.test(text)) return 'GENERAL_RECOMMENDATION';

  return 'OTHER';
}

export function topLevelIntentBlocksHorseTokenRouting(intent: TopLevelSemanticIntent): boolean {
  return intent === 'LOCATION_REQUEST'
    || intent === 'WEATHER_REQUEST'
    || intent === 'BOT_ADDRESS'
    || intent === 'GENERAL_RECOMMENDATION';
}
