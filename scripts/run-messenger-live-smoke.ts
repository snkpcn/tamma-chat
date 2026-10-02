const URL = 'https://tamma-chat.netlify.app/.netlify/functions/thongthai-chat';

const guestId = 'f9f9f9f9-0251-4f9f-8f9f-' + BigInt(Date.now()).toString(16).slice(-12).padStart(12,'0');
const turns = [
  'อินทนินตรงตาดโตนมีอะไรแนะนำบ้างครับ',
  'ผมหมายถึงเครื่องดื่มนะครับ ไม่ได้ถามของกิน',
  'อยากได้อะไรเย็นๆ ไม่หวานมาก แต่ก็ไม่เอาขมมากครับ',
  'เอาจริงๆ ยังไม่สั่งนะครับ แค่เลือกไว้ก่อน',
  'ร้านวันนี้เปิดถึงกี่โมงครับ',
  'ตอนนี้มีรายการอะไรของผมถูกส่งไปที่ร้านหรือยังครับ',
];

const forbidden = [
  /ลาบปลาช่อน|คอหมูย่าง|เสือร้องไห้/u,
  /คิดช้ากว่าปกติ|ลองพิมพ์อีกครั้งในอีกสักครู่/u,
  /ส่ง.*ร้านแล้ว|ส่งรายการแล้ว|จองเรียบร้อย/u,
];

const must = [
  /อินทนิน|Inthanin/u,
  /เครื่องดื่ม|คาเฟ่|อินทนิน|Inthanin/u,
  /หวานน้อย/u,
  /ยังไม่ได้สั่ง|ไม่ได้สั่ง|ยังไม่ดำเนินการ/u,
  /เวลา|เปิดปิด|ไม่ขอเดา|ไม่มีข้อมูล/u,
  /ยังไม่มี.*ส่ง|ยังไม่ได้.*ส่ง|ไม่มีรายการ/u,
];

const results = [];
for (let i=0;i<turns.length;i++) {
  const body = {
    guestId,
    eventId:`messenger-live-${guestId}-${i+1}`,
    message:turns[i],
    language:'th',
    chatHistory:[],
    guestContext:{
      tripDuration:null,travelerType:null,
      group:{adults:null,children:null,elderly:null},
      interests:[],pace:null,budget:null,constraints:[],
    },
    journeyContext:{
      currentPlan:null,savedPlan:null,visitedExperiences:[],favorites:[],journalEntries:[],
    },
    pageContext:{section:'facebook'},
  };
  const res = await fetch(URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const payload = await res.json().catch(()=>({}));
  const message = typeof payload.message === 'string' ? payload.message : '';
  const pass = res.status===200 && must[i].test(message) && forbidden.every(re=>!re.test(message));
  const row={turn:i+1,guestId,request:turns[i],httpStatus:res.status,response:message,pass};
  results.push(row);
  console.log(JSON.stringify(row));
}
const failed=results.filter(x=>!x.pass);
console.log(JSON.stringify({kind:'MESSENGER_LIVE_SMOKE',guestId,total:results.length,passed:results.length-failed.length,failed:failed.length,failedTurns:failed.map(x=>x.turn)},null,2));
if(failed.length) process.exit(1);
