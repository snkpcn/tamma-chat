// THONGTHAI SERVICE MIND SYSTEM -- 3-phase hospitality layer (before/
// during/after conversation), driven through the real canonical entry
// point processThongthaiChatCore, never hand-constructed SemanticTurns.
// See THONGTHAI_HANDOFF.md's "Service Mind System" section for the full
// design writeup and the honest scope boundary (which "during
// conversation" categories are newly built here vs. already covered by
// the existing local-concierge framework, verified below rather than
// reimplemented).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withHarness, guestId, brainRequest } from './helpers/canonical-core-harness';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';

function msg(payload: unknown): string {
  return String((payload as { message: string }).message);
}

async function ask(seed: string, message: string) {
  const gid = guestId(seed);
  return processThongthaiChatCore(brainRequest(message, gid, 'web'), 'evt-1');
}

const NO_GENERIC_FAILURE = /ไม่มีข้อมูลที่ยืนยันได้สำหรับเรื่องนี้|ทองไทยคิดช้า|เชื่อมต่อไม่ได้/u;
const NO_HARD_SELL = /จองเลยไหมครับ|สนใจจองไหมครับ|รีบจองก่อน|โปรพิเศษวันนี้เท่านั้น/u;

// ---------------------------------------------------------------------
// SECTION 1 -- BEFORE CONVERSATION
// ---------------------------------------------------------------------

test('1. Greeting: warm, offers help categories, no hard sell, no menu-numbers', async () => {
  await withHarness(async () => {
    const r = await ask('sm-greeting', 'สวัสดี');
    assert.equal(r.statusCode, 200);
    const text = msg(r.payload);
    assert.doesNotMatch(text, NO_HARD_SELL);
    assert.doesNotMatch(text, /กรุณาเลือกเมนู/u, 'must not read like a phone-tree menu');
    assert.match(text, /กิน|พัก|กิจกรรม|โลเคชั่น|อากาศ|ทริป/u, 'must offer real help categories');
  });
});

test('2. Vague visit intent: asks one useful context question, never forces booking', async () => {
  await withHarness(async harness => {
    const r = await ask('sm-vague-visit', 'จะไปเที่ยว');
    assert.equal(r.statusCode, 200);
    const text = msg(r.payload);
    assert.doesNotMatch(text, NO_GENERIC_FAILURE);
    assert.match(text, /มากับใคร|คู่รัก|ครอบครัว|เพื่อน/u, 'must ask a companion/context question');
    assert.equal(harness.postsTo('bookings').length, 0);
  });
});

test('3. Food start: asks spice/allergy or preference, no fake menu, no generic non-answer', async () => {
  await withHarness(async () => {
    const r = await ask('sm-food-start', 'อยากกิน');
    assert.equal(r.statusCode, 200);
    const text = msg(r.payload);
    assert.doesNotMatch(text, NO_GENERIC_FAILURE);
    assert.match(text, /เผ็ด|แพ้อาหาร|ปลาร้า/u, 'must ask about spice/allergy');
    assert.doesNotMatch(text, /\d+\s*บาท/u, 'must never invent a specific menu price');
  });
});

test('4. Activity start: asks riding experience/preferred feel, no safety guarantee', async () => {
  await withHarness(async () => {
    const r = await ask('sm-activity-start', 'อยากขี่ม้า');
    assert.equal(r.statusCode, 200);
    const text = msg(r.payload);
    assert.doesNotMatch(text, NO_GENERIC_FAILURE);
    assert.match(text, /เคยขี่ม้า|ฟีลชิล/u, 'must ask about experience/preferred feel');
    assert.doesNotMatch(text, /ปลอดภัยแน่นอน|เล่นได้แน่นอน/u, 'must never assert a safety guarantee');
  });
});

// ---------------------------------------------------------------------
// SECTION 2 -- DURING CONVERSATION
// (Most personalization categories here already exist via the local-
// concierge framework from earlier phases -- these tests verify that
// coverage still holds end-to-end, they don't reimplement it.)
// ---------------------------------------------------------------------

