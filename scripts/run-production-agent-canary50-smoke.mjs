import { createHash } from 'node:crypto';
const url='https://tamma-chat.netlify.app/.netlify/functions/thongthai-chat';
const guestId='cfd1508b-812c-5a58-af33-8c45c40820ec';
const eventId='prod-agent-canary50-newcohort-b';
const message='แฟนแพ้กุ้งและไม่กินเผ็ด มีเมนูอะไรที่กินได้บ้าง แนะนำสั้นๆ ครับ';
const digest=createHash('sha256').update(`thongthai-agent-primary:${guestId}`,'utf8').digest('hex');
const bucket=parseInt(digest.slice(0,8),16)%10000;
if(bucket<2500||bucket>=5000)throw new Error(`guest not in 25-50 cohort: ${bucket}`);
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
if(!response.ok)throw new Error(`HTTP ${response.status}: ${text.slice(0,240)}`);
const payload=JSON.parse(text);
if(typeof payload?.message!=='string'||!payload.message.trim())throw new Error('missing customer response');
if(/ลองใหม่|คิดช้ากว่าปกติ|AI provider not configured|request failed/iu.test(payload.message))throw new Error(`degraded reply: ${payload.message.slice(0,240)}`);
console.log(JSON.stringify({eventId,guestId,bucket,message:payload.message}));
console.log('PRODUCTION_AGENT_CANARY50_NEW_COHORT_B_PASS');
