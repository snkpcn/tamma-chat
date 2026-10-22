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
import { readFoodRequirements, assessFoodRequirements, describeFoodRequirement } from './_food-constraints';
import type { RestaurantMenuItem } from './_restaurant-sot';

import { replyLanguage, T } from './_reply-templates';

/** `asked` is the customer's own word for the item, shown when it is not
 *  found (a Thai stem would mean nothing to them). */
export type ItemQuestion = { stem: string; language: 'th' | 'en' | 'zh' | 'lo' | 'vi'; asked?: string; requiresConfirmation?: boolean };

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

/** The same vocabulary in Chinese, Lao and Vietnamese. */
const OTHER_TERMS: Record<'zh' | 'lo' | 'vi', ReadonlyArray<[RegExp, string]>> = {
  zh: [[/泰式炒河粉|泰式炒粉|炒河粉/u, 'ผัดไทย'], [/冬阴功/u, 'ต้มยำ'], [/炒饭/u, 'ข้าวผัด'], [/青?木瓜沙拉/u, 'ส้มตำ'],
    [/糯米饭?/u, 'ข้าวเหนียว'], [/蜂蜜/u, 'น้ำผึ้ง'], [/围巾/u, 'ผ้าพันคอ']],
  lo: [[/ຜັດໄທ/u, 'ผัดไทย'], [/ຕົ້ມຍຳ/u, 'ต้มยำ'], [/ຕົ້ມແຊບ/u, 'ต้มแซ่บ'], [/ເຂົ້າຜັດ/u, 'ข้าวผัด'], [/ຕຳໝາກຫຸ່ງ/u, 'ส้มตำ'],
    [/ເຂົ້າໜຽວ/u, 'ข้าวเหนียว'], [/ລາບ/u, 'ลาบ'], [/ນ້ຳເຜິ້ງ/u, 'น้ำผึ้ง'], [/ຜ້າພັນຄໍ/u, 'ผ้าพันคอ']],
  vi: [[/pad thai|phở xào thái|hủ tiếu xào thái/u, 'ผัดไทย'], [/tom yum|canh chua thái/u, 'ต้มยำ'], [/cơm chiên|cơm rang/u, 'ข้าวผัด'],
    [/gỏi đu đủ|som tam/u, 'ส้มตำ'], [/xôi|cơm nếp/u, 'ข้าวเหนียว'], [/larb|gỏi thịt băm/u, 'ลาบ'], [/mật ong/u, 'น้ำผึ้ง'],
    [/khăn quàng|khăn choàng/u, 'ผ้าพันคอ']],
};
/** "Is there X / any X left / X sold out?" in Chinese, Lao and Vietnamese.
 *  As in English, the item must be a vocabulary word. */
const OTHER_SHAPES: Record<'zh' | 'lo' | 'vi', RegExp[]> = {
  zh: [/^(?:请问)?(?:有没有|有)(.{1,12}?)(?:吗|么|嘛)?$/u, /^(.{1,12}?)(?:还有吗|还有没有|有吗|有没有|卖完了吗|卖完了没)$/u],
  lo: [/^ມີ(.{1,20}?)(?:ບໍ່|ບໍ)$/u, /^(.{1,20}?)(?:ຍັງເຫຼືອບໍ່|ມີບໍ່|ໝົດແລ້ວບໍ່|ຍັງມີບໍ່)$/u],
  vi: [/^(?:có|còn) (.{2,30}?) (?:không|ko)$/u, /^(.{2,30}?) (?:còn không|có không|hết chưa|còn ko)$/u],
};

/** The Thai side of that vocabulary: words known to name a dish or product. */
const KNOWN_ITEM_WORDS = new Set(ENGLISH_TERMS.map(([, thai]) => thai));

