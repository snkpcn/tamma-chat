import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deterministicConstraintOnlyPreferenceResponse,
  processThongthaiChatCore,
} from '../netlify/functions/thongthai-chat';
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

test('Phase 7 preference boundary: mild-spice declaration is constraint-only information',()=>{
  const request=brainRequest(
    'ผมกินเผ็ดไม่เก่งด้วยครับ',
    guestId('phase7-mild-preference-unit'),
    'line',
  );
  const response=deterministicConstraintOnlyPreferenceResponse(request);
  assert.ok(response);
  assert.equal(response.intent,'information');
  assert.match(response.message,/เผ็ด/u);
  assert.match(response.message,/น้อย|ไม่เก่ง/u);
  assert.doesNotMatch(response.message,/เมนู.{0,20}(?:แนะนำ|ทั้งหมด)|จอง/u);
});

test('Phase 7 preference boundary: 100% Agent Primary cannot steal a bare dietary update',async()=>{
  await withHarness(async harness=>withPrimary100(async()=>{
    const gid=guestId('phase7-mild-preference-primary');
    const result=await processThongthaiChatCore(
      brainRequest('ผมกินเผ็ดไม่เก่งด้วยครับ',gid,'line'),
      'phase7-preference-before-agent',
    );
    const message=String(result.payload.message??'');
    assert.equal(result.statusCode,200);
    assert.equal(result.payload.intent,'information');
    assert.match(message,/เผ็ด/u);
    assert.doesNotMatch(message,/ระบบจอง.*ตอบช้า|คิดช้ากว่าปกติ/u);
    assert.equal(harness.modelCallCount(),0);
    assert.equal(harness.postsTo('bookings').length,0);
  }));
});

test('Phase 7 hold boundary: explicit horse hold persists non-committed task and never returns booking intent',async()=>{
  await withHarness(async harness=>withPrimary100(async()=>{
    const gid=guestId('phase7-hold-before-agent');

    await processThongthaiChatCore(
      brainRequest('ลืมที่คุยกันไปก่อนนะครับ',gid,'line'),
      'phase7-hold-reset',
    );

    const result=await processThongthaiChatCore(
      brainRequest('เอาภาราดรไว้ก่อน แต่ยังไม่จองครับ',gid,'line'),
      'phase7-hold-pharadon',
    );
    const message=String(result.payload.message??'');

    assert.equal(result.statusCode,200);
    assert.equal(result.payload.intent,'information');
    assert.match(message,/ภาราดร/u);
    assert.match(message,/ยัง.*ไม่.*จอง|ไม่ได้.*จอง/u);
    assert.doesNotMatch(message,/ขอเพิ่มอีกนิด.*วันที่|ชื่อผู้จอง|เบอร์โทร/u);
    assert.equal(harness.modelCallCount(),0);
    assert.equal(harness.postsTo('bookings').length,0);

    const internalId=harness.guestDbId(gid);
    assert.ok(internalId);
    const state=harness.getState(internalId)?.state as {
      taskState?:{
        activeTask?:{
          type?:string;
          domain?:string;
          commitmentIntent?:boolean;
          slots?:Record<string,unknown>;
        }|null;
      };
    }|undefined;
    const task=state?.taskState?.activeTask;
    assert.equal(task?.type,'activity_booking');
    assert.equal(task?.domain,'activity');
    assert.equal(task?.commitmentIntent,false);
    assert.equal(task?.slots?.assetSelection,'ภาราดร');
    assert.equal(task?.slots?.resourceCode,'activity-horse');
  }));
});
