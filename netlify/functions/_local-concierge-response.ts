// Composes the actual customer-facing message for a classified Local
// Concierge question (see _local-concierge-intent.ts). Same discipline as
// _experience-discovery.ts's formatExperienceDiscoveryMessage. Every fact
// used here traces back to _local-concierge-knowledge.ts's static pack,
// _local-concierge-location.ts's owner-provided location,
// _weather-provider.ts's real-time (or honestly-unavailable) weather, or
// _ecosystem-entity-graph.ts's real node labels -- this module never
// invents a business name, never asserts a live weather/ground-condition
// fact it doesn't actually have, and always keeps the reply to the shape
// required: direct answer -> local context -> best options -> caveat if
// real-time data is missing -> at most one follow-up question.
//
// weather_condition and activity_suitability are async: they call
// getWeatherForTammaLocation() (a real I/O boundary), so
// composeLocalConciergeResponse itself is async -- callers must await it.
import { findEcosystemNode } from './_ecosystem-entity-graph';
import {
  FOOD_CULTURE_GUIDANCE, HORSE_FACTS, INDOOR_FRIENDLY_BUSINESS_UNITS, OUTDOOR_SENSITIVE_ACTIVITY_NODES,
  REGION_GUIDANCE, SAFETY_GENERAL_GUIDANCE, SEASON_GUIDANCE, type LocalSeason,
} from './_local-concierge-knowledge';
import { TAMMA_CHART_LOCATION } from './_local-concierge-location';
import { getWeatherForTammaLocation, type WeatherResult } from './_weather-provider';
import type { LocalConciergeMatch } from './_local-concierge-intent';

function nodeLabel(id: string, fallback: string): string {
  return findEcosystemNode(id)?.label.replace(/\s*\(.*\)$/u, '') || fallback;
}

function indoorFriendlyNames(): string {
  return INDOOR_FRIENDLY_BUSINESS_UNITS
    .map(id => nodeLabel(id, id))
    .join(' / ');
}

function outdoorActivityNames(): string {
  return OUTDOOR_SENSITIVE_ACTIVITY_NODES
    .map(id => nodeLabel(id, id))
    .join(' / ');
}

/** A fallback season-like hint read from the message's OWN wording (what
 *  the customer is describing), used only when live weather is
 *  unavailable -- never a forecast, never a claim about "right now". */
function seasonHintFromMessage(message: string): LocalSeason {
  if (/ฝน|โคลน|ลื่น/u.test(message)) return 'rainy';
  if (/แดด|ร้อน/u.test(message)) return 'hot';
  return 'cool';
}

// The provider (_weather-provider.ts) only implements OpenWeatherMap's
// CURRENT-conditions endpoint, not a real forecast API -- a question shaped
// around a future day ("พรุ่งนี้ฝนตกไหม") must never be answered as if
// today's live reading confirms tomorrow's weather. Per requirement: use
// today's data as the best available guidance, but say plainly that it
// isn't a confirmed forecast.
const FORECAST_QUESTION_MARKER = /พรุ่งนี้|มะรืน|พยากรณ์|forecast/iu;

function isForecastQuestion(message: string): boolean {
  return FORECAST_QUESTION_MARKER.test(message);
}

/** Natural current-weather line. Provider/provenance stays internal unless
 * the guest explicitly asks where the weather came from. */
function liveWeatherLine(weather: WeatherResult): string {
  const parts: string[] = [];
  if (weather.forecastSummary) parts.push(weather.forecastSummary);
  else if (weather.condition) parts.push(weather.condition);
  if (weather.temperatureCelsius !== null) parts.push(`ประมาณ ${weather.temperatureCelsius}°C`);
  if (weather.precipitationChance !== null) parts.push(`โอกาสฝนประมาณ ${weather.precipitationChance}%`);
  return parts.length ? parts.join(' · ') : 'สภาพอากาศทั่วไป';
}

function currentRainAnswer(message:string, weather:WeatherResult):string|null {
  if (!/ฝน|ตกไหม|rain/iu.test(message)) return null;
  const rainy = /rain|drizzle|thunderstorm/iu.test(weather.condition ?? '')
    || /ฝน|พายุ/iu.test(weather.forecastSummary ?? '');
  if (rainy) return 'ตอนนี้มีฝนในข้อมูลอากาศล่าสุดครับ';
  return 'ตอนนี้ยังไม่เห็นสถานะฝนในข้อมูลอากาศล่าสุดครับ';
}

