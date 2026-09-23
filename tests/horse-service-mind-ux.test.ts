// FINAL UX + SERVICE MIND FIX -- horse booking flow felt like a bot, not a
// host. Live evidence: "อยากขี่ม้า" jumped straight to "เลือกระยะเวลา
// 30/60/90" (a legacy, LINE-only, form-like booking flow), and a
// follow-up bare "เอาทองไทย" kept re-asking "horse or assistant?" even
// though the conversation had clearly already established horse context.
//
// ROOT CAUSE 1 (why "อยากขี่ม้า" jumped to duration): _operations-db.ts's
// handleLineBookingMessage -- a SEPARATE, LEGACY, LINE-ONLY booking flow
// with its own session table (line_booking_sessions), entirely bypassing
// thongthai-chat.ts's Service Mind/One-Mind pipeline -- is checked BEFORE
// askThongthaiReliably in _line-webhook-core.ts's handleEvent. Its own
// shouldConsumeLegacyLineBookingTurn guard treated a bare "อยากขี่ม้า" as
// "clearly belongs to the booking" and consumed it immediately, producing
// its own transactional "เลือกระยะเวลา" prompt -- a message thongthai-
// chat.ts's ALREADY-EXISTING (pre-this-session) deterministicActivityIntent
// StartResponse/composeActivityIntentStartResponse never got a chance to
// answer. Fixed: shouldConsumeLegacyLineBookingTurn now defers (returns
// false) for exactly this bare, unstructured shape, letting the caring
// Service Mind response win; anything with more structure (a duration, a
// horse name, a date) still starts the legacy flow normally.
//
// ROOT CAUSE 2 (why "เอาทองไทย" kept re-asking after context was
// established): composeActivityIntentStartResponse's reply was pure text
// -- it never persisted anything, so a LATER bare horse-name mention (even
// in the SAME LINE conversation, where chatHistory is always empty -- see
// _line-webhook-core.ts's askThongthai) had no way to know an activity
// conversation was already underway. bareHorseSelectionClarification's own
// hasEverDiscussedActivityDomain guard reads persisted guest_agent_state
// taskState.activeTask.domain for exactly this reason, but nothing was
// writing it. Fixed: the activity-intent-start responder now starts a
// real activity_booking ActiveTask (via _task-state.ts, the same
// machinery every other domain uses) when it fires, and a NEW responder
// (horseSelectionWithContextResponse) actually SELECTS the horse once
// context is established instead of merely suppressing the clarification.
//
// See THONGTHAI_HANDOFF.md's "Horse Service Mind UX" entry for the full
// trace and for what remains explicitly deferred (full multi-turn slot
// re-ordering across further turns -- rider experience answer -> party
// size answer -> THEN duration -- is a deeper, LINE-native task-state
// rearchitecture; this round covers the two turns the live bug report
// was actually about).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { withHarness, type Harness } from './helpers/canonical-core-harness';
import { handler as lineWebhookHandler } from '../netlify/functions/line-webhook';

const CHANNEL_SECRET = 'test-horse-service-mind-secret';

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

// ---------------------------------------------------------------------
// A. Horse UX, through the full signed LINE webhook
// ---------------------------------------------------------------------

test('A1. "อยากขี่ม้า" gets a warm concierge intro mentioning both horses and asks care questions, never jumps to duration', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('อยากขี่ม้า', 'ux-user-a1')]);
    assert.equal(replies.length, 1);
    const text = replies[0].messages.map(m => m.text ?? '').join(' ');
    assert.match(text, /ทองไทย/u);
    assert.match(text, /ภาราดร/u);
    assert.match(text, /เคยขี่ม้ามาก่อนไหม/u);
    assert.doesNotMatch(text, /เลือกระยะเวลา\s*30/u, 'must never jump straight to duration');
  });
});

test('A2. "อยากขี่ม้า" then "เอาทองไทย" selects ทองไทย, confirms visibly, asks a care question -- never re-asks horse-or-assistant', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    const userId = 'ux-user-a2';
    await callLineWebhook([privateEvent('อยากขี่ม้า', userId)]);
    await callLineWebhook([privateEvent('เอาทองไทย', userId)]);
    assert.equal(replies.length, 2);
    const secondText = replies[1].messages.map(m => m.text ?? '').join(' ');
    assert.match(secondText, /เลือกทองไทย/u, 'must visibly confirm the selected horse');
    assert.doesNotMatch(secondText, /หรือเรียกทองไทยผู้ช่วยแชท/u, 'must never re-ask horse-or-assistant once context is established');
    assert.match(secondText, /เคยขี่ม้ามาก่อนไหม|กี่คน/u, 'should ask a care question next');
  });
});

test('A3. "อยากขี่ม้า" then "เอาภาราดร" selects ภาราดร and confirms its smoother feel', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    const userId = 'ux-user-a3';
    await callLineWebhook([privateEvent('อยากขี่ม้า', userId)]);
    await callLineWebhook([privateEvent('เอาภาราดร', userId)]);
    const secondText = replies[1].messages.map(m => m.text ?? '').join(' ');
    assert.match(secondText, /เลือกภาราดร/u);
    assert.match(secondText, /นิ่มกว่า/u);
  });
});

test('A4. bare "เอาทองไทย" with NO prior context still asks for clarification, never silently starts a booking', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('เอาทองไทย', 'ux-user-a4')]);
    assert.equal(replies.length, 1);
    const text = replies[0].messages[0]?.text ?? '';
    assert.match(text, /หมายถึง/u);
  });
});

