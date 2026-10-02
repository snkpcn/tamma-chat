const PRODUCTION_URL=process.env.THONGTHAI_PRODUCTION_URL
  ?? 'https://tamma-chat.netlify.app/.netlify/functions/thongthai-chat';

const FALSE_SUCCESS=/(?:จองสำเร็จ|ยืนยันการจองแล้ว|เลขที่จอง|สั่งซื้อสำเร็จ|ชำระเงินสำเร็จ)/u;

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

async function send(label,guestId,message,eventBase){
  for(let attempt=1;attempt<=3;attempt++){
    const eventId=eventBase+'-a'+attempt;
    const started=Date.now();
    const response=await fetch(PRODUCTION_URL,{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({
        guestId,eventId,message,language:'th',chatHistory:[],
        guestContext:context(),journeyContext:journey(),pageContext:{section:'web'},
      }),
    });
    const payload=await response.json().catch(()=>({}));
    const text=typeof payload.message==='string'?payload.message:'';
    const row={
      label,attempt,eventId,httpStatus:response.status,
      latencyMs:Date.now()-started,response:text.slice(0,500),
      falseSuccess:FALSE_SUCCESS.test(text),
      pass:response.status===200&&text.trim().length>0&&!FALSE_SUCCESS.test(text),
    };
    console.log(JSON.stringify(row));
    if(row.pass) return row;
    if(![502,503,504].includes(response.status)) throw new Error(label+' failed non-retriably');
    await new Promise(resolve=>setTimeout(resolve,1500));
  }
  throw new Error(label+' exhausted retries');
}

async function main(){
  const first=await send(
    'pace-first-confirm-and-learn',
    'd5d5d5d5-0001-4d5d-8d5d-000000000021',
    'ไม่อยากเหนื่อยมากครับ',
    'phase3-prod3-pace-first'
  );

  await new Promise(resolve=>setTimeout(resolve,2000));

  const replay=await send(
    'pace-cross-customer-exact-replay',
    'd5d5d5d5-0002-4d5d-8d5d-000000000022',
    'ไม่อยากเหนื่อยมากนะครับ',
    'phase3-prod3-pace-replay'
  );

  const negative=await send(
    'transaction-negative-control',
    'd5d5d5d5-0003-4d5d-8d5d-000000000023',
    'จองเลยครับ',
    'phase3-prod3-transaction-negative'
  );

  console.log(JSON.stringify({
    kind:'PHASE3_PRODUCTION_LEARNING_CERT',
    firstEventId:first.eventId,
    replayEventId:replay.eventId,
    negativeEventId:negative.eventId,
    pass:true,
  },null,2));
}

main().catch(error=>{
  console.error('PHASE3_PRODUCTION_LEARNING_CERT_FAILED',error instanceof Error?error.message:String(error));
  process.exit(1);
});
