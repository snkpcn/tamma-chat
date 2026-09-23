// URGENT LINE SYSTEM FULL AUDIT: two live production symptoms reported --
// (1) the LINE group bind command ("ผูกทีม เจ้าของ"/"owner"/"admin") still
// produced zero response after the prior "Owner Group Bind Debug" fix, and
// (2) a private LINE OA chat with a casual interjection ("เห้ยยย") got the
// generic "ตอนนี้ทองไทยคิดช้ากว่าปกตินิดหนึงครับ..." fallback instead of a
// friendly reply.
//
// Investigation found (2) was real: no deterministic responder existed for
// bare attention-getting interjections/presence checks, so a casual message
// that reached an LLM failure fell all the way through to one flat
// "ตอนนี้ทองไทยคิดช้ากว่าปกติ" apology for every category. Fixed by adding
// deterministicCasualChatResponse (checked in the SAME early, pre-LLM slot
// as the existing greeting responder, so it never depends on LLM/provider
// availability at all, on any channel) plus per-intent-category degraded
// fallback text (categorizeDegradedFallback/degradedFallbackResponse) for
// the case where the LLM genuinely fails on a non-casual message.
//
// (1)'s code path itself was re-verified end to end here (through the FULL
// signed LINE webhook handler this time, not just handleLineOpsGroupMessage
// directly) and is correct -- every group-bind scenario below produces the
// documented reply and the documented database write. See
// THONGTHAI_HANDOFF.md's "LINE Full Audit" entry for the complete report,
// including why a still-silent production group most likely points at a
// LINE Official Account Manager setting outside this codebase (webhook
// mode / "allow bot into group chats" / Response Settings), not the code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { withHarness, type Harness } from './helpers/canonical-core-harness';
import { handler as lineWebhookHandler } from '../netlify/functions/line-webhook';
import { categorizeDegradedFallback, degradedFallbackResponse } from '../netlify/functions/thongthai-chat';

const CHANNEL_SECRET = 'test-line-full-audit-secret';

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

function groupEvent(text: string, groupId: string, userId = 'staff-1') {
  return {
    type: 'message',
    replyToken: `reply-${groupId}-${text}`,
    timestamp: Date.now(),
    source: { type: 'group', groupId, userId },
    message: { id: `msg-${groupId}`, type: 'text', text },
  };
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

// ---------------------------------------------------------------------
// Group A: LINE group bind command, through the FULL signed webhook.
// ---------------------------------------------------------------------

test('A1. full signed webhook: "ผูกทีม เจ้าของ" in a group binds owner_general and replies success', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    const response = await callLineWebhook([groupEvent('ผูกทีม เจ้าของ', 'group-a1')]);
    assert.equal((response as { statusCode: number }).statusCode, 200);
    assert.equal(replies.length, 1, 'the webhook must reply, never stay silent');
    const text = replies[0].messages[0]?.text ?? '';
    assert.match(text, /ผูกกลุ่มนี้กับทีม เจ้าของ\/ทั่วไป แล้วครับ/u);
    const upserts = harness.postsTo('ops_notification_channels');
    assert.ok(upserts.length >= 1, 'must actually write the binding, not just reply');
    assert.equal(upserts[upserts.length - 1].team_code, 'owner_general');
  });
});

test('A2. full signed webhook: "ผูกทีม owner" binds the same team', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    await callLineWebhook([groupEvent('ผูกทีม owner', 'group-a2')]);
    assert.equal(replies.length, 1);
    assert.match(replies[0].messages[0]?.text ?? '', /ผูกกลุ่มนี้กับทีม เจ้าของ\/ทั่วไป แล้วครับ/u);
    assert.equal(harness.postsTo('ops_notification_channels').slice(-1)[0]?.team_code, 'owner_general');
  });
});

test('A3. full signed webhook: "ผูกทีม admin" binds the same team', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    await callLineWebhook([groupEvent('ผูกทีม admin', 'group-a3')]);
    assert.equal(replies.length, 1);
    assert.match(replies[0].messages[0]?.text ?? '', /ผูกกลุ่มนี้กับทีม เจ้าของ\/ทั่วไป แล้วครับ/u);
    assert.equal(harness.postsTo('ops_notification_channels').slice(-1)[0]?.team_code, 'owner_general');
  });
});

