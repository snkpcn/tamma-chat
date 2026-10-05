import test from 'node:test';
import assert from 'node:assert/strict';
import { boundedWorldwideReadBeforePrimary } from '../netlify/functions/thongthai-chat';
import { withHarness } from './helpers/canonical-core-harness';

test('worldwide horse-price fast path uses the live catalog in five languages', async () => {
  await withHarness(async () => {
    const cases = [
      ['th', 'ขี่ม้า 30 นาทีราคาเท่าไหร่ครับ', /300/u],
      ['en', 'How much is a 30-minute horse ride?', /THB 300/u],
      ['zh', '骑马30分钟多少钱？', /300 泰铢/u],
      ['lo', 'ຂີ່ມ້າ 30 ນາທີ ລາຄາເທົ່າໃດ?', /300 ບາດ/u],
      ['vi', 'Cưỡi ngựa 30 phút giá bao nhiêu?', /300 baht/u],
    ] as const;
    for (const [language, message, expected] of cases) {
      const response = await boundedWorldwideReadBeforePrimary({ language, message } as never);
      assert.ok(response, `${language} should use the bounded path`);
      assert.match(response!.message, expected);
    }
  });
});

test('room availability without dates asks one bounded question and claims no availability', async () => {
  const cases = [
    ['th', 'มีห้องว่างไหมครับ', /วันเช็กอิน/u],
    ['en', 'Do you have a room available?', /date/iu],
    ['zh', '有空房吗？', /入住日期/u],
    ['lo', 'ມີຫ້ອງວ່າງບໍ?', /ວັນທີ/u],
    ['vi', 'Còn phòng trống không?', /ngày/iu],
  ] as const;
  for (const [language, message, expected] of cases) {
    const response = await boundedWorldwideReadBeforePrimary({ language, message } as never);
    assert.ok(response, `${language} should ask for dates deterministically`);
    assert.match(response!.message, expected);
    assert.doesNotMatch(response!.message, /(?:ว่างแน่นอน|available now|有空房。|đang còn phòng)/iu);
  }
});

test('fast path yields for dated availability and unrelated/transactional turns', async () => {
  assert.equal(await boundedWorldwideReadBeforePrimary({ language:'en', message:'Is a room available tomorrow?' } as never), null);
  assert.equal(await boundedWorldwideReadBeforePrimary({ language:'th', message:'จองขี่ม้า 30 นาทีให้เลย' } as never), null);
  assert.equal(await boundedWorldwideReadBeforePrimary({ language:'th', message:'ร้านอาหารเปิดกี่โมง' } as never), null);
});