test('5. Couple itinerary: suitable journey, warm, one follow-up, no booking forced', async () => {
  await withHarness(async harness => {
    const r = await ask('sm-couple', 'มากับแฟน มีเวลา 3 ชั่วโมง');
    assert.equal(r.statusCode, 200);
    const text = msg(r.payload);
    assert.doesNotMatch(text, NO_GENERIC_FAILURE);
    assert.match(text, /กิน|ตำมา-ชาติ|พัก|เฮือนสเตย์|กิจกรรม|คาเฟ่/u, 'must connect to real ทำมา-ชาติ options');
    assert.equal(harness.postsTo('bookings').length, 0);
  });
});

test('6. Family with elderly/children: mentions children/elderly, comfortable/gentle pace, asks mobility or food constraint, no hard sell, no booking forced', async () => {
  await withHarness(async harness => {
    const r = await ask('sm-family', 'พาครอบครัวไป มีเด็กกับผู้สูงอายุ');
    assert.equal(r.statusCode, 200);
    const text = msg(r.payload);
    assert.doesNotMatch(text, NO_GENERIC_FAILURE);
    assert.match(text, /เด็ก/u);
    assert.match(text, /ผู้สูงอายุ/u);
    assert.match(text, /เดินสบาย|ไม่แน่นเกินไป|เบา ๆ/u, 'must mention a comfortable/gentle pace, not just a generic journey list');
    assert.match(text, /เดินไม่สะดวก|แพ้|ไม่ทานเผ็ด/u, 'must ask about mobility or a food constraint');
    assert.doesNotMatch(text, NO_HARD_SELL);
    assert.equal(harness.postsTo('bookings').length, 0);
  });
});

test("6b. Low-walking / mother context: chill plan, asks mobility question, not just a generic journey answer", async () => {
  await withHarness(async () => {
    const r = await ask('sm-low-walking', 'พาแม่มา ไม่อยากเดินเยอะ');
    assert.equal(r.statusCode, 200);
    const text = msg(r.payload);
    assert.doesNotMatch(text, NO_GENERIC_FAILURE);
    assert.match(text, /สายชิล|ไม่ต้องเดินเยอะ|เบา ๆ/u, 'must give a low-walking/chill plan, not the generic journey composer');
    assert.match(text, /เดินขึ้นลงสะดวกไหม|เดินสะดวกไหม/u, 'must ask a mobility question');
  });
});

test('6c. Child + activity interest: activity guidance, safety caveat, asks child age, no fake safety guarantee', async () => {
  await withHarness(async () => {
    const r = await ask('sm-child-activity', 'มากับเด็ก อยากทำกิจกรรม');
    assert.equal(r.statusCode, 200);
    const text = msg(r.payload);
    assert.doesNotMatch(text, NO_GENERIC_FAILURE);
    assert.match(text, /กิจกรรมเบา ๆ/u, 'must recommend starting gentle');
    assert.match(text, /อากาศ|สภาพพื้นจริง/u, 'must include the outdoor-safety caveat');
    assert.match(text, /อายุประมาณกี่ขวบ/u, 'must ask the child\'s age');
    assert.doesNotMatch(text, /ปลอดภัยแน่นอน|เล่นได้แน่นอน/u);
  });
});

test('6d. Elderly + named-activity suitability ("ผู้สูงอายุเล่น ATV ได้ไหม"): no safety guarantee, recommends staff check, suggests gentler alternative, no transaction', async () => {
  await withHarness(async harness => {
    const r = await ask('sm-elderly-atv', 'ผู้สูงอายุเล่น ATV ได้ไหม');
    assert.equal(r.statusCode, 200);
    const text = msg(r.payload);
    assert.doesNotMatch(text, NO_GENERIC_FAILURE);
    assert.doesNotMatch(text, /เล่นได้แน่นอน|ปลอดภัยแน่นอน|เล่นไม่ได้แน่นอน/u, 'must never guarantee safety either way');
    assert.match(text, /ทีม.*หน้างาน|หน้างาน.*ทีม/u, 'must recommend a staff/on-site suitability check');
    assert.match(text, /ไม่โลดโผน|เบา ๆ/u, 'must suggest a gentler alternative');
    assert.equal(harness.postsTo('bookings').length, 0);
  });
});

