// Live owner-acceptance certification for Thongthai v5.
//
// Replays the exact conversational failure classes found in the owner's real
// LINE test. Every turn is read-only/consider-only; this script never
// authorizes a booking, order, payment, or staff submission.
//
// Important: chatHistory is deliberately EMPTY on every request, matching
// LINE/Messenger webhook reality. Continuity must come from Thongthai's
// server-side bounded/durable memory, not from a client-provided transcript.

const PRODUCTION_URL = process.env.THONGTHAI_PRODUCTION_URL
  ?? 'https://tamma-chat.netlify.app/.netlify/functions/thongthai-chat';

const MESSAGES = [
  'วันนี้มากับแฟนครับ ผมชอบกาแฟเข้ม ๆ แต่แฟนไม่กินกาแฟ แล้วเราสองคนไม่ชอบหวานมาก ช่วยเลือกให้คนละแก้วหน่อยครับ',
  'ของผมขอเย็นนะครับ ส่วนของแฟนอยากได้อะไรหอม ๆ ดื่มง่ายหน่อย',
  'แฟนเปลี่ยนใจครับ ไม่เอานมวัวด้วย แต่ไม่ได้แพ้นมนะ แค่ช่วงนี้ไม่อยากกิน',
  'แล้วของผมถ้าไม่ใส่น้ำตาลเลยได้ไหมครับ ราคาเท่าไหร่',
  'ส่วนของแฟนเมื่อกี้ ตัวไหนขมน้อยสุดครับ',
  'โอเค เอาไว้ก่อนนะครับ ยังไม่สั่ง แค่เลือกไว้ก่อน',
  'ระหว่างรออยากหาอะไรกินด้วยครับ ที่ร้านอาหารมีอะไรแนะนำสำหรับสองคนบ้าง',
  'แฟนแพ้กุ้งครับ แต่ผมกินได้ มีอะไรที่เหมาะกับเราสองคนบ้าง',
  'อ้อ เมื่อกี้ไม่ได้หมายความว่าเราไม่กินเผ็ดทั้งคู่นะครับ แฟนไม่กินเผ็ด แต่ผมกินเผ็ดได้',
  'งั้นถ้าจะเลือกประมาณ 3 อย่างให้กินด้วยกัน เลือกอะไรดีครับ',
  'กินเสร็จถ้ายังมีเวลา อยากขี่ม้ากันครับ มีตัวไหนเหมาะกับคนที่ไม่เคยขี่มาก่อนบ้าง',
  'ไม่เอาน้องทองไทยครับ ขออีกตัว แล้วแฟนค่อนข้างกลัวตกด้วย',
  'ตัวนั้นขี่ 30 นาทีกับ 45 นาทีต่างกันยังไงครับ แต่ยังไม่จองนะ',
  'กลับมาเรื่องเครื่องดื่มหน่อยครับ ของแฟนเมื่อกี้สุดท้ายเราเลือกแนวไหนไว้นะ',
  'ตอนนี้จากที่คุยมาทั้งหมด มีอะไรถูกสั่ง จอง หรือส่งไปให้พนักงานแล้วบ้างครับ',
] as const;

type Payload = Record<string,unknown> & {message?:unknown;intent?:unknown};
type Check = {pass:boolean;reason:string};

const noTransaction = (s:string) =>
  /ยัง.{0,24}ไม่.{0,16}(?:สั่ง|จอง|ส่ง)|ไม่ได้.{0,24}(?:สั่ง|จอง|ส่ง)|ไม่มี.{0,24}(?:รายการ|คำสั่ง)/u.test(s);
const noGenericSystemDump = (s:string) =>
  !/สนใจ:\s*กิจกรรม|ความชอบ\/ข้อจำกัดที่เคยแจ้งไว้|ตัวเลือกที่ยืนยันได้ตอนนี้มี\s*ATV/u.test(s);

