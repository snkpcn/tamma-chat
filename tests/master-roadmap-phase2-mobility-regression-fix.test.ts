// MASTER ROADMAP PHASE 2 -- PRODUCTION REGRESSION FIX (2026-09-23).
// Owner's production retest of PR #72 (commit 428a2bc) failed: "แม่เดินไกลไม่ได้"
// got the generic clarify fallback ("ขอรายละเอียดเพิ่มอีกนิดครับ...") instead
// of a care-aware reply, and a following bare "มีอะไรแนะนำ" got the SAME
// generic fallback instead of the mobility-aware recommendation.
//
// Root cause (see _semantic-hospitality-interpreter.ts's own comment on
// LOW_WALKING_MARKER): that marker recognized "เดินไม่ไหว" but not
// "เดินไกลไม่ได้" -- a DIFFERENT phrasing Phase 2's own
// _customer-phrase-intelligence.ts memory-capture regex already
// recognized. So the message was captured into guest_memory correctly
// (as confirmed by the ORIGINAL Phase 2 test suite) but never triggered
// ecosystemFirstVisitResponse's existing low-walking branch, falling
// through to the LLM instead. Separately, a truly BARE "มีอะไรแนะนำ" (no
// "ครั้งแรก" context) had zero deterministic coverage at all -- a known
// gap flagged (and deferred) in THONGTHAI_HANDOFF.md's Phase 1 entry,
// now fixed narrowly for the memory-aware case only (see
// BARE_RECOMMEND_MARKER's own comment in thongthai-chat.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { withHarness, type Harness } from './helpers/canonical-core-harness';
import { handler as lineWebhookHandler } from '../netlify/functions/line-webhook';

const CHANNEL_SECRET = 'test-phase2-mobility-fix-secret';
const GENERIC_CLARIFY_FALLBACK = 'ขอรายละเอียดเพิ่มอีกนิดครับ จะได้ช่วยต่อให้ตรงเรื่อง';

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

