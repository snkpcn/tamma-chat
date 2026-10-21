/** Understanding a reply to the topic menu Thongthai just offered, without
 *  the model.
 *
 *  The greeting offers "กิน พัก กิจกรรม โลเคชั่น อากาศ หรือจัดทริป". A
 *  customer who answers "ทั้งหมดเลยครับ" or "all of them" says nothing on its
 *  own, so it went to the semantic call, came back domain=unknown, fell to
 *  the legacy brain and its 1.4544 THB reservation, and on a spent budget
 *  ended in "คิดช้า ลองใหม่" -- repeatedly.
 *
 *  The offer is now recorded with the reply that makes it (pending_offer in
 *  the guest's agent state, the same store LINE uses because it carries no
 *  chat history). On the NEXT turn only, a reply that is "all", a number or
 *  an option name is rewritten into the explicit question it stands for, and
 *  the normal pipeline answers that question. Every rewrite below was
 *  measured on both channels to be answered from live data with zero model
 *  calls, except "trip", which still takes one interpretation call.
 *
 *  "Next turn only": the offer is valid while no conversation turn has been
 *  recorded after it and for at most OFFER_TTL_MS. "ทั้งหมดเลย" after a menu
 *  list therefore never reaches this rewrite. */
import type { AgentStateUpdate, BrainResponse } from './_thongthai-brain-v3';

export const OFFER_TTL_MS = 10 * 60_000;

/** Same order as the offer text: กิน พัก กิจกรรม โลเคชั่น อากาศ จัดทริป. */
export const TOPIC_MENU_OPTIONS = ['dining', 'stay', 'activities', 'location', 'weather', 'trip'] as const;
export type TopicMenuOption = typeof TOPIC_MENU_OPTIONS[number];
export type OfferReply = { kind: 'all' } | { kind: 'option'; option: TopicMenuOption };
/** topic_menu: the greeting's numbered-order menu. catalog_list: the
 *  discovery list, whose order differs, so a bare number is not accepted. */
export type PendingOfferState = {
  kind: 'topic_menu' | 'catalog_list';
  offeredAt: string;
  /** The language the offer was made in: a bare "2" says nothing about
   *  language, and on LINE there is no UI language to fall back to. */
  language?: string;
};

const PARTICLES = '(?:\\s*(?:ครับ|คับ|ค่ะ|คะ|ค่า|นะ|จ้า|จ้ะ|ฮะ|เลย|ด้วย|please|pls))*\\s*[!.~]*';
const ALL_TH = new RegExp(`^(?:เอา)?(?:ทั้งหมด|ทุกอย่าง|ทุกเรื่อง|หมดทุกอย่าง|ได้หมด|เอาหมด|หมดเลย)${PARTICLES}$`, 'u');
const ALL_EN = new RegExp(`^(?:all|all of (?:them|it|the above)|everything|every thing|both)${PARTICLES}$`, 'iu');
/** "All" in Chinese, Lao and Vietnamese, with their polite endings. */
const ALL_OTHER = /^(?:全部|都要|全都要|所有|都可以|全部都要|ທັງໝົດ|ທຸກຢ່າງ|ເອົາທັງໝົດ|tất cả|tất cả luôn|cả|hết)[\s!.~。！]*(?:吧|啊|ເດີ້|ຄັບ|ạ|nhé)?[\s!.~。！]*$/iu;
const OPTION_PATTERNS: Array<[TopicMenuOption, RegExp]> = [
  ['dining', /^(?:เรื่อง)?(?:กิน|อาหาร|ร้านอาหาร|ของกิน|food|dining|eat|eating|restaurant)$/iu],
  ['stay', /^(?:เรื่อง)?(?:พัก|ที่พัก|ห้องพัก|stay|stays|accommodation|room|rooms)$/iu],
  ['activities', /^(?:เรื่อง)?(?:กิจกรรม|activity|activities)$/iu],
  ['location', /^(?:เรื่อง)?(?:โลเคชั่น|โลเคชัน|ที่ตั้ง|แผนที่|location|directions|map)$/iu],
  ['weather', /^(?:เรื่อง)?(?:อากาศ|สภาพอากาศ|weather)$/iu],
  ['trip', /^(?:เรื่อง)?(?:จัดทริป|ทริป|วางแผน|trip|plan|planning|a trip|plan a trip)$/iu],
];

/** "all", "1".."6" or one option name, with polite particles. Anything else
 *  is not a reply to the menu. */
