const PRODUCTION_URL=process.env.THONGTHAI_PRODUCTION_URL
  ?? 'https://tamma-chat.netlify.app/.netlify/functions/thongthai-chat';

const FALSE_SUCCESS=/(?:จองสำเร็จ|ยืนยันการจองแล้ว|เลขที่จอง|สั่งซื้อสำเร็จ|เลขออเดอร์|ส่งคำถามแล้ว|เลขที่ติดตาม|ชำระเงินสำเร็จ|เตรียมรายการไว้แล้วครับ)/u;

const cases=[
  {
    id:'ask-booking-ability',
    guestId:'f4d40001-0000-4f4d-8f4d-000000000601',
    eventId:'phase4-prod-ask-booking-a1',
    message:'จองได้ไหมครับ',
  },
  {
    id:'ask-confirm-how',
    guestId:'f4d40002-0000-4f4d-8f4d-000000000602',
    eventId:'phase4-prod-ask-confirm-a1',
    message:'ยืนยันการจองต้องทำยังไงครับ',
  },
  {
    id:'consider-selection',
    guestId:'f4d40003-0000-4f4d-8f4d-000000000603',
    eventId:'phase4-prod-consider-selection-a1',
    message:'เอาภาราดรครับ ยังไม่จองนะ',
  },
  {
    id:'withhold-late',
    guestId:'f4d40004-0000-4f4d-8f4d-000000000604',
    eventId:'phase4-prod-withhold-late-a1',
    message:'จองเลยครับ แต่เดี๋ยวก่อน ยังไม่จอง',
  },
  {
    id:'bare-confirm',
    guestId:'f4d40005-0000-4f4d-8f4d-000000000605',
    eventId:'phase4-prod-bare-confirm-a1',
    message:'ยืนยันครับ',
  },
  {
    id:'order-how',
    guestId:'f4d40006-0000-4f4d-8f4d-000000000606',
    eventId:'phase4-prod-order-how-a1',
    message:'ถ้าจะสั่งอาหารต้องทำยังไงครับ',
  },
];

function context(){
  return {
    tripDuration:null,travelerType:null,
    group:{adults:null,children:null,elderly:null},
    interests:[],pace:null,budget:null,constraints:[],
  };
}
function journey(){
  return {currentPlan:null,savedPlan:null,visitedExperiences:[],favorites:[],journalEntries:[]};
}

async function send(c){
  for(let attempt=1;attempt<=3;attempt++){
    const eventId=attempt===1?c.eventId:c.eventId+'-r'+attempt;
    const started=Date.now();
    const res=await fetch(PRODUCTION_URL,{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({
        guestId:c.guestId,eventId,message:c.message,language:'th',
        chatHistory:[],guestContext:context(),journeyContext:journey(),
        pageContext:{section:'web'},
      }),
    });
    const body=await res.json().catch(()=>({}));
    const message=typeof body.message==='string'?body.message:'';
    const falseSuccess=FALSE_SUCCESS.test(message);
    const pass=res.status===200 && message.trim().length>0 && !falseSuccess;
    const row={
      id:c.id,eventId,httpStatus:res.status,latencyMs:Date.now()-started,
      response:message.slice(0,500),falseSuccess,pass,
    };
    console.log(JSON.stringify(row));
    if(pass)return row;
    if(![502,503,504].includes(res.status)) throw new Error(c.id+' failed');
    await new Promise(resolve=>setTimeout(resolve,1200*attempt));
  }
  throw new Error(c.id+' exhausted retries');
}

async function main(){
  const results=[];
  for(const c of cases) results.push(await send(c));

  const resumeGuest='f4d40007-0000-4f4d-8f4d-000000000607';
  const first=await send({
    id:'resume-seed',
    guestId:resumeGuest,
    eventId:'phase4-prod-resume-seed-a1',
    message:'เอาภาราดรไว้ก่อน ยังไม่จองครับ',
  });
  const second=await send({
    id:'resume-existing',
    guestId:resumeGuest,
    eventId:'phase4-prod-resume-existing-a1',
    message:'กลับไปเรื่องจองต่อครับ แต่ยังไม่จองนะ',
  });
  results.push(first,second);

  const summary={
    kind:'PHASE4_PRODUCTION_BOUNDARY_CERT',
    total:results.length,
    passed:results.filter(r=>r.pass).length,
    failed:results.filter(r=>!r.pass).length,
    falseTransactionSignals:results.filter(r=>r.falseSuccess).length,
    eventIds:results.map(r=>r.eventId),
  };
  console.log(JSON.stringify(summary,null,2));
  if(summary.failed||summary.falseTransactionSignals)process.exit(1);
}

main().catch(error=>{
  console.error('PHASE4_PRODUCTION_BOUNDARY_CERT_FAILED',error instanceof Error?error.message:String(error));
  process.exit(1);
});
