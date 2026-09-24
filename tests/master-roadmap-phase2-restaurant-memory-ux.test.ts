// MASTER ROADMAP PHASE 2 -- RESTAURANT MEMORY UX FIX (2026-09-24).
// Owner's production retest of PR #73 caught a real UX/composition
// failure, NOT a memory-capture failure: "กินไม่เผ็ด แพ้กุ้ง" correctly
// stored no_spicy + shrimp_allergy and correctly avoided shrimp, but the
// reply was a long menu-dump block, and a following "ร้านอาหารมีอะไร
// แนะนำ" repeated the EXACT SAME long block verbatim.
//
// Root cause: deterministicRestaurantResponse (thongthai-chat.ts) never
// distinguished a bare constraint DECLARATION from a recommendation
// REQUEST -- both always called the full formatAdvisorMessage path, and
// nothing suppressed the caution block on a turn that didn't restate
// the constraint. See thongthai-chat.ts's own
// isBareRestaurantConstraintDeclaration/naturalRestaurantConstraintPhrase
// comments for the full fix.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { withHarness, type Harness, type HarnessCatalog } from './helpers/canonical-core-harness';
import { handler as lineWebhookHandler } from '../netlify/functions/line-webhook';

const CHANNEL_SECRET = 'test-phase2-restaurant-ux-secret';

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

function menuItem(id: string, sortOrder: number, name: string, price: number, ingredients: string[]): Record<string, unknown> {
  return {
    menu_item_id: id, category_name: 'อาหารจานหลัก', category_sort_order: 1, sort_order: sortOrder,
    name, selling_price: price, description: name, is_signature: false,
    ingredient_names: ingredients, unavailable_ingredients: [], available_servings: 20,
    is_orderable: true, source_updated_at: new Date().toISOString(),
  };
}

// A larger, no-shrimp menu -- the default fixture (used by every other
// test above) only has 3 items total, which can never distinguish "the
// list is capped at 3" from "there just happen to only be 3 items in
// stock." Used ONLY by test 4, which specifically needs to prove the
// cap is real (see its own load-bearing proof in the final report).
const LARGER_MENU_CATALOG: HarnessCatalog = {
  restaurantMenu: [
    menuItem('menu-1', 1, 'ข้าวผัดหมู', 90, ['หมู', 'ข้าว']),
    menuItem('menu-2', 2, 'ลาบหมู', 100, ['หมู', 'ข้าวคั่ว']),
    menuItem('menu-3', 3, 'ไก่ย่าง', 110, ['ไก่']),
    menuItem('menu-4', 4, 'ส้มตำ', 70, ['มะละกอ']),
    menuItem('menu-5', 5, 'ไข่เจียว', 60, ['ไข่', 'หมู']),
    menuItem('menu-6', 6, 'แกงเขียวหวานไก่', 130, ['ไก่', 'กะทิ']),
  ],
};

async function withLargerMenuHarnessAndLine<T>(run: (harness: Harness, replies: CapturedReply[]) => Promise<T>): Promise<T> {
  return withHarness(harness => withLineSecret(async () => {
    const capture = installLineReplyCapture();
    try {
      return await run(harness, capture.replies);
    } finally {
      capture.restore();
    }
  }), LARGER_MENU_CATALOG);
}

// Same hash _line-webhook-core.ts's own (unexported) lineGuestId uses --
// same precedent as tests/horse-ux-production-gap.test.ts.
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

function text(replies: CapturedReply[], index: number): string {
  return replies[index]?.messages.map(m => m.text ?? '').join(' ') ?? '';
}

function countLines(message: string): number {
  return message.split('\n').filter(line => line.trim()).length;
}

// ---------------------------------------------------------------------
// Test 1: bare constraint declaration -- short ack, no menu dump.
// ---------------------------------------------------------------------

