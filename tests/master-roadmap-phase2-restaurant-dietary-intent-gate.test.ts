// MASTER ROADMAP PHASE 2 -- RESTAURANT DIETARY CONSTRAINT INTENT GATE
// (final focus fix, 2026-09-24).
//
// Owner's instruction this round: fix this ONE production bug
// completely -- "a dietary constraint update must not trigger a menu
// recommendation" -- through a single, continuous, full conversation
// (not isolated turns), with a hard, explicit intent gate:
// classifyRestaurantDietaryIntent(text), returning exactly one of
// CONSTRAINT_ONLY / RECOMMENDATION_ONLY / CONSTRAINT_AND_RECOMMENDATION
// / OTHER. See thongthai-chat.ts's own definition and comment.
//
// This round also closed a genuinely new gap the owner's own retest
// surfaced: _restaurant-intelligence.ts's isHardExcluded only hard-
// excluded a spicy item when someone had manually curated its
// spiceLevel >= 3 -- a ส้มตำ/ยำ/ลาบ dish with NO curated profile at all
// (the common case) slipped through even with no_spicy active. Fixed
// with a name/category-based safety net (isUnverifiedSpicyRiskItem),
// same conservative principle as the existing allergy safety net.
//
// Also fixed: a correction ("จริง ๆ กินไก่ได้") was classified as OTHER
// (matched neither the constraint-mention marker nor the recommend
// marker) and fell through to a full menu dump; and the correction's
// own acknowledgment wording was contaminated by the still-present
// original restriction text in the rolling recentMessages window.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { withHarness, type Harness } from './helpers/canonical-core-harness';
import { handler as lineWebhookHandler } from '../netlify/functions/line-webhook';
import { classifyRestaurantDietaryIntent } from '../netlify/functions/thongthai-chat';

const CHANNEL_SECRET = 'test-phase2-restaurant-dietary-gate-secret';

type CapturedReply = { replyToken: string; messages: Array<{ type: string; text?: string }> };

function installLineReplyCapture(): { restore: () => void; replies: CapturedReply[] } {
  const original = global.fetch;
  const replies: CapturedReply[] = [];
  global.fetch = (async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    if (href.includes('api.line.me/v2/bot/message/reply')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as CapturedReply;
      replies.push(body);
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return original(url as never, init);
  }) as typeof fetch;
  return { restore: () => { global.fetch = original; }, replies };
}

async function callLineWebhook(events: unknown[]) {
  const body = JSON.stringify({ destination: 'test-destination', events });
  const signature = createHmac('sha256', CHANNEL_SECRET).update(body, 'utf8').digest('base64');
  return lineWebhookHandler(
    { httpMethod: 'POST', headers: { 'x-line-signature': signature }, body } as never,
    {} as never,
  );
}

