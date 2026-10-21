import test from 'node:test';
import assert from 'node:assert/strict';
import { detectMessageLanguage } from '../netlify/functions/_customer-language';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';
import { brainRequest, guestId, withHarness, type Harness } from './helpers/canonical-core-harness';
import { deliverLineTexts } from './helpers/line-channel';

// The site offers five languages (index.html I18N: th, en, zh, lo, vi). A
// customer writing in any of them gets the basic answers from live data,
// in that language, with zero model calls. Before, every Chinese, Lao and
// Vietnamese message took two model calls and ended in an English fallback.

const horse = { id: 'res-horse', code: 'activity-horse', service_type: 'activity', name: 'ขี่ม้า', active: true, metadata: {} };
const tomorrow10 = (() => { const at = new Date(Date.now() + 24 * 3_600_000); at.setUTCHours(3, 0, 0, 0); return at; })();
const round = {
  id: 'round-1', resource_id: horse.id, start_at: tomorrow10.toISOString(), end_at: new Date(tomorrow10.getTime() + 30 * 60_000).toISOString(),
  capacity_total: 4, capacity_reserved: 1, status: 'open', environment: 'live', metadata: {},
};

type Case = [question: string, expected: RegExp];
const CASES: Record<'zh' | 'lo' | 'vi', Case[]> = {
  zh: [
    ['你好', /^您好，我是 Thongthai/u],
    ['你们有什么活动？', /^这里是 Thammachat 提供的内容[\s\S]*活动 — ขี่ม้า/u],
    ['骑马多少钱？', /^ขี่ม้า：30 分钟 300 泰铢，或 45 分钟 500 泰铢/u],
    ['菜单有什么？', /^🍽️ 现在值得一试的菜[\s\S]*• ผัดไทย — 120 泰铢/u],
    ['几点开门？', /^我们的正常营业时间是每天 06:00–18:00/u],
    ['餐厅几点开门？', /^系统里没有餐厅（ตำมา-ชาติ）单独的营业时间/u],
    ['可以给我打折吗？', /^特别折扣需要负责人或价格团队先核对条件/u],
    ['我可以退款吗？', /^退款或付款条件需要由负责人确认/u],
    ['有泰式炒河粉吗？', /^ผัดไทย有，120 泰铢/u],
    ['明天骑马30分钟有空位吗？', /^ขี่ม้า 30 分钟，明天（\d{1,2}月\d{1,2}日 周.）：还有空位的时段 10:00（剩 3 位）/u],
  ],
  lo: [
    ['ສະບາຍດີ', /^ສະບາຍດີ ຂ້ອຍແມ່ນທອງໄທ/u],
    ['ມີກິດຈະກຳຫຍັງແດ່?', /^ນີ້ແມ່ນສິ່ງທີ່ Thammachat ມີ[\s\S]*ກິດຈະກຳ — ขี่ม้า/u],
    ['ຂີ່ມ້າລາຄາເທົ່າໃດ?', /^ขี่ม้า: 30 ນາທີ 300 ບາດ ຫຼື 45 ນາທີ 500 ບາດ/u],
    ['ມີເມນູຫຍັງແດ່?', /^🍽️ ເມນູທີ່ໜ້າລອງຕອນນີ້[\s\S]*• ผัดไทย — 120 ບາດ/u],
    ['ເປີດຈັກໂມງ?', /^ເວລາເປີດປົກກະຕິແມ່ນທຸກມື້ 06:00–18:00/u],
    ['ຫຼຸດລາຄາໃຫ້ແດ່ໄດ້ບໍ່?', /^ສ່ວນຫຼຸດພິເສດຕ້ອງໃຫ້ເຈົ້າຂອງ/u],
    ['ຂໍເງິນຄືນໄດ້ບໍ່?', /^ເລື່ອງຄືນເງິນ/u],
    ['ມີຜັດໄທບໍ່?', /^ผัดไทย ມີ 120 ບາດ ພ້ອມສັ່ງ/u],
    ['ມື້ອື່ນຂີ່ມ້າ 30 ນາທີຫວ່າງບໍ່?', /^ขี่ม้า 30 ນາທີ ມື້ອື່ນ \(\S+ \d{1,2} \S+\): ຍັງຫວ່າງຮອບ 10:00 \(ຫວ່າງ 3\)/u],
  ],
  vi: [
    ['Xin chào', /^Xin chào, tôi là Thongthai/u],
    ['Có những hoạt động gì?', /^Đây là những gì Thammachat có[\s\S]*Hoạt động — ขี่ม้า/u],
    ['Cưỡi ngựa giá bao nhiêu?', /^ขี่ม้า: 30 phút giá 300 baht hoặc 45 phút giá 500 baht/u],
    ['Thực đơn có gì?', /^🍽️ Các món nên thử lúc này[\s\S]*• ผัดไทย — 120 baht/u],
    ['Mấy giờ mở cửa?', /^Giờ mở cửa thường lệ là 06:00–18:00 mỗi ngày/u],
    ['Có thể giảm giá cho tôi không?', /^Giảm giá đặc biệt cần chủ sở hữu/u],
    ['Tôi có thể được hoàn tiền không?', /^Việc hoàn tiền hoặc điều kiện thanh toán/u],
    ['Có pad thai không?', /^ผัดไทย đang có, 120 baht/u],
    ['Ngày mai cưỡi ngựa 30 phút còn chỗ không?', /^ขี่ม้า, 30 phút, ngày mai \(Thứ \S+ \d{1,2}\/\d{1,2}\): còn trống lúc 10:00 \(còn 3\)/u],
  ],
};

