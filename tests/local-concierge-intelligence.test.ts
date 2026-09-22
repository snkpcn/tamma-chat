// LOCAL CONCIERGE INTELLIGENCE FRAMEWORK -- broad local-area/weather-
// condition/food-culture/visitor-journey/activity-suitability/safety
// questions, driven through the real canonical entry point
// processThongthaiChatCore (never hand-constructed SemanticTurn objects).
// See THONGTHAI_HANDOFF.md's "Local Concierge Intelligence Framework"
// section for the full design writeup. Grouped by category exactly as the
// owner's own test strategy specified -- not one phrase, a structural
// framework: every classifier in _local-concierge-intent.ts is a small,
// closed set of markers, never a growing table of exact phrases.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withHarness, guestId, brainRequest } from './helpers/canonical-core-harness';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';

function msg(payload: unknown): string {
  return String((payload as { message: string }).message);
}

async function ask(harness: unknown, seed: string, message: string) {
  const gid = guestId(seed);
  return processThongthaiChatCore(brainRequest(message, gid, 'web'), 'evt-1');
}

const NO_LIVE_FACT = /\d{1,2}[:.]\d{2}\s*น|จะมีฝนตกแน่นอน|วันนี้ฝนตกแน่/u;
const NO_GENERIC_FAILURE = /ไม่มีข้อมูลที่ยืนยันได้สำหรับเรื่องนี้/u;

test('A. weather/condition questions: no generic failure, no fake live weather, practical guidance, connects to ทำมา-ชาติ', async () => {
  await withHarness(async harness => {
    const messages = [
      'อิสานมีอะไรดี ช่วงนี้ฝนตกไหมอะ',
      'แดดแรงไหม ไปทำอะไรดี',
      'ร้อนไหม ต้องเตรียมอะไร',
      'อากาศดีไหมวันนี้',
      'ฝนตกแล้วยังทำอะไรได้บ้าง',
    ];
    for (const [i, message] of messages.entries()) {
      const r = await ask(harness, `concierge-weather-${i}`, message);
      assert.equal(r.statusCode, 200);
      const message_ = msg(r.payload);
      assert.doesNotMatch(message_, NO_GENERIC_FAILURE, `"${message}" must not get a generic failure`);
      assert.doesNotMatch(message_, NO_LIVE_FACT, `"${message}" must never assert a specific live weather fact`);
      assert.match(message_, /ตำมา-ชาติ|Inthanin|เฮือนสเตย์|กิจกรรมกลางแจ้ง/u, `"${message}" must connect to real ทำมา-ชาติ options`);
    }
  });
});

test('A2. activity + weather-condition blend routes to concierge reasoning, not a generic inventory listing', async () => {
  await withHarness(async harness => {
    const r = await ask(harness, 'concierge-weather-activity', 'พรุ่งนี้ฝนตกไหม ขี่ม้าได้ไหม');
    assert.equal(r.statusCode, 200);
    const message = msg(r.payload);
    assert.match(message, /ขี่ม้า/u);
    assert.match(message, /ทีมงาน|หน้างาน/u, 'must defer the real safety call to staff, never assert it can/cannot ride');
    assert.doesNotMatch(message, /ขี่ม้าได้แน่นอน|ขี่ม้าไม่ได้แน่นอน/u, 'must never assert a definite yes/no on live conditions it has no data for');
  });
});

test('B. place/region questions: locally aware, concise, connects to real business categories', async () => {
  await withHarness(async harness => {
    const messages = ['อีสานมีอะไรดี', 'ชัยภูมิน่าเที่ยวตรงไหน', 'ที่นี่ต่างจากที่อื่นยังไง', 'ทำมา-ชาติฟีลแบบไหน'];
    for (const [i, message] of messages.entries()) {
      const r = await ask(harness, `concierge-region-${i}`, message);
      assert.equal(r.statusCode, 200);
      const message_ = msg(r.payload);
      assert.doesNotMatch(message_, NO_GENERIC_FAILURE, `"${message}" must not get a generic failure`);
      assert.match(message_, /อีสาน|ท้องถิ่น|ธรรมชาติ/u, `"${message}" must give real region character, not a Wikipedia dump`);
      assert.ok(message_.length < 400, `"${message}" reply must stay concise (quality bar: not an encyclopedia block)`);
    }
  });
});

test('C. food-culture questions: uses real style, handles constraints, does not invent a menu item', async () => {
  await withHarness(async harness => {
    const messages = ['อาหารอีสานแท้ๆ คือแนวไหน', 'อยากกินนัวๆ แนะนำอะไร', 'ไม่กินเผ็ดกินอะไรได้', 'เด็กกินอะไรได้', 'เมนูไหน local ที่สุด'];
    for (const [i, message] of messages.entries()) {
      const r = await ask(harness, `concierge-food-${i}`, message);
      assert.equal(r.statusCode, 200);
      const message_ = msg(r.payload);
      assert.doesNotMatch(message_, NO_GENERIC_FAILURE, `"${message}" must not get a generic failure`);
      assert.doesNotMatch(message_, /\d+\s*บาท/u, `"${message}" must never invent a specific menu price without checking the real menu`);
    }
  });
});

