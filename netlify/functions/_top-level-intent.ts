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
  | 'BUSINESS_TRANSACTION'
  | 'OTHER';

const LOCATION_MARKER =
  /(?:โลเค(?:ชั่น|ชัน)|location|พิกัด|แผนที่|อยู่ที่ไหน|อยู่ไหน|ไปยังไง|ไปอย่างไร|นำทาง|ทางไป|ส่ง(?:โลเค|พิกัด)|ขอ(?:โลเค|พิกัด|แผนที่))/iu;

// "ร้อน"/"หนาว" alone are ordinary Thai adjectives that show up in
// completely unrelated sentences (a horse's temperament, a food question,
// casual small talk about the day). They only mean a WEATHER REQUEST when
// paired with an actual weather-question anchor (today/tomorrow/outside/
// the sky/a yes-no weather question particle). The unconditional forms
// (ฝน/อากาศ/พยากรณ์/อุณหภูมิ/กี่องศา/weather) remain sufficient on their own
// since they cannot mean anything else. Production failure this closes: a
// horse-suitability question containing "ร้อน" was classified WEATHER_REQUEST
// and answered with OpenWeatherMap data instead of horse information.
const WEATHER_MARKER =
  /(?:ฝน(?:ตก)?|อากาศ|พยากรณ์|อุณหภูมิ|กี่องศา|weather|(?:วันนี้|พรุ่งนี้|ข้างนอก|ข้างบ้าน|ตอนนี้)[^\n]{0,12}(?:ร้อน|หนาว)|(?:ร้อน|หนาว)[^\n]{0,12}(?:ไหม|มั้ย|จัง|ชิบหาย|มาก)?[^\n]{0,8}(?:วันนี้|พรุ่งนี้|ข้างนอก))/iu;

const HORSE_CONTEXT_MARKER =
  /(?:ขี่ม้า|จองม้า|อยาก.*ม้า|ม้า(?:ทองไทย|ภาราดร|ตัวนี้|ตัวนั้น|ขี้ร้อน|ขี้หนาว)|ขี่(?:ทองไทย|ภาราดร)|เลือก(?:ม้า\s*)?(?:ทองไทย|ภาราดร)|เอา(?:ม้า\s*)?(?:ทองไทย|ภาราดร)|ภาราดร)/u;

// "ทองไทย" by itself is NOT horse context because it is also the assistant's
// own name. These markers describe talking TO the assistant/about its answer.
const BOT_ADDRESS_MARKER =
  /(?:ทองไทย(?:\s*)?(?:ช่วย|แนะนำ|ตอบ|อธิบาย|บอก|ดู|เช็ก|สวัสดี|ขอบคุณ)|(?:ช่วย|แนะนำ|ตอบ|อธิบาย|บอก|เช็ก|ขอบคุณ)\s*ทองไทย|ครับทองไทย|ค่ะทองไทย|นะทองไทย|หน่อยทองไทย)/u;

const GENERAL_RECOMMEND_MARKER =
  /^(?:มีอะไรแนะนำ|แนะนำหน่อย|ช่วยแนะนำหน่อย|ทองไทยแนะนำหน่อย)(?:ครับ|ค่ะ|คะ|คับ|นะ|หน่อย)?[\s?.!]*$/u;

// A named business transaction outranks the lexical collision between the
// assistant name "ทองไทย" and the horse with the same name.  This is a
// routing guard only; it never authorizes a write.  Transaction consent is
// still checked by the domain dialog/executor layer.
const BUSINESS_TRANSACTION_MARKER =
  /(?:จอง(?:โต๊ะ|ที่พัก|ห้อง|บ้าน)|สั่ง(?:ซื้อ|สินค้า|ของฝาก|อาหาร|กาแฟ)|ส่ง(?:เรื่อง|คำถาม|คำขอ).{0,80}(?:ทีม|ร้าน|คาเฟ่)|(?:OTOP|โอทอป|ของฝาก).{0,80}(?:สั่ง|จัดส่ง))/iu;

export function classifyTopLevelSemanticIntent(message: string): TopLevelSemanticIntent {
  const text = String(message ?? '').trim();
  if (!text) return 'OTHER';

  // Whole-sentence intent outranks name/entity tokens. This ordering is the
  // central product rule this gate exists to enforce.
  if (LOCATION_MARKER.test(text)) return 'LOCATION_REQUEST';

  // Whole-sentence business intent must win before the horse-name token.
  if (BUSINESS_TRANSACTION_MARKER.test(text)) return 'BUSINESS_TRANSACTION';

  // Explicit horse/riding language wins over a bare weather-adjective hit.
  // "ม้าตัวนี้ขี้ร้อนไหม" (does this horse run hot / overheat) must stay a
  // horse question, not get hijacked into a forecast lookup merely because
  // it contains "ร้อน".
  if (HORSE_CONTEXT_MARKER.test(text)) return 'HORSE_RELATED';
  if (WEATHER_MARKER.test(text)) return 'WEATHER_REQUEST';

  // Otherwise, assistant-address language wins over the lexical horse-name hit.
  if (text.includes('ทองไทย') && BOT_ADDRESS_MARKER.test(text)) return 'BOT_ADDRESS';

  if (GENERAL_RECOMMEND_MARKER.test(text)) return 'GENERAL_RECOMMENDATION';

  return 'OTHER';
}

export function topLevelIntentBlocksHorseTokenRouting(intent: TopLevelSemanticIntent): boolean {
  return intent === 'LOCATION_REQUEST'
    || intent === 'WEATHER_REQUEST'
    || intent === 'BOT_ADDRESS'
    || intent === 'GENERAL_RECOMMENDATION'
    || intent === 'BUSINESS_TRANSACTION';
}
