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

function parsePreferences(input: RestaurantAdvisorInput, items: RestaurantAdvisorItem[]): ParsedPreferences {
  const history = [...(input.recentMessages ?? []).slice(-6), input.query].join(' ');
  const text = norm(history);
  const current = norm(input.query);
  const partyFromText = readNumber(current, /(\d{1,2})\s*(?:คน|ท่าน|persons?|people)/i);
  const budgetFromText = readNumber(current, /(?:งบ(?:ประมาณ)?|ไม่เกิน|budget)\s*(?:ประมาณ|ราวๆ|ราว|ไม่เกิน)?\s*([0-9,]{2,7})/i)
    ?? readNumber(current, /([0-9,]{2,7})\s*บาท\s*(?:พอ|ทั้งหมด|รวม|ไม่เกิน)/i);

  let spice: ParsedPreferences['spice'] = null;
  if (includesAny(text, [/ไม่เผ็ด/u,/เผ็ดไม่ได้/u,/ไม่กินเผ็ด/u,/no spicy/i])) spice = 'none';
  else if (includesAny(text, [/เผ็ดน้อย/u,/เผ็ดนิด/u,/ไม่ค่อยเผ็ด/u,/mild/i])) spice = 'mild';
  else if (includesAny(text, [/เผ็ดกลาง/u,/medium spicy/i])) spice = 'medium';
  else if (includesAny(text, [/เผ็ดมาก/u,/เอาแซ่บ/u,/แซ่บๆ/u,/spicy/i])) spice = 'hot';

  const avoidProteins: string[] = [];
  const preferProteins: string[] = [];
  const avoidIngredients: string[] = [];
  const allergenFlags: string[] = [];
  const negative = (word: string) => new RegExp(`(?:ไม่กิน|ไม่เอา|งด|เลี่ยง|ไม่ชอบ)\\s*${word}`, 'u').test(text);
  const allergic = (word: string) => new RegExp(`(?:แพ้|allerg(?:y|ic).*?)\\s*${word}`, 'iu').test(text);

  if (negative('หมู')) avoidProteins.push('pork'); else if (/หมู/u.test(current)) preferProteins.push('pork');
  if (negative('เนื้อ(?:วัว)?')) avoidProteins.push('beef'); else if (/เนื้อ(?:วัว)?/u.test(current)) preferProteins.push('beef');
  if (negative('ไก่')) avoidProteins.push('chicken'); else if (/ไก่/u.test(current)) preferProteins.push('chicken');
  if (negative('ปลา')) avoidProteins.push('fish'); else if (/ปลา/u.test(current)) preferProteins.push('fish');
  if (negative('ไข่')) avoidProteins.push('egg');
  if (negative('ปลาร้า')) avoidIngredients.push('น้ำปลาร้า');
  if (negative('กุ้งแห้ง')) avoidIngredients.push('กุ้งแห้ง');
  if (negative('ถั่ว(?:ลิสง)?')) avoidIngredients.push('ถั่วลิสงคั่ว');
  if (allergic('ถั่ว(?:ลิสง)?')) allergenFlags.push('peanut');
  if (allergic('กุ้ง')) allergenFlags.push('shrimp');
  if (allergic('ไข่')) allergenFlags.push('egg');
  if (allergic('ปลา')) allergenFlags.push('fish');

  const constraintsText = norm((input.constraints ?? []).join(' '));
  if (/ไม่กินหมู|งดหมู/u.test(constraintsText)) avoidProteins.push('pork');
  if (/ไม่กินเนื้อ|งดเนื้อ/u.test(constraintsText)) avoidProteins.push('beef');
  if (/ไม่กินปลา|งดปลา/u.test(constraintsText)) avoidProteins.push('fish');
  if (/ไม่เอาปลาร้า|ไม่กินปลาร้า/u.test(constraintsText)) avoidIngredients.push('น้ำปลาร้า');
  if (/แพ้ถั่ว/u.test(constraintsText)) allergenFlags.push('peanut');
  if (/แพ้กุ้ง/u.test(constraintsText)) allergenFlags.push('shrimp');
  if (/แพ้ไข่/u.test(constraintsText)) allergenFlags.push('egg');

  const goals: string[] = [];
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
    partySize: input.partySize ?? partyFromText ?? null,
    budget: input.budget ?? budgetFromText ?? null,
    spice, avoidProteins: uniq(avoidProteins), preferProteins: uniq(preferProteins),
    avoidIngredients: uniq(avoidIngredients), allergenFlags: uniq(allergenFlags), goals: uniq(goals), selectedNames: uniq(selectedNames),
  };
}

function isHardExcluded(item: RestaurantAdvisorItem, pref: ParsedPreferences): boolean {
  if (!item.orderable || item.availableServings <= 0 || item.unavailableIngredients.length) return true;
  if (item.profile.proteinTags.some(tag => pref.avoidProteins.includes(tag))) return true;
  if (item.profile.allergenFlags.some(tag => pref.allergenFlags.includes(tag))) return true;
  const ingredients = item.ingredients.map(norm);
  if (pref.avoidIngredients.some(avoid => ingredients.some(ingredient => ingredient.includes(norm(avoid))))) return true;
  if (pref.spice === 'none' && item.profile.spiceLevel >= 4) return true;
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
  if (!pref.goals.length && !pref.preferProteins.length && !pref.spice) {
    score += (item.signature ? 2 : 0) + p.shareability * .25 + p.beginnerFriendly * .4;
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
  };
}

export function adviseRestaurantMenu(items: RestaurantAdvisorItem[], input: RestaurantAdvisorInput) {
  const pref = parsePreferences(input, items);
  const available = items.filter(item => !isHardExcluded(item,pref));
  const selectedRoles = selectedRoleHints(items,pref.selectedNames);
  const scored = available.map(item => scoreItem(item,pref,selectedRoles)).sort((a,b)=>b.score-a.score || a.item.price-b.item.price);
  const query = norm(input.query);
  const named = items.filter(item => query.includes(norm(item.name)));
  const compareMode = named.length >= 2 && /ต่าง|เทียบ|compare|อันไหน|ไหนดีกว่า|เลือกอะไร/u.test(query);
  const composeMode = !compareMode && (pref.partySize != null || pref.budget != null || /จัด.*(?:ชุด|โต๊ะ)|เซ็ต|set|ครบโต๊ะ|กินกัน/u.test(query));
  const pairingMode = !compareMode && !composeMode && pref.selectedNames.length > 0 && /เพิ่มอะไร|กินคู่|เข้ากับ|คู่กับ|ต่ออะไร/u.test(query);

  const notices: string[] = [];
  if (pref.allergenFlags.length) notices.push('ตรวจจากวัตถุดิบที่บันทึกไว้และตัดเมนูที่มีสารก่อภูมิแพ้ตรงตัวออกแล้ว แต่ร้านยังไม่มีข้อมูลยืนยันเรื่องการปนเปื้อนข้ามอุปกรณ์/ครัว');
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
