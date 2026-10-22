import type { RestaurantMenuSafetyProfile, RestaurantMenuCustomizationProfile } from './_restaurant-intelligence';

export type FoodRequirement = { kind: 'allergy' | 'avoid' | 'diet' | 'change'; value: string; source: string };
export type FoodAssessment = { status: 'conflict' | 'unknown' | 'verified'; reasons: string[] };
export type FoodFacts = {
  name: string;
  ingredients: string[];
  safety: RestaurantMenuSafetyProfile;
  customization: RestaurantMenuCustomizationProfile;
};

// Ingredient names identify possible conflicts. Absence from this vocabulary
// or from a recipe is never evidence that an allergen/diet is safe.
const INGREDIENTS: Record<string, RegExp> = {
  peanut: /ถั่วลิสง|ถั่ว(?!งอก|เหลือง)|peanuts?|花生|đậu phộng|lạc|ຖົ່ວດິນ/iu,
  tree_nut: /อัลมอนด์|มะม่วงหิมพานต์|วอลนัท|แมคคาเดเมีย|almonds?|cashews?|walnuts?|tree nuts?|坚果|腰果|hạt điều|hạnh nhân/iu,
  milk: /นม(?!ถั่ว|อัลมอนด์|ข้าว|มะพร้าว)|เนย|ชีส|ครีม|milk|dairy|butter|cheese|cream|牛奶|乳|奶|sữa|ຂອງນົມ|ນົມ/iu,
  egg: /ไข่|\beggs?\b|鸡蛋|雞蛋|蛋|trứng|ໄຂ່/iu,
  soy: /ถั่วเหลือง|เต้าหู้|ซีอิ๊ว|ซอสถั่ว|soy|tofu|大豆|豆腐|酱油|đậu nành|đậu phụ|ຖົ່ວເຫຼືອງ/iu,
  wheat: /สาลี|wheat|小麦|lúa mì|ເຂົ້າສາລີ/iu,
  gluten: /กลูเตน|สาลี|ข้าวบาร์เลย์|gluten|wheat|barley|面筋|小麦|lúa mì/iu,
  sesame: /(?:เมล็ด|น้ำมัน)?งา(?:ขาว|ดำ)?|sesame|芝麻|mè|vừng|ໝາກງາ/iu,
  shrimp: /กุ้ง|shrimp|prawn|虾|蝦|tôm|ກຸ້ງ/iu,
  fish: /ปลา(?!ย)|น้ำปลา|\bfish\b|anchov|鱼|魚|cá|ປາ/iu,
  shellfish: /อาหารทะเล|กุ้ง|ปู|หอย|หมึก|seafood|shellfish|shrimp|prawn|crab|mussel|oyster|squid|海鲜|贝|虾|hải sản|tôm|cua|mực|ອາຫານທະເລ/iu,
  pork: /หมู|pork|bacon|ham\b|猪|豬|thịt heo|thịt lợn|ໝູ/iu,
  beef: /เนื้อวัว|beef|牛肉|thịt bò|ຊີ້ນງົວ/iu,
  chicken: /ไก่|chicken|鸡|雞|thịt gà|ໄກ່/iu,
  fermented_fish: /ปลาร้า|fermented fish|ປາແດກ/iu,
  msg: /ผงชูรส|msg\b|monosodium|味精|bột ngọt|ຜົງຊູລົດ/iu,
  sugar: /น้ำตาล|sugar|糖|đường|ນ້ຳຕານ/iu,
  chili: /พริก|chil[li]+|辣椒|ớt|ໝາກເຜັດ/iu,
  honey: /น้ำผึ้ง|honey|蜂蜜|mật ong|ນ້ຳເຜິ້ງ/iu,
  celery: /เซเลอรี|ขึ้นฉ่าย|celery|芹菜|cần tây/iu,
  mustard: /มัสตาร์ด|mustard|芥末|mù tạt/iu,
  lupin: /ลูปิน|lupin/iu,
  sulphite: /ซัลไฟต์|sulfites?|sulphites?|ซัลเฟอร์ไดออกไซด์|二氧化硫/iu,
};
const ALLERGY = /(?<!ไม่)(?<!ไม่เคย)แพ้|allerg(?:y|ic)|过敏|過敏|dị ứng|ແພ້/iu;
const AVOID = /ไม่(?:ใส่|เอา|กิน|ทาน|ใช้)|งด|เลี่ยง|ไม่มี|ปราศจาก|ปลอด|ไร้|\b(?:no|without|avoid|free from)\b|[- ]free\b|不放|不要|不吃|无|無|không(?: (?:có|ăn|dùng|cho))?|ບໍ່(?:ໃສ່|ກິນ|ເອົາ)/iu;
const DIETS: Record<string, RegExp> = {
  vegan: /วีแกน|วีแก้น|vegan|纯素|純素|thuần chay/iu,
  vegetarian: /มังสวิรัติ|vegetarian|素食|ăn chay/iu,
  jay: /(?:อาหาร|กิน|ทาน|ผัดไทย)?เจ(?:\s|$|ไหม|ได้|ไม่)|齋|斋/iu,
  halal: /ฮาลาล|halal|清真/iu,
  kosher: /โคเชอร์|kosher|犹太洁食/iu,
  gluten_free: /gluten[- ]?free|ปลอดกลูเตน|ไม่มีกลูเตน|无麸质|không gluten/iu,
  lactose_free: /lactose[- ]?free|แลคโตส|แล็กโทส|无乳糖/iu,
};
const CHANGES = /เบาหวาน|ความดัน|โรคไต|โรคหัวใจ|ตั้งครรภ์|คนท้อง|อาหารทารก|อาหารเด็กเล็ก|diabet|kidney|pregnan|nutrition|calor|แคลอรี|โปรตีนสูง|ไขมันต่ำ|ลดน้ำหนัก|คีโต|keto|ไม่เผ็ด|เผ็ดน้อย|หวานน้อย|เค็มน้อย|น้ำมันน้อย|ไม่มัน|ลด(?:หวาน|เค็ม|น้ำตาล|เกลือ)|แยก(?:น้ำ|ซอส|ครัว|อุปกรณ์)|ปรุงสุก|สุกเต็มที่|ดิบ|บดละเอียด|หั่น(?:เล็ก|ละเอียด)|เพิ่ม(?:ไข่|ชีส|เนื้อ|หมู|ไก่|กุ้ง|ผัก|ท็อปปิ้ง)|เปลี่ยน(?:เป็น|จาก|วัตถุดิบ|กุ้ง|ไก่|เนื้อ|หมู|ไข่|นม|ผัก)|ใช้.{1,24}แทน|แทนด้วย|low[- ]|less |extra |separate|substitut|replace|well[- ]done|raw\b|少辣|少糖|少盐|分开|ít cay|ít đường|ít muối|ເຜັດນ້ອຍ/iu;

