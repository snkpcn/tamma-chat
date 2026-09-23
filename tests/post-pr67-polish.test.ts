// POST-PR67 POLISH -- safety escalation to owner_general + domain team,
// LINE response brevity, host-style restaurant advice, and customer
// replies that match the real notification result. See
// THONGTHAI_HANDOFF.md's "Post-PR67 Polish" entry for the full writeup.
//
// Section A (Task 1 + Task 4): a safety_issue ALWAYS routes to
// unique([domainTeam, owner_general]) -- not just when severity is
// 'urgent' (the real production gap: SAFETY_CONCERN_MARKER-classified
// messages like "พื้นลื่นมาก ตอนเล่น ATV น่ากลัว" score 'high', which never
// triggered the old urgent-only escalation). Every combination of
// bound/unbound/failed target is asserted against BOTH the stored
// per-target result (ops_feedback_events.internal_notes.notification_targets)
// and the customer-facing wording, which must never overclaim a target
// that didn't actually send.
//
// Section B (Task 3): the restaurant advisor is host-style, not a menu
// dump -- allergy caution leads, top 3 items by default, one next
// question, full catalog only on explicit request.
//
// Section C (Task 5): regression proof that PR #67's fixes (care/safety
// precedence over legacy booking, short-unclear-text clarification) still
// hold through the full signed LINE webhook.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { withHarness, guestId, brainRequest, type Harness } from './helpers/canonical-core-harness';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';
import { handler as lineWebhookHandler } from '../netlify/functions/line-webhook';

function msg(payload: unknown): string {
  return String((payload as { message: string }).message);
}

async function ask(seed: string, message: string) {
  const gid = guestId(seed);
  return processThongthaiChatCore(brainRequest(message, gid, 'web'), 'evt-1');
}

function notificationTargets(harness: Harness, eventId = 'feedback-event-1'): Array<{ team: string; status: string }> {
  const row = harness.feedbackEventRow(eventId) as { internal_notes?: { notification_targets?: Array<{ team: string; status: string }> } } | undefined;
  return row?.internal_notes?.notification_targets ?? [];
}

const DURATION_PROMPT_RE = /เลือกระยะเวลา\s*30,?\s*60\s*หรือ\s*90\s*นาที/u;
const ATV_SAFETY_MESSAGE = 'พื้นลื่นมาก ตอนเล่น ATV น่ากลัว';

// ---------------------------------------------------------------------
// Section A: safety escalation routing (Task 1) + wording accuracy (Task 4)
// ---------------------------------------------------------------------

test('A1. safety issue with BOTH activity and owner_general bound: both targets sent, reply names both, event visible in backoffice store', async () => {
  await withHarness(async harness => {
    harness.programOpsChannel('activity');
    harness.programOpsChannel('owner_general');
    const r = await ask('polish-a1', ATV_SAFETY_MESSAGE);
    assert.equal(r.statusCode, 200);
    const t = msg(r.payload);
    assert.doesNotMatch(t, DURATION_PROMPT_RE);
    assert.match(t, /ส่งให้ทีมกิจกรรมและเจ้าของตรวจสอบแล้วครับ/u, 'reply must name BOTH targets once both actually sent');

    const events = harness.postsTo('ops_feedback_events');
    assert.equal(events.length, 1);
    assert.equal(events[0].feedback_type, 'safety_issue');
    assert.equal(events[0].business_unit, 'activity');
    assert.ok(['high', 'urgent'].includes(String(events[0].severity)), 'a real safety report must classify at least high severity');

    const row = harness.feedbackEventRow('feedback-event-1');
    assert.equal(row?.notification_status, 'sent', 'backoffice-visible: primary team send succeeded');
    const targets = notificationTargets(harness);
    assert.equal(targets.find(x => x.team === 'activity')?.status, 'sent');
    assert.equal(targets.find(x => x.team === 'owner_general')?.status, 'sent');
  });
});

