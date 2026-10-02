async function main(){
  const URL='https://tamma-chat.netlify.app/.netlify/functions/thongthai-chat';
  const guestId='f5f5f5f5-0202-45f5-85f5-d8d913915334';
  const eventId='messenger-local-prod-cert-d8d9139-1';
  const message='ผมมาแถวตาดโตนคนเดียว มีเวลาประมาณชั่วโมงครึ่ง อยากได้อะไรชิลๆ ไม่รีบ ช่วยแนะนำหน่อยครับ แต่ยังไม่จองอะไรนะ';

  const response=await fetch(URL,{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({
      guestId,eventId,message,language:'th',chatHistory:[],
      guestContext:{tripDuration:null,travelerType:null,group:{adults:null,children:null,elderly:null},interests:[],pace:null,budget:null,constraints:[]},
      journeyContext:{currentPlan:null,savedPlan:null,visitedExperiences:[],favorites:[],journalEntries:[]},
      pageContext:{section:'facebook'},
    }),
  });
  const payload=await response.json().catch(()=>({})) as Record<string,unknown>;
  const reply=String(payload.message??'');
  console.log(JSON.stringify({guestId,eventId,httpStatus:response.status,intent:payload.intent??null,response:reply},null,2));
  if(response.status!==200) throw new Error('HTTP '+response.status);
  if(/ตอบเรื่องนี้ให้แม่นไม่ได้|ลองอีกครั้งสักครู่|คิดช้ากว่าปกติ/u.test(reply)) throw new Error('generic fallback: '+reply);
  if(!/Inthanin|อินทนิน/u.test(reply)) throw new Error('missing cafe option: '+reply);
  if(!/ขี่ม้า|ATV|ยิงธนู/u.test(reply)) throw new Error('missing activity option: '+reply);
  if(!/ยังไม่.*จอง|ไม่ส่งจอง|ยังไม่ได้.*จอง/u.test(reply)) throw new Error('missing no-booking boundary: '+reply);
  console.log('MESSENGER_LOCAL_PROD_CERT_PASS');
}
main().catch(error=>{
  console.error('MESSENGER_LOCAL_PROD_CERT_FAIL',error instanceof Error?error.message:String(error));
  process.exit(1);
});