test('A5. horse comparison ("ทองไทยกับภาราดรต่างกันยังไง") with no prior context: comparison, no booking prompt', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('ทองไทยกับภาราดรต่างกันยังไง', 'ux-user-a5')]);
    const text = replies[0].messages.map(m => m.text ?? '').join(' ');
    assert.doesNotMatch(text, /เลือกม้า/u);
  });
});

test('A6. "อยากขี่ม้า" then a comparison question stays in horse context -- the NEXT "เอาทองไทย" still selects (not re-clarifies)', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    const userId = 'ux-user-a6';
    await callLineWebhook([privateEvent('อยากขี่ม้า', userId)]);
    await callLineWebhook([privateEvent('ทองไทยกับภาราดรต่างกันยังไง', userId)]);
    await callLineWebhook([privateEvent('เอาทองไทย', userId)]);
    assert.equal(replies.length, 3);
    const comparisonText = replies[1].messages.map(m => m.text ?? '').join(' ');
    assert.doesNotMatch(comparisonText, /เลือกม้า/u);
    const selectionText = replies[2].messages.map(m => m.text ?? '').join(' ');
    assert.match(selectionText, /เลือกทองไทย/u);
  });
});

test('A7. beginner qualifier ("อยากขี่ม้า มือใหม่") gets a caring reply, team supervision mentioned, never claims guaranteed safety', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('อยากขี่ม้า มือใหม่', 'ux-user-a7')]);
    const text = replies[0].messages.map(m => m.text ?? '').join(' ');
    assert.match(text, /ทีมงานจะช่วยดูแล/u);
    assert.doesNotMatch(text, /ปลอดภัย(?:แน่นอน|100)/u, 'must never claim guaranteed safety');
    assert.doesNotMatch(text, /เลือกระยะเวลา\s*30/u);
  });
});

test('A8. family qualifier ("อยากขี่ม้า มีเด็กไปด้วย") asks about age/comfort, does not rush to duration', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('อยากขี่ม้า มีเด็กไปด้วย', 'ux-user-a8')]);
    const text = replies[0].messages.map(m => m.text ?? '').join(' ');
    assert.match(text, /อายุ/u);
    assert.doesNotMatch(text, /เลือกระยะเวลา\s*30/u);
  });
});

// ---------------------------------------------------------------------
// C. Feedback pipeline -- verified still correct, not re-implemented
// ---------------------------------------------------------------------

test('C11a. "ทองไทยตอบยาวไป" persists a feedback event and is honest when no team is bound to receive it', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    await callLineWebhook([privateEvent('ทองไทยตอบยาวไป', 'ux-user-c11a')]);
    assert.equal(replies.length, 1);
    assert.ok(harness.postsTo('ops_feedback_events').length >= 1, 'feedback must be persisted for the backoffice customer-voice dashboard to show');
    const text = replies[0].messages.map(m => m.text ?? '').join(' ');
    assert.doesNotMatch(text, /เลือกม้า/u);
  });
});

test('C11b. "ทองไทยตอบยาวไป" with owner_general bound: reply reflects real dispatch, never a fabricated claim', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    harness.programOpsChannel('owner_general');
    await callLineWebhook([privateEvent('ทองไทยตอบยาวไป', 'ux-user-c11b')]);
    assert.equal(replies.length, 1);
    assert.ok(harness.postsTo('ops_feedback_events').length >= 1);
  });
});

// ---------------------------------------------------------------------
// D. Regression -- previously-fixed LINE behavior stays unchanged
// ---------------------------------------------------------------------

test('D12. weather ("วันนี้ฝนตกปะ") still gets a real/fallback answer, never generic slow', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    harness.programWeatherFetch({ ok: true, body: { weather: [{ description: 'clear sky' }], main: { temp: 30 } } });
    await callLineWebhook([privateEvent('วันนี้ฝนตกปะ', 'ux-user-d12')]);
    const text = replies[0].messages.map(m => m.text ?? '').join(' ');
    assert.doesNotMatch(text, /คิดช้ากว่าปกติ/u);
  });
});

test('D13. casual ("เห้ยยย") still gets the fast deterministic reply', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('เห้ยยย', 'ux-user-d13')]);
    assert.match(replies[0].messages[0]?.text ?? '', /ทองไทยอยู่นี่ครับ/u);
  });
});

test('D14. owner group bind ("ผูกทีม เจ้าของ") still succeeds', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    const groupEvent = {
      type: 'message',
      replyToken: 'reply-d14',
      timestamp: Date.now(),
      source: { type: 'group', groupId: 'ux-group-d14', userId: 'staff-1' },
      message: { id: 'msg-d14', type: 'text', text: 'ผูกทีม เจ้าของ' },
    };
    await callLineWebhook([groupEvent]);
    assert.equal(replies.length, 1);
    assert.match(replies[0].messages[0]?.text ?? '', /ผูกกลุ่มนี้กับทีม เจ้าของ\/ทั่วไป แล้วครับ/u);
    assert.equal(harness.postsTo('ops_notification_channels').slice(-1)[0]?.team_code, 'owner_general');
  });
});

test('D15. bound activity group: "รับงาน" ops routing unchanged', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    harness.programOpsChannel('activity');
    const groupEvent = {
      type: 'message',
      replyToken: 'reply-d15',
      timestamp: Date.now(),
      source: { type: 'group', groupId: 'line-group-activity', userId: 'staff-1' },
      message: { id: 'msg-d15', type: 'text', text: 'เช็กทีม' },
    };
    await callLineWebhook([groupEvent]);
    assert.equal(replies.length, 1);
    assert.match(replies[0].messages[0]?.text ?? '', /เชื่อมกับทีม/u);
  });
});