test('6e. Child + non-spicy food constraint ("มีเด็ก ไม่กินเผ็ด"): food care, mentions mild/non-spicy, asks allergy/constraint, no fake menu', async () => {
  await withHarness(async () => {
    const r = await ask('sm-child-food', 'มีเด็ก ไม่กินเผ็ด');
    assert.equal(r.statusCode, 200);
    const text = msg(r.payload);
    assert.doesNotMatch(text, NO_GENERIC_FAILURE);
    assert.match(text, /รสอ่อน|ไม่เผ็ด/u, 'must mention mild/non-spicy');
    assert.match(text, /แพ้อาหาร|ข้อจำกัด/u, 'must ask about allergy/constraint');
    assert.doesNotMatch(text, /\d+\s*บาท/u, 'must never invent a specific menu price');
  });
});

test('7. Food constraint: handles non-spicy constraint, no fake menu', async () => {
  await withHarness(async () => {
    const r = await ask('sm-food-constraint', 'อยากกินอีสาน ไม่กินเผ็ด');
    assert.equal(r.statusCode, 200);
    const text = msg(r.payload);
    assert.doesNotMatch(text, NO_GENERIC_FAILURE);
    assert.doesNotMatch(text, /\d+\s*บาท/u, 'must never invent a specific menu price');
  });
});

test('8. Horse facts: owner facts exactly, no fake safety/beginner guarantee', async () => {
  await withHarness(async () => {
    const r = await ask('sm-horse', 'ทองไทยกับภาราดรต่างกันยังไง');
    assert.equal(r.statusCode, 200);
    const text = msg(r.payload);
    assert.match(text, /ขี่กระด้างกว่านิดนึง/u);
    assert.match(text, /ขี่นิ่มกว่านิดหน่อย/u);
    assert.doesNotMatch(text, /เหมาะกับมือใหม่แน่นอน|ปลอดภัยกว่า/u);
  });
});

test('9. Weather + outdoor activity: uses weather handler, ground caveat, no fake safety', async () => {
  await withHarness(async () => {
    const r = await ask('sm-weather-activity', 'ฝนตกไหม ขี่ม้าได้ไหม');
    assert.equal(r.statusCode, 200);
    const text = msg(r.payload);
    assert.doesNotMatch(text, NO_GENERIC_FAILURE);
    assert.match(text, /สภาพพื้นจริงหน้างานต้องให้ทีมดูอีกทีครับ/u, 'must never claim actual ground condition');
  });
});

test('10. Angry complaint: apology, no defensiveness, asks one useful detail, creates feedback event', async () => {
  await withHarness(async harness => {
    const r = await ask('sm-complaint', 'บริการแย่มาก');
    assert.equal(r.statusCode, 200);
    const text = msg(r.payload);
    assert.match(text, /ขอโทษ/u, 'must apologize sincerely');
    assert.doesNotMatch(text, /แต่จริงๆ แล้ว|ไม่ใช่ความผิดของทองไทย/u, 'must never sound defensive');
    assert.match(text, /ส่วนไหน|รายละเอียดเพิ่ม/u, 'must ask one useful clarifying detail');
    const events = harness.postsTo('ops_feedback_events');
    assert.equal(events.length, 1, 'must create exactly one feedback event');
    assert.equal(events[0].feedback_type, 'complaint');
  });
});

test('11. Staff compliment: thanks, detects staff praise, creates compliment event, captures staff name', async () => {
  await withHarness(async harness => {
    const r = await ask('sm-compliment', 'พี่เจิดดูแลดีมาก');
    assert.equal(r.statusCode, 200);
    const text = msg(r.payload);
    assert.match(text, /ดีใจ|ขอบคุณ/u);
    assert.match(text, /เจ้านาย|ทีมงาน/u, 'must mention routing to owner/team for morale');
    const events = harness.postsTo('ops_feedback_events');
    assert.equal(events.length, 1);
    assert.equal(events[0].feedback_type, 'compliment');
    assert.equal(events[0].staff_name, 'พี่เจิด');
  });
});

