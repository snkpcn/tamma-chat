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
import { resolveActivityCareFact, resourceCodeForActivityCode } from './_activity-care-policy';
import { HOMESTAY_FACTS, HOMESTAY_FACT_PROVENANCE } from './_tamma-domain-knowledge';

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

/** Human Core PR E: one generic Stay knowledge capability. It receives the
 * supervisor's closed informationNeed/entities plus facts already filtered by
 * CanonicalKnowledgeScope. It never sees customer text and never broadens a
 * focused result. */
export function renderStayResponse(input: HumanGroundedRenderInput): HumanGroundedRenderResult | null {
  const turn = input.semanticTurn;
  if (!turn || turn.domain !== 'stay' || input.language !== 'th') return null;
  const map = factMap(input);
  const used: string[] = [];
  const scope = input.dialogDecision.knowledgeRequests.find(request => request.domain === 'stay')?.scope;
  if (scope?.breadth === 'focused' && scope.status !== 'resolved') return null;

  if (turn.informationNeed === 'policy') {
    const topic = typeof turn.entities.policyTopic === 'string' ? turn.entities.policyTopic : null;
    const claims: Partial<Record<string, { value:string; key:typeof HOMESTAY_FACT_PROVENANCE.allowedClaimKeys[number] }>> = {
      check_in: { value:HOMESTAY_FACTS.checkInByTh, key:'checkInByTh' },
      check_out: { value:HOMESTAY_FACTS.checkOutByTh, key:'checkOutByTh' },
      room_service: { value:HOMESTAY_FACTS.roomServiceHoursTh, key:'roomServiceHoursTh' },
      booking_window: { value:HOMESTAY_FACTS.bookingWindowTh, key:'bookingWindowTh' },
      final_confirmation: { value:HOMESTAY_FACTS.finalConfirmationChannelsTh, key:'finalConfirmationChannelsTh' },
    };
    const claim = topic ? claims[topic] : null;
    if (!claim || !HOMESTAY_FACT_PROVENANCE.allowedClaimKeys.includes(claim.key)) return { message:'เรื่องนี้ยังไม่มีข้อมูลนโยบายที่ยืนยันได้ครับ ทองไทยไม่ขอเดา', usedFactKeys:[] };
    return { message:`${claim.value}ครับ`, usedFactKeys:[`${HOMESTAY_FACT_PROVENANCE.sourceId}:${claim.key}`] };
  }

  const bedrooms = Number(turn.entities.bedrooms);
  if (turn.informationNeed === 'catalog' && Number.isInteger(bedrooms)) {
    const count = bedrooms === 1 ? HOMESTAY_FACTS.oneBedroomHouses
      : bedrooms === 2 ? HOMESTAY_FACTS.twoBedroomHouses : null;
    if (count == null) return { message:`ตอนนี้ยังไม่มีข้อมูลยืนยันสำหรับที่พักแบบ ${bedrooms} ห้องนอนครับ`, usedFactKeys:[] };
    return {
      message:`ที่เฮือนสเตย์มีแบบ ${bedrooms} ห้องนอน ${count} หลังครับ`,
      usedFactKeys:[`${HOMESTAY_FACT_PROVENANCE.sourceId}:${bedrooms === 1 ? 'oneBedroomHouses' : 'twoBedroomHouses'}`],
    };
  }

  const rows = [...map.keys()]
    .map(key => key.match(/^stay:([^:]+):name$/u)?.[1])
    .filter((value): value is string => Boolean(value))
    .map(code => ({
      code,
      name:map.get(`stay:${code}:name`),
      capacity:map.get(`stay:${code}:capacity`),
      bedrooms:map.get(`stay:${code}:bedrooms`),
      price:map.get(`stay:${code}:price`),
      amenities:map.get(`stay:${code}:amenities`),
    }))
    .filter(row => typeof row.name === 'string' && row.name.trim());

  if (turn.informationNeed === 'amenities') {
    const withFacts = rows.filter(row => Array.isArray(row.amenities) && row.amenities.length);
    if (!withFacts.length) return { message:'สิ่งอำนวยความสะดวกเรื่องนี้ยังไม่มีข้อมูลที่ยืนยันได้ครับ ทองไทยไม่ขอเดา', usedFactKeys:[] };
    const lines = withFacts.map(row => {
      used.push(`stay:${row.code}:name`, `stay:${row.code}:amenities`);
      return `• ${row.name}: ${(row.amenities as unknown[]).join(', ')}`;
    });
    return { message:`สิ่งอำนวยความสะดวกที่ยืนยันได้ตอนนี้ครับ\n${lines.join('\n')}`, usedFactKeys:used };
  }

  if (turn.informationNeed === 'capacity') {
    const withFacts = rows.filter(row => typeof row.capacity === 'number');
    if (!withFacts.length) return { message:'ตอนนี้ยังไม่มีข้อมูลความจุที่ยืนยันได้สำหรับตัวเลือกนี้ครับ', usedFactKeys:[] };
    const lines = withFacts.map(row => {
      used.push(`stay:${row.code}:name`, `stay:${row.code}:capacity`);
      if (typeof row.bedrooms === 'number') used.push(`stay:${row.code}:bedrooms`);
      return `• ${row.name}${typeof row.bedrooms === 'number' ? ` — ${row.bedrooms} ห้องนอน` : ''} — รองรับ ${row.capacity} คน`;
    });
    return { message:lines.join('\n'), usedFactKeys:used };
  }

  if (turn.informationNeed === 'price') {
    const priced = rows.filter(row => typeof row.price === 'number');
    if (!priced.length) return { message:'ราคาที่พักล่าสุดยังไม่มีข้อมูลที่ยืนยันได้ครับ ทองไทยไม่ขอเดาราคา', usedFactKeys:[] };
    const lines = priced.map(row => {
      used.push(`stay:${row.code}:name`, `stay:${row.code}:price`);
      return `• ${row.name} — ${row.price} บาท`;
    });
    return { message:lines.join('\n'), usedFactKeys:used };
  }

  if (turn.informationNeed === 'availability') {
    const availability = [...map.entries()].filter(([key]) => /^availability:[^:]+:.*:available$/u.test(key));
    if (!availability.length) {
      const source = input.knowledgeBundles.flatMap(bundle => bundle.sources).find(item => item.need === 'availability');
      return source?.status === 'empty'
        ? { message:'ทองไทยเช็กช่วงที่ขอแล้ว ตอนนี้ยังไม่พบที่พักว่างครับ และยังไม่ได้จอง', usedFactKeys:[] }
        : { message:'ตอนนี้ทองไทยยังเช็กห้องว่างตามช่วงที่ขอไม่ได้ครับ เลยไม่อยากเดาให้ผิด', usedFactKeys:[] };
    }
    const lines = availability.map(([key, value]) => {
      const code = key.match(/^availability:([^:]+):/u)?.[1] ?? '';
      const name = map.get(`stay:${code}:name`) ?? code;
      used.push(key);
      return `• ${name}: ${value === true ? 'มีว่างตามช่วงที่ขอ' : 'ไม่พบห้องว่างตามช่วงที่ขอ'}`;
    });
    return { message:lines.join('\n'), usedFactKeys:used };
  }

  if (['discover','recommend','compare','ask'].includes(turn.action) || turn.informationNeed === 'catalog' || turn.informationNeed === 'recommendation') {
    if (!rows.length) return null;
    const lines = rows.map(row => {
      used.push(`stay:${row.code}:name`);
      if (typeof row.bedrooms === 'number') used.push(`stay:${row.code}:bedrooms`);
      if (typeof row.capacity === 'number') used.push(`stay:${row.code}:capacity`);
      return `• ${row.name}${typeof row.bedrooms === 'number' ? ` — ${row.bedrooms} ห้องนอน` : ''}${typeof row.capacity === 'number' ? ` — รองรับ ${row.capacity} คน` : ''}`;
    });
    return { message:`🏡 ที่พักที่ยืนยันได้ตอนนี้ครับ\n${lines.join('\n')}`, usedFactKeys:used };
  }
  return null;
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

/** Dietary/allergy SAFETY checks -- unlike general preference signals (e.g.
 *  wantsCalm/wantsBeginner below, which stay on wants()) -- must never be
 *  decided from normalizedMeaning. That field is free-form observability
 *  text, and the wider architecture keeps it out of routing/decisions for
 *  exactly this reason: a customer's own paraphrase ("I like the pork belly
 *  here") could otherwise flip a safety filter through blob-substring
 *  matching, which can't tell a positive mention from a restriction. Reads
 *  ONLY the closed constraints array, matching either a durable-memory
 *  canonical key (_memory-relevance.ts's FOOD_CONSTRAINTS -- a remembered
 *  allergy is stored as "X_allergy", a stated current-turn preference as
 *  "no_X", and both must be recognized) or a raw ingredient word some flows
 *  still write directly. Real production gap this closes: "shrimp_allergy"
 *  (the durable memory key) matched none of the previously-checked
 *  fragments, so a remembered allergy could be present in state but
 *  silently absent from the recommendation copy actually shown. */
function hasFoodSafetyConstraint(input: HumanGroundedRenderInput, keys: readonly string[]): boolean {
  const turn = input.semanticTurn;
  const constraints = turn?.constraints
    ?? input.dialogDecision.knowledgeRequests.flatMap(request => request.constraints);
  const lowered = keys.map(key => key.toLowerCase());
  return constraints.some(constraint => {
    const value = constraint.toLowerCase();
    return lowered.some(key => value.includes(key));
  });
}

function numericEntity(input: HumanGroundedRenderInput, keys: readonly string[]): number | null {
  const entities = semanticEntities(input);
  for (const key of keys) {
    const raw=entities[key];
    const value = Number(raw);
    if (Number.isFinite(value) && value >= 0) return value;
    if(raw && typeof raw==='object' && !Array.isArray(raw)){
      const amount=Number((raw as Record<string,unknown>).amount);
      if(Number.isFinite(amount) && amount>=0) return amount;
    }
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
    // Real production gap: _activity-catalog-policy.ts's
    // ACTIVITY_ASSET_ATTRIBUTE_KEYS names this attribute
    // 'beginnerSuitability', which _dialog-source-adapters.ts's live adapter
    // emits as fact key 'beginnerSuitability:activity_asset:<code>' -- a
    // spelling neither of the two keys below ever matched, so a real
    // beginner-suitability fact from the live catalog could never be seen
    // here. Kept the old spellings too in case another producer still uses
    // them.
    const beginnerKey = [
      'beginnerSuitability:activity_asset:' + code,
      'beginnerSuitable:activity_asset:' + code,
      'activity_asset:' + code + ':beginnerSuitability',
      'activity_asset:' + code + ':beginnerSuitable',
    ].find(key => map.has(key));
    const typeKey = 'activity_asset:' + code + ':type';
    const type = map.has(typeKey) ? map.get(typeKey) : undefined;
    return {
      code,
      name: name.trim(),
      nameKey,
      temperamentKey,
      temperament: temperamentKey ? map.get(temperamentKey) : undefined,
      beginnerKey,
      beginnerSuitable: beginnerKey ? map.get(beginnerKey) : undefined,
      typeKey,
      type: typeof type === 'string' ? type : undefined,
    };
  }).filter((row): row is NonNullable<typeof row> => Boolean(row));
}

