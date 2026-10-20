import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import {
  ONE_MIND_TRACE_VERSION,
  buildOneMindTraceEnvelope,
  emitOneMindTrace,
  persistOneMindTrace,
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

/** A legacy_required turn: task state deliberately not written, transcript
 *  written. `contextPersisted` undefined models a path that does not
 *  distinguish the two (and every trace written before the field existed). */
function legacyTurn(contextPersisted:boolean|undefined):OneMindTurnResult{
  const base=turn();
  return {...base,trace:{...base.trace,statePersisted:false,contextPersisted}};
}

test('the envelope carries contextPersisted separately from task-state persistence',()=>{
  const kept=buildOneMindTraceEnvelope({turn:legacyTurn(true),at:NOW});
  assert.equal(kept.state.persisted,false,'no task state was written');
  assert.equal(kept.state.contextPersisted,true,'but the transcript was');

  assert.equal(buildOneMindTraceEnvelope({turn:legacyTurn(false),at:NOW}).state.contextPersisted,false);
  // Never guessed from statePersisted when the path does not say.
  assert.equal(buildOneMindTraceEnvelope({turn:legacyTurn(undefined),at:NOW}).state.contextPersisted,null);
  assert.equal(buildOneMindTraceEnvelope({turn:turn(),at:NOW}).state.contextPersisted,null);
});

test('contextPersisted reaches the customer-turn monitor through the real persisted row',async()=>{
  // Captures the exact row persistOneMindTrace sends, inserts it into a
  // database migrated up to the new view, and reads it back from the monitor.
  const sql=(path:string)=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
  const db=new PGlite();
  const keys=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'] as const;
  const before=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  const originalFetch=global.fetch;
  const rows:Array<Record<string,unknown>>=[];
  process.env.SUPABASE_URL='https://trace.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY='test';
  global.fetch=(async(_input:RequestInfo|URL,init?:RequestInit)=>{
    rows.push(JSON.parse(String(init?.body)));
    return new Response(null,{status:201});
  }) as typeof fetch;
  try{
    const observedAt=new Date();
    for(const [eventId,contextPersisted] of [['kept',true],['lost',false],['unknown',undefined]] as const){
      const base=legacyTurn(contextPersisted);
      const envelope=buildOneMindTraceEnvelope({turn:{...base,trace:{...base.trace,eventId}},at:observedAt});
      assert.equal(await persistOneMindTrace(envelope),true);
    }

    await db.exec('create role anon; create role authenticated; create role service_role;');
    await db.exec(sql('supabase/migrations/20260929003000_ai_api_cost_observability_v1.sql').split('alter table public.ops_notification_channels')[0]);
    await db.exec(sql('netlify/functions/supabase/one-mind-observability-v1.sql'));
    await db.exec(sql('supabase/migrations/20261009090000_customer_turn_monitor_v1.sql'));
    await db.exec(sql('supabase/migrations/20261020120000_customer_turn_claim_v1.sql'));
    await db.exec(sql('supabase/migrations/20261020130000_customer_turn_monitor_context_persisted.sql'));
    for(const row of rows){
      await db.query(
        `insert into one_mind_traces (trace_id,channel,domain,intent,action,dialog_mode,degradation_condition,envelope,observed_at,expires_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [row.trace_id,row.channel,row.domain,row.intent,row.action,row.dialog_mode,row.degradation_condition,
          JSON.stringify(row.envelope),row.observed_at,row.expires_at],
      );
      await db.query(
        `insert into customer_turn_outcomes (channel,event_id,conversation_id,outcome,duration_ms) values ($1,$2,'c','completed',100)`,
        [row.channel,row.trace_id],
      );
    }
    const {rows:monitor}=await db.query<{event_id:string;state_persisted:unknown;context_persisted:unknown}>(
      'select event_id,state_persisted,context_persisted from thongthai_customer_turn_monitor order by event_id',
    );
    assert.deepEqual(monitor.map(row=>[row.event_id,row.state_persisted,row.context_persisted]),[
      ['kept',false,true],
      ['lost',false,false],
      ['unknown',false,null],
    ]);
  }finally{
    global.fetch=originalFetch;
    for(const key of keys){
      if(before[key]===undefined) delete process.env[key];
      else process.env[key]=before[key];
    }
    await db.close();
  }
});
