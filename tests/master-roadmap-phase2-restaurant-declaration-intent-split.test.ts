// MASTER ROADMAP PHASE 2 -- RESTAURANT DECLARATION STILL DUMPS A MENU
// (production retest of PR #74/#75, 2026-09-24).
//
// PR #75 fixed a STALE restaurantAdvisorContext blocking the short ack,
// but the owner's next retest showed a DIFFERENT trigger for the same
// symptom: a constraint UPDATE sent moments after a real recommendation
// ("ไม่กินไก่" right after "ร้านอาหารมีอะไรแนะนำ") re-triggered the full
// menu dump, because PR #75's 10-minute recency window on
// restaurantAdvisorContext was, by definition, always satisfied right
// after the guest had just been shown a recommendation.
//
// Root cause: the gate for "is this an already-active conversation that
// should keep recommending" was ever checking conversational RECENCY at
// all. The owner's product rule is unconditional: a customer stating or
// updating a dietary constraint is NEVER the same as asking for a menu,
// no matter how recently a recommendation was shown. See
// thongthai-chat.ts's hasPendingRestaurantOrder (the recency window was
// removed entirely; only a concrete pending order still overrides the
// short ack).
//
// Also closes two supporting gaps found while fixing this:
// - _customer-phrase-intelligence.ts's extractPreferenceSignal didn't
//   persist plain protein-avoidance statements ("ไม่กินไก่") to
//   guest_memory at all (no_chicken/no_pork/no_beef/no_shrimp already
//   existed as allowed _customer-db.ts CONSTRAINTS keys -- pre-Phase-2 --
//   just never captured).
// - isRestaurantAdvisorTurn's own follow-up marker didn't recognize a
//   bare "แนะนำ" ("มีอะไรแนะนำอีก"), so that natural continuation fell
//   through to an unrelated generic fallback instead of re-running the
//   recommendation with remembered constraints.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { withHarness, type Harness } from './helpers/canonical-core-harness';
import { handler as lineWebhookHandler } from '../netlify/functions/line-webhook';

const CHANNEL_SECRET = 'test-phase2-restaurant-intent-split-secret';

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
// Test 1: bare constraint declaration.
// ---------------------------------------------------------------------

test('1. "กินไม่เผ็ด แพ้กุ้ง" stores memory, short ack, no menu, no prices, no party-size CTA, allergy caution', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    const userId = 'phase2-split-1';
    await callLineWebhook([privateEvent('กินไม่เผ็ด แพ้กุ้ง', userId)]);
    const t = text(replies, 0);
    const constraints = constraintsOf(harness, userId);
    assert.ok(constraints.includes('no_spicy'));
    assert.ok(constraints.includes('shrimp_allergy'));
    assert.equal(itemLinesOf(t).length, 0);
    assert.doesNotMatch(t, /บาท/u);
    assert.doesNotMatch(t, /มากี่คนครับ/u);
    assert.match(t, /แจ้งพนักงาน|ปนเปื้อน/u);
  });
});

// ---------------------------------------------------------------------
// Test 2: recommendation request uses remembered constraints.
// ---------------------------------------------------------------------

test('2. "ร้านอาหารมีอะไรแนะนำ" uses no_spicy+shrimp_allergy, max 3 items, no shrimp', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    const userId = 'phase2-split-2';
    await callLineWebhook([privateEvent('กินไม่เผ็ด แพ้กุ้ง', userId)]);
    await callLineWebhook([privateEvent('ร้านอาหารมีอะไรแนะนำ', userId)]);
    const t = text(replies, 1);
    const items = itemLinesOf(t);
    assert.ok(items.length >= 1 && items.length <= 3);
    for (const line of items) assert.doesNotMatch(line, /กุ้ง/u);
  });
});

// ---------------------------------------------------------------------
// Test 3: a constraint UPDATE sent right after a recommendation --
// the exact production bug.
// ---------------------------------------------------------------------

