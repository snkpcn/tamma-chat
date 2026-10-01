import { createHash } from 'node:crypto';

const url='https://tamma-chat.netlify.app/.netlify/functions/thongthai-chat';
const cases=[
  ['01d0f5b6-33c2-556d-8857-b47196bcea02','prod-agent-canary25-postfix-g1','ขี่ม้ามีราคาเท่าไหร่ แล้วเหมาะกับมือใหม่ไหมครับ'],
  ['3f0578fd-8c43-5e0f-bdcf-03b1fe89dc2f','prod-agent-canary25-postfix-g2','เฮือนสเตย์มีห้องแบบไหน เช็กอินเช็กเอาต์กี่โมงครับ'],
  ['93b97c85-c141-5a25-b619-c51f7c357203','prod-agent-canary25-postfix-g3','แฟนแพ้กุ้งและไม่กินเผ็ด มีเมนูอะไรแนะนำ 3 อย่างครับ'],
  ['7583f891-4af1-5f27-bb23-fdfe6403ecef','prod-agent-canary25-postfix-g4','มากับเด็กกับผู้สูงอายุ อยากทำกิจกรรมเบาๆ แนะนำหน่อยครับ'],
  ['2045a4c2-32ed-5271-9a86-aba178142f30','prod-agent-canary25-postfix-g5','OTOP มีอะไรน่าสนใจบ้าง เล่าแบบสั้นๆ ให้หน่อยครับ'],
  ['2eb516cc-d1a1-51bb-bc31-b866168b01c6','prod-agent-canary25-postfix-g6','ถ้ามีเวลาครึ่งวัน อยากกินข้าวและทำกิจกรรมหนึ่งอย่าง แนะนำแบบสบายๆ ครับ'],
];

function bucket(guestId){
  const digest=createHash('sha256').update(`thongthai-agent-primary:${guestId}`,'utf8').digest('hex');
  return parseInt(digest.slice(0,8),16)%10000;
}

for(const [guestId,eventId,message] of cases){
  const b=bucket(guestId);
  if(b>=2500)throw new Error(`outside 25% bucket: ${guestId} -> ${b}`);
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),45000);
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
console.log('PRODUCTION_AGENT_CANARY25_POSTFIX_SMOKE_PASS');