function privateEvent(text: string, userId: string) {
  return {
    type: 'message',
    replyToken: `reply-${userId}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    source: { type: 'user', userId },
    message: { id: `msg-${userId}-${Math.random().toString(36).slice(2, 8)}`, type: 'text', text },
  };
}

function lineGuestId(userId: string): string {
  const hex = createHash('sha256').update('tamma-line:' + userId, 'utf8').digest('hex').slice(0, 32).split('');
  hex[12] = '5';
  const variant = parseInt(hex[16], 16);
  hex[16] = ((variant & 0x3) | 0x8).toString(16);
  const value = hex.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`;
}

function constraintsOf(harness: Harness, userId: string): string[] {
  const guestDbId = harness.guestDbId(lineGuestId(userId));
  if (!guestDbId) return [];
  const value = harness.getGuestMemory(guestDbId, 'constraints');
  return Array.isArray(value) ? value as string[] : [];
}

async function withLineSecret<T>(run: () => Promise<T>): Promise<T> {
  const original = process.env.LINE_CHANNEL_SECRET;
  process.env.LINE_CHANNEL_SECRET = CHANNEL_SECRET;
  try {
    return await run();
  } finally {
    if (original === undefined) delete process.env.LINE_CHANNEL_SECRET;
    else process.env.LINE_CHANNEL_SECRET = original;
  }
}

async function withHarnessAndLine<T>(run: (harness: Harness, replies: CapturedReply[]) => Promise<T>): Promise<T> {
  return withHarness(harness => withLineSecret(async () => {
    const capture = installLineReplyCapture();
    try {
      return await run(harness, capture.replies);
    } finally {
      capture.restore();
    }
  }));
}

function text(replies: CapturedReply[], index: number): string {
  return replies[index]?.messages.map(m => m.text ?? '').join(' ') ?? '';
}

function itemLinesOf(message: string): string[] {
  return message.split('\n').filter(line => /^•/.test(line.trim()));
}

// ---------------------------------------------------------------------
// classifyRestaurantDietaryIntent -- direct unit coverage of the gate.
// ---------------------------------------------------------------------

test('classifyRestaurantDietaryIntent returns exactly the right bucket for each example', () => {
  assert.equal(classifyRestaurantDietaryIntent('กินไม่เผ็ด แพ้กุ้ง'), 'CONSTRAINT_ONLY');
  assert.equal(classifyRestaurantDietaryIntent('ไม่กินไก่'), 'CONSTRAINT_ONLY');
  assert.equal(classifyRestaurantDietaryIntent('ไม่กินหมู'), 'CONSTRAINT_ONLY');
  assert.equal(classifyRestaurantDietaryIntent('ไม่กินเนื้อ'), 'CONSTRAINT_ONLY');
  assert.equal(classifyRestaurantDietaryIntent('ขอไม่ใส่พริก'), 'CONSTRAINT_ONLY');
  assert.equal(classifyRestaurantDietaryIntent('เด็กกินเผ็ดไม่ได้'), 'CONSTRAINT_ONLY');
  assert.equal(classifyRestaurantDietaryIntent('มีอะไรแนะนำ'), 'RECOMMENDATION_ONLY');
  assert.equal(classifyRestaurantDietaryIntent('ร้านอาหารมีอะไรแนะนำ'), 'RECOMMENDATION_ONLY');
  assert.equal(classifyRestaurantDietaryIntent('มีอะไรแนะนำอีก'), 'RECOMMENDATION_ONLY');
  assert.equal(classifyRestaurantDietaryIntent('กินอะไรดี'), 'RECOMMENDATION_ONLY');
  assert.equal(classifyRestaurantDietaryIntent('ขอเมนู'), 'RECOMMENDATION_ONLY');
  assert.equal(classifyRestaurantDietaryIntent('กินไม่เผ็ด แพ้กุ้ง มีอะไรแนะนำ'), 'CONSTRAINT_AND_RECOMMENDATION');
  assert.equal(classifyRestaurantDietaryIntent('ไม่กินไก่ มีอะไรแนะนำ'), 'CONSTRAINT_AND_RECOMMENDATION');
  assert.equal(classifyRestaurantDietaryIntent('ขอเมนูที่ไม่มีกุ้ง'), 'CONSTRAINT_AND_RECOMMENDATION');
  assert.equal(classifyRestaurantDietaryIntent('จริง ๆ กินไก่ได้'), 'CONSTRAINT_ONLY');
  assert.equal(classifyRestaurantDietaryIntent('สวัสดีครับ'), 'OTHER');
});

// ---------------------------------------------------------------------
// The full 7-turn continuous conversation the owner's task requires.
// ---------------------------------------------------------------------

test('full continuous sequence: constraint declarations never recommend, recommendations always filter cumulative constraints', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    const userId = 'phase2-gate-seq';

    // Turn 1: CONSTRAINT_ONLY.
    await callLineWebhook([privateEvent('กินไม่เผ็ด แพ้กุ้ง', userId)]);
    const t1 = text(replies, 0);
    assert.equal(itemLinesOf(t1).length, 0, 'turn 1 must not list any menu item');
    assert.doesNotMatch(t1, /บาท/u, 'turn 1 must not show prices');
    assert.doesNotMatch(t1, /มากี่คนครับ/u, 'turn 1 must not ask party size');
    const afterTurn1 = constraintsOf(harness, userId);
    assert.ok(afterTurn1.includes('no_spicy'));
    assert.ok(afterTurn1.includes('shrimp_allergy'));

    // Turn 2: RECOMMENDATION_ONLY.
    await callLineWebhook([privateEvent('ร้านอาหารมีอะไรแนะนำ', userId)]);
    const t2 = text(replies, 1);
    const t2Items = itemLinesOf(t2);
    assert.ok(t2Items.length >= 1 && t2Items.length <= 3);
    for (const line of t2Items) assert.doesNotMatch(line, /กุ้ง/u);

    // Turn 3: CONSTRAINT_ONLY -- the exact production bug (a constraint
    // update sent after a recommendation must NOT dump a menu again).
    await callLineWebhook([privateEvent('ไม่กินไก่', userId)]);
    const t3 = text(replies, 2);
    assert.equal(itemLinesOf(t3).length, 0, 'turn 3 must not list any menu item');
    assert.doesNotMatch(t3, /บาท/u, 'turn 3 must not show prices');
    assert.doesNotMatch(t3, /แจ้งพนักงาน|ปนเปื้อน/u, 'turn 3 must not repeat the full allergy caution block');
    const afterTurn3 = constraintsOf(harness, userId);
    assert.ok(afterTurn3.includes('no_chicken'), 'no_chicken must be stored');
    assert.ok(afterTurn3.includes('no_spicy') && afterTurn3.includes('shrimp_allergy'), 'earlier constraints must remain (cumulative)');

    // Turn 4: RECOMMENDATION_ONLY -- must use ALL three cumulative
    // constraints together.
    await callLineWebhook([privateEvent('มีอะไรแนะนำอีก', userId)]);
    const t4 = text(replies, 3);
    const t4Items = itemLinesOf(t4);
    assert.ok(t4Items.length <= 3);
    for (const line of t4Items) {
      assert.doesNotMatch(line, /กุ้ง/u);
      assert.doesNotMatch(line, /ไก่/u);
    }

    // Turn 5: CONSTRAINT_AND_RECOMMENDATION.
    await callLineWebhook([privateEvent('กินไม่เผ็ด แพ้กุ้ง มีอะไรแนะนำ', 'phase2-gate-seq-5')]);
    const t5 = text(replies, 4);
    const t5Items = itemLinesOf(t5);
    assert.ok(t5Items.length >= 1 && t5Items.length <= 3);
    for (const line of t5Items) assert.doesNotMatch(line, /กุ้ง/u);

    // Turn 6: CONSTRAINT_AND_RECOMMENDATION, chicken variant.
    await callLineWebhook([privateEvent('ไม่กินไก่ มีอะไรแนะนำ', 'phase2-gate-seq-6')]);
    const t6 = text(replies, 5);
    const t6Items = itemLinesOf(t6);
    assert.ok(t6Items.length >= 1 && t6Items.length <= 3);
    for (const line of t6Items) assert.doesNotMatch(line, /ไก่/u);

    // Turn 7: correction -- relaxes no_chicken, still no menu dump.
    await callLineWebhook([privateEvent('จริง ๆ กินไก่ได้', userId)]);
    const t7 = text(replies, 6);
    assert.equal(itemLinesOf(t7).length, 0, 'a correction must not dump a menu');
    assert.doesNotMatch(t7, /เลี่ยงไก่/u, 'the correction ack must not still say it will avoid chicken');
    assert.ok(!constraintsOf(harness, userId).includes('no_chicken'), 'no_chicken must be relaxed by the correction');
  });
});

