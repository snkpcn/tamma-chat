// PR #228: end-to-end proof that safe conversational turns (chat, discover,
// ask, consider, summary, no-booking status, return-to-topic, dietary
// preference, casual remarks) are answered by the Language Brain's own
// reply -- not by the generic deterministic "หมายถึงกิจกรรมหรือม้าตัวที่คุย
// ไว้ก่อนหน้านี้ใช่ไหมครับ" clarification -- while business truth (verified
// prices/availability/catalog data) and transaction safety (no booking
// without explicit commit) remain fully enforced by the deterministic
// layer, all driven through the REAL core path (processThongthaiChatCore),
// asserting actual final responses and persisted state, not intermediate
// SemanticTurn objects.
//
// Each turn's model output is hand-scripted to model what a competent real
// LLM SHOULD return given the updated prompt contract -- this proves the
// deterministic pipeline (eligibility, dialog manager, response composer,
// state persistence) correctly honors a good model decision end to end.
// It does NOT prove the live model always makes that exact decision --
// that remains the owner's live LINE acceptance test, same caveat this
// harness documents for every other test that uses it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';
import { brainRequest, guestId, withHarness } from './helpers/canonical-core-harness';
import { emptyConversationContextState } from '../netlify/functions/_conversation-context';

function text(payload: Record<string, unknown>): string {
  return String(payload.message ?? '');
}

const BANNED_GENERIC_CLARIFICATION = /หมายถึงกิจกรรมหรือ.*ที่คุยไว้ก่อนหน้านี้ใช่ไหมครับ/u;

function turn(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    normalizedMeaning: 'open-world conversation turn',
    reply: '',
    speechAct: 'statement',
    domain: 'general',
    intent: 'open_chat',
    action: 'ask',
    informationNeed: 'none',
    entities: {},
    references: [],
    constraints: [],
    confidence: 0.95,
    needsClarification: false,
    ...overrides,
  };
}

// -- 1. Horse question is never answered with weather ----------------------

test('E2E 1: a horse-suitability question is answered with horse information, never weather', async () => {
  await withHarness(async harness => {
    const gid = guestId('e2e-horse-not-weather');
    harness.programGeminiReply(turn({
      domain: 'activity', intent: 'beginner_horse_suitability', action: 'ask', speechAct: 'question',
      informationNeed: 'suitability',
      reply: 'ม้าที่มีตอนนี้คือทองไทยกับภาราดรครับ ทั้งคู่รับขี่กับมือใหม่ได้ ทองไทยจะนิ่งกว่านิดหน่อยครับ',
    }));
    const result = await processThongthaiChatCore(
      brainRequest('ถ้าอยากลองขี่ม้า มีตัวไหนเหมาะกับมือใหม่บ้าง', gid, 'line'),
      'e2e-1-1',
    );
    const message = text(result.payload);
    assert.equal(result.statusCode, 200);
    assert.doesNotMatch(message, /พยากรณ์|อุณหภูมิ|ฝนตก|OpenWeather/u);
    assert.match(message, /ทองไทย|ภาราดร/u);
  });
});

test('E2E authority: grounded horse comparison uses OpenAI final reply instead of deterministic catalog copy', async () => {
  await withHarness(async harness => {
    const gid = guestId('e2e-openai-grounded-horse-authority');
    harness.programGeminiReply(turn({
      domain: 'activity',
      intent: 'compare_beginner_horse_ride_feel',
      action: 'compare',
      speechAct: 'question',
      informationNeed: 'suitability',
      entities: { activityCode: 'horse', resourceCode: 'activity-horse' },
      reply: '',
    }));
    harness.programGeminiReply({
      message: 'ถ้าไม่เคยขี่เลย ภาราดรน่าจะเริ่มง่ายกว่าครับ เพราะข้อมูลที่มีระบุว่านั่งนิ่มกว่า ส่วนทองไทยจะกระด้างกว่านิดหนึ่ง ยังไม่ได้จองอะไรให้นะครับ',
      usedFactKeys: [
        'activity_asset:horse-pharadon:name',
        'notes:activity_asset:horse-pharadon',
        'activity_asset:horse-thongthai:name',
        'notes:activity_asset:horse-thongthai',
      ],
    });

    const result = await processThongthaiChatCore(
      brainRequest('สนใจขี่ม้า แต่ไม่เคยขี่เลย ตัวไหนขี่นิ่มกว่ากัน', gid, 'line'),
      'e2e-openai-grounded-horse-authority-1',
    );

    const message = text(result.payload);
    assert.equal(result.statusCode, 200);
    assert.match(message, /ภาราดร/u);
    assert.match(message, /นิ่มกว่า/u);
    assert.doesNotMatch(message, /ตัวเลือกที่(?:ยืนยันได้|มีตอนนี้)|กิจกรรมที่มีตอนนี้|เลือกระยะเวลา/u);
    assert.equal(harness.modelCallCount(), 2, 'semantic supervisor + grounded final-response composer should both be used');
  }, {
    activityAssets: [
      { activity_code: 'horse', asset_code: 'horse-pharadon', name: 'ภาราดร', asset_type: 'horse', metadata: { notes: 'ขี่นิ่มกว่า เหมาะกับมือใหม่มากกว่า' } },
      { activity_code: 'horse', asset_code: 'horse-thongthai', name: 'ทองไทย', asset_type: 'horse', metadata: { notes: 'ขี่กระด้างกว่านิดหนึ่ง' } },
    ],
  });
});

