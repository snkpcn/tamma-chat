// MASTER ROADMAP PHASE 2 -- RESTAURANT DECLARATION STILL DUMPS MENU
// (production retest of PR #74, 2026-09-24).
//
// PR #74 fixed the "same block repeated" bug but the owner's production
// retest showed the FIRST turn ("กินไม่เผ็ด แพ้กุ้ง") STILL dumped a full
// menu recommendation. Root cause: PR #74's own
// isBareRestaurantConstraintDeclaration branch was gated by
// `!hasActiveRestaurantConversation`, and that gate checked whether
// `restaurantAdvisorContext`/`restaurantProposedSet` exist AT ALL in the
// guest's PERSISTED agent state -- which never expires on its own. The
// owner's LINE test account had leftover restaurantAdvisorContext from
// an EARLIER, unrelated retest (a prior PR round, well over an hour
// before), so a brand-new "กินไม่เผ็ด แพ้กุ้ง" statement was wrongly
// treated as a same-conversation refinement of that stale context,
// permanently blocking the short-ack path for that guest.
//
// Fix: `isRestaurantConversationRecentlyActive` (thongthai-chat.ts) now
// bounds `restaurantAdvisorContext` to a 10-minute recency window
// (`context.updatedAt`) -- only a conversation that's GENUINELY still
// going counts as "active" for this decision. A concrete in-progress
// proposed order (`currentRestaurantSet`) still always counts,
// regardless of age.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { withHarness, type Harness } from './helpers/canonical-core-harness';
import { handler as lineWebhookHandler } from '../netlify/functions/line-webhook';

const CHANNEL_SECRET = 'test-phase2-restaurant-stale-context-secret';

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

// ---------------------------------------------------------------------
// Test 1: a bare constraint declaration -- short ack only, ever.
// ---------------------------------------------------------------------

test('1. "กินไม่เผ็ด แพ้กุ้ง" stores memory, short ack, no menu bullets, no prices, staff caution, no party-size ask', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    const userId = 'phase2-stale-1';
    await callLineWebhook([privateEvent('กินไม่เผ็ด แพ้กุ้ง', userId)]);
    const t = text(replies, 0);

    const constraints = constraintsOf(harness, userId);
    assert.ok(constraints.includes('no_spicy'));
    assert.ok(constraints.includes('shrimp_allergy'));
    assert.doesNotMatch(t, /บาท/u, 'no prices');
    assert.doesNotMatch(t, /^•/mu, 'no menu bullets');
    assert.match(t, /แจ้งพนักงาน|ปนเปื้อน/u, 'includes staff/cross-contamination caution');
    assert.doesNotMatch(t, /มากี่คนครับ/u, 'must not ask party size on a bare declaration');
  });
});

// ---------------------------------------------------------------------
// Test 2: follow-up recommendation request uses remembered constraints.
// ---------------------------------------------------------------------

test('2. "ร้านอาหารมีอะไรแนะนำ" after the declaration uses remembered constraints, max 3 items, no shrimp, no duplicated warning', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    const userId = 'phase2-stale-2';
    await callLineWebhook([privateEvent('กินไม่เผ็ด แพ้กุ้ง', userId)]);
    await callLineWebhook([privateEvent('ร้านอาหารมีอะไรแนะนำ', userId)]);
    const t = text(replies, 1);
    const itemLines = t.split('\n').filter(line => /^•/.test(line.trim()));
    assert.ok(itemLines.length >= 1 && itemLines.length <= 3);
    for (const line of itemLines) assert.doesNotMatch(line, /กุ้ง/u);
    assert.doesNotMatch(t, /แจ้งพนักงาน|ปนเปื้อน/u, 'must not repeat the full warning block');
  });
});

// ---------------------------------------------------------------------
// Test 3: declaration + request combined in one message.
// ---------------------------------------------------------------------