async function ask(harness: Harness, channel: 'web' | 'line', language: string, index: number, text: string) {
  const before = harness.modelCallCount();
  const reply = channel === 'web'
    ? String(((await processThongthaiChatCore({ ...brainRequest(text, guestId(`five-${language}-${index}`), 'web'), language: language as never }, `five-${language}-${index}`)).payload as { message?: unknown }).message ?? '')
    : (await deliverLineTexts(harness, { userId: `U-five-${language}-${index}`, texts: [text] })).replies[0]?.texts.join('\n') ?? '';
  return { reply, modelCalls: harness.modelCallCount() - before };
}

for (const language of ['zh', 'lo', 'vi'] as const) {
  for (const channel of ['web', 'line'] as const) {
    test(`${language} on ${channel}: every basic question answered from live data, in ${language}, with zero model calls`, async () => {
      await withHarness(async harness => {
        for (const [index, [text, expected]] of CASES[language].entries()) {
          const answer = await ask(harness, channel, language, index, text);
          assert.match(answer.reply, expected, `${text} -> ${answer.reply}`);
          assert.equal(answer.modelCalls, 0, text);
        }
      }, { serviceResources: [horse], serviceSchedules: [round] });
    });
  }
}

test('the message shows its language, or says nothing (then the web keeps its UI language)', () => {
  for (const [text, language] of [['Xin chào', 'vi'], ['Cảm ơn', 'vi'], ['你好', 'zh'], ['ສະບາຍດີ', 'lo'], ['สวัสดี', 'th'], ['Hi', 'en'], ['Café latte please', 'en']] as const) {
    assert.equal(detectMessageLanguage(text), language, text);
  }
  for (const text of ['2', '555', '👍', 'ATV']) assert.equal(detectMessageLanguage(text), null, text);
});

test('LINE: a message that does not show its language keeps the language of the customer\'s previous message', async () => {
  await withHarness(async harness => {
    // Recorded in the conversation context, then a bare "30 นาที"-style
    // answer with no words: "30" alone.
    await deliverLineTexts(harness, { userId: 'U-five-previous', texts: ['明天骑马有空位吗？'] });
    const followUp = await deliverLineTexts(harness, { userId: 'U-five-previous', texts: ['30'] });
    const reply = followUp.replies[0]?.texts.join('\n') ?? '';
    assert.doesNotMatch(reply, /[A-Za-z]{4,} [A-Za-z]{4,}/u, `not English: ${reply}`);
    assert.match(reply, /[㐀-鿿]/u, `Chinese, as the previous message: ${reply}`);
  }, { serviceResources: [horse], serviceSchedules: [round] });
});
