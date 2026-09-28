import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { persistAiCallCost, persistAiResponseTurn } from '../netlify/functions/_ai-cost-store';
import { handler as idleHandler } from '../netlify/functions/ai-cost-notify-idle';
import { handler as dailyHandler } from '../netlify/functions/ai-cost-notify-daily';

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

test('AI cost scheduled notification handlers never fail customer infrastructure when unconfigured', async()=>{
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try{
    const idle=await idleHandler({} as any,{} as any);
    const daily=await dailyHandler({} as any,{} as any);
    assert.equal(idle.statusCode,200);
    assert.equal(daily.statusCode,200);
  }finally{restore()}
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
  assert.match(toml,/\[functions\."ai-cost-notify-idle"\]/);
  assert.match(toml,/schedule = "\*\/15 \* \* \* \*"/);
  assert.match(toml,/\[functions\."ai-cost-notify-daily"\]/);
  assert.match(toml,/schedule = "5 17 \* \* \*"/);
});
