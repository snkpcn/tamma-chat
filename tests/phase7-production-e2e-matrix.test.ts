import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { withHarness, type Harness } from './helpers/canonical-core-harness';
import { handler as lineWebhookHandler } from '../netlify/functions/line-webhook';

const SECRET = 'phase7-production-e2e-matrix-secret';
type CapturedReply = { replyToken: string; messages: Array<{ type: string; text?: string }> };
let seq = 0;

function installLineReplyCapture(): { restore: () => void; replies: CapturedReply[] } {
  const original = global.fetch;
  const replies: CapturedReply[] = [];
  global.fetch = (async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    if (href.includes('api.line.me/v2/bot/message/reply')) {
      replies.push(JSON.parse(String(init?.body ?? '{}')) as CapturedReply);
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return original(url as never, init);
  }) as typeof fetch;
  return { replies, restore: () => { global.fetch = original; } };
}

function privateEvent(text: string, userId: string) {
  seq += 1;
  return {
    type: 'message',
    replyToken: `phase7-reply-${seq}`,
    timestamp: Date.now() + seq,
    source: { type: 'user', userId },
    message: { id: `phase7-msg-${seq}`, type: 'text', text },
  };
}

async function callLine(text: string, userId: string) {
  const body = JSON.stringify({ destination: 'phase7-test', events: [privateEvent(text, userId)] });
  const signature = createHmac('sha256', SECRET).update(body, 'utf8').digest('base64');
  return lineWebhookHandler(
    { httpMethod: 'POST', headers: { 'x-line-signature': signature }, body } as never,
    {} as never,
  );
}

async function withLineMatrix<T>(run: (harness: Harness, replies: CapturedReply[]) => Promise<T>): Promise<T> {
  const old = process.env.LINE_CHANNEL_SECRET;
  process.env.LINE_CHANNEL_SECRET = SECRET;
  try {
    return await withHarness(async harness => {
      const capture = installLineReplyCapture();
      try {
        return await run(harness, capture.replies);
      } finally {
        capture.restore();
      }
    });
  } finally {
    if (old === undefined) delete process.env.LINE_CHANNEL_SECRET;
    else process.env.LINE_CHANNEL_SECRET = old;
  }
}

function replyText(replies: CapturedReply[], index: number): string {
  return replies[index]?.messages.map(m => m.text ?? '').join('\n') ?? '';
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
  const id = harness.guestDbId(lineGuestId(userId));
  if (!id) return [];
  const value = harness.getGuestMemory(id, 'constraints');
  return Array.isArray(value) ? value.map(String) : [];
}

test('Phase 7 matrix: LINE chatHistory=[] still carries durable restaurant constraints across separate webhooks', async () => {
  await withLineMatrix(async (harness, replies) => {
    const userId = 'phase7-restaurant-memory';
    await callLine('ไม่กินไก่ ไม่กินกุ้ง', userId);
    await callLine('ร้านอาหารมีอะไรแนะนำ', userId);

    const constraints = constraintsOf(harness, userId);
    assert.ok(constraints.includes('no_chicken'));
    assert.ok(constraints.includes('no_shrimp'));

    const recommendation = replyText(replies, 1);
    assert.match(recommendation, /ข้าวผัดหมู|หมู|อาหาร|เมนู/u);
    assert.match(recommendation, /เลี่ยงกุ้ง\/ไก่|เลี่ยง.*กุ้ง.*ไก่/u, 'reply should naturally acknowledge the durable constraint');
    const recommendedItems = recommendation.split('\n').filter(line => line.trim().startsWith('•'));
    assert.ok(recommendedItems.length >= 1);
    for (const item of recommendedItems) {
      assert.doesNotMatch(item, /ผัดไทย|ต้มยำกุ้ง|กุ้ง|ไก่/u, 'recommended item lines must respect durable constraints');
    }
  });
});

test('Phase 7 matrix: LINE contextual follow-up survives separate webhook deliveries without transport chat history', async () => {
  await withLineMatrix(async (harness, replies) => {
    const userId = 'phase7-ecosystem-followup';
    await callLine('มีอะไรแนะนำ', userId);
    await callLine('สายกิจกรรม', userId);

    const answer = replyText(replies, 1);
    assert.match(answer, /ขี่ม้า/u);
    assert.match(answer, /ATV|เอทีวี/u);
    assert.match(answer, /ยิงธนู/u);
    assert.equal(harness.postsTo('bookings').length, 0, 'discovery must not create a transaction');
  });
});

