import test from 'node:test';
import assert from 'node:assert/strict';
import { withHarness } from './helpers/canonical-core-harness';
import { askBothChannels } from './helpers/both-channels';

// "ร้านอาหารเปิดกี่โมง" was answered with the menu after two model calls;
// "คาเฟ่เปิดกี่โมง" said the café's hours could not be confirmed although
// "อินทนิลเปิดกี่โมง" answered them from the same configured source.

const CAFE_TH = /^เวลาทำการปกติของอินทนิล สาขาตาดโตนคือทุกวัน 06:00–18:00 น\./u;
const RESTAURANT_TH = /^ตอนนี้ระบบยังไม่มีเวลาเปิด–ปิดแยกของร้านอาหารตำมา-ชาติครับ ทองไทยไม่ขอเดา/u;

const cases: Array<[string, RegExp]> = [
  ['คาเฟ่เปิดกี่โมง', CAFE_TH],
  ['ร้านกาแฟปิดกี่โมง', CAFE_TH],
  ['ร้านอาหารเปิดกี่โมง', RESTAURANT_TH],
  ['ตำมาชาติเปิดกี่โมง', RESTAURANT_TH],
  ['What time does the cafe open?', /^The café \(อินทนิล สาขาตาดโตน\) is open 06:00–18:00 every day\./u],
  ['When does the restaurant open?', /^I don’t have separate opening hours for the restaurant \(ตำมา-ชาติ\) on record, so I won’t guess\./u],
];

for (const [text, expected] of cases) {
  test(`"${text}": that unit's hours, or an honest "not on record" -- never the menu, zero model calls, web and LINE`, async () => {
    await withHarness(async harness => {
      for (const answer of await askBothChannels(harness, `unit-hours-${cases.findIndex(row => row[0] === text)}`, text)) {
        assert.match(answer.reply, expected, `${answer.channel}: ${answer.reply}`);
        assert.doesNotMatch(answer.reply, /• ผัดไทย|เมนูที่/u, answer.channel);
        assert.equal(answer.modelCalls, 0, answer.channel);
      }
    });
  });
}

test('neighbouring questions keep their path: the whole place, café parking', async () => {
  await withHarness(async harness => {
    for (const answer of await askBothChannels(harness, 'unit-hours-venue', 'ร้านเปิดกี่โมง')) {
      assert.match(answer.reply, /^เวลาทำการปกติของทำมา-ชาติคือทุกวัน 06:00–18:00 น\./u, answer.channel);
    }
    for (const answer of await askBothChannels(harness, 'unit-hours-parking', 'คาเฟ่มีที่จอดรถไหม')) {
      assert.match(answer.reply, /ที่จอดรถ/u, answer.channel);
      assert.doesNotMatch(answer.reply, /06:00/u, answer.channel);
    }
  });
});
