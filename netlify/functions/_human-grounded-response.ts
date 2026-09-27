// Deterministic human-style renderers for already-decided One-Mind semantics.
//
// This layer NEVER interprets raw customer language, calls a model/tool, or
// mutates state. It consumes only structured SemanticTurn + grounded facts and
// turns them into concise customer-facing material for the central Response
// Composer. This keeps OpenAI as semantic supervisor only while avoiding the
// old "catalog dump" / generic-fallback behavior.
import type { SemanticTurn } from './_semantic-interpreter';
import type { DialogDecision } from './_dialog-manager';
import type { GroundedFact, KnowledgeBundle } from './_knowledge-resolver';

export type HumanGroundedRenderInput = {
  language: string;
  semanticTurn?: SemanticTurn;
  dialogDecision: DialogDecision;
  knowledgeBundles: KnowledgeBundle[];
};

export type HumanGroundedRenderResult = {
  message: string;
  usedFactKeys: string[];
};

function facts(input: HumanGroundedRenderInput): GroundedFact[] {
  const seen = new Set<string>();
  const out: GroundedFact[] = [];
  for (const bundle of input.knowledgeBundles) {
    for (const fact of bundle.facts) {
      const signature = fact.key + '\u0000' + JSON.stringify(fact.value);
      if (seen.has(signature)) continue;
      seen.add(signature);
      out.push(fact);
    }
  }
  return out;
}

function factMap(input: HumanGroundedRenderInput): Map<string, unknown> {
  return new Map(facts(input).map(fact => [fact.key, fact.value] as const));
}

function semanticEntities(input: HumanGroundedRenderInput): Record<string, unknown> {
  return input.semanticTurn?.entities ?? input.dialogDecision.knowledgeRequests[0]?.entities ?? {};
}

function semanticText(input: HumanGroundedRenderInput): string {
  const constraints = input.semanticTurn?.constraints
    ?? input.dialogDecision.knowledgeRequests.flatMap(request => request.constraints);
  return (constraints.join(' ') + ' ' + (input.semanticTurn?.normalizedMeaning ?? '')).toLowerCase();
}

function wants(input: HumanGroundedRenderInput, fragments: readonly string[]): boolean {
  const text = semanticText(input);
  return fragments.some(fragment => text.includes(fragment.toLowerCase()));
}