test('Phase 7 matrix: LINE horse selection remains ภาราดร, then location/weather explicitly override stale horse state', async () => {
  await withLineMatrix(async (harness, replies) => {
    harness.programWeatherFetch({
      ok: true,
      body: {
        weather: [{ description: 'เมฆบางส่วน' }],
        main: { temp: 30, feels_like: 33, humidity: 70 },
        wind: { speed: 2 },
        rain: {},
      },
    });

    const userId = 'phase7-horse-switch';
    await callLine('อยากขี่ม้า', userId);
    await callLine('เอาภาราดร', userId);
    const selected = replyText(replies, 1);
    assert.match(selected, /เลือกภาราดร/u);
    assert.doesNotMatch(selected, /เลือกทองไทย/u);

    await callLine('ทำมา-ชาติอยู่ที่ไหน', userId);
    const location = replyText(replies, 2);
    assert.match(location, /maps\.app\.goo\.gl|ปักหมุด/u);
    assert.doesNotMatch(location, /เคยขี่ม้า|เลือกม้า|ระยะเวลา 30/u);

    await callLine('วันนี้ฝนตกไหม', userId);
    const weather = replyText(replies, 3);
    assert.match(weather, /ฝน|เมฆ|30/u);
    assert.doesNotMatch(weather, /เคยขี่ม้า|เลือกม้า|ระยะเวลา 30/u);
  });
});

test('Phase 7 matrix: ATV safety creates one feedback case and notifies both activity + owner channels', async () => {
  await withLineMatrix(async (harness, replies) => {
    harness.programOpsChannel('activity');
    harness.programOpsChannel('owner_general');

    const userId = 'phase7-atv-safety';
    await callLine('อยากเล่น ATV', userId);
    assert.match(replyText(replies, 0), /ATV|เอทีวี/u);

    await callLine('พื้นลื่นมาก ตอนเล่น ATV น่ากลัว', userId);
    const safety = replyText(replies, 1);
    assert.match(safety, /ส่งให้ทีมกิจกรรมและเจ้าของตรวจสอบแล้วครับ/u);
    assert.doesNotMatch(safety, /เลือกระยะเวลา\s*30/u);

    const events = harness.postsTo('ops_feedback_events');
    assert.equal(events.length, 1);
    assert.equal(events[0]?.feedback_type, 'safety_issue');
    assert.equal(events[0]?.business_unit, 'activity');

    const deliveries = harness.notificationDeliveries()
      .filter(row => row.entityId === 'feedback-event-1');
    assert.equal(deliveries.find(row => row.teamCode === 'activity')?.status, 'sent');
    assert.equal(deliveries.find(row => row.teamCode === 'owner_general')?.status, 'sent');

    assert.equal(harness.postsTo('line_push').filter(row => row.to === 'line-group-activity').length, 1);
    assert.equal(harness.postsTo('line_push').filter(row => row.to === 'line-group-owner_general').length, 1);
  });
});

test('Phase 7 matrix: refund stays inside authority boundary and routes to owner without promising approval', async () => {
  await withLineMatrix(async (harness, replies) => {
    harness.programOpsChannel('owner_general');

    await callLine('ขอคืนเงินได้ไหม', 'phase7-refund');
    const answer = replyText(replies, 0);
    assert.match(answer, /คืนเงิน|เงื่อนไขการชำระ/u);
    assert.match(answer, /ไม่ยืนยันแทนเจ้าของ|เจ้าของ/u);
    assert.doesNotMatch(answer, /คืนเงินได้แน่นอน|อนุมัติแล้ว|รับรอง/u);

    const event = harness.postsTo('ops_feedback_events')[0];
    assert.ok(event, 'refund boundary must create an owner-routed feedback/escalation case');
    assert.equal(event.route_target, 'owner_general');
    assert.equal(harness.notificationDeliveries().find(row => row.teamCode === 'owner_general')?.status, 'sent');
  });
});

test('Phase 7 matrix: durable personalization on LINE never beats an explicit later intent', async () => {
  await withLineMatrix(async (_harness, replies) => {
    const userId = 'phase7-personalization';
    await callLine('ขอแบบชิลๆ มากับแฟน', userId);
    await callLine('มีอะไรแนะนำ', userId);
    const personalized = replyText(replies, 1);
    assert.match(personalized, /ชิล|แฟน|พระอาทิตย์ตก|คาเฟ่/u);

    await callLine('ทำมา-ชาติอยู่ที่ไหน', userId);
    const location = replyText(replies, 2);
    assert.match(location, /maps\.app\.goo\.gl|ปักหมุด/u);
    assert.doesNotMatch(location, /ถ้ายัง.*ชิล|มากับแฟน/u);
  });
});
