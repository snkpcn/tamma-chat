import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultCatalog, withHarness } from './helpers/canonical-core-harness';
import { askBothChannels, failReads } from './helpers/both-channels';

// "Nothing to recommend" has three causes and the customer must hear the
// right one. Before, a menu with no stock figure (available_servings null)
// was read as 0 and answered exactly like a sold-out menu.
const menu = defaultCatalog().restaurantMenu;
const soldOut = menu.map(item => ({ ...item, available_servings: 0 }));
const noStockData = menu.map(item => ({ ...item, available_servings: null }));

const cases: Array<{ name: string; catalog?: Record<string, unknown>; fail?: boolean; th: RegExp; en: RegExp }> = [
  { name: 'sold out', catalog: { restaurantMenu: soldOut }, th: /^ตอนนี้เมนูที่ถามหมดทุกรายการครับ/u, en: /^Everything you asked about is sold out right now\./u },
  { name: 'no stock figure', catalog: { restaurantMenu: noStockData }, th: /ยังไม่มีข้อมูลสต๊อกล่าสุดของเมนู ทองไทยจึงยืนยันไม่ได้/u, en: /I don’t have current stock data for the menu/u },
  { name: 'read failure', fail: true, th: /ตรวจสอบข้อมูลเมนูและราคาล่าสุดไม่สำเร็จ/u, en: /I couldn’t read the latest menu and prices/u },
];

for (const scenario of cases) {
  test(`menu question, ${scenario.name}: the right cause, Thai and English, web and LINE, zero model calls`, async () => {
    await withHarness(async harness => {
      if (scenario.fail) failReads(harness, 'restaurant_menu_live');
      const seed = scenario.name.replace(/\s+/gu, '-');
      for (const [text, expected] of [['มีเมนูอะไรแนะนำบ้าง', scenario.th], ["What's on the menu?", scenario.en]] as const) {
        for (const answer of await askBothChannels(harness, `${seed}-${text.length}`, text)) {
          assert.match(answer.reply, expected, `${answer.channel}: ${text}`);
          assert.equal(answer.modelCalls, 0, `${answer.channel}: ${text}`);
        }
      }
    }, scenario.catalog ?? {});
  });
}

test('the three causes never share a sentence', async () => {
  const replies: string[] = [];
  for (const scenario of cases) {
    await withHarness(async harness => {
      if (scenario.fail) failReads(harness, 'restaurant_menu_live');
      const [web] = await askBothChannels(harness, `distinct-${replies.length}`, 'มีเมนูอะไรแนะนำบ้าง');
      replies.push(web!.reply);
    }, scenario.catalog ?? {});
  }
  assert.equal(new Set(replies).size, 3, replies.join(' | '));
});
