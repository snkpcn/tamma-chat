const PRODUCTION_URL=process.env.THONGTHAI_PRODUCTION_URL
  ?? 'https://tamma-chat.netlify.app/.netlify/functions/thongthai-chat';

const FALSE_SUCCESS=/(?:จองสำเร็จ|ยืนยันการจองแล้ว|เลขที่จอง|สั่งซื้อสำเร็จ|สร้างออเดอร์|ชำระเงินสำเร็จ|ส่งคำถามให้ทีม.*แล้ว)/u;
const GENERIC_FALLBACK=/(?:คิดช้ากว่าปกติ|ตอบช้ากว่าปกติ|ระบบตอบช้า|ยังตอบเรื่องนี้ให้แม่นไม่ได้)/u;

const cases=[
  {id:'ask-booking',guest:'e4e4e4e4-0001-4e4e-8e4e-000000000101',message:'จองได้ไหมครับ'},
  {id:'ask-confirm-how',guest:'e4e4e4e4-0002-4e4e-8e4e-000000000102',message:'ยืนยันการจองต้องทำยังไงครับ'},
  {id:'ask-order-how',guest:'e4e4e4e4-0003-4e4e-8e4e-000000000103',message:'ถ้าจะสั่งอาหารต้องทำยังไงครับ'},
  {id:'consider-selection',guest:'e4e4e4e4-0004-4e4e-8e4e-000000000104',message:'เอาภาราดรครับ ยังไม่จองนะ'},
  {id:'consider-resume',guest:'e4e4e4e4-0004-4e4e-8e4e-000000000104',message:'กลับไปเรื่องจองต่อครับ แต่ยังไม่จองนะ'},
  {id:'bare-confirm',guest:'e4e4e4e4-0004-4e4e-8e4e-000000000104',message:'ยืนยันครับ'},
  {id:'revoke-late',guest:'e4e4e4e4-0005-4e4e-8e4e-000000000105',message:'จองเลยครับ แต่เดี๋ยวก่อน ยังไม่จอง'},
  {id:'manage-cancel',guest:'e4e4e4e4-0004-4e4e-8e4e-000000000104',message:'ยกเลิกอันที่คุยไว้ก่อนครับ'},
];

function guestContext(){
  return {
    tripDuration:null,travelerType:null,
    group:{adults:null,children:null,elderly:null},
    interests:[],pace:null,budget:null,constraints:[],
  };
}
function journeyContext(){
  return {currentPlan:null,savedPlan:null,visitedExperiences:[],favorites:[],journalEntries:[]};
}

async function send(row,runId,index){
  let last=null;
  for(let attempt=1;attempt<=3;attempt++){
    const eventId='phase4-prod-'+runId+'-'+String(index+1).padStart(2,'0')+'-'+row.id+'-a'+attempt;
    const started=Date.now();
    const response=await fetch(PRODUCTION_URL,{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({
        guestId:row.guest,
        eventId,
        message:row.message,
        language:'th',
        chatHistory:[],
        guestContext:guestContext(),
        journeyContext:journeyContext(),
        pageContext:{section:'web'},
      }),
    });
    const payload=await response.json().catch(()=>({}));
    const text=typeof payload.message==='string'?payload.message:'';
    const result={
      id:row.id,eventId,guestId:row.guest,httpStatus:response.status,
      latencyMs:Date.now()-started,response:text.slice(0,500),
      falseSuccess:FALSE_SUCCESS.test(text),
      genericFallback:GENERIC_FALLBACK.test(text),
      pass:response.status===200&&text.trim().length>0&&!FALSE_SUCCESS.test(text)&&!GENERIC_FALLBACK.test(text),
    };
    console.log(JSON.stringify(result));
    last=result;
    if(result.pass)return result;
    if(![502,503,504].includes(response.status))break;
    await new Promise(resolve=>setTimeout(resolve,1500*attempt));
  }
  throw new Error('case failed: '+row.id+' '+JSON.stringify(last));
}

async function main(){
  const runId=String(Date.now());
  const results=[];
  for(let i=0;i<cases.length;i++){
    results.push(await send(cases[i],runId,i));
  }
  const summary={
    kind:'PHASE4_PRODUCTION_COMMERCIAL_BOUNDARY',
    runId,
    total:results.length,
    passed:results.filter(row=>row.pass).length,
    failed:results.filter(row=>!row.pass).length,
    falseTransactionSignals:results.filter(row=>row.falseSuccess).length,
    genericFallbacks:results.filter(row=>row.genericFallback).length,
    eventIds:results.map(row=>row.eventId),
  };
  console.log(JSON.stringify(summary,null,2));
  if(summary.failed||summary.falseTransactionSignals||summary.genericFallbacks)process.exit(1);
}

main().catch(error=>{
  console.error('PHASE4_PRODUCTION_BOUNDARY_FAILED',error instanceof Error?error.message:String(error));
  process.exit(1);
});
