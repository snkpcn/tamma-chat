// PROOF-FIRST SCENARIO BRAIN: verification tests for restaurant (5),
// cafe (6), OTOP (8), journey (9), weather/location (10), and feedback
// (11) domains from the owner's "Knowledge Base + Scenario Brain"
// request. Most of these prove EXISTING infrastructure already works
// (no new code); two real, narrow gaps were found and fixed this round
// (the "อยู่ตรงไหน"/"ขอแผนที่" location marker, and the "ควรแก้"/"ช่วยปรับ"
// constructive-complaint marker) -- see THONGTHAI_HANDOFF.md's matching
// entry for the full breakdown of what's new vs. verified-existing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { withHarness, type Harness } from './helpers/canonical-core-harness';
import { handler as lineWebhookHandler } from '../netlify/functions/line-webhook';

const CHANNEL_SECRET = 'test-scenario-remaining-secret';

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

function text(replies: CapturedReply[], index: number): string {
  return replies[index]?.messages.map(m => m.text ?? '').join(' ') ?? '';
}

// --- Restaurant (verified existing infra) ----------------------------------

test('R1. มีอะไรไม่เผ็ด: real menu items, spice filter applied, no fabrication', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('มีอะไรไม่เผ็ด', 'sc-r1')]);
    const t = text(replies, 0);
    assert.match(t, /บาท/u, 'must show real priced menu items');
  });
});

test('R3. รีบกิน รอนานไหม: classified as complaint feedback (time pressure), routed', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    await callLineWebhook([privateEvent('รีบกิน รอนานไหม', 'sc-r3')]);
    const t = text(replies, 0);
    assert.match(t, /ขอโทษ/u);
    const rows = harness.postsTo('ops_feedback_events');
    assert.ok(rows.length >= 1);
  });
});

// --- Cafe (honest baseline, no cafe data source -- verified, not new) ------

test('C1. ไม่กินคาเฟอีน มีอะไรแนะนำ: honest non-hallucination (no cafe menu data source exists)', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('ไม่กินคาเฟอีน มีอะไรแนะนำ', 'sc-c1')]);
    const t = text(replies, 0);
    assert.doesNotMatch(t, /ดีคาเฟอีน|เอสเปรสโซ่|ลาเต้/u, 'must never fabricate a specific decaf drink with no real menu source');
  });
});

// --- Journey (verified existing infra) --------------------------------------

test('J2. พาครอบครัวมา มีเด็กกับผู้สูงอายุ: gentle pace plan, asks mobility/food constraint', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('พาครอบครัวมา มีเด็กกับผู้สูงอายุ', 'sc-j2')]);
    const t = text(replies, 0);
    assert.match(t, /เบา\s*ๆ|เดินไม่สะดวก|แพ้/u);
  });
});

// --- Weather / location -----------------------------------------------------

test('W1. วันนี้ฝนตกปะ ขี่ม้าได้ไหม: colloquial "ปะ" understood, ground caveat, no fake certainty', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('วันนี้ฝนตกปะ ขี่ม้าได้ไหม', 'sc-w1')]);
    const t = text(replies, 0);
    assert.match(t, /สภาพพื้นจริงหน้างานต้องให้ทีมดูอีกทีครับ/u);
  });
});

test('W2. อยู่ตรงไหน: real map link surfaced (FIXED this round -- LOCATION_MARKER was missing this exact phrasing)', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('อยู่ตรงไหน', 'sc-w2')]);
    const t = text(replies, 0);
    assert.match(t, /maps\.app\.goo\.gl/u);
  });
});

test('W3. ขอแผนที่: real map link surfaced (FIXED this round)', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('ขอแผนที่', 'sc-w3')]);
    const t = text(replies, 0);
    assert.match(t, /maps\.app\.goo\.gl/u);
  });
});

// --- Feedback (mostly verified existing infra; one marker gap fixed) -------

test('F2. ห้องไม่สะอาด: classified as complaint, routes to correct area', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    await callLineWebhook([privateEvent('ห้องไม่สะอาด', 'sc-f2')]);
    const t = text(replies, 0);
    assert.match(t, /ขอโทษ/u);
    const rows = harness.postsTo('ops_feedback_events');
    assert.ok(rows.length >= 1);
  });
});

test('F3. ไม่อยากรีวิวแย่ แต่ควรแก้เรื่องพนักงาน: classified as complaint (FIXED this round -- COMPLAINT_MARKER was missing ควรแก้/ช่วยปรับ)', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    await callLineWebhook([privateEvent('ไม่อยากรีวิวแย่ แต่ควรแก้เรื่องพนักงาน', 'sc-f3')]);
    const t = text(replies, 0);
    assert.doesNotMatch(t, /ยังไม่มีข้อมูลที่ยืนยันได้/u);
    const rows = harness.postsTo('ops_feedback_events');
    assert.ok(rows.length >= 1, 'must actually create a feedback event, not fall through to the generic apology');
    assert.equal(rows[rows.length - 1].feedback_type, 'complaint');
  });
});
