import test from 'node:test';
import assert from 'node:assert/strict';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';
import { withHarness, brainRequest, guestId } from './helpers/canonical-core-harness';
import { parsePreferences, parseRestaurantParty } from '../netlify/functions/_restaurant-intelligence';

for (const channel of ['web', 'line'] as const) {
  test(`${channel}: restaurant preferences survive a child-count follow-up and recap without a provider`, async () => {
    await withHarness(async () => {
      delete process.env.OPENAI_API_KEY;
      const id = guestId(`restaurant-continuity-${channel}`);
      const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
      const ask = async (message: string) => {
        const result = await processThongthaiChatCore(brainRequest(message, id, channel, channel === 'web' ? history : []), `continuity-${history.length}`);
        assert.equal(result.statusCode, 200);
        const reply = String((result.payload as any).message);
        history.push({ role: 'user', content: message }, { role: 'assistant', content: reply });
        assert.doesNotMatch(reply, /คิดช้า|เชื่อมต่อ.*ไม่ได้|กิจกรรมหรือห้องพัก/);
        return reply;
      };
      await ask('ช่วยแนะนำเมนูสำหรับผู้ใหญ่ 2 คน งบรวม 500 บาท ขอแบบไม่เผ็ด แค่สอบถามข้อมูล ยังไม่สั่งอาหารครับ');
      await ask('ถ้ามีเด็กมาด้วยอีก 1 คนล่ะครับ');
      const recap = await ask('สรุปตอนนี้มากี่คน งบเท่าไหร่ และกินรสแบบไหนครับ');
      assert.match(recap, /3\s*(?:คน|ท่าน)/);
      assert.match(recap, /500/);
      assert.match(recap, /ไม่เผ็ด/);
      assert.doesNotMatch(recap, /ยังไม่ได้ระบุ|ยังไม่ทราบ/);
    });
  });
}

test('screenshot: child menu then a budget/group follow-up stays on restaurant facts', async () => {
  await withHarness(async harness => {
    const id = guestId('restaurant-screenshot');
    const first = await processThongthaiChatCore(brainRequest('แนะนำเมนูสำหรับเด็กหน่อย', id), 'screenshot-1');
    const reply = String((first.payload as any).message);
    assert.match(reply, /ข้าวผัดหมู/);
    const next = await processThongthaiChatCore(brainRequest('มีงบ1000 ไปกินสามคนสั่งอะไรกินดี', id, 'web', [
      { role: 'user', content: 'แนะนำเมนูสำหรับเด็กหน่อย' },
      { role: 'assistant', content: reply },
    ]), 'screenshot-2');
    assert.doesNotMatch(String((next.payload as any).message), /คิดช้า|เชื่อมต่อ.*ไม่ได้|กิจกรรมหรือห้องพัก/);
    assert.match(String((next.payload as any).message), /บาท/);
    assert.equal(harness.modelCallCount(),0,'verified menu advice must not depend on a paid provider');
  });
});

test('restaurant budget corrections and Thai headcounts use the latest customer values', () => {
  const preferences = parsePreferences({query:'มีงบ1000 ไปกินสามคนสั่งอะไรกินดี',recentMessages:['ผู้ใหญ่ 2 คน งบรวม 500 บาท ไม่เผ็ด']},[]);
  assert.equal(preferences.budget,1000);
  assert.equal(preferences.partySize,3);
  assert.equal(preferences.spice,'none');
  assert.deepEqual(parseRestaurantParty(['ผู้ใหญ่ ๒ คน','มีเด็กมาด้วยอีก ๑ คน','ผู้ใหญ่เปลี่ยนเป็น 3 คน']),{adults:3,children:1,total:4});
});

test('assistant menu prices cannot replace a customer budget on a follow-up', async () => {
  await withHarness(async () => {
    const id = guestId('restaurant-budget-provenance');
    const result = await processThongthaiChatCore(brainRequest('สรุปงบกับจำนวนคนหน่อย',id,'web',[
      {role:'user',content:'แนะนำเมนู ผู้ใหญ่ 2 คน งบรวม 500 บาท ไม่เผ็ด'},
      {role:'assistant',content:'ชุดนี้รวม 90 บาท งบ 90 บาท สำหรับ 99 คน'},
    ]),'budget-provenance');
    const reply = String((result.payload as any).message);
    assert.match(reply,/500/);
    assert.match(reply,/2 คน/);
    assert.doesNotMatch(reply,/90 บาท|99 คน/);
  });
});

test('live menu outage and telemetry outage do not trigger a paid retry or invent menu facts',async()=>{
  await withHarness(async harness=>{
    const original = global.fetch;
    global.fetch=(async(input,init)=>{
      const url=String(input);
      if(url.includes('/restaurant_menu_live'))return new Response('',{status:503});
      return original(input,init);
    }) as typeof fetch;
    const result=await processThongthaiChatCore(brainRequest('แนะนำเมนูสำหรับเด็กหน่อย',guestId('restaurant-source-down')),'source-down');
    assert.match(String((result.payload as any).message),/ตรวจสอบ.*ไม่สำเร็จ/);
    assert.doesNotMatch(String((result.payload as any).message),/\d+\s*บาท|ข้าวผัด/);
    assert.equal(harness.modelCallCount(),0);
  });
  await withHarness(async harness=>{
    const original = global.fetch;
    global.fetch=(async(input,init)=>String(input).includes('/ai_response_turns')?new Response('',{status:503}):original(input,init)) as typeof fetch;
    const result=await processThongthaiChatCore(brainRequest('แนะนำเมนูสำหรับเด็กหน่อย',guestId('restaurant-telemetry-down')),'telemetry-down');
    assert.match(String((result.payload as any).message),/ข้าวผัดหมู/);
    assert.equal(harness.modelCallCount(),0);
  });
});