// ---------------------------------------------------------------------
// Somtam/yam/laab spice-risk safety net (uncurated menu items).
// ---------------------------------------------------------------------

function menuItem(id: string, sortOrder: number, name: string, category: string, price: number, ingredients: string[]): Record<string, unknown> {
  return {
    menu_item_id: id, category_name: category, category_sort_order: 1, sort_order: sortOrder,
    name, selling_price: price, description: name, is_signature: false,
    ingredient_names: ingredients, unavailable_ingredients: [], available_servings: 20,
    is_orderable: true, source_updated_at: new Date().toISOString(),
  };
}

const SOMTAM_CATALOG = {
  restaurantMenu: [
    menuItem('menu-1', 1, 'ข้าวผัดหมู', 'อาหารจานหลัก', 90, ['หมู', 'ข้าว']),
    menuItem('menu-2', 2, 'ส้มตำไทย', 'ยำ-ตำ', 70, ['มะละกอ', 'พริก']),
    menuItem('menu-3', 3, 'ยำวุ้นเส้น', 'ยำ-ตำ', 80, ['วุ้นเส้น', 'พริก']),
    menuItem('menu-4', 4, 'ลาบหมู', 'ยำ-ตำ', 100, ['หมู', 'ข้าวคั่ว']),
  ],
};

