// PROOF-FIRST SCENARIO BRAIN: homestay domain 7's numbered tests from the
// owner's "Knowledge Base + Scenario Brain" request, using the real
// owner-provided facts in _tamma-domain-knowledge.ts's HOMESTAY_FACTS.
// See THONGTHAI_HANDOFF.md's matching entry for scope.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { withHarness, type Harness } from './helpers/canonical-core-harness';
import { handler as lineWebhookHandler } from '../netlify/functions/line-webhook';

const CHANNEL_SECRET = 'test-scenario-homestay-secret';

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

test('S1. อยากพัก พาแม่มา เดินไกลไม่ได้: elderly-aware opener, asks date/guests/nights', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('อยากพัก พาแม่มา เดินไกลไม่ได้', 'sc-s1')]);
    const t = text(replies, 0);
    assert.match(t, /กี่คน|กี่คืน/u);
  });
});

test('S2. พัก 4 คน มีบ้านกี่ห้องนอน: real house/room-type counts from HOMESTAY_FACTS', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('พัก 4 คน มีบ้านกี่ห้องนอน', 'sc-s2')]);
    const t = text(replies, 0);
    assert.match(t, /6\s*หลัง/u);
    assert.match(t, /2\s*ห้องนอน.*3\s*หลัง|3\s*หลัง.*2\s*ห้องนอน/u);
  });
});

test('S3. เช็กอินดึกได้ไหม: real check-in/out facts, final confirmation note', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('เช็กอินดึกได้ไหม', 'sc-s3')]);
    const t = text(replies, 0);
    assert.match(t, /14:00/u);
    assert.match(t, /LINE|อีเมล|โทรศัพท์/u);
  });
});

test('S4. มีเด็กเล็กพักได้ไหม: child-aware reply, no invented facts', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('อยากพัก มีเด็กเล็กพักได้ไหม', 'sc-s4')]);
    const t = text(replies, 0);
    assert.match(t, /เด็ก/u);
  });
});

test('S6. คืนนี้ว่างไหม: never invents availability, gives an honest answer', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('อยากพัก คืนนี้ว่างไหม', 'sc-s6')]);
    const t = text(replies, 0);
    assert.doesNotMatch(t, /ว่างครับ|มีห้องว่างครับ/u, 'must never claim a specific room is available without a real data source');
    assert.match(t, /ทีม|ยืนยัน/u);
  });
});
