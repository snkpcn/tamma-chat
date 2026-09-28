import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';
import { brainRequest, guestId, withHarness } from './helpers/canonical-core-harness';
import { emptyConversationContextState } from '../netlify/functions/_conversation-context';

function text(payload: Record<string, unknown>): string {
  return String(payload.message ?? '');
}

function semantic(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    normalizedMeaning: 'open-world conversation turn',
    reply: 'รับทราบครับ',
    speechAct: 'statement',
    domain: 'general',
    intent: 'open_chat',
    action: 'provide_information',
    informationNeed: 'none',
    entities: {},
    references: [],
    constraints: [],
    confidence: 0.98,
    needsClarification: false,
    ...overrides,
  };
}

test('final human brain cutover: preference context gets model-owned natural reply, no booking task', async () => {
  await withHarness(async harness => {
    harness.programGeminiReply(semantic({
      normalizedMeaning: 'customer comes with partner, party size two, prefers low exertion, and is not booking',
      reply: 'ได้เลยครับ มา 2 คนกับแฟน แล้วอยากเอาแบบชิล ๆ ไม่เหนื่อยมาก ทองไทยจำบริบทนี้ไว้ก่อนนะครับ ยังไม่ทำรายการจองให้',
      speechAct: 'preference_update',
      domain: 'activity',
      intent: 'share_party_and_pace_without_booking',
      entities: { partySize: 2, companion: 'partner' },
      constraints: ['low_exertion', 'no_transaction'],
    }));

    const gid = guestId('final-human-brain-preference');
    const result = await processThongthaiChatCore(
      brainRequest('มากับแฟนสองคน ไม่อยากเหนื่อยมาก', gid, 'line'),
      'final-human-brain-pref-1',
    );

    const message = text(result.payload);
    assert.equal(result.statusCode, 200);
    assert.match(message, /แฟน|2 คน|สองคน/u);
    assert.match(message, /ชิล|ไม่เหนื่อย/u);
    assert.doesNotMatch(message, /กำลังช่วยจอง|ขอวัน|ขอเวลา|ตอบเรื่องนี้ให้แม่นไม่ได้/u);
    assert.equal(harness.postsTo('bookings').length, 0);
    const state = harness.getState(harness.guestDbId(gid) ?? '');
    assert.equal((state?.state.taskState as { activeTask?: unknown } | undefined)?.activeTask ?? null, null);
  });
});

test('final human brain cutover: consider-only horse selection reply is natural and remains non-transactional', async () => {
  await withHarness(async harness => {
    const gid = guestId('final-human-brain-consider');
    harness.programGeminiReply(semantic({
      normalizedMeaning: 'customer has partner and relaxed preference',
      reply: 'รับทราบครับ',
      speechAct: 'preference_update',
      domain: 'activity',
      intent: 'seed_context',
      entities: { companion: 'partner' },
      constraints: ['low_exertion'],
    }));
    await processThongthaiChatCore(
      brainRequest('มากับแฟน ขอแบบชิล ๆ', gid, 'line'),
      'final-human-brain-consider-seed',
    );
    const guestDbId = harness.guestDbId(gid);
    assert.ok(guestDbId);
    const existing = harness.getState(guestDbId)?.state ?? {};
    // A hardcoded absolute timestamp here is a ticking time bomb: conversation
    // context expires 2 hours after its own `now` (see CONTEXT_TTL_MS in
    // _conversation-context.ts), so a fixed literal silently starts failing
    // the instant the real wall clock passes that literal + 2h -- pruneExpired
    // then discards the whole injected context (recentEntities, activeDomain,
    // lastRecommendationReference all reset to empty) and the turn falls back
    // to an unresolved/untrusted-semantics path. Anchor to actual "now"
    // instead so the fixture never depends on when the suite happens to run.
    const seedNow = new Date();
    harness.setState(guestDbId, {
      ...existing,
      conversationContext: {
        ...emptyConversationContextState(seedNow),
        activeDomain: 'activity',
        activeTopic: 'horse_recommendation',
        recentEntities: [
          {
            id: 'activity_asset:horse-pharadon',
            type: 'horse',
            name: 'ภาราดร',
            domain: 'activity',
            source: 'catalog',
            canonical: true,
            observedAt: seedNow.toISOString(),
          },
        ],
        lastRecommendationReference: 'ภาราดรเหมาะกับมือใหม่และเป็นตัวที่คุยกันล่าสุด',
      },
    });

    harness.programGeminiReply(semantic({
      normalizedMeaning: 'customer is interested in the previously discussed horse but explicitly does not want to book yet',
      reply: 'โอเคครับ ทองไทยจำตัวที่คุยกันไว้เป็นตัวที่สนใจก่อน ยังไม่จองให้นะครับ',
      speechAct: 'selection',
      domain: 'activity',
      intent: 'consider_prior_horse_not_booking',
      action: 'confirm',
      entities: {},
      references: [{ type: 'previous_selection', value: 'ตัวนั้น', refersToPriorContext: true }],
      constraints: ['consider_only', 'not_booking', 'no_transaction'],
    }));

    const result = await processThongthaiChatCore(
      brainRequest('เอาตัวนั้นไว้ก่อนนะ แต่ยังไม่จอง', gid, 'line'),
      'final-human-brain-consider-1',
    );

    const message = text(result.payload);
    assert.equal(result.statusCode, 200);
    assert.match(message, /จำ|ไว้ก่อน|สนใจ/u);
    assert.match(message, /ยังไม่จอง|ไม่จอง/u);
    assert.doesNotMatch(message, /ตอบเรื่องนี้ให้แม่นไม่ได้|ขอรายละเอียดเพิ่ม/u);
    assert.equal(harness.postsTo('bookings').length, 0);
  });
});

