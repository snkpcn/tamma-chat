import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activeTaskOwnsConversationBeforePrimary,
  processThongthaiChatCore,
} from '../netlify/functions/thongthai-chat';
import {
  createActiveTask,
  emptyTaskStateContainer,
} from '../netlify/functions/_task-state';
import { brainRequest, guestId, withHarness } from './helpers/canonical-core-harness';

test('Phase 7 task authority: non-terminal ActiveTask blocks read-only Agent Primary ownership',()=>{
  const active=createActiveTask({
    type:'activity_booking',
    sourceChannel:'line',
    initialSlots:{resourceCode:'activity-horse',horseName:'ภาราดร'},
  });
  assert.equal(activeTaskOwnsConversationBeforePrimary({
    ...emptyTaskStateContainer(),
    activeTask:active,
  }),true);

  assert.equal(activeTaskOwnsConversationBeforePrimary({
    ...emptyTaskStateContainer(),
    activeTask:{...active,status:'completed'},
  }),false);

  assert.equal(activeTaskOwnsConversationBeforePrimary(emptyTaskStateContainer()),false);
});

test('Phase 7 task authority: 60-minute continuation reaches One-Mind policy even when Agent Primary is 100%',async()=>{
  await withHarness(async harness=>{
    const gid=guestId('phase7-active-task-agent-boundary');

    // Create the canonical guest/state row without involving a model.
    const reset=await processThongthaiChatCore(
      brainRequest('ลืมที่คุยกันไปก่อนนะครับ',gid,'line'),
      'phase7-active-task-reset',
    );
    assert.equal(reset.statusCode,200);

    const internalId=harness.guestDbId(gid);
    assert.ok(internalId);
    const existing=harness.getState(internalId)?.state ?? {};

    const active={
      ...createActiveTask({
        type:'activity_booking',
        sourceChannel:'line',
        initialSlots:{resourceCode:'activity-horse',horseName:'ภาราดร'},
        requiredFields:['durationMinutes','date','time','partySize'],
      }),
      selectedEntities:[{
        id:'activity_asset:horse-pharadon',
        type:'horse',
        name:'ภาราดร',
        domain:'activity' as const,
        source:'catalog' as const,
        canonical:true,
      }],
    };
    harness.setState(internalId,{
      ...existing,
      taskState:{...emptyTaskStateContainer(),activeTask:active},
    });

    const envKeys=[
      'THONGTHAI_AGENT_PRIMARY_ENABLED',
      'THONGTHAI_AGENT_PRIMARY_CHANNELS',
      'THONGTHAI_AGENT_PRIMARY_PERCENT',
      'THONGTHAI_AGENT_PRIMARY_PERCENT_LINE',
    ] as const;
    const before=Object.fromEntries(envKeys.map(key=>[key,process.env[key]]));
    process.env.THONGTHAI_AGENT_PRIMARY_ENABLED='1';
    process.env.THONGTHAI_AGENT_PRIMARY_CHANNELS='web,line,facebook';
    process.env.THONGTHAI_AGENT_PRIMARY_PERCENT='100';
    process.env.THONGTHAI_AGENT_PRIMARY_PERCENT_LINE='100';

    try{
      harness.programGeminiReply({
        normalizedMeaning:'customer changes the held horse duration to 60 minutes without authorizing a booking',
        reply:'รับ 60 นาทีไว้ก่อนครับ',
        speechAct:'selection',
        domain:'activity',
        intent:'change_held_horse_duration',
        action:'modify',
        informationNeed:'none',
        entities:{durationMinutes:60},
        references:[],
        constraints:['no_transaction'],
        confidence:0.99,
        needsClarification:false,
      });

      const result=await processThongthaiChatCore(
        brainRequest('เอา 60 นาทีครับ',gid,'line'),
        'phase7-active-task-duration-60',
      );
      const message=String(result.payload.message??'');

      assert.equal(result.statusCode,200);
      assert.match(message,/60\s*นาที/u);
      assert.match(message,/30\s*นาที/u);
      assert.match(message,/45\s*นาที/u);
      assert.match(message,/ไม่มี|ไม่ใช่|รองรับ/u);
      assert.doesNotMatch(message,/ระบบจอง.*ตอบช้า|คิดช้ากว่าปกติ/u);
      assert.equal(harness.postsTo('bookings').length,0);
    }finally{
      for(const key of envKeys){
        const value=before[key];
        if(value===undefined) delete process.env[key];
        else process.env[key]=value;
      }
    }
  });
});
