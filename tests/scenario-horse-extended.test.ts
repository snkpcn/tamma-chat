// PROOF-FIRST SCENARIO BRAIN: horse-riding domain 2's 10 numbered tests
// from the owner's "Knowledge Base + Scenario Brain" request. See
// THONGTHAI_HANDOFF.md's matching entry for scope.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { withHarness, type Harness } from './helpers/canonical-core-harness';
import { handler as lineWebhookHandler } from '../netlify/functions/line-webhook';

const CHANNEL_SECRET = 'test-scenario-horse-secret';

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

test('H1. อยากขี่ม้า ไม่เคยเลย กลัวตก: fear-only compound opener gets care mode, no duration rush', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('อยากขี่ม้า ไม่เคยเลย กลัวตก', 'sc-h1')]);
    const t = text(replies, 0);
    assert.doesNotMatch(t, /30 นาที|60 นาที|เลือกระยะเวลา/u);
    assert.match(t, /เข้าใจ|ไม่ต้องกังวล|ดูแล/u);
  });
});

test('H2. ลูก 8 ขวบอยากขี่: ลูก (not just เด็ก) recognized as child with age', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('ลูก 8 ขวบอยากขี่', 'sc-h2')]);
    const t = text(replies, 0);
    assert.match(t, /8 ขวบ/u);
    assert.doesNotMatch(t, /ปลอดภัยแน่นอน/u);
  });
});

test('H3. แม่อยากลองแต่เข่าไม่ค่อยดี: elderly + knee concern, team assessment', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('แม่อยากลองขี่ม้า เข่าไม่ค่อยดี', 'sc-h3')]);
    const t = text(replies, 0);
    assert.match(t, /ประเมิน|ดูแลใกล้/u);
  });
});

test('H4. ขอถ่ายรูปกับม้าเฉย ๆ ได้ไหม: photo-only goal, no ride pushed', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('ขอถ่ายรูปกับม้าเฉย ๆ ได้ไหม', 'sc-h4')]);
    const t = text(replies, 0);
    assert.match(t, /ถ่ายรูป/u);
    assert.doesNotMatch(t, /เคยขี่ม้ามาก่อนไหม|30 นาที|60 นาที/u);
  });
});

test('H6. เอาตัวนิ่มกว่า: firmness preference selects ภาราดร (the configured softer horse)', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('อยากขี่ม้า', 'sc-h6')]);
    await callLineWebhook([privateEvent('เอาตัวนิ่มกว่า', 'sc-h6')]);
    const t = text(replies, 1);
    assert.match(t, /ภาราดร/u);
  });
});

test('H7. เอาตัวที่ขี่แน่นกว่า: firmness preference selects ทองไทย (the configured firmer horse)', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('อยากขี่ม้า', 'sc-h7')]);
    await callLineWebhook([privateEvent('เอาตัวที่ขี่แน่นกว่า', 'sc-h7')]);
    const t = text(replies, 1);
    assert.match(t, /ทองไทย/u);
  });
});

test('H8. ปลอดภัยไหม (mid-flow): never a guarantee', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('อยากขี่ม้า', 'sc-h8')]);
    await callLineWebhook([privateEvent('เอาทองไทย', 'sc-h8')]);
    await callLineWebhook([privateEvent('ปลอดภัยไหม', 'sc-h8')]);
    const t = text(replies, 2);
    assert.doesNotMatch(t, /ปลอดภัยแน่นอน|(?<!ไม่กล้าการันตีว่า)ปลอดภัย 100%/u);
  });
});

test('H9. ให้คนจูงได้ไหม (mid-flow): confirms hands-on support is available', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('อยากขี่ม้า', 'sc-h9')]);
    await callLineWebhook([privateEvent('เอาทองไทย', 'sc-h9')]);
    await callLineWebhook([privateEvent('ให้คนจูงได้ไหม', 'sc-h9')]);
    const t = text(replies, 2);
    assert.match(t, /จูง|ประคอง/u);
  });
});

test('H10. ผมตัวใหญ่ ขี่ได้ไหม (mid-flow): weight concern acknowledged, team check, no fabricated weight limit', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('อยากขี่ม้า', 'sc-h10')]);
    await callLineWebhook([privateEvent('เอาทองไทย', 'sc-h10')]);
    await callLineWebhook([privateEvent('ผมตัวใหญ่ ขี่ได้ไหม', 'sc-h10')]);
    const t = text(replies, 2);
    assert.doesNotMatch(t, /\d+\s*กิโล/u, 'must never fabricate a specific weight limit number');
    assert.match(t, /เช็ค|ประเมิน|ทีมงาน/u);
  });
});
