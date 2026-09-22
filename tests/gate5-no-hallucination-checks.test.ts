// GATE 5 (owner-specified): dedicated no-hallucination checks across
// domains, driven through the real canonical entry point
// processThongthaiChatCore. Several domains already demonstrate this
// informally via Gate 1's own tests (especially cafe's "cannot confirm"
// coverage in cafe-cross-domain-stress.test.ts, and activity's temperament
// example already proven in tests/activity-16-turn-canonical-state.test.ts)
// -- this file is the dedicated pass across every domain, using the exact
// owner-specified unknown-fact examples where given (temperament) and one
// representative unknown-fact probe per remaining domain.
//
// The bar throughout: never assert a SPECIFIC fact (a number, a yes/no, a
// name) that isn't backed by real catalog/world_facts data. An honest
// "cannot confirm" or a truthful redirection to what IS actually known is
// always acceptable; a confident-sounding invented answer never is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withHarness, guestId, brainRequest } from './helpers/canonical-core-harness';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';

function msg(payload: unknown): string {
  return String((payload as { message: string }).message);
}

const NO_INVENTED_SPECIFICS = /\d{2,3}\s*บาท|(?<!ไม่)ว่างครับ|เปิดทุกวัน|ได้แน่นอน/u;

test('activity: the exact owner example (temperament comparison) is honestly declined, never invented', async () => {
  await withHarness(async harness => {
    const gid = guestId('gate5-activity-temperament');
    const r = await processThongthaiChatCore(brainRequest('ภาราดรกับทองไทยตัวไหนนิสัยดีกว่า', gid, 'web'), 'evt-1');
    assert.equal(r.statusCode, 200);
    const message = msg(r.payload);
    assert.doesNotMatch(message, /ภาราดร(?:ดีกว่า|นิสัยดี)|ทองไทย(?:ดีกว่า|นิสัยดี)/u, 'must never assert either horse has a better temperament');
    assert.match(message, /ไม่มีข้อมูล|ไม่ขอเดา/, 'must honestly say it cannot verify this comparison');
  });
});

test('activity: an unknown how-it-works detail is honestly declined, only the real verified duration is stated', async () => {
  await withHarness(async harness => {
    const gid = guestId('gate5-activity-how-it-works');
    const r = await processThongthaiChatCore(brainRequest('ขี่ม้ายังไง', gid, 'web'), 'evt-1');
    assert.equal(r.statusCode, 200);
    const message = msg(r.payload);
    assert.match(message, /ไม่มีข้อมูล|ไม่ขอเดา/, 'must not invent step-by-step riding instructions');
    // The one fact it DOES state (duration) must be the real catalog value,
    // not a different invented number.
    if (/นาที/u.test(message)) assert.match(message, /60\s*นาที/, 'if it states a duration, it must be the real one, not an invented one');
  });
});

test('stay: an unrecorded policy question (parking) is honestly declined, never a guessed yes/no', async () => {
  await withHarness(async harness => {
    const gid = guestId('gate5-stay-unknown-policy');
    const r = await processThongthaiChatCore(brainRequest('มีที่จอดรถไหม', gid, 'web'), 'evt-1');
    assert.equal(r.statusCode, 200);
    const message = msg(r.payload);
    assert.doesNotMatch(message, NO_INVENTED_SPECIFICS);
    assert.doesNotMatch(message, /มีที่จอดรถ|ไม่มีที่จอดรถ/u, 'must never assert parking availability it has no real data for');
  });
});

test('restaurant: an unlisted menu category (vegan/เจ) never gets a fabricated yes, only the real menu', async () => {
  await withHarness(async harness => {
    const gid = guestId('gate5-restaurant-unknown-menu');
    const r = await processThongthaiChatCore(brainRequest('มีเมนูเจไหม', gid, 'web'), 'evt-1');
    assert.equal(r.statusCode, 200);
    const message = msg(r.payload);
    assert.doesNotMatch(message, /มีเมนูเจ|เมนูเจครับ|เมนูมังสวิรัติ/u, 'must never claim a vegan menu that is not in the real catalog');
    // Whatever prices it DOES show must be the real catalog values (120/180/90),
    // never an invented one.
    for (const priceMatch of message.matchAll(/(\d+)\s*บาท/gu)) {
      assert.ok(['120', '180', '90'].includes(priceMatch[1]!), `price ${priceMatch[1]} บาท must be a real catalog price`);
    }
  });
});

test('otop: an unlisted product (t-shirts) never gets a fabricated yes/price, only an honest non-answer', async () => {
  await withHarness(async harness => {
    const gid = guestId('gate5-otop-unknown-product');
    const r = await processThongthaiChatCore(brainRequest('มีเสื้อยืดไหม', gid, 'web'), 'evt-1');
    assert.equal(r.statusCode, 200);
    const message = msg(r.payload);
    assert.doesNotMatch(message, /เสื้อยืด.*บาท|มีเสื้อยืดครับ/u, 'must never invent a t-shirt product or price');
  });
});

test('cafe: EVERY cafe fact (menu, price, hours) is honestly declined -- see documented missing-adapter gap in THONGTHAI_HANDOFF.md', async () => {
  await withHarness(async harness => {
    const gid = guestId('gate5-cafe-all-unknown');
    for (const message of ['มีลาเต้ไหม', 'ราคาเท่าไร', 'เปิดกี่โมง']) {
      const r = await processThongthaiChatCore(brainRequest(message, gid, 'web'), `evt-${message}`);
      assert.equal(r.statusCode, 200);
      assert.match(msg(r.payload), /ไม่มีข้อมูลยืนยัน|ไม่ขอเดา/, `"${message}" must be honestly declined, never guessed`);
    }
  });
});
