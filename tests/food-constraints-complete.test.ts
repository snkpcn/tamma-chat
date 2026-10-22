import test from 'node:test';
import assert from 'node:assert/strict';
import { readFoodRequirements, assessFoodRequirements, foodMemorySignals } from '../netlify/functions/_food-constraints';
import { normalizeRestaurantProfile, adviseRestaurantMenu } from '../netlify/functions/_restaurant-intelligence';
import { extractGuestPreferenceSignal } from '../netlify/functions/_customer-phrase-intelligence';
import { withHarness, brainRequest, guestId } from './helpers/canonical-core-harness';
import { deliverLineTexts } from './helpers/line-channel';
import { askBothChannels } from './helpers/both-channels';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';
import { createRestaurantPreorder, createRestaurantPreorderWithPromotion } from '../netlify/functions/_restaurant-sot';

const profile = normalizeRestaurantProfile({});
const facts = { name: 'test dish', ingredients: ['ข้าว', 'ไข่', 'นมวัว', 'น้ำปลา', 'กุ้ง', 'ถั่วลิสง'], safety: profile.safety, customization: profile.customization };

const groups = [
  ['แพ้ถั่วลิสง', 'peanut'], ['แพ้อัลมอนด์', 'tree_nut'], ['แพ้นมวัว', 'milk'], ['แพ้ไข่', 'egg'],
  ['แพ้ถั่วเหลือง', 'soy'], ['แพ้แป้งสาลี', 'wheat'], ['แพ้กลูเตน', 'gluten'], ['แพ้งา', 'sesame'],
  ['แพ้กุ้ง', 'shrimp'], ['แพ้ปลา', 'fish'], ['แพ้อาหารทะเล', 'shellfish'], ['แพ้มัสตาร์ด', 'mustard'],
  ['แพ้ขึ้นฉ่าย', 'celery'], ['แพ้ลูปิน', 'lupin'], ['แพ้ซัลไฟต์', 'sulphite'],
] as const;
for (const [statement, value] of groups) test(`allergen: ${statement} survives parsing and durable memory`, () => {
  assert.ok(readFoodRequirements([statement]).some(r => r.kind === 'allergy' && r.value === value));
  assert.ok(foodMemorySignals(statement).includes(`${value}_allergy`));
});

test('multiple requirements, scope, explicit changes, and companion ownership', () => {
  const r = readFoodRequirements(['แพ้นมและไข่ ไม่กินหมู']);
  assert.ok(r.some(x => x.value === 'milk' && x.kind === 'allergy'));
  assert.ok(r.some(x => x.value === 'egg' && x.kind === 'allergy'));
  assert.ok(r.some(x => x.value === 'pork' && x.kind === 'avoid'));
  assert.ok(!readFoodRequirements(['แพ้นม แต่กินไข่ได้']).some(x => x.value === 'egg'));
  assert.ok(!readFoodRequirements(['ผัดไข่ไม่ใส่ถั่ว']).some(x => x.value === 'egg'));
  assert.ok(!readFoodRequirements(['ไม่กินไข่', 'ตอนนี้กินไข่ได้แล้ว']).some(x => x.value === 'egg' && x.kind === 'avoid'));
  assert.ok(readFoodRequirements(['แพ้ไข่', 'ตอนนี้กินไข่ได้แล้ว']).some(x => x.value === 'egg' && x.kind === 'allergy'));
  assert.ok(!extractGuestPreferenceSignal('แฟนแพ้นม').addConstraints.includes('milk_allergy'));
  assert.ok(extractGuestPreferenceSignal('ผมแพ้นม').addConstraints.includes('milk_allergy'));
});

test('a missing tag/recipe is unknown, contradictory data conflicts, and kitchen changes need proof', () => {
  for (const text of ['แพ้ไข่', 'vegan', 'vegetarian', 'กินเจ', 'halal', 'kosher', 'gluten-free', 'lactose-free',
    'ไม่ใส่ผงชูรส', 'ไม่ใส่น้ำตาล', 'เผ็ดน้อย', 'เค็มน้อย', 'น้ำมันน้อย', 'ปรุงสุก', 'แยกซอส', 'เพิ่มไข่']) {
    const requirements = readFoodRequirements([text]);
    assert.ok(requirements.length, `lost: ${text}`);
    assert.equal(assessFoodRequirements({ ...facts, ingredients: [] }, requirements).status, 'unknown', text);
  }
  for (const text of ['แพ้นม', 'แพ้ไข่', 'แพ้กุ้ง', 'แพ้ถั่ว', 'vegan', 'vegetarian', 'กินเจ', 'ไม่ใส่ไข่']) {
    assert.equal(assessFoodRequirements(facts, readFoodRequirements([text])).status, 'conflict', text);
  }
  const proven = { ...facts, ingredients: ['ข้าว'], safety: { ...facts.safety,
    allergens: { egg: 'does_not_contain' as const }, crossContaminationRisk: 'does_not_contain' as const, dietaryTags: ['vegan'] } };
  assert.equal(assessFoodRequirements(proven, readFoodRequirements(['แพ้ไข่', 'vegan'])).status, 'verified');
  assert.equal(assessFoodRequirements({ ...proven, ingredients: ['ไข่'] }, readFoodRequirements(['แพ้ไข่'])).status, 'conflict');
});

