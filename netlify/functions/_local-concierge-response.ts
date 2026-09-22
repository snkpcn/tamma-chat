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

/** One short "จากข้อมูลล่าสุด..." line built from a WeatherResult that's
 *  already confirmed status: 'ok' -- the only place allowed to phrase a
 *  live weather fact for the customer, so freshness/source are always
 *  cited together with the fact itself (never a bare number). */
function liveWeatherLine(weather: WeatherResult): string {
  const parts: string[] = [];
  if (weather.forecastSummary) parts.push(weather.forecastSummary);
  else if (weather.condition) parts.push(weather.condition);
  if (weather.temperatureCelsius !== null) parts.push(`อุณหภูมิประมาณ ${weather.temperatureCelsius}°C`);
  if (weather.precipitationChance !== null) parts.push(`โอกาสฝนประมาณ ${weather.precipitationChance}%`);
  const detail = parts.length ? parts.join(' ') : 'สภาพอากาศทั่วไป';
  return `จากข้อมูลล่าสุด${weather.source ? ` (${weather.source})` : ''}: ${detail}`;
}

export async function composeWeatherConditionResponse(message: string): Promise<string> {
  const weather = await getWeatherForTammaLocation();
  const season = seasonHintFromMessage(message);
  const guidance = SEASON_GUIDANCE[season];

  if (weather.status === 'ok') {
    return [
      liveWeatherLine(weather),
      guidance.prepGuidance,
      guidance.indoorFriendlyNote.replace(/ที่ร่ม/u, `ที่ร่มอย่าง${indoorFriendlyNames()}`),
      'สภาพพื้นจริงหน้างานต้องให้ทีมดูอีกทีครับ',
    ].join('\n');
  }

  return [
    'ตอนนี้ทองไทยยังไม่มีข้อมูลอากาศสดยืนยันในระบบครับ',
    `แต่โดยทั่วไปช่วงนี้: ${guidance.summary} — ${guidance.prepGuidance}`,
    guidance.indoorFriendlyNote.replace(/ที่ร่ม/u, `ที่ร่มอย่าง${indoorFriendlyNames()}`),
    'แนะนำเช็คอีกทีใกล้ๆ วันที่มา หรือสอบถามทีมงานหน้างานได้เลยครับ',
  ].join('\n');
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
  const hasCompanion = /แฟน|ครอบครัว|เด็ก|ผู้ใหญ่|เพื่อน|แม่|พ่อ|ลูก/u.test(message);
  const missing: string[] = [];
  if (!hasTime) missing.push('มีเวลาประมาณเท่าไร');
  if (!hasCompanion) missing.push('มากับใคร (คนเดียว/แฟน/ครอบครัว)');

  const lines = [
    `ทองไทยช่วยจัดแผนสั้นๆ ให้ได้ครับ ที่ทำมา-ชาติมีทั้งกิน (${nodeLabel('thamma-chat-restaurant', 'ตำมา-ชาติ')}), พัก (${nodeLabel('thamma-chat-stay', 'เฮือนสเตย์')}), กิจกรรมกลางแจ้ง (${outdoorActivityNames()}) และคาเฟ่ (${nodeLabel('inthanin', 'Inthanin')})`,
  ];
  if (missing.length) {
    lines.push(`ขอ${missing.join(' และ ')}เพิ่มอีกนิดครับ จะได้จัดแผนที่พอดีกับเวลาจริงๆ`);
  } else {
    lines.push('บอกทองไทยได้เลยว่าอยากได้แบบชิลๆ หรือแบบลุยหน่อย จะจัดลำดับกิจกรรมให้พอดีเวลาครับ');
  }
  return lines.join('\n');
}

export async function composeActivitySuitabilityResponse(match: LocalConciergeMatch): Promise<string> {
  const activityName = match.activityNodeId ? nodeLabel(match.activityNodeId, 'กิจกรรมนี้') : 'กิจกรรมกลางแจ้ง';
  const weather = await getWeatherForTammaLocation();

  const lines: string[] = [];
  lines.push(weather.status === 'ok' ? liveWeatherLine(weather) : 'ตอนนี้ทองไทยยังไม่มีข้อมูลอากาศสดยืนยันในระบบครับ');
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
    case 'activity_suitability': return composeActivitySuitabilityResponse(match);
    case 'safety_uncertainty': return composeSafetyUncertaintyResponse();
  }
}
