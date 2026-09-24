// PHASE 2 STABILIZATION — TOP-LEVEL SEMANTIC INTENT GATE
//
// Production incident:
// "ขอโลเคชั่นหน่อยทองไทย" was routed as selecting the HORSE named ทองไทย
// because entity-token routing outranked the whole sentence's meaning.
//
// These tests prove the opposite policy: sentence meaning wins first, while
// explicit horse wording and existing restaurant/safety/policy behavior remain
// intact.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { withHarness } from './helpers/canonical-core-harness';
import { handler as lineWebhookHandler } from '../netlify/functions/line-webhook';
import { classifyTopLevelSemanticIntent } from '../netlify/functions/_top-level-intent';

const CHANNEL_SECRET = 'test-semantic-intent-gate-secret';

type CapturedReply = { replyToken: string; messages: Array<{ type: string; text?: string }> };

function installLineReplyCapture(): { restore: () => void; replies: CapturedReply[] } {
  const original = global.fetch;
  const replies: CapturedReply[] = [];
  global.fetch = (async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    if (href.includes('api.line.me/v2/bot/message/reply')) {
      replies.push(JSON.parse(String(init?.body ?? '{}')) as CapturedReply);
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

let seq = 0;
function privateEvent(text: string, userId: string) {
  seq += 1;
  return {
    type: 'message',
    replyToken: `reply-${userId}-${seq}`,
    timestamp: Date.now() + seq,
    source: { type: 'user', userId },
    message: { id: `msg-${userId}-${seq}`, type: 'text', text },
  };
}

function replyText(replies: CapturedReply[], index: number): string {
  return replies[index]?.messages.map(m => m.text ?? '').join('\n') ?? '';
}

async function withLine<T>(run: (replies: CapturedReply[]) => Promise<T>): Promise<T> {
  const originalSecret = process.env.LINE_CHANNEL_SECRET;
  process.env.LINE_CHANNEL_SECRET = CHANNEL_SECRET;
  try {
    return await withHarness(async () => {
      const capture = installLineReplyCapture();
      try {
        return await run(capture.replies);
      } finally {
        capture.restore();
      }
    });
  } finally {
    if (originalSecret === undefined) delete process.env.LINE_CHANNEL_SECRET;
    else process.env.LINE_CHANNEL_SECRET = originalSecret;
  }
}

test('top-level classifier reads sentence meaning before entity tokens', () => {
  assert.equal(classifyTopLevelSemanticIntent('ขอโลเคชั่นหน่อยทองไทย'), 'LOCATION_REQUEST');
  assert.equal(classifyTopLevelSemanticIntent('ขอโลเคชั่นหน่อย'), 'LOCATION_REQUEST');
  assert.equal(classifyTopLevelSemanticIntent('ตอนนี้ฝนตกไหม'), 'WEATHER_REQUEST');
  assert.equal(classifyTopLevelSemanticIntent('ทองไทยแนะนำหน่อย'), 'BOT_ADDRESS');
  assert.equal(classifyTopLevelSemanticIntent('อยากขี่ม้าทองไทย'), 'HORSE_RELATED');
  assert.equal(classifyTopLevelSemanticIntent('เอาทองไทย'), 'HORSE_RELATED');
});

test('full LINE: stale horse context cannot hijack "ขอโลเคชั่นหน่อยทองไทย"', async () => {
  await withLine(async replies => {
    const user = 'semantic-gate-location-after-horse';
    await callLineWebhook([privateEvent('อยากขี่ม้า ไม่เคยเลย กลัวตก', user)]);
    await callLineWebhook([privateEvent('ขอโลเคชั่นหน่อยทองไทย', user)]);

    const location = replyText(replies, 1);
    assert.match(location, /maps\.app\.goo\.gl|พิกัด|แผนที่|นำทาง/u);
    assert.doesNotMatch(location, /เลือกทองไทย|คาแรกเตอร์|เคยขี่ม้ามาก่อนไหม/u);
  });
});

test('full LINE: assistant-name request stays assistant request even after horse context', async () => {
  await withLine(async replies => {
    const user = 'semantic-gate-bot-address-after-horse';
    await callLineWebhook([privateEvent('อยากขี่ม้า ไม่เคยเลย กลัวตก', user)]);
    await callLineWebhook([privateEvent('ทองไทยแนะนำหน่อย', user)]);

    const answer = replyText(replies, 1);
    assert.match(answer, /ช่วยแนะนำ|กิน|พัก|กิจกรรม|โลเคชั่น|อากาศ|จัดทริป/u);
    assert.doesNotMatch(answer, /เลือกทองไทย|คาแรกเตอร์|เคยขี่ม้ามาก่อนไหม/u);
  });
});

test('full LINE: explicit horse wording remains horse-related and is not stolen by semantic gate', async () => {
  await withLine(async replies => {
    await callLineWebhook([privateEvent('อยากขี่ม้าทองไทย', 'semantic-gate-explicit-horse')]);
    const answer = replyText(replies, 0);
    assert.doesNotMatch(answer, /พิกัด|แผนที่|นำทาง/u);
    assert.match(answer, /ม้า|ทองไทย|ขี่/u);
  });
});

test('full LINE regression: restaurant constraint declaration still does not dump menu', async () => {
  await withLine(async replies => {
    await callLineWebhook([privateEvent('กินไม่เผ็ด แพ้กุ้ง', 'semantic-gate-food-regression')]);
    const answer = replyText(replies, 0);
    assert.doesNotMatch(answer, /^\s*•/mu);
    assert.doesNotMatch(answer, /\d+\s*บาท/u);
  });
});

test('full LINE regression: refund boundary still wins', async () => {
  await withLine(async replies => {
    await callLineWebhook([privateEvent('ขอคืนเงินได้ไหม', 'semantic-gate-refund-regression')]);
    const answer = replyText(replies, 0);
    assert.match(answer, /ไม่ยืนยันแทนเจ้าของ|เจ้าของ|ตรวจสอบ/u);
  });
});

test('full LINE regression: ATV safety report is not swallowed by horse/activity token routing', async () => {
  await withLine(async replies => {
    await callLineWebhook([privateEvent('พื้นลื่นมาก ตอนเล่น ATV น่ากลัว', 'semantic-gate-safety-regression')]);
    const answer = replyText(replies, 0);
    assert.match(answer, /ความปลอดภัย|ตรวจสอบ/u);
    assert.doesNotMatch(answer, /30.*60.*90/u);
  });
});