export function readFoodRequirements(texts: string[]): FoodRequirement[] {
  const result: FoodRequirement[] = [];
  const add = (kind: FoodRequirement['kind'], value: string, source: string) => {
    if (!result.some(r => r.kind === kind && r.value === value)) result.push({ kind, value, source });
  };
  for (const raw of texts) {
    const source = raw.normalize('NFC').trim();
    if (!source) continue;
    // Explicit corrections apply only to the ingredient actually corrected.
    const removed = new Set(foodMemoryRemovals(source));
    for (let i = result.length - 1; i >= 0; i--) {
      if (removed.has(requirementCode(result[i]) ?? '')) result.splice(i, 1);
    }
    const canonical = /^(\w+)_(allergy)$|^no_(\w+)$/.exec(source);
    if (canonical) {
      const value = canonical[1] ?? canonical[3];
      const alias = ({ peanut: 'peanut', plara: 'fermented_fish', cow_milk: 'milk', spicy: 'chili' } as Record<string, string>)[value] ?? value;
      if (INGREDIENTS[alias]) add(canonical[2] ? 'allergy' : 'avoid', alias, source);
    }
    for (const [diet, pattern] of Object.entries(DIETS)) if (source === diet || pattern.test(source)) add('diet', diet, source);
    // A later affirmative clause must not turn every named ingredient into
    // an allergen: "แพ้นม แต่กินไข่ได้" has only a milk allergy.
    const declarative = source.replace(/ไม่(?:ได้|เคย)?แพ้|ไม่ต้อง(?:งด|เลี่ยง)|\bnot allerg(?:ic|y)\b|no longer avoid/giu, '');
    const clauses = declarative.split(/แต่|\bbut\b|[;。.!?]/iu)
      .flatMap(clause => clause.split(new RegExp(`(?=(?:${ALLERGY.source}|${AVOID.source}))`, 'iu')));
    for (const clause of clauses) {
      const allergy = ALLERGY.test(clause);
      const avoid = AVOID.test(clause);
      if (!allergy && !avoid) continue;
      const marker = (allergy ? ALLERGY : AVOID).exec(clause)!;
      const after = clause.slice(marker.index + marker[0].length).split(/กิน|ทาน|แนะนำ|มีไหม|ได้ไหม|的|\b(?:but|can|do|is|with)\b/iu)[0];
      const governed = /free/iu.test(marker[0]) ? clause.slice(0, marker.index) : after;
      const hits = Object.entries(INGREDIENTS).flatMap(([ingredient, pattern]) => {
        // A shrimp allergy is not a declaration of allergy to every seafood.
        // The broad group is used only when the customer names the group.
        const readPattern = ingredient === 'shellfish' ? /อาหารทะเล|seafood|shellfish|海鲜|hải sản|ອາຫານທະເລ/iu
          : ingredient === 'fish' ? /ปลา(?!ร้า)|fish(?! sauce)|鱼|魚|cá|ປາ(?!ແດກ)/iu : pattern;
        const match = readPattern.exec(governed);
        return match ? [{ ingredient, start: match.index, end: match.index + match[0].length }] : [];
      }).sort((a, b) => a.start - b.start || b.end - a.end);
      let end = hits[0]?.start ?? 0;
      for (const hit of hits) {
        const gap = governed.slice(end, hit.start);
        if (hit.start > end && !/^(?:\s*(?:และ|กับ|หรือ|,|、|and|or|to|及|和|và|ກັບ|ແລະ)\s*)*$/iu.test(gap)) break;
        add(allergy ? 'allergy' : 'avoid', hit.ingredient, source);
        end = Math.max(end, hit.end);
      }
    }
    if (source === 'no_spicy' || /ไม่เผ็ด|not spicy|no spicy|不辣|không cay/iu.test(source)) add('avoid', 'chili', source);
    if (source === 'no_sugar') add('avoid', 'sugar', source);
    if (source === 'mild_spice') add('change', 'mild_spice', source);
    if (source === 'low_sweet') add('change', 'low_sweet', source);
    if (CHANGES.test(source)) add('change', source, source);
    if ((ALLERGY.test(source) || AVOID.test(source)) && !result.some(r => r.source === source)) add('change', source, source);
  }
  return result;
}

