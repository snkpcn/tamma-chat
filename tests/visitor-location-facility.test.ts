import test from 'node:test';
import assert from 'node:assert/strict';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';
import { withHarness,guestId,brainRequest } from './helpers/canonical-core-harness';
import { TAMMA_CHART_LOCATION } from '../netlify/functions/_local-concierge-location';
import { resolveKnowledge } from '../netlify/functions/_knowledge-resolver';
import { deriveDeterministicSemanticTurn } from '../netlify/functions/_deterministic-semantic-turn';
import { emptySemanticContext } from '../netlify/functions/_semantic-interpreter';
import { emptyTaskStateContainer } from '../netlify/functions/_task-state';

for(const channel of ['web','line'] as const) {
  test(`${channel}: screenshot sequence answers location with text and treats missing wheelchair data as unknown`,async()=>{
    await withHarness(async harness=>{
      const id=guestId('location-facility-'+channel);
      const history:Array<{role:'user'|'assistant';content:string}>=[];
      for(const message of ['มีรถเข็น','เปิดวันไหนบ้าง','ตั้งอยู่ที่ไหน']) {
        const result=await processThongthaiChatCore(brainRequest(message,id,channel,history),'visitor-'+history.length);
        const reply=String((result.payload as any).message);
        if(message==='มีรถเข็น') {
          assert.match(reply,/ยังไม่มีข้อมูลยืนยัน.*รถเข็น.*ให้ยืมหรือเช่า/);
          assert.match(reply,/สอบถามทีมงานก่อนเดินทาง/);
          assert.doesNotMatch(reply,/ลองอีกครั้ง|ยังตอบเรื่องนี้ให้แม่นไม่ได้|มีรถเข็นให้ยืมฟรี|ส่งเรื่องให้แล้ว/);
        } else if(message==='เปิดวันไหนบ้าง') {
          assert.match(reply,/ทุกวัน 06:00–18:00/);
        } else {
          assert.match(reply,/ทำมา-ชาติ.*ตาดโตน.*ชัยภูมิ/);
          assert.match(reply,/ตำบลนาฝาย อำเภอเมือง จังหวัดชัยภูมิ/);
          assert.match(reply,/มหาวิทยาลัยราชภัฏชัยภูมิ.*ซ้ายมือ.*อุทยานแห่งชาติตาดโตน/);
          assert.ok(reply.includes(TAMMA_CHART_LOCATION.mapsLink));
        }
        history.push({role:'user',content:message},{role:'assistant',content:reply});
      }
      assert.equal(harness.modelCallCount(),0,'no model required for the complete screenshot sequence');
    });
  });
}
for(const message of ['ที่ตั้ง','ขอพิกัด','อยู่ที่ไหน']) {
  test(`short location wording includes arrival landmark: ${message}`,async()=>{
    await withHarness(async harness=>{
      const result=await processThongthaiChatCore(brainRequest(message,guestId('short-location')),'short-location');
      const reply=String((result.payload as any).message);
      assert.match(reply,/ตำบลนาฝาย.*มหาวิทยาลัยราชภัฏชัยภูมิ/s);
      assert.ok(reply.includes(TAMMA_CHART_LOCATION.mapsLink));
      assert.equal(harness.modelCallCount(),0);
    });
  });
}
for(const [message,expected] of [
  ['มีวีลแชร์ให้ยืมไหม','รถเข็นสำหรับผู้ใช้วีลแชร์'],
  ['มีรถเข็นเด็กให้ยืมไหม','รถเข็นเด็ก'],
] as const) {
  test(`facility type remains explicit: ${message}`,async()=>{
    await withHarness(async harness=>{
      const result=await processThongthaiChatCore(brainRequest(message,guestId('facility-type')),'facility-type');
      const reply=String((result.payload as any).message);
      assert.ok(reply.includes(expected));
      assert.match(reply,/ยังไม่มีข้อมูลยืนยัน/);
      assert.equal(harness.modelCallCount(),0);
    });
  });
}
test('the business identity catalog is never facility-loan evidence',async()=>{
  let identityReads=0;
  const bundle=await resolveKnowledge({domain:'ecosystem',intent:'facility_loan_information_lookup',action:'ask',entities:{facilityTopic:'mobility_cart_loan'},constraints:[],needs:['entity_details']},{bible:{identity:async()=>{identityReads++;throw new Error('must not query identity');}}});
  assert.equal(identityReads,0);
  assert.equal(bundle.facts.length,0);
  assert.ok(bundle.sources.some(source=>source.reason==='no_source_registered'));
});
for(const message of ['ช่วยเตรียมรถเข็นให้คุณแม่','มีรถเข็นและห้องพักไหม','รถเข็นราคาเท่าไหร่']) {
  test(`a loan-information shortcut cannot replace ${message}`,()=>{
    const turn=deriveDeterministicSemanticTurn(message,emptySemanticContext(),emptyTaskStateContainer());
    assert.notEqual(turn?.intent,'facility_loan_information_lookup');
  });
}