test('12. Suggestion: thanks, creates suggestion event, no overpromise', async () => {
  await withHarness(async harness => {
    const r = await ask('sm-suggestion', 'น่าจะมีแพ็กเกจครอบครัว');
    assert.equal(r.statusCode, 200);
    const text = msg(r.payload);
    assert.match(text, /ขอบคุณ/u);
    assert.doesNotMatch(text, /จะทำแพ็กเกจให้แน่นอน|จะออกแพ็กเกจนี้แน่ๆ/u, 'must never overpromise a specific outcome');
    const events = harness.postsTo('ops_feedback_events');
    assert.equal(events.length, 1);
    assert.equal(events[0].feedback_type, 'suggestion');
  });
});

// ---------------------------------------------------------------------
// SECTION 3 -- AFTER CONVERSATION
// ---------------------------------------------------------------------

test('13. Thank-you follow-up: warm close, optional light feedback invitation, no spam', async () => {
  await withHarness(async () => {
    const r = await ask('sm-thankyou', 'ขอบคุณ');
    assert.equal(r.statusCode, 200);
    const text = msg(r.payload);
    assert.doesNotMatch(text, NO_GENERIC_FAILURE);
    assert.match(text, /ยินดี/u);
  });
});

test('14. Complaint routing: business_unit restaurant, severity normal/high, route_target restaurant_group', async () => {
  await withHarness(async harness => {
    const r = await ask('sm-restaurant-complaint', 'ร้านอาหารรอนานมาก');
    assert.equal(r.statusCode, 200);
    const events = harness.postsTo('ops_feedback_events');
    assert.equal(events.length, 1);
    assert.equal(events[0].feedback_type, 'complaint');
    assert.equal(events[0].business_unit, 'restaurant');
    assert.ok(['normal', 'high'].includes(String(events[0].severity)));
    assert.equal(events[0].route_target, 'restaurant_group');
  });
});

test('15. Activity safety issue: safety_issue, business_unit activity, severity urgent/high, no fake ground conclusion', async () => {
  await withHarness(async harness => {
    const r = await ask('sm-activity-safety', 'พื้นลื่นมาก ตอนเล่น ATV น่ากลัว');
    assert.equal(r.statusCode, 200);
    const text = msg(r.payload);
    assert.doesNotMatch(text, /พื้นแห้งแน่นอน|พื้นลื่นแน่นอนครับตอนนี้/u, 'must never assert a definite ground-condition conclusion');
    const events = harness.postsTo('ops_feedback_events');
    assert.equal(events.length, 1);
    assert.equal(events[0].feedback_type, 'safety_issue');
    assert.equal(events[0].business_unit, 'activity');
    assert.ok(['high', 'urgent'].includes(String(events[0].severity)));
  });
});

test('16. Stay complaint: business_unit stay, complaint event, apology, asks one useful detail', async () => {
  await withHarness(async harness => {
    const r = await ask('sm-stay-complaint', 'ห้องพักไม่ค่อยสะอาด');
    assert.equal(r.statusCode, 200);
    const text = msg(r.payload);
    assert.match(text, /ขอโทษ/u);
    const events = harness.postsTo('ops_feedback_events');
    assert.equal(events.length, 1);
    assert.equal(events[0].feedback_type, 'complaint');
    assert.equal(events[0].business_unit, 'stay');
  });
});

test('17. System feedback: acknowledges, no defensiveness, routes to admin/general', async () => {
  await withHarness(async harness => {
    const r = await ask('sm-system-feedback', 'ทองไทยตอบยาวไป');
    assert.equal(r.statusCode, 200);
    const text = msg(r.payload);
    assert.match(text, /ขอบคุณ/u);
    assert.doesNotMatch(text, /ไม่ใช่ความผิด|จริงๆ แล้วทองไทยตอบถูกแล้ว/u, 'must never be defensive about its own answers');
    const events = harness.postsTo('ops_feedback_events');
    assert.equal(events.length, 1);
    assert.equal(events[0].feedback_type, 'system_feedback');
    assert.equal(events[0].route_target, 'admin_group');
  });
});

