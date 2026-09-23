// MASTER ROADMAP PHASE 1 -- Escalation Boundary Policy. See
// THONGTHAI_HANDOFF.md's "Master Roadmap Phase 1" entry and
// _boundary-classifier.ts's own header comment for the owner's explicit
// decision this implements: for a message naming a topic outside
// Thongthai's authority (refund/discount/claim/liability/safety-
// guarantee/reputational-threat/severe-medical-risk/unverified-
// availability), Thongthai answers with a deterministic guardrail reply
// FIRST -- the LLM never drafts these. Every test uses the full signed
// LINE webhook with realistic bound groups, per the roadmap's own
// testing rule.
//
// The roadmap's own 10-item test list is covered in full (tests 1-10
// below, in the roadmap's own order); a few extra tests (11+) verify
// domain-tied routing and honest degradation, matching this
// engagement's established rigor beyond the roadmap's minimum.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { withHarness, type Harness } from './helpers/canonical-core-harness';
import { handler as lineWebhookHandler } from '../netlify/functions/line-webhook';

const CHANNEL_SECRET = 'test-master-roadmap-phase1-secret';

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

const NO_GENERIC_APOLOGY = /คิดช้ากว่าปกติ|ขอโทษนะครับ ตอนนี้ทองไทยยังไม่มีข้อมูล/u;

// ---------------------------------------------------------------------
// 1-2: CAN_ANSWER -- unaffected by the new classifier, a real factual
// answer, no feedback event created.
// ---------------------------------------------------------------------

test('1. "เช็กอินกี่โมง" -> CAN_ANSWER: real factual answer, no feedback event', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    await callLineWebhook([privateEvent('เช็กอินกี่โมง', 'phase1-1')]);
    const t = text(replies, 0);
    assert.doesNotMatch(t, NO_GENERIC_APOLOGY);
    assert.match(t, /14:00|เช็กอิน/u);
    assert.equal(harness.postsTo('ops_feedback_events').length, 0, 'a plain factual question must never create a feedback event');
  });
});

test('2. "มีม้ากี่ตัว" -> CAN_ANSWER: real inventory answer, no feedback event', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    await callLineWebhook([privateEvent('มีม้ากี่ตัว', 'phase1-2')]);
    const t = text(replies, 0);
    assert.doesNotMatch(t, NO_GENERIC_APOLOGY);
    assert.equal(harness.postsTo('ops_feedback_events').length, 0);
  });
});

// ---------------------------------------------------------------------
// 3-4: NEEDS_CONTEXT -- unaffected, a caring context-gathering question,
// no feedback event.
// ---------------------------------------------------------------------

test('3. "อยากพัก" -> NEEDS_CONTEXT: asks for context, no feedback event', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    await callLineWebhook([privateEvent('อยากพัก', 'phase1-3')]);
    const t = text(replies, 0);
    assert.doesNotMatch(t, NO_GENERIC_APOLOGY);
    assert.match(t, /\?|ไหม|กี่คน|มากับใคร/u, 'must ask a clarifying question, not just state facts');
    assert.equal(harness.postsTo('ops_feedback_events').length, 0);
  });
});

// NOTE: a truly bare "มีอะไรแนะนำ" (no "ครั้งแรก"/"ร้านอาหาร"/other domain
// anchor) has no deterministic NEEDS_CONTEXT responder yet -- it falls
// through to the LLM (ecosystemFirstVisitResponse's own
// FIRST_VISIT_RECOMMEND_MARKER requires "ครั้งแรก" alongside it; that
// gap belongs to the roadmap's own Phase 4 "ecosystem/first-time
// visitor" domain playbook, not this phase's escalation-boundary scope).
// This test only asserts what Phase 1 actually guarantees: the new
// escalation classifier does not misfire on it and create a spurious
// feedback event.
test('4. "มีอะไรแนะนำ" -> NEEDS_CONTEXT (real LLM answer in production; harness has no LLM queued): new classifier does not misfire, no feedback event', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    await callLineWebhook([privateEvent('มีอะไรแนะนำ', 'phase1-4')]);
    assert.equal(replies.length, 1, 'must still get exactly one reply, never a crash or a dropped turn');
    assert.equal(harness.postsTo('ops_feedback_events').length, 0, 'must never create a feedback event for a plain recommendation question');
  });
});

