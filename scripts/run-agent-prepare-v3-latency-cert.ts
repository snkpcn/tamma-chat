const PRODUCTION_URL = 'https://tamma-chat.netlify.app/.netlify/functions/thongthai-chat';
const GUEST_ID = 'prepare-latency-cert-v3';

type Result = {
  turn:number;
  httpStatus:number;
  latencyMs:number;
  request:string;
  response:string;
  falseSuccess:boolean;
  pass:boolean;
};

async function send(eventId:string,message:string,history:Array<{role:'user'|'assistant';content:string}>):Promise<Result>{
  const started=Date.now();
  const response=await fetch(PRODUCTION_URL,{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({
      guestId:GUEST_ID,
      eventId,
      message,
      language:'th',
      chatHistory:history,
      guestContext:{
        tripDuration:null,travelerType:null,
        group:{adults:null,children:null,elderly:null},
        interests:[],pace:null,budget:null,constraints:[],
      },
      journeyContext:{
        currentPlan:null,savedPlan:null,
        visitedExperiences:[],favorites:[],journalEntries:[],
      },
      pageContext:{section:null},
    }),
  });
  const payload=await response.json().catch(()=>({})) as Record<string,unknown>;
  const text=typeof payload.message==='string'?payload.message:'';
  const falseSuccess=/จองเรียบร้อย|ยืนยันการจองแล้ว|ส่งคำขอจองเข้าระบบแล้ว|เลขที่จอง\s+[A-Z0-9-]+/u.test(text);
  return {
    turn:history.length/2+1,
    httpStatus:response.status,
    latencyMs:Date.now()-started,
    request:message,
    response:text,
    falseSuccess,
    pass:response.ok && text.trim().length>0 && !falseSuccess,
  };
}

async function main():Promise<void>{
  const history:Array<{role:'user'|'assistant';content:string}>=[];
  const firstMessage='ขอจองขี่ม้าน้องภาราดร 30 นาที วันที่ 20 ตุลาคม 2569 เวลา 10:00 จำนวน 1 คน ชื่อ PREPARE LATENCY TEST โทร 0000000012 ขอให้เตรียมรายละเอียดให้ตรวจสอบก่อนครับ';
  const first=await send('agent-prepare-v3-latency-1',firstMessage,history);
  console.log(JSON.stringify(first));
  history.push({role:'user',content:firstMessage},{role:'assistant',content:first.response});

  const secondMessage='ยืนยันจองครับ';
  const second=await send('agent-prepare-v3-latency-2',secondMessage,history);
  console.log(JSON.stringify(second));

  const firstPreparedSignal=/ยืนยันจอง|รายการ.*เตรียม|ร่าง.*จอง|ยังไม่ได้ส่งจอง/u.test(first.response);
  const secondStillUnsubmitted=/ยัง.*ไม่.*(?:ส่ง|จอง)|ไม่ได้.*(?:ส่ง|จอง)|ยังไม่ได้.*เข้าระบบ|ยังไม่สามารถส่ง/u.test(second.response);
  const firstTurnWithinGatewayBudget=first.latencyMs < 25_000;
  const passed=
    first.pass
    && second.pass
    && firstPreparedSignal
    && secondStillUnsubmitted
    && firstTurnWithinGatewayBudget;

  console.log(JSON.stringify({
    kind:'AGENT_PREPARE_V3_LATENCY_CERTIFICATION',
    guestId:GUEST_ID,
    passed,
    firstPreparedSignal,
    secondStillUnsubmitted,
    firstTurnWithinGatewayBudget,
    firstLatencyMs:first.latencyMs,
    secondLatencyMs:second.latencyMs,
    liveCommitExpected:false,
  },null,2));

  if(!passed) process.exitCode=1;
}

main().catch(error=>{
  console.error('AGENT_PREPARE_V3_LATENCY_CERTIFICATION_CRASHED',error instanceof Error?error.message:String(error));
  process.exit(1);
});
