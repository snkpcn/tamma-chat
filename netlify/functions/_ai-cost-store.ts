import { backendFetch } from './_backend-fetch';
import { CUSTOMER_TURN_BUDGET_MS } from './_customer-turn-budget';

/** Result of trying to claim a turn before doing any work.
 *  'claimed'            -- first delivery, proceed.
 *  'stale_reclaimed'    -- a previous attempt claimed it and never finished
 *                          within the in-flight window, so take it over.
 *  'duplicate_skipped'  -- a live attempt owns this turn, do nothing.
 *  'claim_failed_open'  -- the claim could not be decided; proceed anyway. */
export type TurnClaimOutcome =
  | 'claimed' | 'stale_reclaimed' | 'duplicate_skipped' | 'claim_failed_open';

/** Deliberately shorter than BACKEND_TIMEOUT_MS. Dedupe sits on the customer
 *  reply path, so it may add at most ~1s to a turn that is already racing the
 *  function timeout. A slow claim fails OPEN rather than delaying the reply. */
export const TURN_CLAIM_TIMEOUT_MS = 1_000;

/** Longest a claim may stay 'in_progress' before another delivery may take
 *  it over. DERIVED from the turn budget rather than hand-picked.
 *
 *  Two bounds have to hold at once:
 *
 *   - ABOVE the longest a LIVE turn can hold its claim, or a slow-but-alive
 *     attempt gets stolen and answers twice. The claim is taken inside the
 *     turn budget (the clock starts before it), so that maximum is
 *     CUSTOMER_TURN_BUDGET_MS.
 *   - AT OR BELOW the point where a killed turn's redelivery arrives, or
 *     dedupe refuses the retry and converts a timeout into permanent
 *     silence -- worse than the duplicate it prevents.
 *
 *  A hand-picked 12s violated the second bound: review found a dead zone
 *  between the ~10s function kill and 12s, where a redelivery was refused
 *  and the customer got nothing at all. Deriving it keeps the two bounds
 *  consistent if the budget ever moves. */
export const TURN_CLAIM_STALE_MS = CUSTOMER_TURN_BUDGET_MS + 1_000;

async function runCustomerTurnClaim(
  row:{ conversationId:string|null; eventId:string; channel:string; environment:'live'|'test' },
  now:Date,
):Promise<TurnClaimOutcome> {
  const c=config();
  // Unconfigured storage cannot decide ownership. Never silently drop a
  // customer message because observability is not wired up.
  if (!c) return 'claim_failed_open';

  const headers={
    apikey:c.key,Authorization:'Bearer '+c.key,
    'Content-Type':'application/json',
  };
  const eventId=row.eventId.slice(0,180);

  // ignore-duplicates + return=representation: an inserted row comes back,
  // a conflicting one yields an empty array. One round trip in the common
  // (first-delivery) case.
  const inserted=await backendFetch(
    c.url+'/rest/v1/customer_turn_outcomes?on_conflict=channel,event_id,environment',
    {
      method:'POST',
      headers:{...headers,Prefer:'resolution=ignore-duplicates,return=representation'},
      body:JSON.stringify({
        conversation_id:row.conversationId?.slice(0,180) ?? null,
        event_id:eventId,channel:row.channel,
        outcome:'in_progress',error_type:null,duration_ms:0,
        environment:row.environment,claimed_at:now.toISOString(),
      }),
    },
    TURN_CLAIM_TIMEOUT_MS,
  );
  if(!inserted.ok) throw new Error('turn claim insert '+inserted.status);
  const insertedRows=await inserted.json() as unknown[];
  if(Array.isArray(insertedRows) && insertedRows.length>0) return 'claimed';

  // The row exists. Only take it over if it is an abandoned claim; a
  // terminal row or a live in-flight claim is a duplicate delivery.
  const staleBefore=new Date(now.getTime()-TURN_CLAIM_STALE_MS).toISOString();
  const query=new URLSearchParams({
    channel:'eq.'+row.channel,
    event_id:'eq.'+eventId,
    environment:'eq.'+row.environment,
    outcome:'eq.in_progress',
    claimed_at:'lt.'+staleBefore,
  });
  const reclaimed=await backendFetch(
    c.url+'/rest/v1/customer_turn_outcomes?'+query.toString(),
    {
      method:'PATCH',
      headers:{...headers,Prefer:'return=representation'},
      body:JSON.stringify({claimed_at:now.toISOString()}),
    },
    TURN_CLAIM_TIMEOUT_MS,
  );
  if(!reclaimed.ok) throw new Error('turn claim takeover '+reclaimed.status);
  const reclaimedRows=await reclaimed.json() as unknown[];
  return Array.isArray(reclaimedRows) && reclaimedRows.length>0
    ? 'stale_reclaimed'
    : 'duplicate_skipped';
}

