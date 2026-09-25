// MASTER ROADMAP PHASE 2 -- Customer Intelligence Memory. See
// THONGTHAI_HANDOFF.md's "Master Roadmap Phase 2" entry and
// _customer-phrase-intelligence.ts's own header comment for the design
// this implements: EXTENDS the existing _customer-db.ts GuestContext/
// guest_memory foundation (per the owner's explicit instruction -- no
// guest_memory_v2, no parallel memory system), plus a new, separate,
// additive aggregate event log (customer_intelligence_events) for
// cross-guest phrase/demand/risk counting, which guest_memory's own
// guest-scoped design genuinely cannot represent.
//
// The roadmap's own 14-item test list is covered in full, in order,
// through the full signed LINE webhook with a REAL stateful guest_memory
// mock (tests/helpers/canonical-core-harness.ts's guestMemory Map --
// read-after-write across turns, not just a write-only recorder).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { withHarness, type Harness } from './helpers/canonical-core-harness';
import { handler as lineWebhookHandler } from '../netlify/functions/line-webhook';

const CHANNEL_SECRET = 'test-master-roadmap-phase2-secret';

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

// Same hash _line-webhook-core.ts's own (unexported) lineGuestId uses --
// needed to look up harness.guestDbId(anonymousId) for a LINE userId,
// same precedent as tests/horse-ux-production-gap.test.ts.
function lineGuestId(userId: string): string {
  const hex = createHash('sha256').update('tamma-line:' + userId, 'utf8').digest('hex').slice(0, 32).split('');
  hex[12] = '5';
  const variant = parseInt(hex[16], 16);
  hex[16] = ((variant & 0x3) | 0x8).toString(16);
  const value = hex.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`;
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

function constraintsOf(harness: Harness, userId: string): string[] {
  const guestDbId = harness.guestDbId(lineGuestId(userId));
  if (!guestDbId) return [];
  const value = harness.getGuestMemory(guestDbId, 'constraints');
  return Array.isArray(value) ? value as string[] : [];
}

function intelligenceEvents(harness: Harness): Array<Record<string, unknown>> {
  return harness.postsTo('customer_intelligence_events');
}

// ---------------------------------------------------------------------
// 1. Phrase capture -- low intensity
// ---------------------------------------------------------------------

test('1. "เอาแบบไม่โหด" stores low_intensity, no raw full chat dumped into guest_memory', async () => {
  await withHarnessAndLine(async (harness, _replies) => {
    const userId = 'phase2-1';
    await callLineWebhook([privateEvent('เอาแบบไม่โหด', userId)]);
    assert.ok(constraintsOf(harness, userId).includes('low_intensity'));
    const memoryPosts = harness.postsTo('guest_memory').flat();
    for (const row of memoryPosts) {
      assert.notEqual((row as { memory_key?: string }).memory_key, 'raw_message', 'must never store a raw-message key');
      assert.doesNotMatch(JSON.stringify(row), /เอาแบบไม่โหด/u, 'must never store the raw customer phrase itself in guest_memory');
    }
  });
});

// ---------------------------------------------------------------------
// 2. Phrase capture -- fear of falling
// ---------------------------------------------------------------------

test('2. "อยากขี่ม้า แต่กลัวตก" stores fear_of_falling, and still gets care-mode reply (unaffected regression)', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    const userId = 'phase2-2';
    await callLineWebhook([privateEvent('อยากขี่ม้า แต่กลัวตก', userId)]);
    assert.ok(constraintsOf(harness, userId).includes('fear_of_falling'));
    assert.doesNotMatch(text(replies, 0), /เลือกระยะเวลา\s*30,?\s*60\s*หรือ\s*90\s*นาที/u);
  });
});

// ---------------------------------------------------------------------
// 3. Mobility memory -- captured AND changes a later reply (real
// personalization, not just storage).
// ---------------------------------------------------------------------

test('3. "แม่เดินไกลไม่ได้" stores limited_walking, and a LATER first-visit question gets the low-walking reply', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    const userId = 'phase2-3';
    await callLineWebhook([privateEvent('แม่เดินไกลไม่ได้', userId)]);
    assert.ok(constraintsOf(harness, userId).includes('limited_walking'));

    await callLineWebhook([privateEvent('มาครั้งแรก มีอะไรแนะนำ', userId)]);
    const t = text(replies, 1);
    assert.match(t, /ถ้ามากับคุณแม่เหมือนเดิม ทองไทยแนะนำแบบเดินน้อยก่อนนะครับ/u);
    assert.doesNotMatch(t, /ครั้งก่อนคุณบอก|ตอนเวลา|เมื่อกี้คุณบอก/u, 'must never be a timestamped "you told me before" callback');
  });
});

// ---------------------------------------------------------------------
// 4. Food constraint memory -- captured AND changes a later restaurant
// reply via the EXISTING FOOD_CONSTRAINT_ALIASES wiring.
// ---------------------------------------------------------------------

test('4. "กินไม่เผ็ด แพ้กุ้ง" stores no_spicy + shrimp_allergy; a LATER restaurant question is allergy-first without restating it', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    const userId = 'phase2-4';
    await callLineWebhook([privateEvent('กินไม่เผ็ด แพ้กุ้ง', userId)]);
    const constraints = constraintsOf(harness, userId);
    assert.ok(constraints.includes('no_spicy'));
    assert.ok(constraints.includes('shrimp_allergy'));

    await callLineWebhook([privateEvent('ร้านอาหารมีอะไรแนะนำ', userId)]);
    const t = text(replies, 1);
    assert.doesNotMatch(t, /ผัดไทย|ต้มยำกุ้ง/u, 'shrimp dish must never be recommended, even though THIS turn never re-mentioned the allergy');
  });
});

// ---------------------------------------------------------------------
// 5. Repeated phrase count (aggregate)
// ---------------------------------------------------------------------

test('5. "เอาแบบชิล ๆ" sent twice increments the aggregate phrase-intelligence event count', async () => {
  await withHarnessAndLine(async (harness, _replies) => {
    await callLineWebhook([privateEvent('เอาแบบชิล ๆ', 'phase2-5a')]);
    await callLineWebhook([privateEvent('เอาแบบชิล ๆ', 'phase2-5b')]);
    const chillEvents = intelligenceEvents(harness).filter(e => e.category === 'chill_pace');
    assert.equal(chillEvents.length, 2, 'each occurrence must add its own aggregate event, proving count increments across independent guests');
  });
});

// ---------------------------------------------------------------------
// 6. Correction / update -- memory never permanently locks a wrong
// preference.
// ---------------------------------------------------------------------

test('6. "กินเผ็ดไม่ได้" then later "จริง ๆ กินเผ็ดได้นิดหน่อย" removes the outdated no_spicy constraint', async () => {
  await withHarnessAndLine(async (harness, _replies) => {
    const userId = 'phase2-6';
    await callLineWebhook([privateEvent('กินเผ็ดไม่ได้', userId)]);
    assert.ok(constraintsOf(harness, userId).includes('no_spicy'));

    await callLineWebhook([privateEvent('จริง ๆ กินเผ็ดได้นิดหน่อย', userId)]);
    assert.ok(!constraintsOf(harness, userId).includes('no_spicy'), 'a correction must remove the outdated constraint, never lock it in permanently');
  });
});

// ---------------------------------------------------------------------
// 7. Privacy guardrail
// ---------------------------------------------------------------------

test('7. no raw chat dump in guest_memory, no unnecessary sensitive medical detail beyond the normalized constraint key', async () => {
  await withHarnessAndLine(async (harness, _replies) => {
    await callLineWebhook([privateEvent('ตั้งครรภ์อยู่ค่ะ อยากขี่ม้าได้ไหม', 'phase2-7')]);
    const memoryPosts = harness.postsTo('guest_memory').flat();
    for (const row of memoryPosts) {
      assert.doesNotMatch(JSON.stringify(row), /ตั้งครรภ์/u, 'must never store the raw medical statement itself, only a normalized key if any');
    }
    const events = intelligenceEvents(harness);
    for (const event of events) {
      const example = String(event.redacted_example ?? '');
      assert.ok(example.length <= 80, 'aggregate event examples must be short, truncated snippets, never a full chat dump');
    }
  });
});

// ---------------------------------------------------------------------
// 8. Non-creepy personalization wording (re-verifies test 3's own
// wording assertion in isolation, per the roadmap's own explicit ask).
// ---------------------------------------------------------------------

test('8. returning guest with mobility context gets soft personalization, never a timestamped callback', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    const userId = 'phase2-8';
    await callLineWebhook([privateEvent('แม่เดินไกลไม่ได้', userId)]);
    await callLineWebhook([privateEvent('มาครั้งแรก มีอะไรแนะนำ', userId)]);
    const t = text(replies, 1);
    assert.equal(t, 'ถ้ามากับคุณแม่เหมือนเดิม ทองไทยแนะนำแบบเดินน้อยก่อนนะครับ 😊\nอยากเน้นกินข้าว คาเฟ่ หรือกิจกรรมเบา ๆ ครับ?');
  });
});

// ---------------------------------------------------------------------
// 9. Aggregate insight event availability
// ---------------------------------------------------------------------

test('9. a representative phrase/demand/risk signal is recorded for future owner dashboard insight', async () => {
  await withHarnessAndLine(async (harness, _replies) => {
    await callLineWebhook([privateEvent('มีอะไรเด็ด', 'phase2-9')]);
    const events = intelligenceEvents(harness);
    assert.ok(events.some(e => e.category === 'signature_recommendation_request' && e.event_type === 'demand'));
  });
});

// ---------------------------------------------------------------------
// 10-12: Phase 1 boundary priority is never overridden by memory
// capture.
// ---------------------------------------------------------------------

test('10. "ขอคืนเงินได้ไหม" -- Phase 1 deterministic escalation still wins; memory capture never routes this to the LLM', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    harness.programOpsChannel('owner_general');
    await callLineWebhook([privateEvent('ขอคืนเงินได้ไหม', 'phase2-10')]);
    assert.match(text(replies, 0), /เรื่องคืนเงิน\/เงื่อนไขการชำระ ทองไทยขอไม่ยืนยันแทนเจ้าของนะครับ/u);
    assert.equal(harness.postsTo('ops_feedback_events').length, 1, 'still exactly one feedback event, from Phase 1s own escalation path');
  });
});

test('11. "พื้นลื่นมาก ตอนเล่น ATV น่ากลัว" -- safety escalation still routes activity + owner_general; memory can independently record ground_condition_risk; no booking flow', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    harness.programOpsChannel('activity');
    harness.programOpsChannel('owner_general');
    await callLineWebhook([privateEvent('พื้นลื่นมาก ตอนเล่น ATV น่ากลัว', 'phase2-11')]);
    const t = text(replies, 0);
    assert.doesNotMatch(t, /เลือกระยะเวลา\s*30,?\s*60\s*หรือ\s*90\s*นาที/u);
    assert.match(t, /ส่งให้ทีมกิจกรรมและเจ้าของตรวจสอบแล้วครับ/u);
    assert.ok(intelligenceEvents(harness).some(e => e.category === 'ground_condition_risk'));
  });
});

test('12. "แม่แพ้กุ้งรุนแรง กินอะไรได้บ้าง" -- Phase 1 escalation still wins, no safety guarantee; allergy memory can independently record shrimp_allergy', async () => {
  await withHarnessAndLine(async (harness, replies) => {
    harness.programOpsChannel('restaurant');
    harness.programOpsChannel('owner_general');
    await callLineWebhook([privateEvent('แม่แพ้กุ้งรุนแรง กินอะไรได้บ้าง', 'phase2-12')]);
    const t = text(replies, 0);
    assert.match(t, /ทองไทยไม่อยากเดาแทนทีมครับ/u);
    assert.doesNotMatch(t, /ปลอดภัยแน่นอน|รับประกัน/u, 'must never guarantee safety even with remembered allergy context');
    assert.ok(intelligenceEvents(harness).some(e => e.category === 'shrimp_allergy'));
  });
});

// ---------------------------------------------------------------------
// 13. No duplicate memory system -- preference data lands in the
// EXISTING guest_memory table, never a new/parallel one.
// ---------------------------------------------------------------------

test('13. preference capture writes to the EXISTING guest_memory table only, never a parallel memory table', async () => {
  await withHarnessAndLine(async (harness, _replies) => {
    await callLineWebhook([privateEvent('เอาแบบไม่โหด', 'phase2-13')]);
    assert.ok(harness.postsTo('guest_memory').length >= 1, 'preference data must land in the existing guest_memory table');
    assert.equal(harness.postsTo('guest_memory_v2').length, 0);
    assert.equal(harness.postsTo('customer_preference_memory').length, 0);
    assert.equal(harness.postsTo('guest_intelligence').length, 0);
  });
});

// ---------------------------------------------------------------------
// 14. Existing regression -- unaffected by Phase 2's changes.
// ---------------------------------------------------------------------

test('14a. "สติ" still gets clarification, not the generic slow fallback', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('สติ', 'phase2-14a')]);
    const t = text(replies, 0);
    assert.doesNotMatch(t, /คิดช้ากว่าปกติ/u);
    assert.match(t, /ตั้งสติ|ถามเรื่องไหนต่อ/u);
  });
});

test('14b. "อยากขับ ATV ไม่เคยขับ กลัวเร็ว" still gets the care reply', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('อยากขับ ATV ไม่เคยขับ กลัวเร็ว', 'phase2-14b')]);
    const t = text(replies, 0);
    assert.doesNotMatch(t, /เลือกระยะเวลา\s*30,?\s*60\s*หรือ\s*90\s*นาที/u);
    assert.match(t, /บรีฟ|เริ่มขับช้า/u);
  });
});

test('14c. "ทองไทยกับภาราดรต่างกันยังไง" still gets a comparison answer, not a booking flow', async () => {
  await withHarnessAndLine(async (_harness, replies) => {
    await callLineWebhook([privateEvent('ทองไทยกับภาราดรต่างกันยังไง', 'phase2-14c')]);
    const t = text(replies, 0);
    assert.doesNotMatch(t, /เลือกระยะเวลา\s*30,?\s*60\s*หรือ\s*90\s*นาที/u);
  });
});


test('2.7 idempotency: replaying the same signed LINE message id records one aggregate intelligence row', async () => {
  await withHarnessAndLine(async (harness, _replies) => {
    const userId = 'phase2-7-idempotency';
    const event = {
      type: 'message',
      replyToken: 'reply-phase2-7-idempotency',
      timestamp: Date.now(),
      source: { type: 'user', userId },
      message: {
        id: 'same-line-message-id-001',
        type: 'text',
        text: 'พื้นลื่นมาก ตอนเล่น ATV น่ากลัว',
      },
    };

    await callLineWebhook([event]);
    await callLineWebhook([event]);

    const rows = intelligenceEvents(harness).filter(row =>
      row.category === 'ground_condition_risk'
      && row.event_type === 'risk'
      && row.domain === 'activity'
    );

    assert.equal(rows.length, 1, 'transport retry of the same LINE message id must not inflate aggregate counts');
    assert.equal(typeof rows[0]?.source_event_key, 'string');
    assert.match(String(rows[0]?.source_event_key ?? ''), /^[a-f0-9]{64}$/u, 'store only a one-way event key, never the raw LINE message id');
    assert.equal(rows[0]?.source_event_id, undefined, 'raw transport message ids must not be persisted');
  });
});


test('2.7 privacy: aggregate snippet redacts direct phone/email/url identifiers before storage', async () => {
  await withHarnessAndLine(async (harness, _replies) => {
    await callLineWebhook([privateEvent(
      'พื้นลื่นมาก โทร 081-234-5678 อีเมล nook@example.com ดู https://example.com/path',
      'phase2-7-redaction',
    )]);

    const event = intelligenceEvents(harness).find(row => row.category === 'ground_condition_risk');
    assert.ok(event);
    const example = String(event?.redacted_example ?? '');

    assert.doesNotMatch(example, /081-234-5678/u);
    assert.doesNotMatch(example, /nook@example\.com/u);
    assert.doesNotMatch(example, /https:\/\/example\.com/u);
    assert.match(example, /\[phone\]/u);
    assert.match(example, /\[email\]/u);
    assert.match(example, /\[url\]/u);
    assert.ok(example.length <= 80);
  });
});
