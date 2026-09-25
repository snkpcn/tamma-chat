import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withHarness, guestId, brainRequest } from './helpers/canonical-core-harness';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';
import { buildRealKnowledgeSourceAdapters } from '../netlify/functions/_dialog-source-adapters';
import { resolveKnowledge } from '../netlify/functions/_knowledge-resolver';

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
    assert.equal(harness.modelCallCount(), 0, 'host opener must be deterministic and never require the model');
  });
});

test('Phase 4: real cafe adapter reads verified cafe world facts and resolves cafe price', async () => {
  await withHarness(async () => {
    const adapters = buildRealKnowledgeSourceAdapters('web', { environment:'test' });
    assert.ok(adapters.cafe?.facts, 'production adapter set must expose a cafe facts source');

    const bundle = await resolveKnowledge({
      domain:'cafe',
      intent:'price',
      action:'read',
      entities:{},
      constraints:[],
      task:null,
      needs:['price'],
    }, adapters);

    assert.equal(bundle.sources[0]?.sourceType, 'cafe_live');
    assert.equal(bundle.sources[0]?.status, 'ok');
    assert.ok(bundle.facts.some(f => f.key === 'cafe_latte_price' && f.value === 65));
  });
});

test('Phase 4: canonical cafe question answers verified fact instead of the old cannot-confirm gap', async () => {
  await withHarness(async () => {
    const result = await ask('cafe-price', 'ลาเต้ราคาเท่าไหร่');
    assert.equal(result.statusCode, 200);
    const text = messageOf(result);
    assert.match(text, /65\s*บาท/u);
    assert.doesNotMatch(text, /ไม่มีข้อมูลยืนยัน|ไม่ขอเดา/u);
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
      ['location','ทำมา-ชาติอยู่ที่ไหน',/ชัยภูมิ|พิกัด|แผนที่|ทำมา-ชาติ/u],
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