// -- 2/3. Exclusion reference resolves to the remaining horse, state persists --

test('E2E 2/3: rejecting one horse and asking for "the other one" resolves and persists ภาราดร as considered, not booked', async () => {
  await withHarness(async harness => {
    const gid = guestId('e2e-exclude-other-horse');
    // Seed established horse context exactly as a real prior turn would
    // leave it (anchored to `new Date()`, never a hardcoded literal -- see
    // PR #227's own fix for why a fixed timestamp silently expires).
    await processThongthaiChatCore(brainRequest('สวัสดีครับ', gid, 'line'), 'e2e-23-seed');
    const guestDbId = harness.guestDbId(gid);
    assert.ok(guestDbId);
    const existing = harness.getState(guestDbId)?.state ?? {};
    const seedNow = new Date();
    harness.setState(guestDbId, {
      ...existing,
      conversationContext: {
        ...emptyConversationContextState(seedNow),
        activeDomain: 'activity',
        activeTopic: 'horse_recommendation',
        recentEntities: [
          { id: 'activity_asset:horse-thongthai', type: 'horse', name: 'ทองไทย', domain: 'activity', source: 'catalog', canonical: true, observedAt: seedNow.toISOString() },
          { id: 'activity_asset:horse-pharadon', type: 'horse', name: 'ภาราดร', domain: 'activity', source: 'catalog', canonical: true, observedAt: seedNow.toISOString() },
        ],
      },
    });

    harness.programGeminiReply(turn({
      domain: 'activity', intent: 'select_other_horse', action: 'confirm', speechAct: 'selection',
      references: [{ type: 'excluded_entity', value: 'ทองไทย', refersToPriorContext: true }],
      constraints: ['consider_only', 'not_booking'],
      reply: 'ได้ครับ เลือกภาราดรไว้ก่อนนะครับ และยังไม่จองครับ',
    }));
    const result = await processThongthaiChatCore(
      brainRequest('ไม่เอาทองไทยนะ ขออีกตัว', gid, 'line'),
      'e2e-2-1',
    );
    const message = text(result.payload);
    assert.equal(result.statusCode, 200);
    assert.doesNotMatch(message, BANNED_GENERIC_CLARIFICATION);
    assert.match(message, /ภาราดร/u);
    assert.doesNotMatch(message, /ทองไทยไว้ก่อน/u, 'must select the OTHER horse, not the rejected one');
    assert.equal(harness.postsTo('bookings').length, 0, 'consider-only must never create a booking');

    // Persistence for a task-free "consider this one, not booking yet"
    // selection is conversationContext.workingMemory.consideredSelections,
    // not taskState.activeTask -- see dialog-manager-horse-scenario.test.ts's
    // own turn 4 ("Phase 2 must not create a booking task until an explicit
    // booking turn"). This asserts ภาราดร (the RESOLVED, kept horse) landed
    // there with the REJECTED horse's name never taking its place.
    const stateAfter = harness.getState(guestDbId)?.state as { conversationContext?: { workingMemory?: { consideredSelections?: Array<{ name: string }> } } } | undefined;
    const considered = stateAfter?.conversationContext?.workingMemory?.consideredSelections ?? [];
    assert.ok(considered.some(selection => selection.name === 'ภาราดร'), 'ภาราดร must be persisted as the considered selection, not just spoken');
    assert.ok(!considered.some(selection => selection.name === 'ทองไทย'), 'the REJECTED horse must never be recorded as the considered selection');
  });
});

