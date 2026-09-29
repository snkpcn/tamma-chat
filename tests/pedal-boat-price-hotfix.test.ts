// Pedal boat ("ปั่นเป็ดน้ำ") price hotfix regression tests for a real
// owner live-LINE retest failure after Phase 4 (#235)/Phase 5 (#236) and
// the Phase 5 conversational hotfix (#237) had already shipped.
//
// Root cause: Phase 4's migration (phase4-dynamic-knowledge-v1.sql) really
// did seed public.activity_offerings (30min=50THB, 60min=100THB) and
// public.service_resources (inventoryTotal=2) for activity_code=
// 'pedal_boat', and _activity-sot.ts already knew how to read them -- but
// NOTHING upstream ever recognized "เป็ดน้ำ"/"ปั่นเป็ดน้ำ"/etc. as a real
// activity topic at all, so no turn ever asked the knowledge gateway for
// pedal_boat facts in the first place:
//   1. _ecosystem-entity-graph.ts (the doctrine-level "what do we really
//      offer" structure every topic classifier treats as canonical) had
//      horse/ATV/archery nodes but no pedal-boat node.
//   2. _deterministic-semantic-turn.ts's ACTIVITY_TOPIC_KEYWORDS (the
//      zero-cost fallback's own activity-topic recognizer) had no pedal-
//      boat entry.
//   3. _semantic-interpreter.ts's OWN prompt explicitly told the real
//      model "set entities.activityCode to horse|atv|archery" -- a closed
//      enum that didn't include pedal_boat, so even a model that
//      correctly understood "เป็ดน้ำ" meant pedal-boating had no valid
//      canonical code to emit, and the knowledge gateway could never
//      match it against activity_offerings/service_resources.
// All three fixed; _response-composer.ts's own pedal-boat-aware price/
// inventory formatting (mode 'เรือเป็ด X ลำ') was already correct and
// needed no changes -- it just never received any facts to format.
//
// Tests drive the real processThongthaiChatCore end-to-end under this
// repo's forced-provider-outage convention, using a per-test catalog
// override (canonical-core-harness's default fixture only seeds horse/ATV,
// and its one horse row uses stale duration/price values that don't match
// the real production migration) so this suite genuinely exercises
// canonical-data precedence rather than the shared default fixture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withHarness, guestId, brainRequest, type HarnessCatalog } from './helpers/canonical-core-harness';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';

function msg(payload: unknown): string {
  return String((payload as { message: string }).message);
}

const PRICE_UNVERIFIED = /ยังไม่มีข้อมูลยืนยัน|ยังไม่ได้ระบุไว้|ทีมงานต้องยืนยัน/u;
const MENU_POLLUTION = /ตำไทย|กุ้ง|เมนู/u;

function baseCatalog(pedalBoat30: number, pedalBoat60: number): HarnessCatalog {
  return {
    activityOfferings: [
      { activity_code: 'horse', activity_name: 'ขี่ม้า', duration_minutes: 30, price: 300, currency: 'THB', metadata: {} },
      { activity_code: 'horse', activity_name: 'ขี่ม้า', duration_minutes: 45, price: 500, currency: 'THB', metadata: {} },
      { activity_code: 'atv', activity_name: 'ATV', duration_minutes: 30, price: 400, currency: 'THB', metadata: {} },
      { activity_code: 'pedal_boat', activity_name: 'ปั่นเรือเป็ดน้ำ', duration_minutes: 30, price: pedalBoat30, currency: 'THB', metadata: {} },
      { activity_code: 'pedal_boat', activity_name: 'ปั่นเรือเป็ดน้ำ', duration_minutes: 60, price: pedalBoat60, currency: 'THB', metadata: {} },
    ],
    serviceResources: [
      { id: 'res-room-a', code: 'stay-hueun', name: 'เฮือนสเตย์', metadata: {} },
      {
        id: 'res-pedal-boat', code: 'activity-pedal-boat', name: 'ปั่นเรือเป็ดน้ำ', default_capacity: 2, active: true,
        metadata: { activityCode: 'pedal_boat', inventoryTotal: 2, status: 'available' },
      },
    ],
  };
}

const CATALOG = baseCatalog(50, 100);

test('TEST 1 -- pedal boat price direct: "เป็ดน้ำเท่าไหร่" answers with real duration prices', async () => {
  await withHarness(async () => {
    const gid = guestId('boat-t1-direct');
    const r = await processThongthaiChatCore(brainRequest('เป็ดน้ำเท่าไหร่', gid, 'web'), 'evt-0');
    assert.equal(r.statusCode, 200);
    const reply = msg(r.payload);
    assert.doesNotMatch(reply, PRICE_UNVERIFIED, 'must not say the price is unverified/unspecified');
    assert.match(reply, /30\s*นาที/u);
    assert.match(reply, /50\s*บาท/u);
    assert.match(reply, /(?:60\s*นาที|1\s*ชั่วโมง)/u);
    assert.match(reply, /100\s*บาท/u);
  }, CATALOG);
});

