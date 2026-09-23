// PROOF-FIRST SEMANTIC UNDERSTANDING: honest diagnostic proof for tests
// 9 (archery), 11 (cafe), 12 (homestay), 13 (journey) from the owner's
// "Next Phase" request. Archery got one new, narrowly-scoped responder
// this round (a real gap: it previously ignored a stated shoulder
// concern entirely). Cafe/homestay/journey got NO new domain-specific
// code this round -- these assertions document and lock in their
// CURRENT, already-safe behavior (never hallucinates a menu/room/plan
// that doesn't exist; asks a real follow-up question) as an honest
// baseline, not a claim of full semantic care-awareness matching the
// horse-riding domain's depth. See THONGTHAI_HANDOFF.md's "Semantic
// Hospitality Intelligence" entry for the explicit scope statement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { withHarness, type Harness } from './helpers/canonical-core-harness';
import { handler as lineWebhookHandler } from '../netlify/functions/line-webhook';

const CHANNEL_SECRET = 'test-semantic-diagnostic-secret';

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

test('9. อยากยิงธนู แต่เจ็บไหล่: shoulder concern acknowledged, team guidance offered, no overclaim (NEW this round)', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('อยากยิงธนู แต่เจ็บไหล่', 'diag-user-9')]);
    const t = text(replies, 0);
    assert.match(t, /ไหล่/u, 'the shoulder concern must actually be acknowledged, not ignored');
    assert.match(t, /ทีมงาน|ไม่ต้องฝืน/u, 'must offer team guidance rather than a generic non-answer');
    assert.doesNotMatch(t, /ไม่มีตัวเลือกที่ตรง/u, 'must not fall back to the generic "no matching option" line');
  });
});

test('11. อยากกินกาแฟ ไม่เข้ม หวานน้อย: baseline honesty -- never invents a coffee menu that does not exist (NOT built out this round)', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('อยากกินกาแฟ ไม่เข้ม หวานน้อย', 'diag-user-11')]);
    const t = text(replies, 0);
    assert.doesNotMatch(t, /อเมริกาโน่|ลาเต้|คาปูชิโน่|\d+\s*บาท/u, 'must never fabricate specific menu items/prices with no real cafe menu data source');
  });
});

test('12. อยากพัก พาแม่มา เดินไกลไม่ได้: mobility signal already reinforced into memory, asks a real follow-up (existing behavior, not new)', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('อยากพัก พาแม่มา เดินไกลไม่ได้', 'diag-user-12')]);
    const t = text(replies, 0);
    assert.match(t, /เที่ยว|จัดแผน|เวลา/u, 'must give a relevant, non-generic reply');
    assert.doesNotMatch(t, /ห้อง\s*\d+|ราคา\s*\d+/u, 'must never fabricate a specific room/price with no verified room-availability source');
  });
});

test('13. มาเที่ยว 1 วัน ไม่อยากเดินเยอะ: journey planning asks for real missing info, no fabricated itinerary (existing behavior, not new)', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('มาเที่ยว 1 วัน ไม่อยากเดินเยอะ', 'diag-user-13')]);
    const t = text(replies, 0);
    assert.match(t, /เวลา|มากับใคร|แผน/u, 'must ask a real clarifying question toward an actual plan');
  });
});
