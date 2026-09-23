// URGENT LINE GROUP BIND DEBUG: owner reported typing "ผูกทีม เจ้าของ"/
// "ผูกทีม owner"/"ผูกทีม admin" in a newly-created LINE group with no bot
// response at all. Investigation (see THONGTHAI_HANDOFF.md's "Owner Group
// Bind Debug" entry for the full trace) found the code path itself is
// correct end-to-end when actually invoked -- every test below proves
// that. The most likely explanation for a truly silent group (webhook
// never even logs receiving the event) is a LINE Official Account
// Manager setting outside this codebase's control (see the handoff doc's
// checklist). Two genuine gaps were found and fixed along the way: no
// authorization existed at all on the bind command (any group member
// could rebind a team's notifications), and there was no safe diagnostic
// logging to distinguish "webhook never received this" from "received it
// but something inside dropped it."
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { withHarness } from './helpers/canonical-core-harness';
import { handleLineOpsGroupMessage } from '../netlify/functions/_ops-notifications';
import { handler as lineWebhookHandler } from '../netlify/functions/line-webhook';

test('1. group message "ผูกทีม เจ้าของ": command handled, upsert owner_general, reply success', async () => {
  await withHarness(async harness => {
    const reply = await handleLineOpsGroupMessage({
      targetType: 'group', targetId: 'owner-group-1', userId: 'staff-1', text: 'ผูกทีม เจ้าของ',
    });
    assert.match(reply ?? '', /ผูกกลุ่มนี้กับทีม เจ้าของ\/ทั่วไป แล้วครับ/u);
    const upserts = harness.postsTo('ops_notification_channels');
    assert.ok(upserts.length >= 1, 'must actually write the binding, not just reply');
    assert.equal(upserts[upserts.length - 1].team_code, 'owner_general');
  });
});

test('2. group message "ผูกทีม owner": same successful bind', async () => {
  await withHarness(async harness => {
    const reply = await handleLineOpsGroupMessage({
      targetType: 'group', targetId: 'owner-group-2', userId: 'staff-1', text: 'ผูกทีม owner',
    });
    assert.match(reply ?? '', /ผูกกลุ่มนี้กับทีม เจ้าของ\/ทั่วไป แล้วครับ/u);
    const upserts = harness.postsTo('ops_notification_channels');
    assert.equal(upserts[upserts.length - 1].team_code, 'owner_general');
  });
});

test('3. Unauthorized sender (when LINE_OPS_ADMIN_USER_IDS is configured): clear unauthorized reply, no upsert, never silent', async () => {
  const original = process.env.LINE_OPS_ADMIN_USER_IDS;
  process.env.LINE_OPS_ADMIN_USER_IDS = 'authorized-user-1,authorized-user-2';
  try {
    await withHarness(async harness => {
      const reply = await handleLineOpsGroupMessage({
        targetType: 'group', targetId: 'owner-group-3', userId: 'random-visitor-99', text: 'ผูกทีม เจ้าของ',
      });
      assert.equal(reply, 'คำสั่งนี้ใช้ได้เฉพาะผู้ดูแลระบบครับ', 'must reply clearly, never silently ignore');
      assert.equal(harness.postsTo('ops_notification_channels').length, 0, 'must never write the binding for an unauthorized sender');
    });
  } finally {
    if (original === undefined) delete process.env.LINE_OPS_ADMIN_USER_IDS;
    else process.env.LINE_OPS_ADMIN_USER_IDS = original;
  }
});

test('3b. Authorized sender (on the configured allowlist): bind still succeeds', async () => {
  const original = process.env.LINE_OPS_ADMIN_USER_IDS;
  process.env.LINE_OPS_ADMIN_USER_IDS = 'authorized-user-1,authorized-user-2';
  try {
    await withHarness(async harness => {
      const reply = await handleLineOpsGroupMessage({
        targetType: 'group', targetId: 'owner-group-3b', userId: 'authorized-user-1', text: 'ผูกทีม เจ้าของ',
      });
      assert.match(reply ?? '', /ผูกกลุ่มนี้กับทีม เจ้าของ\/ทั่วไป แล้วครับ/u);
      assert.ok(harness.postsTo('ops_notification_channels').length >= 1);
    });
  } finally {
    if (original === undefined) delete process.env.LINE_OPS_ADMIN_USER_IDS;
    else process.env.LINE_OPS_ADMIN_USER_IDS = original;
  }
});

