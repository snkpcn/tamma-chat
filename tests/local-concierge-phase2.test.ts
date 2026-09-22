// LOCAL CONCIERGE PHASE 2 -- real location (owner Maps link), horse
// ride-feel facts, typo/casual-phrasing tolerance, and bare visitor-
// context handling. Driven through the real canonical entry point
// processThongthaiChatCore exactly like local-concierge-intelligence.test.ts
// -- do NOT inject ideal SemanticTurns. See THONGTHAI_HANDOFF.md's Local
// Concierge Intelligence Framework section for the full design writeup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withHarness, guestId, brainRequest } from './helpers/canonical-core-harness';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';
import { TAMMA_CHART_LOCATION } from '../netlify/functions/_local-concierge-location';

function msg(payload: unknown): string {
  return String((payload as { message: string }).message);
}

async function ask(seed: string, message: string) {
  const gid = guestId(seed);
  return processThongthaiChatCore(brainRequest(message, gid, 'web'), 'evt-1');
}

const NO_GENERIC_FAILURE = /ไม่มีข้อมูลที่ยืนยันได้สำหรับเรื่องนี้|ทองไทยคิดช้า|เชื่อมต่อไม่ได้/u;

test('A. location questions: answers with the real owner-provided Maps link, never an invented address', async () => {
  await withHarness(async () => {
    const messages = ['ทำมา-ชาติอยู่ที่ไหน', 'ขอโลเคชั่นหน่อย', 'ไปยังไง', 'ปักหมุดให้หน่อย', 'ใกล้อะไรบ้าง'];
    for (const [i, message] of messages.entries()) {
      const r = await ask(`concierge-location-${i}`, message);
      assert.equal(r.statusCode, 200);
      const message_ = msg(r.payload);
      assert.doesNotMatch(message_, NO_GENERIC_FAILURE, `"${message}" must not get a generic failure`);
      assert.match(message_, /maps\.app\.goo\.gl/u, `"${message}" must include the real owner-provided Maps link`);
      assert.ok(
        message_.includes(TAMMA_CHART_LOCATION.mapsLink),
        `"${message}" must use the exact canonical Maps link, never a different/invented one`,
      );
    }
  });
});

test('C. region/weather casual-phrasing and typo tolerance: gets a real concierge answer, not a non-answer', async () => {
  await withHarness(async () => {
    const messages = ['อีสานมีไรดี', 'อิสานมีอะไรดี', 'แถวนี้มีไรบ้าง', 'ฝนตกขี่ม้าได้ไหม', 'แดดแรงปะ'];
    for (const [i, message] of messages.entries()) {
      const r = await ask(`concierge-typo-${i}`, message);
      assert.equal(r.statusCode, 200);
      const message_ = msg(r.payload);
      assert.doesNotMatch(message_, NO_GENERIC_FAILURE, `"${message}" must not get a generic failure`);
      assert.ok(message_.length > 10, `"${message}" must get a real, substantive answer`);
    }
  });
});

test('D. bare visitor-context mentions: get a helpful concierge response, not a generic non-answer', async () => {
  await withHarness(async () => {
    const messages = [
      'มากับแฟน', 'มากับครอบครัว', 'มีเด็กกับผู้สูงอายุ', 'พาแม่มา', 'มากับลูก',
      'ไม่อยากเดินเยอะ', 'อยากชิล', 'อยากลุย',
    ];
    for (const [i, message] of messages.entries()) {
      const r = await ask(`concierge-bare-context-${i}`, message);
      assert.equal(r.statusCode, 200);
      const message_ = msg(r.payload);
      assert.doesNotMatch(message_, NO_GENERIC_FAILURE, `"${message}" must not get a generic failure`);
      const mentionsRealOption = /กิน|ตำมา-ชาติ|พัก|เฮือนสเตย์|กิจกรรม|ขี่ม้า|ATV|ยิงธนู|คาเฟ่|Inthanin/u.test(message_);
      assert.ok(mentionsRealOption, `"${message}" must connect to a real ทำมา-ชาติ option, not a vague non-answer`);
    }
  });
});

test('E. food-culture questions still win over a bare companion mention in the same message', async () => {
  await withHarness(async () => {
    const r = await ask('concierge-food-companion', 'มากับแฟนกินอะไรดี');
    assert.equal(r.statusCode, 200);
    const message = msg(r.payload);
    assert.doesNotMatch(message, NO_GENERIC_FAILURE);
    assert.doesNotMatch(message, /\d+\s*บาท/u, 'must never invent a specific menu price');
  });
});

test('G. horse ride-feel facts: uses exactly the owner-verified facts, never a safety/beginner/better-worse claim', async () => {
  await withHarness(async () => {
    const messages = ['ทองไทยกับภาราดรขี่ต่างกันยังไง', 'ตัวไหนขี่นิ่มกว่า', 'ทองไทยขี่ยังไง'];
    for (const [i, message] of messages.entries()) {
      const r = await ask(`concierge-horse-${i}`, message);
      assert.equal(r.statusCode, 200);
      const message_ = msg(r.payload);
      assert.doesNotMatch(message_, NO_GENERIC_FAILURE, `"${message}" must not get a generic failure`);
      assert.doesNotMatch(message_, /ภาราดรปลอดภัยกว่า|ทองไทยดื้อ|เหมาะกับมือใหม่แน่นอน/u, `"${message}" must never assert an unconfigured claim`);
      assert.doesNotMatch(message_, /ดีกว่า|แย่กว่า/u, `"${message}" must never frame one horse as absolutely better/worse`);
    }
    // The one message that names both horses explicitly must use the exact
    // owner-verified ride-feel facts.
    const r = await ask('concierge-horse-both', 'ทองไทยกับภาราดรขี่ต่างกันยังไง');
    const message = msg(r.payload);
    assert.match(message, /ขี่กระด้างกว่านิดนึง/u);
    assert.match(message, /ขี่นิ่มกว่านิดหน่อย/u);
  });
});

test('H. routing safety for the new categories: location/horse questions never swallow an explicit transaction, ' +
  'and horse_comparison never steals a temperament/beginner-suitability question from the existing compare-entities path', async () => {
  await withHarness(async harness => {
    // Explicit "book now" with a location question glued on must still
    // reach the real activity flow, not the location composer.
    const r1 = await ask('concierge-h-routing-1', 'อยู่ที่ไหน จองขี่ม้าเลย');
    assert.equal(r1.statusCode, 200);
    assert.equal(harness.postsTo('bookings').length, 0, 'must not create a real booking without a full confirmed flow');

    // Temperament/beginner-suitability comparison must still be honestly
    // declined by the EXISTING compare-entities mechanism, not answered
    // with the new ride-feel facts.
    const r2 = await ask('concierge-h-routing-2', 'ภาราดรกับทองไทยตัวไหนนิสัยดีกว่า');
    assert.equal(r2.statusCode, 200);
    const message2 = msg(r2.payload);
    assert.doesNotMatch(message2, /ขี่กระด้างกว่านิดนึง|ขี่นิ่มกว่านิดหน่อย/u, 'must not answer a temperament question with ride-feel facts');
    assert.match(message2, /ไม่มีข้อมูล|ไม่ขอเดา/u);

    const r3 = await ask('concierge-h-routing-3', 'มือใหม่ควรเลือกตัวไหน');
    assert.equal(r3.statusCode, 200);
    const message3 = msg(r3.payload);
    assert.doesNotMatch(message3, /ขี่กระด้างกว่านิดนึง|ขี่นิ่มกว่านิดหน่อย/u, 'must not answer a beginner-suitability question with ride-feel facts');
  });
});
