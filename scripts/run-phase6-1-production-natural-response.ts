import { randomUUID } from 'node:crypto';

const URL=process.env.THONGTHAI_PRODUCTION_URL ?? 'https://tamma-chat.netlify.app/.netlify/functions/thongthai-chat';
const guestId=randomUUID();
const turns=[
'อินทนินตรงตาดโตนมีอะไรแนะนำบ้างครับ',
'ผมหมายถึงเครื่องดื่มนะครับ ไม่ได้ถามของกิน',
'อยากได้อะไรเย็นๆ ไม่หวานมาก แต่ก็ไม่เอาขมมากครับ',
'ถ้าไม่กินกาแฟ มีอะไรแนะนำบ้างครับ',
'ถามเผื่อแฟนนะครับ แต่วันนี้ผมมาคนเดียว',
'เอาจริงๆ ยังไม่สั่งนะครับ แค่เลือกไว้ก่อน',
'เมื่อกี้ตัวที่ไม่ใช่กาแฟ มีอะไรนะครับ',
'แล้วถ้าไม่เอานมวัว มีตัวเลือกไหมครับ',
'ไม่ใช่ครับ ผมไม่ได้แพ้นม แค่ช่วงนี้ไม่ค่อยอยากกินนมวัว',
'งั้นกลับมาดูกาแฟก็ได้ครับ',
'เอาเย็นนะครับ แต่ไม่ใส่น้ำตาลเลยทำได้ไหม',
'เดี๋ยวก่อนครับ ยังไม่ต้องทำรายการนะ',
'ร้านวันนี้เปิดถึงกี่โมงครับ',
'ที่จอดรถสะดวกไหมครับ',
'กลับมาเรื่องเครื่องดื่มครับ เมื่อกี้ผมสนใจอะไรไว้',
'ตอนนี้มีรายการอะไรของผมถูกส่งไปที่ร้านหรือยังครับ',
'ขอบคุณครับ เดี๋ยวแวะไปครับ',
] as const;

const forbidden=/ลาบปลาช่อน|คอหมูย่าง|เสือร้องไห้|คิดช้ากว่าปกติ|ลองพิมพ์อีกครั้งในอีกสักครู่/u;
const results:any[]=[];
for(let i=0;i<turns.length;i++){
  const response=await fetch(URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
    guestId,eventId:`messenger-prod-${guestId}-${i+1}`,message:turns[i],language:'th',chatHistory:[],
    guestContext:{tripDuration:null,travelerType:null,group:{adults:null,children:null,elderly:null},interests:[],pace:null,budget:null,constraints:[]},
    journeyContext:{currentPlan:null,savedPlan:null,visitedExperiences:[],favorites:[],journalEntries:[]},
    pageContext:{section:'facebook'},
  })});
  const payload=await response.json().catch(()=>({})) as Record<string,unknown>;
  const reply=String(payload.message??'');
  const missing:string[]=[];
  let pass=response.status===200&&reply.length>0&&!forbidden.test(reply);
  if(i===0&&!/อินทนิน|Inthanin|คาเฟ่/u.test(reply)){pass=false;missing.push('cafe_domain');}
  if(i===2&&(!/หวานน้อย/u.test(reply)||!/ขม/u.test(reply))){pass=false;missing.push('taste');}
  if(i===3&&!/ไม่เอากาแฟ|ไม่.*กาแฟ/u.test(reply)){pass=false;missing.push('no_coffee');}
  if(i===4&&!/คนเดียว/u.test(reply)){pass=false;missing.push('solo');}
  if(i===5&&!/ยังไม่ได้สั่ง|ไม่ได้สั่ง|ยังไม่.*สั่ง/u.test(reply)){pass=false;missing.push('no_order');}
  if(i===8&&!/ไม่ใช่.*แพ้|ไม่ใช่อาการแพ้/u.test(reply)){pass=false;missing.push('not_allergy');}
  if(i===9&&/ไม่เอากาแฟ/u.test(reply)){pass=false;missing.push('coffee_not_restored');}
  if(i===10&&!/ไม่ใส่น้ำตาล/u.test(reply)){pass=false;missing.push('no_sugar');}
  if(i===12&&!/ไม่มีข้อมูล.*เวลา|ไม่ขอเดา/u.test(reply)){pass=false;missing.push('hours');}
  if(i===13&&!/ที่จอดรถ|ไม่ขอเดา/u.test(reply)){pass=false;missing.push('parking');}
  if(i===15&&!/ยังไม่มี.*ส่ง|ยังไม่ได้.*ส่ง|ไม่มีคำสั่ง.*ส่ง/u.test(reply)){pass=false;missing.push('status');}
  const row={turn:i+1,request:turns[i],httpStatus:response.status,intent:payload.intent??null,response:reply,missing,pass};
  results.push(row); console.log(JSON.stringify(row));
}
const failed=results.filter(x=>!x.pass);
console.log(JSON.stringify({kind:'MESSENGER_PRODUCTION_CERT',guestId,total:results.length,passed:results.length-failed.length,failed:failed.length,failedTurns:failed.map(x=>x.turn)},null,2));
if(failed.length) process.exit(1);
