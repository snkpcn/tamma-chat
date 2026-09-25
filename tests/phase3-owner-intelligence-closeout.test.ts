import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractIntelligenceSignals } from '../netlify/functions/_customer-phrase-intelligence';
import { evaluateBotQualitySignals } from '../netlify/functions/_bot-quality-intelligence';

function categories(message: string): string[] {
  return extractIntelligenceSignals(message).map(signal => signal.category);
}

test('Phase 3 closeout: common intents are normalized across all owner-dashboard domains', () => {
  const cases: Array<[string,string]> = [
    ['ร้านอาหารมีอะไรแนะนำ', 'intent_restaurant_recommendation'],
    ['อยากกินกาแฟที่คาเฟ่', 'intent_cafe'],
    ['อยากขี่ม้า', 'intent_horse'],
    ['อยากขับ ATV', 'intent_atv'],
    ['อยากยิงธนู', 'intent_archery'],
    ['อยากพักเฮือนสเตย์', 'intent_homestay'],
    ['ทำมา-ชาติอยู่ที่ไหน', 'intent_location'],
    ['วันนี้ฝนตกไหม', 'intent_weather'],
    ['ขอคืนเงินได้ไหม', 'intent_refund'],
    ['บริการแย่มาก อยากร้องเรียน', 'intent_complaint'],
    ['พื้นลื่น ไม่ปลอดภัย', 'intent_safety'],
    ['อยากจองขี่ม้าพรุ่งนี้', 'intent_booking'],
    ['ขี่ม้าราคาเท่าไหร่', 'intent_pricing'],
    ['พรุ่งนี้ยังมีคิวว่างไหม', 'intent_availability'],
  ];
  for (const [message, expected] of cases) {
    assert.ok(categories(message).includes(expected), `${message} -> ${expected}`);
  }
});

test('Phase 3 closeout: food/activity interests and group patterns are aggregate-only normalized signals', () => {
  const signals = new Set([
    ...categories('มากับแฟน อยากขี่ม้า'),
    ...categories('มากับเพื่อน อยากเล่น ATV'),
    ...categories('พาลูกมากับครอบครัว อยากยิงธนู'),
    ...categories('พาแม่มา อยากพักเฮือนสเตย์'),
    ...categories('มาคนเดียว อยากกินลาบหมู แล้วไปคาเฟ่'),
    ...categories('มากับบริษัทเป็นกรุ๊ป'),
  ]);
  for (const expected of [
    'group_couple','group_friends','group_family','group_family_children',
    'group_elderly_companion','group_solo','group_corporate',
    'interest_horse','interest_atv','interest_archery','interest_homestay','interest_cafe',
    'dish_interest_larb','food_interest_pork',
  ]) {
    assert.ok(signals.has(expected), expected);
  }
});

test('Phase 3 closeout: customer constraint patterns include children, beginner and weather sensitivity', () => {
  const signals = new Set([
    ...categories('มีเด็กมาด้วย'),
    ...categories('ไม่เคยขี่ม้า เป็นมือใหม่'),
    ...categories('ถ้าฝนตกไม่สะดวก ขอแบบไม่โหด'),
    ...categories('แม่เดินไกลไม่ได้'),
  ]);
  for (const expected of ['children_present','beginner','weather_sensitive','low_intensity','mobility_need']) {
    assert.ok(signals.has(expected), expected);
  }
});

test('Phase 3 closeout: bot quality records actual post-response failures and successes', () => {
  const cases: Array<[Parameters<typeof evaluateBotQualitySignals>[0], string]> = [
    [{ customerMessage:'วันนี้ฝนตกไหม', assistantMessage:'ขอรายละเอียดเพิ่มครับ หมายถึงเรื่องไหนครับ?' }, 'bot_quality_clarification_failure'],
    [{ customerMessage:'อยากขี่ม้า', assistantMessage:'ร้านอาหารมีลาบกับส้มตำครับ' }, 'bot_quality_wrong_domain'],
    [{ customerMessage:'ขอเมนูอีกที', assistantMessage:'เมนูเดิมครับ', chatHistory:[{role:'assistant',content:'เมนูเดิมครับ'}] }, 'bot_quality_repeated_answer'],
    [{ customerMessage:'วันนี้ฝนตกไหม', assistantMessage:'เลือกม้า ภาราดร หรือ ทองไทย ครับ', chatHistory:[{role:'user',content:'อยากขี่ม้า'}] }, 'bot_quality_stale_context_hijack'],
    [{ customerMessage:'ขี่ม้าปลอดภัยไหม', assistantMessage:'ปลอดภัยแน่นอนครับ' }, 'bot_quality_unsupported_claim'],
    [{ customerMessage:'ขอคืนเงินได้ไหม', assistantMessage:'ได้ครับ คืนเงินได้แน่นอน' }, 'bot_quality_authority_boundary_failure'],
    [{ customerMessage:'พื้นลื่นมาก ตอนเล่น ATV น่ากลัว', assistantMessage:'รับทราบครับ หยุดกิจกรรมไว้ก่อนและส่งให้ทีมกิจกรรมกับเจ้าของตรวจสอบแล้วครับ' }, 'bot_quality_safety_handling'],
    [{ customerMessage:'ทำมา-ชาติอยู่ที่ไหน', assistantMessage:'ทำมา-ชาติอยู่ที่ชัยภูมิครับ', chatHistory:[{role:'assistant',content:'ผมยังไม่เข้าใจครับ ลองถามใหม่อีกครั้ง'}] }, 'bot_quality_successful_recovery'],
  ];
  for (const [input, expected] of cases) {
    const found = evaluateBotQualitySignals(input).map(signal => signal.category);
    assert.ok(found.includes(expected), `${expected}: ${JSON.stringify(found)}`);
  }
});
