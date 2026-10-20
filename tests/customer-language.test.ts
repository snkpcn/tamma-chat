import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCustomerLanguage } from '../netlify/functions/_customer-language';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';
import { withHarness, brainRequest, guestId } from './helpers/canonical-core-harness';
import { deliverLineTexts } from './helpers/line-channel';

const message = (payload: unknown) => String((payload as { message?: unknown }).message ?? '');

test('the latest message decides the language; a tie keeps the fallback', () => {
  const cases: Array<[string, 'th' | 'en', string]> = [
    ['Hi', 'th', 'en'],
    ['all of them', 'th', 'en'],
    ['Can you give me a discount?', 'th', 'en'],
    ['ทั้งหมดเลยครับ', 'en', 'th'],
    ['ขี่ม้าราคาเท่าไหร่ ok', 'en', 'th'],
    // Acronyms are names, not language: "มี ATV ไหม how much" is 2 Thai words
    // against 2 English words, so the caller's fallback decides.
    ['มี ATV ไหม how much', 'th', 'th'],
    ['มี ATV ไหม how much', 'en', 'en'],
    // No words at all: the message says nothing about language.
    ['555', 'en', 'en'],
    ['😊', 'th', 'th'],
    // A URL is not English.
    ['www.facebook.com ราคา', 'en', 'th'],
    // Other scripts are recognised as before.
    ['你好', 'th', 'zh'],
    ['ສະບາຍດີ', 'th', 'lo'],
  ];
  for (const [text, fallback, expected] of cases) {
    assert.equal(resolveCustomerLanguage(text, fallback), expected, `${text} (fallback ${fallback})`);
  }
});

test('web: a customer on a Thai page who types English is answered in English, and the reverse', async () => {
  await withHarness(async () => {
    // brainRequest sends language 'th', exactly like index.html on a Thai page.
    const hi = await processThongthaiChatCore(brainRequest('Hi', guestId('lang-web-hi'), 'web'), 'lang-web-hi');
    assert.match(message(hi.payload), /^Hi, I'm Thongthai/u);

    const refund = await processThongthaiChatCore(brainRequest('Can I get a refund?', guestId('lang-web-refund'), 'web'), 'lang-web-refund');
    assert.match(message(refund.payload), /For refunds or payment terms/u);
    assert.doesNotMatch(message(refund.payload), /[฀-๿]/u, 'no Thai in an English answer');

    // A Thai message on an English page is answered in Thai.
    const thaiOnEnglishPage = await processThongthaiChatCore(
      { ...brainRequest('สวัสดีครับ', guestId('lang-web-th'), 'web'), language: 'en' },
      'lang-web-th',
    );
    assert.match(message(thaiOnEnglishPage.payload), /สวัสดีครับ ผมทองไทย/u);
  });
});

test('LINE: the reply language follows the message, through the real webhook', async () => {
  await withHarness(async harness => {
    const result = await deliverLineTexts(harness, {
      userId: 'U-lang-line',
      // The last one is an English sentence with one Thai activity name. LINE
      // used to call any Thai character Thai and answered it in Thai.
      texts: ['Hi', 'สวัสดีครับ', 'Can I get a refund?', 'Can I get a refund for the ขี่ม้า booking?'],
    });
    assert.equal(result.status, 200);
    const [hi, sawasdee, refund, mixedRefund] = result.replies.map(reply => reply?.texts.join('\n') ?? '');
    assert.match(hi, /^Hi, I'm Thongthai/u);
    assert.match(sawasdee, /สวัสดีครับ ผมทองไทย/u);
    assert.match(refund, /For refunds or payment terms/u);
    assert.match(mixedRefund, /For refunds or payment terms/u);
  });
});