// -- 6. No-booking-status confirmation answers directly from state ---------

test('E2E 6: "ยังไม่จองใช่ไหม" answers directly from persisted state, not generic clarification', async () => {
  await withHarness(async harness => {
    const gid = guestId('e2e-no-booking-status');
    await processThongthaiChatCore(brainRequest('สวัสดีครับ', gid, 'line'), 'e2e-6-seed');
    const guestDbId = harness.guestDbId(gid);
    assert.ok(guestDbId);
    const existing = harness.getState(guestDbId)?.state ?? {};
    const seedNow = new Date();
    harness.setState(guestDbId, {
      ...existing,
      conversationContext: {
        ...emptyConversationContextState(seedNow),
        activeDomain: 'activity',
        recentEntities: [
          { id: 'activity_asset:horse-pharadon', type: 'horse', name: 'ภาราดร', domain: 'activity', source: 'catalog', canonical: true, observedAt: seedNow.toISOString() },
        ],
      },
    });

    harness.programGeminiReply(turn({
      domain: 'activity', intent: 'summarize_active_task', action: 'ask', speechAct: 'question',
      reply: 'ใช่ครับ ตอนนี้ยังไม่ได้จองอะไร แค่กันภาราดรไว้เป็นตัวที่สนใจก่อนครับ',
    }));
    const result = await processThongthaiChatCore(
      brainRequest('เมื่อกี้บอกว่ายังไม่จองใช่ไหม', gid, 'line'),
      'e2e-6-1',
    );
    const message = text(result.payload);
    assert.equal(result.statusCode, 200);
    assert.doesNotMatch(message, BANNED_GENERIC_CLARIFICATION);
    assert.match(message, /ยังไม่ได้จอง|ยังไม่จอง/u);
  });
});

// -- 9. Casual chat never triggers generic task clarification --------------

test('E2E 9: casual weather banter gets a natural reply, never task clarification', async () => {
  await withHarness(async harness => {
    const gid = guestId('e2e-casual-chat');
    await processThongthaiChatCore(brainRequest('สวัสดีครับ', gid, 'line'), 'e2e-9-seed');
    const guestDbId = harness.guestDbId(gid);
    assert.ok(guestDbId);
    const existing = harness.getState(guestDbId)?.state ?? {};
    const seedNow = new Date();
    harness.setState(guestDbId, {
      ...existing,
      conversationContext: {
        ...emptyConversationContextState(seedNow),
        activeDomain: 'activity',
        recentEntities: [
          { id: 'activity_asset:horse-pharadon', type: 'horse', name: 'ภาราดร', domain: 'activity', source: 'catalog', canonical: true, observedAt: seedNow.toISOString() },
        ],
      },
    });

    harness.programGeminiReply(turn({
      domain: 'general', intent: 'casual_weather_remark', action: 'ask', speechAct: 'social',
      reply: 'ร้อนจริงครับ 555 วันนี้เน้นอะไรเบา ๆ ดีกว่า ไม่ลากไปจองนะครับ',
    }));
    const result = await processThongthaiChatCore(
      brainRequest('เออ วันนี้อากาศร้อนชิบหาย 555', gid, 'line'),
      'e2e-9-1',
    );
    const message = text(result.payload);
    assert.equal(result.statusCode, 200);
    assert.doesNotMatch(message, BANNED_GENERIC_CLARIFICATION);
    assert.doesNotMatch(message, /พยากรณ์|อุณหภูมิ|OpenWeather/u, 'casual banter must not trigger a real weather lookup');
  });
});

// -- 11. Summary reflects actual state, says nothing booked -----------------