/**
 * Claim one customer turn before any work happens, so a redelivered webhook
 * cannot answer, charge or write twice.
 *
 * FAILS OPEN by contract: any error, timeout or unconfigured store resolves
 * to 'claim_failed_open' and the caller proceeds. A duplicate reply is a
 * worse-but-recoverable outcome; silently dropping a real customer message
 * is not. The paid path keeps its own independent guards (the cost ledger
 * replays a completed call for the same event and blocks a duplicate
 * in-flight one), so failing open here does not double-charge.
 *
 * Logs one metric per attempt. No customer text is recorded -- only the
 * opaque transport event id needed to correlate the turn.
 */
export async function claimCustomerTurn(row:{
  conversationId:string|null;eventId:string;channel:string;environment?:'live'|'test';
},now:Date = new Date()):Promise<TurnClaimOutcome> {
  const startedAt=Date.now();
  const environment=row.environment ?? 'live';
  let outcome:TurnClaimOutcome;
  try {
    outcome=await runCustomerTurnClaim({...row,environment},now);
  } catch {
    outcome='claim_failed_open';
  }
  console.log('THONGTHAI_TURN_CLAIM',JSON.stringify({
    outcome,
    channel:row.channel,
    event_id:row.eventId.slice(0,180),
    environment,
    latency_ms:Date.now()-startedAt,
  }));
  return outcome;
}

export async function persistCustomerTurnOutcome(row:{
  conversationId:string|null;eventId:string;channel:string;
  outcome:'completed'|'failed';errorType:string|null;durationMs:number;
  environment?:'live'|'test';
}):Promise<void> {
  const c=config();
  if (!c) return;
  try {
    const response = await backendFetch(c.url+'/rest/v1/customer_turn_outcomes?on_conflict=channel,event_id,environment',{
      method:'POST',headers:{apikey:c.key,Authorization:'Bearer '+c.key,
        'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=minimal'},
      body:JSON.stringify({conversation_id:row.conversationId?.slice(0,180) ?? null,
        event_id:row.eventId.slice(0,180),channel:row.channel,
        outcome:row.outcome,error_type:row.errorType?.slice(0,80) ?? null,
        duration_ms:Math.max(0,Math.floor(row.durationMs)),environment:row.environment ?? 'live'}),
    },1000);
    if(!response.ok) console.error('CUSTOMER_TURN_OUTCOME_PERSIST_ERROR',response.status);
  } catch {
    console.error('CUSTOMER_TURN_OUTCOME_PERSIST_ERROR','unavailable');
  }
}

export type PersistedAiCallCost = {
  provider?:'openai'|'tavily';
  conversationId:string;
  eventId:string;
  channel:string;
  model:string;
  callPurpose:string;
  inputTokens:number;
  cachedInputTokens:number;
  outputTokens:number;
  costUsd:number;
  costThb:number;
  callIndexTurn:number;
  callIndexConversation:number;
  status:'completed'|'failed';
  latencyMs:number;
  certificationMode?:boolean;
  occurredAt:string;
};