function evaluate(turn:number,message:string):Check{
  const hasCafeCoffee=/อเมริกาโน่|เอสเพรสโซ่|คาเฟ่ลาเต้|คาราเมล\s*มัคคิอาโต้/u.test(message);
  const hasCafeNonCoffee=/มัทฉะ|ชาไทย|ชาเขียว|โกโก้|ชามะนาว|นมสด|นมชมพู/u.test(message);
  const rules:Record<number,()=>boolean>={
    1:()=>hasCafeCoffee&&hasCafeNonCoffee&&!/ตัดฝั่งกาแฟออก/u.test(message),
    2:()=>/ของคุณ|ของผม|อเมริกาโน่|กาแฟ/u.test(message)&&!/จับชื่อเมนูยังไม่ชัวร์/u.test(message),
    3:()=>/แฟน/u.test(message)&&/ไม่ได้แพ้|ไม่ใช่.{0,12}แพ้|ไม่ตีความ.{0,16}แพ้/u.test(message),
    4:()=>/บาท/u.test(message)&&!/พิมพ์ชื่อเมนูอีก/u.test(message),
    5:()=>hasCafeNonCoffee||/ยืนยัน.{0,16}(?:ขม|รสชาติ).*ไม่ได้|ไม่อยากเดา/u.test(message),
    6:()=>noTransaction(message),
    7:()=>/คอหมู|ไก่|ไข่|ข้าว|เมนู|บาท/u.test(message),
    8:()=>/กุ้ง/u.test(message)&&!/แนะนำ.{0,100}ต้มยำกุ้ง/u.test(message),
    9:()=>/แฟน|เผ็ด/u.test(message),
    10:()=>((message.match(/บาท/gu)??[]).length>=2||/3\s*อย่าง|สามอย่าง/u.test(message)),
    11:()=>/ทองไทย|ภาราดร/u.test(message)&&!/°C|เมฆมาก|อุณหภูมิ/u.test(message),
    12:()=>/ภาราดร/u.test(message)&&!/ATV\s*1|ช่องยิง\s*1/u.test(message)&&noTransaction(message),
    13:()=>/30\s*นาที/u.test(message)&&/45\s*นาที/u.test(message)&&noTransaction(message),
    14:()=>/มัทฉะ|ชา|โกโก้|เครื่องดื่ม|Inthanin|อินทนิน/u.test(message)&&noGenericSystemDump(message),
    15:()=>noTransaction(message)&&noGenericSystemDump(message),
  };
  const pass=Boolean(rules[turn]?.()) && message.trim().length>0;
  return {pass,reason:pass?'ok':`turn_${turn}_acceptance_failed`};
}

function guestId():string{
  const suffix=BigInt(Date.now()).toString(16).slice(-12).padStart(12,'0');
  return `a5a5a5a5-0303-4a5a-8a5a-${suffix}`;
}

async function main(){
  const gid=guestId();
  const results:Array<Record<string,unknown>>=[];
  for(let i=0;i<MESSAGES.length;i+=1){
    const request=MESSAGES[i]!;
    try{
      const response=await fetch(PRODUCTION_URL,{
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({
          guestId:gid,
          eventId:`v5-owner-${gid}-${i+1}`,
          message:request,
          language:'th',
          chatHistory:[],
          guestContext:{
            tripDuration:null,travelerType:null,
            group:{adults:null,children:null,elderly:null},
            interests:[],pace:null,budget:null,constraints:[],
          },
          journeyContext:{
            currentPlan:null,savedPlan:null,
            visitedExperiences:[],favorites:[],journalEntries:[],
          },
          pageContext:{section:'line'},
        }),
      });
      const payload=await response.json().catch(()=>({})) as Payload;
      const answer=typeof payload.message==='string'?payload.message:'';
      const check=evaluate(i+1,answer);
      const row={turn:i+1,guestId:gid,httpStatus:response.status,request,response:answer,intent:payload.intent??null,...check};
      results.push(row);
      console.log(JSON.stringify(row));
    }catch(error){
      const row={turn:i+1,guestId:gid,httpStatus:0,request,response:'',pass:false,reason:error instanceof Error?error.message:String(error)};
      results.push(row);
      console.log(JSON.stringify(row));
    }
  }
  const failed=results.filter(row=>row.pass!==true);
  console.log(JSON.stringify({
    kind:'THONGTHAI_V5_OWNER_PRODUCTION_CERTIFICATION',
    guestId:gid,
    productionUrl:PRODUCTION_URL,
    total:results.length,
    passed:results.length-failed.length,
    failed:failed.length,
    failedTurns:failed.map(row=>row.turn),
  },null,2));
  if(failed.length)process.exit(1);
}

main().catch(error=>{
  console.error('THONGTHAI_V5_OWNER_CERT_CRASHED',error instanceof Error?error.message:String(error));
  process.exit(1);
});