test('D. visitor-journey requests: suggests a journey covering multiple business units, never books prematurely', async () => {
  await withHarness(async harness => {
    const messages = [
      'มีเวลา 3 ชั่วโมง จัดทริปให้หน่อย',
      'มากับแฟนมีอะไรโรแมนติกไหม',
      'มากับครอบครัว มีเด็กด้วย',
      'ไม่อยากเดินเยอะ อยากชิล',
    ];
    for (const [i, message] of messages.entries()) {
      const r = await ask(harness, `concierge-journey-${i}`, message);
      assert.equal(r.statusCode, 200);
      const message_ = msg(r.payload);
      assert.doesNotMatch(message_, NO_GENERIC_FAILURE, `"${message}" must not get a generic failure`);
      const mentionsMultipleUnits = [/กิน|ตำมา-ชาติ/u, /พัก|เฮือนสเตย์/u, /กิจกรรม|ขี่ม้า|ATV|ยิงธนู/u, /คาเฟ่|Inthanin/u]
        .filter(pattern => pattern.test(message_)).length;
      assert.ok(mentionsMultipleUnits >= 2, `"${message}" must touch multiple business units, not just one`);
      assert.equal(harness.postsTo('bookings').length, 0, `"${message}" must never create a booking`);
    }
  });
});

test('E. activity-suitability / safety questions: never invents safety/temperament facts, defers to staff, offers alternatives', async () => {
  await withHarness(async harness => {
    const messages = ['ฝนตกขี่ม้าได้ไหม', 'แดดแรงขี่ม้าได้ไหม', 'เด็กเล่น ATV ได้ไหม', 'ยิงธนูยากไหม'];
    for (const [i, message] of messages.entries()) {
      const r = await ask(harness, `concierge-safety-${i}`, message);
      assert.equal(r.statusCode, 200);
      const message_ = msg(r.payload);
      assert.doesNotMatch(message_, NO_GENERIC_FAILURE, `"${message}" must not get a generic failure`);
      assert.doesNotMatch(message_, /เล่นได้แน่นอน|เล่นไม่ได้แน่นอน|ปลอดภัยแน่นอน/u, `"${message}" must never assert a definite safety verdict`);
      assert.match(message_, /ทีมงาน|หน้างาน/u, `"${message}" must defer the real call to staff/current conditions`);
    }
    // Must never start a booking flow from a pure suitability question.
    assert.equal(harness.postsTo('bookings').length, 0);
  });
});

test('E2. temperament comparison keeps using the EXISTING compare-entities path (not duplicated by the new framework)', async () => {
  await withHarness(async harness => {
    const r = await ask(harness, 'concierge-temperament', 'ภาราดรกับทองไทยตัวไหนนิสัยดีกว่า');
    assert.equal(r.statusCode, 200);
    const message = msg(r.payload);
    assert.doesNotMatch(message, /ภาราดร(?:ดีกว่า|นิสัยดี)|ทองไทย(?:ดีกว่า|นิสัยดี)/u, 'must never assert either horse has a better temperament');
    assert.match(message, /ไม่มีข้อมูล|ไม่ขอเดา/u);
  });
});

test('F. routing safety: local info never swallows an explicit transaction/confirm/signup/book/accept intent in the same message', async () => {
  await withHarness(async harness => {
    // Bare confirm with no pending task: must not be answered as a weather
    // question, and (since nothing is pending) must not create anything.
    const r1 = await ask(harness, 'concierge-routing-1', 'ฝนตกไหม ยืนยัน');
    assert.equal(r1.statusCode, 200);
    assert.equal(harness.postsTo('bookings').length, 0);
    assert.equal(harness.postsTo('promotion_redemptions').length, 0);

    // Explicit signup marker must reach the real membership flow, not the
    // weather composer.
    const r2 = await ask(harness, 'concierge-routing-2', 'แดดแรงไหม สมัครสมาชิก');
    assert.equal(r2.statusCode, 200);
    assert.match(msg(r2.payload), /สมัครสมาชิก/u);
    assert.doesNotMatch(msg(r2.payload), /สภาพอากาศ/u, 'must not answer as a weather question when signup intent is explicit');

    // Explicit "book now" must reach the real activity flow, not the
    // journey-planning composer.
    const r3 = await ask(harness, 'concierge-routing-3', 'มีเวลา 3 ชั่วโมง จองขี่ม้าเลย');
    assert.equal(r3.statusCode, 200);
    assert.match(msg(r3.payload), /ม้า/u);
    assert.equal(harness.postsTo('bookings').length, 0, 'still must not create a real booking without a full confirmed flow');

    // Explicit "accept this set" must reach the real restaurant menu path,
    // not the food-culture composer.
    const r4 = await ask(harness, 'concierge-routing-4', 'อาหารอีสานมีอะไร เอาชุดนี้');
    assert.equal(r4.statusCode, 200);
    assert.match(msg(r4.payload), /เมนู|บาท/u);
  });
});
