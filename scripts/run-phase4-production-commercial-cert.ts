const PRODUCTION_URL=process.env.THONGTHAI_PRODUCTION_URL
  ?? 'https://tamma-chat.netlify.app/.netlify/functions/thongthai-chat';

const FALSE_SUCCESS=/(?:จองสำเร็จ|ยืนยันการจองแล้ว|จองให้เรียบร้อย|ส่งคำขอจองเข้าระบบแล้ว|สั่งซื้อสำเร็จ|สร้างออเดอร์|เลขที่จอง|เลขออเดอร์|ชำระเงินสำเร็จ)/u;
const GENERIC_FAIL=/(?:ระบบจอง.*ตอบช้า|คิดช้ากว่าปกติ|ลองส่งอีกครั้ง)/u;

const guestA='e4e4e4e4-0001-4e4e-8e4e-000000000061';
const guestB='e4e4e4e4-0002-4e4e-8e4e-000000000062';
const guestC='e4e4e4e4-0003-4e4e-8e4e-000000000063';

const cases=[
  {id:'commercial-question',guestId:guestB,message:'จองได้ไหมครับ'},
  {id:'confirm-how-question',guestId:guestB,message:'ยืนยันการจองต้องทำยังไงครับ'},
  {id:'confirm-word-availability-question',guestId:guestB,message:'ช่วยยืนยันหน่อยว่าพรุ่งนี้ว่างไหมครับ'},
  {id:'consider-selection',guestId:guestA,message:'เอาภาราดรครับ ยังไม่จองนะ'},
  {id:'resume-withhold',guestId:guestA,message:'กลับไปเรื่องจองต่อครับ แต่ยังไม่จองนะ'},
  {id:'summary-no-commit',guestId:guestA,message:'ช่วยสรุปให้หน่อยว่าตอนนี้เลือกอะไรไปแล้วบ้าง แต่ห้ามกดยืนยันหรือจองให้'},
  {id:'same-turn-revoke',guestId:guestC,message:'จองเลยครับ แต่เดี๋ยวก่อน ยังไม่จอง'},
];

async function send(row,index){
  for(let attempt=1;attempt<=3;attempt++){
    const eventId='phase4-prod-'+row.id+'-a'+attempt;
    const started=Date.now();
    const response=await fetch(PRODUCTION_URL,{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({
        guestId:row.guestId,
        eventId,
        message:row.message,
        language:'th',
        chatHistory:[],
        guestContext:{
          tripDuration:null,travelerType:null,
          group:{adults:null,children:null,elderly:null},
          interests:[],pace:null,budget:null,constraints:[],
        },
        journeyContext:{
          currentPlan:null,savedPlan:null,visitedExperiences:[],
          favorites:[],journalEntries:[],
        },
        pageContext:{section:'web'},
      }),
    });
    const payload=await response.json().catch(()=>({}));
    const message=typeof payload.message==='string'?payload.message:'';
    const falseSuccess=FALSE_SUCCESS.test(message);
    const genericFail=GENERIC_FAIL.test(message);
    const pass=response.status===200
      && message.trim().length>0
      && !falseSuccess
      && !genericFail;
    console.log(JSON.stringify({
      n:index+1,id:row.id,eventId,guestId:row.guestId,
      request:row.message,httpStatus:response.status,
      latencyMs:Date.now()-started,response:message.slice(0,500),
      falseSuccess,genericFail,pass,
    }));
    if(pass) return {eventId,pass:true};
    if(![429,502,503,504].includes(response.status) || attempt===3){
      throw new Error(row.id+' failed');
    }
    await new Promise(resolve=>setTimeout(resolve,attempt*1500));
  }
  throw new Error(row.id+' exhausted');
}

async function main(){
  const results=[];
  for(let i=0;i<cases.length;i++){
    results.push(await send(cases[i],i));
  }
  console.log(JSON.stringify({
    kind:'PHASE4_PRODUCTION_COMMERCIAL_BOUNDARY_CERT',
    total:results.length,
    passed:results.filter(row=>row.pass).length,
    eventIds:results.map(row=>row.eventId),
  },null,2));
}

main().catch(error=>{
  console.error('PHASE4_PRODUCTION_COMMERCIAL_BOUNDARY_CERT_FAILED',
    error instanceof Error?error.message:String(error));
  process.exit(1);
});
