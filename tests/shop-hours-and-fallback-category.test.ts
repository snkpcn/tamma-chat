import test from 'node:test';
import assert from 'node:assert/strict';
import { categorizeDegradedFallback } from '../netlify/functions/thongthai-chat';
import { withHarness } from './helpers/canonical-core-harness';
import { askBothChannels } from './helpers/both-channels';

// "ร้านเปิดกี่โมง" took two model calls, and with the provider down the
// customer was told "ตอนนี้ระบบจองของทองไทยตอบช้ากว่าปกติ" -- every message
// mentioning ร้าน/อาหาร/เมนู/ม้า was put in the booking category.

test('"ร้านเปิดกี่โมง" / "ร้านปิดกี่โมง" answer the regular hours with zero model calls, web and LINE', async () => {
  await withHarness(async harness => {
    for (const text of ['ร้านเปิดกี่โมง', 'ร้านปิดกี่โมง']) {
      for (const answer of await askBothChannels(harness, `hours-${text.length}-${text.charCodeAt(4)}`, text)) {
        assert.match(answer.reply, /^เวลาทำการปกติของทำมา-ชาติคือทุกวัน 06:00–18:00 น\./u, `${answer.channel}: ${text}`);
        assert.equal(answer.modelCalls, 0, `${answer.channel}: ${text}`);
      }
    }
  });
});

test('a failed shop question gets the information fallback, never "ระบบจอง", web and LINE', async () => {
  await withHarness(async harness => {
    // The harness model answers 503: the provider is down.
    for (const answer of await askBothChannels(harness, 'shop-wifi', 'ร้านมีวายฟายไหม')) {
      assert.match(answer.reply, /ดึงข้อมูลมาตอบคำถามนี้ไม่ทัน/u, answer.channel);
      assert.doesNotMatch(answer.reply, /ระบบจอง/u, answer.channel);
    }
  });
});

test('only a transaction is a booking fallback', () => {
  for (const text of ['ร้านเปิดกี่โมง', 'ร้านมีวายฟายไหม', 'เมนูมีอะไรบ้าง', 'ขี่ม้าเหมาะกับเด็กไหม']) {
    assert.equal(categorizeDegradedFallback(text), 'information', text);
  }
  for (const text of ['อยากจองขี่ม้าพรุ่งนี้', 'ขอยกเลิกการจอง', 'สั่งผัดไทย 2 จาน', 'I want to book a room']) {
    assert.equal(categorizeDegradedFallback(text), 'booking', text);
  }
  assert.equal(categorizeDegradedFallback('สวัสดีจ้า เล่าเรื่องตลกหน่อย'), 'casual');
});