// Human Core PR C: this used to re-scope activityAssetRows itself, by
// regex-matching ACTIVITY_TYPE_MARKERS (horse/atv/archery) against
// constraints+normalizedMeaning+JSON(entities) -- a second, DOWNSTREAM
// category guess independent of (and sometimes disagreeing with) whatever
// the semantic layer actually understood. That regex is retired: the
// knowledge bundle activityAssetRows reads from is now ALREADY scoped by
// _knowledge-resolver.ts's own response scope firewall (see
// _canonical-knowledge-scope.ts's filterFactsByCanonicalScope), driven by
// the SAME CanonicalKnowledgeScope the Dialog Manager resolved for this
// turn from real activity_offerings/activity_assets relationships -- never
// a keyword table, and generalizing to any new activity type added to the
// catalog with no renderer change. activityAssetRows(input) below is used
// directly; no re-filtering happens at render time.
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

/** Human Core PR D: the ONE generic activity care/safety/suitability/
 *  equipment capability, consuming only the semantic supervisor's own
 *  informationNeed (safety/suitability/equipment -- see
 *  _semantic-interpreter.ts) plus a static, verified policy fact (see
 *  _activity-care-policy.ts) -- never raw customer text. Supersedes
 *  thongthai-chat.ts's horseCareFearResponse/horseSafetyQuestionResponse/
 *  atvCareIntentResponse/archeryCareIntentResponse for whatever this single
 *  capability already covers; a topic/resourceCode combination with no
 *  verified fact yet returns null so those legacy responders (or a plain
 *  clarification) remain the honest fallback rather than a fabricated
 *  answer. */
