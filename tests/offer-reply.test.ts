import test from 'node:test';
import assert from 'node:assert/strict';
import { isLiveOffer, OFFER_TTL_MS, parseOfferReply } from '../netlify/functions/_offer-reply';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';
import { withHarness, brainRequest, guestId, type Harness } from './helpers/canonical-core-harness';
import { deliverLineTexts } from './helpers/line-channel';

const message = (payload: unknown) => String((payload as { message?: unknown }).message ?? '');
const CATALOG = /ที่ทำมา-ชาติมีหลายแบบ[\s\S]*กิจกรรม — ขี่ม้า/u;
const GREETING = 'สวัสดีครับ ขอสอบถามหน่อย';

async function webTurns(harness: Harness, seed: string, texts: string[]) {
  const gid = guestId(seed);
  const out: Array<{ reply: string; modelCalls: number }> = [];
  for (const [index, text] of texts.entries()) {
    const before = harness.modelCallCount();
    const result = await processThongthaiChatCore(brainRequest(text, gid, 'web'), `${seed}-${index}`);
    out.push({ reply: message(result.payload), modelCalls: harness.modelCallCount() - before });
  }
  return out;
}

async function lineTurns(harness: Harness, userId: string, texts: string[]) {
  const out: Array<{ reply: string; modelCalls: number }> = [];
  for (const text of texts) {
    const before = harness.modelCallCount();
    const result = await deliverLineTexts(harness, { userId, texts: [text] });
    out.push({ reply: result.replies[0]?.texts.join('\n') ?? '', modelCalls: harness.modelCallCount() - before });
  }
  return out;
}

test('a reply to the menu is recognised: all, a number, an option name; anything else is not', () => {
  for (const text of ['ทั้งหมดเลยครับ', 'ทั้งหมดเลย', 'ทั้งหมด', 'เอาหมดเลยค่ะ', 'ทุกอย่างเลยครับ', 'all of them', 'All', 'everything please']) {
    assert.deepEqual(parseOfferReply(text), { kind: 'all' }, text);
  }
  assert.deepEqual(parseOfferReply('2'), { kind: 'option', option: 'stay' });
  assert.deepEqual(parseOfferReply('กิจกรรมครับ'), { kind: 'option', option: 'activities' });
  assert.deepEqual(parseOfferReply('the weather'), { kind: 'option', option: 'weather' });
  for (const text of ['ทั้งหมดเท่าไหร่', 'ขี่ม้าราคาเท่าไหร่', 'สั่งทั้งหมดเลย', 'all of them cost how much', '7', '']) {
    assert.equal(parseOfferReply(text), null, text);
  }
});

test('an offer frames only the next turn and expires', () => {
  const now = Date.now();
  const offer = { kind: 'topic_menu', offeredAt: new Date(now - 1_000).toISOString() };
  assert.equal(isLiveOffer(offer, null, now), true);
  assert.equal(isLiveOffer(offer, new Date(now - 60_000).toISOString(), now), true, 'a turn before the offer');
  assert.equal(isLiveOffer(offer, new Date(now).toISOString(), now), false, 'a turn after the offer retires it');
  assert.equal(isLiveOffer({ kind: 'topic_menu', offeredAt: new Date(now - OFFER_TTL_MS - 1).toISOString() }, null, now), false);
  assert.equal(isLiveOffer(null, null, now), false);
});

test('the reported conversation, web: "ทั้งหมดเลยครับ" and "ทั้งหมดเลย" are answered from live data with zero model calls', async () => {
  await withHarness(async harness => {
    const [greeting, all, allAgain] = await webTurns(harness, 'offer-web-all', [GREETING, 'ทั้งหมดเลยครับ', 'ทั้งหมดเลย']);
    assert.match(greeting.reply, /กิน พัก กิจกรรม/u);
    for (const turn of [all, allAgain]) {
      assert.match(turn.reply, CATALOG);
      assert.doesNotMatch(turn.reply, /คิดช้า|ลองพิมพ์อีกครั้ง/u);
      assert.equal(turn.modelCalls, 0);
    }
  });
});

test('the reported conversation, LINE: the same, through the real webhook (no chat history on LINE)', async () => {
  await withHarness(async harness => {
    const [greeting, all, allAgain] = await lineTurns(harness, 'U-offer-all', [GREETING, 'ทั้งหมดเลยครับ', 'ทั้งหมดเลย']);
    assert.match(greeting.reply, /กิน พัก กิจกรรม/u);
    for (const turn of [all, allAgain]) {
      assert.match(turn.reply, CATALOG);
      assert.equal(turn.modelCalls, 0);
    }
  });
});

test('a number or an option name picks that topic, in the offer language, on both channels', async () => {
  await withHarness(async harness => {
    const [, webStay] = await webTurns(harness, 'offer-web-2', ['สวัสดีครับ', '2']);
    const [, lineStay] = await lineTurns(harness, 'U-offer-2', ['สวัสดีครับ', '2']);
    for (const turn of [webStay, lineStay]) {
      assert.match(turn.reply, /วันเช็กอิน วันเช็กเอาต์ และจำนวนผู้เข้าพัก/u, 'option 2 is the stay topic');
      assert.equal(turn.modelCalls, 0);
    }
    const [, webActivities] = await webTurns(harness, 'offer-web-name', ['สวัสดีครับ', 'กิจกรรมครับ']);
    assert.match(webActivities.reply, CATALOG);
    assert.equal(webActivities.modelCalls, 0);
  });
});

test('after another turn the offer is gone: "ทั้งหมดเลย" is not forced onto it', async () => {
  await withHarness(async harness => {
    const web = await webTurns(harness, 'offer-web-moved-on', ['สวัสดีครับ', 'ขี่ม้าราคาเท่าไหร่', 'ทั้งหมดเลย']);
    const line = await lineTurns(harness, 'U-offer-moved-on', ['สวัสดีครับ', 'ขี่ม้าราคาเท่าไหร่', 'ทั้งหมดเลย']);
    for (const turns of [web, line]) {
      assert.match(turns[1].reply, /ขี่ม้ามี 30 นาที 300 บาท/u);
      assert.doesNotMatch(turns[2].reply, CATALOG, 'the menu offer was retired by the price turn');
    }
  });
});
