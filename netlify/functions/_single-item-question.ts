/** "ผัดไทยมีไหม", "น้ำผึ้งป่าเหลือไหม", "Do you have pad thai?" -- one named
 *  dish or souvenir, answered from the live menu and product list without the
 *  model.
 *
 *  These went to the semantic call and the legacy brain (two paid calls). The
 *  question is narrow on purpose: the whole message must be an item name plus
 *  an "is there / any left" marker, and the name must match a live item. A
 *  name that matches nothing is not claimed, so other questions keep their
 *  path. The reply uses the same states as the menu and souvenir lists: in
 *  stock, sold out, no stock figure, and a failed read. */
import type { RestaurantMenuItem } from './_restaurant-sot';

export type ItemQuestion = { stem: string; language: 'th' | 'en' };

const PARTICLES = '(?:\\s*(?:ครับ|คับ|ค่ะ|คะ|ค่า|นะ|จ้า|จ้ะ|ฮะ|บ้าง|เลย))*\\s*[?!.~]*';
const TH_SHAPES = [
  new RegExp(`^(?:ยัง)?มี(.{2,24}?)(?:ขาย)?(?:อยู่)?(?:ไหม|มั้ย|มั๊ย|หรือเปล่า|รึเปล่า|ป่าว)${PARTICLES}$`, 'u'),
  new RegExp(`^(.{2,24}?)\\s*(?:ยัง)?(?:มี(?:ขาย)?|เหลือ)(?:อยู่)?(?:ไหม|มั้ย|มั๊ย|หรือเปล่า|รึเปล่า|ป่าว)${PARTICLES}$`, 'u'),
  new RegExp(`^(.{2,24}?)\\s*หมด(?:แล้ว)?(?:ยัง|หรือยัง|ไหม|มั้ย)${PARTICLES}$`, 'u'),
];
const EN_SHAPES = [
  /^(?:do\s+you\s+(?:have|sell|serve)|have\s+you\s+got|is\s+there|are\s+there|any)\s+(?:the\s+|any\s+|some\s+)?(.{2,30}?)(?:\s+(?:today|now|left|available|in\s+stock))?$/u,
  /^(?:is|are)\s+(?:the\s+)?(.{2,30}?)\s+(?:available|in\s+stock|sold\s+out)(?:\s+(?:today|now))?$/u,
];
/** Words that make it a different question: a topic, a facility, a slot. */
const NOT_AN_ITEM = /(?:อะไร|เมนู|ของฝาก|กิจกรรม|ห้อง|ที่พัก|โต๊ะ|คิว|ว่าง|รอบ|โปร|ส่วนลด|ที่จอด|ห้องน้ำ|วายฟาย|wifi|ไวไฟ|ม้า|atv|ธนู|เป็ด|วันนี้|พรุ่งนี้|กี่|ราคา|จอง|สั่ง|menu|room|table|parking|toilet|discount|promotion|horse|activit)/iu;

/** English names for Thai dish and product words: vocabulary only. Whether
 *  the shop sells it, at what price, and how many are left always come from
 *  the live data. */
const ENGLISH_TERMS: ReadonlyArray<[RegExp, string]> = [
  [/\bpad\s*thai\b/u, 'ผัดไทย'],
  [/\btom\s*yum\b/u, 'ต้มยำ'],
  [/\btom\s*saep\b|\btom\s*zap\b/u, 'ต้มแซ่บ'],
  [/\bfried\s*rice\b/u, 'ข้าวผัด'],
  [/\b(?:som\s*tam|papaya\s*salad)\b/u, 'ส้มตำ'],
  [/\bsticky\s*rice\b/u, 'ข้าวเหนียว'],
  [/\blarb\b|\blaab\b/u, 'ลาบ'],
  [/\bhoney\b/u, 'น้ำผึ้ง'],
  [/\bscarf\b|\bscarves\b/u, 'ผ้าพันคอ'],
];