export async function composeWeatherConditionResponse(message: string): Promise<string> {
  const weather = await getWeatherForTammaLocation();
  const season = seasonHintFromMessage(message);
  const guidance = SEASON_GUIDANCE[season];
  const forecastAsked = isForecastQuestion(message);

  if (weather.status === 'ok') {
    const direct = currentRainAnswer(message, weather);
    const lines = [direct ?? `ตอนนี้อากาศ${liveWeatherLine(weather)}ครับ`];
    if (direct) lines.push(liveWeatherLine(weather));
    if (forecastAsked) {
      lines.push('อันนี้เป็นสภาพอากาศตอนนี้นะครับ ถ้าถามพรุ่งนี้หรือวันอื่น ทองไทยยังไม่อยากฟันธงจากข้อมูลชุดนี้');
    }
    if (/กิจกรรม|ขี่ม้า|ATV|กลางแจ้ง|ไปเที่ยว/u.test(message)) {
      lines.push('ถ้าจะทำกิจกรรมกลางแจ้ง เบิ่งสภาพพื้นกับทีมหน้างานอีกทีจะชัวร์ที่สุดครับ');
    }
    return lines.join('\n\n');
  }

  const lines = ['ตอนนี้ทองไทยยังเช็กอากาศสดให้ไม่ได้ครับ'];
  if (forecastAsked) lines.push('และยังพยากรณ์ล่วงหน้าแบบยืนยันไม่ได้ด้วยครับ');
  lines.push(`แต่โดยทั่วไปช่วงนี้: ${guidance.summary} — ${guidance.prepGuidance}`);
  lines.push(guidance.indoorFriendlyNote.replace(/ที่ร่ม/u, `ที่ร่มอย่าง${indoorFriendlyNames()}`));
  lines.push('แนะนำเช็คอีกทีใกล้ๆ วันที่มา หรือสอบถามทีมงานหน้างานได้เลยครับ');
  return lines.join('\n');
}

export function composeRegionPlaceResponse(): string {
  return [
    ...REGION_GUIDANCE.lines,
    '',
    'อยากให้ทองไทยแนะนำจุดเริ่มไหนก่อนดีครับ — กิน พัก หรือกิจกรรม?',
  ].join('\n');
}

export function composeFoodCultureResponse(): string {
  return [
    ...FOOD_CULTURE_GUIDANCE.lines,
    '',
    'อยากให้ทองไทยแนะนำเมนูจากร้านจริงตอนนี้เลยไหมครับ บอกจำนวนคน/ข้อจำกัดมาได้เลย',
  ].join('\n');
}

export function composeVisitorJourneyResponse(message: string): string {
  const hasTime = /มีเวลา|ครึ่งวัน|เต็มวัน|คืน/u.test(message);
  const hasCompanion = /คนเดียว|แฟน|ครอบครัว|เด็ก|ผู้ใหญ่|เพื่อน|แม่|พ่อ|ลูก/u.test(message);
  const wantsChill = /ชิล|ไม่รีบ|พักใจ|ไม่อยากเดินเยอะ/u.test(message);
  const wantsAdventure = /ลุย|ผจญภัย/u.test(message);
  const noTransaction = /ยังไม่.*จอง|ไม่.*จอง|แค่.*ดู|ไว้ก่อน/u.test(message);
  const missing: string[] = [];
  if (!hasTime) missing.push('มีเวลาประมาณเท่าไร');
  if (!hasCompanion) missing.push('มากับใคร (คนเดียว/แฟน/ครอบครัว)');

  const lines = [
    `ทองไทยช่วยจัดแผนสั้นๆ ให้ได้ครับ ที่ทำมา-ชาติมีทั้งกิน (${nodeLabel('thamma-chat-restaurant', 'ตำมา-ชาติ')}), พัก (${nodeLabel('thamma-chat-stay', 'เฮือนสเตย์')}), กิจกรรมกลางแจ้ง (${outdoorActivityNames()}) และคาเฟ่ (${nodeLabel('inthanin', 'Inthanin')})`,
  ];
  if (missing.length) {
    lines.push(`ขอ${missing.join(' และ ')}เพิ่มอีกนิดครับ จะได้จัดแผนที่พอดีกับเวลาจริงๆ`);
  } else if (wantsChill) {
    lines.push(`ถ้าเอาแบบชิลๆ แนะนำเริ่มที่ ${nodeLabel('inthanin', 'Inthanin')} แล้วเดินชมพื้นที่/พักใจครับ ถ้ายังมีเวลาและอยากเพิ่มกิจกรรม ค่อยเลือก ${outdoorActivityNames()} ตามคิวหน้างานได้ครับ`);
  } else if (wantsAdventure) {
    lines.push(`ถ้าอยากลุย ให้เลือกกิจกรรมกลางแจ้งอย่าง ${outdoorActivityNames()} เป็นแกน แล้วค่อยแวะ ${nodeLabel('inthanin', 'Inthanin')} พักท้ายครับ`);
  } else {
    lines.push('เลือกได้เลยว่าอยากเน้นกิน ชิล หรือกิจกรรม แล้วทองไทยจะจัดลำดับให้พอดีกับเวลาครับ');
  }
  if (noTransaction) lines.push('ตอนนี้ทองไทยยังไม่จองหรือส่งรายการอะไรให้ครับ');
  return lines.join('\n');
}

