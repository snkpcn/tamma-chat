import test from 'node:test';
import assert from 'node:assert/strict';
import { providerUnavailableMessage, turnUnfinishedMessage, duplicateDeliveryMessage, retryLabel } from '../netlify/functions/_customer-fallback';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';
import { brainRequest, guestId, withHarness } from './helpers/canonical-core-harness';
import { deliverLineTexts } from './helpers/line-channel';

// Every fallback cause has Chinese, Lao and Vietnamese wording. Before, a
// Chinese/Lao/Vietnamese customer whose turn fell back got English.

test('fallback wording exists in zh, lo and vi for every cause', () => {
  for (const language of ['zh', 'lo', 'vi'] as const) {
    for (const category of ['weather', 'booking', 'information', 'feedback', 'casual'] as const) {
      assert.notEqual(providerUnavailableMessage(category, language), providerUnavailableMessage(category, 'en'), `${language} ${category}`);
    }
    assert.doesNotMatch(turnUnfinishedMessage(language, true, 'line'), /^I received/u, language);
    assert.doesNotMatch(duplicateDeliveryMessage(language), /^This message/u, language);
    assert.notEqual(retryLabel(language), 'Try again', language);
  }
});

test('with the provider down, a Chinese / Lao / Vietnamese chat message falls back in that language, web and LINE', async () => {
  await withHarness(async harness => {
    // Not a basic question: it reaches the model, which (harness) answers 503.
    for (const [language, text, expected] of [
      ['zh', '给我讲个故事吧', /^我在这里/u],
      ['lo', 'ເລົ່ານິທານໃຫ້ຟັງແດ່', /^ທອງໄທຢູ່ນີ້/u],
      ['vi', 'Kể cho tôi một câu chuyện đi', /^Tôi vẫn ở đây/u],
    ] as const) {
      const web = await processThongthaiChatCore({ ...brainRequest(text, guestId(`fb5-${language}`), 'web'), language }, `fb5-${language}`);
      assert.match(String((web.payload as { message?: unknown }).message), expected, `web ${language}`);
      const line = await deliverLineTexts(harness, { userId: `U-fb5-${language}`, texts: [text] });
      assert.match(line.replies[0]?.texts.join('\n') ?? '', expected, `line ${language}`);
    }
  });
});