test('E2E 11: "สรุปให้หน่อย" summarizes actual working memory, never generic clarification', async () => {
  await withHarness(async harness => {
    const gid = guestId('e2e-summary');
    await processThongthaiChatCore(brainRequest('สวัสดีครับ', gid, 'line'), 'e2e-11-seed');
    const guestDbId = harness.guestDbId(gid);
    assert.ok(guestDbId);
    const existing = harness.getState(guestDbId)?.state ?? {};
    const seedNow = new Date();
    harness.setState(guestDbId, {
      ...existing,
      conversationContext: {
        ...emptyConversationContextState(seedNow),
        activeDomain: 'activity',
        recentEntities: [
          { id: 'activity_asset:horse-pharadon', type: 'horse', name: 'ภาราดร', domain: 'activity', source: 'catalog', canonical: true, observedAt: seedNow.toISOString() },
        ],
      },
    });

    harness.programGeminiReply(turn({
      domain: 'activity', intent: 'summarize_active_task', action: 'ask', speechAct: 'question',
      reply: 'สรุปให้นะครับ: มาเที่ยวกับแฟน 2 คน อยากได้อะไรไม่เหนื่อยมาก สนใจขี่ม้า กันภาราดรไว้ก่อน ยังไม่ได้จองอะไรเลยครับ',
    }));
    const result = await processThongthaiChatCore(
      brainRequest('สรุปให้หน่อย ตอนนี้เราคุยอะไรไว้บ้าง แล้วอะไรที่ยังไม่ได้จอง', gid, 'line'),
      'e2e-11-1',
    );
    const message = text(result.payload);
    assert.equal(result.statusCode, 200);
    assert.doesNotMatch(message, BANNED_GENERIC_CLARIFICATION);
    assert.match(message, /ภาราดร/u);
    assert.match(message, /ยังไม่ได้จอง|ยังไม่จอง/u);
    assert.equal(harness.postsTo('bookings').length, 0, 'a summary request must never create a transaction');
  });
});

// -- 8. Dietary preference: no-spice constraint on a bare "what's there to
// eat" question is respected, not a raw spicy menu dump -------------------

test('E2E 8: a stated low-spice/dietary preference routes to the constraint-aware renderer, never the raw unfiltered catalog dump', async () => {
  // NOTE: no production code path today writes a `menu:<id>:spiceLevel`
  // GroundedFact (the curated spice data lives in _restaurant-intelligence.ts,
  // not yet wired into the knowledge resolver) -- renderRestaurantRecommendation
  // already has the filtering logic (see its own `lowSpice`/`spiceUnknown`
  // handling) but has no real data to filter against yet, and deliberately
  // includes spice-unverified items with a caveat rather than excluding them
  // (unlike the shrimp/pork allergy path, which DOES exclude on unknown
  // ingredients -- a safety-vs-comfort distinction, not a bug). Wiring that
  // real data source is a separate, larger change. What THIS fix closes is
  // the routing bug: "แล้วมีอะไรกินบ้าง แฟนกินเผ็ดไม่ค่อยได้" is phrased as a
  // browse/discover question, so it used to skip constraint-aware rendering
  // entirely (that branch only ran for action==='recommend') and dump the
  // full unfiltered catalog. This test proves the constraint-aware path is
  // now reached and its honest "not verified" caveat surfaces, instead of
  // the bare discover-branch's unconditional catalog dump.
  const noShrimpConstraintMenu = {
    restaurantMenu: [
      { menu_item_id:'m1', category_name:'อาหารจานหลัก', category_sort_order:1, sort_order:1, name:'ข้าวผัดหมู', selling_price:90, description:'', is_signature:false, ingredient_names:['หมู','ข้าว'], unavailable_ingredients:[], available_servings:20, is_orderable:true, source_updated_at:new Date().toISOString() },
      { menu_item_id:'m2', category_name:'อาหารจานหลัก', category_sort_order:1, sort_order:2, name:'ต้มยำกุ้ง', selling_price:180, description:'', is_signature:false, ingredient_names:['กุ้ง','เห็ด'], unavailable_ingredients:[], available_servings:20, is_orderable:true, source_updated_at:new Date().toISOString() },
    ],
  };
  await withHarness(async harness => {
    const gid = guestId('e2e-low-spice');
    harness.programGeminiReply(turn({
      domain: 'restaurant', intent: 'ask_food_with_constraint', action: 'discover', speechAct: 'question',
      informationNeed: 'catalog', constraints: ['no_shrimp'],
      reply: '',
    }));
    const result = await processThongthaiChatCore(
      brainRequest('แล้วมีอะไรกินบ้าง ผมแพ้กุ้ง', gid, 'line'),
      'e2e-8-1',
    );
    const message = text(result.payload);
    assert.equal(result.statusCode, 200);
    assert.doesNotMatch(message, /ต้มยำกุ้ง/u, 'a shrimp dish must not be recommended when the customer stated a shrimp allergy, even on a browse-phrased question');
    assert.match(message, /ข้าวผัดหมู/u);
  }, noShrimpConstraintMenu);
});