export async function composeActivitySuitabilityResponse(match: LocalConciergeMatch, message: string): Promise<string> {
  const activityName = match.activityNodeId ? nodeLabel(match.activityNodeId, 'กิจกรรมนี้') : 'กิจกรรมกลางแจ้ง';
  const weather = await getWeatherForTammaLocation();
  const forecastAsked = isForecastQuestion(message);

  const lines: string[] = [];
  lines.push(weather.status === 'ok' ? liveWeatherLine(weather) : 'ตอนนี้ทองไทยยังไม่มีข้อมูลอากาศสดยืนยันในระบบครับ');
  if (forecastAsked) {
    lines.push(weather.status === 'ok'
      ? 'ข้อมูลนี้เป็นสภาพอากาศปัจจุบัน ยังพยากรณ์ล่วงหน้าแบบยืนยัน 100% ไม่ได้ครับ'
      : 'และยังพยากรณ์ล่วงหน้าแบบยืนยันไม่ได้ด้วยครับ');
  }
  // Ground condition is never claimed from a weather fact alone (rain/no
  // rain does not by itself tell us the ACTUAL ground condition on site) --
  // this caveat applies whether or not live weather is available above.
  lines.push(`โดยทั่วไป ${activityName} เล่นได้ในสภาพอากาศปกติ แต่สภาพพื้นจริงหน้างานต้องให้ทีมดูอีกทีครับ`);
  lines.push('แนะนำเช็คกับทีมงานตอนถึงหน้างานเพื่อความชัวร์ครับ ถ้าเล่นไม่ได้ทองไทยมีตัวเลือกอื่น (กิน/คาเฟ่/พัก) ให้ปรับแผนได้เสมอ');
  return lines.join('\n');
}

export function composeSafetyUncertaintyResponse(): string {
  return [
    ...SAFETY_GENERAL_GUIDANCE.lines,
    '',
    'มีเรื่องไหนที่กังวลเป็นพิเศษไหมครับ ทองไทยช่วยดูให้ได้',
  ].join('\n');
}

/** Category A (static): the owner-provided Maps link is the one canonical
 *  source of "where are we" -- see _local-concierge-location.ts. Never
 *  invents an address; includes one only once resolutionStatus is
 *  'resolved'. */
export function composeLocationResponse(): string {
  const location = TAMMA_CHART_LOCATION;
  const lines: string[] = [];
  if (location.resolutionStatus === 'resolved' && location.address) {
    lines.push(`ทำมา-ชาติอยู่ที่: ${location.address}`);
  }
  lines.push(`ปักหมุดตามลิงก์นี้ได้เลยครับ: ${location.mapsLink}`);
  lines.push('กดลิงก์แล้วกดนำทางได้เลยครับ ถ้าใกล้ถึงแล้วหาจุดจอดไม่เจอ ทักมาได้เลยครับ');
  return lines.join('\n');
}

/** Category B (business facts from a configured source): the owner's own
 *  ride-feel + personality facts, and ONLY those -- see HORSE_FACTS's own
 *  comment for the exact disallowed-claims list this must never cross
 *  into (no safety guarantee, no beginner-suitability claim, no "better/
 *  worse" framing). */
export function composeHorseComparisonResponse(): string {
  const thongthai = HORSE_FACTS.thongthai;
  const pharadon = HORSE_FACTS.pharadon;
  return [
    `${thongthai.name}จะให้ฟีลแน่น ๆ ${thongthai.rideFeelTh} ส่วน${pharadon.name}จะ${pharadon.rideFeelTh} แต่ทั้งคู่${thongthai.personalityTh}ครับ 😊`,
    'เรื่องความเหมาะสมเฉพาะคน (เช่นมือใหม่/สุขภาพ) ขอให้ทีมงานช่วยแนะนำหน้างานอีกทีนะครับ เพื่อความชัวร์',
  ].join('\n');
}

export async function composeLocalConciergeResponse(match: LocalConciergeMatch, message: string): Promise<string> {
  switch (match.category) {
    case 'location': return composeLocationResponse();
    case 'horse_comparison': return composeHorseComparisonResponse();
    case 'weather_condition': return composeWeatherConditionResponse(message);
    case 'region_place': return composeRegionPlaceResponse();
    case 'food_culture': return composeFoodCultureResponse();
    case 'visitor_journey': return composeVisitorJourneyResponse(message);
    case 'activity_suitability': return composeActivitySuitabilityResponse(match, message);
    case 'safety_uncertainty': return composeSafetyUncertaintyResponse();
  }
}