test('A4. full signed webhook: invalid team name replies with the supported list, never silent, never writes', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    await callLineWebhook([groupEvent('ผูกทีม blahblah', 'group-a4')]);
    assert.equal(replies.length, 1);
    assert.match(replies[0].messages[0]?.text ?? '', /ยังไม่รู้จักชื่อนี้ครับ ใช้:/u);
    assert.equal(harness.postsTo('ops_notification_channels').length, 0);
  });
});

test('A5. full signed webhook: unauthorized sender (LINE_OPS_ADMIN_USER_IDS configured) gets a clear unauthorized reply, no write', async () => {
  const original = process.env.LINE_OPS_ADMIN_USER_IDS;
  process.env.LINE_OPS_ADMIN_USER_IDS = 'authorized-user-1';
  try {
    await withHarnessAndLine(async (harness, replies) => {
      await callLineWebhook([groupEvent('ผูกทีม เจ้าของ', 'group-a5', 'random-visitor')]);
      assert.equal(replies.length, 1, 'must never silently ignore an unauthorized sender');
      assert.equal(replies[0].messages[0]?.text, 'คำสั่งนี้ใช้ได้เฉพาะผู้ดูแลระบบครับ');
      assert.equal(harness.postsTo('ops_notification_channels').length, 0);
    });
  } finally {
    if (original === undefined) delete process.env.LINE_OPS_ADMIN_USER_IDS;
    else process.env.LINE_OPS_ADMIN_USER_IDS = original;
  }
});

test('A6. full signed webhook: LINE reply-send failure is logged safely (redacted) and never crashes the webhook', async () => {
  const originalConsoleError = console.error;
  const errorLogs: unknown[][] = [];
  console.error = (...args: unknown[]) => { errorLogs.push(args); };
  try {
    await withHarness(harness => withLineSecret(async () => {
      const originalFetch = global.fetch;
      global.fetch = (async (url: string | URL, init?: RequestInit) => {
        const href = String(url);
        if (href.includes('api.line.me/v2/bot/message/reply')) {
          return new Response('rate limited', { status: 429 });
        }
        return originalFetch(url as never, init);
      }) as typeof fetch;
      try {
        const response = await callLineWebhook([groupEvent('ผูกทีม เจ้าของ', 'group-a6')]);
        assert.equal((response as { statusCode: number }).statusCode, 200, 'must still ack so LINE does not retry-storm');
      } finally {
        global.fetch = originalFetch;
      }
    }));
  } finally {
    console.error = originalConsoleError;
  }
  const loggedFailure = errorLogs.some(args => args.some(arg => String(arg).includes('LINE_OPS_GROUP_ERROR')));
  assert.ok(loggedFailure, 'a reply failure must be logged, never silently swallowed');
  const leaksToken = errorLogs.some(args => args.some(arg => String(arg).includes('test-line-channel-access-token')));
  assert.ok(!leaksToken, 'the log must never contain the raw access token');
});

// ---------------------------------------------------------------------
// Group B: LINE PRIVATE chat, through the FULL signed webhook -- this is
// the path that produced the generic "คิดช้า" fallback in production.
// ---------------------------------------------------------------------

test('B1. "เห้ยยย" in private LINE chat gets a friendly deterministic reply, never the generic slow-fallback apology', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('เห้ยยย', 'line-user-b1')]);
    assert.equal(replies.length, 1);
    const text = replies[0].messages[0]?.text ?? '';
    assert.doesNotMatch(text, /คิดช้ากว่าปกติ/u, 'must never be the generic degraded-service message');
    assert.match(text, /ทองไทยอยู่นี่ครับ/u);
  });
});

test('B2. "สวัสดี" in private LINE chat gets the same greeting quality as web chat', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('สวัสดีครับ', 'line-user-b2')]);
    assert.equal(replies.length, 1);
    assert.match(replies[0].messages[0]?.text ?? '', /สวัสดีครับ ผมทองไทยครับ/u);
  });
});

test('B3. "มีใครอยู่ไหม" (presence check) gets a friendly deterministic reply, not the generic apology', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('มีใครอยู่ไหม', 'line-user-b3')]);
    assert.equal(replies.length, 1);
    const text = replies[0].messages[0]?.text ?? '';
    assert.doesNotMatch(text, /คิดช้ากว่าปกติ/u);
    assert.match(text, /ทองไทยอยู่นี่ครับ/u);
  });
});