test('modifiers across five languages never collapse into an unconditional stock answer', async () => {
  await withHarness(async h => {
    for (const q of ['มีผัดไทยไม่เผ็ดไหม', 'มีผัดไทยไม่ใส่ไข่ไหม', 'มีผัดไทยฮาลาลไหม', 'มีผัดไทยเจไหม',
      'Do you have gluten-free pad thai?', 'Do you have halal pad thai?', 'Do you have pad thai with extra egg?',
      '有没有不放鸡蛋的泰式炒粉？', 'Có pad thai không trứng không?', 'ມີຜັດໄທບໍ່ໃສ່ໄຂ່ບໍ່?']) {
      for (const answer of await askBothChannels(h, `requirements-${q}`, q)) {
        assert.doesNotMatch(answer.reply, /is available|พร้อมสั่ง|现在可以点|đang có|ພ້ອມສັ່ງ/u, `${q}: ${answer.reply}`);
        assert.equal(answer.modelCalls, 0, q);
      }
    }
  });
});

test('a plain stock question respects durable allergy, diet and avoidance on both channels', async () => {
  await withHarness(async h => {
    const userId = 'U-durable-milk-constraint';
    await deliverLineTexts(h, { userId, texts: ['ผมแพ้นมครับ'] });
    const lineFollowup = await deliverLineTexts(h, { userId, texts: ['ผัดไทยมีไหม'] });
    assert.doesNotMatch(lineFollowup.replies[0]?.texts.join(' ') ?? '', /พร้อมสั่ง/u);
    assert.match(lineFollowup.replies[0]?.texts.join(' ') ?? '', /นม/u);
    const gid = guestId('milk-memory');
    await processThongthaiChatCore(brainRequest('ผมแพ้นมครับ', gid), 'milk-first');
    const response = await processThongthaiChatCore(brainRequest('ผัดไทยมีไหม', gid), 'milk-followup');
    assert.doesNotMatch(String(response.payload.message), /พร้อมสั่ง/u);
    // Explicit request history also carries constraints not present in the closed legacy set.
    for (const code of ['milk_allergy', 'vegan', 'no_egg', 'halal', 'no_spicy']) {
      const req = brainRequest('ผัดไทยมีไหม', guestId(code));
      (req.guestContext.constraints as string[]).push(code);
      const reply = await processThongthaiChatCore(req, `memory-${code}`);
      assert.doesNotMatch(String(reply.payload.message), /พร้อมสั่ง/u, code);
    }
  });
});

test('advisor excludes known non-shrimp conflicts and never treats missing allergy data as safe', () => {
  const item = { id: 'egg', name: 'ไข่ผัดนม', category: 'food', price: 100, signature: false,
    orderable: true, availableServings: 10, ingredients: ['ไข่', 'นมวัว'], unavailableIngredients: [], profile };
  const advice = adviseRestaurantMenu([item], { query: 'แพ้นม แนะนำอาหารหน่อย' });
  assert.equal(advice.recommendations.length, 0);
  const unknown = adviseRestaurantMenu([{ ...item, ingredients: [] }], { query: 'แพ้ไข่ ไข่ผัดนมกินได้ไหม' });
  assert.equal(unknown.itemSafety?.safe, null);
});

test('plain and promotion order gates reject missing food proof before any create, notification or payment', async () => {
  await withHarness(async h => {
    const args = { guestDbId: guestId('order-food'), channel: 'web', date: '2026-11-01', time: '12:00',
      items: [{ name: 'ผัดไทย', quantity: 1 }], customerName: 'Test', requirementTexts: ['แพ้กุ้ง'] };
    await assert.rejects(createRestaurantPreorder(args), /food_requirements_conflict/u);
    await assert.rejects(createRestaurantPreorder({ ...args, requirementTexts: ['halal'] }), /food_requirements_unknown/u);
    await assert.rejects(createRestaurantPreorderWithPromotion({ ...args, promotionCampaignId: 'promo', pricingOverride: {} }), /food_requirements_conflict/u);
    assert.equal(h.postsTo('restaurant_preorders_rpc').length, 0);
    assert.equal(h.postsTo('payment_requests').length, 0);
  });
});

