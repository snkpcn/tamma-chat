// PROOF-FIRST SEMANTIC UNDERSTANDING: the owner's "Next Phase" request
// gave 18 numbered tests spanning messy/typo Thai across every business
// unit. This file covers the horse-riding domain tests (1-6, 16-18),
// which is where the request's own worked examples and existing task-
// state infrastructure are deepest -- see THONGTHAI_HANDOFF.md's
// "Semantic Hospitality Intelligence" entry for which of the remaining
// domains got the same treatment this round and which did not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { withHarness, type Harness } from './helpers/canonical-core-harness';
import { handler as lineWebhookHandler } from '../netlify/functions/line-webhook';

const CHANNEL_SECRET = 'test-semantic-horse-secret';

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

// ---------------------------------------------------------------------
// 1. Baseline: beginner + alone + no concern -> moves to duration, no vague fallback.
// ---------------------------------------------------------------------

test('1. อยากขี่ม้า -> เอาทองไทย -> ไม่เคยครับมาคนเดียว -> ไม่กังวลครับ: moves to 30/60 duration, no vague fallback', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    const userId = 'sem-user-1';
    await callLineWebhook([privateEvent('อยากขี่ม้า', userId)]);
    await callLineWebhook([privateEvent('เอาทองไทย', userId)]);
    await callLineWebhook([privateEvent('ไม่เคยครับมาคนเดียว', userId)]);
    await callLineWebhook([privateEvent('ไม่กังวลครับ', userId)]);
    const t = text(replies, 3);
    assert.doesNotMatch(t, /ขอรายละเอียดเพิ่ม/u);
    assert.match(t, /30 นาที/u);
    assert.match(t, /60 นาที/u);
  });
});

// ---------------------------------------------------------------------
// 2. Fear expressed instead of answering the experience/party question.
// ---------------------------------------------------------------------

test('2. อยากขี่ม้า -> เอาทองไทย -> กังวลนิดนึง: care mode, reassures, never jumps to duration or vague fallback', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    const userId = 'sem-user-2';
    await callLineWebhook([privateEvent('อยากขี่ม้า', userId)]);
    await callLineWebhook([privateEvent('เอาทองไทย', userId)]);
    await callLineWebhook([privateEvent('กังวลนิดนึง', userId)]);
    const t = text(replies, 2);
    assert.doesNotMatch(t, /ขอรายละเอียดเพิ่ม/u, 'must never fall through to the generic vague fallback');
    assert.doesNotMatch(t, /30 นาที|60 นาที/u, 'must not rush to a duration choice while still in care mode');
    assert.match(t, /เข้าใจ|ไม่ต้องกังวล|ดูแล/u, 'must actually reassure, not just re-ask blankly');
  });
});

// ---------------------------------------------------------------------
// 3. Compound single-message answer to the care question.
// ---------------------------------------------------------------------

test('3. ผมไม่เคยขี่ครับ ไม่กังวลครับ ไม่ปวดหลัง (all in one message) parses beginner+no concern+no back pain, moves to duration', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    const userId = 'sem-user-3';
    await callLineWebhook([privateEvent('อยากขี่ม้า', userId)]);
    await callLineWebhook([privateEvent('เอาทองไทย', userId)]);
    await callLineWebhook([privateEvent('ผมไม่เคยขี่ครับ ไม่กังวลครับ ไม่ปวดหลัง', userId)]);
    const t = text(replies, 2);
    assert.doesNotMatch(t, /ขอรายละเอียดเพิ่ม/u);
    assert.match(t, /30 นาที/u);
    assert.match(t, /60 นาที/u);
  });
});

// ---------------------------------------------------------------------
// 4. Compound first message: elderly companion + knee concern, no prior turns.
// ---------------------------------------------------------------------

test('4. แม่อยากขี่ม้า เข่าไม่ค่อยดี: elderly/knee concern understood, team-assessment caveat, no duration-first, no safety guarantee', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    const userId = 'sem-user-4';
    await callLineWebhook([privateEvent('แม่อยากขี่ม้า เข่าไม่ค่อยดี', userId)]);
    const t = text(replies, 0);
    assert.doesNotMatch(t, /30 นาที|60 นาที/u, 'must not rush straight to a duration choice');
    assert.doesNotMatch(t, /ปลอดภัยแน่นอน|การันตีความปลอดภัย 100%(?!.*ไม่)/u, 'must never guarantee safety');
    assert.match(t, /ประเมิน|ดูแลใกล้/u, 'must offer a team-assessment caveat');
  });
});