export function assessFoodRequirements(item: FoodFacts, requirements: FoodRequirement[]): FoodAssessment {
  const conflicts: string[] = [];
  const unknown: string[] = [];
  const recipe = item.ingredients.join(' ');
  const contains = (key: string) => {
    const text = key === 'milk' ? recipe.replace(/(?:coconut|soy|soya|almond|oat|rice)[ -]+(?:milk|cream)|(?:peanut|almond|cocoa) butter/giu, '') : recipe;
    return INGREDIENTS[key]?.test(text) ?? false;
  };
  for (const r of requirements) {
    if (r.kind === 'allergy') {
      const state = item.safety.allergens[r.value];
      if (state === 'contains' || state === 'may_contain' || item.safety.contains.includes(r.value)
        || item.safety.mayContain.includes(r.value) || contains(r.value)) conflicts.push(r.source);
      else if (state !== 'does_not_contain' || item.safety.crossContaminationRisk !== 'does_not_contain') unknown.push(r.source);
    } else if (r.kind === 'avoid') {
      const present = contains(r.value);
      if (present) {
        const removable = item.customization.removableIngredients.some(name => INGREDIENTS[r.value]?.test(name))
          || (r.value === 'chili' && item.customization.canRemoveChili === true)
          || (r.value === 'fermented_fish' && item.customization.canRemoveFermentedFish === true)
          || (r.value === 'msg' && item.customization.canRemoveMsg === true)
          || (r.value === 'sugar' && item.customization.canReduceOrRemoveSugar === true);
        if (!removable) conflicts.push(r.source);
      } else if (item.safety.allergens[r.value] !== 'does_not_contain') unknown.push(r.source);
    } else if (r.kind === 'diet') {
      const animal = ['pork', 'beef', 'chicken', 'fish', 'shrimp', 'shellfish'];
      if (r.value === 'vegan' || r.value === 'jay') animal.push('egg', 'milk', 'honey');
      if (['vegan', 'vegetarian', 'jay'].includes(r.value) && animal.some(contains)) conflicts.push(r.source);
      else if (!item.safety.dietaryTags.includes(r.value)) unknown.push(r.source);
    } else {
      // Generic changes (salt, doneness, separation, add/substitute, nutrition)
      // need actual kitchen capability data. Never silently reduce them to stock.
      unknown.push(r.source);
    }
  }
  return { status: conflicts.length ? 'conflict' : unknown.length ? 'unknown' : 'verified', reasons: [...new Set(conflicts.length ? conflicts : unknown)] };
}