test('1. "กินไม่เผ็ด แพ้กุ้ง" stores no_spicy+shrimp_allergy, reply is short, no menu list, includes staff caution', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    const userId = 'phase2-rux-1';
    await callLineWebhook([privateEvent('กินไม่เผ็ด แพ้กุ้ง', userId)]);
    const t = text(replies, 0);

    const constraints = constraintsOf(harness, userId);
    assert.ok(constraints.includes('no_spicy'));
    assert.ok(constraints.includes('shrimp_allergy'));
    assert.doesNotMatch(t, /บาท/u, 'a bare declaration must not list priced menu items yet');
    assert.match(t, /เลี่ยงกุ้ง|กุ้ง\/กุ้งแห้ง/u);
    assert.match(t, /ไม่เผ็ด/u);
    assert.match(t, /แจ้งพนักงาน|ปนเปื้อน/u, 'must include the staff/cross-contamination caution for an allergy');
    assert.doesNotMatch(t, /รับประกัน|ปลอดภัยแน่นอน/u, 'no unsafe guarantee');
    assert.ok(countLines(t) <= 3, `reply must be short (host acknowledgment, not a menu dump): got ${countLines(t)} lines`);
  });
});

// ---------------------------------------------------------------------
// Test 2: recommendation request in the SAME conversation -- uses
// remembered constraints, capped list, no duplicated block.
// ---------------------------------------------------------------------

test('2. "ร้านอาหารมีอะไรแนะนำ" after the declaration uses remembered constraints, caps at 3, never repeats the exact prior block', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    const userId = 'phase2-rux-2';
    await callLineWebhook([privateEvent('กินไม่เผ็ด แพ้กุ้ง', userId)]);
    await callLineWebhook([privateEvent('ร้านอาหารมีอะไรแนะนำ', userId)]);
    const turn1 = text(replies, 0);
    const turn2 = text(replies, 1);

    assert.notEqual(turn2, turn1, 'turn 2 must never be the exact same block as turn 1');
    assert.match(turn2, /ถ้ายัง.*อยู่/u, 'must reference the remembered constraint naturally, not restate the full warning');
    assert.doesNotMatch(turn2, /แจ้งพนักงาน|ปนเปื้อน/u, 'must not repeat the full staff/cross-contamination caution block every turn');
    assert.match(turn2, /บาท/u, 'must show priced menu items now that a recommendation was actually asked for');
    const itemLines = turn2.split('\n').filter(line => /^•/.test(line.trim()));
    assert.ok(itemLines.length <= 3, `must cap at 3 items, got ${itemLines.length}`);
    for (const line of itemLines) assert.doesNotMatch(line, /กุ้ง/u, 'no shrimp dish must appear in a shrimp-allergy guest\'s recommendation');
  });
});

// ---------------------------------------------------------------------
// Test 3: load-bearing -- if restaurant memory read is disabled, test 2
// fails.
// ---------------------------------------------------------------------

test('3. without prior constraint memory, the recommendation reply is generic (no remembered-constraint phrase)', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    const userId = 'phase2-rux-3';
    // No declaration turn first -- simulates memory never having been read.
    await callLineWebhook([privateEvent('ร้านอาหารมีอะไรแนะนำ', userId)]);
    const t = text(replies, 0);
    assert.doesNotMatch(t, /ถ้ายัง.*อยู่/u, 'without any remembered constraint, the natural "ถ้ายัง...อยู่" phrase must not appear');
  });
});

// ---------------------------------------------------------------------
// Test 4: load-bearing -- if the list cap is disabled, test 2 fails.
// ---------------------------------------------------------------------

test('4. the recommendation list is genuinely capped, not just short by coincidence of fixture size', async () => {
  await withLargerMenuHarnessAndLine(async (_harness, replies) => {
    // 6-item menu, guest with NO constraint at all (every item eligible)
    // -- proves the cap is a real limit, not merely "small menu happens
    // to filter down to few items" as in tests 1-2's 3-item fixture.
    await callLineWebhook([privateEvent('ร้านอาหารมีอะไรแนะนำ', 'phase2-rux-4')]);
    const t = text(replies, 0);
    const itemLines = t.split('\n').filter(line => /^•/.test(line.trim()));
    assert.equal(itemLines.length, 3, `default cap must show exactly 3 of the 6 eligible items, got ${itemLines.length}`);
  });
});