// ---------------------------------------------------------------------
// 5. Compound first message: child with a stated age, no prior turns.
// ---------------------------------------------------------------------

test('5. เด็ก 8 ขวบอยากขี่: child age parsed, asks guardian/team-assessment, never claims a safety guarantee', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    const userId = 'sem-user-5';
    await callLineWebhook([privateEvent('เด็ก 8 ขวบอยากขี่', userId)]);
    const t = text(replies, 0);
    assert.match(t, /8 ขวบ/u, 'the stated age must actually be reflected back, not silently dropped');
    assert.match(t, /ผู้ปกครอง|ประเมิน/u);
    assert.doesNotMatch(t, /ปลอดภัยแน่นอน/u);
  });
});

// ---------------------------------------------------------------------
// 6. Weather/ground concern as the opening message.
// ---------------------------------------------------------------------

test('6. ฝนตกเมื่อกี้ ขี่ม้าได้ไหม: weather/ground caution, team on-site assessment, no guarantee', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    const userId = 'sem-user-6';
    await callLineWebhook([privateEvent('ฝนตกเมื่อกี้ ขี่ม้าได้ไหม', userId)]);
    const t = text(replies, 0);
    assert.match(t, /ฝน|พื้น/u);
    assert.doesNotMatch(t, /ได้แน่นอน|ปลอดภัยแน่นอน/u);
    assert.match(t, /เช็ค|ประเมิน/u, 'must defer to an on-site check rather than guessing');
  });
});

// ---------------------------------------------------------------------
// 16-17. Typo tolerance.
// ---------------------------------------------------------------------

test('16. อยากขี้ม้า (typo for ขี่ม้า) is still understood as horse-riding intent', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    const userId = 'sem-user-16';
    await callLineWebhook([privateEvent('อยากขี้ม้า', userId)]);
    const t = text(replies, 0);
    assert.match(t, /ม้า/u, 'the reply must actually be about horses, not a generic fallback');
    assert.doesNotMatch(t, /ขอโทษ.*ไม่เข้าใจ|ขอรายละเอียดเพิ่ม/u);
  });
});

test('17. กังวนเรื่องตกม้า (typo for กังวลเรื่องตกม้า) mid-flow is understood as a fear/concern signal, not ignored', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    const userId = 'sem-user-17';
    await callLineWebhook([privateEvent('อยากขี่ม้า', userId)]);
    await callLineWebhook([privateEvent('เอาทองไทย', userId)]);
    await callLineWebhook([privateEvent('กังวนเรื่องตกม้า', userId)]);
    const t = text(replies, 2);
    assert.doesNotMatch(t, /ขอรายละเอียดเพิ่ม/u, 'the typo must not cause it to fall through to the vague fallback');
    assert.match(t, /เข้าใจ|ไม่ต้องกังวล|ดูแล/u);
  });
});

// ---------------------------------------------------------------------
// 18. No overconfidence on a direct safety question.
// ---------------------------------------------------------------------

test('18. ปลอดภัยไหม (mid-flow) never claims a guarantee -- team assesses, supervises, starts slow', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    const userId = 'sem-user-18';
    await callLineWebhook([privateEvent('อยากขี่ม้า', userId)]);
    await callLineWebhook([privateEvent('เอาทองไทย', userId)]);
    await callLineWebhook([privateEvent('ปลอดภัยไหม', userId)]);
    const t = text(replies, 2);
    assert.doesNotMatch(t, /ปลอดภัยแน่นอน|(?<!ไม่กล้าการันตีว่า)ปลอดภัย 100%/u, 'must never overclaim safety');
    assert.match(t, /ไม่กล้าการันตี|ทีมงานจะช่วยประเมิน/u, 'must honestly hedge, not claim a guarantee');
    assert.match(t, /ประเมิน|ดูแลใกล้|ทีมงาน/u, 'must say the team assesses/supervises instead');
  });
});