test('no_spicy never recommends an uncurated ส้มตำ/ยำ/ลาบ item by default', async () => {
  await withHarness(harness => withLineSecret(async () => {
    const capture = installLineReplyCapture();
    try {
      await callLineWebhook([privateEvent('กินไม่เผ็ด', 'phase2-gate-somtam')]);
      await callLineWebhook([privateEvent('มีอะไรแนะนำ', 'phase2-gate-somtam')]);
      const t = text(capture.replies, 1);
      const items = itemLinesOf(t);
      assert.ok(items.length >= 1);
      for (const line of items) assert.doesNotMatch(line, /ส้มตำ|ยำวุ้นเส้น|ลาบ/u, 'a no_spicy guest must never be recommended an uncurated somtam/yam/laab item');
    } finally {
      capture.restore();
    }
  }), SOMTAM_CATALOG);
});

// ---------------------------------------------------------------------
// Regressions
// ---------------------------------------------------------------------

test('regression: mobility memory still works ("แม่เดินไกลไม่ได้" then bare "มีอะไรแนะนำ")', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    const userId = 'phase2-gate-mobility';
    await callLineWebhook([privateEvent('แม่เดินไกลไม่ได้', userId)]);
    await callLineWebhook([privateEvent('มีอะไรแนะนำ', userId)]);
    assert.match(text(replies, 1), /ถ้ามากับคุณแม่เหมือนเดิม/u);
  });
});

test('regression: "พื้นลื่นมาก ตอนเล่น ATV น่ากลัว" still routes activity + owner', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    harness.programOpsChannel('activity');
    harness.programOpsChannel('owner_general');
    await callLineWebhook([privateEvent('พื้นลื่นมาก ตอนเล่น ATV น่ากลัว', 'phase2-gate-safety')]);
    const t = text(replies, 0);
    assert.doesNotMatch(t, /เลือกระยะเวลา\s*30,?\s*60\s*หรือ\s*90\s*นาที/u);
    assert.match(t, /ส่งให้ทีมกิจกรรมและเจ้าของตรวจสอบแล้วครับ/u);
  });
});

test('regression: "ขอคืนเงินได้ไหม" still gets Phase 1 deterministic escalation', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    harness.programOpsChannel('owner_general');
    await callLineWebhook([privateEvent('ขอคืนเงินได้ไหม', 'phase2-gate-refund')]);
    assert.match(text(replies, 0), /เรื่องคืนเงิน\/เงื่อนไขการชำระ ทองไทยขอไม่ยืนยันแทนเจ้าของนะครับ/u);
  });
});