export function readItemQuestion(message: string): ItemQuestion | null {
  const text = message.normalize('NFC').trim();
  if (!text || text.length > 60) return null;
  if (/[฀-๿]/u.test(text)) {
    for (const shape of TH_SHAPES) {
      const stem = shape.exec(text)?.[1]?.trim();
      if (stem && !NOT_AN_ITEM.test(stem)) return { stem, language: 'th' };
    }
    return null;
  }
  const lower = text.toLowerCase().replace(/[’`]/gu, "'").replace(/[?!.]+$/u, '').replace(/\s+/gu, ' ').trim();
  for (const shape of EN_SHAPES) {
    const phrase = shape.exec(lower)?.[1]?.trim();
    if (!phrase || NOT_AN_ITEM.test(phrase)) continue;
    const term = ENGLISH_TERMS.find(([pattern]) => pattern.test(phrase));
    if (term) return { stem: term[1], language: 'en' };
  }
  return null;
}

const compact = (value: string) => value.replace(/[\s\-–—()·.,]+/gu, '').toLowerCase();

/** Live items whose name is the stem or contains it ("ต้มแซ่บ" → ต้มแซ่บไก่บ้าน). */
function matching<T extends { name: string }>(rows: T[], stem: string): T[] {
  const needle = compact(stem);
  if (needle.length < 2) return [];
  const exact = rows.filter(row => compact(row.name) === needle);
  return exact.length ? exact : rows.filter(row => compact(row.name).includes(needle));
}

export type ItemSources = {
  menu: RestaurantMenuItem[] | 'failed';
  products: Array<{ name: string; price: number; stock: number | null }> | 'failed';
};

const money = (value: number, en: boolean) => `${Math.round(value)} ${en ? 'THB' : 'บาท'}`;

/** null = the stem names no live item (and nothing failed): not ours. */
export function answerItemQuestion(question: ItemQuestion, sources: ItemSources): string | null {
  const en = question.language === 'en';
  const dishes = sources.menu === 'failed' ? [] : matching(sources.menu, question.stem);
  const goods = sources.products === 'failed' ? [] : matching(sources.products, question.stem);
  const lines: string[] = [];
  for (const dish of dishes.slice(0, 5)) {
    const price = money(dish.selling_price, en);
    const soldOut = !dish.is_orderable || (dish.available_servings !== null && dish.available_servings <= 0) || dish.unavailable_ingredients.length > 0;
    lines.push(soldOut
      ? (en ? `${dish.name} is sold out right now` : `${dish.name} ตอนนี้หมดแล้ว`)
      : dish.available_servings === null
        ? (en ? `${dish.name} (${price}) is on the menu, but I have no current stock figure, so I can’t confirm it’s available now`
          : `${dish.name} ${price} มีในเมนู แต่ยังไม่มีข้อมูลสต๊อกล่าสุด ยืนยันไม่ได้ว่าพร้อมสั่งตอนนี้`)
        : (en ? `${dish.name} is available, ${price}` : `${dish.name} มี ${price} พร้อมสั่ง`));
  }
  for (const item of goods.slice(0, 5)) {
    const price = money(item.price, en);
    lines.push(item.stock === null
      ? (en ? `${item.name} (${price}) is listed, but I have no current stock figure, so I can’t confirm any are left`
        : `${item.name} ${price} มีในรายการ แต่ยังไม่มีข้อมูลสต๊อกล่าสุด ยืนยันไม่ได้ว่ายังเหลือ`)
      : item.stock <= 0
        ? (en ? `${item.name} is sold out right now` : `${item.name} ตอนนี้หมดแล้ว`)
        : (en ? `${item.name} is in stock (${item.stock} left), ${price}` : `${item.name} มี เหลือ ${item.stock} ชิ้น ราคา ${price}`));
  }
  if (lines.length) {
    const failed = sources.menu === 'failed' ? (en ? 'the menu' : 'เมนูอาหาร') : sources.products === 'failed' ? (en ? 'the souvenir list' : 'รายการของฝาก') : null;
    const body = lines.length === 1
      ? lines[0]! + (en ? '.' : 'ครับ')
      : [en ? 'Here’s what matches:' : 'ที่ตรงกับที่ถามมีดังนี้ครับ', ...lines.map(line => `• ${line}`)].join('\n');
    return failed ? `${body}\n${en ? `(I couldn’t read ${failed} just now.)` : `(ตอนนี้อ่าน${failed}ไม่สำเร็จ)`}` : body;
  }
  // Nothing matched. If a source could not be read, the item may be there:
  // say that rather than "we don't have it".
  if (sources.menu === 'failed' || sources.products === 'failed') {
    return en
      ? `I couldn’t read our live menu and product list just now, so I can’t confirm whether we have ${question.stem}. Please ask again in a moment.`
      : `ตอนนี้ตรวจสอบรายการเมนูและของฝากล่าสุดไม่สำเร็จครับ ทองไทยจึงยืนยันไม่ได้ว่ามี${question.stem}ไหม ลองถามอีกครั้งในอีกสักครู่นะครับ`;
  }
  return null;
}
