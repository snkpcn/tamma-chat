export type RestaurantMenuProfile = {
  summary?: string;
  mealRoles: string[];
  tasteTags: string[];
  textureTags: string[];
  proteinTags: string[];
  allergenFlags: string[];
  spiceLevel: number;
  sourLevel: number;
  sweetLevel: number;
  richnessLevel: number;
  isanIntensity: number;
  heaviness: number;
  shareability: number;
  beginnerFriendly: boolean;
  kidFriendly: boolean;
  occasionTags: string[];
  pairingTags: string[];
};

export type RestaurantAdvisorItem = {
  id: string;
  name: string;
  category: string;
  price: number;
  signature: boolean;
  orderable: boolean;
  availableServings: number;
  ingredients: string[];
  unavailableIngredients: string[];
  profile: RestaurantMenuProfile;
};

export type RestaurantAdvisorInput = {
  query: string;
  partySize?: number | null;
  budget?: number | null;
  constraints?: string[];
  recentMessages?: string[];
};

type ParsedPreferences = {
  partySize: number | null;
  budget: number | null;
  spice: 'none' | 'mild' | 'medium' | 'hot' | null;
  vegetarian: boolean;
  avoidProteins: string[];
  preferProteins: string[];
  avoidIngredients: string[];
  allergenFlags: string[];
  goals: string[];
  selectedNames: string[];
};

type Scored = { item: RestaurantAdvisorItem; score: number; reasons: string[] };

function textList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [];
}
function bounded(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(5, n)) : fallback;
}
export function normalizeRestaurantProfile(value: unknown): RestaurantMenuProfile {
  const p = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    summary: typeof p.summary === 'string' ? p.summary : undefined,
    mealRoles: textList(p.mealRoles), tasteTags: textList(p.tasteTags), textureTags: textList(p.textureTags),
    proteinTags: textList(p.proteinTags), allergenFlags: textList(p.allergenFlags),
    spiceLevel: bounded(p.spiceLevel), sourLevel: bounded(p.sourLevel), sweetLevel: bounded(p.sweetLevel),
    richnessLevel: bounded(p.richnessLevel), isanIntensity: bounded(p.isanIntensity), heaviness: bounded(p.heaviness),
    shareability: bounded(p.shareability, 3), beginnerFriendly: p.beginnerFriendly === true, kidFriendly: p.kidFriendly === true,
    occasionTags: textList(p.occasionTags), pairingTags: textList(p.pairingTags),
  };
}

