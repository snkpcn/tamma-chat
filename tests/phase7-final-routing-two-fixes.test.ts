import test from 'node:test';
import assert from 'node:assert/strict';

import {
  processThongthaiChatCore,
  explicitHorseHoldWithoutBookingResponse,
} from '../netlify/functions/thongthai-chat';
import { brainRequest, guestId, withHarness } from './helpers/canonical-core-harness';

async function withEnv<T>(
  values:Record<string,string|undefined>,
  run:()=>Promise<T>,
):Promise<T>{
  const before=Object.fromEntries(Object.keys(values).map(key=>[key,process.env[key]]));
  try{
    for(const [key,value] of Object.entries(values)){
      if(value===undefined) delete process.env[key];
      else process.env[key]=value;
    }
    return await run();
  } finally {
    for(const [key,value] of Object.entries(before)){
      if(value===undefined) delete process.env[key];
      else process.env[key]=value;
    }
  }
}

test('Phase 7 final routing: explicit WITHHOLD horse selection is information, persists non-committed planning state, and creates no booking',async()=>{
  await withHarness(async harness=>{
    const gid=guestId('phase7-final-hold');
    // Create the synthetic guest row first so the direct responder can persist
    // through the real task-state store used by production.
    await processThongthaiChatCore(
      brainRequest('ลืมที่คุยกันไปก่อนนะครับ',gid,'line'),
      'phase7-final-hold-reset',
    );
    const internalId=harness.guestDbId(gid);
    assert.ok(internalId);

    const response=await explicitHorseHoldWithoutBookingResponse(
      brainRequest('เอาภาราดรไว้ก่อน แต่ยังไม่จองครับ',gid,'line'),
      internalId!,
      'line',
      'WITHHOLD',
    );

    assert.ok(response);
    assert.equal(response!.intent,'information');
    assert.match(response!.message,/ภาราดร/u);
    assert.match(response!.message,/ยังไม่ได้จอง|ยังไม่.*จอง/u);

    const state=harness.getState(internalId!)?.state as any;
    const task=state?.taskState?.activeTask;
    assert.ok(task);
    assert.equal(task.domain,'activity');
    assert.equal(task.commitmentIntent,false);
    assert.equal(task.slots.assetSelection,'ภาราดร');
    assert.equal(harness.postsTo('bookings').length,0);
  });
});

test('Phase 7 final routing: WITHHOLD horse hold wins even when Agent Primary is configured at 100%',async()=>{
  await withEnv({
    THONGTHAI_AGENT_PRIMARY_ENABLED:'1',
    THONGTHAI_AGENT_PRIMARY_CHANNELS:'web,line,facebook',
    THONGTHAI_AGENT_PRIMARY_PERCENT:'100',
    THONGTHAI_AGENT_PRIMARY_PERCENT_LINE:'100',
    THONGTHAI_ONE_MIND_CUTOVER:'1',
  },async()=>{
    await withHarness(async harness=>{
      const gid=guestId('phase7-final-hold-primary');
      const result=await processThongthaiChatCore(
        brainRequest('เอาภาราดรไว้ก่อน แต่ยังไม่จองครับ',gid,'line'),
        'phase7-final-hold-primary-event',
      );

      assert.equal(result.statusCode,200);
      assert.equal((result.payload as any).intent,'information');
      assert.match(String((result.payload as any).message??''),/ภาราดร/u);
      assert.match(String((result.payload as any).message??''),/ยังไม่ได้จอง|ยังไม่.*จอง/u);
      assert.equal(harness.postsTo('bookings').length,0);
      assert.equal(harness.modelCallCount(),0);
    });
  });
});

test('Phase 7 final routing: explicit restaurant recommendation uses durable shrimp + mild-spice constraints before Agent/early One-Mind',async()=>{
  await withEnv({
    THONGTHAI_AGENT_PRIMARY_ENABLED:'1',
    THONGTHAI_AGENT_PRIMARY_CHANNELS:'web,line,facebook',
    THONGTHAI_AGENT_PRIMARY_PERCENT:'100',
    THONGTHAI_AGENT_PRIMARY_PERCENT_LINE:'100',
    THONGTHAI_ONE_MIND_CUTOVER:'1',
  },async()=>{
    await withHarness(async harness=>{
      const gid=guestId('phase7-final-restaurant-precedence');

      const first=await processThongthaiChatCore(
        brainRequest('แฟนแพ้กุ้ง มีอะไรกินได้บ้าง',gid,'line'),
        'phase7-final-rest-1',
      );
      assert.equal(first.statusCode,200);

      const second=await processThongthaiChatCore(
        brainRequest('ผมกินเผ็ดไม่เก่งด้วยครับ',gid,'line'),
        'phase7-final-rest-2',
      );
      assert.equal(second.statusCode,200);

      const final=await processThongthaiChatCore(
        brainRequest('มีเมนูไหนเหมาะกับที่บอกไปบ้างครับ',gid,'line'),
        'phase7-final-rest-3',
      );
      const message=String((final.payload as any).message??'');

      assert.equal(final.statusCode,200);
      assert.equal((final.payload as any).intent,'recommendation');
      assert.match(message,/กุ้ง/u);
      assert.match(message,/เผ็ด|พริก/u);
      assert.doesNotMatch(message,/ยังตอบเรื่องนี้ให้แม่นไม่ได้|คิดช้ากว่าปกติ|ระบบตอบช้า/u);
      assert.equal(harness.postsTo('bookings').length,0);
      // All three are established grounded restaurant classes and must not
      // spend a semantic/model call merely because Agent Primary is 100%.
      assert.equal(harness.modelCallCount(),0);
    });
  });
});