test('explicit corrections update avoidance without inventing an allergy or overwriting a companion', () => {
  assert.ok(!extractGuestPreferenceSignal('ผมไม่ได้แพ้ไข่').addConstraints.includes('egg_allergy'));
  assert.ok(extractGuestPreferenceSignal('ผมไม่ได้แพ้ไข่').removeConstraints.includes('egg_allergy'));
  assert.ok(extractGuestPreferenceSignal('ตอนนี้กินไข่ได้แล้ว').removeConstraints.includes('no_egg'));
  assert.ok(!extractGuestPreferenceSignal('ไม่ต้องงดนมแล้ว').addConstraints.includes('no_cow_milk'));
  assert.ok(!extractGuestPreferenceSignal('my wife is allergic to milk').addConstraints.includes('milk_allergy'));
  assert.ok(extractGuestPreferenceSignal('I am allergic to milk').addConstraints.includes('milk_allergy'));
});

test('nutrition, salt, cooking and unsupported substitutions stay unknown; plant milk is not dairy evidence', () => {
  for (const q of ['สำหรับคนเป็นเบาหวาน', 'อาหารสำหรับโรคไต', 'ต่ำกว่า 200 แคลอรี', 'low sodium', 'well done', 'แยกอุปกรณ์', 'เปลี่ยนกุ้งเป็นไก่']) {
    const req = readFoodRequirements([q]);
    assert.ok(req.length, q);
    assert.equal(assessFoodRequirements(facts, req).status, 'unknown', q);
  }
  const vegan = { ...facts, ingredients: ['coconut milk', 'peanut butter'],
    safety: { ...facts.safety, dietaryTags: ['vegan'] } };
  assert.equal(assessFoodRequirements(vegan, readFoodRequirements(['vegan'])).status, 'verified');
});

test('verified constraints reach the kitchen note and do not create duplicate orders', async () => {
  await withHarness(async h => {
    const inner = h.fetchMock;
    global.fetch = (async (url, init) => String(url).includes('/restaurant_menu_intelligence_profiles')
      ? new Response(JSON.stringify([{ menu_item_id: 'menu-padthai', profile: {
        safety: { allergens: { egg: 'does_not_contain' } },
      } }])) : inner(url, init)) as typeof fetch;
    const input = { guestDbId: guestId('verified-food-order'), channel: 'web', date: '2026-11-01', time: '12:00',
      items: [{ name: 'ผัดไทย', quantity: 1 }], customerName: 'Test', requirementTexts: ['ไม่ใส่ไข่'] };
    const first = await createRestaurantPreorder(input);
    const second = await createRestaurantPreorder(input);
    assert.equal(first.id, second.id);
    assert.equal(second.duplicate, true);
    const orders = h.postsTo('restaurant_preorders_rpc');
    assert.equal(orders.length, 1);
    assert.match(String(orders[0].p_customer_note), /ไม่ใส่ไข่/u, 'the model cannot omit a proven recipe request from the kitchen note');
  });
});

test('one corrected ingredient and a companion statement cannot clear another requirement', () => {
  const req = readFoodRequirements(['no_cow_milk', 'no_egg', 'กินไข่ได้แล้ว แต่ยังงดนม']);
  assert.ok(req.some(r => r.value === 'milk'));
  assert.ok(!req.some(r => r.value === 'egg'));
  assert.ok(!extractGuestPreferenceSignal('แฟนไม่ได้แพ้นม').removeConstraints.includes('milk_allergy'));
});

test('order item-name modifiers and invalid quantities cannot be silently discarded', async () => {
  await withHarness(async h => {
    const input = { guestDbId: guestId('qualified-order-name'), channel: 'web', date: '2026-11-01', time: '12:00',
      items: [{ name: 'ผัดไทย vegan', quantity: 1 }], customerName: 'Test' };
    await assert.rejects(createRestaurantPreorder(input), /food_requirements_conflict/u);
    for (const quantity of [0, -1, 1.5, 51, NaN]) {
      await assert.rejects(createRestaurantPreorder({ ...input, items: [{ name: 'ผัดไทย', quantity }] }), /invalid_preorder_quantity/u);
    }
    assert.equal(h.postsTo('restaurant_preorders_rpc').length, 0);
  });
});

test('Agent preparation checks the original message even when its note omits the condition', async () => {
  const { executeThongthaiTransactionTool } = await import('../netlify/functions/_thongthai-agent-transactions');
  await withHarness(async h => {
    const result = JSON.parse(await executeThongthaiTransactionTool('prepare_restaurant_preorder', {
      date: '2026-11-01', time: '12:00', customer_name: 'Test', phone: '0812345678',
      items: [{ name: 'ผัดไทย', quantity: 1 }],
    }, { guestDbId: guestId('agent-food-condition'), channel: 'web', environment: 'test',
      eventId: 'agent-food-condition', message: 'ขอสั่งผัดไทย vegan 1 จาน', transactionMode: 'test' }));
    assert.equal(result.ok, false);
    assert.equal(result.requires_kitchen_confirmation, true);
    assert.equal(h.postsTo('restaurant_preorders_rpc').length, 0);
  });
});
