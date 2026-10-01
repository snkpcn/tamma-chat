async function main(): Promise<void> {
  const PRODUCTION_URL = 'https://tamma-chat.netlify.app/.netlify/functions/thongthai-chat';
  const GUEST_ID = 'd6eac04f-2d29-5d32-8dcb-2f6cd4fcf0aa';
  
  type Turn = { message:string; eventId:string };
  const turns: Turn[] = [
    {
      eventId:'agent-prepare-only-cert2-1',
      message:'ขอจองขี่ม้าน้องภาราดร 30 นาที วันที่ 16 ตุลาคม 2569 เวลา 10:00 จำนวน 1 คน ชื่อ PREPARE TEST โทร 0000000011 ขอให้เตรียมรายละเอียดให้ตรวจสอบก่อนครับ',
    },
    {
      eventId:'agent-prepare-only-cert2-2',
      message:'ยืนยันจองครับ',
    },
  ];
  
  const history:Array<{role:'user'|'assistant';content:string}> = [];
  const results:Array<Record<string,unknown>> = [];
  
  for (let index=0; index<turns.length; index+=1) {
    const turn=turns[index]!;
    const response=await fetch(PRODUCTION_URL,{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({
        guestId:GUEST_ID,
        eventId:turn.eventId,
        message:turn.message,
        language:'th',
        chatHistory:history,
        guestContext:{
          tripDuration:null,
          travelerType:null,
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
    const message=typeof payload.message==='string'?payload.message:'';
    const falseSuccess=/ส่งคำขอจองเข้าระบบแล้ว|จองเรียบร้อย|ยืนยันการจองแล้ว|เลขที่จอง\s+[A-Z0-9-]+/u.test(message);
    const pass=response.ok && message.trim().length>0 && !falseSuccess;
    results.push({
      turn:index+1,
      httpStatus:response.status,
      request:turn.message,
      response:message,
      intent:payload.intent??null,
      falseSuccess,
      pass,
    });
    console.log(JSON.stringify(results.at(-1)));
    history.push({role:'user',content:turn.message});
    history.push({role:'assistant',content:message});
  }
  
  const first=String(results[0]?.response??'');
  const second=String(results[1]?.response??'');
  const firstPreparedSignal=/ยืนยันจอง|ร่าง|รายการ.*เตรียม|รายละเอียด.*ตรวจสอบ/u.test(first)
    && !/ไม่สามารถสร้างร่าง|สร้างร่าง.*ไม่สำเร็จ|ระบบรับคำขอจองยังไม่พร้อม/u.test(first);
  const secondStillUnsubmitted=/ยัง.*ไม่.*(?:ส่ง|จอง)|ไม่ได้.*(?:ส่ง|จอง)|ยังไม่ได้.*เข้าระบบ|ยังไม่ถูกส่ง|ไม่สามารถ.*ยืนยัน/u.test(second);
  const passed=results.every(result=>result.pass===true) && firstPreparedSignal && secondStillUnsubmitted;
  
  console.log(JSON.stringify({
    kind:'AGENT_PREPARE_ONLY_PRODUCTION_CERTIFICATION',
    guestId:GUEST_ID,
    passed,
    firstPreparedSignal,
    secondStillUnsubmitted,
    liveCommitExpected:false,
  },null,2));
  
  if(!passed) process.exitCode=1;
  
}

main().catch(error => {
  console.error('AGENT_PREPARE_ONLY_PRODUCTION_CERTIFICATION_CRASHED', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