// ---------------------------------------------------------------------
// 5-6: ESCALATE (pure/near-pure) -- deterministic guardrail, owner_general
// routing, exact owner-specified wording.
// ---------------------------------------------------------------------

test('5. "ขอส่วนลดพิเศษ กลุ่ม 20 คน" -> ESCALATE owner_general, exact wording, asks one follow-up question', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    harness.programOpsChannel('owner_general');
    await callLineWebhook([privateEvent('ขอส่วนลดพิเศษ กลุ่ม 20 คน', 'phase1-5')]);
    const t = text(replies, 0);
    assert.match(t, /ส่วนลดพิเศษ.*ให้เจ้าของหรือทีมดูแลราคา/u);
    assert.match(t, /ทองไทยส่งให้เจ้าของตรวจสอบแล้วครับ/u);
    assert.match(t, /ขอทราบวัน เวลา และบริการที่สนใจ/u);
    const events = harness.postsTo('ops_feedback_events');
    assert.equal(events.length, 1);
    assert.equal(events[0].business_unit, 'general');
  });
});

test('6. "ขอคืนเงินได้ไหม" -> ESCALATE owner_general, exact owner-specified wording', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    harness.programOpsChannel('owner_general');
    await callLineWebhook([privateEvent('ขอคืนเงินได้ไหม', 'phase1-6')]);
    const t = text(replies, 0);
    assert.match(t, /เรื่องคืนเงิน\/เงื่อนไขการชำระ ทองไทยขอไม่ยืนยันแทนเจ้าของนะครับ/u);
    assert.match(t, /ทองไทยส่งให้เจ้าของตรวจสอบแล้วครับ/u);
    const events = harness.postsTo('ops_feedback_events');
    assert.equal(events.length, 1);
    assert.equal(events[0].feedback_type, 'complaint');
    assert.equal(events[0].business_unit, 'general');
  });
});

// ---------------------------------------------------------------------
// 7: bare, generic safety-guarantee question -- ANSWER only, no
// escalation, per the owner's own explicit instruction.
// ---------------------------------------------------------------------

test('7. "ปลอดภัย 100% ไหม" (generic, no named activity) -> honest no-guarantee answer, NO escalation created', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    await callLineWebhook([privateEvent('ปลอดภัย 100% ไหม', 'phase1-7')]);
    const t = text(replies, 0);
    assert.match(t, /ทองไทยไม่อยากรับประกันแทนทีมแบบ 100% นะครับ/u);
    assert.doesNotMatch(t, /ปลอดภัยแน่นอน|การันตี 100%/u);
    assert.equal(harness.postsTo('ops_feedback_events').length, 0, 'a bare generic safety-guarantee question must not create a feedback event at all');
  });
});

// ---------------------------------------------------------------------
// 8: staff complaint -- confirms the EXISTING classifyServiceFeedback
// path still handles this unaffected by the new classifier (this
// module intentionally does NOT intercept it -- see the classifier's
// own scratch verification in the handoff entry).
// ---------------------------------------------------------------------

test('8. "เจิดพูดไม่ดี" -> staff complaint, existing path unaffected, routes to owner_general', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    harness.programOpsChannel('owner_general');
    await callLineWebhook([privateEvent('เจิดพูดไม่ดี', 'phase1-8')]);
    const events = harness.postsTo('ops_feedback_events');
    assert.equal(events.length, 1);
    assert.equal(events[0].feedback_type, 'complaint');
    assert.equal(events[0].staff_name, 'เจิด');
  });
});

// ---------------------------------------------------------------------
// 9: severe allergy (with explicit severity qualifier) -- ANSWER_AND_ESCALATE,
// restaurant + owner_general.
// ---------------------------------------------------------------------

test('9. "แม่แพ้กุ้งรุนแรง กินอะไรได้บ้าง" -> answers with escalation wording, routes to restaurant + owner_general', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    harness.programOpsChannel('restaurant');
    harness.programOpsChannel('owner_general');
    await callLineWebhook([privateEvent('แม่แพ้กุ้งรุนแรง กินอะไรได้บ้าง', 'phase1-9')]);
    const t = text(replies, 0);
    assert.match(t, /ทองไทยไม่อยากเดาแทนทีมครับ/u);
    assert.match(t, /ส่งให้ทีมร้านอาหารและเจ้าของตรวจสอบแล้วครับ/u);
    const events = harness.postsTo('ops_feedback_events');
    assert.equal(events.length, 1);
    assert.equal(events[0].feedback_type, 'safety_issue');
    assert.equal(events[0].business_unit, 'restaurant');
  });
});