// Same hash _line-webhook-core.ts's own (unexported) lineGuestId uses.
function lineGuestId(userId: string): string {
  const hex = createHash('sha256').update('tamma-line:' + userId, 'utf8').digest('hex').slice(0, 32).split('');
  hex[12] = '5';
  const variant = parseInt(hex[16], 16);
  hex[16] = ((variant & 0x3) | 0x8).toString(16);
  const value = hex.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`;
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

function constraintsOf(harness: Harness, userId: string): string[] {
  const guestDbId = harness.guestDbId(lineGuestId(userId));
  if (!guestDbId) return [];
  const value = harness.getGuestMemory(guestDbId, 'constraints');
  return Array.isArray(value) ? value as string[] : [];
}

// ---------------------------------------------------------------------
// Test 1: bare mobility statement gets a care-aware reply, not the
// generic clarify fallback.
// ---------------------------------------------------------------------

test('1. "แม่เดินไกลไม่ได้" (exact production phrase) gets a care-aware reply, never the generic clarify fallback', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    const userId = 'phase2-fix-1';
    await callLineWebhook([privateEvent('แม่เดินไกลไม่ได้', userId)]);
    const t = text(replies, 0);
    assert.notEqual(t, GENERIC_CLARIFY_FALLBACK);
    assert.match(t, /เดินน้อย|นั่งพัก|คุณแม่/u);
    const constraints = constraintsOf(harness, userId);
    assert.ok(constraints.includes('limited_walking'), 'guest_memory must store limited_walking');
  });
});

// ---------------------------------------------------------------------
// Test 2: bare "มีอะไรแนะนำ" in the SAME conversation uses the
// remembered mobility context, never the generic fallback.
// ---------------------------------------------------------------------

test('2. bare "มีอะไรแนะนำ" after "แม่เดินไกลไม่ได้" uses remembered mobility context, never generic fallback', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    const userId = 'phase2-fix-2';
    await callLineWebhook([privateEvent('แม่เดินไกลไม่ได้', userId)]);
    await callLineWebhook([privateEvent('มีอะไรแนะนำ', userId)]);
    const t = text(replies, 1);
    assert.notEqual(t, GENERIC_CLARIFY_FALLBACK);
    assert.match(t, /ถ้ามากับคุณแม่เหมือนเดิม/u);
    assert.match(t, /เดินน้อย/u);
  });
});

// ---------------------------------------------------------------------
// Test 3: load-bearing -- disabling memory capture breaks test 2.
// ---------------------------------------------------------------------

test('3. test 2 fails if memory capture never ran (no limited_walking in guest_memory)', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    const userId = 'phase2-fix-3';
    // Never send the mobility statement -- simulates memory capture
    // having been disabled/never having run for this guest.
    await callLineWebhook([privateEvent('มีอะไรแนะนำ', userId)]);
    const t = text(replies, 0);
    assert.doesNotMatch(t, /ถ้ามากับคุณแม่เหมือนเดิม/u, 'without a stored limited_walking constraint, the mobility-aware reply must not fire');
  });
});

// ---------------------------------------------------------------------
// Test 4: load-bearing -- disabling the bare-recommendation responder's
// memory check breaks test 2 (proven by temporarily neutering it).
// ---------------------------------------------------------------------

test('4. bare-recommendation responder is what supplies the mobility-aware reply (not some other path)', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    const userId = 'phase2-fix-4';
    await callLineWebhook([privateEvent('แม่เดินไกลไม่ได้', userId)]);
    assert.ok(constraintsOf(harness, userId).includes('limited_walking'));
    await callLineWebhook([privateEvent('มีอะไรแนะนำ', userId)]);
    const t = text(replies, 1);
    // The exact wording only the bare-recommendation responder produces
    // (shared verbatim with ecosystemFirstVisitResponse's "ครั้งแรก"
    // branch) -- if some other path answered instead, this exact string
    // would not appear.
    assert.equal(t, 'ถ้ามากับคุณแม่เหมือนเดิม ทองไทยแนะนำแบบเดินน้อยก่อนนะครับ 😊\nอยากเน้นกินข้าว คาเฟ่ หรือกิจกรรมเบา ๆ ครับ?');
  });
});

// ---------------------------------------------------------------------
// Regression tests 5-7
// ---------------------------------------------------------------------

test('5. regression: "สติ" still gets clarification, not the generic slow fallback', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('สติ', 'phase2-fix-5')]);
    const t = text(replies, 0);
    assert.doesNotMatch(t, /คิดช้ากว่าปกติ/u);
    assert.match(t, /ตั้งสติ|ถามเรื่องไหนต่อ/u);
  });
});

test('6. regression: "ขอคืนเงินได้ไหม" still gets Phase 1 deterministic escalation', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    harness.programOpsChannel('owner_general');
    await callLineWebhook([privateEvent('ขอคืนเงินได้ไหม', 'phase2-fix-6')]);
    assert.match(text(replies, 0), /เรื่องคืนเงิน\/เงื่อนไขการชำระ ทองไทยขอไม่ยืนยันแทนเจ้าของนะครับ/u);
  });
});

test('7. regression: "พื้นลื่นมาก ตอนเล่น ATV น่ากลัว" still routes activity + owner, no booking flow', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    harness.programOpsChannel('activity');
    harness.programOpsChannel('owner_general');
    await callLineWebhook([privateEvent('พื้นลื่นมาก ตอนเล่น ATV น่ากลัว', 'phase2-fix-7')]);
    const t = text(replies, 0);
    assert.doesNotMatch(t, /เลือกระยะเวลา\s*30,?\s*60\s*หรือ\s*90\s*นาที/u);
    assert.match(t, /ส่งให้ทีมกิจกรรมและเจ้าของตรวจสอบแล้วครับ/u);
  });
});
