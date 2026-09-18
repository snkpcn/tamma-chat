import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ONE_MIND_TRACE_VERSION,
  buildOneMindTraceEnvelope,
  emitOneMindTrace,
} from '../netlify/functions/_one-mind-observability';
import { emptyConversationContextState } from '../netlify/functions/_conversation-context';
import { emptyTaskStateContainer } from '../netlify/functions/_task-state';
import type { OneMindTurnResult } from '../netlify/functions/_thongthai-one-mind-orchestrator';
import type { ComposedResponse } from '../netlify/functions/_response-composer';

const NOW=new Date('2026-09-18T12:00:00.000Z');

function turn():OneMindTurnResult{
  const conversation=emptyConversationContextState(NOW);
  const tasks=emptyTaskStateContainer();
  return {
    identity:{
      providerUserKey:'SENSITIVE-LINE-USER-KEY',
      canonicalAnonymousId:'11111111-1111-4111-8111-111111111111',
      guestDbId:'22222222-2222-4222-8222-222222222222',
      linked:true,
    },
    semanticTurn:{
      domain:'restaurant',intent:'menu_recommendation',action:'recommend',entities:{},references:[],
      constraints:[],confidence:.91,needsClarification:false,
    },
    dialogPlan:{
      taskStateContainer:tasks,knowledgeRequests:[],mode:'answer',reasons:[],
      missingFields:[],customerCommitPresent:false,action:'recommend',compareEntityIds:[],
    },
    dialogDecision:{
      mode:'answer',taskStateContainer:tasks,knowledgeRequests:[],missingFields:[],
      responseIntent:'grounded_answer',reasons:[],
    },
    groundedKnowledge:[],
    knowledgeDegradation:{
      version:'degradation-v1',condition:'none',level:'normal',reasonCodes:[],
      retryable:false,safeToExecuteTransaction:false,sourceStates:[],
    },
    conversationContextBefore:conversation,
    conversationContextAfter:conversation,
    taskStateBefore:tasks,
    taskStateAfter:tasks,
    trace:{
      orchestratorVersion:'one-mind-g1-v1',
      channel:'line',
      eventId:'line-event-123',
      semantic:{
        semanticVersion:'semantic-v1',domain:'restaurant',intent:'menu_recommendation',
        action:'recommend',confidenceBucket:'high',referencesResolved:0,referencesUnresolved:0,
        needsClarification:false,
      },
      dialogMode:'answer',
      responseIntent:'grounded_answer',
      reasonCodes:[],
      knowledgeSources:[{domain:'restaurant',sourceId:'restaurant_menu_live',status:'ok'}],
      actionProposed:false,
      statePersisted:true,
      stateConflictRetries:1,
      timingsMs:{semantic:11,dialogAndKnowledge:7,stateRead:3,stateWrite:2,total:25},
    },
  };
}

function response():ComposedResponse{
  return {
    message:'ข้อความลูกค้าที่ห้ามเข้า trace',
    mode:'model',
    usedFactKeys:['menu:m1:name','contact:someone@example.com'],
    composerVersion:'response-composer-v1',
    bibleVersion:'bible-v1',
    channel:'line',
    language:'th',
  };
}

test('Phase J trace version is explicit',()=>{
  assert.equal(ONE_MIND_TRACE_VERSION,'one-mind-trace-v1');
});

test('safe envelope contains machine metadata but never identity ids or response/customer text',()=>{
  const envelope=buildOneMindTraceEnvelope({
    turn:turn(),
    response:response(),
    composerMs:5,
    totalMs:31,
    at:NOW,
  });
  const json=JSON.stringify(envelope);
  assert.match(json,/menu_recommendation/);
  assert.match(json,/restaurant_menu_live/);
  assert.match(json,/state/);
  assert.doesNotMatch(json,/SENSITIVE-LINE-USER-KEY/);
  assert.doesNotMatch(json,/11111111-1111-4111-8111-111111111111/);
  assert.doesNotMatch(json,/22222222-2222-4222-8222-222222222222/);
  assert.doesNotMatch(json,/ข้อความลูกค้าที่ห้ามเข้า trace/);
  assert.doesNotMatch(json,/someone@example\.com/);
  assert.match(json,/\[redacted\]/);
});

test('trace records safe stage timings and CAS retry count',()=>{
  const envelope=buildOneMindTraceEnvelope({turn:turn(),response:response(),composerMs:5,totalMs:31,at:NOW});
  assert.deepEqual(envelope.timingsMs,{
    semantic:11,dialogAndKnowledge:7,stateRead:3,stateWrite:2,composer:5,total:31,
  });
  assert.equal(envelope.state.conflictRetries,1);
  assert.equal(envelope.state.persisted,true);
});

test('transaction metadata appears only from an explicit operational outcome',()=>{
  const noOutcome=buildOneMindTraceEnvelope({turn:turn(),response:response(),at:NOW});
  assert.equal(noOutcome.transaction,null);

  const withOutcome=buildOneMindTraceEnvelope({
    turn:turn(),response:response(),at:NOW,
    operationalOutcome:{executed:true,success:true,status:'requested',referenceCode:'BK123',duplicate:false},
  });
  assert.deepEqual(withOutcome.transaction,{
    executed:true,success:true,status:'requested',referenceCode:'BK123',duplicate:false,
  });
});

test('trace emitter is non-blocking even if console logging itself throws',()=>{
  const original=console.log;
  try{
    console.log=()=>{throw new Error('logger_down');};
    assert.doesNotThrow(()=>emitOneMindTrace(buildOneMindTraceEnvelope({turn:turn(),response:response(),at:NOW})));
  }finally{
    console.log=original;
  }
});
