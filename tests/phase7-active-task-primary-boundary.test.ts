import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activeTaskOwnsConversationBeforePrimary,
  conversationContextOwnsConversationBeforePrimary,
  processThongthaiChatCore,
} from '../netlify/functions/thongthai-chat';
import {
  createActiveTask,
  emptyTaskStateContainer,
} from '../netlify/functions/_task-state';
import { emptyConversationContextState } from '../netlify/functions/_conversation-context';
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


test('Phase 7 bounded conversation authority: considered selection blocks read-only Agent Primary even without ActiveTask',()=>{
  const state=emptyConversationContextState(new Date('2026-10-02T07:00:00Z'));
  const bounded={
    ...state,
    activeDomain:'activity' as const,
    workingMemory:{
      ...state.workingMemory,
      consideredSelections:[{
        domain:'activity' as const,
        name:'ภาราดร',
        entityId:'activity_asset:horse-pharadon',
        entityType:'horse',
        status:'considering' as const,
        observedAt:state.updatedAt,
      }],
      constraints:[{
        domain:'activity' as const,
        code:'no_transaction',
        observedAt:state.updatedAt,
      }],
      transactionCommitment:'none' as const,
    },
  };
  assert.equal(conversationContextOwnsConversationBeforePrimary(bounded),true);
  assert.equal(conversationContextOwnsConversationBeforePrimary(state),false);
});

test('Phase 7 bounded conversation authority: explicit side-topic after held horse reaches One-Mind instead of Agent budget fallback',async()=>{
  await withHarness(async harness=>{
    const gid=guestId('phase7-bounded-context-side-topic');

    const reset=await processThongthaiChatCore(
      brainRequest('ลืมที่คุยกันไปก่อนนะครับ',gid,'line'),
      'phase7-bounded-context-reset',
    );
    assert.equal(reset.statusCode,200);

    const internalId=harness.guestDbId(gid);
    assert.ok(internalId);
    const existing=harness.getState(internalId)?.state ?? {};
    const state=emptyConversationContextState(new Date('2026-10-02T07:00:00Z'));
    harness.setState(internalId,{
      ...existing,
      taskState:emptyTaskStateContainer(),
      conversationContext:{
        ...state,
        activeDomain:'activity',
        activeTopic:'held_horse',
        workingMemory:{
          ...state.workingMemory,
          consideredSelections:[{
            domain:'activity',
            name:'ภาราดร',
            entityId:'activity_asset:horse-pharadon',
            entityType:'horse',
            status:'considering',
            observedAt:state.updatedAt,
          }],
          constraints:[{
            domain:'activity',
            code:'no_transaction',
            observedAt:state.updatedAt,
          }],
          transactionCommitment:'none',
        },
      },
    });

    const envKeys=[
      'THONGTHAI_AGENT_PRIMARY_ENABLED',
      'THONGTHAI_AGENT_PRIMARY_CHANNELS',
      'THONGTHAI_AGENT_PRIMARY_PERCENT',
      'THONGTHAI_AGENT_PRIMARY_PERCENT_LINE',
      'THONGTHAI_ONE_MIND_CUTOVER',
    ] as const;
    const before=Object.fromEntries(envKeys.map(key=>[key,process.env[key]]));
    process.env.THONGTHAI_AGENT_PRIMARY_ENABLED='1';
    process.env.THONGTHAI_AGENT_PRIMARY_CHANNELS='web,line,facebook';
    process.env.THONGTHAI_AGENT_PRIMARY_PERCENT='100';
    process.env.THONGTHAI_AGENT_PRIMARY_PERCENT_LINE='100';
    process.env.THONGTHAI_ONE_MIND_CUTOVER='1';

    try{
      harness.programGeminiReply({
        normalizedMeaning:'customer temporarily switches from the held horse topic to food',
        reply:'ได้ครับ มาคุยเรื่องอาหารก่อนครับ',
        speechAct:'topic_switch',
        domain:'restaurant',
        intent:'switch_to_restaurant',
        action:'ask',
        informationNeed:'none',
        entities:{},
        references:[],
        constraints:[],
        confidence:0.99,
        needsClarification:false,
      });

      const result=await processThongthaiChatCore(
        brainRequest('ขอถามเรื่องอาหารก่อนครับ',gid,'line'),
        'phase7-bounded-context-food-switch',
      );
      const message=String(result.payload.message??'');

      assert.equal(result.statusCode,200);
      assert.match(message,/อาหาร|เมนู|ได้ครับ/u);
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