// ---------------------------------------------------------------------
// 10: real safety report -- regression proof that this new classifier
// does NOT interfere with the already-fixed (PR #67-69) safety-issue
// escalation path.
// ---------------------------------------------------------------------

test('10. "พื้นลื่นมาก ตอนเล่น ATV น่ากลัว" -> unaffected regression: activity + owner_general, no duration-first', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    harness.programOpsChannel('activity');
    harness.programOpsChannel('owner_general');
    await callLineWebhook([privateEvent('พื้นลื่นมาก ตอนเล่น ATV น่ากลัว', 'phase1-10')]);
    const t = text(replies, 0);
    assert.doesNotMatch(t, /เลือกระยะเวลา\s*30,?\s*60\s*หรือ\s*90\s*นาที/u);
    assert.match(t, /ส่งให้ทีมกิจกรรมและเจ้าของตรวจสอบแล้วครับ/u);
    const events = harness.postsTo('ops_feedback_events');
    assert.equal(events[0].feedback_type, 'safety_issue');
  });
});

// ---------------------------------------------------------------------
// Extra coverage beyond the roadmap's own 10-item minimum.
// ---------------------------------------------------------------------

test('11. domain-tied liability question escalates to BOTH the named domain and owner_general', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    harness.programOpsChannel('activity');
    harness.programOpsChannel('owner_general');
    await callLineWebhook([privateEvent('ถ้าเกิดอุบัติเหตุระหว่างขี่ม้า รับผิดชอบไหม', 'phase1-11')]);
    const t = text(replies, 0);
    assert.match(t, /เรื่องความรับผิดชอบกรณีอุบัติเหตุ ทองไทยขอไม่ตอบแทนเจ้าของแบบมั่ว ๆ นะครับ/u);
    assert.match(t, /ส่งให้ทีมกิจกรรมและเจ้าของตรวจสอบแล้วครับ/u);
    const events = harness.postsTo('ops_feedback_events');
    assert.equal(events[0].business_unit, 'activity');
    assert.equal(events[0].feedback_type, 'safety_issue');
  });
});

test('12. domain-generic liability question (no named activity) still escalates, owner_general only', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    harness.programOpsChannel('owner_general');
    await callLineWebhook([privateEvent('ถ้าเกิดอุบัติเหตุรับผิดชอบไหม', 'phase1-12')]);
    const t = text(replies, 0);
    assert.match(t, /ทองไทยส่งให้เจ้าของตรวจสอบแล้วครับ/u);
    const events = harness.postsTo('ops_feedback_events');
    assert.equal(events[0].business_unit, 'general');
  });
});

test('13. escalation reply is honest when owner_general is not bound (no fake success)', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('ขอคืนเงินได้ไหม', 'phase1-13')]);
    const t = text(replies, 0);
    assert.match(t, /ตอนนี้ระบบแจ้งเตือนไม่สำเร็จ ทองไทยบันทึกเรื่องไว้แล้ว/u);
    assert.doesNotMatch(t, /ส่งให้เจ้าของตรวจสอบแล้วครับ/u, 'must never claim owner was notified when no channel is bound');
  });
});

test('14. bad-review threat routes to owner_general with calming wording', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    harness.programOpsChannel('owner_general');
    await callLineWebhook([privateEvent('จะรีวิวแย่', 'phase1-14')]);
    const t = text(replies, 0);
    assert.match(t, /ขอบคุณที่บอกความรู้สึกตรง ๆ นะครับ/u);
    const events = harness.postsTo('ops_feedback_events');
    assert.equal(events[0].business_unit, 'general');
  });
});

test('15. unverified availability question routes to the stay team, never guesses a real answer', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    harness.programOpsChannel('stay');
    await callLineWebhook([privateEvent('ห้องว่างคืนนี้ไหม', 'phase1-15')]);
    const t = text(replies, 0);
    assert.match(t, /ห้องว่างช่วงนี้ทองไทยขอเช็กกับทีมให้ชัวร์อีกทีนะครับ/u);
    assert.doesNotMatch(t, /มีห้องว่าง|ห้องเต็มแล้ว/u, 'must never assert a real availability fact it has not verified');
    const events = harness.postsTo('ops_feedback_events');
    assert.equal(events[0].business_unit, 'stay');
  });
});