test('3c. LINE_OPS_ADMIN_USER_IDS unset (default, not yet configured): any group member can still bind -- never locks the owner out with zero setup', async () => {
  const original = process.env.LINE_OPS_ADMIN_USER_IDS;
  delete process.env.LINE_OPS_ADMIN_USER_IDS;
  try {
    await withHarness(async harness => {
      const reply = await handleLineOpsGroupMessage({
        targetType: 'group', targetId: 'owner-group-3c', userId: 'anyone-at-all', text: 'ผูกทีม เจ้าของ',
      });
      assert.match(reply ?? '', /ผูกกลุ่มนี้กับทีม เจ้าของ\/ทั่วไป แล้วครับ/u);
    });
  } finally {
    if (original === undefined) delete process.env.LINE_OPS_ADMIN_USER_IDS;
    else process.env.LINE_OPS_ADMIN_USER_IDS = original;
  }
});

test('4. Invalid/unsupported team name: replies with the supported team list, never silent', async () => {
  await withHarness(async () => {
    const reply = await handleLineOpsGroupMessage({
      targetType: 'group', targetId: 'owner-group-4', userId: 'staff-1', text: 'ผูกทีม blahblah',
    });
    assert.match(reply ?? '', /ยังไม่รู้จักชื่อนี้ครับ ใช้:/u);
  });
});

test('5. LINE reply-send failure: logged safely (redacted), webhook still returns 200, never crashes', async () => {
  const originalFetch = global.fetch;
  const originalEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    CUSTOMER_PII_ENCRYPTION_KEY: process.env.CUSTOMER_PII_ENCRYPTION_KEY,
    LINE_CHANNEL_SECRET: process.env.LINE_CHANNEL_SECRET,
    LINE_CHANNEL_ACCESS_TOKEN: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  };
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  process.env.CUSTOMER_PII_ENCRYPTION_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
  process.env.LINE_CHANNEL_SECRET = 'test-channel-secret';
  process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-access-token';

  const originalConsoleError = console.error;
  const errorLogs: unknown[][] = [];
  console.error = (...args: unknown[]) => { errorLogs.push(args); };

  global.fetch = (async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    if (href.includes('api.line.me/v2/bot/message/reply')) {
      return new Response('rate limited', { status: 429 });
    }
    if (href.includes('ops_notification_channels')) {
      const method = init?.method ?? 'GET';
      return new Response(method === 'GET' ? '[]' : '[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error(`Unexpected fetch in reply-failure test: ${href}`);
  }) as typeof fetch;

  try {
    const body = JSON.stringify({
      destination: 'test-destination',
      events: [{
        type: 'message',
        replyToken: 'test-reply-token',
        timestamp: Date.now(),
        source: { type: 'group', groupId: 'owner-group-5', userId: 'staff-1' },
        message: { id: 'msg-1', type: 'text', text: 'ผูกทีม เจ้าของ' },
      }],
    });
    const signature = createHmac('sha256', 'test-channel-secret').update(body, 'utf8').digest('base64');

    const response = await lineWebhookHandler(
      { httpMethod: 'POST', headers: { 'x-line-signature': signature }, body } as never,
      {} as never,
    );

    assert.ok(response, 'the handler must never crash/throw even when the LINE reply call fails');
    assert.equal((response as { statusCode: number }).statusCode, 200, 'must still ack the webhook delivery so LINE does not retry-storm');
    const loggedReplyFailure = errorLogs.some(args => args.some(arg => String(arg).includes('LINE_OPS_GROUP_ERROR')));
    assert.ok(loggedReplyFailure, 'the reply failure must be logged, never silently swallowed');
    const leaksAccessToken = errorLogs.some(args => args.some(arg => String(arg).includes('test-access-token')));
    assert.ok(!leaksAccessToken, 'the log must never contain the raw access token');
  } finally {
    global.fetch = originalFetch;
    console.error = originalConsoleError;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('6. Non-command group message: no crash, handled per existing behavior (ignored)', async () => {
  await withHarness(async () => {
    const reply = await handleLineOpsGroupMessage({
      targetType: 'group', targetId: 'owner-group-6', userId: 'staff-1', text: 'สวัสดีครับทุกคน',
    });
    assert.equal(reply, null, 'ordinary staff-group chatter is ignored, not answered');
  });
});