export function parseOfferReply(message: string): OfferReply | null {
  const text = message.trim();
  if (!text || text.length > 40) return null;
  if (ALL_TH.test(text) || ALL_EN.test(text) || ALL_OTHER.test(text)) return { kind: 'all' };
  const number = /^([1-6])(?:\s*(?:ครับ|ค่ะ|คะ|นะ))*$/u.exec(text);
  if (number) return { kind: 'option', option: TOPIC_MENU_OPTIONS[Number(number[1]) - 1] };
  const bare = text
    .replace(new RegExp(`${PARTICLES}$`, 'iu'), '')
    .replace(/^(?:the|เอา)\s*/iu, '')
    .trim();
  for (const [option, pattern] of OPTION_PATTERNS) if (pattern.test(bare)) return { kind: 'option', option };
  return null;
}

/** The explicit question each reply stands for. Thai questions are the ones
 *  measured to be answered from live data; English ones go through the
 *  English deterministic paths. */
const CANONICAL: Record<'all' | TopicMenuOption, { th: string; en: string }> = {
  all: { th: 'มีอะไรให้ทำบ้าง', en: 'What can I do here?' },
  dining: { th: 'มีเมนูอะไรแนะนำบ้าง', en: 'What is on the menu?' },
  stay: { th: 'ห้องพักว่างไหม', en: 'Do you have rooms available?' },
  activities: { th: 'มีกิจกรรมอะไรบ้าง', en: 'What activities do you have?' },
  location: { th: 'ร้านอยู่ที่ไหน', en: 'Where are you located?' },
  weather: { th: 'วันนี้อากาศเป็นยังไงบ้าง', en: 'What is the weather like today?' },
  trip: { th: 'ช่วยจัดทริปให้หน่อย', en: 'Can you plan a trip for me?' },
};

export function canonicalQueryForOfferReply(reply: OfferReply, language: string): string {
  const entry = CANONICAL[reply.kind === 'all' ? 'all' : reply.option];
  // Chinese, Lao and Vietnamese replies go straight to the Thai question;
  // the turn keeps its language and its responder renders that language.
  return language === 'en' ? entry.en : entry.th;
}

/** Is this offer still the one the customer is answering? */
export function isLiveOffer(offer: unknown, lastTurnAt: string | null, now: number = Date.now()): offer is PendingOfferState {
  if (!offer || typeof offer !== 'object') return false;
  const { kind, offeredAt } = offer as Record<string, unknown>;
  if ((kind !== 'topic_menu' && kind !== 'catalog_list') || typeof offeredAt !== 'string') return false;
  const at = Date.parse(offeredAt);
  if (!Number.isFinite(at) || now - at > OFFER_TTL_MS || at > now + 60_000) return false;
  // A conversation turn recorded after the offer means the customer has
  // already moved on; the offer no longer frames their next message.
  if (lastTurnAt && Date.parse(lastTurnAt) >= at) return false;
  return true;
}

const TOPIC_MENU_TEXT_RE = /กิน พัก กิจกรรม โลเคชั่น อากาศ|dining, stays, activities, location, weather|餐饮、住宿、活动|ອາຫານ, ທີ່ພັກ, ກິດຈະກຳ|ăn uống, chỗ ở, hoạt động/u;
const CATALOG_LIST_TEXT_RE = /ที่ทำมา-ชาติมีหลายแบบ|Here’s what Thammachat offers|Thammachat 提供的内容|ສິ່ງທີ່ Thammachat ມີ|những gì Thammachat có/u;

/** Attach the offer to a reply that actually presents a menu of topics. */
export function withTopicMenuOffer(response: BrainResponse, language: string, now: Date = new Date()): BrainResponse {
  const kind = TOPIC_MENU_TEXT_RE.test(response.message) ? 'topic_menu'
    : CATALOG_LIST_TEXT_RE.test(response.message) ? 'catalog_list' : null;
  if (!kind) return response;
  const update: AgentStateUpdate = { ...(response.agentStateUpdate ?? {}), pendingOffer: { kind, offeredAt: now.toISOString(), language } };
  return { ...response, agentStateUpdate: update };
}

/** A bare number only refers to the numbered greeting menu. */
export function offerAcceptsReply(offer: PendingOfferState, reply: OfferReply, message: string): boolean {
  return offer.kind === 'topic_menu' || !/^[1-6]/u.test(message.trim()) || reply.kind === 'all';
}
