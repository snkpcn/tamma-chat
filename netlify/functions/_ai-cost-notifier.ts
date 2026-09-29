import { sendAiCostLineNotification } from './_ops-notifications';
import { aiCostPolicy } from './_ai-cost-policy';

type CostRow={
  conversation_id:string;event_id:string;channel:string;model:string;call_purpose:string;
  input_tokens:number;cached_input_tokens:number;output_tokens:number;cost_thb:number|string;
  call_index_conversation:number;occurred_at:string;
};
type TurnRow={
  conversation_id:string;model_reply_used:boolean;grounded_knowledge_supplied:boolean;
  zero_cost_turn:boolean;occurred_at:string;
};

function cfg():{url:string;key:string}|null{
  const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url&&key?{url:url.replace(/\/$/,''),key}:null;
}
async function get<T>(path:string):Promise<T[]>{
  const c=cfg();if(!c)return[];
  const r=await fetch(`${c.url}/rest/v1/${path}`,{headers:{apikey:c.key,Authorization:`Bearer ${c.key}`}});
  if(!r.ok)throw new Error(`AI cost notification query failed ${r.status}`);
  return await r.json() as T[];
}
function enc(v:string){return encodeURIComponent(v)}
function n(v:unknown){const x=Number(v);return Number.isFinite(x)?x:0}
function baht(v:number){return v.toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:4})}
function localDate(now=new Date()){
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
}
function shiftDate(d:string,days:number){
  const [y,m,day]=d.split('-').map(Number),x=new Date(Date.UTC(y,m-1,day+days));
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth()+1).padStart(2,'0')}-${String(x.getUTCDate()).padStart(2,'0')}`;
}
function nextDate(d:string){return shiftDate(d,1)}
function previousDate(d:string){return shiftDate(d,-1)}
function dayBounds(d:string){
  return {
    start:new Date(`${d}T00:00:00+07:00`).toISOString(),
    end:new Date(`${nextDate(d)}T00:00:00+07:00`).toISOString(),
  };
}
function latestLedgerSession(rows:CostRow[]):CostRow[]{
  if(!rows.length)return[];
  const ordered=[...rows].sort((a,b)=>a.occurred_at.localeCompare(b.occurred_at));
  const ledgerIdleMs=aiCostPolicy().conversationIdleMs;
  let start=0;
  for(let i=1;i<ordered.length;i+=1){
    const previous=ordered[i-1]!,current=ordered[i]!;
    const previousIndex=n(previous.call_index_conversation),currentIndex=n(current.call_index_conversation);
    const previousAt=Date.parse(previous.occurred_at),currentAt=Date.parse(current.occurred_at);
    const indexReset=previousIndex>0&&currentIndex>0&&currentIndex<=previousIndex;
    const idleReset=Number.isFinite(previousAt)&&Number.isFinite(currentAt)&&currentAt-previousAt>=ledgerIdleMs;
    if(indexReset||idleReset)start=i;
  }
  return ordered.slice(start);
}

function summarize(rows:CostRow[],turns:TurnRow[]){
  const conversations=new Set(rows.map(x=>x.conversation_id));
  return {
    conversations:conversations.size,
    calls:rows.length,
    input:rows.reduce((s,x)=>s+n(x.input_tokens),0),
    cached:rows.reduce((s,x)=>s+n(x.cached_input_tokens),0),
    output:rows.reduce((s,x)=>s+n(x.output_tokens),0),
    cost:rows.reduce((s,x)=>s+n(x.cost_thb),0),
    direct:turns.filter(x=>x.model_reply_used).length,
    grounded:turns.filter(x=>x.model_reply_used&&x.grounded_knowledge_supplied).length,
    zero:turns.filter(x=>x.zero_cost_turn).length,
  };
}

export async function sendIdleAiCostConversationSummaries(now=new Date()){
  // Look back far enough that a temporarily unavailable scheduled invocation
  // does not permanently lose a conversation summary. Delivery idempotency
  // prevents repeat sends; actual idleness is checked against BOTH model
  // calls and final customer-response turns below.
  const oldest=new Date(now.getTime()-24*60*60_000).toISOString();
  const newest=new Date(now.getTime()-10*60_000).toISOString();
  const rows=await get<CostRow>(
    'ai_api_cost_events?environment=eq.live&occurred_at=gte.'+enc(oldest)
    +'&occurred_at=lte.'+enc(newest)
    +'&select=conversation_id,event_id,channel,model,call_purpose,input_tokens,cached_input_tokens,output_tokens,cost_thb,call_index_conversation,occurred_at'
    +'&order=occurred_at.asc&limit=2000',
  );
  const byConversation=new Map<string,CostRow[]>();
  for(const row of rows){
    const list=byConversation.get(row.conversation_id)??[];list.push(row);byConversation.set(row.conversation_id,list);
  }
  const results:Array<{conversationId:string;status:string;costThb:number}>=[];
  for(const [conversationId,allCalls] of byConversation){
    // conversation_id is a stable customer/thread identifier, not a unique
    // AI-cost ledger session. The ledger intentionally resets its call index
    // after its idle window, so a 24h notifier scan can contain several
    // separate conversations for the same LINE user. Summarize only the
    // latest ledger session; otherwise old + new sessions are aggregated and
    // the old max call index can reuse a previous idempotency key forever.
    const calls=latestLedgerSession(allCalls);
    if(!calls.length)continue;
    const latest=calls[calls.length-1]!;
    // Only notify a conversation whose latest call is itself idle >=10 min.
    // If it resumed after our query window, a cheap existence lookup catches
    // that and skips this pass.
    const newer=await get<{id:string}>(
      'ai_api_cost_events?environment=eq.live&conversation_id=eq.'+enc(conversationId)
      +'&occurred_at=gt.'+enc(latest.occurred_at)+'&select=id&limit=1',
    );
    if(newer.length){
      console.log('AI_COST_IDLE_NOTIFY_SKIP',JSON.stringify({conversationId,reason:'newer_cost_event_pending'}));
      continue;
    }
    // Real production bug this closes: a long-lived, multi-session
    // conversation_id (the same customer testing across many hours/days) can
    // accumulate MANY turns. Fetching turns ascending with a bounded limit and
    // reading the LAST array entry silently returns the OLDEST turn within
    // that limit once the conversation exceeds it -- never the actual most
    // recent one -- which can make a genuinely idle conversation look
    // permanently "still active" (or the reverse) depending on where the
    // stale cutoff happens to land. Fetch only the single latest turn,
    // descending, directly.
    const turns=await get<TurnRow>(
      'ai_response_turns?environment=eq.live&conversation_id=eq.'+enc(conversationId)
      +'&select=conversation_id,model_reply_used,grounded_knowledge_supplied,zero_cost_turn,occurred_at&order=occurred_at.desc&limit=1',
    );
    const lastTurnAt=turns.length ? turns[0]!.occurred_at : latest.occurred_at;
    const lastActivityAt=lastTurnAt > latest.occurred_at ? lastTurnAt : latest.occurred_at;
    if(lastActivityAt>newest){
      console.log('AI_COST_IDLE_NOTIFY_SKIP',JSON.stringify({conversationId,reason:'recent_turn_activity',lastActivityAt}));
      continue;
    }
    const s=summarize(calls,turns);
    const models=[...new Set(calls.map(x=>x.model))].join(', ');
    const text=[
      '💰 Thongthai AI Cost',
      '',
      `Conversation: ${conversationId.slice(0,18)}…`,
      `Channel: ${latest.channel.toUpperCase()}`,
      `OpenAI calls: ${s.calls}`,
      models?`Model: ${models}`:'',
      '',
      `Input: ${s.input.toLocaleString('th-TH')} tokens`,
      `Cached: ${s.cached.toLocaleString('th-TH')} tokens`,
      `Output: ${s.output.toLocaleString('th-TH')} tokens`,
      '',
      `Cost: ${baht(s.cost)} THB`,
      `Direct AI replies: ${s.direct}`,
      `Grounded AI replies: ${s.grounded}`,
      `Zero-cost turns: ${s.zero}`,
    ].filter(Boolean).join('\n');
    const maxIndex=Math.max(...calls.map(x=>n(x.call_index_conversation)));
    const sessionStart=calls[0]!.occurred_at;
    const sessionEvent=calls[0]!.event_id || sessionStart;
    const status=await sendAiCostLineNotification({
      // call_index_conversation resets for every ledger session. It therefore
      // cannot be the sole idempotency discriminator for a stable LINE
      // conversation_id; two separate sessions can both end at index 22.
      idempotencyKey:`ai_cost_conversation:${conversationId}:${sessionEvent}:${maxIndex}`,
      deliveryType:'ai_cost_conversation',
      text,
      payload:{conversation_id:conversationId,cost_thb:s.cost,calls:s.calls,session_start_at:sessionStart,session_end_at:latest.occurred_at,max_call_index:maxIndex},
    });
    if(status==='not_bound'){
      // No error is thrown here (sendTeamMessage returns a status, not a
      // rejection), so a lost/never-configured LINE binding for the ai_cost
      // team would otherwise fail completely silently -- the cron still
      // reports 200 OK every 15 minutes forever. This is the one place that
      // fact becomes visible without a DB query.
      console.error('AI_COST_IDLE_NOTIFY_NOT_BOUND',JSON.stringify({conversationId,costThb:s.cost}));
    }
    results.push({conversationId,status,costThb:s.cost});
  }
  return results;
}

export async function sendDailyAiCostSummary(now=new Date()){
  // Scheduled just after midnight Bangkok and reports the FULL previous
  // local day, so the final minutes before midnight are not omitted.
  const date=previousDate(localDate(now)),b=dayBounds(date);
  const [rows,turns]=await Promise.all([
    get<CostRow>(
      'ai_api_cost_events?environment=eq.live&occurred_at=gte.'+enc(b.start)
      +'&occurred_at=lt.'+enc(b.end)
      +'&select=conversation_id,event_id,channel,model,call_purpose,input_tokens,cached_input_tokens,output_tokens,cost_thb,call_index_conversation,occurred_at'
      +'&order=occurred_at.asc&limit=5000',
    ),
    get<TurnRow>(
      'ai_response_turns?environment=eq.live&occurred_at=gte.'+enc(b.start)
      +'&occurred_at=lt.'+enc(b.end)
      +'&select=conversation_id,model_reply_used,grounded_knowledge_supplied,zero_cost_turn,occurred_at&limit=5000',
    ),
  ]);
  const s=summarize(rows,turns);
  const aiConversations=new Set(rows.map(x=>x.conversation_id)).size;
  const totalConversationIds=new Set(turns.map(x=>x.conversation_id));
  for(const x of rows)totalConversationIds.add(x.conversation_id);
  const avgAll=totalConversationIds.size?s.cost/totalConversationIds.size:0;
  const avgAi=aiConversations?s.cost/aiConversations:0;
  const perConv=new Map<string,number>();
  for(const row of rows)perConv.set(row.conversation_id,(perConv.get(row.conversation_id)??0)+n(row.cost_thb));
  const highest=[...perConv.entries()].sort((a,b)=>b[1]-a[1])[0];
  const text=[
    '📊 Thongthai AI — Daily Cost',
    date,
    '',
    `Conversations: ${totalConversationIds.size}`,
    `Used OpenAI: ${aiConversations}`,
    `OpenAI calls: ${s.calls}`,
    '',
    `Total cost: ${baht(s.cost)} THB`,
    `Avg / all conversations: ${baht(avgAll)} THB`,
    `Avg / AI conversations: ${baht(avgAi)} THB`,
    '',
    `Input: ${s.input.toLocaleString('th-TH')} tokens`,
    `Cached: ${s.cached.toLocaleString('th-TH')} tokens`,
    `Output: ${s.output.toLocaleString('th-TH')} tokens`,
    highest?`Highest-cost: ${highest[0].slice(0,18)}… — ${baht(highest[1])} THB`:'',
  ].filter(Boolean).join('\n');
  const status=await sendAiCostLineNotification({
    idempotencyKey:`ai_cost_daily:${date}`,
    deliveryType:'ai_cost_daily',
    text,
    payload:{local_date:date,cost_thb:s.cost,calls:s.calls,conversations:totalConversationIds.size},
  });
  return {date,status,costThb:s.cost,calls:s.calls,conversations:totalConversationIds.size};
}