export function readItemQuestion(message: string, language?: string): ItemQuestion | null {
  const text = message.normalize('NFC').trim();
  if (!text || text.length > 60) return null;
  if (language === 'zh' || language === 'lo' || language === 'vi') {
    const plain = text.toLowerCase().replace(/[?？!！。.~～]+$/u, '').replace(/\s+/gu, ' ').trim();
    for (const shape of OTHER_SHAPES[language]) {
      const phrase = shape.exec(plain)?.[1]?.trim();
      if (!phrase) continue;
      const term = OTHER_TERMS[language].find(([pattern]) => pattern.test(phrase));
      if (term) return { stem: term[1], language, asked: phrase, requiresConfirmation: phrase.replace(term[0], '').trim().length > 0 };
    }
    return null;
  }
  if (/[฀-๿]/u.test(text)) {
    for (const shape of TH_SHAPES) {
      const stem = shape.exec(text)?.[1]?.trim();
      if (stem && !NOT_AN_ITEM.test(stem)) return { stem, language: 'th', asked: stem, requiresConfirmation: /vegan|vegetarian|gluten|แพ้|ไม่ใส่|ไม่เอา|ไม่มี|ปลอด|มังสวิรัติ|วีแกน|ฮาลาล|(?:อาหาร)?เจ(?:\s|$)/iu.test(stem) };
    }
    return null;
  }
  const lower = text.toLowerCase().replace(/[’`]/gu, "'").replace(/[?!.]+$/u, '').replace(/\s+/gu, ' ').trim();
  for (const shape of EN_SHAPES) {
    const phrase = shape.exec(lower)?.[1]?.trim();
    if (!phrase || NOT_AN_ITEM.test(phrase)) continue;
    const term = ENGLISH_TERMS.find(([pattern]) => pattern.test(phrase));
    if (term) return { stem: term[1], language: 'en', asked: phrase, requiresConfirmation: phrase.replace(term[0], '').trim().length > 0 };
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

/** null = the stem names no live item (and nothing failed): not ours. */
export function answerItemQuestion(question: ItemQuestion, sources: ItemSources, constraints: string[] = []): string | null {
  // The vocabulary match must never erase the rest of the question. A
  // stock row cannot verify a recipe change, a dietary variant or cross-contact.
  const requirements = readFoodRequirements([...constraints, question.asked ?? question.stem]);
  const exactStemDishes = sources.menu === 'failed' ? [] : matching(sources.menu, question.stem);
  const requirementDishes = exactStemDishes.length || !requirements.length || sources.menu === 'failed'
    ? exactStemDishes : sources.menu.filter(item => compact(question.stem).includes(compact(item.name)));
  const assessments = requirementDishes.map(item => assessFoodRequirements({
    name: item.name, ingredients: item.ingredient_names, safety: item.safety, customization: item.customization,
  }, requirements));
  // Current wording and remembered requirements govern the quick stock path
  // together. Only affirmative kitchen/recipe data may establish suitability.
  if (question.requiresConfirmation || requirements.length) {
    const asked = question.asked ?? question.stem;
    const verified = requirements.length > 0 && !question.requiresConfirmation
      && assessments.length > 0 && assessments.every(result => result.status === 'verified');
    if (!verified) {
    const messages = {
      th: `สำหรับ “${asked}” ยังยืนยันส่วนประกอบและการปรับสูตรตามเงื่อนไขนี้ไม่ได้ครับ กรุณายืนยันกับทีมครัวก่อนสั่ง โดยเฉพาะกรณีแพ้อาหาร`,
      en: `For “${asked}”, I cannot confirm the ingredients or recipe changes required. Please check with the kitchen before ordering, especially for food allergies.`,
      zh: `关于“${asked}”，目前无法确认配料或是否能按此要求调整做法。请在点餐前向厨房确认，尤其是食物过敏的情况。`,
      lo: `ສຳລັບ “${asked}” ຍັງຢືນຢັນສ່ວນປະກອບ ຫຼືການປັບສູດຕາມເງື່ອນໄຂນີ້ບໍ່ໄດ້. ກະລຸນາຢືນຢັນກັບທີມຄົວກ່ອນສັ່ງ ໂດຍສະເພາະຖ້າແພ້ອາຫານ.`,
      vi: `Với “${asked}”, hiện chưa thể xác nhận nguyên liệu hoặc việc thay đổi công thức theo yêu cầu. Vui lòng xác nhận với nhà bếp trước khi gọi món, đặc biệt nếu bị dị ứng thực phẩm.`,
    };
    const remembered = constraints.filter(value => !/^[a-z]+(?:_[a-z]+)+$/u.test(value));
    const context = remembered.length ? ` (${remembered.join('; ')})` : '';
    const conflict = assessments.some(result => result.status === 'conflict');
    const conflictText = {
      th: 'ข้อมูลส่วนประกอบที่บันทึกไว้มีส่วนที่ขัดกับเงื่อนไขนี้ครับ ',
      en: 'The recorded ingredients conflict with the requested conditions. ',
      zh: '记录的配料与这些饮食要求冲突。',
      lo: 'ສ່ວນປະກອບທີ່ບັນທຶກໄວ້ຂັດກັບເງື່ອນໄຂນີ້. ',
      vi: 'Nguyên liệu được ghi nhận không phù hợp với yêu cầu này. ',
    };
    const memoryText = question.language === 'th' && requirements.length
      ? ` เงื่อนไขที่ตรวจ: ${[...new Set(requirements.map(describeFoodRequirement))].join('; ')}` : context;
    return (conflict ? conflictText[question.language] : '') + messages[question.language] + memoryText;
    }
  }
  // Thai keeps its own wording; every other language uses the templates.
  const other = question.language !== 'th';
  const rl = replyLanguage(question.language);
  const price = (value: number) => other ? T.money(rl, value) : `${Math.round(value)} บาท`;
  const dishes = sources.menu === 'failed' ? [] : matching(sources.menu, question.stem);
  const goods = sources.products === 'failed' ? [] : matching(sources.products, question.stem);
  const lines: string[] = [];
  for (const dish of dishes.slice(0, 5)) {
    const soldOut = !dish.is_orderable || (dish.available_servings !== null && dish.available_servings <= 0) || dish.unavailable_ingredients.length > 0;
    lines.push(soldOut
      ? (other ? T.item.soldOut[rl](dish.name) : `${dish.name} ตอนนี้หมดแล้ว`)
      : dish.available_servings === null
        ? (other ? T.item.menuNoData[rl](dish.name, price(dish.selling_price))
          : `${dish.name} ${price(dish.selling_price)} มีในเมนู แต่ยังไม่มีข้อมูลสต๊อกล่าสุด ยืนยันไม่ได้ว่าพร้อมสั่งตอนนี้`)
        : (other ? T.item.available[rl](dish.name, price(dish.selling_price)) : `${dish.name} มี ${price(dish.selling_price)} พร้อมสั่ง`));
  }
  for (const item of goods.slice(0, 5)) {
    lines.push(item.stock === null
      ? (other ? T.item.listedNoData[rl](item.name, price(item.price))
        : `${item.name} ${price(item.price)} มีในรายการ แต่ยังไม่มีข้อมูลสต๊อกล่าสุด ยืนยันไม่ได้ว่ายังเหลือ`)
      : item.stock <= 0
        ? (other ? T.item.soldOut[rl](item.name) : `${item.name} ตอนนี้หมดแล้ว`)
        : (other ? T.item.inStock[rl](item.name, item.stock, price(item.price)) : `${item.name} มี เหลือ ${item.stock} ชิ้น ราคา ${price(item.price)}`));
  }
  const asked = question.asked ?? question.stem;
  if (lines.length) {
    const failed = sources.menu === 'failed' ? 'menu' as const : sources.products === 'failed' ? 'products' as const : null;
    const body = lines.length === 1
      ? lines[0]! + (other ? T.item.end[rl] : 'ครับ')
      : [other ? T.item.matches[rl] : 'ที่ตรงกับที่ถามมีดังนี้ครับ', ...lines.map(line => `• ${line}`)].join('\n');
    if (!failed) return body;
    return `${body}\n${other ? T.item.partialFailure[rl](failed) : `(ตอนนี้อ่าน${failed === 'menu' ? 'เมนูอาหาร' : 'รายการของฝาก'}ไม่สำเร็จ)`}`;
  }
  // Nothing matched. If a source could not be read, the item may be there:
  // say that rather than "we don't have it".
  if (sources.menu === 'failed' || sources.products === 'failed') {
    return other
      ? T.item.readFailed[rl](asked)
      : `ตอนนี้ตรวจสอบรายการเมนูและของฝากล่าสุดไม่สำเร็จครับ ทองไทยจึงยืนยันไม่ได้ว่ามี${question.stem}ไหม ลองถามอีกครั้งในอีกสักครู่นะครับ`;
  }
  // Both lists were read and neither carries it. Only a known dish/product
  // word may be answered "not on the list": any other stem may not be an item
  // question at all, so it keeps its path.
  if (KNOWN_ITEM_WORDS.has(question.stem)) {
    return other
      ? T.item.notListed[rl](asked)
      : `ตอนนี้ไม่มี${question.stem}ในเมนูอาหารและรายการของฝากครับ`;
  }
  return null;
}