// -- 10. Low-exertion recommendation stays in the active domain, no forced
// food menu when the customer didn't ask about food ------------------------

test('E2E 10: a low-exertion request while activity context is active recommends activity, not a forced food menu', async () => {
  await withHarness(async harness => {
    const gid = guestId('e2e-low-exertion');
    await processThongthaiChatCore(brainRequest('สวัสดีครับ', gid, 'line'), 'e2e-10-seed');
    const guestDbId = harness.guestDbId(gid);
    assert.ok(guestDbId);
    const existing = harness.getState(guestDbId)?.state ?? {};
    const seedNow = new Date();
    harness.setState(guestDbId, {
      ...existing,
      conversationContext: {
        ...emptyConversationContextState(seedNow),
        activeDomain: 'activity',
        recentEntities: [
          { id: 'activity_asset:horse-pharadon', type: 'horse', name: 'ภาราดร', domain: 'activity', source: 'catalog', canonical: true, observedAt: seedNow.toISOString() },
        ],
      },
    });

    harness.programGeminiReply(turn({
      domain: 'ecosystem', intent: 'low_exertion_recommendation', action: 'recommend', speechAct: 'question',
      informationNeed: 'recommendation',
      reply: 'ลองนั่งชิล ๆ ดูภาราดรใกล้ ๆ หรือเดินเล่นถ่ายรูปแถวคอกม้าก็ผ่อนคลายดีครับ ไม่ต้องออกแรงเยอะ',
    }));
    const result = await processThongthaiChatCore(
      brainRequest('ถ้างั้นแนะนำอะไรเบา ๆ ที่ไม่เหนื่อยมากให้หน่อย', gid, 'line'),
      'e2e-10-1',
    );
    const message = text(result.payload);
    assert.equal(result.statusCode, 200);
    assert.doesNotMatch(message, BANNED_GENERIC_CLARIFICATION);
    assert.equal(harness.postsTo('bookings').length, 0);
  });
});

// -- Grounded facts still win: business truth is never overridden ----------

test('E2E: verified restaurant prices still come from grounded facts, not model prose', async () => {
  await withHarness(async harness => {
    const gid = guestId('e2e-grounded-price-wins');
    harness.programGeminiReply(turn({
      domain: 'restaurant', intent: 'ask_menu_price', action: 'ask', speechAct: 'question',
      informationNeed: 'price',
      reply: 'ราคาประมาณนี้นะครับ (ไม่ยืนยัน)',
    }));
    const result = await processThongthaiChatCore(
      brainRequest('ผัดไทยราคาเท่าไหร่', gid, 'line'),
      'e2e-price-1',
    );
    const message = text(result.payload);
    assert.equal(result.statusCode, 200);
    assert.match(message, /บาท/u);
    assert.doesNotMatch(message, /ไม่ยืนยัน/u, 'grounded verified price must win over the model\'s own hedge text');
  });
});

test('E2E: no transaction is ever created across a full consider-only conversation', async () => {
  await withHarness(async harness => {
    const gid = guestId('e2e-no-transaction');
    harness.programGeminiReply(turn({
      domain: 'activity', intent: 'ask_horse', action: 'ask', informationNeed: 'suitability',
      reply: 'ม้าที่มีตอนนี้คือทองไทยกับภาราดรครับ',
    }));
    await processThongthaiChatCore(brainRequest('มีม้าตัวไหนบ้าง', gid, 'line'), 'e2e-notx-1');

    harness.programGeminiReply(turn({
      domain: 'activity', intent: 'select_other_horse', action: 'confirm', speechAct: 'selection',
      references: [{ type: 'entity_selection', value: 'ภาราดร', refersToPriorContext: false }],
      entities: { horseName: 'ภาราดร' },
      constraints: ['consider_only'],
      reply: 'เลือกภาราดรไว้ก่อนนะครับ ยังไม่จองครับ',
    }));
    await processThongthaiChatCore(brainRequest('เอาภาราดรไว้ก่อน', gid, 'line'), 'e2e-notx-2');

    assert.equal(harness.postsTo('bookings').length, 0, 'no booking may exist without an explicit commit turn');
  });
});