test('TEST 2 -- pedal boat price explicit: "ปั่นเป็ดน้ำอ่ะราคาเท่าไหร่ครับ" answers with real duration prices and mentions inventory', async () => {
  await withHarness(async () => {
    const gid = guestId('boat-t2-explicit');
    const r = await processThongthaiChatCore(brainRequest('ปั่นเป็ดน้ำอ่ะราคาเท่าไหร่ครับ', gid, 'web'), 'evt-0');
    assert.equal(r.statusCode, 200);
    const reply = msg(r.payload);
    assert.doesNotMatch(reply, PRICE_UNVERIFIED);
    assert.match(reply, /50\s*บาท/u);
    assert.match(reply, /100\s*บาท/u);
    assert.match(reply, /2\s*ลำ/u, 'must mention the real 2-boat inventory');
  }, CATALOG);
});

test('TEST 3 -- pedal boat aliases all resolve to the same pricing', async () => {
  await withHarness(async () => {
    const messages = ['เรือเป็ดเท่าไหร่', 'เรือเป็ดน้ำราคาเท่าไหร่', 'ถีบเป็ดกี่บาท'];
    for (const [i, message] of messages.entries()) {
      const gid = guestId(`boat-t3-alias-${i}`);
      const r = await processThongthaiChatCore(brainRequest(message, gid, 'web'), 'evt-0');
      assert.equal(r.statusCode, 200);
      const reply = msg(r.payload);
      assert.doesNotMatch(reply, PRICE_UNVERIFIED, `"${message}" must resolve to real pedal-boat pricing`);
      assert.match(reply, /50\s*บาท/u, `"${message}" must show the 30-minute price`);
      assert.match(reply, /100\s*บาท/u, `"${message}" must show the 60-minute price`);
    }
  }, CATALOG);
});

test('TEST 4 -- horse price still works after the pedal-boat fix', async () => {
  await withHarness(async () => {
    const gid = guestId('boat-t4-horse-control');
    const r = await processThongthaiChatCore(brainRequest('ขี่ม้ากี่บาท', gid, 'web'), 'evt-0');
    assert.equal(r.statusCode, 200);
    const reply = msg(r.payload);
    assert.match(reply, /30\s*นาที/u);
    assert.match(reply, /300\s*บาท/u);
    assert.match(reply, /45\s*นาที/u);
    assert.match(reply, /500\s*บาท/u);
  }, CATALOG);
});

test('TEST 5 -- no menu/allergy context pollution: a prior food-allergy question does not leak into a later pedal-boat price question', async () => {
  await withHarness(async () => {
    const gid = guestId('boat-t5-no-pollution');
    const prior = await processThongthaiChatCore(brainRequest('แพ้กุ้ง ตำไทยกินได้ไหม', gid, 'web'), 'evt-0');
    assert.equal(prior.statusCode, 200);

    const r = await processThongthaiChatCore(brainRequest('เป็ดน้ำเท่าไหร่', gid, 'web'), 'evt-1');
    assert.equal(r.statusCode, 200);
    const reply = msg(r.payload);
    assert.doesNotMatch(reply, MENU_POLLUTION, 'must never mention the earlier menu/allergy topic');
    assert.doesNotMatch(reply, PRICE_UNVERIFIED);
    assert.match(reply, /50\s*บาท/u);
  }, CATALOG);
});

test('TEST 6 -- production-data precedence: changing the canonical 30-minute price changes the answer without touching any composer text', async () => {
  await withHarness(async () => {
    const gid = guestId('boat-t6-precedence');
    const r = await processThongthaiChatCore(brainRequest('เป็ดน้ำเท่าไหร่', gid, 'web'), 'evt-0');
    assert.equal(r.statusCode, 200);
    const reply = msg(r.payload);
    assert.match(reply, /75\s*บาท/u, 'the answer must reflect the canonical fixture value (75), not a hardcoded 50');
    assert.doesNotMatch(reply, /\b50\s*บาท/u);
  }, baseCatalog(75, 100));
});

test('duck disambiguation: a pedal-boat question is never routed into the restaurant advisor', async () => {
  await withHarness(async () => {
    const gid = guestId('boat-duck-disambiguation');
    const r = await processThongthaiChatCore(brainRequest('เป็ดน้ำเท่าไหร่', gid, 'web'), 'evt-0');
    assert.equal(r.statusCode, 200);
    const reply = msg(r.payload);
    assert.doesNotMatch(reply, /เมนู|ร้านอาหาร|สั่งอาหาร/u, 'must never be answered as a restaurant/menu question');
  }, CATALOG);
});
