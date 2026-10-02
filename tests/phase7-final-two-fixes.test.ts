import test from 'node:test';
import assert from 'node:assert/strict';

import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';
import { composeDeterministicResponse, type ResponseComposerInput } from '../netlify/functions/_response-composer';
import { emptyConversationContextState } from '../netlify/functions/_conversation-context';
import { emptyTaskStateContainer } from '../netlify/functions/_task-state';
import { brainRequest, guestId, withHarness } from './helpers/canonical-core-harness';

test('Phase 7 final: held horse rejects unsupported duration from verified activity offerings before model/state mutation',async()=>{
  await withHarness(async harness=>{
    const gid=guestId('phase7-final-duration-truth');
    await processThongthaiChatCore(
      brainRequest('ลืมที่คุยกันไปก่อนนะครับ',gid,'line'),
      'phase7-final-duration-reset',
    );
    const internalId=harness.guestDbId(gid);
    assert.ok(internalId);
    const existing=harness.getState(internalId)?.state ?? {};
    const context=emptyConversationContextState(new Date());
    harness.setState(internalId,{
      ...existing,
      taskState:emptyTaskStateContainer(),
      conversationContext:{
        ...context,
        activeDomain:'activity',
        workingMemory:{
          ...context.workingMemory,
          consideredSelections:[{
            domain:'activity',
            name:'ภาราดร',
            entityId:'activity_asset:horse-pharadon',
            entityType:'horse',
            status:'considering',
            observedAt:context.updatedAt,
          }],
          constraints:[{
            domain:'activity',
            code:'no_transaction',
            observedAt:context.updatedAt,
          }],
          transactionCommitment:'none',
        },
      },
    });

    const result=await processThongthaiChatCore(
      brainRequest('เอา 60 นาทีครับ',gid,'line'),
      'phase7-final-duration-60',
    );
    const message=String(result.payload.message??'');

    assert.equal(result.statusCode,200);
    assert.match(message,/60\s*นาที/u);
    assert.match(message,/30\s*นาที/u);
    assert.match(message,/45\s*นาที/u);
    assert.match(message,/ยังไม่มี|ไม่มี|ไม่รองรับ/u);
    assert.equal(harness.modelCallCount(),0);
    assert.equal(harness.postsTo('bookings').length,0);
  });
});

test('Phase 7 final: deterministic summary reads durable shrimp + mild-spice preferences even when working context only retained shrimp',()=>{
  const context=emptyConversationContextState(new Date());
  const input:ResponseComposerInput={
    channel:'line',
    language:'th',
    userMessage:'สรุปที่คุยกันให้หน่อยครับ',
    conversationContext:{
      ...context,
      activeDomain:'activity',
      recentEntities:[{
        id:'activity:horse',
        name:'ขี่ม้า',
        type:'activity',
        domain:'activity',
        source:'catalog',
        canonical:true,
        observedAt:context.updatedAt,
      }],
      workingMemory:{
        ...context.workingMemory,
        consideredSelections:[{
          domain:'activity',
          name:'ภาราดร',
          status:'considering',
          observedAt:context.updatedAt,
        }],
        constraints:[{
          domain:'restaurant',
          code:'no_shrimp',
          observedAt:context.updatedAt,
        }],
      },
    },
    durableConstraints:['shrimp_allergy','mild_spice'],
    dialogDecision:{
      mode:'answer',
      taskStateContainer:emptyTaskStateContainer(),
      knowledgeRequests:[],
      missingFields:[],
      responseIntent:'active_task_summary',
      reasons:['task_summary_requested'],
    },
    knowledgeBundles:[],
    degradation:{
      version:'phase7-test',
      condition:'none',
      level:'normal',
      reasonCodes:[],
      retryable:false,
      safeToExecuteTransaction:false,
      sourceStates:[],
    },
  };

  const response=composeDeterministicResponse(input);
  assert.match(response.message,/กุ้ง/u);
  assert.match(response.message,/เผ็ด/u);
  assert.match(response.message,/ภาราดร/u);
  assert.match(response.message,/ยังไม่ได้ยืนยันการจอง|ยังไม่ได้จอง/u);
});
