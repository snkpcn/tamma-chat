// GATE 2 (owner-specified): LINE vs Web equivalence across ALL domains, not
// just activity (activity's own deep 6-turn equivalence proof already
// exists in tests/web-line-channel-equivalence.test.ts, driven through
// processThongthaiOneMindTurnAuthoritative directly since activity is fully
// cut over to One-Mind).
//
// The other 7 domains here still route through the LEGACY thongthai-chat.ts
// machinery for most turns (see Gate 1's findings) -- per the owner's
// explicit instruction, that is exactly what this harness must test, not a
// reason to skip it. So this file drives the REAL shared entry point,
// processThongthaiChatCore, for both channel='web' and channel='line',
// using two independent guests per domain (a real LINE guest and a real Web
// guest are different people), and asserts equivalent BUSINESS meaning:
// same real facts/entities surfaced, same missing-field/transaction-gating
// behavior, same write counts. Response text may legitimately differ in
// exact formatting (see _chat-copy-style.ts's polishCustomerMessage, which
// treats 'web' and 'line' as the same "plain text channel" today, so in
// practice the wording is usually identical too -- but these assertions
// check business facts, not byte-for-byte string equality, so a future
// legitimate channel-specific formatting tweak won't break them).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withHarness, guestId, brainRequest } from './helpers/canonical-core-harness';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';

function msg(payload: unknown): string {
  return String((payload as { message: string }).message);
}

test('Gate 2 / stay: read-only inquiry surfaces identical real facts on both channels', async () => {
  await withHarness(async harness => {
    const webId = guestId('gate2-stay-web');
    const lineId = guestId('gate2-stay-line');
    const web = await processThongthaiChatCore(brainRequest('เช็คอินกี่โมง', webId, 'web'), 'evt-web-1');
    const line = await processThongthaiChatCore(brainRequest('เช็คอินกี่โมง', lineId, 'line'), 'evt-line-1');
    assert.equal(web.statusCode, 200);
    assert.equal(line.statusCode, 200);
    // FORMERLY A KNOWN GAP (see THONGTHAI_HANDOFF.md's "Semantic
    // Hospitality Intelligence" / "Knowledge Base + Scenario Brain"
    // entries): "เช็คอินกี่โมง" used to collapse to a generic stay-catalog
    // answer with no real check-in time. thongthai-chat.ts's
    // homestayFactsResponse now answers this from real, owner-provided
    // static facts (_tamma-domain-knowledge.ts's HOMESTAY_FACTS) -- a
    // genuine per-question adapter, not a guess -- so asserting a real
    // "14:00" here is correct, not a hallucination.
    assert.equal(msg(web.payload), msg(line.payload), 'both channels must answer identically');
    assert.match(msg(web.payload), /14:00/, 'must answer from the real, owner-provided check-in fact');
  });
});

test('Gate 2 / restaurant: menu discovery and missing-field prompting behave identically on both channels', async () => {
  await withHarness(async harness => {
    const webId = guestId('gate2-restaurant-web');
    const lineId = guestId('gate2-restaurant-line');

    const webMenu = await processThongthaiChatCore(brainRequest('ร้านมีอะไรกิน', webId, 'web'), 'evt-web-1');
    const lineMenu = await processThongthaiChatCore(brainRequest('ร้านมีอะไรกิน', lineId, 'line'), 'evt-line-1');
    for (const payload of [webMenu.payload, lineMenu.payload]) {
      assert.match(msg(payload), /ผัดไทย/);
      assert.match(msg(payload), /ต้มยำกุ้ง/);
    }

    // Seed an identical proposed set on both guests, then confirm both
    // channels ask for the same missing fields before creating anything.
    for (const [gid, channel] of [[webId, 'web'], [lineId, 'line']] as const) {
      const internalId = harness.guestDbId(gid)!;
      const existing = harness.getState(internalId);
      harness.setState(internalId, {
        ...(existing?.state ?? {}),
        restaurantProposedSet: {
          source: 'advisor',
          items: [{ name: 'ผัดไทย', quantity: 1 }],
          total: 120, budget: null, partySize: null, createdAt: new Date().toISOString(),
        },
      });
      const r = await processThongthaiChatCore(brainRequest('เอาชุดเมื่อกี้', gid, channel), `evt-${channel}-2`);
      assert.match(msg(r.payload), /วัน|เวลา/, `${channel} must ask for the same missing date/time`);
    }
    assert.equal(harness.postsTo('restaurant_preorders_rpc').length, 0, 'neither channel may create a preorder before all fields are given');
  });
});