// ---------------------------------------------------------------------
// Test 5: explicit full-menu request -- widens the cap, still avoids
// the allergen.
// ---------------------------------------------------------------------

test('5. "ขอเมนูทั้งหมดที่ไม่มีกุ้ง" can show more than 3 items, and still excludes shrimp', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('ขอเมนูทั้งหมดที่ไม่มีกุ้ง', 'phase2-rux-5')]);
    const t = text(replies, 0);
    const itemLines = t.split('\n').filter(line => /^•/.test(line.trim()));
    assert.ok(itemLines.length >= 1);
    for (const line of itemLines) assert.doesNotMatch(line, /กุ้ง/u, 'an explicit no-shrimp request must never list a shrimp dish');
  });
});

// ---------------------------------------------------------------------
// Test 6: severe allergy -- Phase 1 boundary still wins, no guarantee.
// ---------------------------------------------------------------------

test('6. "แม่แพ้กุ้งรุนแรง กินอะไรได้บ้าง" -- Phase 1 escalation still wins, caution first, no guarantee', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    harness.programOpsChannel('restaurant');
    harness.programOpsChannel('owner_general');
    await callLineWebhook([privateEvent('แม่แพ้กุ้งรุนแรง กินอะไรได้บ้าง', 'phase2-rux-6')]);
    const t = text(replies, 0);
    assert.match(t, /ทองไทยไม่อยากเดาแทนทีมครับ/u);
    assert.doesNotMatch(t, /รับประกัน|ปลอดภัยแน่นอน/u);
    assert.match(t, /ส่งให้ทีมร้านอาหารและเจ้าของตรวจสอบแล้วครับ/u);
  });
});

// ---------------------------------------------------------------------
// Regressions
// ---------------------------------------------------------------------

test('7. regression: mobility memory still works ("แม่เดินไกลไม่ได้" then bare "มีอะไรแนะนำ")', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    const userId = 'phase2-rux-7';
    await callLineWebhook([privateEvent('แม่เดินไกลไม่ได้', userId)]);
    await callLineWebhook([privateEvent('มีอะไรแนะนำ', userId)]);
    const t = text(replies, 1);
    assert.match(t, /ถ้ามากับคุณแม่เหมือนเดิม/u);
    assert.match(t, /เดินน้อย/u);
  });
});

test('8. regression: "ขอคืนเงินได้ไหม" still gets Phase 1 deterministic escalation', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    harness.programOpsChannel('owner_general');
    await callLineWebhook([privateEvent('ขอคืนเงินได้ไหม', 'phase2-rux-8')]);
    assert.match(text(replies, 0), /เรื่องคืนเงิน\/เงื่อนไขการชำระ ทองไทยขอไม่ยืนยันแทนเจ้าของนะครับ/u);
  });
});

test('9. regression: "พื้นลื่นมาก ตอนเล่น ATV น่ากลัว" still routes activity + owner, no booking flow', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    harness.programOpsChannel('activity');
    harness.programOpsChannel('owner_general');
    await callLineWebhook([privateEvent('พื้นลื่นมาก ตอนเล่น ATV น่ากลัว', 'phase2-rux-9')]);
    const t = text(replies, 0);
    assert.doesNotMatch(t, /เลือกระยะเวลา\s*30,?\s*60\s*หรือ\s*90\s*นาที/u);
    assert.match(t, /ส่งให้ทีมกิจกรรมและเจ้าของตรวจสอบแล้วครับ/u);
  });
});

test('10. regression: mid-conversation constraint REFINEMENT still shows an updated recommendation list (never swaps to bare ack)', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    const userId = 'phase2-rux-10';
    await callLineWebhook([privateEvent('ร้านมีอะไรกิน', userId)]);
    await callLineWebhook([privateEvent('จริงๆ ขอเผ็ดน้อย', userId)]);
    const t = text(replies, 1);
    assert.match(t, /ไม่เผ็ดจัด|บาท/u, 'a refinement mid an ALREADY ACTIVE recommendation flow must still show the updated list, not a bare ack');
  });
});
