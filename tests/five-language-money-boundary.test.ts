import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyEscalationBoundary } from '../netlify/functions/_boundary-classifier';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';
import { brainRequest, guestId, withHarness } from './helpers/canonical-core-harness';
import { deliverLineTexts } from './helpers/line-channel';

// A request for a discount or a refund is the owner's call, in every
// language the site offers. Before, Chinese, Lao and Vietnamese requests
// were not recognised: they went to the model.

const REQUESTS: Array<[string, 'special_discount' | 'refund_request', RegExp]> = [
  ['可以给我打折吗？', 'special_discount', /^特别折扣需要负责人或价格团队先核对条件/u],
  ['我可以退款吗？', 'refund_request', /^退款或付款条件需要由负责人确认/u],
  ['ຫຼຸດລາຄາໃຫ້ແດ່ໄດ້ບໍ່?', 'special_discount', /^ສ່ວນຫຼຸດພິເສດຕ້ອງໃຫ້ເຈົ້າຂອງ/u],
  ['ຂໍເງິນຄືນໄດ້ບໍ່?', 'refund_request', /^ເລື່ອງຄືນເງິນ/u],
  ['Có thể giảm giá cho tôi không?', 'special_discount', /^Giảm giá đặc biệt cần chủ sở hữu/u],
  ['Tôi có thể được hoàn tiền không?', 'refund_request', /^Việc hoàn tiền hoặc điều kiện thanh toán/u],
];

test('discount and refund requests in zh/lo/vi are classified; near misses in each language are not', () => {
  for (const [text, category] of REQUESTS) assert.equal(classifyEscalationBoundary(text)?.category, category, text);
  for (const text of ['能便宜一点吗', 'Bớt cho tôi chút được không']) assert.equal(classifyEscalationBoundary(text)?.category, 'special_discount', text);
  for (const text of ['有优惠吗？', '有什么折扣活动吗', '少糖', '有便宜一点的吗', 'ມີສ່ວນຫຼຸດບໍ່', 'ມີໂປຣບໍ່', 'ຫວານໜ້ອຍ',
    'Có khuyến mãi không?', 'Có giảm giá không?', 'Ít đường nhé', 'Có món nào rẻ hơn không']) {
    assert.equal(classifyEscalationBoundary(text), null, text);
  }
});

test('each request is answered as an owner matter in the customer\'s language, zero model calls, web and LINE', async () => {
  await withHarness(async harness => {
    for (const [index, [text, , expected]] of REQUESTS.entries()) {
      let before = harness.modelCallCount();
      const web = await processThongthaiChatCore(brainRequest(text, guestId(`money5-${index}`), 'web'), `money5-${index}`);
      assert.match(String((web.payload as { message?: unknown }).message), expected, `web: ${text}`);
      assert.equal(harness.modelCallCount() - before, 0, `web: ${text}`);
      before = harness.modelCallCount();
      const line = await deliverLineTexts(harness, { userId: `U-money5-${index}`, texts: [text] });
      assert.match(line.replies[0]?.texts.join('\n') ?? '', expected, `line: ${text}`);
      assert.equal(harness.modelCallCount() - before, 0, `line: ${text}`);
    }
  });
});