export function renderActivityCareResponse(input: HumanGroundedRenderInput): HumanGroundedRenderResult | null {
  const turn = input.semanticTurn;
  if (!turn || turn.domain !== 'activity' || input.language !== 'th') return null;
  if (turn.informationNeed !== 'safety' && turn.informationNeed !== 'suitability' && turn.informationNeed !== 'equipment') return null;

  const entities = semanticEntities(input);
  const activeTask = input.dialogDecision.taskStateContainer.activeTask;
  const slotResourceCode = activeTask?.type === 'activity_booking' && typeof activeTask.slots.resourceCode === 'string'
    ? activeTask.slots.resourceCode
    : null;
  const entityActivityCode = typeof entities.activityCode === 'string' ? entities.activityCode : null;
  const resourceCode = slotResourceCode
    ?? (entityActivityCode ? resourceCodeForActivityCode(entityActivityCode) : null)
    ?? (typeof entities.horseName === 'string' && entities.horseName.trim() ? 'activity-horse' : null);

  const message = resolveActivityCareFact(resourceCode, turn.informationNeed);
  if (!message) return null;
  return { message, usedFactKeys: [] };
}

export function renderActivityAvailability(input: HumanGroundedRenderInput): HumanGroundedRenderResult | null {
  const turn=input.semanticTurn;
  if(!turn || turn.domain!=='activity' || turn.informationNeed!=='availability' || input.language!=='th') return null;

  const availabilitySources=input.knowledgeBundles
    .flatMap(bundle=>bundle.sources)
    .filter(source=>source.need==='availability');
  if(!availabilitySources.length) return null;

  const entity=semanticEntities(input);
  const nameOf=(value:unknown):string|null=>{
    if(typeof value==='string'&&value.trim()) return value.trim();
    if(value&&typeof value==='object'&&!Array.isArray(value)){
      const name=(value as Record<string,unknown>).name;
      if(typeof name==='string'&&name.trim()) return name.trim();
    }
    return null;
  };
  const primary=
    nameOf(entity.primaryResource)
    ?? nameOf(entity.primaryHorse)
    ?? nameOf(entity.preferredAsset)
    ?? nameOf(entity.preferredHorse)
    ?? nameOf(entity.primaryAsset)
    ?? nameOf(entity.primary);
  const fallback=
    nameOf(entity.fallbackResource)
    ?? nameOf(entity.fallbackHorse)
    ?? nameOf(entity.fallbackAsset)
    ?? nameOf(entity.fallback);
  const names=[primary,fallback].filter((value):value is string=>Boolean(value));
  const noTransaction=semanticText(input).includes('no_transaction')
    || semanticText(input).includes('no_booking')
    || semanticText(input).includes('ไม่จอง');

  if(availabilitySources.some(source=>source.status==='unavailable')){
    const subject=names.length ? names.join(' / ') : 'ม้าที่ถาม';
    return {
      message:`ตอนนี้ยังเช็กคิวสดของ ${subject} ให้ยืนยันไม่ได้ครับ${noTransaction?' และยังไม่ได้ทำรายการหรือจองอะไรให้':''}`,
      usedFactKeys:[],
    };
  }
  if(availabilitySources.every(source=>source.status==='empty')){
    if(names.length){
      return {
        message:`ตอนนี้ยังไม่มีคิวว่างที่ยืนยันได้สำหรับ ${names.join(' / ')} ตามเงื่อนไขที่ถามครับ${noTransaction?' เลยยังไม่ได้เลือกหรือจองอะไรให้':''}`,
        usedFactKeys:[],
      };
    }
    return {
      message:`ตอนนี้ยังไม่มีม้าตัวไหนที่มีคิวว่างยืนยันตรงเงื่อนไขที่ถามครับ${noTransaction?' และยังไม่ได้ทำรายการหรือจองอะไรให้':''}`,
      usedFactKeys:[],
    };
  }
  return null;
}

