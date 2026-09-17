import { readFile, writeFile } from 'node:fs/promises';

const intelligenceFile = new URL('../netlify/functions/_restaurant-intelligence.ts', import.meta.url);
const chatFile = new URL('../netlify/functions/thongthai-chat.ts', import.meta.url);
const marker = '// RESTAURANT_CONSTRAINT_COPY_FIX_V1';

async function patchIntelligence() {
  let source = await readFile(intelligenceFile, 'utf8');
  if (source.includes(marker)) {
    console.log('RESTAURANT_CONSTRAINT_INTELLIGENCE_ALREADY_APPLIED');
    return;
  }

  const before = "  else if (includesAny(text, [/เผ็ดน้อย/u,/เผ็ดนิด/u,/ไม่ค่อยเผ็ด/u,/mild/i])) spice = 'mild';";
  const after = [
    marker,
    "  else if (includesAny(text, [/เผ็ดน้อย/u,/เผ็ดนิด/u,/ไม่ค่อยเผ็ด/u,/ไม่อยากเผ็ดมาก/u,/ไม่เอาเผ็ดมาก/u,/ขอไม่เผ็ดมาก/u,/เผ็ดไม่มาก/u,/mild/i])) spice = 'mild';",
  ].join('\n');

  if (!source.includes(before)) throw new Error('RESTAURANT_CONSTRAINT_COPY_MISSING_SPICE_PATTERN');
  source = source.replace(before, after);
  await writeFile(intelligenceFile, source, 'utf8');
  console.log('RESTAURANT_CONSTRAINT_INTELLIGENCE_APPLIED');
}

async function patchChatCopy() {
  let source = await readFile(chatFile, 'utf8');
  if (source.includes(marker)) {
    console.log('RESTAURANT_CONSTRAINT_CHAT_ALREADY_APPLIED');
    return;
  }

  const signature = 'function formatAdvisorMessage(advisor: any): string {';
  if (!source.includes(signature)) throw new Error('RESTAURANT_CONSTRAINT_COPY_MISSING_FORMATTER');

  const helper = `${marker}\nfunction formatRestaurantConstraintAck(advisor: any): string {\n  const parsed = advisor?.parsed && typeof advisor.parsed === 'object' ? advisor.parsed as Record<string, unknown> : null;\n  if (!parsed) return '';\n\n  const labels: string[] = [];\n  const avoidProteins = Array.isArray(parsed.avoidProteins) ? parsed.avoidProteins.map(String) : [];\n  const proteinLabels: Record<string, string> = {\n    pork:'ไม่มีหมู', beef:'ไม่มีเนื้อวัว', chicken:'ไม่มีไก่', fish:'ไม่มีปลา', egg:'ไม่มีไข่',\n  };\n  for (const protein of avoidProteins) if (proteinLabels[protein]) labels.push(proteinLabels[protein]);\n\n  if (parsed.vegetarian === true) labels.push('มังสวิรัติ');\n\n  const avoidIngredients = Array.isArray(parsed.avoidIngredients) ? parsed.avoidIngredients.map(String) : [];\n  if (avoidIngredients.some(value => value.includes('ปลาร้า'))) labels.push('ไม่มีปลาร้า');\n  if (avoidIngredients.some(value => value.includes('กุ้ง'))) labels.push('ไม่มีกุ้งแห้ง');\n  if (avoidIngredients.some(value => value.includes('ถั่ว'))) labels.push('ไม่มีถั่วลิสง');\n\n  const allergens = Array.isArray(parsed.allergenFlags) ? parsed.allergenFlags.map(String) : [];\n  const allergenLabels: Record<string, string> = { peanut:'เลี่ยงถั่ว', shrimp:'เลี่ยงกุ้ง', fish:'เลี่ยงปลา', egg:'เลี่ยงไข่' };\n  for (const allergen of allergens) if (allergenLabels[allergen]) labels.push(allergenLabels[allergen]);\n\n  if (parsed.spice === 'none') labels.push('ไม่เผ็ด');\n  else if (parsed.spice === 'mild') labels.push('ไม่เผ็ดจัด');\n  else if (parsed.spice === 'medium') labels.push('เผ็ดกลาง');\n\n  const unique = [...new Set(labels)];\n  return unique.length ? \`✅ คัดเมนูตามที่บอกให้แล้วครับ: \${unique.join(' · ')}\` : '';\n}\n\n${signature}`;
  source = source.replace(signature, helper);

  const composeAnchor = "    return [\n      '🍽️ ชุดที่ทองไทยแนะนำ',";
  const composeReplacement = "    const constraintAck = formatRestaurantConstraintAck(advisor);\n    return [\n      constraintAck,\n      '🍽️ ชุดที่ทองไทยแนะนำ',";
  if (!source.includes(composeAnchor)) throw new Error('RESTAURANT_CONSTRAINT_COPY_MISSING_COMPOSE_BLOCK');
  source = source.replace(composeAnchor, composeReplacement);

  const recommendBefore = "    const intro = advisor?.mode === 'pairing'\n      ? '🍽️ มีเมนูนี้แล้ว เพิ่มอีกนิดจะบาลานซ์โต๊ะกำลังดีครับ'\n      : '🍽️ เมนูที่น่าลองตอนนี้';\n    return [\n      intro,\n      '',\n      ...rows.map((row: any) => {\n        const reason = Array.isArray(row.reasons) && row.reasons.length ? row.reasons[0] : row.summary;\n        return `• ${row.name} — ${formatMoney(row.price)}${reason ? `\\n  ${reason}` : ''}`;\n      }),";

  const recommendAfter = "    const constraintAck = formatRestaurantConstraintAck(advisor);\n    const intro = advisor?.mode === 'pairing'\n      ? '🍽️ มีเมนูนี้แล้ว เพิ่มอีกนิดจะบาลานซ์โต๊ะกำลังดีครับ'\n      : constraintAck ? '🍽️ จากเมนูที่มีตอนนี้ ทองไทยแนะนำ' : '🍽️ เมนูที่น่าลองตอนนี้';\n    return [\n      constraintAck,\n      intro,\n      '',\n      ...rows.map((row: any) => {\n        const reason = Array.isArray(row.reasons) && row.reasons.length ? row.reasons[0] : '';\n        return `• ${row.name} — ${formatMoney(row.price)}${reason ? `\\n  ${reason}` : ''}`;\n      }),";

  if (!source.includes(recommendBefore)) throw new Error('RESTAURANT_CONSTRAINT_COPY_MISSING_RECOMMEND_BLOCK');
  source = source.replace(recommendBefore, recommendAfter);

  await writeFile(chatFile, source, 'utf8');
  console.log('RESTAURANT_CONSTRAINT_CHAT_APPLIED');
}

await patchIntelligence();
await patchChatCopy();