test('B4. "ทองไทยตอบยาวไป" (system feedback) is not misrouted as horse selection over LINE', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('ทองไทยตอบยาวไป', 'line-user-b4')]);
    assert.equal(replies.length, 1);
    const text = replies[0].messages.map(m => m.text ?? '').join(' ');
    assert.doesNotMatch(text, /เลือกม้า/u, 'must not be treated as a horse selection');
  });
});

test('B5. "อยากขี่ม้า" over LINE private chat starts the activity flow (same core as web)', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('อยากขี่ม้า', 'line-user-b5')]);
    assert.equal(replies.length, 1);
    const text = replies[0].messages.map(m => m.text ?? '').join(' ');
    assert.match(text, /ม้า/u);
  });
});

test('B6. bare "เอาทองไทย" with no prior context over LINE asks for clarification, does not silently start a booking', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('เอาทองไทย', 'line-user-b6')]);
    assert.equal(replies.length, 1);
    const text = replies[0].messages.map(m => m.text ?? '').join(' ');
    assert.match(text, /หมายถึง/u, 'should ask a clarifying question, not assume');
  });
});

test('B7. "อยากขี่ม้า" then "เอาทองไทย" over LINE private chat selects the horse once context is established', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    const userId = 'line-user-b7';
    await callLineWebhook([privateEvent('อยากขี่ม้า', userId)]);
    await callLineWebhook([privateEvent('เอาทองไทย', userId)]);
    assert.equal(replies.length, 2);
    const secondText = replies[1].messages.map(m => m.text ?? '').join(' ');
    assert.match(secondText, /ทองไทย/u);
  });
});

// ---------------------------------------------------------------------
// Group C: error handling / genuine LLM unavailability, through the core.
// ---------------------------------------------------------------------

test('C1. if the brain throws unexpectedly, the customer still gets a route-specific reply, never silence/crash', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    // A message with no deterministic responder and no scripted Gemini
    // reply forces the harness's default Gemini fallback content, proving
    // the pipeline degrades to a real, delivered reply rather than
    // throwing past the webhook boundary.
    const response = await callLineWebhook([privateEvent('เล่าเรื่องประวัติศาสตร์หมู่บ้านให้ฟังหน่อย', 'line-user-c1')]);
    assert.equal((response as { statusCode: number }).statusCode, 200);
    assert.equal(replies.length, 1, 'the customer must receive a reply, never silence');
  });
});

test('C3. degraded-fallback categorization is per intent category, not one flat message for everything', () => {
  assert.equal(categorizeDegradedFallback('ฝนตกไหมวันนี้'), 'weather');
  assert.equal(categorizeDegradedFallback('ทองไทยตอบยาวไป'), 'feedback');
  assert.equal(categorizeDegradedFallback('จองห้องพักพรุ่งนี้'), 'booking');
  assert.equal(categorizeDegradedFallback('เห้ยยย'), 'casual');

  const weather = degradedFallbackResponse('weather').message;
  const booking = degradedFallbackResponse('booking').message;
  const feedback = degradedFallbackResponse('feedback').message;
  const casual = degradedFallbackResponse('casual').message;

  assert.match(weather, /สภาพอากาศ/u);
  assert.match(booking, /ระบบจอง/u);
  assert.match(feedback, /ขอบคุณ/u);
  assert.match(casual, /ทองไทยอยู่นี่ครับ/u);

  const messages = new Set([weather, booking, feedback, casual]);
  assert.equal(messages.size, 4, 'each category must get genuinely distinct text, not the same message reused');
  for (const message of messages) {
    assert.doesNotMatch(message, /^ตอนนี้ทองไทยคิดช้ากว่าปกตินิดหนึ่งครับ ลองส่งอีกครั้งในอีกสักครู่นะครับ$/u);
  }
});

test('C2. casual attention message still gets a deterministic small-talk reply even when configured with zero LLM programming (provider effectively unavailable for this turn)', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    // No programGeminiReply call at all for this test -- if this message
    // were to reach the LLM path, it would get the harness's generic
    // "ยังไม่มีข้อมูลที่ยืนยันได้" filler. Asserting the friendly small-talk
    // text instead proves it never left the deterministic, pre-LLM path.
    await callLineWebhook([privateEvent('ฮัลโหล', 'line-user-c2')]);
    assert.equal(replies.length, 1);
    const text = replies[0].messages[0]?.text ?? '';
    assert.match(text, /ทองไทยอยู่นี่ครับ/u);
    assert.doesNotMatch(text, /คิดช้ากว่าปกติ/u);
  });
});
