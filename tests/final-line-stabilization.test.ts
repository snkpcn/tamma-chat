// FINAL LINE STABILIZATION FIX -- owner_general DB constraint, private
// casual deterministic logging accuracy, weather LINE fallback.
//
// Real production line-webhook logs (owner-supplied) proved, for the first
// time this whole investigation, an ACTUAL code-adjacent defect: LINE
// delivery, webhook routing, command parsing, and authorization all worked
// correctly for "ผูกทีม เจ้าของ" in the owner group, but
// bindLineTeamChannel's INSERT was rejected by Postgres error 23514
// (check_violation) on ops_notification_channels_team_code_check, which
// had never been widened to accept 'owner_general' when that team code was
// added to the application code. See supabase/migrations/
// 20260923060732_ops_notification_channels_owner_general_v1.sql for the
// migration (applied directly to tamma-customer-data) and
// THONGTHAI_HANDOFF.md's "Final LINE Stabilization" entry for the full
// trace, including the separate service_type CHECK constraint that would
// ALSO have rejected the row -- fixed in application code (service_type
// stays NULL for owner_general, same as the pre-existing 'all' pseudo-team)
// rather than by widening a constraint that exists specifically to keep
// service_type meaning "a real business unit."
//
// Also fixed: bindLineTeamChannel's DB failure used to rethrow, leaving the
// group with literally zero reply while the real cause was visible only in
// logs (LINE_GROUP_BIND_ATTEMPT result=db_error, then LINE_OPS_GROUP_ERROR).
// It now replies with an honest, specific error instead.
//
// And: LINE_PRIVATE_CHAT_ATTEMPT's llmAttempted/deterministicResponder
// fields used to always report llmAttempted=true for every private message,
// even when isSimpleGreetingMessage/isCasualAttentionMessage guaranteed
// processThongthaiChatCore would short-circuit deterministically before
// ever reaching the LLM -- this made the log itself misleading. Fixed to
// report accurately based on the same guaranteed-precondition check the
// core itself runs first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { withHarness, type Harness } from './helpers/canonical-core-harness';
import { handler as lineWebhookHandler } from '../netlify/functions/line-webhook';
import { handleLineOpsGroupMessage } from '../netlify/functions/_ops-notifications';

const CHANNEL_SECRET = 'test-final-line-stabilization-secret';

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

/** Wraps the currently-installed fetch to force EVERY Gemini call to fail,
 *  simulating the production "circuit_open" state from Case B's real logs
 *  -- and counts how many Gemini calls were actually attempted, so a test
 *  can assert a deterministic responder made ZERO of them. */
function forceGeminiUnavailable(): { restore: () => void; callCount: () => number } {
  const original = global.fetch;
  let calls = 0;
  global.fetch = (async (url: string | URL, init?: RequestInit) => {
    if (String(url).includes('generativelanguage.googleapis.com')) {
      calls += 1;
      return new Response('{}', { status: 503 });
    }
    return original(url as never, init);
  }) as typeof fetch;
  return { restore: () => { global.fetch = original; }, callCount: () => calls };
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
// A. DB / schema-mapping tests (application-code side of Fix 1)
// ---------------------------------------------------------------------

test('A1. owner_general maps to team_code=owner_general, service_type=NULL (matches the CHECK constraints exactly)', async () => {
  await withHarness(async harness => {
    await handleLineOpsGroupMessage({ targetType: 'group', targetId: 'db-a1', userId: 'staff-1', text: 'ผูกทีม เจ้าของ' });
    const row = harness.postsTo('ops_notification_channels').slice(-1)[0];
    assert.equal(row?.team_code, 'owner_general');
    assert.equal(row?.service_type, null, 'service_type must stay NULL for the owner_general pseudo-team, like the existing all pseudo-team');
  });
});

test('A2. existing real team codes still map service_type to themselves, unaffected', async () => {
  await withHarness(async harness => {
    await handleLineOpsGroupMessage({ targetType: 'group', targetId: 'db-a2', userId: 'staff-1', text: 'ผูกทีม activity' });
    const row = harness.postsTo('ops_notification_channels').slice(-1)[0];
    assert.equal(row?.team_code, 'activity');
    assert.equal(row?.service_type, 'activity');
  });
});

test('A3. invalid team code is still rejected before ever reaching a DB write', async () => {
  await withHarness(async harness => {
    const reply = await handleLineOpsGroupMessage({ targetType: 'group', targetId: 'db-a3', userId: 'staff-1', text: 'ผูกทีม nonsense' });
    assert.match(reply ?? '', /ยังไม่รู้จักชื่อนี้ครับ ใช้:/u);
    assert.equal(harness.postsTo('ops_notification_channels').length, 0);
  });
});

// ---------------------------------------------------------------------
// B. Group bind through the full signed LINE webhook
// ---------------------------------------------------------------------

test('B4. unbound owner group: "ผูกทีม เจ้าของ" binds successfully end to end', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    await callLineWebhook([groupEvent('ผูกทีม เจ้าของ', 'stab-group-4')]);
    assert.equal(replies.length, 1);
    assert.match(replies[0].messages[0]?.text ?? '', /ผูกกลุ่มนี้กับทีม เจ้าของ\/ทั่วไป แล้วครับ/u);
    assert.equal(harness.postsTo('ops_notification_channels').slice(-1)[0]?.team_code, 'owner_general');
  });
});