const AVOID_CODE: Record<string, string> = { chili: 'no_spicy', fermented_fish: 'no_plara', milk: 'no_cow_milk' };
const requirementCode = (r: FoodRequirement) => r.kind === 'allergy' ? `${r.value}_allergy`
  : r.kind === 'avoid' ? AVOID_CODE[r.value] ?? `no_${r.value}` : r.kind === 'diet' ? r.value : null;
export const FOOD_MEMORY_CODES = [
  ...Object.keys(INGREDIENTS).flatMap(value => [`${value}_allergy`, AVOID_CODE[value] ?? `no_${value}`]),
  ...Object.keys(DIETS),
];
export function foodMemorySignals(message: string): string[] {
  return [...new Set(readFoodRequirements([message]).map(requirementCode).filter((code): code is string => code !== null))];
}
export function foodConstraintPattern(code: string, removal = false): RegExp | undefined {
  if (DIETS[code]) return DIETS[code];
  if (removal && (code === 'no_spicy' || code === 'mild_spice')) return /กินเผ็ดได้แล้ว|เอาเผ็ด(?:มาก|กลาง)|spicy is fine/iu;
  const r = readFoodRequirements([code])[0];
  if (!r || !INGREDIENTS[r.value]) return undefined;
  const marker = removal
    ? r.kind === 'allergy' ? 'ไม่(?:ได้|เคย)?แพ้|not allergic' : 'กิน|ทาน|ไม่ต้อง(?:งด|เลี่ยง)|can eat|no longer avoid'
    : r.kind === 'allergy' ? ALLERGY.source : AVOID.source;
  return new RegExp(`(?:${marker}).{0,24}(?:${INGREDIENTS[r.value].source})`, 'iu');
}

/** Kitchen-facing labels for normalized memory codes; never expose storage keys. */
export function describeFoodRequirement(r: FoodRequirement): string {
  if (!/^[a-z]+(?:_[a-z]+)*$/u.test(r.source)) return r.source;
  const names: Record<string, string> = { peanut: 'ถั่วลิสง', tree_nut: 'ถั่วเปลือกแข็ง', milk: 'นม', egg: 'ไข่',
    soy: 'ถั่วเหลือง', wheat: 'สาลี', gluten: 'กลูเตน', sesame: 'งา', shrimp: 'กุ้ง', fish: 'ปลา',
    shellfish: 'อาหารทะเล', pork: 'หมู', beef: 'เนื้อวัว', chicken: 'ไก่', fermented_fish: 'ปลาร้า',
    msg: 'ผงชูรส', sugar: 'น้ำตาล', chili: 'พริก', honey: 'น้ำผึ้ง', celery: 'ขึ้นฉ่าย', mustard: 'มัสตาร์ด',
    lupin: 'ลูปิน', sulphite: 'ซัลไฟต์', vegan: 'วีแกน', vegetarian: 'มังสวิรัติ', jay: 'อาหารเจ',
    halal: 'ฮาลาล', kosher: 'โคเชอร์', gluten_free: 'ปลอดกลูเตน', lactose_free: 'ไม่มีแลคโตส' };
  const name = names[r.value] ?? r.value.replace(/_/gu, ' ');
  return r.kind === 'allergy' ? `แพ้${name}` : r.kind === 'avoid' ? `ไม่ใส่${name}` : name;
}

export function foodMemoryRemovals(message: string): string[] {
  if (/ถ้า|สมมติ|\bif\b/iu.test(message)) return [];
  const result: string[] = [];
  const allow = [...message.matchAll(/(?:กลับมา)?(?:กิน|ทาน)(.{1,24}?)ได้แล้ว|ไม่ต้อง(?:งด|เลี่ยง)(.{1,24})|(?:can eat|no longer avoid)\s+([^.;]+)/giu)]
    .map(match => match[1] ?? match[2] ?? match[3] ?? '');
  const notAllergic = [...message.matchAll(/ไม่(?:ได้|เคย)?แพ้(.{1,24})|not allergic(?: to)?\s+([^.;]+)/giu)]
    .map(match => match[1] ?? match[2] ?? '');
  for (const [value, pattern] of Object.entries(INGREDIENTS)) {
    if (allow.some(text => pattern.test(text))) result.push(AVOID_CODE[value] ?? `no_${value}`);
    if (notAllergic.some(text => pattern.test(text))) result.push(`${value}_allergy`);
  }
  if (/กินเผ็ดได้แล้ว|เอาเผ็ด(?:มาก|กลาง)|spicy is fine/iu.test(message)) result.push('no_spicy', 'mild_spice');
  return [...new Set(result)];
}