test('Gate 2 / promotion: discovery and the missing-name guard behave identically on both channels', async () => {
  await withHarness(async harness => {
    const webId = guestId('gate2-promotion-web');
    const lineId = guestId('gate2-promotion-line');

    for (const [gid, channel] of [[webId, 'web'], [lineId, 'line']] as const) {
      const redemptionsBefore = harness.postsTo('promotion_redemptions').length;
      await processThongthaiChatCore(brainRequest('มีโปรอะไร', gid, channel), `evt-${channel}-1`);
      await processThongthaiChatCore(brainRequest('เอาโปรนี้', gid, channel), `evt-${channel}-2`);
      const offTopic = await processThongthaiChatCore(brainRequest('วันนี้อากาศเป็นไง', gid, channel), `evt-${channel}-3`);
      assert.equal(harness.postsTo('promotion_redemptions').length, redemptionsBefore, `${channel}: an off-topic message must never redeem a promotion`);
      assert.match(msg(offTopic.payload), /ชื่อ/, `${channel} must still be asking for the name`);
      const named = await processThongthaiChatCore(brainRequest('ชื่อสมชาย', gid, channel), `evt-${channel}-4`);
      assert.match(msg(named.payload), /เรียบร้อย|✅|บันทึก/, `${channel} must confirm the redemption once a real name is given`);
      assert.equal(harness.postsTo('promotion_redemptions').length, redemptionsBefore + 1, `${channel}: exactly one redemption, no more`);
    }
  });
});

test('Gate 2 / otop: catalog discovery is identical on both channels, neither fabricates an order', async () => {
  await withHarness(async harness => {
    const webId = guestId('gate2-otop-web');
    const lineId = guestId('gate2-otop-line');
    const web = await processThongthaiChatCore(brainRequest('มีของฝากอะไรบ้าง', webId, 'web'), 'evt-web-1');
    const line = await processThongthaiChatCore(brainRequest('มีของฝากอะไรบ้าง', lineId, 'line'), 'evt-line-1');
    for (const payload of [web.payload, line.payload]) {
      assert.match(msg(payload), /น้ำผึ้งป่า/);
      assert.match(msg(payload), /ผ้าพันคอทอมือ/);
    }
    assert.equal(harness.postsTo('otop_orders').length, 0);
  });
});

test('Gate 2 / membership: the status-question fix behaves identically on both channels', async () => {
  await withHarness(async harness => {
    const webId = guestId('gate2-membership-web');
    const lineId = guestId('gate2-membership-line');
    const web = await processThongthaiChatCore(brainRequest('ตอนนี้ผมเป็นสมาชิกหรือยัง', webId, 'web'), 'evt-web-1');
    const line = await processThongthaiChatCore(brainRequest('ตอนนี้ผมเป็นสมาชิกหรือยัง', lineId, 'line'), 'evt-line-1');
    const signupScript = /พิมพ์.*สมัครสมาชิก.*แล้วทองไทยจะพาใส่ข้อมูล/u;
    assert.doesNotMatch(msg(web.payload), signupScript, 'web status question must not get the generic sign-up script');
    assert.doesNotMatch(msg(line.payload), signupScript, 'LINE status question must not get the generic sign-up script either');
  });
});

test('Gate 2 / cafe: the honest "cannot confirm" degradation and the stay topic-switch fix are identical on both channels', async () => {
  await withHarness(async harness => {
    const webId = guestId('gate2-cafe-web');
    const lineId = guestId('gate2-cafe-line');
    for (const [gid, channel] of [[webId, 'web'], [lineId, 'line']] as const) {
      const unknown = await processThongthaiChatCore(brainRequest('มีลาเต้ไหม', gid, channel), `evt-${channel}-1`);
      assert.match(msg(unknown.payload), /ไม่มีข้อมูลยืนยัน|ไม่ขอเดา/, `${channel} must honestly say it cannot confirm`);
      const switched = await processThongthaiChatCore(brainRequest('มีห้องพักไหม', gid, channel), `evt-${channel}-2`);
      assert.match(msg(switched.payload), /เฮือนสเตย์|ที่พัก/, `${channel} must switch to the real stay answer`);
    }
  });
});

test('Gate 2 / ecosystem: broad first-visit discovery surfaces the same business categories on both channels', async () => {
  await withHarness(async harness => {
    const webId = guestId('gate2-ecosystem-web');
    const lineId = guestId('gate2-ecosystem-line');
    const web = await processThongthaiChatCore(brainRequest('มาครั้งแรกมีอะไรแนะนำ', webId, 'web'), 'evt-web-1');
    const line = await processThongthaiChatCore(brainRequest('มาครั้งแรกมีอะไรแนะนำ', lineId, 'line'), 'evt-line-1');
    for (const payload of [web.payload, line.payload]) {
      assert.match(msg(payload), /กิน|ตำมา-ชาติ|อาหาร/);
      assert.match(msg(payload), /กิจกรรม|ขี่ม้า/);
      assert.match(msg(payload), /พัก|เฮือนสเตย์/);
    }
  });
});
