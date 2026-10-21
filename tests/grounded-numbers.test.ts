import test from 'node:test';
import assert from 'node:assert/strict';
import { ungroundedNumericClaims } from '../netlify/functions/_grounded-numbers';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';
import { brainRequest, guestId, withHarness, type Harness } from './helpers/canonical-core-harness';
import { deliverLineTexts } from './helpers/line-channel';

// A figure the model wrote -- price, time, length, percentage -- must come
// from the data it was given or from the customer. Before, the composer
// only checked fact keys and the legacy brain nothing at all.

const semantic = (overrides: Record<string, unknown>) => ({
  normalizedMeaning: 'x', reply: '', speechAct: 'question', domain: 'general', intent: 'open_chat', action: 'ask',
  informationNeed: 'none', entities: {}, references: [], constraints: [], confidence: 0.95, needsClarification: false,
  ...overrides,
});

async function reply(harness: Harness, channel: 'web' | 'line', seed: string, text: string, modelReplies: Array<Record<string, unknown>>) {
  for (const modelReply of modelReplies) harness.programGeminiReply(modelReply);
  if (channel === 'web') {
    const result = await processThongthaiChatCore(brainRequest(text, guestId(seed), 'web'), seed);
    return String((result.payload as { message?: unknown }).message ?? '');
  }
  const result = await deliverLineTexts(harness, { userId: `U-${seed}`, texts: [text] });
  return result.replies[0]?.texts.join('\n') ?? '';
}

test('the claims read: money, clock time, length, percentage; grounded by values, keys, timestamps or the customer', () => {
  const facts = [
    { key: 'activity:horse:30min:price', value: 300 },
    { key: 'organization:regularOpeningHours', value: [{ opens: '06:00', closes: '18:00' }] },
    { key: 'availability:activity-horse:2026-10-22T03:00:00.000Z:startAt', value: '2026-10-22T03:00:00.000Z' },
  ];
  const check = (message: string, customerText: string[] = []) => ungroundedNumericClaims(message, { facts, customerText }).map(claim => claim.text);
  assert.deepEqual(check('ขี่ม้า 30 นาที 300 บาท เปิด 06:00–18:00 น. รอบ 10:00 น.'), []);
  assert.deepEqual(check('Horse riding: 30 min for 300 THB'), []);
  assert.deepEqual(check('ขี่ม้า 30 นาที 350 บาท'), ['350 บาท']);
  assert.deepEqual(check('เปิด 07:00 น.'), ['07:00']);
  assert.deepEqual(check('ลด 10%'), ['10%'], 'a "10" inside a timestamp grounds nothing');
  assert.deepEqual(check('ราคารวม 600 บาท'), ['600 บาท'], 'computed totals are not trusted');
  assert.deepEqual(check('งบ 600 บาทได้ครับ', ['งบ 600 บาท']), [], 'the customer’s own figure');
});

for (const channel of ['web', 'line'] as const) {
  test(`${channel}: an invented price from the composer is dropped for the deterministic menu; a real one is kept`, async () => {
    await withHarness(async harness => {
      const question = 'อาหารที่ร้านเผ็ดไหม';
      const read = semantic({ domain: 'restaurant', intent: 'menu_spice', action: 'discover', informationNeed: 'catalog' });
      const invented = await reply(harness, channel, `${channel}-composer-invented`, question,
        [read, { message: 'ผัดไทยไม่เผ็ดครับ ราคา 99 บาท', usedFactKeys: [] }]);
      assert.doesNotMatch(invented, /99 บาท/u);
      assert.match(invented, /• ผัดไทย — 120 บาท/u, 'the live menu instead');
      const real = await reply(harness, channel, `${channel}-composer-real`, question,
        [read, { message: 'ผัดไทยไม่เผ็ดครับ ราคา 120 บาท', usedFactKeys: [] }]);
      assert.match(real, /^ผัดไทยไม่เผ็ดครับ ราคา 120 บาท/u);
    });
  });

  test(`${channel}: an invented price from the legacy brain is replaced; a real one is kept`, async () => {
    await withHarness(async harness => {
      const question = 'ช่วยเล่าเรื่องตลกหน่อย';
      const read = semantic({ domain: 'unknown', intent: 'unknown', action: 'unknown', confidence: 0.3 });
      const invented = await reply(harness, channel, `${channel}-brain-invented`, question,
        [read, { message: 'ขี่ม้าราคาพิเศษวันนี้ 999 บาทนะครับ', intent: 'conversation' }]);
      assert.doesNotMatch(invented, /999/u);
      assert.match(invented, /ยืนยันจากข้อมูลในระบบไม่ได้/u);
      const real = await reply(harness, channel, `${channel}-brain-real`, question,
        [read, { message: 'ขี่ม้า 30 นาที 300 บาทครับ', intent: 'conversation' }]);
      assert.match(real, /^ขี่ม้า 30 นาที 300 บาท/u);
    });
  });
}