test('A2. owner_general bound, activity NOT bound: owner sent, activity not_bound, event still stored', async () => {
  await withHarness(async harness => {
    harness.programOpsChannel('owner_general');
    const r = await ask('polish-a2', ATV_SAFETY_MESSAGE);
    assert.equal(r.statusCode, 200);
    const t = msg(r.payload);
    assert.doesNotMatch(t, DURATION_PROMPT_RE);
    assert.match(t, /ส่งให้เจ้าของตรวจสอบแล้วครับ/u);
    assert.doesNotMatch(t, /ทีมกิจกรรม.*และเจ้าของ|ส่งให้ทีมกิจกรรมแล้วครับ/u, 'must never claim the unbound domain team was notified');

    const events = harness.postsTo('ops_feedback_events');
    assert.equal(events.length, 1, 'event is stored regardless of partial notification failure');
    const targets = notificationTargets(harness);
    assert.equal(targets.find(x => x.team === 'activity')?.status, 'not_bound');
    assert.equal(targets.find(x => x.team === 'owner_general')?.status, 'sent');
  });
});

test('A3. activity bound, owner_general NOT bound: activity sent, owner not_bound, event still stored, reply never fakes owner success', async () => {
  await withHarness(async harness => {
    harness.programOpsChannel('activity');
    const r = await ask('polish-a3', ATV_SAFETY_MESSAGE);
    assert.equal(r.statusCode, 200);
    const t = msg(r.payload);
    assert.doesNotMatch(t, DURATION_PROMPT_RE);
    assert.match(t, /ส่งให้ทีมกิจกรรมแล้วครับ ส่วนแจ้งเจ้าของยังไม่สำเร็จ/u);

    const events = harness.postsTo('ops_feedback_events');
    assert.equal(events.length, 1);
    const targets = notificationTargets(harness);
    assert.equal(targets.find(x => x.team === 'activity')?.status, 'sent');
    assert.equal(targets.find(x => x.team === 'owner_general')?.status, 'not_bound');
  });
});

test('A4. neither activity nor owner_general bound: event still stored, reply is honest about neither team being reached', async () => {
  await withHarness(async harness => {
    const r = await ask('polish-a4', ATV_SAFETY_MESSAGE);
    assert.equal(r.statusCode, 200);
    const t = msg(r.payload);
    assert.doesNotMatch(t, DURATION_PROMPT_RE);
    assert.match(t, /ตอนนี้ระบบแจ้งเตือนทีมไม่สำเร็จ ทองไทยบันทึกเรื่องไว้แล้ว/u);
    assert.doesNotMatch(t, /ส่งให้ทีม.*แล้วครับ|ส่งให้เจ้าของตรวจสอบแล้วครับ/u, 'must never claim any team was actually notified');

    const events = harness.postsTo('ops_feedback_events');
    assert.equal(events.length, 1, 'the report is still stored even with zero teams bound');
    const targets = notificationTargets(harness);
    assert.equal(targets.find(x => x.team === 'activity')?.status, 'not_bound');
    assert.equal(targets.find(x => x.team === 'owner_general')?.status, 'not_bound');
  });
});

test('A5. owner_general bound to the SAME physical LINE group as activity: only one real send, no duplicate delivery', async () => {
  await withHarness(async harness => {
    const sharedTarget = 'line-group-shared-activity-and-owner';
    harness.programOpsChannel('activity', sharedTarget);
    harness.programOpsChannel('owner_general', sharedTarget);
    const r = await ask('polish-a5', ATV_SAFETY_MESSAGE);
    assert.equal(r.statusCode, 200);

    const targets = notificationTargets(harness);
    assert.equal(targets.find(x => x.team === 'activity')?.status, 'sent', 'the first target to the shared group actually sends');
    assert.equal(targets.find(x => x.team === 'owner_general')?.status, 'duplicate', 'the second target to the SAME physical group is never sent twice');

    assert.equal(targets.length, 2, 'both targets are still recorded (one sent, one duplicate) -- the event is never silently missing a target');
  });
});