function numericEntity(input: HumanGroundedRenderInput, keys: readonly string[]): number | null {
  const entities = semanticEntities(input);
  for (const key of keys) {
    const value = Number(entities[key]);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  return null;
}

function activityAssetRows(input: HumanGroundedRenderInput) {
  const map = factMap(input);
  const codes = [...map.keys()]
    .map(key => key.match(/^activity_asset:([^:]+):name$/)?.[1])
    .filter((value): value is string => Boolean(value));
  return codes.map(code => {
    const nameKey = 'activity_asset:' + code + ':name';
    const name = map.get(nameKey);
    if (typeof name !== 'string' || !name.trim()) return null;
    const temperamentKey = [
      'temperament:activity_asset:' + code,
      'activity_asset:' + code + ':temperament',
    ].find(key => map.has(key));
    const beginnerKey = [
      'beginnerSuitable:activity_asset:' + code,
      'activity_asset:' + code + ':beginnerSuitable',
    ].find(key => map.has(key));
    return {
      code,
      name: name.trim(),
      nameKey,
      temperamentKey,
      temperament: temperamentKey ? map.get(temperamentKey) : undefined,
      beginnerKey,
      beginnerSuitable: beginnerKey ? map.get(beginnerKey) : undefined,
    };
  }).filter((row): row is NonNullable<typeof row> => Boolean(row));
}

function explicitExcludedNames(input: HumanGroundedRenderInput, names: readonly string[]): Set<string> {
  const text = semanticText(input);
  const entities = semanticEntities(input);
  const entityText = JSON.stringify(entities).toLowerCase();
  const result = new Set<string>();
  for (const name of names) {
    const lower = name.toLowerCase();
    const canonicalName = lower === 'ทองไทย' ? 'thongthai' : lower;
    if (
      text.includes('exclude_' + canonicalName)
      || text.includes('avoid_' + canonicalName)
      || text.includes('not_' + canonicalName)
      || entityText.includes('"excluded') && entityText.includes(lower)
      || entityText.includes('"avoid') && entityText.includes(lower)
    ) {
      result.add(name);
    }
  }
  return result;
}

export function renderActivityRecommendation(input: HumanGroundedRenderInput): HumanGroundedRenderResult | null {
  const turn = input.semanticTurn;
  if (!turn || turn.domain !== 'activity' || turn.action !== 'recommend' || input.language !== 'th') return null;

  const map = factMap(input);
  const assets = activityAssetRows(input);
  const excluded = explicitExcludedNames(input, assets.map(asset => asset.name));
  const wantsCalm = wants(input, ['prefer_calm', 'calm_horse', 'calmer', 'นิ่ง', 'ใจเย็น']);
  const wantsBeginner = wants(input, ['beginner', 'มือใหม่', 'ไม่เคยขี่']);
  const wantsRain = wants(input, ['rain', 'ฝน', 'weather_fallback']);

  if (wantsCalm || wantsBeginner) {
    const matching = assets
      .filter(asset => !excluded.has(asset.name))
      .filter(asset => {
        const temperament = String(asset.temperament ?? '').toLowerCase();
        const calmOk = !wantsCalm || ['calm', 'gentle', 'นิ่ง', 'ใจเย็น'].some(word => temperament.includes(word));
        const beginnerOk = !wantsBeginner || asset.beginnerSuitable === true;
        return calmOk && beginnerOk;
      });
    if (matching.length === 1) {
      const pick = matching[0]!;
      const used = [pick.nameKey];
      if (pick.temperamentKey) used.push(pick.temperamentKey);
      if (pick.beginnerKey) used.push(pick.beginnerKey);
      const lines = ['ถ้าเอาตามเงื่อนไขที่บอก ตอนนี้ ' + pick.name + ' ตรงกว่าครับ'];
      if (wantsCalm && pick.temperament !== undefined) {
        lines.push('• ข้อมูลที่มีระบุลักษณะของ ' + pick.name + ' ว่า ' + String(pick.temperament));
      }
      if (wantsBeginner && pick.beginnerSuitable === true) {
        lines.push('• มีข้อมูลยืนยันว่าเหมาะกับผู้เริ่มต้น');
      }
      if (wantsRain) {
        const other = [...map.keys()]
          .map(key => ({ key, match: key.match(/^activity:([^:]+):name$/), value: map.get(key) }))
          .find(item => item.match && typeof item.value === 'string' && !/ขี่ม้า|horse/iu.test(item.value));
        if (other && typeof other.value === 'string') {
          lines.push('ถ้าฝนตก ยังมีกิจกรรมอื่นในรายการ เช่น ' + other.value + ' แต่ตอนนี้ยังไม่มีข้อมูลยืนยันว่าจัดได้ขณะฝนตกครับ');
          used.push(other.key);
        } else {
          lines.push('ส่วนกรณีฝนตก ตอนนี้ยังไม่มีข้อมูลยืนยันกิจกรรมทดแทนที่เปิดได้แน่นอนครับ');
        }
      }
      return { message: lines.join('\n'), usedFactKeys: [...new Set(used)] };
    }
  }

  if (assets.length) {
    const names = assets.filter(asset => !excluded.has(asset.name)).map(asset => asset.name);
    const reason = wantsCalm
      ? 'แต่ข้อมูลนิสัยยังไม่ครบพอให้ฟันธงว่าตัวไหนนิ่งกว่า'
      : wantsBeginner
        ? 'แต่ข้อมูลความเหมาะสมสำหรับมือใหม่ยังไม่ครบพอให้ฟันธง'
        : 'แต่ข้อมูลระดับความหนักหรือความเหมาะกับกลุ่มนี้ยังไม่ครบพอให้จัดอันดับ';
    if (names.length) {
      return {
        message: 'ตัวเลือกที่ยืนยันได้ตอนนี้มี ' + names.join(' / ') + ' ครับ ' + reason,
        usedFactKeys: assets.filter(asset => names.includes(asset.name)).map(asset => asset.nameKey),
      };
    }
  }
  return null;
}

export function renderRestaurantRecommendation(input: HumanGroundedRenderInput): HumanGroundedRenderResult | null {
  const turn = input.semanticTurn;
  if (!turn || turn.domain !== 'restaurant' || turn.action !== 'recommend' || input.language !== 'th') return null;

  const map = factMap(input);
  const ids = [...new Set([...map.keys()]
    .map(key => key.match(/^menu:([^:]+):name$/)?.[1])
    .filter((value): value is string => Boolean(value)))];
  if (!ids.length) return null;

  const noShrimp = wants(input, ['no_shrimp', 'avoid_shrimp', 'กุ้ง']);
  const noPork = wants(input, ['no_pork', 'avoid_pork', 'หมู']);
  const lowSpice = wants(input, ['no_spicy', 'low_spicy', 'mild', 'ไม่เผ็ด', 'เผ็ดน้อย']);
  const budget = numericEntity(input, ['budget', 'budgetMax', 'maxBudget', 'budgetThb']);

  const accepted: Array<{
    name: string;
    nameKey: string;
    price?: number;
    priceKey?: string;
    ingredientsKey?: string;
    spiceKey?: string;
  }> = [];
  let spiceUnknown = false;
  let ingredientUnknown = false;

  for (const id of ids) {
    const nameKey = 'menu:' + id + ':name';
    const name = map.get(nameKey);
    if (typeof name !== 'string' || !name.trim()) continue;

    const ingredientsKey = 'menu:' + id + ':ingredients';
    const ingredients = map.get(ingredientsKey);
    const ingredientWords = Array.isArray(ingredients)
      ? ingredients.map(value => String(value).toLowerCase())
      : null;
    if ((noShrimp || noPork) && !ingredientWords) {
      ingredientUnknown = true;
      continue;
    }
    if (noShrimp && ingredientWords!.some(value => value.includes('shrimp') || value.includes('prawn') || value.includes('กุ้ง'))) continue;
    if (noPork && ingredientWords!.some(value => value.includes('pork') || value.includes('หมู'))) continue;

    let spiceKey: string | undefined;
    if (lowSpice) {
      spiceKey = ['menu:' + id + ':spiceLevel', 'menu:' + id + ':spicyLevel', 'menu:' + id + ':spicy']
        .find(key => map.has(key));
      if (spiceKey) {
        const spice = String(map.get(spiceKey)).toLowerCase();
        if (['hot', 'spicy', 'high', 'เผ็ดมาก'].some(value => spice.includes(value))) continue;
      } else {
        spiceUnknown = true;
      }
    }

    const priceKey = 'menu:' + id + ':price';
    const priceRaw = map.get(priceKey);
    const price = typeof priceRaw === 'number' ? priceRaw : undefined;
    if (budget !== null && price !== undefined && price > budget) continue;

    accepted.push({
      name: name.trim(),
      nameKey,
      price,
      priceKey: price !== undefined ? priceKey : undefined,
      ingredientsKey: Array.isArray(ingredients) ? ingredientsKey : undefined,
      spiceKey,
    });
  }

  if (!accepted.length) {
    if (noShrimp || noPork) {
      return {
        message: 'ตอนนี้ข้อมูลส่วนผสมที่ยืนยันได้ยังไม่พอให้จัดชุดตามข้อจำกัดนี้แบบปลอดภัยครับ เลยไม่ขอเดา',
        usedFactKeys: [],
      };
    }
    return null;
  }

  const chosen = accepted.slice(0, 3);
  const used: string[] = [];
  const lines = chosen.map(item => {
    used.push(item.nameKey);
    if (item.priceKey) used.push(item.priceKey);
    if (item.ingredientsKey) used.push(item.ingredientsKey);
    if (item.spiceKey) used.push(item.spiceKey);
    return item.price !== undefined
      ? '• ' + item.name + ' — ' + Math.round(item.price) + ' บาท'
      : '• ' + item.name;
  });
  const total = chosen.every(item => item.price !== undefined)
    ? chosen.reduce((sum, item) => sum + (item.price ?? 0), 0)
    : null;
  const intro = noShrimp || noPork
    ? 'จากส่วนผสมที่มีข้อมูลยืนยัน เมนูที่ไม่ชนข้อจำกัดที่บอกมีครับ'
    : 'จากเมนูและราคาที่มีข้อมูลยืนยัน ลองชุดนี้ได้ครับ';
  const notes: string[] = [];
  if (total !== null) notes.push('ถ้าเอารายการละ 1 จาน รวม ' + Math.round(total) + ' บาท');
  if (budget !== null && total !== null) {
    notes.push(total <= budget
      ? 'ยังอยู่ในงบ ' + Math.round(budget) + ' บาท'
      : 'เกินงบ ' + Math.round(budget) + ' บาท');
  }
  if (lowSpice && spiceUnknown) notes.push('ระดับความเผ็ดยังมีบางรายการที่ไม่มีข้อมูลยืนยัน จึงควรย้ำกับร้านอีกครั้งครับ');
  if (ingredientUnknown) notes.push('รายการที่ไม่มีข้อมูลส่วนผสมครบถูกตัดออกจากคำแนะนำนี้');

  return { message: [intro, ...lines, ...notes].join('\n'), usedFactKeys: [...new Set(used)] };
}

export function renderPromotionRecommendation(input: HumanGroundedRenderInput): HumanGroundedRenderResult | null {
  const turn = input.semanticTurn;
  if (!turn || turn.domain !== 'promotion' || !['recommend', 'discover', 'ask'].includes(turn.action) || input.language !== 'th') return null;

  const promotionFacts = facts(input).filter(fact => fact.domain === 'promotion');
  if (!promotionFacts.length) return null;
  const noMembership = wants(input, ['no_new_membership', 'no_membership', 'ไม่สมัครสมาชิก', 'สมาชิกเพิ่ม']);
  const options: Array<{ name: string; key: string; requiresMembership?: boolean; detail?: string }> = [];

  for (const fact of promotionFacts) {
    if (fact.value && typeof fact.value === 'object' && !Array.isArray(fact.value)) {
      const value = fact.value as Record<string, unknown>;
      const name = typeof value.name === 'string' ? value.name : typeof value.title === 'string' ? value.title : null;
      if (!name) continue;
      const requiresMembership = typeof value.requiresMembership === 'boolean' ? value.requiresMembership : undefined;
      if (noMembership && requiresMembership !== false) continue;
      const detail = typeof value.detail === 'string'
        ? value.detail
        : typeof value.description === 'string' ? value.description : undefined;
      options.push({ name, key: fact.key, requiresMembership, detail });
    }
  }

  const map = factMap(input);
  const ids = [...new Set([...map.keys()]
    .map(key => key.match(/^(?:promo|promotion):([^:]+):(?:name|title)$/)?.[1])
    .filter((value): value is string => Boolean(value)))];
  for (const id of ids) {
    const nameKey = [
      'promo:' + id + ':name',
      'promotion:' + id + ':name',
      'promo:' + id + ':title',
      'promotion:' + id + ':title',
    ].find(key => typeof map.get(key) === 'string');
    if (!nameKey) continue;
    const reqKey = ['promo:' + id + ':requiresMembership', 'promotion:' + id + ':requiresMembership'].find(key => map.has(key));
    const req = reqKey ? map.get(reqKey) : undefined;
    if (noMembership && req !== false) continue;
    options.push({
      name: String(map.get(nameKey)),
      key: nameKey,
      requiresMembership: typeof req === 'boolean' ? req : undefined,
    });
  }

  const unique = [...new Map(options.map(option => [option.name, option] as const)).values()];
  if (!unique.length) return null;
  const shown = unique.slice(0, 3);
  const lines = shown.map(option => {
    const membership = option.requiresMembership === false ? ' — ไม่ต้องสมัครสมาชิกเพิ่ม' : '';
    const detail = option.detail ? ' — ' + option.detail : '';
    return '• ' + option.name + membership + detail;
  });
  return {
    message: ['โปรที่ตรงเงื่อนไขและมีข้อมูลยืนยันตอนนี้ครับ', ...lines].join('\n'),
    usedFactKeys: [...new Set(shown.map(option => option.key))],
  };
}

export function renderJourneyPlan(input: HumanGroundedRenderInput): HumanGroundedRenderResult | null {
  const turn = input.semanticTurn;
  if (!turn || turn.domain !== 'journey' || !['recommend', 'discover', 'ask', 'modify'].includes(turn.action) || input.language !== 'th') return null;

  const map = factMap(input);
  const used: string[] = [];
  const firstNamed = (pattern: RegExp): { name: string; key: string } | null => {
    for (const [key, value] of map) {
      if (pattern.test(key) && typeof value === 'string' && value.trim()) return { name: value.trim(), key };
    }
    return null;
  };

  const horse = [...map.entries()]
    .map(([key, value]) => ({ key, value, match: key.match(/^activity:([^:]+):name$/) }))
    .find(item => item.match && typeof item.value === 'string' && /ม้า|horse/iu.test(item.value));
  const activity = horse && typeof horse.value === 'string'
    ? { name: horse.value, key: horse.key }
    : firstNamed(/^activity:[^:]+:name$/);
  const meal = firstNamed(/^menu:[^:]+:name$/);
  const stay = firstNamed(/^stay:[^:]+:name$/);
  const gift = firstNamed(/^otop:[^:]+:name$/);

  if (!activity && !meal && !stay && !gift) return null;
  const lines = ['จัดเป็นแผนคร่าว ๆ จากตัวเลือกที่มีข้อมูลยืนยันได้แบบนี้ครับ'];
  const date = semanticEntities(input).date;
  if (typeof date === 'string' && date.trim()) lines.push('เริ่มตามวันที่ที่แก้ล่าสุด: ' + date.trim());
  if (activity) {
    lines.push('วันแรก: ' + activity.name);
    used.push(activity.key);
  }
  if (meal || gift) {
    const pieces = [meal?.name, gift?.name].filter((value): value is string => Boolean(value));
    lines.push('วันที่สอง: ' + pieces.join(' แล้วต่อด้วย '));
    if (meal) used.push(meal.key);
    if (gift) used.push(gift.key);
  }
  if (stay) {
    lines.push('ที่พักที่มีในรายการ: ' + stay.name);
    used.push(stay.key);
  }
  lines.push('นี่เป็นแผนคร่าว ๆ ยังไม่ได้จองหรือยืนยันรายการใดครับ');
  return { message: lines.join('\n'), usedFactKeys: [...new Set(used)] };
}
