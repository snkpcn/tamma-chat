import { sendAiCostLineNotification } from './_ops-notifications';
import { aiCostPolicy } from './_ai-cost-policy';

const COST_REPORT_IDLE_MS=3*60_000;

type CostRow={
  conversation_id:string;event_id:string;channel:string;model:string;call_purpose:string;
  input_tokens:number;cached_input_tokens:number;output_tokens:number;cost_thb:number|string;
  call_index_conversation:number;occurred_at:string;
};
type TurnRow={
  conversation_id:string;event_id:string;channel:string;model_reply_used:boolean;grounded_knowledge_supplied:boolean;
  zero_cost_turn:boolean;final_response_source:string;occurred_at:string;
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
function channelLabel(channel:string){
  const labels:Record<string,string>={line:'LINE',web:'เว็บไซต์',facebook:'Messenger',messenger:'Messenger',unknown:'ไม่ทราบช่องทาง'};
  return labels[channel.toLowerCase()]??channel.toUpperCase();
}
function purposeLabel(purpose:string){
  const labels:Record<string,string>={
    'semantic-interpreter':'ทำความเข้าใจข้อความลูกค้า',
    'semantic-supervisor':'ทำความเข้าใจข้อความลูกค้า',
    'grounded-response-composition':'เรียบเรียงคำตอบจากข้อมูลที่ตรวจสอบแล้ว',
    'direct-response':'สร้างคำตอบโดยตรง',
    'repair':'ตรวจและแก้คำตอบ',
  };
  return labels[purpose]??purpose.replace(/[-_]+/g,' ');
}
function thaiDateTime(value:string){
  return new Intl.DateTimeFormat('th-TH',{
    timeZone:'Asia/Bangkok',day:'numeric',month:'short',year:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false,
  }).format(new Date(value));
}
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
function latestConversationSession(costRows:CostRow[],turnRows:TurnRow[]):{calls:CostRow[];turns:TurnRow[]}{
  const activity=[
    ...costRows.map(row=>({kind:'cost' as const,at:row.occurred_at,row})),
    ...turnRows.map(row=>({kind:'turn' as const,at:row.occurred_at,row})),
  ].sort((a,b)=>a.at.localeCompare(b.at));
  if(!activity.length)return{calls:[],turns:[]};

  // conversation_id is shared by all paid intelligence paths for the same
  // customer thread, but call_index_conversation is NOT a global sequence.
  // Saved-Agent usage and the semantic/legacy ledger each start their own
  // counters at 1. Therefore a 3 -> 1 transition can happen in the middle of
  // one continuous conversation and MUST NOT split the cost report.
  //
  // Session boundaries are defined only by the same idle window the runtime
  // itself uses to start a new conversation. This keeps one real active
  // conversation together even when execution switches Agent -> One-Mind,
  // while still separating genuinely new sessions for a stable customer id.
  const ledgerIdleMs=aiCostPolicy().conversationIdleMs;
  let startAt=activity[0]!.at;
  let previousAt=Date.parse(activity[0]!.at);
  for(let i=1;i<activity.length;i+=1){
    const current=activity[i]!;
    const currentAt=Date.parse(current.at);
    const idleReset=Number.isFinite(previousAt)&&Number.isFinite(currentAt)&&currentAt-previousAt>=ledgerIdleMs;
    if(idleReset)startAt=current.at;
    previousAt=currentAt;
  }
  return{
    calls:costRows.filter(row=>row.occurred_at>=startAt).sort((a,b)=>a.occurred_at.localeCompare(b.occurred_at)),
    turns:turnRows.filter(row=>row.occurred_at>=startAt).sort((a,b)=>a.occurred_at.localeCompare(b.occurred_at)),
  };
}

function summarize(rows:CostRow[],turns:TurnRow[]){
  const conversations=new Set(rows.map(x=>x.conversation_id));
  const paidEventIds=new Set(rows.map(x=>x.event_id).filter(Boolean));
  return {
    conversations:conversations.size,
    calls:rows.length,
    input:rows.reduce((s,x)=>s+n(x.input_tokens),0),
    cached:rows.reduce((s,x)=>s+n(x.cached_input_tokens),0),
    output:rows.reduce((s,x)=>s+n(x.output_tokens),0),
    cost:rows.reduce((s,x)=>s+n(x.cost_thb),0),
    direct:turns.filter(x=>x.model_reply_used).length,
    grounded:turns.filter(x=>x.model_reply_used&&x.grounded_knowledge_supplied).length,
    // Older/live rows can predate the explicit zero_cost_turn flag. A turn
    // with no cost event at all is still provably zero-cost; report that
    // operational truth instead of the contradictory "0 calls / 0 zero-cost
    // turns" message that confused the owner in LINE.
    zero:turns.filter(x=>x.zero_cost_turn||rows.length===0||(x.event_id&&!paidEventIds.has(x.event_id))).length,
  };
}

function channelBreakdown(rows:CostRow[],turns:TurnRow[]){
  const channels=new Map<string,{cost:number;calls:number;turns:number}>();
  const ensure=(channel:string)=>{
    const key=(channel||'unknown').toLowerCase();
    const value=channels.get(key)??{cost:0,calls:0,turns:0};
    channels.set(key,value);
    return value;
  };
  for(const row of rows){
    const value=ensure(row.channel);
    value.cost+=n(row.cost_thb);
    value.calls+=1;
  }
  for(const row of turns)ensure(row.channel).turns+=1;
  return [...channels.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([channel,value])=>({
    channel,cost:Math.max(0,value.cost),calls:value.calls,turns:value.turns,
  }));
}

function purposeBreakdown(rows:CostRow[]){
  const purposes=new Map<string,{cost:number;calls:number}>();
  for(const row of rows){
    const key=row.call_purpose||'unknown';
    const value=purposes.get(key)??{cost:0,calls:0};
    value.cost+=n(row.cost_thb);
    value.calls+=1;
    purposes.set(key,value);
  }
  return [...purposes.entries()].sort(([,a],[,b])=>b.cost-a.cost).map(([purpose,value])=>({purpose,...value}));
}

export async function sendIdleAiCostConversationSummaries(now=new Date()){
  // Look back far enough that a temporarily unavailable scheduled invocation
  // does not permanently lose a conversation summary. Delivery idempotency
  // prevents repeat sends; actual idleness is checked against BOTH model
  // calls and final customer-response turns below.
  const oldest=new Date(now.getTime()-24*60*60_000).toISOString();
  const newest=new Date(now.getTime()-COST_REPORT_IDLE_MS).toISOString();
  const [rows,turnRows]=await Promise.all([
    get<CostRow>(
      'ai_api_cost_events?environment=eq.live&occurred_at=gte.'+enc(oldest)
      +'&occurred_at=lte.'+enc(now.toISOString())
      +'&select=conversation_id,event_id,channel,model,call_purpose,input_tokens,cached_input_tokens,output_tokens,cost_thb,call_index_conversation,occurred_at'
      +'&order=occurred_at.asc&limit=5000',
    ),
    get<TurnRow>(
      'ai_response_turns?environment=eq.live&occurred_at=gte.'+enc(oldest)
      +'&occurred_at=lte.'+enc(now.toISOString())
      +'&select=conversation_id,event_id,channel,model_reply_used,grounded_knowledge_supplied,zero_cost_turn,final_response_source,occurred_at'
      +'&order=occurred_at.asc&limit=5000',
    ),
  ]);
  const conversationIds=new Set([...rows.map(row=>row.conversation_id),...turnRows.map(row=>row.conversation_id)]);
  const results:Array<{conversationId:string;status:string;costThb:number}>=[];
  for(const conversationId of conversationIds){
    const allCalls=rows.filter(row=>row.conversation_id===conversationId);
    const allTurns=turnRows.filter(row=>row.conversation_id===conversationId);
    // conversation_id is a stable customer/thread identifier, not a unique
    // session. A 24h scan can contain several separate conversations for the
    // same LINE user, so summarize only the latest idle-window session. Do NOT
    // split on call_index_conversation: Agent and semantic ledgers legitimately
    // use independent counters inside the same live conversation.
    const {calls,turns}=latestConversationSession(allCalls,allTurns);
    if(!calls.length&&!turns.length)continue;
    const latestCallAt=calls.at(-1)?.occurred_at??'';
    const latestTurnAt=turns.at(-1)?.occurred_at??'';
    const lastActivityAt=latestTurnAt>latestCallAt?latestTurnAt:latestCallAt;
    if(lastActivityAt>newest){
      console.log('AI_COST_IDLE_NOTIFY_SKIP',JSON.stringify({conversationId,reason:'recent_turn_activity',lastActivityAt}));
      continue;
    }
    const s=summarize(calls,turns);
    const models=[...new Set(calls.map(x=>x.model))].join(', ');
    const breakdown=channelBreakdown(calls,turns);
    const purposes=purposeBreakdown(calls);
    const channelLines=breakdown.map(item=>
      `• ${channelLabel(item.channel)} — ${baht(item.cost)} บาท\n  OpenAI ${item.calls} ครั้ง · ตอบ ${item.turns} ข้อความ`,
    );
    const purposeLines=purposes.length
      ?purposes.map(item=>`• ${purposeLabel(item.purpose)}: ${item.calls} ครั้ง — ${baht(item.cost)} บาท`)
      :['• ไม่มีการเรียก OpenAI'];
    const directUngrounded=Math.max(0,s.direct-s.grounded);
    const responseLines=[
      s.grounded?`• OpenAI เรียบเรียงจากข้อมูลที่ตรวจสอบแล้ว: ${s.grounded} ข้อความ`:'',
      directUngrounded?`• OpenAI สร้างคำตอบโดยตรง: ${directUngrounded} ข้อความ`:'',
      s.zero?`• ตอบจากข้อมูล/กติกาในระบบโดยไม่เรียก OpenAI: ${s.zero} ข้อความ`:'',
    ].filter(Boolean);
    const overview=s.calls===0
      ?'ไม่เสียค่า AI — ตอบจากข้อมูลหรือกติกาที่มีในระบบ'
      :`เรียก OpenAI ${s.calls} ครั้ง ต้นทุนรวม ${baht(s.cost)} บาท`;
    const startAt=[calls[0]?.occurred_at,turns[0]?.occurred_at].filter(Boolean).sort()[0]??lastActivityAt;
    const timeLabel=startAt===lastActivityAt
      ?thaiDateTime(lastActivityAt)
      :`${thaiDateTime(startAt)} – ${thaiDateTime(lastActivityAt)}`;
    const text=[
      '💰 ต้นทุนจริงต่อบทสนทนา — ทองไทย',
      '',
      `สรุป: ${overview}`,
      `ช่องทางลูกค้า: ${breakdown.map(item=>channelLabel(item.channel)).join(', ')}`,
      `ช่วงเวลา: ${timeLabel}`,
      `อ้างอิง: ${conversationId.slice(0,18)}${conversationId.length>18?'…':''}`,
      '',
      `ต้นทุนรวม: ${baht(s.cost)} บาท`,
      `จำนวนข้อความที่ตอบ: ${turns.length}`,
      '',
      'แยกตามช่องทาง',
      ...channelLines,
      '',
      'ต้นทุนเกิดจาก',
      ...purposeLines,
      '',
      'รูปแบบคำตอบ',
      ...(responseLines.length?responseLines:['• ยังไม่มีข้อมูลรูปแบบคำตอบ']),
      '',
      models?`โมเดล: ${models}`:'โมเดล: ไม่ได้ใช้',
      `โทเคน: เข้า ${s.input.toLocaleString('th-TH')} · cache ${s.cached.toLocaleString('th-TH')} · ออก ${s.output.toLocaleString('th-TH')}`,
    ].filter(Boolean).join('\n');
    const maxIndex=calls.length?Math.max(...calls.map(x=>n(x.call_index_conversation))):0;
    const sessionStart=[calls[0]?.occurred_at,turns[0]?.occurred_at].filter(Boolean).sort()[0]??lastActivityAt;
    const firstCall=calls.find(row=>row.occurred_at===sessionStart);
    const firstTurn=turns.find(row=>row.occurred_at===sessionStart);
    const sessionEvent=firstCall?.event_id||firstTurn?.event_id||sessionStart;
    const status=await sendAiCostLineNotification({
      // call_index_conversation resets for every ledger session. It therefore
      // cannot be the sole idempotency discriminator for a stable LINE
      // conversation_id; two separate sessions can both end at index 22.
      idempotencyKey:`ai_cost_conversation:${conversationId}:${sessionEvent}:${maxIndex}`,
      deliveryType:'ai_cost_conversation',
      text,
      payload:{conversation_id:conversationId,cost_thb:s.cost,calls:s.calls,turns:turns.length,channels:breakdown,session_start_at:sessionStart,session_end_at:lastActivityAt,max_call_index:maxIndex},
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
