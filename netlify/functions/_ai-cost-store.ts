export type PersistedAiCallCost = {
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

async function post(table:string,onConflict:string,payload:Record<string,unknown>):Promise<void>{
  const c=config();
  if(!c)return;
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),900);
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
          Prefer:'resolution=merge-duplicates,return=minimal',
        },
        body:JSON.stringify(payload),
      },
    );
    if(!r.ok){
      const body=await r.text().catch(()=>'');
      throw new Error(`AI cost store ${table} failed ${r.status}: ${body.slice(0,180)}`);
    }
  }finally{
    clearTimeout(timer);
  }
}

async function postIfAbsent(table:string,onConflict:string,payload:Record<string,unknown>):Promise<void>{
  const c=config();
  if(!c)return;
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),900);
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
          Prefer:'resolution=ignore-duplicates,return=minimal',
        },
        body:JSON.stringify(payload),
      },
    );
    if(!r.ok){
      const body=await r.text().catch(()=>'');
      throw new Error(`AI cost store ${table} failed ${r.status}: ${body.slice(0,180)}`);
    }
  }finally{
    clearTimeout(timer);
  }
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
    provider:'openai',
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