test('3. "กินไม่เผ็ด แพ้กุ้ง มีอะไรแนะนำ" recommends up to 3 items, no shrimp, allergy caution included', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('กินไม่เผ็ด แพ้กุ้ง มีอะไรแนะนำ', 'phase2-stale-3')]);
    const t = text(replies, 0);
    const itemLines = t.split('\n').filter(line => /^•/.test(line.trim()));
    assert.ok(itemLines.length >= 1 && itemLines.length <= 3);
    for (const line of itemLines) assert.doesNotMatch(line, /กุ้ง/u);
    assert.match(t, /แจ้งพนักงาน|ปนเปื้อน/u, 'allergy caution included since the constraint is stated THIS turn');
  });
});

// ---------------------------------------------------------------------
// Test 4: regression -- explicit full menu request still works.
// ---------------------------------------------------------------------

test('4. regression: "ขอเมนูทั้งหมดที่ไม่มีกุ้ง" can show more than 3 items, still no shrimp', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('ขอเมนูทั้งหมดที่ไม่มีกุ้ง', 'phase2-stale-4')]);
    const t = text(replies, 0);
    const itemLines = t.split('\n').filter(line => /^•/.test(line.trim()));
    assert.ok(itemLines.length >= 1);
    for (const line of itemLines) assert.doesNotMatch(line, /กุ้ง/u);
  });
});

// ---------------------------------------------------------------------
// Test 5: the actual production bug -- a STALE restaurantAdvisorContext
// (from a much earlier, unrelated interaction) must not block the
// short-ack path for a brand-new declaration.
// ---------------------------------------------------------------------

test('5. a stale (1-hour-old) restaurantAdvisorContext no longer blocks a fresh bare declaration', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    const userId = 'phase2-stale-5';
    // Turn 1: an earlier, unrelated restaurant interaction establishes
    // restaurantAdvisorContext.
    await callLineWebhook([privateEvent('ร้านมีอะไรกิน', userId)]);
    const guestDbId = harness.guestDbId(lineGuestId(userId));
    assert.ok(guestDbId);
    const snapshot = harness.getState(guestDbId!);
    const state = (snapshot?.state ?? {}) as Record<string, unknown>;
    const context = (state.restaurantAdvisorContext ?? {}) as Record<string, unknown>;
    // Backdate it by over an hour -- simulating the owner's real
    // production account, which had tested the restaurant flow in an
    // earlier PR round well before this retest.
    harness.setState(guestDbId!, {
      ...state,
      restaurantAdvisorContext: { ...context, updatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() },
    });

    await callLineWebhook([privateEvent('กินไม่เผ็ด แพ้กุ้ง', userId)]);
    const t = text(replies, 1);
    assert.doesNotMatch(t, /บาท/u, 'a fresh declaration must get the short ack even with a stale restaurantAdvisorContext present');
    assert.doesNotMatch(t, /^•/mu);
  });
});

// ---------------------------------------------------------------------
// Regressions
// ---------------------------------------------------------------------

test('6. regression: "แม่แพ้กุ้งรุนแรง กินอะไรได้บ้าง" -- Phase 1 escalation still wins', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    harness.programOpsChannel('restaurant');
    harness.programOpsChannel('owner_general');
    await callLineWebhook([privateEvent('แม่แพ้กุ้งรุนแรง กินอะไรได้บ้าง', 'phase2-stale-6')]);
    const t = text(replies, 0);
    assert.match(t, /ทองไทยไม่อยากเดาแทนทีมครับ/u);
    assert.doesNotMatch(t, /รับประกัน|ปลอดภัยแน่นอน/u);
  });
});

test('7. regression: mid-conversation refinement (still-recent context) keeps showing an updated list', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    const userId = 'phase2-stale-7';
    await callLineWebhook([privateEvent('ร้านมีอะไรกิน', userId)]);
    await callLineWebhook([privateEvent('จริงๆ ขอเผ็ดน้อย', userId)]);
    const t = text(replies, 1);
    assert.match(t, /ไม่เผ็ดจัด|บาท/u);
  });
});
