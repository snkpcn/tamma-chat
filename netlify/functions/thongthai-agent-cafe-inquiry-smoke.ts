import type { Handler } from '@netlify/functions';
import { loadCustomerMemory } from './_customer-db';
import { loadGuestAgentStateSnapshot, patchGuestAgentState } from './_guest-agent-state-store';
import { runThongthaiAgentShadowTurn } from './_thongthai-agent-session';

const SYNTHETIC_GUEST='98f25137-c242-4a2a-a33e-fbe27e64f207';
const STATE_KEY='thongthaiAgentCafeInquirySmokeV1';
const CONVERSATION_ID='thongthai-agent-cafe-inquiry-smoke-20261001';
const TURNS=[
  'อยากให้ทีมอินทนิลติดต่อกลับเรื่องจัดกาแฟสำหรับกลุ่ม 20 คน ชื่อ ทดสอบคาเฟ่ เบอร์ 0844444444 ครับ',
  'เอาไว้ก่อนนะ ยังไม่ส่งครับ',
  'ยืนยันส่งคำถามครับ',
] as const;

type Row={turn:number;message:string;output?:string;toolCalls?:string[];costThb?:number|null;cumulativeCostThb?:number;error?:string};
type State={status:'running'|'completed'|'partial_failure';nextTurn:number;startedAt:string;finishedAt?:string;rows:Row[]};

function emptyGuestContext(){return{tripDuration:null,travelerType:null,group:{adults:null,children:null,elderly:null},interests:[],pace:null,budget:null,constraints:[]};}
function json(statusCode:number,body:Record<string,unknown>){return{statusCode,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},body:JSON.stringify(body)};}
function readState(raw:unknown):State|null{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
  const v=raw as Partial<State>;
  if(!['running','completed','partial_failure'].includes(String(v.status)))return null;
  return{status:v.status as State['status'],nextTurn:Math.max(1,Math.floor(Number(v.nextTurn)||1)),startedAt:String(v.startedAt??''),finishedAt:v.finishedAt,rows:Array.isArray(v.rows)?v.rows as Row[]:[]};
}

export const handler:Handler=async event=>{
  if(event.httpMethod!=='GET')return json(405,{ok:false,error:'method_not_allowed'});
  const turn=Math.floor(Number(event.queryStringParameters?.turn));
  if(!Number.isInteger(turn)||turn<1||turn>TURNS.length)return json(400,{ok:false,error:'turn_must_be_1_to_3'});
  const customer=await loadCustomerMemory(SYNTHETIC_GUEST,'th',emptyGuestContext());
  if(!customer?.guestDbId)return json(503,{ok:false,error:'synthetic_guest_unavailable'});

  const snapshot=await loadGuestAgentStateSnapshot(customer.guestDbId);
  const existing=readState(snapshot.state[STATE_KEY]);
  const state:State=existing??{status:'running',nextTurn:1,startedAt:new Date().toISOString(),rows:[]};
  const reused=state.rows.find(row=>row.turn===turn);
  if(reused)return json(200,{ok:!reused.error,reused:true,state,result:reused});
  if(state.status!=='running')return json(409,{ok:false,error:'smoke_terminal',state});
  if(turn!==state.nextTurn)return json(409,{ok:false,error:'turn_out_of_sequence',expected:state.nextTurn,requested:turn,state});

  const message=TURNS[turn-1]!;
  try{
    const result=await runThongthaiAgentShadowTurn({
      guestDbId:customer.guestDbId,
      conversationId:CONVERSATION_ID,
      eventId:`${CONVERSATION_ID}-turn${turn}`,
      channel:'web',
      message,
      environment:'test',
      transactionMode:'test',
    });
    const row:Row={turn,message,output:result.output,toolCalls:result.toolCalls,costThb:result.usage.costThb,cumulativeCostThb:result.cumulativeCostThb};
    const rows=[...state.rows,row];
    const done=turn===TURNS.length;
    const next:State={status:done?'completed':'running',nextTurn:done?TURNS.length+1:turn+1,startedAt:state.startedAt,...(done?{finishedAt:new Date().toISOString()}:{}),rows};
    await patchGuestAgentState(customer.guestDbId,{set:{[STATE_KEY]:next}});
    return json(200,{ok:true,reused:false,state:next,result:row});
  }catch(error){
    const row:Row={turn,message,error:error instanceof Error?error.message.slice(0,500):'unknown'};
    const failed:State={status:'partial_failure',nextTurn:turn,startedAt:state.startedAt,finishedAt:new Date().toISOString(),rows:[...state.rows,row]};
    await patchGuestAgentState(customer.guestDbId,{set:{[STATE_KEY]:failed}});
    return json(200,{ok:false,reused:false,state:failed,result:row});
  }
};
