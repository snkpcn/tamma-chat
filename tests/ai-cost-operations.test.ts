import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { persistAiCallCost, persistAiResponseTurn } from '../netlify/functions/_ai-cost-store';
import { buildAiCostPersonLines } from '../netlify/functions/_ai-cost-notifier';
import { handler as idleHandler } from '../netlify/functions/ai-cost-notify-idle';
import { handler as dailyHandler } from '../netlify/functions/ai-cost-notify-daily';
import { handleLineOpsGroupMessage, sendAiCostLineNotification } from '../netlify/functions/_ops-notifications';
import { withHarness } from './helpers/canonical-core-harness';

const originalFetch=globalThis.fetch;
const originalUrl=process.env.SUPABASE_URL;
const originalKey=process.env.SUPABASE_SERVICE_ROLE_KEY;

function restore(){
  globalThis.fetch=originalFetch;
  if(originalUrl===undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL=originalUrl;
  if(originalKey===undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY=originalKey;
}

test('AI cost store persists provider usage only, never prompts/transcripts/secrets', async()=>{
  const seen:Array<{url:string;body:any}>=[];
  process.env.SUPABASE_URL='https://example.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY='fake-service-role';
  globalThis.fetch=(async(input:any,init:any)=>{
    seen.push({url:String(input),body:JSON.parse(String(init?.body||'{}'))});
    return new Response('',{status:201});
  }) as typeof fetch;
  try{
    await persistAiCallCost({
      conversationId:'conv-1',eventId:'evt-1',channel:'line',model:'gpt-5.6-terra',
      callPurpose:'semantic-interpreter',inputTokens:1200,cachedInputTokens:400,outputTokens:90,
      costUsd:0.0042,costThb:0.1512,callIndexTurn:1,callIndexConversation:2,
      status:'completed',latencyMs:812,occurredAt:'2026-09-29T00:00:00.000Z',
    });
    await persistAiResponseTurn({
      conversationId:'conv-1',eventId:'evt-1',channel:'line',
      finalResponseSource:'openai_direct_response',modelReplyUsed:true,
      groundedKnowledgeSupplied:false,zeroCostTurn:false,environment:'live',
      occurredAt:'2026-09-29T00:00:00.100Z',
    });
  }finally{restore()}
  assert.equal(seen.length,2);
  assert.match(seen[0]!.url,/ai_api_cost_events/);
  assert.equal(seen[0]!.body.input_tokens,1200);
  assert.equal(seen[0]!.body.cached_input_tokens,400);
  assert.equal(seen[0]!.body.output_tokens,90);
  assert.equal(seen[0]!.body.latency_ms,812);
  assert.equal(seen[0]!.body.cost_thb,0.1512);
  assert.match(seen[1]!.url,/ai_response_turns/);
  const serialized=JSON.stringify(seen);
  assert.doesNotMatch(serialized,/OPENAI_API_KEY|prompt|transcript|semanticOutput|customer_message/i);
});

test('AI cost scheduled notification handlers expose missing config instead of reporting success', async()=>{
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try{
    const idle=await idleHandler({} as any,{} as any);
    const daily=await dailyHandler({} as any,{} as any);
    assert.equal((idle as any).statusCode,200);
    assert.equal((daily as any).statusCode,500);
  }finally{restore()}
});

test('daily AI cost breakdown reports stable per-person THB totals without exposing conversation UUIDs',()=>{
  const personA='f83b8a2d-3123-452d-9a19-88d8f54b7c01';
  const personB='167a3909-d117-479b-a45e-9fca11d27492';
  const lines=buildAiCostPersonLines(
    [
      {conversation_id:personA,cost_thb:0.2},
      {conversation_id:personA,cost_thb:0.15},
      {conversation_id:personB,cost_thb:0.5},
    ],
    [
      {conversation_id:personA,cost_thb:0.15},
      {conversation_id:personB,cost_thb:0.5},
    ],
    [personA,personB],
    new Map([[personA,'คุณสมชาย']]),
  );
  assert.deepEqual(lines,[
    '• บุคคล D27492 — เดือนนี้ 0.50 บาท · เมื่อวาน 0.50 บาท',
    '• คุณสมชาย · 4B7C01 — เดือนนี้ 0.35 บาท · เมื่อวาน 0.15 บาท',
  ]);
  assert.doesNotMatch(lines.join('\n'),/f83b8a2d|167a3909/i);
});

test('AI cost migration is RLS-protected and LINE binding is dedicated',()=>{
  const migration=readFileSync('supabase/migrations/20260929003000_ai_api_cost_observability_v1.sql','utf8');
  assert.match(migration,/alter table public\.ai_api_cost_events enable row level security/i);
  assert.match(migration,/alter table public\.ai_response_turns enable row level security/i);
  assert.match(migration,/revoke all on table public\.ai_api_cost_events from public, anon, authenticated, service_role/i);
  assert.match(migration,/grant select, insert, update on table public\.ai_api_cost_events to service_role/i);
  assert.doesNotMatch(migration,/raw_(?:prompt|transcript)|api_key|model_output/i);

  const ops=readFileSync('netlify/functions/_ops-notifications.ts','utf8');
  assert.match(ops,/owner_general' \| 'ai_cost'/);
  assert.match(ops,/teamCode:'ai_cost'/);
  assert.match(ops,/ผูกกลุ่มนี้กับค่าใช้จ่าย AI \/ API แล้วครับ/u);

  const toml=readFileSync('netlify.toml','utf8');
  assert.doesNotMatch(toml,/\[functions\."ai-cost-notify-idle"\]/);
  assert.match(toml,/\[functions\."ai-cost-notify-daily"\]/);
  assert.match(toml,/schedule = "5 17 \* \* \*"/);
});


test('dedicated AI cost LINE group binds and receives through the existing encrypted ops channel path', async()=>{
  await withHarness(async harness=>{
    const reply=await handleLineOpsGroupMessage({
      targetType:'group',
      targetId:'ai-cost-group-1',
      userId:'owner-1',
      text:'ผูกทีม ai cost',
    });
    assert.match(reply??'',/ผูกกลุ่มนี้กับค่าใช้จ่าย AI \/ API แล้วครับ/u);
    const bindings=harness.postsTo('ops_notification_channels');
    assert.equal(bindings.at(-1)?.team_code,'ai_cost');
    assert.equal(bindings.at(-1)?.service_type,null);

    const status=await sendAiCostLineNotification({
      idempotencyKey:'ai-cost-test:conversation-1',
      deliveryType:'ai_cost_conversation',
      text:'AI cost test only',
      payload:{cost_thb:0.25},
    });
    assert.equal(status,'sent');
    const deliveries=harness.notificationDeliveries();
    assert.equal(deliveries.at(-1)?.teamCode,'ai_cost');
    assert.equal(deliveries.at(-1)?.status,'sent');
  });
});

test('AI cost LINE group can request the latest live conversation summary immediately', async()=>{
  await withHarness(async harness=>{
    harness.programOpsChannel('ai_cost','ai-cost-group-1');
    harness.programAiCostRows([
      {
        conversation_id:'conv-old',event_id:'evt-old',channel:'line',model:'gpt-5.6-terra',
        call_purpose:'semantic-interpreter',input_tokens:100,cached_input_tokens:0,
        output_tokens:20,cost_thb:0.1,latency_ms:100,occurred_at:'2026-09-28T00:00:00.000Z',
      },
      {
        conversation_id:'conv-live-15-calls',event_id:'evt-1',channel:'line',model:'gpt-5.6-sol',
        call_purpose:'grounded-response-composition',input_tokens:28499,cached_input_tokens:0,
        output_tokens:2266,cost_thb:3.0308,latency_ms:812,occurred_at:'2026-09-29T01:00:00.000Z',
      },
    ],[
      {
        conversation_id:'conv-live-15-calls',model_reply_used:true,grounded_knowledge_supplied:true,
        zero_cost_turn:false,final_response_source:'openai_grounded_response',
        occurred_at:'2026-09-29T01:00:01.000Z',
      },
      {
        conversation_id:'conv-live-15-calls',model_reply_used:false,grounded_knowledge_supplied:true,
        zero_cost_turn:false,final_response_source:'grounded_deterministic_fallback',
        occurred_at:'2026-09-29T01:00:02.000Z',
      },
    ]);

    const reply=await handleLineOpsGroupMessage({
      targetType:'group',
      targetId:'ai-cost-group-1',
      userId:'owner-1',
      text:'สรุปค่า AI ล่าสุด',
    });

    assert.match(reply??'',/สรุปค่า AI ล่าสุด/u);
    assert.match(reply??'',/conv-live-15-calls/u);
    assert.match(reply??'',/OpenAI calls: 1/u);
    assert.match(reply??'',/Input: 28,499 tokens/u);
    assert.match(reply??'',/Output: 2,266 tokens/u);
    assert.match(reply??'',/Total: 3\.0308 THB/u);
    assert.match(reply??'',/Model reply utilization: 1\/2/u);
    assert.match(reply??'',/Discarded\/overridden: 1/u);
  });
});

// Cost checkpoint live certification is exercised by the PR's existing real-provider workflow.