export function renderActivityRecommendation(input: HumanGroundedRenderInput): HumanGroundedRenderResult | null {
  const turn = input.semanticTurn;
  if (!turn || turn.domain !== 'activity' || input.language !== 'th') return null;

  const map = factMap(input);
  const assets = activityAssetRows(input);
  const excluded = explicitExcludedNames(input, assets.map(asset => asset.name));
  const wantsCalm = wants(input, ['prefer_calm', 'calm_horse', 'calm_temperament', 'preferred_horse_trait', 'calmer', 'นิ่ง', 'ใจเย็น']);
  const wantsBeginner = wants(input, ['beginner', 'มือใหม่', 'ไม่เคยขี่']);
  const wantsLight = wants(input, ['light_activity', 'low_exertion', 'not_too_tiring', 'ไม่หนัก', 'ไม่เหนื่อย']);
  const wantsRain = wants(input, ['rain', 'ฝน', 'weather_fallback']);
  const hasRecommendationShape = turn.action === 'recommend'
    || wantsCalm
    || wantsBeginner
    || wantsLight
    || wantsRain
    || excluded.size > 0;
  if(!hasRecommendationShape) return null;

  if (wantsLight && !wantsCalm && !wantsBeginner) {
    const activityNames=[...map.entries()]
      .filter(([key,value])=>/^activity:[^:]+:name$/u.test(key)&&typeof value==='string')
      .map(([key,value])=>({key,name:String(value)}));
    if(activityNames.length){
      return {
        message:[
          'กิจกรรมที่มีข้อมูลยืนยันตอนนี้มี ' + activityNames.map(item=>item.name).join(' / ') + ' ครับ',
          'แต่ข้อมูลระดับความหนักและความเหมาะกับเด็กของแต่ละกิจกรรมยังไม่ครบพอให้ฟันธงว่าอันไหนเบาที่สุด เลยไม่ขอเดาให้ครับ',
        ].join('\n'),
        usedFactKeys:activityNames.map(item=>item.key),
      };
    }
  }

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
      if(turn.informationNeed==='availability'){
        const availabilitySources=input.knowledgeBundles
          .flatMap(bundle=>bundle.sources)
          .filter(source=>source.need==='availability');
        if(availabilitySources.some(source=>source.status==='empty')){
          lines.push('ส่วนคิวตามวันและเวลาที่ถาม ตอนนี้ยังไม่มีเวลาว่างที่ยืนยันจากข้อมูลที่ตรวจได้ครับ');
        }else if(availabilitySources.some(source=>source.status==='unavailable')){
          lines.push('ส่วนคิวตามวันและเวลาที่ถาม ตอนนี้ยังเช็กข้อมูลสดให้ยืนยันไม่ได้ครับ');
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

/** Human Core PR F: one terminal Restaurant knowledge renderer for
 * already-understood semantics. It consumes only the supervisor's closed
 * informationNeed/action/entities and verified menu facts that have already
 * passed CanonicalKnowledgeScope. No raw customer text is accepted here. */
export function renderRestaurantResponse(input: HumanGroundedRenderInput): HumanGroundedRenderResult | null {
  const turn=input.semanticTurn;
  if(!turn || turn.domain!=='restaurant' || input.language!=='th') return null;

  if(turn.action==='recommend') return renderRestaurantRecommendation(input);

  const map=factMap(input);
  const sources=input.knowledgeBundles.flatMap(bundle=>bundle.sources);
  const warnings=input.knowledgeBundles.flatMap(bundle=>bundle.warnings);
  if(warnings.includes('scope_unresolved_facts_filtered')) {
    return { message:'ตอนนี้หาเมนูที่ระบุจากรายการจริงไม่เจอครับ เลยไม่ขอเดาข้อมูลของเมนูอื่นมาแทน', usedFactKeys:[] };
  }

  const ids=[...new Set([...map.keys()]
    .map(key=>key.match(/^menu:([^:]+):name$/u)?.[1])
    .filter((value):value is string=>Boolean(value)))];
  const rows=ids.map(id=>({
    id,
    name:map.get(`menu:${id}:name`),
    category:map.get(`menu:${id}:category`),
    price:map.get(`menu:${id}:price`),
    orderable:map.get(`menu:${id}:orderable`),
    availableServings:map.get(`menu:${id}:availableServings`),
    ingredients:map.get(`menu:${id}:ingredients`),
    unavailableIngredients:map.get(`menu:${id}:unavailableIngredients`),
    description:map.get(`menu:${id}:description`),
  })).filter(row=>typeof row.name==='string'&&row.name.trim());

  if(turn.informationNeed==='price') {
    if(!rows.length) return {message:'ตอนนี้ยังไม่มีราคาที่ตรวจยืนยันได้สำหรับเมนูที่ถามครับ',usedFactKeys:[]};
    const used:string[]=[];
    const lines=rows.map(row=>{
      used.push(`menu:${row.id}:name`);
      if(typeof row.price==='number') used.push(`menu:${row.id}:price`);
      return typeof row.price==='number'
        ? `• ${row.name} — ${Math.round(row.price)} บาท`
        : `• ${row.name} — ยังไม่มีราคาที่ตรวจยืนยันได้`;
    });
    return {message:lines.join('\n'),usedFactKeys:[...new Set(used)]};
  }

  if(turn.informationNeed==='ingredients') {
    if(!rows.length) return {message:'ตอนนี้ยังไม่มีข้อมูลส่วนผสมที่ตรวจยืนยันได้สำหรับเมนูที่ถามครับ',usedFactKeys:[]};
    const used:string[]=[];
    const lines=rows.map(row=>{
      used.push(`menu:${row.id}:name`);
      if(Array.isArray(row.ingredients)) {
        used.push(`menu:${row.id}:ingredients`);
        return `• ${row.name}: ${row.ingredients.map(value=>String(value)).join(', ')}`;
      }
      return `• ${row.name}: ยังไม่มีข้อมูลส่วนผสมที่ตรวจยืนยันได้`;
    });
    return {message:lines.join('\n'),usedFactKeys:[...new Set(used)]};
  }

  if(turn.informationNeed==='availability') {
    const unavailableSource=sources.some(source=>source.need==='availability'&&source.status==='unavailable');
    const emptySource=sources.some(source=>source.need==='availability'&&source.status==='empty');
    if(unavailableSource || !sources.some(source=>source.need==='availability')) {
      return {message:'ตอนนี้ทองไทยยังไม่มีข้อมูลโต๊ะว่างแบบสดที่ยืนยันได้ครับ เลยไม่ขอเดาว่าเต็มหรือว่าง และยังไม่ได้ทำรายการให้',usedFactKeys:[]};
    }
    if(emptySource) return {message:'ตรวจข้อมูลที่มีแล้ว ตอนนี้ยังไม่พบโต๊ะว่างที่ยืนยันได้ตามเงื่อนไขที่ถามครับ และยังไม่ได้จอง',usedFactKeys:[]};
  }

  if(turn.informationNeed==='transaction_status') {
    const unavailable=sources.some(source=>source.need==='order_status'&&source.status==='unavailable');
    if(unavailable || !sources.some(source=>source.need==='order_status')) {
      return {message:'ตอนนี้ทองไทยยังตรวจสถานะออเดอร์จากแหล่งข้อมูลยืนยันไม่ได้ครับ เลยไม่ขอเดาสถานะให้',usedFactKeys:[]};
    }
  }

  if(turn.informationNeed==='catalog' || turn.action==='discover' || turn.action==='ask' || turn.action==='compare') {
    if(!rows.length) {
      const menuSource=sources.find(source=>['catalog','price','ingredients','recommendations_input'].includes(source.need));
      return menuSource?.status==='empty'
        ? {message:'ตอนนี้ยังไม่มีเมนูที่ยืนยันจากระบบให้แสดงครับ',usedFactKeys:[]}
        : null;
    }
    const used:string[]=[];
    const shown=rows.slice(0,12);
    const lines=shown.map(row=>{
      used.push(`menu:${row.id}:name`);
      if(typeof row.price==='number') used.push(`menu:${row.id}:price`);
      if(typeof row.orderable==='boolean') used.push(`menu:${row.id}:orderable`);
      const price=typeof row.price==='number' ? ` — ${Math.round(row.price)} บาท` : '';
      const availability=row.orderable===false || (typeof row.availableServings==='number'&&row.availableServings<=0)
        ? ' — ตอนนี้ไม่พร้อมสั่ง'
        : '';
      return `• ${row.name}${price}${availability}`;
    });
    return {message:['🍽️ เมนูที่ยืนยันได้ตอนนี้ครับ',...lines].join('\n'),usedFactKeys:[...new Set(used)]};
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

  const noShrimp = hasFoodSafetyConstraint(input, ['no_shrimp', 'avoid_shrimp', 'shrimp_allergy', 'กุ้ง']);
  const noPork = hasFoodSafetyConstraint(input, ['no_pork', 'avoid_pork', 'หมู']);
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