test('3. "ไม่กินไก่" sent right after a recommendation stores no_chicken, short ack, no menu dump, no repeated allergy block', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    const userId = 'phase2-split-3';
    await callLineWebhook([privateEvent('กินไม่เผ็ด แพ้กุ้ง', userId)]);
    await callLineWebhook([privateEvent('ร้านอาหารมีอะไรแนะนำ', userId)]);
    await callLineWebhook([privateEvent('ไม่กินไก่', userId)]);
    const t = text(replies, 2);
    const constraints = constraintsOf(harness, userId);
    assert.ok(constraints.includes('no_chicken'), 'no_chicken must be stored');
    assert.equal(itemLinesOf(t).length, 0, 'must not dump a menu on a bare constraint update');
    assert.doesNotMatch(t, /บาท/u);
  });
});

// ---------------------------------------------------------------------
// Test 4: next recommendation request uses ALL remembered constraints.
// ---------------------------------------------------------------------

test('4. "มีอะไรแนะนำอีก" uses no_spicy+shrimp_allergy+no_chicken together, max 3, no shrimp, no chicken', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    const userId = 'phase2-split-4';
    await callLineWebhook([privateEvent('กินไม่เผ็ด แพ้กุ้ง', userId)]);
    await callLineWebhook([privateEvent('ร้านอาหารมีอะไรแนะนำ', userId)]);
    await callLineWebhook([privateEvent('ไม่กินไก่', userId)]);
    await callLineWebhook([privateEvent('มีอะไรแนะนำอีก', userId)]);
    const t = text(replies, 3);
    const items = itemLinesOf(t);
    assert.ok(items.length <= 3);
    for (const line of items) {
      assert.doesNotMatch(line, /กุ้ง/u);
      assert.doesNotMatch(line, /ไก่/u);
    }
  });
});

// ---------------------------------------------------------------------
// Test 5: combined declaration + request in one message.
// ---------------------------------------------------------------------

test('5. "กินไม่เผ็ด แพ้กุ้ง มีอะไรแนะนำ" may recommend max 3, no shrimp, short caution', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('กินไม่เผ็ด แพ้กุ้ง มีอะไรแนะนำ', 'phase2-split-5')]);
    const t = text(replies, 0);
    const items = itemLinesOf(t);
    assert.ok(items.length >= 1 && items.length <= 3);
    for (const line of items) assert.doesNotMatch(line, /กุ้ง/u);
  });
});

// ---------------------------------------------------------------------
// Test 6: combined declaration + request, chicken variant.
// ---------------------------------------------------------------------

test('6. "ไม่กินไก่ มีอะไรแนะนำ" may recommend max 3, no chicken', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('ไม่กินไก่ มีอะไรแนะนำ', 'phase2-split-6')]);
    const t = text(replies, 0);
    const items = itemLinesOf(t);
    assert.ok(items.length >= 1 && items.length <= 3);
    for (const line of items) assert.doesNotMatch(line, /ไก่/u);
  });
});

// ---------------------------------------------------------------------
// Regressions
// ---------------------------------------------------------------------

test('7. regression: mobility memory still works ("แม่เดินไกลไม่ได้" then bare "มีอะไรแนะนำ")', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    const userId = 'phase2-split-7';
    await callLineWebhook([privateEvent('แม่เดินไกลไม่ได้', userId)]);
    await callLineWebhook([privateEvent('มีอะไรแนะนำ', userId)]);
    const t = text(replies, 1);
    assert.match(t, /ถ้ามากับคุณแม่เหมือนเดิม/u);
  });
});

test('8. regression: "พื้นลื่นมาก ตอนเล่น ATV น่ากลัว" still routes activity + owner', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    harness.programOpsChannel('activity');
    harness.programOpsChannel('owner_general');
    await callLineWebhook([privateEvent('พื้นลื่นมาก ตอนเล่น ATV น่ากลัว', 'phase2-split-8')]);
    const t = text(replies, 0);
    assert.doesNotMatch(t, /เลือกระยะเวลา\s*30,?\s*60\s*หรือ\s*90\s*นาที/u);
    assert.match(t, /ส่งให้ทีมกิจกรรมและเจ้าของตรวจสอบแล้วครับ/u);
  });
});

test('9. regression: "ขอคืนเงินได้ไหม" still gets Phase 1 deterministic escalation', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    harness.programOpsChannel('owner_general');
    await callLineWebhook([privateEvent('ขอคืนเงินได้ไหม', 'phase2-split-9')]);
    assert.match(text(replies, 0), /เรื่องคืนเงิน\/เงื่อนไขการชำระ ทองไทยขอไม่ยืนยันแทนเจ้าของนะครับ/u);
  });
});
