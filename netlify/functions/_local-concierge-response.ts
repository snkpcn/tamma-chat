// Composes the actual customer-facing message for a classified Local
// Concierge question (see _local-concierge-intent.ts). Pure function, no
// I/O -- same discipline as _experience-discovery.ts's
// formatExperienceDiscoveryMessage. Every fact used here traces back to
// _local-concierge-knowledge.ts's static pack or _ecosystem-entity-graph.ts's
// real node labels -- this function never invents a business name, never
// asserts a live weather/availability fact, and always keeps the reply to
// the shape required: direct answer -> local context -> best options ->
// caveat if real-time data is missing -> at most one follow-up question.
import { findEcosystemNode } from './_ecosystem-entity-graph';
import {
  FOOD_CULTURE_GUIDANCE, INDOOR_FRIENDLY_BUSINESS_UNITS, OUTDOOR_SENSITIVE_ACTIVITY_NODES,
  REGION_GUIDANCE, SAFETY_GENERAL_GUIDANCE, SEASON_GUIDANCE, type LocalSeason,
} from './_local-concierge-knowledge';
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

/** No live weather integration exists (see THONGTHAI_HANDOFF.md's
 *  category-C truth boundary) -- a message can only ever HINT at rain vs.
 *  sun/cool from its own wording, never confirm current conditions. This
 *  reads the season-like hint from the message itself (what the customer
 *  is describing), not a forecast. */
function seasonHintFromMessage(message: string): LocalSeason {
  if (/ฝน|โคลน|ลื่น/u.test(message)) return 'rainy';
  if (/แดด|ร้อน/u.test(message)) return 'hot';
  return 'cool';
}

export function composeWeatherConditionResponse(message: string): string {
  const season = seasonHintFromMessage(message);
  const guidance = SEASON_GUIDANCE[season];
  return [
    'ทองไทยยังไม่มีข้อมูลสภาพอากาศสดแบบเรียลไทม์ในระบบนะครับ เลยยืนยันแบบเป๊ะๆ ไม่ได้',
    `แต่โดยทั่วไปช่วงนี้: ${guidance.summary} — ${guidance.prepGuidance}`,
    guidance.indoorFriendlyNote.replace(/ที่ร่ม/u, `ที่ร่มอย่าง${indoorFriendlyNames()}`),
    `ถ้าอยากได้แผนแบบเจาะจงวันนี้/พรุ่งนี้ บอกช่วงเวลาที่มีมาได้เลย ทองไทยจัดแผนให้ครับ 😊`,
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
  const hasCompanion = /แฟน|ครอบครัว|เด็ก|ผู้ใหญ่/u.test(message);
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

export function composeActivitySuitabilityResponse(match: LocalConciergeMatch): string {
  const activityName = match.activityNodeId ? nodeLabel(match.activityNodeId, 'กิจกรรมนี้') : 'กิจกรรมกลางแจ้ง';
  return [
    `ทองไทยยังไม่มีข้อมูลสภาพพื้นที่/สภาพอากาศสดตอนนี้ เลยฟันธงแทนทีมงานหน้างานไม่ได้ครับ`,
    `โดยทั่วไป ${activityName} เล่นได้ในสภาพอากาศปกติ แต่ถ้าฝนตกหนัก/พื้นลื่นมาก ทีมงานจะพิจารณาความปลอดภัยหน้างานอีกครั้ง`,
    'แนะนำเช็คกับทีมงานตอนถึงหน้างานเพื่อความชัวร์ครับ ถ้าเล่นไม่ได้ทองไทยมีตัวเลือกอื่น (กิน/คาเฟ่/พัก) ให้ปรับแผนได้เสมอ',
  ].join('\n');
}

export function composeSafetyUncertaintyResponse(): string {
  return [
    ...SAFETY_GENERAL_GUIDANCE.lines,
    '',
    'มีเรื่องไหนที่กังวลเป็นพิเศษไหมครับ ทองไทยช่วยดูให้ได้',
  ].join('\n');
}

export function composeLocalConciergeResponse(match: LocalConciergeMatch, message: string): string {
  switch (match.category) {
    case 'weather_condition': return composeWeatherConditionResponse(message);
    case 'region_place': return composeRegionPlaceResponse();
    case 'food_culture': return composeFoodCultureResponse();
    case 'visitor_journey': return composeVisitorJourneyResponse(message);
    case 'activity_suitability': return composeActivitySuitabilityResponse(match);
    case 'safety_uncertainty': return composeSafetyUncertaintyResponse();
  }
}