// Task 4's explicit failure-mode tests: distinguishing a genuinely FAILED
// push (channel bound, LINE API itself rejected it) from NOT_BOUND (no
// channel at all) -- both must degrade honestly, never claim success.
test('Task 4a. mock owner_general push failure: activity sends, owner_general fails, reply reflects it honestly', async () => {
  await withHarness(async harness => {
    harness.programOpsChannel('activity');
    harness.programOpsChannel('owner_general');
    harness.programLinePushFailure('owner_general');
    const r = await ask('polish-4a', ATV_SAFETY_MESSAGE);
    const t = msg(r.payload);
    assert.match(t, /ส่งให้ทีมกิจกรรมแล้วครับ ส่วนแจ้งเจ้าของยังไม่สำเร็จ/u);
    const targets = notificationTargets(harness);
    assert.equal(targets.find(x => x.team === 'activity')?.status, 'sent');
    assert.equal(targets.find(x => x.team === 'owner_general')?.status, 'failed');
  });
});

test('Task 4b. mock domain (activity) push failure: owner_general sends, activity fails, reply never claims the domain team got it', async () => {
  await withHarness(async harness => {
    harness.programOpsChannel('activity');
    harness.programOpsChannel('owner_general');
    harness.programLinePushFailure('activity');
    const r = await ask('polish-4b', ATV_SAFETY_MESSAGE);
    const t = msg(r.payload);
    assert.doesNotMatch(t, /ส่งให้ทีมกิจกรรมแล้วครับ|ส่งให้ทีมกิจกรรมและเจ้าของ/u, 'must never claim the activity team was notified when its push actually failed');
    const targets = notificationTargets(harness);
    assert.equal(targets.find(x => x.team === 'activity')?.status, 'failed');
    assert.equal(targets.find(x => x.team === 'owner_general')?.status, 'sent');
  });
});

test('Task 4c. mock both succeeding: reply names both, notification_status is sent', async () => {
  await withHarness(async harness => {
    harness.programOpsChannel('activity');
    harness.programOpsChannel('owner_general');
    const r = await ask('polish-4c', ATV_SAFETY_MESSAGE);
    assert.match(msg(r.payload), /ส่งให้ทีมกิจกรรมและเจ้าของตรวจสอบแล้วครับ/u);
    assert.equal(harness.feedbackEventRow('feedback-event-1')?.notification_status, 'sent');
  });
});

test('Task 4d. mock both missing binding: event stored, reply never claims either target was reached', async () => {
  await withHarness(async harness => {
    const r = await ask('polish-4d', ATV_SAFETY_MESSAGE);
    const t = msg(r.payload);
    assert.doesNotMatch(t, /ส่งให้ทีม.*แล้วครับ|ส่งให้เจ้าของตรวจสอบแล้วครับ/u);
    assert.equal(harness.postsTo('ops_feedback_events').length, 1);
  });
});

// ---------------------------------------------------------------------
// Section B: restaurant host-style advice (Task 3)
// ---------------------------------------------------------------------

test('B1. allergy question: no shrimp, no long menu dump, allergy caution first, asks group size, at most 3 items shown', async () => {
  await withHarness(async () => {
    const r = await ask('polish-b1', 'ร้านอาหารมีอะไรแนะนำ แม่กินเผ็ดไม่ได้ แพ้กุ้ง');
    const t = msg(r.payload);
    assert.doesNotMatch(t, /ผัดไทย|ต้มยำกุ้ง/u, 'shrimp-containing dish must never be recommended');
    const itemLines = t.split('\n').filter(line => line.trim().startsWith('•'));
    assert.ok(itemLines.length <= 3, `must show at most 3 items by default, got ${itemLines.length}`);
    const firstContentLine = t.split('\n').find(line => line.trim().length > 0) ?? '';
    assert.match(firstContentLine, /แพ้|กุ้ง|เผ็ด|สารก่อภูมิแพ้|คัดเมนู/u, 'allergy/dietary caution must lead the reply, not trail after a menu list');
    assert.match(t, /กี่คน/u, 'must ask exactly one next question (group size)');
  });
});