export type PersistedAiResponseTurn = {
  conversationId:string;
  eventId:string;
  channel:string;
  finalResponseSource:string;
  modelReplyUsed:boolean;
  groundedKnowledgeSupplied:boolean;
  zeroCostTurn:boolean;
  environment?:'live'|'test';
  occurredAt:string;
};

function config():{url:string;key:string}|null{
  const url=process.env.SUPABASE_URL;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url&&key?{url:url.replace(/\/$/,''),key}:null;
}

const POST_TIMEOUT_MS=2500;
const POST_ATTEMPTS=2;
const POST_RETRY_DELAY_MS=120;

function sleep(ms:number):Promise<void>{
  return new Promise(resolve=>setTimeout(resolve,ms));
}

async function postWithPreference(
  table:string,
  onConflict:string,
  payload:Record<string,unknown>,
  prefer:string,
):Promise<void>{
  const c=config();
  if(!c)return;

  let lastError:unknown=null;
  // Response diagnostics must not add a five-second retry loop after a
  // successful answer. Paid-call accounting keeps its existing retries.
  const timeoutMs=table==='ai_response_turns'?1000:POST_TIMEOUT_MS;
  for(let attempt=0;attempt<POST_ATTEMPTS;attempt+=1){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const r=await fetch(
        `${c.url}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`,
        {
          method:'POST',
          signal:controller.signal,
          headers:{
            apikey:c.key,
            Authorization:`Bearer ${c.key}`,
            'Content-Type':'application/json',
            Prefer:prefer,
          },
          body:JSON.stringify(payload),
        },
      );
      if(!r.ok){
        const body=await r.text().catch(()=>'');
        throw new Error(`AI cost store ${table} failed ${r.status}: ${body.slice(0,180)}`);
      }
      return;
    }catch(error){
      lastError=error;
      if(attempt+1<POST_ATTEMPTS)await sleep(POST_RETRY_DELAY_MS);
    }finally{
      clearTimeout(timer);
    }
  }

  if(lastError instanceof Error)throw lastError;
  throw new Error(`AI cost store ${table} failed after retry`);
}

async function post(table:string,onConflict:string,payload:Record<string,unknown>):Promise<void>{
  await postWithPreference(
    table,
    onConflict,
    payload,
    'resolution=merge-duplicates,return=minimal',
  );
}

async function postIfAbsent(table:string,onConflict:string,payload:Record<string,unknown>):Promise<void>{
  await postWithPreference(
    table,
    onConflict,
    payload,
    'resolution=ignore-duplicates,return=minimal',
  );
}

/**
 * Best-effort historical cost persistence. The customer response must never
 * fail because observability storage is unavailable; callers intentionally
 * catch this function. No prompt, model output, transcript, contact, or key
 * is written here.
 */
export async function persistAiCallCost(row:PersistedAiCallCost):Promise<void>{
  await post('ai_api_cost_events','conversation_id,event_id,call_index_turn',{
    conversation_id:row.conversationId.slice(0,180),
    event_id:row.eventId.slice(0,180),
    channel:row.channel.slice(0,40)||'unknown',
    provider:row.provider ?? 'openai',
    model:row.model.slice(0,120),
    call_purpose:row.callPurpose.slice(0,120),
    input_tokens:Math.max(0,Math.floor(row.inputTokens||0)),
    cached_input_tokens:Math.max(0,Math.floor(row.cachedInputTokens||0)),
    output_tokens:Math.max(0,Math.floor(row.outputTokens||0)),
    cost_usd:Math.max(0,row.costUsd||0),
    cost_thb:Math.max(0,row.costThb||0),
    call_index_turn:Math.max(1,Math.floor(row.callIndexTurn||1)),
    call_index_conversation:Math.max(1,Math.floor(row.callIndexConversation||1)),
    status:row.status,
    latency_ms:Math.max(0,Math.floor(row.latencyMs||0)),
    environment:row.certificationMode?'certification':'live',
    occurred_at:row.occurredAt,
  });
}