test('final human brain cutover: food constraint update is acknowledged as conversation, not generic fallback or preorder', async () => {
  await withHarness(async harness => {
    const gid = guestId('final-human-brain-no-shrimp');
    harness.programGeminiReply(semantic({
      normalizedMeaning: 'customer says they do not eat shrimp',
      reply: 'รับทราบครับ ของคุณเลี่ยงกุ้งไว้ด้วยนะครับ เดี๋ยวถ้าคุยเรื่องอาหารต่อ ทองไทยจะช่วยดูเมนูให้เข้ากับข้อนี้',
      speechAct: 'preference_update',
      domain: 'restaurant',
      intent: 'add_no_shrimp_constraint',
      entities: {},
      constraints: ['no_shrimp'],
    }));

    const result = await processThongthaiChatCore(
      brainRequest('ส่วนผมไม่กินกุ้ง', gid, 'line'),
      'final-human-brain-food-1',
    );

    const message = text(result.payload);
    assert.equal(result.statusCode, 200);
    assert.match(message, /กุ้ง/u);
    assert.doesNotMatch(message, /ตอบเรื่องนี้ให้แม่นไม่ได้|ขอรายการอาหาร|ขอชื่อ/u);
    assert.equal(harness.postsTo('restaurant_preorders_rpc').length, 0);
  });
});

test('final human brain cutover: casual weather joke is social chat, never weather shortcut or generic fallback', async () => {
  await withHarness(async harness => {
    const gid = guestId('final-human-brain-casual-hot');
    harness.programGeminiReply(semantic({
      normalizedMeaning: 'customer casually jokes that today is very hot',
      reply: 'จริงครับ วันนี้ฟีลร้อนเอาเรื่องเลย 555 หาอะไรเย็น ๆ จิบก่อนค่อยคิดเรื่องเที่ยวต่อก็ได้ครับ',
      speechAct: 'social',
      domain: 'general',
      intent: 'casual_hot_weather_joke',
      action: 'ask',
      entities: {},
      constraints: [],
    }));

    const result = await processThongthaiChatCore(
      brainRequest('วันนี้อากาศร้อนชิบหาย 555', gid, 'line'),
      'final-human-brain-casual-1',
    );

    const message = text(result.payload);
    assert.equal(result.statusCode, 200);
    assert.match(message, /ร้อน|555|เย็น/u);
    assert.doesNotMatch(message, /โอกาสฝน|อุณหภูมิประมาณ|ตอบเรื่องนี้ให้แม่นไม่ได้/u);
    assert.equal(harness.modelCallCount(), 1);
  });
});