// Default mock catalog only has 3 restaurant items total (see
// defaultCatalog in the harness) -- not enough room to prove a >3-item
// full-list widening. Both B2 and B3 use a larger, realistic catalog.
const LARGE_RESTAURANT_CATALOG = {
  restaurantMenu: [
    { menu_item_id:'m1', category_name:'อาหารจานหลัก', category_sort_order:1, sort_order:1, name:'ข้าวผัดหมู', selling_price:90, description:'', is_signature:false, ingredient_names:['หมู','ข้าว'], unavailable_ingredients:[], available_servings:20, is_orderable:true, source_updated_at:new Date().toISOString() },
    { menu_item_id:'m2', category_name:'อาหารจานหลัก', category_sort_order:1, sort_order:2, name:'ลาบหมู', selling_price:119, description:'', is_signature:false, ingredient_names:['หมู'], unavailable_ingredients:[], available_servings:20, is_orderable:true, source_updated_at:new Date().toISOString() },
    { menu_item_id:'m3', category_name:'อาหารจานหลัก', category_sort_order:1, sort_order:3, name:'ต้มแซ่บไก่บ้าน', selling_price:179, description:'', is_signature:false, ingredient_names:['ไก่'], unavailable_ingredients:[], available_servings:20, is_orderable:true, source_updated_at:new Date().toISOString() },
    { menu_item_id:'m4', category_name:'อาหารจานหลัก', category_sort_order:1, sort_order:4, name:'ไก่บ้านย่าง', selling_price:219, description:'', is_signature:false, ingredient_names:['ไก่'], unavailable_ingredients:[], available_servings:20, is_orderable:true, source_updated_at:new Date().toISOString() },
    { menu_item_id:'m5', category_name:'อาหารจานหลัก', category_sort_order:1, sort_order:5, name:'ตำลาว', selling_price:79, description:'', is_signature:false, ingredient_names:['มะละกอ'], unavailable_ingredients:[], available_servings:20, is_orderable:true, source_updated_at:new Date().toISOString() },
    { menu_item_id:'m6', category_name:'อาหารจานหลัก', category_sort_order:1, sort_order:6, name:'ผัดไทยกุ้งสด', selling_price:120, description:'', is_signature:false, ingredient_names:['กุ้ง'], unavailable_ingredients:[], available_servings:20, is_orderable:true, source_updated_at:new Date().toISOString() },
  ],
};

test('B2. "ขอเมนูทั้งหมดที่ไม่มีกุ้ง": explicit full-list request shows more than the default 3-item cap', async () => {
  await withHarness(async () => {
    const r = await ask('polish-b2', 'ขอเมนูทั้งหมดที่ไม่มีกุ้ง');
    const t = msg(r.payload);
    const itemLines = t.split('\n').filter(line => line.trim().startsWith('•'));
    assert.ok(itemLines.length >= 4, `an explicit full-list request must show more than the default 3-item cap, got ${itemLines.length}`);
  }, LARGE_RESTAURANT_CATALOG);
});

test('B3. "ขอราคาด้วย": as a restaurant follow-up, verified prices are included in the reply', async () => {
  await withHarness(async () => {
    const gid = guestId('polish-b3');
    await processThongthaiChatCore(brainRequest('ร้านอาหารมีอะไรแนะนำ', gid, 'web'), 'evt-1');
    const r = await processThongthaiChatCore(brainRequest('ขอราคาด้วย', gid, 'web'), 'evt-2');
    const t = msg(r.payload);
    assert.match(t, /บาท/u, 'verified prices must still be shown when explicitly asked for');
  }, LARGE_RESTAURANT_CATALOG);
});

