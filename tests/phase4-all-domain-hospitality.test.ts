import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withHarness, guestId, brainRequest } from './helpers/canonical-core-harness';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';

function messageOf(result: { payload: Record<string, unknown> }): string {
  return String(result.payload.message ?? '');
}

async function ask(seed: string, message: string) {
  return processThongthaiChatCore(brainRequest(message, guestId(seed), 'web'), `phase4-${seed}`);
}

const GENERIC_FAILURE = /ทองไทยคิดช้า|เชื่อมต่อไม่ได้|ไม่มีข้อมูลยืนยันได้สำหรับเรื่องนี้|ลองถามใหม่/u;

test('Phase 4: bare recommendation is a deterministic 3-path host opener, not an LLM fallback', async () => {
  await withHarness(async harness => {
    const result = await ask('bare-recommend', 'มีอะไรแนะนำ');
    assert.equal(result.statusCode, 200);
    const text = messageOf(result);
    assert.match(text, /สายชิล/u);
    assert.match(text, /สายกิจกรรม/u);
    assert.match(text, /สายพัก/u);
    assert.match(text, /มากี่คน/u);
    assert.equal(harness.modelCallCount(), 1, 'host opener must be language-supervised once, then answered by the deterministic host path');
  });
});

test('Phase 4: cafe stays helpful but never invents menu, price or hours without a verified production source', async () => {
  await withHarness(async harness => {
    const result = await ask('cafe-price', 'ลาเต้ราคาเท่าไหร่');
    assert.equal(result.statusCode, 200);
    const text = messageOf(result);
    assert.match(text, /ไม่มีข้อมูล.*ยืนยัน|ไม่ขอเดา/u);
    assert.match(text, /คาเฟ่|ร้านอาหาร|ที่พัก/u, 'must still offer a useful next step inside the ecosystem');
    assert.doesNotMatch(text, /65\s*บาท|07:00|18:00/u);
    assert.equal(harness.modelCallCount(), 1, 'known information boundary must still be language-supervised once before grounded handling');
  });
});

test('Phase 4: all-domain hospitality gate stays helpful and non-generic', async () => {
  await withHarness(async harness => {
    harness.programWeatherFetch({
      ok:true,
      body:{
        weather:[{ description:'เมฆบางส่วน' }],
        main:{ temp:30, feels_like:33, humidity:70 },
        wind:{ speed:2 },
        rain:{},
      },
    });
    const cases: Array<[string,string,RegExp]> = [
      ['restaurant','ร้านอาหารมีอะไรแนะนำ',/เมนู|กิน|อาหาร/u],
      ['cafe','มีลาเต้ไหม',/ลาเต้|คาเฟ่|กาแฟ/u],
      ['horse','อยากขี่ม้า',/ขี่ม้า|เคยขี่|ฟีล/u],
      ['atv','อยากเล่น ATV',/ATV|เอทีวี/u],
      ['archery','อยากยิงธนู ไม่เคยยิง',/ธนู|สอน|จับธนู/u],
      ['homestay','อยากพัก พาแม่มา',/พัก|เฮือนสเตย์|กี่คน|กี่คืน/u],
      ['location','ทำมา-ชาติอยู่ที่ไหน',/ปักหมุด|maps\.app\.goo\.gl/u],
      ['weather','วันนี้ฝนตกไหม',/อากาศ|ฝน|เมฆ|30/u],
      ['safety','พื้นลื่นมาก ตอนเล่น ATV น่ากลัว',/กิจกรรม|ตรวจสอบ|บันทึก|ปลอดภัย/u],
      ['complaint','บริการแย่มาก',/ขอโทษ|รับเรื่อง|รายละเอียด/u],
      ['compliment','พี่เจิดดูแลดีมาก',/ขอบคุณ|เจิด|ดี/u],
      ['refund','ขอคืนเงินได้ไหม',/คืนเงิน|เจ้าของ|ตรวจสอบ/u],
      ['booking','อยากจองขี่ม้าพรุ่งนี้',/จอง|ขี่ม้า|เวลา|ระยะเวลา/u],
    ];
    for (const [name, input, relevant] of cases) {
      const result = await ask(`matrix-${name}`, input);
      assert.equal(result.statusCode, 200, name);
      const text = messageOf(result);
      assert.doesNotMatch(text, GENERIC_FAILURE, `${name}: ${text}`);
      assert.match(text, relevant, `${name}: ${text}`);
    }
  });
});
