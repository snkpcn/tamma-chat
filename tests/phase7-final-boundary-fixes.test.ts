import test from 'node:test';
import assert from 'node:assert/strict';

import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';
import { brainRequest, guestId, withHarness } from './helpers/canonical-core-harness';

const AGENT_ENV=[
  'THONGTHAI_AGENT_PRIMARY_ENABLED',
  'THONGTHAI_AGENT_PRIMARY_CHANNELS',
  'THONGTHAI_AGENT_PRIMARY_PERCENT',
  'THONGTHAI_AGENT_PRIMARY_PERCENT_LINE',
] as const;

async function withPrimary100<T>(run:()=>Promise<T>):Promise<T>{
  const before=Object.fromEntries(AGENT_ENV.map(key=>[key,process.env[key]]));
  process.env.THONGTHAI_AGENT_PRIMARY_ENABLED='1';
  process.env.THONGTHAI_AGENT_PRIMARY_CHANNELS='web,line,facebook';
  process.env.THONGTHAI_AGENT_PRIMARY_PERCENT='100';
  process.env.THONGTHAI_AGENT_PRIMARY_PERCENT_LINE='100';
  try{return await run();}
  finally{
    for(const key of AGENT_ENV){
      const value=before[key];
      if(value===undefined) delete process.env[key];
      else process.env[key]=value;
    }
  }
}

test('Phase 7 final: explicit horse WITHHOLD is information and persists a non-committed task before Agent/legacy booking',async()=>{
  await withHarness(async harness=>withPrimary100(async()=>{
    const gid=guestId('phase7-final-hold');
    const result=await processThongthaiChatCore(
      brainRequest('เอาภาราดรไว้ก่อน แต่ยังไม่จองครับ',gid,'line'),
      'phase7-final-hold-event',
    );
    const message=String(result.payload.message??'');
    assert.equal(result.statusCode,200);
    assert.equal(result.payload.intent,'information');
    assert.match(message,/ภาราดร/u);
    assert.match(message,/ยัง.*ไม่.*จอง|ไม่ได้.*จอง/u);
    assert.doesNotMatch(message,/ชื่อผู้จอง|เบอร์โทร|ขอเพิ่มอีกนิด.*วันที่/u);
    assert.equal(harness.modelCallCount(),0);
    assert.equal(harness.postsTo('bookings').length,0);

    const internal=harness.guestDbId(gid);
    assert.ok(internal);
    const state=harness.getState(internal)?.state as any;
    const task=state?.taskState?.activeTask;
    assert.equal(task?.type,'activity_booking');
    assert.equal(task?.commitmentIntent,false);
    assert.equal(task?.slots?.assetSelection,'ภาราดร');
  }));
});

test('Phase 7 final: durable dietary menu follow-up uses grounded restaurant advisor before semantic model',async()=>{
  await withHarness(async harness=>withPrimary100(async()=>{
    const gid=guestId('phase7-final-restaurant-followup');
    const req=brainRequest('มีเมนูไหนเหมาะกับที่บอกไปบ้างครับ',gid,'line');
    req.guestContext.constraints.push('shrimp_allergy','mild_spice');

    const result=await processThongthaiChatCore(req,'phase7-final-restaurant-followup-event');
    const message=String(result.payload.message??'');

    assert.equal(result.statusCode,200);
    assert.equal(result.payload.intent,'recommendation');
    assert.match(message,/กุ้ง/u);
    assert.match(message,/เผ็ด|พริก/u);
    assert.doesNotMatch(message,/ยังตอบเรื่องนี้ให้แม่นไม่ได้|ลองอีกครั้งสักครู่/u);
    assert.equal(harness.modelCallCount(),0);
    assert.equal(harness.postsTo('bookings').length,0);
  }));
});

test('Phase 7 final: availability-only WITHHOLD asks missing date/time instead of returning a slot recap',async()=>{
  await withHarness(async harness=>{
    const gid=guestId('phase7-final-availability');

    const hold=await processThongthaiChatCore(
      brainRequest('เอาภาราดรไว้ก่อน แต่ยังไม่จองครับ',gid,'line'),
      'phase7-final-availability-hold',
    );
    assert.equal(hold.statusCode,200);

    const duration=await processThongthaiChatCore(
      brainRequest('งั้นขอ 45 นาที แต่ยังไม่จองนะครับ',gid,'line'),
      'phase7-final-availability-duration',
    );
    assert.equal(duration.statusCode,200);

    const beforeCalls=harness.modelCallCount();
    const result=await processThongthaiChatCore(
      brainRequest('เช็กว่างเฉย ๆ ได้ไหมครับ ยังไม่จอง',gid,'line'),
      'phase7-final-availability-check',
    );
    const message=String(result.payload.message??'');

    assert.equal(result.statusCode,200);
    assert.equal(result.payload.intent,'information');
    assert.match(message,/คิว|ว่าง/u);
    assert.match(message,/วัน/u);
    assert.match(message,/เวลา/u);
    assert.match(message,/ยัง.*ไม่.*จอง|ไม่ได้.*จอง/u);
    assert.doesNotMatch(message,/^เลือกไว้เป็น .*ระยะเวลา 45 นาที/u);
    assert.equal(harness.modelCallCount(),beforeCalls);
    assert.equal(harness.postsTo('bookings').length,0);
  });
});
