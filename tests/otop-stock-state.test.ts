import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultCatalog, withHarness } from './helpers/canonical-core-harness';
import { askBothChannels, failReads } from './helpers/both-channels';

// The live souvenir query returns only rows with stock_qty > 0 (the harness
// models that filter). An empty result is a successful read, not a failed
// one: before, both said "ยังอ่านรายการของฝากปัจจุบันไม่ได้".
const products = defaultCatalog().otopProducts;
const QUESTION = 'มีของฝากอะไรบ้าง';
const NOT_CONFIRMED = /ยังไม่มีของฝากที่ระบบยืนยันว่ามีสต๊อกพร้อมขาย/u;
const READ_FAILED = /ยังอ่านรายการของฝากปัจจุบันไม่ได้/u;

for (const [name, catalog] of [
  ['sold out', { otopProducts: products.map(row => ({ ...row, stock_qty: 0 })) }],
  ['no stock figure', { otopProducts: products.map(row => ({ ...row, stock_qty: null })) }],
] as const) {
  test(`souvenirs, ${name}: "not confirmed in stock", never "could not read" -- web and LINE`, async () => {
    await withHarness(async harness => {
      for (const answer of await askBothChannels(harness, `otop-${name.replace(/\s+/gu, '-')}`, QUESTION)) {
        assert.match(answer.reply, NOT_CONFIRMED, answer.channel);
        assert.doesNotMatch(answer.reply, READ_FAILED, answer.channel);
        assert.equal(answer.modelCalls, 0, answer.channel);
      }
    }, catalog);
  });
}

test('souvenirs, read failure: "could not read" -- web and LINE', async () => {
  await withHarness(async harness => {
    failReads(harness, 'otop_products');
    for (const answer of await askBothChannels(harness, 'otop-read-failure', QUESTION)) {
      assert.match(answer.reply, READ_FAILED, answer.channel);
      assert.equal(answer.modelCalls, 0, answer.channel);
    }
  });
});

test('souvenirs in stock are still listed with their live price', async () => {
  await withHarness(async harness => {
    for (const answer of await askBothChannels(harness, 'otop-in-stock', QUESTION)) {
      assert.match(answer.reply, /• น้ำผึ้งป่า — 250 บาท/u, answer.channel);
    }
  });
});