test('B4. "แพ้กุ้ง กินอะไรได้บ้าง": never guarantees cross-contamination safety, includes staff-confirmation warning', async () => {
  await withHarness(async () => {
    const r = await ask('polish-b4', 'แพ้กุ้ง กินอะไรได้บ้าง');
    const t = msg(r.payload);
    assert.doesNotMatch(t, /ปลอดภัยแน่นอน|ไม่มีการปนเปื้อนแน่นอน/u, 'must never overclaim contamination-free certainty');
    assert.match(t, /แจ้งพนักงาน/u, 'must tell the customer to notify staff, since cross-contact cannot be guaranteed from ingredient text alone');
  });
});

// ---------------------------------------------------------------------
// Section C: Task 5 regression -- PR #67's fixes still hold through the
// full signed LINE webhook.
// ---------------------------------------------------------------------

const CHANNEL_SECRET = 'test-post-pr67-polish-secret';
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

test('C1. "อยากขี่ม้า ไม่เคยเลย กลัวตก" -> care mode, no duration-first', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('อยากขี่ม้า ไม่เคยเลย กลัวตก', 'polish-c1')]);
    assert.doesNotMatch(text(replies, 0), DURATION_PROMPT_RE);
  });
});

test('C2. "อยากขับ ATV ไม่เคยขับ กลัวเร็ว" -> slow/team briefing, no duration-first', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('อยากขับ ATV ไม่เคยขับ กลัวเร็ว', 'polish-c2')]);
    const t = text(replies, 0);
    assert.doesNotMatch(t, DURATION_PROMPT_RE);
    assert.match(t, /บรีฟ|เริ่มขับช้า/u);
  });
});

test('C3. "พื้นลื่นมาก ตอนเล่น ATV น่ากลัว" -> safety response, no duration-first', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent(ATV_SAFETY_MESSAGE, 'polish-c3')]);
    const t = text(replies, 0);
    assert.doesNotMatch(t, DURATION_PROMPT_RE);
    assert.match(t, /ความปลอดภัย/u);
  });
});

test('C4. "สติ" -> clarification, no slow fallback', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('สติ', 'polish-c4')]);
    const t = text(replies, 0);
    assert.doesNotMatch(t, /คิดช้ากว่าปกติ/u);
    assert.match(t, /ตั้งสติ|ถามเรื่องไหนต่อ/u);
  });
});

test('C5. "ผูกทีม เจ้าของ" -> owner binding still works', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    const groupEvent = {
      type: 'message', replyToken: 'reply-c5', timestamp: Date.now(),
      source: { type: 'group', groupId: 'polish-group-c5', userId: 'staff-1' },
      message: { id: 'msg-c5', type: 'text', text: 'ผูกทีม เจ้าของ' },
    };
    await callLineWebhook([groupEvent]);
    assert.match(text(replies, 0), /ผูกกลุ่มนี้กับทีม เจ้าของ\/ทั่วไป แล้วครับ/u);
  });
});

test('C6. bound activity group "เช็กทีม" ops routing unchanged', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    harness.programOpsChannel('activity');
    const groupEvent = {
      type: 'message', replyToken: 'reply-c6', timestamp: Date.now(),
      source: { type: 'group', groupId: 'line-group-activity', userId: 'staff-1' },
      message: { id: 'msg-c6', type: 'text', text: 'เช็กทีม' },
    };
    await callLineWebhook([groupEvent]);
    assert.match(text(replies, 0), /เชื่อมกับทีม/u);
  });
});

test('C7. existing restaurant verified menu source still works (real prices, real items only)', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('ร้านอาหารมีอะไรแนะนำ ชอบหมู', 'polish-c7')]);
    const t = text(replies, 0);
    assert.match(t, /บาท/u, 'real, verified menu prices must still appear');
    assert.match(t, /ข้าวผัดหมู/u, 'a real menu item name must still appear, not an invented one');
  });
});