test('18. Feedback spam guard: normal multi-turn conversation never triggers an unsolicited feedback request', async () => {
  await withHarness(async harness => {
    const gid = guestId('sm-spam-guard');
    const turns = ['มาครั้งแรกมีอะไรแนะนำ', 'มีเวลา 3 ชั่วโมง', 'ร้านมีอะไรกิน', 'มีห้องไหม'];
    for (const message of turns) {
      const r = await processThongthaiChatCore(brainRequest(message, gid, 'web'), 'evt-1');
      assert.equal(r.statusCode, 200);
      const text = msg(r.payload);
      assert.doesNotMatch(text, /ช่วยได้ตรงใจไหมครับ|ให้คะแนนความพึงพอใจ|ทองไทยตอบได้ดีไหม/u, `"${message}" must not spam an unsolicited feedback request`);
    }
    assert.equal(harness.postsTo('ops_feedback_events').length, 0, 'none of these 4 ordinary turns should create a feedback event');
  });
});

test('19. Transaction safety: complaint + bare "ยืนยัน" never triggers a transaction', async () => {
  await withHarness(async harness => {
    const r = await ask('sm-transaction-safety', 'บริการแย่มาก ยืนยัน');
    assert.equal(r.statusCode, 200);
    const text = msg(r.payload);
    assert.match(text, /ขอโทษ/u, 'must be handled as a complaint');
    assert.equal(harness.postsTo('bookings').length, 0);
    assert.equal(harness.postsTo('promotion_redemptions').length, 0);
    assert.equal(harness.postsTo('restaurant_preorders_rpc').length, 0);
    const events = harness.postsTo('ops_feedback_events');
    assert.equal(events.length, 1);
    assert.equal(events[0].feedback_type, 'complaint');
  });
});

test('21. Notification actually sent: when a team channel IS bound, the customer-facing wording reflects that it was already routed, not "will be"', async () => {
  await withHarness(async harness => {
    harness.programOpsChannel('restaurant');
    const r = await ask('sm-notify-sent', 'ร้านอาหารรอนานมาก');
    assert.equal(r.statusCode, 200);
    const text = msg(r.payload);
    assert.match(text, /ส่งเรื่องให้ทีมที่เกี่ยวข้องแล้วครับ/u, 'must use past-tense wording once the notification actually sent');
    assert.doesNotMatch(text, /จะส่งต่อให้เจ้านายกับทีมที่เกี่ยวข้องครับ/u, 'must not ALSO use the future-tense "will route" wording once it already sent');
  });
});

test('20. Event failure fallback: if the feedback table write fails, the customer still gets a sincere response, no crash, no generic slow apology', async () => {
  await withHarness(async () => {
    // Simulate the migration genuinely not being applied yet (its real,
    // current state -- see THONGTHAI_HANDOFF.md) by making ONLY the
    // ops_feedback_events write fail -- everything else (guest lookup,
    // memory, etc.) still goes through the harness's normal mock.
    const wrapped = global.fetch;
    global.fetch = (async (url: string | URL, init?: RequestInit) => {
      if (String(url).includes('ops_feedback_events')) {
        return new Response('relation "ops_feedback_events" does not exist', { status: 404 });
      }
      return wrapped(url, init);
    }) as typeof fetch;
    try {
      const gid = guestId('sm-event-failure');
      const r = await processThongthaiChatCore(brainRequest('บริการแย่มาก', gid, 'web'), 'evt-1');
      assert.equal(r.statusCode, 200, 'must still return a normal response, never crash the request');
      const text = msg(r.payload);
      assert.match(text, /ขอโทษ/u, 'customer still gets the sincere apology even though the event write failed');
      assert.doesNotMatch(text, /ทองไทยคิดช้ากว่าปกติ|ลองส่งอีกครั้งในอีกสักครู่/u, 'must never fall back to the generic LLM-outage apology');
    } finally {
      global.fetch = wrapped;
    }
  });
});
