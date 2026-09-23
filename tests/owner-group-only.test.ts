// URGENT: OWNER GROUP ONLY -- OTHER LINE GROUPS WORK, OWNER GROUP IS SILENT.
//
// New live evidence this round: an EXISTING, already-bound "activity"
// group replies correctly to ops commands ("รับงาน", "300"), proving the
// LINE webhook, group message receipt, group message reply, and ops
// command routing all work in general. Meanwhile a brand-new "owner"
// group (bot just added, never bound to anything) gets zero response to
// "ผูกทีม เจ้าของ"/"owner"/"admin".
//
// Investigated every handler in the group-text precedence chain
// (handleLinePaymentGroupText, paymentTypedConfirmationGuard,
// handleLineFuelText, handleRestaurantStockText, handleBookingOpsCommand)
// for the specific hypothesis raised this round -- "a bound-group-only
// guard silently drops the bind command before it is ever reached for an
// unbound group." Each one's OWN regex/binding-lookup already excludes
// "ผูกทีม ..." entirely (none of their patterns match that text, so none
// of them ever perform a binding lookup for it) -- this was already true
// before this change and is proven by the tests below going through the
// FULL signed webhook for a genuinely fresh/never-bound target id.
//
// Restructured line-webhook.ts's handleOpsEvent anyway so ผูกทีม is
// checked FIRST, before any of those four handlers, per the owner's own
// stated invariant ("the whole point of binding is that an unbound group
// can run ผูกทีม") -- this removes even the theoretical risk of a future
// change in one of those handlers shadowing it, though it was not found
// to be the actual cause of the reported silence (see THONGTHAI_HANDOFF.md
// for the full diagnosis: this session cannot query live Netlify function
// logs, so it cannot confirm whether the owner group's LINE_EVENT_RECEIVED
// line ever appeared in production).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { withHarness, type Harness } from './helpers/canonical-core-harness';
import { handler as lineWebhookHandler } from '../netlify/functions/line-webhook';

const CHANNEL_SECRET = 'test-owner-group-only-secret';

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
    replyToken: `reply-${groupId}-${text}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: Date.now(),
    source: { type: 'group', groupId, userId },
    message: { id: `msg-${groupId}-${Math.random().toString(36).slice(2, 6)}`, type: 'text', text },
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

test('1. brand-new/unbound group: "ผูกทีม เจ้าของ" is handled immediately, binds owner_general, replies success', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    await callLineWebhook([groupEvent('ผูกทีม เจ้าของ', 'owner-group-fresh-1')]);
    assert.equal(replies.length, 1, 'must never be silent for an unbound group');
    assert.match(replies[0].messages[0]?.text ?? '', /ผูกกลุ่มนี้กับทีม เจ้าของ\/ทั่วไป แล้วครับ/u);
    assert.equal(harness.postsTo('ops_notification_channels').slice(-1)[0]?.team_code, 'owner_general');
  });
});

test('2. brand-new/unbound group: "ผูกทีม owner" is handled the same way', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    await callLineWebhook([groupEvent('ผูกทีม owner', 'owner-group-fresh-2')]);
    assert.equal(replies.length, 1);
    assert.match(replies[0].messages[0]?.text ?? '', /ผูกกลุ่มนี้กับทีม เจ้าของ\/ทั่วไป แล้วครับ/u);
    assert.equal(harness.postsTo('ops_notification_channels').slice(-1)[0]?.team_code, 'owner_general');
  });
});

test('3. brand-new/unbound group: invalid "ผูกทีม abc" replies with the supported team list, never a silent ignore', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([groupEvent('ผูกทีม abc', 'owner-group-fresh-3')]);
    assert.equal(replies.length, 1);
    assert.match(replies[0].messages[0]?.text ?? '', /ยังไม่รู้จักชื่อนี้ครับ ใช้:/u);
  });
});

test('4. an ALREADY-BOUND activity group is unaffected by checking ผูกทีม first -- its own ops commands still work', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    harness.programOpsChannel('activity');
    await callLineWebhook([groupEvent('เช็กทีม', 'line-group-activity')]);
    assert.equal(replies.length, 1, 'a bound group asking its own status must still get a reply');
    assert.match(replies[0].messages[0]?.text ?? '', /เชื่อมกับทีม/u);
  });
});

test('5. brand-new/unbound group sends ordinary chatter ("hello"): safely ignored, never crashes', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    const response = await callLineWebhook([groupEvent('hello', 'owner-group-fresh-5')]);
    assert.equal((response as { statusCode: number }).statusCode, 200);
    assert.equal(replies.length, 0, 'ordinary group chatter with no command is ignored, not answered');
  });
});

test('6. authorization configured: an unauthorized sender in a brand-new group gets an explicit unauthorized reply, never silence', async () => {
  const original = process.env.LINE_OPS_ADMIN_USER_IDS;
  process.env.LINE_OPS_ADMIN_USER_IDS = 'authorized-user-only';
  try {
    await withHarnessAndLine(async (harness, replies) => {
      await callLineWebhook([groupEvent('ผูกทีม เจ้าของ', 'owner-group-fresh-6', 'someone-else')]);
      assert.equal(replies.length, 1);
      assert.equal(replies[0].messages[0]?.text, 'คำสั่งนี้ใช้ได้เฉพาะผู้ดูแลระบบครับ');
      assert.equal(harness.postsTo('ops_notification_channels').length, 0);
    });
  } finally {
    if (original === undefined) delete process.env.LINE_OPS_ADMIN_USER_IDS;
    else process.env.LINE_OPS_ADMIN_USER_IDS = original;
  }
});

test('7. rapid repeated re-binds of the SAME fresh group (reproducing the owner\'s exact sequence) all succeed, none go silent', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    const groupId = 'owner-group-rapid-sequence';
    await callLineWebhook([groupEvent('ผูกทีม เจ้าของ', groupId)]);
    await callLineWebhook([groupEvent('ผูกทีม owner', groupId)]);
    await callLineWebhook([groupEvent('ผูกทีม admin', groupId)]);
    await callLineWebhook([groupEvent('ผูกทีม เจ้าของ', groupId)]);
    assert.equal(replies.length, 4, 'every one of the four rapid rebind attempts must get its own reply, none silently dropped');
    for (const reply of replies) {
      assert.match(reply.messages[0]?.text ?? '', /ผูกกลุ่มนี้กับทีม เจ้าของ\/ทั่วไป แล้วครับ/u);
    }
    const upserts = harness.postsTo('ops_notification_channels').filter(row => row.team_code === 'owner_general');
    assert.ok(upserts.length >= 1);
  });
});