export async function persistAiResponseTurn(row:PersistedAiResponseTurn):Promise<void>{
  // Emit provenance even if the telemetry database is unavailable.
  console.log('THONGTHAI_RESPONSE_SOURCE', JSON.stringify({
    event_id:row.eventId, channel:row.channel,
    source:row.finalResponseSource, model_reply_used:row.modelReplyUsed,
    grounded_knowledge_supplied:row.groundedKnowledgeSupplied,
    zero_cost_turn:row.zeroCostTurn,
  }));
  await post('ai_response_turns','conversation_id,event_id',{
    conversation_id:row.conversationId.slice(0,180),
    event_id:row.eventId.slice(0,180),
    channel:row.channel.slice(0,40)||'unknown',
    final_response_source:row.finalResponseSource.slice(0,80)||'unknown',
    model_reply_used:Boolean(row.modelReplyUsed),
    grounded_knowledge_supplied:Boolean(row.groundedKnowledgeSupplied),
    zero_cost_turn:Boolean(row.zeroCostTurn),
    environment:row.environment==='test'?'test':'live',
    occurred_at:row.occurredAt,
  });
}

/**
 * Last-mile observability fallback for successful customer replies that did
 * not pass through One-Mind's composer (for example legacy transaction
 * execution and deterministic fast paths). The canonical One-Mind path
 * writes the richer row first; ignore-duplicates preserves that richer row
 * instead of overwriting it.
 *
 * zeroCostTurn may conservatively be false here. The idle notifier joins
 * response turns with the actual ai_api_cost_events ledger and proves a
 * zero-cost turn when the event has no paid call.
 */
export async function persistAiResponseTurnIfAbsent(row:PersistedAiResponseTurn):Promise<void>{
  await postIfAbsent('ai_response_turns','conversation_id,event_id',{
    conversation_id:row.conversationId.slice(0,180),
    event_id:row.eventId.slice(0,180),
    channel:row.channel.slice(0,40)||'unknown',
    final_response_source:row.finalResponseSource.slice(0,80)||'unknown',
    model_reply_used:Boolean(row.modelReplyUsed),
    grounded_knowledge_supplied:Boolean(row.groundedKnowledgeSupplied),
    zero_cost_turn:Boolean(row.zeroCostTurn),
    environment:row.environment==='test'?'test':'live',
    occurred_at:row.occurredAt,
  });
}

/** Interpretation can precede a zero-model fact renderer. Mark the final
 * turn as paid without replacing its actual response source/fact provenance. */
export async function markAiResponseTurnInterpreted(row:{conversationId:string;eventId:string;channel:string;environment?:'live'|'test'}):Promise<void> {
  console.log('THONGTHAI_RESPONSE_SOURCE_ADJUSTMENT',JSON.stringify({event_id:row.eventId,channel:row.channel,zero_cost_turn:false,reason:'visitor_semantic_interpretation'}));
  const c=config();if(!c)return;
  const query=new URLSearchParams({conversation_id:'eq.'+row.conversationId,event_id:'eq.'+row.eventId,channel:'eq.'+row.channel});
  try {
    const response=await backendFetch(c.url+'/rest/v1/ai_response_turns?'+query.toString(),{
      method:'PATCH',headers:{apikey:c.key,Authorization:'Bearer '+c.key,'Content-Type':'application/json',Prefer:'return=minimal'},
      body:JSON.stringify({zero_cost_turn:false}),
    },1000);
    if(!response.ok)console.error('AI_RESPONSE_TURN_INTERPRETATION_MARK_ERROR',response.status);
  } catch {console.error('AI_RESPONSE_TURN_INTERPRETATION_MARK_ERROR','unavailable');}
}
