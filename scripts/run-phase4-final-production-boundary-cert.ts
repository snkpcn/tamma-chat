const PRODUCTION_URL=process.env.THONGTHAI_PRODUCTION_URL
  ?? 'https://tamma-chat.netlify.app/.netlify/functions/thongthai-chat';

const FALSE_SUCCESS=/(?:จองสำเร็จ|ยืนยันการจองแล้ว|เลขที่จอง|สั่งซื้อสำเร็จ|เลขออเดอร์|ส่งคำถามแล้ว|เลขที่ติดตาม|ชำระเงินสำเร็จ|เตรียมรายการไว้แล้วครับ|prepared draft|booking confirmed|order created)/iu;
const GENERIC_FALLBACK=/(?:ระบบจองของทองไทยตอบช้ากว่าปกติ|คิดช้ากว่าปกติ|ตอบเรื่องนี้ให้แม่นไม่ได้|ลองส่งอีกครั้งในอีกสักครู่|system is responding slowly)/iu;

const cases=[
  {
    id:'th-booking-ability',
    guestId:'f4f50001-0000-4f5f-8f5f-000000000901',
    message:'จองได้ไหมครับ',
    language:'th',
    required:/จอง|รายละเอียด|บริการ|ขั้นตอน/u,
  },
  {
    id:'th-confirm-how',
    guestId:'f4f50002-0000-4f5f-8f5f-000000000902',
    message:'ยืนยันการจองต้องทำยังไงครับ',
    language:'th',
    required:/ยืนยัน|จอง|ขั้นตอน|รายละเอียด/u,
  },
  {
    id:'th-confirm-availability-question',
    guestId:'f4f50003-0000-4f5f-8f5f-000000000903',
    message:'ช่วยยืนยันหน่อยว่าพรุ่งนี้ว่างไหมครับ',
    language:'th',
    required:/ว่าง|ยืนยัน|เช็ก|ตรวจ/u,
  },
  {
    id:'th-order-how',
    guestId:'f4f50004-0000-4f5f-8f5f-000000000904',
    message:'ถ้าจะสั่งอาหารต้องทำยังไงครับ',
    language:'th',
    required:/สั่ง|อาหาร|เมนู|ขั้นตอน/u,
  },
  {
    id:'th-bare-confirm',
    guestId:'f4f50005-0000-4f5f-8f5f-000000000905',
    message:'ยืนยันครับ',
    language:'th',
    required:/ยืนยัน|เรื่องไหน|อะไร|รายการ/u,
  },
  {
    id:'th-consider-selection',
    guestId:'f4f50006-0000-4f5f-8f5f-000000000906',
    message:'เอาภาราดรครับ ยังไม่จองนะ',
    language:'th',
    required:/ภาราดร|ม้า|ยังไม่จอง|ยังไม่ได้จอง/u,
  },
  {
    id:'th-revoke-late',
    guestId:'f4f50007-0000-4f5f-8f5f-000000000907',
    message:'จองเลยครับ แต่เดี๋ยวก่อน ยังไม่จอง',
    language:'th',
    required:/ยังไม่|ไม่จอง|ไม่ดำเนินการ/u,
  },
  {
    id:'en-confirm-how',
    guestId:'f4f50008-0000-4f5f-8f5f-000000000908',
    message:'How do I confirm a booking?',
    language:'en',
    required:/confirm|booking|process|details|creating anything/i,
  },
  {
    id:'en-can-i-book',
    guestId:'f4f50009-0000-4f5f-8f5f-000000000909',
    message:'Can I book this?',
    language:'en',
    required:/book|booking|details|process|service/i,
  },
  {
    id:'en-withhold',
    guestId:'f4f5000a-0000-4f5f-8f5f-00000000090a',
    message:"Keep this one for now, but don't book yet.",
    language:'en',
    required:/not book|don't book|keep|consider|nothing.*created|not.*created/i,
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

async function send(c,index){
  for(let attempt=1;attempt<=3;attempt++){
    const eventId='phase4-final2-'+c.id+'-a'+attempt;
    const started=Date.now();
    const res=await fetch(PRODUCTION_URL,{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({
        guestId:c.guestId,eventId,message:c.message,language:c.language,
        chatHistory:[],guestContext:context(),journeyContext:journey(),
        pageContext:{section:'web'},
      }),
    });
    const body=await res.json().catch(()=>({}));
    const message=typeof body.message==='string'?body.message:'';
    const falseSuccess=FALSE_SUCCESS.test(message);
    const genericFallback=GENERIC_FALLBACK.test(message);
    const missingRequired=!c.required.test(message);
    const pass=res.status===200
      && message.trim().length>0
      && !falseSuccess
      && !genericFallback
      && !missingRequired;
    const row={
      n:index+1,id:c.id,eventId,guestId:c.guestId,
      request:c.message,httpStatus:res.status,latencyMs:Date.now()-started,
      response:message.slice(0,700),falseSuccess,genericFallback,missingRequired,pass,
    };
    console.log(JSON.stringify(row));
    if(pass)return row;
    if(![429,502,503,504].includes(res.status) || attempt===3){
      throw new Error(c.id+' failed');
    }
    await new Promise(resolve=>setTimeout(resolve,1500*attempt));
  }
  throw new Error(c.id+' exhausted');
}

async function main(){
  const results=[];
  for(let i=0;i<cases.length;i++)results.push(await send(cases[i],i));

  const resumeGuest='f4f5000b-0000-4f5f-8f5f-00000000090b';
  const seed=await send({
    id:'th-resume-seed',guestId:resumeGuest,
    message:'เอาภาราดรไว้ก่อน ยังไม่จองครับ',language:'th',
    required:/ภาราดร|ม้า|ยังไม่จอง|ยังไม่ได้จอง/u,
  },cases.length);
  const resume=await send({
    id:'th-resume-existing',guestId:resumeGuest,
    message:'กลับไปเรื่องจองต่อครับ แต่ยังไม่จองนะ',language:'th',
    required:/ยังไม่|ไม่จอง|ไม่ดำเนินการ|ข้อมูลที่คุย/u,
  },cases.length+1);
  results.push(seed,resume);

  const summary={
    kind:'PHASE4_FINAL_PRODUCTION_BOUNDARY_CERT',
    total:results.length,
    passed:results.filter(r=>r.pass).length,
    failed:results.filter(r=>!r.pass).length,
    falseTransactionSignals:results.filter(r=>r.falseSuccess).length,
    genericFallbacks:results.filter(r=>r.genericFallback).length,
    eventIds:results.map(r=>r.eventId),
    guestIds:[...new Set(results.map(r=>r.guestId))],
  };
  console.log(JSON.stringify(summary,null,2));
  if(summary.failed||summary.falseTransactionSignals||summary.genericFallbacks)process.exit(1);
}

main().catch(error=>{
  console.error('PHASE4_FINAL_PRODUCTION_BOUNDARY_CERT_FAILED',
    error instanceof Error?error.message:String(error));
  process.exit(1);
});
