import {loadWeeklyCashInput,bangkokReportDate,resolveInthaninScope} from './_inthanin-weekly-cash';
import {buildWeeklyCashReport,weeklyCashFlex} from './_inthanin-weekly-cash-report';
import type {RecordedDailyClose} from './_inthanin-daily-close-line';

export type PreparedWeeklyReply={message:Record<string,unknown>;deliveryId:string};
export type WeeklyReplyOutcome=PreparedWeeklyReply|{suppressReply:true};
export class WeeklyReplyReservationError extends Error {}
async function db(path:string,init:RequestInit={}):Promise<Response>{
  const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)throw new Error('Weekly reply database unavailable');
  const response=await fetch(url.replace(/\/$/,'')+'/rest/v1/'+path,{
    ...init,headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',...(init.headers??{})},
    signal:AbortSignal.timeout(5000),
  });
  if(!response.ok)throw new Error('Weekly reply source/audit unavailable: '+response.status);
  return response;
}
/** The ingest RPC's same-message duplicate result is authoritative before any enrichment I/O. */
export function suppressDuplicateSundayReceipt(input:{targetHash:string|null;close:RecordedDailyClose|null;eventTimestamp:number}):boolean {
  if(!input.targetHash||!/^[a-f0-9]{64}$/.test(input.targetHash)||input.close?.environment!=='live'||!input.close.duplicate||!Number.isFinite(input.eventTimestamp))return false;
  const date=bangkokReportDate(new Date(input.eventTimestamp));
  return input.close.localDate===date&&new Date(date+'T00:00:00Z').getUTCDay()===0;
}
export function eligibleSundayReceipt(input:{targetHash:string|null;close:RecordedDailyClose|null;eventTimestamp:number;receivedAt:number},now=Date.now()):boolean {
  if(!input.targetHash||!/^[a-f0-9]{64}$/.test(input.targetHash)||!input.close||input.close.environment!=='live')return false;
  if(!Number.isFinite(input.eventTimestamp)||now-input.receivedAt>40000||now<input.receivedAt
    ||now-input.eventTimestamp>=20*60*1000||now<input.eventTimestamp)return false;
  const localDate=bangkokReportDate(new Date(input.eventTimestamp));
  return new Date(localDate+'T00:00:00Z').getUTCDay()===0&&input.close.localDate===localDate
    &&Boolean(input.close.dailyCloseId&&input.close.messageId);
}
/** Prepares one Flex object for the SAME webhook reply. Never sends or falls back to push. */
export async function prepareSundayCashReply(input:{targetHash:string|null;close:RecordedDailyClose|null;eventTimestamp:number;receivedAt:number},now=Date.now()):Promise<WeeklyReplyOutcome|null>{
  if(!eligibleSundayReceipt(input,now))return null;
  const startedAt=Date.now();
  const close=input.close!;
  const scope=await resolveInthaninScope(input.targetHash);
  if(!scope)throw new Error('Sunday accounting group binding unavailable or ambiguous');
  const snapshot=await loadWeeklyCashInput(new Date(input.eventTimestamp),scope.branchId);
  const sunday=snapshot.closes.find(row=>row.local_date===close.localDate);
  if(sunday?.id!==close.dailyCloseId)throw new Error('Sunday receipt does not match canonical daily close');
  snapshot.asOf=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Bangkok',dateStyle:'short',timeStyle:'short'}).format(new Date(now));
  const report=buildWeeklyCashReport(snapshot);
  const elapsed=Date.now()-startedAt;
  if(now-input.receivedAt+elapsed>45000||now-input.eventTimestamp+elapsed>=20*60*1000-10000)return null; // Leave headroom for the single-use reply token.
  const response=await db('ops_notification_deliveries?on_conflict=idempotency_key',{
    method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=representation'},
    body:JSON.stringify({channel_id:scope.channelId,provider:'line',entity_type:'daily_schedule',delivery_type:'daily_summary',
      status:'pending',idempotency_key:'inthanin_weekly_reply:'+close.localDate,
      payload:{summary_kind:'inthanin_weekly_reply',delivery_method:'reply',local_date:close.localDate,
        daily_close_id:close.dailyCloseId,source_message_id:close.messageId,period_start:report.window.start,
        period_end_inclusive:report.window.end,report_days:report.reported,confirmed_days:report.confirmed,
        totals:report.totals,generated_cash:report.cashGenerated,cash_covered_days:report.cashCoveredDays,
        collection_amount:null,collection_status:'unconfirmed',retained_float:2000}}),
  }).catch(()=>{throw new WeeklyReplyReservationError('Weekly reply reservation outcome unknown');});
  const inserted=await response.json().catch(()=>{throw new WeeklyReplyReservationError('Weekly reply reservation response invalid');}) as Array<{id:string}>;
  // Any existing row means sent or uncertain. Do not replay on webhook redelivery or a second form.
  if(!inserted[0]?.id){
    try {
    const previous=await(await db('ops_notification_deliveries?idempotency_key=eq.'
      +encodeURIComponent('inthanin_weekly_reply:'+close.localDate)+'&select=payload&limit=1')).json() as Array<{payload?:{source_message_id?:string}}>;
    if(previous[0]?.payload?.source_message_id===close.messageId)return {suppressReply:true};
    if(!previous[0])return {suppressReply:true};
    return null;
    } catch {return {suppressReply:true};}
  }
  return {deliveryId:inserted[0].id,message:{type:'flex',altText:'สรุปอินทนิล '+report.window.start+' ถึง '+report.window.end+' · '+report.collectionText,
    contents:weeklyCashFlex(report,snapshot.asOf)}};
}
export async function finishSundayCashReply(deliveryId:string,ok:boolean):Promise<void>{
  await db('ops_notification_deliveries?id=eq.'+encodeURIComponent(deliveryId),{
    method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status:ok?'sent':'failed',
      error_message:ok?null:'Reply unsuccessful or token expired; never fall back to push'}),
  });
}