function norm(value: string): string {
  return value.toLowerCase().replace(/[()•·.,/\\_\-]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function uniq(values: string[]): string[] { return [...new Set(values.filter(Boolean))]; }
function includesAny(text: string, patterns: RegExp[]): boolean { return patterns.some(pattern => pattern.test(text)); }
function readNumber(text: string, pattern: RegExp): number | null {
  const match = text.match(pattern); if (!match) return null;
  const n = Number(String(match[1]).replace(/,/g, '')); return Number.isFinite(n) && n > 0 ? n : null;
}

const FOOD_CONSTRAINT_ALIASES: Record<string, Partial<Pick<ParsedPreferences,'spice'|'vegetarian'>> & {
  avoidProteins?: string[]; avoidIngredients?: string[]; allergenFlags?: string[]; goals?: string[];
}> = {
  no_pork:{avoidProteins:['pork']}, no_beef:{avoidProteins:['beef']}, no_chicken:{avoidProteins:['chicken']},
  no_fish:{avoidProteins:['fish']}, no_egg:{avoidProteins:['egg']}, no_plara:{avoidIngredients:['น้ำปลาร้า']},
  no_peanut:{avoidIngredients:['ถั่วลิสงคั่ว']}, no_shrimp:{avoidIngredients:['กุ้งแห้ง','กุ้ง']},
  peanut_allergy:{allergenFlags:['peanut']}, shrimp_allergy:{allergenFlags:['shrimp']},
  fish_allergy:{allergenFlags:['fish']}, egg_allergy:{allergenFlags:['egg']},
  no_spicy:{spice:'none'}, mild_spice:{spice:'mild'}, vegetarian:{vegetarian:true},
  authentic_isan:{goals:['authentic']}, beginner_friendly:{goals:['beginner']}, kid_friendly:{goals:['kid']},
};

function thaiAmount(text: string): number | null {
  const digit = readNumber(text, /(?:งบ(?:ประมาณ)?|ไม่เกิน|budget)\s*(?:สัก|ประมาณ|ราวๆ|ราว|ไม่เกิน)?\s*([0-9,]{2,7})/i)
    ?? readNumber(text, /([0-9,]{2,7})\s*บาท\s*(?:พอ|ทั้งหมด|รวม|ไม่เกิน|ได้ไหม|จัดให้)/i);
  if (digit) return digit;
  const units: Record<string, number> = {
    หนึ่ง:1, นึง:1, เอ็ด:1, สอง:2, สาม:3, สี่:4, ห้า:5, หก:6, เจ็ด:7, แปด:8, เก้า:9,
  };
  for (const [word, value] of Object.entries(units)) {
    if (new RegExp(`(?:งบ|ไม่เกิน|สัก|ประมาณ)?\\s*${word}ร้อย`, 'u').test(text)) return value * 100;
  }
  if (/(?:งบ|ไม่เกิน|สัก|ประมาณ)?\s*พัน(?:นึง|หนึ่ง)?/u.test(text)) return 1000;
  return null;
}

function hasNegative(text: string, word: string): boolean {
  // "ไม่มี..." ("without/no...") is a real production phrasing for an
  // explicit-menu-request qualifier ("ขอเมนูทั้งหมดที่ไม่มีกุ้ง") -- was
  // missing here even though it means the same avoidance as "ไม่กิน"/
  // "เลี่ยง" for the same word.
  return new RegExp(`(?:ไม่กิน|ไม่เอา|งด|เลี่ยง|ไม่ชอบ|แพ้|ไม่มี)\\s*${word}`, 'u').test(text);
}

function hasAllergy(text: string, word: string): boolean {
  return new RegExp(`(?:แพ้\\s*${word}|allerg(?:y|ic).*?${word})`, 'iu').test(text);
}

function hasAffirmative(current: string, word: string): boolean {
  return new RegExp(`(?:อยากกิน|ชอบ|เอา|ขอ)\\s*${word}`, 'u').test(current);
}

function parsePreferences(input: RestaurantAdvisorInput, items: RestaurantAdvisorItem[]): ParsedPreferences {
  const history = [...(input.recentMessages ?? []).slice(-6), input.query].join(' ');
  const text = norm(history);
  const current = norm(input.query);
  const partyFromText = readNumber(current, /(\d{1,2})\s*(?:คน|ท่าน|persons?|people)/i);
  const partyFromHistory = readNumber(text, /(\d{1,2})\s*(?:คน|ท่าน|persons?|people)/i);
  const budgetFromText = thaiAmount(current);
  const budgetFromHistory = thaiAmount(text);

  let spice: ParsedPreferences['spice'] = null;
  if (includesAny(text, [/ไม่เผ็ด/u,/เผ็ดไม่ได้/u,/ไม่กินเผ็ด/u,/no spicy/i])) spice = 'none';
// RESTAURANT_CONSTRAINT_COPY_FIX_V1
  else if (includesAny(text, [/เผ็ดน้อย/u,/เผ็ดนิด/u,/ไม่ค่อยเผ็ด/u,/ไม่อยากเผ็ดมาก/u,/ไม่เอาเผ็ดมาก/u,/ขอไม่เผ็ดมาก/u,/เผ็ดไม่มาก/u,/mild/i])) spice = 'mild';
  else if (includesAny(text, [/เผ็ดกลาง/u,/medium spicy/i])) spice = 'medium';
  else if (includesAny(text, [/เผ็ดมาก/u,/เอาแซ่บ/u,/แซ่บๆ/u,/spicy/i])) spice = 'hot';

  const avoidProteins: string[] = [];
  const preferProteins: string[] = [];
  const avoidIngredients: string[] = [];
  const allergenFlags: string[] = [];
  let vegetarian = /มังสวิรัติ|vegetarian/i.test(text);

  if (hasNegative(text,'หมู')) avoidProteins.push('pork'); else if (hasAffirmative(current,'หมู')) preferProteins.push('pork');
  if (hasNegative(text,'เนื้อ(?:วัว)?')) avoidProteins.push('beef'); else if (hasAffirmative(current,'เนื้อ(?:วัว)?')) preferProteins.push('beef');
  if (hasNegative(text,'ไก่')) avoidProteins.push('chicken'); else if (hasAffirmative(current,'ไก่')) preferProteins.push('chicken');
  if (hasNegative(text,'ปลา')) avoidProteins.push('fish'); else if (hasAffirmative(current,'ปลา')) preferProteins.push('fish');
  if (hasNegative(text,'ไข่')) avoidProteins.push('egg');
  if (hasNegative(text,'ปลาร้า')) avoidIngredients.push('น้ำปลาร้า');
  // Also excludes bare "กุ้ง" (fresh shrimp), not just "กุ้งแห้ง" (dried) --
  // same conservative reasoning as the allergy safety net just below: a
  // real production phrase ("ขอเมนูทั้งหมดที่ไม่มีกุ้ง") that says only
  // "กุ้ง" must still exclude a fresh-shrimp dish like "ต้มยำกุ้ง", not
  // just the dried-shrimp ingredient specifically.
  if (hasNegative(text,'กุ้ง(?:แห้ง)?')) avoidIngredients.push('กุ้งแห้ง', 'กุ้ง');
  if (hasNegative(text,'ถั่ว(?:ลิสง)?')) avoidIngredients.push('ถั่วลิสงคั่ว');
  // Allergy safety net: a curated menu item's profile.allergenFlags tag
  // (checked in isHardExcluded) requires someone to have manually tagged
  // that item -- real production data (and this repo's own test seed
  // data) routinely has NO curated profile at all, which left an allergy
  // statement relying SOLELY on a tag that's usually never set. A real
  // incident this closes: "แพ้กุ้ง" (shrimp allergy) still recommended
  // "ต้มยำกุ้ง" (shrimp tom yum) because its curated allergenFlags was
  // empty, even though its raw ingredient_names literally lists "กุ้ง".
  // Also pushing the bare ingredient word into avoidIngredients makes the
  // existing raw-ingredient-name cross-check (see isHardExcluded below)
  // catch this independent of curated-profile completeness -- the
  // conservative choice for a food-safety check: an occasional over-broad
  // exclusion (e.g. "ถั่วงอก" bean sprouts sharing the "ถั่ว" root with
  // peanut) is far safer than serving an allergen.
  if (hasAllergy(text,'ถั่ว(?:ลิสง)?')) { allergenFlags.push('peanut'); avoidIngredients.push('ถั่ว'); }
  if (hasAllergy(text,'กุ้ง')) { allergenFlags.push('shrimp'); avoidIngredients.push('กุ้ง'); }
  if (hasAllergy(text,'ไข่')) { allergenFlags.push('egg'); avoidIngredients.push('ไข่'); }
  if (hasAllergy(text,'ปลา')) { allergenFlags.push('fish'); avoidIngredients.push('ปลา'); }

  const constraintsText = norm((input.constraints ?? []).join(' '));

  const goals: string[] = [];
  for (const raw of input.constraints ?? []) {
    const key = norm(raw).replace(/\s+/g,'_');
    const aliased = FOOD_CONSTRAINT_ALIASES[key];
    if (!aliased) continue;
    if (aliased.avoidProteins) avoidProteins.push(...aliased.avoidProteins);
    if (aliased.avoidIngredients) avoidIngredients.push(...aliased.avoidIngredients);
    if (aliased.allergenFlags) allergenFlags.push(...aliased.allergenFlags);
    if (aliased.goals) goals.push(...aliased.goals);
    if (aliased.spice && spice == null) spice = aliased.spice;
    if (aliased.vegetarian) vegetarian = true;
  }
  if (/ไม่กินหมู|งดหมู/u.test(constraintsText)) avoidProteins.push('pork');
  if (/ไม่กินเนื้อ|งดเนื้อ/u.test(constraintsText)) avoidProteins.push('beef');
  if (/ไม่กินไก่|งดไก่/u.test(constraintsText)) avoidProteins.push('chicken');
  if (/ไม่กินปลา|งดปลา/u.test(constraintsText)) avoidProteins.push('fish');
  if (/ไม่กินไข่|งดไข่/u.test(constraintsText)) avoidProteins.push('egg');
  if (/ไม่เอาปลาร้า|ไม่กินปลาร้า/u.test(constraintsText)) avoidIngredients.push('น้ำปลาร้า');
  if (/แพ้ถั่ว/u.test(constraintsText)) { allergenFlags.push('peanut'); avoidIngredients.push('ถั่ว'); }
  if (/แพ้กุ้ง/u.test(constraintsText)) { allergenFlags.push('shrimp'); avoidIngredients.push('กุ้ง'); }
  if (/แพ้ไข่/u.test(constraintsText)) { allergenFlags.push('egg'); avoidIngredients.push('ไข่'); }

  if (includesAny(text, [/มาครั้งแรก/u,/ครั้งแรก/u,/signature/i,/ซิกเนเจอร์/u,/ขึ้นชื่อ/u,/แนะนำ.*ร้าน/u])) goals.push('signature');
  if (includesAny(text, [/อีสานแท้/u,/พื้นบ้าน/u,/local/u,/authentic/i])) goals.push('authentic');
  if (includesAny(text, [/กินง่าย/u,/ฝรั่ง/u,/มือใหม่/u,/beginner/i])) goals.push('beginner');
  if (includesAny(text, [/เด็ก/u,/kid/i,/family/i])) goals.push('kid');
  if (includesAny(text, [/เบาๆ/u,/ไม่หนัก/u,/light/i])) goals.push('light');
  if (includesAny(text, [/กับแกล้ม/u,/กินกับเบียร์/u,/กินกับเหล้า/u,/with beer/i,/drinks/i])) goals.push('with_drinks');
  if (includesAny(text, [/ของร้อน/u,/น้ำซุป/u,/ต้ม/u,/soup/i])) goals.push('soup');
  if (includesAny(text, [/ของหวาน/u,/ปิดท้าย/u,/dessert/i])) goals.push('dessert');
  if (includesAny(text, [/ไม่หวาน/u,/หวานน้อย/u,/less sweet/i])) goals.push('low_sweet');

  const selectedNames = items.filter(item => {
    const name = norm(item.name);
    return name.length > 2 && text.includes(name);
  }).map(item => item.name);

  return {
    partySize: input.partySize ?? partyFromText ?? partyFromHistory ?? null,
    budget: input.budget ?? budgetFromText ?? budgetFromHistory ?? null,
    spice, vegetarian, avoidProteins: uniq(avoidProteins), preferProteins: uniq(preferProteins),
    avoidIngredients: uniq(avoidIngredients), allergenFlags: uniq(allergenFlags), goals: uniq(goals), selectedNames: uniq(selectedNames),
  };
}

// A ส้มตำ/ยำ/ลาบ dish is inherently spice-risk BY NAME/CATEGORY,
// regardless of whether anyone has ever tagged its curated spiceLevel --
// which routinely never happens (same gap the allergy safety net below
// already closes for ingredients: normalizeRestaurantProfile's own
// bounded() defaults an untagged spiceLevel to 0, indistinguishable from
// "verified mild"). Real production incident this closes: a no_spicy
// guest was still recommended a somtam/yam/laab item because its
// curated spiceLevel was simply never set. The conservative choice here
// mirrors the allergy safety net's own reasoning: an occasional over-
// broad exclusion is far safer than recommending a spicy dish to someone
// who explicitly said "ไม่เผ็ด."
const SPICY_RISK_CATEGORY_RE = /ตำ|ส้มตำ|ยำ|ลาบ|น้ำตก|ต้มแซ่บ|พล่า|แจ่ว|เสือร้องไห้/u;
const SPICY_RISK_INGREDIENT_RE = /(?:พริกสด|พริกแห้ง|พริกป่น|พริกขี้หนู|พริกจินดา|พริกชี้ฟ้า|chili|chilli)/iu;

function isUnverifiedSpicyRiskItem(item: RestaurantAdvisorItem): boolean {
  return SPICY_RISK_CATEGORY_RE.test(item.name) || SPICY_RISK_CATEGORY_RE.test(item.category);
}

// Dietary protein exclusions must not depend on manually curated
// profile.proteinTags. The authoritative menu SOT already carries raw
// ingredient_names, and production can temporarily have a missing/stale
// intelligence profile. A real owner smoke exposed exactly this: durable
// no_chicken memory was active, but a chicken dish slipped through when the
// advisor saw no usable protein tag.
//
// Keep chicken matching deliberately away from "ไข่ไก่": avoiding chicken meat
// does not automatically mean avoiding eggs.
function rawIngredientHasAvoidedProtein(ingredient: string, avoidProteins: string[]): boolean {
  const value = norm(ingredient);
  for (const protein of avoidProteins) {
    if (protein === 'chicken' && (
      value === 'ไก่'
      || /(?:ไก่บ้าน|เนื้อไก่|อกไก่|สะโพกไก่|น่องไก่|ปีกไก่|ไก่ย่าง|ไก่ทอด|ไก่สับ|chicken)/iu.test(value)
    )) return true;
    if (protein === 'pork' && /(?:หมู|pork)/iu.test(value)) return true;
    if (protein === 'beef' && (value === 'เนื้อ' || /(?:เนื้อวัว|เนื้อโค|beef)/iu.test(value))) return true;
    if (protein === 'fish' && (/^ปลา/u.test(value) || /(?:เนื้อปลา|fish)/iu.test(value))) return true;
    if (protein === 'egg' && (/^ไข่/u.test(value) || /egg/iu.test(value))) return true;
  }
  return false;
}

// Restaurant recommendation scope.
//
// A real production smoke after PR #80 exposed a semantic drift: the guest
// had asked for FOOD recommendations under dietary constraints, then asked
// "มีอะไรแนะนำอีก". After the first safe food shortlist was exhausted the
// ranker surfaced "Singha Draft" and "น้ำกระเจี๊ยบ" simply because beverages
// were still valid/orderable rows. That technically respected the allergen
// filter but violated the conversational topic.
//
// Default restaurant recommendation intent therefore means FOOD. Beverage and
// dessert categories are only eligible when the customer explicitly asks for
// them, or when a vague follow-up inherits that category from recent restaurant
// context. This is semantic category continuity, not a product-name patch.
type RecommendationScope = 'food' | 'drink' | 'dessert' | 'all';

const DRINK_CATEGORY_RE = /(?:เครื่องดื่ม|น้ำสมุนไพร|เบียร์|สุรา|spirit|drink|beverage)/iu;
const DESSERT_CATEGORY_RE = /(?:ของหวาน|ขนม|dessert)/iu;
const DRINK_REQUEST_RE = /(?:เครื่องดื่ม|ดื่มอะไร|น้ำอะไร|เบียร์|เหล้า|สุรา|วิสกี้|ไวน์|ค็อกเทล|น้ำสมุนไพร|drink|beverage|beer|spirit)/iu;
const DESSERT_REQUEST_RE = /(?:ของหวาน|ขนม|dessert|ปิดท้าย)/iu;
const ALL_MENU_REQUEST_RE = /(?:เมนูทั้งหมด|ทั้งหมดทุกหมวด|ทั้งอาหารและเครื่องดื่ม|all menu|full menu)/iu;
const FOOD_CONTEXT_RE = /(?:ร้านอาหาร|อาหาร|กินอะไร|เมนูอาหาร|กับข้าว|ของกิน|มื้อ|ข้าว)/iu;

function recommendationScope(input: RestaurantAdvisorInput): RecommendationScope {
  const current = norm(input.query);
  if (ALL_MENU_REQUEST_RE.test(current)) return 'all';
  if (DRINK_REQUEST_RE.test(current)) return 'drink';
  if (DESSERT_REQUEST_RE.test(current)) return 'dessert';

  // A vague "อีก/มีอะไรแนะนำอีก" should continue the most recent explicit
  // category instead of resetting. Walk newest-to-oldest and stop at the first
  // useful category signal.
  const recent = [...(input.recentMessages ?? [])].reverse();
  for (const raw of recent) {
    const text = norm(raw);
    if (DRINK_REQUEST_RE.test(text)) return 'drink';
    if (DESSERT_REQUEST_RE.test(text)) return 'dessert';
    if (FOOD_CONTEXT_RE.test(text)) return 'food';
  }

  // "ร้านอาหารมีอะไรแนะนำ", "กินอะไรดี", and constraint-led recommendations
  // all default to food. Drinks/desserts require explicit intent.
  return 'food';
}

function itemMatchesRecommendationScope(item: RestaurantAdvisorItem, scope: RecommendationScope): boolean {
  if (scope === 'all') return true;
  const isDrink = DRINK_CATEGORY_RE.test(item.category);
  const isDessert = DESSERT_CATEGORY_RE.test(item.category);
  if (scope === 'drink') return isDrink;
  if (scope === 'dessert') return isDessert;
  return !isDrink && !isDessert;
}

function isHardExcluded(item: RestaurantAdvisorItem, pref: ParsedPreferences): boolean {
  if (!item.orderable || item.availableServings <= 0 || item.unavailableIngredients.length) return true;
  if (pref.vegetarian && item.profile.proteinTags.some(tag => ['pork','beef','chicken','fish','shrimp'].includes(tag))) return true;
  if (item.profile.proteinTags.some(tag => pref.avoidProteins.includes(tag))) return true;
  if (item.profile.allergenFlags.some(tag => pref.allergenFlags.includes(tag))) return true;
  const ingredients = item.ingredients.map(norm);
  if (pref.avoidIngredients.some(avoid => ingredients.some(ingredient => ingredient.includes(norm(avoid))))) return true;
  if (ingredients.some(ingredient => rawIngredientHasAvoidedProtein(ingredient, pref.avoidProteins))) return true;
  if (pref.spice === 'none' && item.profile.spiceLevel >= 3) return true;
  if (pref.spice === 'none' && isUnverifiedSpicyRiskItem(item)) return true;
  // Strict "ไม่เผ็ด" must also respect the authoritative ingredient list.
  // Real production data has several dishes whose curated spiceLevel is 0–1
  // even though ingredient_names contains fresh/dried chilli. Name/category
  // heuristics alone cannot catch those.
  if (pref.spice === 'none' && ingredients.some(ingredient => SPICY_RISK_INGREDIENT_RE.test(ingredient))) return true;
  return false;
}

function scoreItem(item: RestaurantAdvisorItem, pref: ParsedPreferences, selectedRoles: string[]): Scored {
  let score = item.signature ? 1 : 0;
  const reasons: string[] = [];
  const p = item.profile;
  if (pref.goals.includes('signature') && item.signature) { score += 4; reasons.push('เมนูเด่นของร้าน'); }
  if (pref.goals.includes('authentic')) { score += p.isanIntensity * .65; if (p.isanIntensity >= 4) reasons.push('รสอีสานชัด'); }
  if (pref.goals.includes('beginner') && p.beginnerFriendly) { score += 3; reasons.push('กินง่าย'); }
  if (pref.goals.includes('kid') && p.kidFriendly) { score += 4; reasons.push('เหมาะกับเด็กกว่าเมนูรสจัด'); }
  if (pref.goals.includes('light')) { score += Math.max(0, 5 - p.heaviness) * .7; if (p.heaviness <= 2) reasons.push('ไม่หนักเกินไป'); }
  if (pref.goals.includes('with_drinks') && p.occasionTags.includes('with_drinks')) { score += 3; reasons.push('เข้ากับเครื่องดื่ม'); }
  if (pref.goals.includes('soup') && p.mealRoles.includes('soup_or_steam')) { score += 4; reasons.push('มีน้ำร้อนช่วยบาลานซ์โต๊ะ'); }
  if (pref.goals.includes('dessert') && p.mealRoles.includes('dessert')) { score += 5; reasons.push('เหมาะปิดมื้อ'); }
  if (pref.goals.includes('low_sweet')) score += Math.max(0, 3 - p.sweetLevel) * .4;
  if (pref.preferProteins.length && p.proteinTags.some(tag => pref.preferProteins.includes(tag))) { score += 2.5; reasons.push('ตรงโปรตีนที่อยากกิน'); }
  if (pref.spice === 'none') score += Math.max(0, 3 - p.spiceLevel) * 1.1;
  if (pref.spice === 'mild') score += Math.max(0, 3 - Math.abs(p.spiceLevel - 1)) * .8;
  if (pref.spice === 'medium') score += Math.max(0, 3 - Math.abs(p.spiceLevel - 2)) * .7;
  if (pref.spice === 'hot') score += p.spiceLevel * .8;

  // For ordinary FOOD recommendations, useful dishes should rank ahead of
  // bare staples/side-only rows. This still leaves side dishes available for
  // compose/pairing flows, but prevents answers like "ขนมจีน" being treated as
  // a stronger standalone recommendation than a real main/protein dish.
  const hasSubstantiveRole = p.mealRoles.some(role => ['main','protein','grill_or_fry','soup_or_steam','single_plate'].includes(role));
  const isBareSide = p.mealRoles.length > 0 && p.mealRoles.every(role => role === 'side') && p.proteinTags.length === 0;
  if (hasSubstantiveRole) score += 1.8;
  if (isBareSide) score -= 1.1;

  if (!pref.goals.length && !pref.preferProteins.length && !pref.spice) {
    score += (item.signature ? 2 : 0) + p.shareability * .25 + (p.beginnerFriendly ? .4 : 0);
  }
  if (selectedRoles.length && p.pairingTags.some(role => selectedRoles.includes(role))) { score += 3; reasons.push('ช่วยเติมบทบาทที่เข้าคู่กับของที่เลือกแล้ว'); }
  if (pref.selectedNames.includes(item.name)) score -= 8;
  score += Math.min(1.2, item.availableServings / 100);
  if (!reasons.length && p.summary) reasons.push(p.summary);
  return { item, score, reasons: uniq(reasons).slice(0, 3) };
}

function selectedRoleHints(items: RestaurantAdvisorItem[], selectedNames: string[]): string[] {
  const selected = items.filter(item => selectedNames.includes(item.name));
  return uniq(selected.flatMap(item => item.profile.pairingTags));
}

function compactItem(item: RestaurantAdvisorItem) {
  return {
    name:item.name, category:item.category, price:item.price, signature:item.signature,
    availableServings:item.availableServings, ingredients:item.ingredients,
    summary:item.profile.summary ?? null, mealRoles:item.profile.mealRoles, tasteTags:item.profile.tasteTags,
    textureTags:item.profile.textureTags, proteinTags:item.profile.proteinTags, allergenFlags:item.profile.allergenFlags,
    spiceLevel:item.profile.spiceLevel, sweetLevel:item.profile.sweetLevel, sourLevel:item.profile.sourLevel,
    heaviness:item.profile.heaviness, isanIntensity:item.profile.isanIntensity,
    beginnerFriendly:item.profile.beginnerFriendly, kidFriendly:item.profile.kidFriendly,
  };
}

function bestForRole(candidates: Scored[], role: string, used: Set<string>, budgetLeft: number | null): Scored | null {
  const rows = candidates.filter(row => !used.has(row.item.name) && row.item.profile.mealRoles.includes(role)
    && (budgetLeft == null || row.item.price <= budgetLeft));
  if (!rows.length) return null;
  return rows.sort((a,b) => b.score - a.score || a.item.price - b.item.price)[0];
}

function composeSet(candidates: Scored[], pref: ParsedPreferences) {
  const party = pref.partySize ?? 3;
  const budget = pref.budget;
  const used = new Set<string>();
  const lines: Array<{name:string;quantity:number;unitPrice:number;lineTotal:number;role:string;reason:string|null}> = [];
  let total = 0;
  const add = (row: Scored | null, role: string, quantity = 1) => {
    if (!row || used.has(row.item.name)) return false;
    quantity = Math.max(1, Math.min(quantity, row.item.availableServings));
    const cost = row.item.price * quantity;
    if (budget != null && total + cost > budget) return false;
    used.add(row.item.name); total += cost;
    lines.push({name:row.item.name,quantity,unitPrice:row.item.price,lineTotal:cost,role,reason:row.reasons[0] ?? row.item.profile.summary ?? null});
    return true;
  };
  const left = () => budget == null ? null : Math.max(0, budget - total);

  if (party <= 1) {
    const single = bestForRole(candidates,'single_plate',used,left()) ?? bestForRole(candidates,'main',used,left());
    add(single,'main');
    if (!single || !single.item.profile.mealRoles.includes('single_plate')) add(bestForRole(candidates,'side',used,left()),'side');
  } else {
    add(bestForRole(candidates,'salad',used,left()),'salad');
    add(bestForRole(candidates,'grill_or_fry',used,left()) ?? bestForRole(candidates,'protein',used,left()),'protein');
    if (party >= 3) add(bestForRole(candidates,'soup_or_steam',used,left()),'soup_or_steam');
    if (party >= 5) add(bestForRole(candidates,'protein',used,left()),'second_main');
    const riceQty = Math.max(1, Math.ceil(party / 2));
    const sideRows = candidates.filter(row => row.item.profile.mealRoles.includes('side') && !used.has(row.item.name))
      .sort((a,b) => a.item.price - b.item.price || b.score - a.score);
    const affordableSide = sideRows.find(row => budget == null || total + row.item.price * riceQty <= budget);
    if (affordableSide) add(affordableSide,'side',riceQty);
  }

  if (!lines.length) {
    const cheapest = [...candidates].sort((a,b)=>a.item.price-b.item.price || b.score-a.score)[0];
    add(cheapest ?? null,'main');
  }
  const optionalDessert = candidates.filter(row => !used.has(row.item.name) && row.item.profile.mealRoles.includes('dessert'))
    .sort((a,b)=>b.score-a.score || a.item.price-b.item.price)[0];
  const remainingBudget = budget == null ? null : budget-total;
  return {
    partySize: party, budget, total, remainingBudget,
    items: lines,
    optionalDessert: optionalDessert && (remainingBudget == null || optionalDessert.item.price <= remainingBudget)
      ? {name:optionalDessert.item.name,price:optionalDessert.item.price} : null,
    balancedRoles: uniq(lines.map(line=>line.role)),
    limitedByBudget: budget != null && lines.length < (party >= 3 ? 4 : 2),
  };
}

export function adviseRestaurantMenu(items: RestaurantAdvisorItem[], input: RestaurantAdvisorInput) {
  const pref = parsePreferences(input, items);
  const scope = recommendationScope(input);
  const available = items.filter(item => !isHardExcluded(item,pref) && itemMatchesRecommendationScope(item, scope));
  const selectedRoles = selectedRoleHints(items,pref.selectedNames);
  const scored = available.map(item => scoreItem(item,pref,selectedRoles)).sort((a,b)=>b.score-a.score || a.item.price-b.item.price);
  const query = norm(input.query);
  const named = items.filter(item => query.includes(norm(item.name)));
  const compareMode = named.length >= 2 && /ต่าง|เทียบ|compare|อันไหน|ไหนดีกว่า|เลือกอะไร/u.test(query);
  const pairingRequested = pref.selectedNames.length > 0 && /เพิ่มอะไร|กินคู่|เข้ากับ|คู่กับ|ต่ออะไร/u.test(query);
  const composeMode = !compareMode && !pairingRequested && (pref.partySize != null || pref.budget != null || /จัด.*(?:ชุด|โต๊ะ)|เซ็ต|set|ครบโต๊ะ|กินกัน/u.test(query));
  const pairingMode = !compareMode && pairingRequested;

  // Production incident this closes: an allergy notice that only described
  // what the SYSTEM already did (filtered by recorded ingredients) never
  // told the customer to also tell kitchen staff in person -- the one step
  // that actually protects against cross-contact, which no ingredient list
  // can rule out. Every allergy notice now explicitly asks the customer to
  // notify staff, matching Customer Service Doctrine's food-safety wording.
  const notices: string[] = [];
  if (pref.allergenFlags.length) notices.push('ตรวจจากวัตถุดิบที่บันทึกไว้และตัดเมนูที่มีสารก่อภูมิแพ้ตรงตัวออกแล้ว แต่ร้านยังไม่มีข้อมูลยืนยันเรื่องการปนเปื้อนข้ามอุปกรณ์/ครัว ขอให้แจ้งพนักงานอีกครั้งหน้างานเพื่อความปลอดภัยครับ');
  if (!available.length) notices.push('ไม่มีเมนูที่ผ่านข้อจำกัดและขายได้ในสต๊อกปัจจุบัน');

  if (compareMode) {
    return {
      mode:'compare', parsed:pref, notices,
      comparison:named.slice(0,4).map(compactItem),
      recommendations:[], set:null,
    };
  }
  if (composeMode) {
    const set = composeSet(scored,pref);
    return {
      mode:'compose_set', parsed:pref, notices, set,
      recommendations:scored.slice(0,5).map(row=>({ ...compactItem(row.item), score:Number(row.score.toFixed(2)), reasons:row.reasons })),
      comparison:null,
    };
  }
  return {
    mode:pairingMode?'pairing':'recommend', parsed:pref, notices, set:null, comparison:null,
    recommendations:scored.slice(0,5).map(row=>({ ...compactItem(row.item), score:Number(row.score.toFixed(2)), reasons:row.reasons })),
  };
}
