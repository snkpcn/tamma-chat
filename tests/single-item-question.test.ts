import test from 'node:test';
import assert from 'node:assert/strict';
import { readItemQuestion } from '../netlify/functions/_single-item-question';
import { defaultCatalog, withHarness } from './helpers/canonical-core-harness';
import { askBothChannels, failReads } from './helpers/both-channels';

// "ผัดไทยมีไหม", "น้ำผึ้งป่าเหลือไหม", "Do you have pad thai?" took two model
// calls each. Now one named live item is answered from the menu and the
// product list, with the same states as the lists: in stock, sold out, no
// stock figure, failed read.

const base = defaultCatalog();
const tomSaep = (id: string, name: string, extra: Record<string, unknown>) => ({
  ...base.restaurantMenu[0]!, menu_item_id: id, name, selling_price: 179, is_signature: false, ...extra,
});
const menu = [
  ...base.restaurantMenu,
  tomSaep('menu-tomsaep-chicken', 'ต้มแซ่บไก่บ้าน', { available_servings: 8 }),
  tomSaep('menu-tomsaep-beef', 'ต้มแซ่บเนื้อ', { available_servings: 0 }),
];

test('the shape: one item name plus "is there / any left"; topics, facilities and other questions are not items', () => {
  for (const [text, stem] of [['ผัดไทยมีไหม', 'ผัดไทย'], ['มีผัดไทยไหมครับ', 'ผัดไทย'], ['น้ำผึ้งป่าเหลือไหม', 'น้ำผึ้งป่า'],
    ['ต้มแซ่บหมดยัง', 'ต้มแซ่บ'], ['Do you have pad thai?', 'ผัดไทย'], ['Is there any honey left?', 'น้ำผึ้ง']] as const) {
    assert.equal(readItemQuestion(text)?.stem, stem, text);
  }
  for (const text of ['มีอะไรให้ทำบ้าง', 'ห้องว่างไหม', 'มีที่จอดรถไหม', 'มีโปรไหม', 'ขี่ม้าว่างไหม', 'มีเมนูอะไรบ้าง',
    'ผัดไทยราคาเท่าไหร่', 'สั่งผัดไทย 2 จาน', 'Do you have rooms?', 'Do you have a discount?']) {
    assert.equal(readItemQuestion(text), null, text);
  }
});

const answers: Array<[string, RegExp]> = [
  ['ผัดไทยมีไหม', /^ผัดไทย มี 120 บาท พร้อมสั่งครับ$/u],
  ['ต้มแซ่บมีไหม', /ที่ตรงกับที่ถามมีดังนี้ครับ\n+• ต้มแซ่บไก่บ้าน มี 179 บาท พร้อมสั่ง\n• ต้มแซ่บเนื้อ ตอนนี้หมดแล้ว/u],
  ['น้ำผึ้งป่าเหลือไหม', /^น้ำผึ้งป่า มี เหลือ 30 ชิ้น ราคา 250 บาทครับ$/u],
  ['Do you have pad thai?', /^ผัดไทย is available, 120 THB\.$/u],
];
for (const [text, expected] of answers) {
  test(`"${text}" is answered from live data with zero model calls, web and LINE`, async () => {
    await withHarness(async harness => {
      for (const answer of await askBothChannels(harness, `item-${answers.findIndex(row => row[0] === text)}`, text)) {
        assert.match(answer.reply, expected, `${answer.channel}: ${answer.reply}`);
        assert.equal(answer.modelCalls, 0, answer.channel);
      }
    }, { restaurantMenu: menu });
  });
}

test('sold out, no stock figure and a failed read each say so, web and LINE', async () => {
  await withHarness(async harness => {
    for (const answer of await askBothChannels(harness, 'item-soldout', 'น้ำผึ้งป่าเหลือไหม')) {
      assert.match(answer.reply, /^น้ำผึ้งป่า ตอนนี้หมดแล้วครับ$/u, answer.channel);
    }
  }, { otopProducts: base.otopProducts.map(row => ({ ...row, stock_qty: 0 })) });
  await withHarness(async harness => {
    for (const answer of await askBothChannels(harness, 'item-nodata', 'ผัดไทยมีไหม')) {
      assert.match(answer.reply, /มีในเมนู แต่ยังไม่มีข้อมูลสต๊อกล่าสุด ยืนยันไม่ได้ว่าพร้อมสั่งตอนนี้/u, answer.channel);
      assert.equal(answer.modelCalls, 0, answer.channel);
    }
  }, { restaurantMenu: base.restaurantMenu.map(row => ({ ...row, available_servings: null })) });
  await withHarness(async harness => {
    failReads(harness, 'restaurant_menu_live');
    failReads(harness, 'otop_products');
    for (const answer of await askBothChannels(harness, 'item-fail', 'ผัดไทยมีไหม')) {
      assert.match(answer.reply, /ตรวจสอบรายการเมนูและของฝากล่าสุดไม่สำเร็จ.*ยืนยันไม่ได้ว่ามีผัดไทยไหม/u, answer.channel);
      assert.equal(answer.modelCalls, 0, answer.channel);
    }
  });
});

test('a name no live item carries is not claimed: other questions keep their path', async () => {
  await withHarness(async harness => {
    for (const text of ['ห้องว่างไหม', 'มีอะไรให้ทำบ้าง', 'ลาเต้มีไหม']) {
      for (const answer of await askBothChannels(harness, `item-other-${text.length}`, text)) {
        assert.doesNotMatch(answer.reply, /พร้อมสั่ง|ตอนนี้หมดแล้ว|ตรวจสอบรายการเมนูและของฝาก/u, `${answer.channel}: ${text}`);
      }
    }
  });
});