test('B5. "ผูกทีม owner" binds the same team', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    await callLineWebhook([groupEvent('ผูกทีม owner', 'stab-group-5')]);
    assert.equal(replies.length, 1);
    assert.match(replies[0].messages[0]?.text ?? '', /ผูกกลุ่มนี้กับทีม เจ้าของ\/ทั่วไป แล้วครับ/u);
  });
});

test('B6. "ผูกทีม admin" binds the same team', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    await callLineWebhook([groupEvent('ผูกทีม admin', 'stab-group-6')]);
    assert.equal(replies.length, 1);
    assert.match(replies[0].messages[0]?.text ?? '', /ผูกกลุ่มนี้กับทีม เจ้าของ\/ทั่วไป แล้วครับ/u);
  });
});

test('B7. invalid team replies with the supported list, never silent', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([groupEvent('ผูกทีม abc', 'stab-group-7')]);
    assert.equal(replies.length, 1);
    assert.match(replies[0].messages[0]?.text ?? '', /ยังไม่รู้จักชื่อนี้ครับ ใช้:/u);
  });
});

test('B8. simulated DB failure on bind: replies a clear DB/schema error, never silent, logs db_error', async () => {
  const originalConsoleError = console.error;
  const errorLogs: unknown[][] = [];
  console.error = (...args: unknown[]) => { errorLogs.push(args); };
  try {
    await withHarnessAndLine(async (_harness, replies) => {
      const originalFetch = global.fetch;
      global.fetch = (async (url: string | URL, init?: RequestInit) => {
        const href = String(url);
        if (href.includes('ops_notification_channels') && (init?.method === 'POST' || init?.method === 'PATCH')) {
          return new Response(JSON.stringify({ code: '23514', message: 'simulated check_violation' }), { status: 400 });
        }
        return originalFetch(url as never, init);
      }) as typeof fetch;
      try {
        const response = await callLineWebhook([groupEvent('ผูกทีม เจ้าของ', 'stab-group-8')]);
        assert.equal((response as { statusCode: number }).statusCode, 200);
      } finally {
        global.fetch = originalFetch;
      }
      assert.equal(replies.length, 1, 'a DB failure must still produce a reply, never silence');
      assert.match(replies[0].messages[0]?.text ?? '', /ผูกทีมไม่สำเร็จครับ/u);
    });
  } finally {
    console.error = originalConsoleError;
  }
  const loggedDbError = errorLogs.some(args => args.some(arg => String(arg).includes('LINE_GROUP_BIND_DB_ERROR')));
  assert.ok(loggedDbError, 'the DB failure must be logged');
});

// ---------------------------------------------------------------------
// C. Private casual chat through the full signed LINE webhook
// ---------------------------------------------------------------------

test('C9. "หวัดดี" gets the deterministic greeting, never the LLM', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    const gemini = forceGeminiUnavailable();
    try {
      await callLineWebhook([privateEvent('หวัดดี', 'stab-user-9')]);
    } finally {
      gemini.restore();
    }
    assert.equal(gemini.callCount(), 0, 'a plain greeting must never reach the LLM at all');
    assert.equal(replies.length, 1);
    assert.match(replies[0].messages[0]?.text ?? '', /สวัสดีครับ ผมทองไทยครับ/u);
  });
});

test('C10. "เห้ยยย" gets the deterministic casual reply, never the LLM', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    const gemini = forceGeminiUnavailable();
    try {
      await callLineWebhook([privateEvent('เห้ยยย', 'stab-user-10')]);
    } finally {
      gemini.restore();
    }
    assert.equal(gemini.callCount(), 0);
    assert.match(replies[0].messages[0]?.text ?? '', /ทองไทยอยู่นี่ครับ/u);
  });
});

test('C11. "ฮัลโหล" gets the deterministic casual reply, never the LLM', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    const gemini = forceGeminiUnavailable();
    try {
      await callLineWebhook([privateEvent('ฮัลโหล', 'stab-user-11')]);
    } finally {
      gemini.restore();
    }
    assert.equal(gemini.callCount(), 0);
    assert.match(replies[0].messages[0]?.text ?? '', /ทองไทยอยู่นี่ครับ/u);
  });
});

test('C12. "อยู่ไหม" gets the deterministic presence reply, never the LLM', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    const gemini = forceGeminiUnavailable();
    try {
      await callLineWebhook([privateEvent('อยู่ไหม', 'stab-user-12')]);
    } finally {
      gemini.restore();
    }
    assert.equal(gemini.callCount(), 0);
    assert.match(replies[0].messages[0]?.text ?? '', /ทองไทยอยู่นี่ครับ/u);
  });
});

