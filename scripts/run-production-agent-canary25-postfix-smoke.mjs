import { createHash } from 'node:crypto';

const url='https://tamma-chat.netlify.app/.netlify/functions/thongthai-chat';
const cases=[
  ['cf7173ae-68b3-5683-b739-5a30bd6e61c8','prod-agent-canary25-postfix-r1','มากับเด็กกับผู้สูงอายุ อยากทำกิจกรรมเบาๆ แนะนำหน่อยครับ'],
  ['9c3ec1fb-7b12-5929-9676-85fafcf4ddea','prod-agent-canary25-postfix-r2','OTOP มีอะไรน่าสนใจบ้าง เล่าแบบสั้นๆ ให้หน่อยครับ'],
  ['a321a386-4f7c-5245-aed4-bd780c3611d8','prod-agent-canary25-postfix-r3','ถ้ามีเวลาครึ่งวัน อยากกินข้าวและทำกิจกรรมหนึ่งอย่าง แนะนำแบบสบายๆ ครับ'],
];

function bucket(guestId){
  const digest=createHash('sha256').update(`thongthai-agent-primary:${guestId}`,'utf8').digest('hex');
  return parseInt(digest.slice(0,8),16)%10000;
}

for(const [guestId,eventId,message] of cases){
  const b=bucket(guestId);
  if(b>=2500)throw new Error(`outside 25% bucket: ${guestId} -> ${b}`);
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),60000);
  let response;
  try{
    response=await fetch(url,{
      method:'POST',
      signal:controller.signal,
      headers:{'content-type':'application/json'},
      body:JSON.stringify({
        guestId,eventId,message,language:'th',
        chatHistory:[],guestContext:{},journeyContext:{},pageContext:{section:'home'},
      }),
    });
  }finally{clearTimeout(timer);}
  const text=await response.text();
  if(!response.ok)throw new Error(`${eventId}: HTTP ${response.status} ${text.slice(0,240)}`);
  const payload=JSON.parse(text);
  if(typeof payload?.message!=='string'||!payload.message.trim())throw new Error(`${eventId}: missing message`);
  if(!/ครับ/u.test(payload.message))throw new Error(`${eventId}: male persona missing: ${payload.message.slice(0,240)}`);
  if(/ลองใหม่|คิดช้ากว่าปกติ|AI provider not configured|request failed/iu.test(payload.message)){
    throw new Error(`${eventId}: degraded reply: ${payload.message.slice(0,240)}`);
  }
  console.log(JSON.stringify({eventId,guestId,bucket:b,message:payload.message}));
}
console.log('PRODUCTION_AGENT_CANARY25_POSTFIX_RETRY_PASS');