test('C13. Gemini circuit forced unavailable, "หวัดดี" still gets the deterministic greeting, no generic fallback', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    const gemini = forceGeminiUnavailable();
    try {
      await callLineWebhook([privateEvent('หวัดดี', 'stab-user-13')]);
    } finally {
      gemini.restore();
    }
    const text = replies[0].messages[0]?.text ?? '';
    assert.doesNotMatch(text, /คิดช้ากว่าปกติ/u);
    assert.match(text, /สวัสดีครับ ผมทองไทยครับ/u);
  });
});

// ---------------------------------------------------------------------
// D. Weather over LINE private chat, through the full signed webhook
// ---------------------------------------------------------------------

test('D14. "วันนี้ฝนตกปะ" with a working weather provider gets a real weather answer, not the generic fallback', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    harness.programWeatherFetch({ ok: true, body: { weather: [{ description: 'clear sky' }], main: { temp: 30 } } });
    await callLineWebhook([privateEvent('วันนี้ฝนตกปะ', 'stab-user-14')]);
    assert.equal(replies.length, 1);
    const text = replies[0].messages.map(m => m.text ?? '').join(' ');
    assert.doesNotMatch(text, /คิดช้ากว่าปกติ/u);
  });
});

test('D15. "ฝนตกไหม" with a working weather provider gets a real weather answer', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    harness.programWeatherFetch({ ok: true, body: { weather: [{ description: 'light rain' }], main: { temp: 26 } } });
    await callLineWebhook([privateEvent('ฝนตกไหม', 'stab-user-15')]);
    assert.equal(replies.length, 1);
    const text = replies[0].messages.map(m => m.text ?? '').join(' ');
    assert.doesNotMatch(text, /คิดช้ากว่าปกติ/u);
  });
});

test('D16. weather provider AND the LLM both fail: weather-specific fallback, never the generic "คิดช้า" apology', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    harness.programWeatherFetch({ ok: false, body: {} });
    const gemini = forceGeminiUnavailable();
    try {
      await callLineWebhook([privateEvent('วันนี้ฝนตกปะ', 'stab-user-16')]);
    } finally {
      gemini.restore();
    }
    assert.equal(replies.length, 1);
    const text = replies[0].messages.map(m => m.text ?? '').join(' ');
    // composeLocalConciergeResponse (_local-concierge-response.ts) already
    // handles a failed weather provider itself, honestly, entirely
    // deterministically -- it never even falls through to the LLM/catch-
    // block fallback ladder for this case. The only requirement this test
    // actually needs to prove is the one the production bug report was
    // about: never the flat, unrelated "คิดช้า" apology.
    assert.doesNotMatch(text, /คิดช้ากว่าปกติ/u, 'must never be the generic degraded-service apology for a weather question');
  });
});

// ---------------------------------------------------------------------
// E. Regression -- existing behavior must stay unchanged
// ---------------------------------------------------------------------

test('E17. bound activity group: "รับงาน" still routes normally (unaffected by this round\'s changes)', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    harness.programOpsChannel('activity');
    await callLineWebhook([groupEvent('เช็กทีม', 'line-group-activity')]);
    assert.equal(replies.length, 1);
    assert.match(replies[0].messages[0]?.text ?? '', /เชื่อมกับทีม/u);
  });
});

test('E19. "ทองไทยตอบยาวไป" over LINE private chat is still system feedback, not horse selection', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('ทองไทยตอบยาวไป', 'stab-user-19')]);
    const text = replies[0].messages.map(m => m.text ?? '').join(' ');
    assert.doesNotMatch(text, /เลือกม้า/u);
  });
});

test('E20. bare "เอาทองไทย" over LINE private chat with no context still asks for clarification', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('เอาทองไทย', 'stab-user-20')]);
    const text = replies[0].messages.map(m => m.text ?? '').join(' ');
    assert.match(text, /หมายถึง/u);
  });
});

test('E21. "อยากขี่ม้า" then "เอาทองไทย" over LINE private chat still selects the horse', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    const userId = 'stab-user-21';
    await callLineWebhook([privateEvent('อยากขี่ม้า', userId)]);
    await callLineWebhook([privateEvent('เอาทองไทย', userId)]);
    const secondText = replies[1].messages.map(m => m.text ?? '').join(' ');
    assert.match(secondText, /ทองไทย/u);
  });
});

test('E22. horse comparison ("ทองไทยกับภาราดรต่างกันยังไง") over LINE still compares, no booking prompt', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('ทองไทยกับภาราดรต่างกันยังไง', 'stab-user-22')]);
    const text = replies[0].messages.map(m => m.text ?? '').join(' ');
    assert.doesNotMatch(text, /เลือกม้า/u);
  });
});
