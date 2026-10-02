// Phase 6.1 — Production E2E Natural Response
//
// Read-only smoke against the REAL deployed customer gateway. This does not
// call local composer functions. Every assertion is made on the public
// response returned by production thongthai-chat.
//
// Safety contract:
// - every turn is price/status/information only;
// - no explicit booking/order/payment/redemption consent appears anywhere;
// - public intent must never be booking/order;
// - no completed-transaction wording may appear;
// - each request uses a synthetic UUID so production side-effects are auditable;
// - channel presentation changes are allowed, business truth is not.

const PRODUCTION_URL=process.env.THONGTHAI_PRODUCTION_URL
  ?? 'https://tamma-chat.netlify.app/.netlify/functions/thongthai-chat';

type Language='th'|'en'|'zh'|'lo'|'vi';
type Channel='web'|'line'|'facebook';

type Probe={
  id:string;
  channel:Channel;
  language:Language;
  message:string;
  kind:'price'|'availability_clarification';
  required:RegExp[];
};

const probes:Probe[]=[
  {id:'price-th-line',channel:'line',language:'th',message:'ขี่ม้า 30 นาทีราคาเท่าไหร่ครับ',kind:'price',required:[/300/u]},
  {id:'price-en-line',channel:'line',language:'en',message:'How much is a 30-minute horse ride?',kind:'price',required:[/300/u]},
  {id:'price-en-web',channel:'web',language:'en',message:'How much is a 30-minute horse ride?',kind:'price',required:[/300/u]},
  {id:'price-en-facebook',channel:'facebook',language:'en',message:'How much is a 30-minute horse ride?',kind:'price',required:[/300/u]},
  {id:'price-zh-facebook',channel:'facebook',language:'zh',message:'骑马30分钟多少钱？',kind:'price',required:[/300/u]},
  {id:'price-lo-line',channel:'line',language:'lo',message:'ຂີ່ມ້າ 30 ນາທີ ລາຄາເທົ່າໃດ?',kind:'price',required:[/300/u]},
  {id:'price-vi-web',channel:'web',language:'vi',message:'Cưỡi ngựa 30 phút giá bao nhiêu?',kind:'price',required:[/300/u]},

  {id:'clarify-th-web',channel:'web',language:'th',message:'มีห้องว่างไหมครับ',kind:'availability_clarification',required:[/วัน|วันที่/u]},
  {id:'clarify-en-line',channel:'line',language:'en',message:'Do you have a room available?',kind:'availability_clarification',required:[/date|day|when/iu]},
  {id:'clarify-zh-facebook',channel:'facebook',language:'zh',message:'有空房吗？',kind:'availability_clarification',required:[/日期|哪天|哪一天|入住/u]},
  {id:'clarify-lo-line',channel:'line',language:'lo',message:'ມີຫ້ອງວ່າງບໍ?',kind:'availability_clarification',required:[/ວັນ|ວັນທີ/u]},
  {id:'clarify-vi-web',channel:'web',language:'vi',message:'Còn phòng trống không?',kind:'availability_clarification',required:[/ngày|khi nào/iu]},
];

const FALSE_TRANSACTION=/(?:จองเรียบร้อย|ยืนยันการจองแล้ว|เลขที่จอง|booked|reserved|confirmed booking|order submitted|已预订|预订成功|đã đặt|đặt phòng thành công|ຈອງແລ້ວ)/iu;
const THAI_CANONICAL_NAME=/(?:ทองไทย|ภาราดร|ทำมา-ชาติ|ตำมา-ชาติ|อินทนิน)/gu;
const THAI_SCRIPT=/[ก-๙]/u;

function guestId(runId:string,index:number):string{
  const runHex=BigInt(runId).toString(16).slice(-12).padStart(12,'0');
  const indexHex=index.toString(16).padStart(4,'0').slice(-4);
  return `f6f6f6f6-${indexHex}-4610-8610-${runHex}`;
}

function languagePass(language:Language,message:string):{pass:boolean;reason:string|null}{
  const clean=message.replace(THAI_CANONICAL_NAME,'');
  if(language!=='th' && THAI_SCRIPT.test(clean)){
    return {pass:false,reason:'thai_language_leak'};
  }
  if(language==='th'){
    if(!/[ก-๙]/u.test(message)) return {pass:false,reason:'missing_thai'};
    if(/ค่ะ|คะ(?![ก-๙])/u.test(message)) return {pass:false,reason:'wrong_thai_polite_particle'};
    return {pass:true,reason:null};
  }
  if(language==='en'){
    return /[A-Za-z]/u.test(message)
      ? {pass:true,reason:null}:{pass:false,reason:'missing_english'};
  }
  if(language==='zh'){
    return /[㐀-鿿]/u.test(message)
      ? {pass:true,reason:null}:{pass:false,reason:'missing_chinese'};
  }
  if(language==='lo'){
    return /[຀-໿]/u.test(message)
      ? {pass:true,reason:null}:{pass:false,reason:'missing_lao'};
  }
  return /[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/iu.test(message)
    ? {pass:true,reason:null}:{pass:false,reason:'missing_vietnamese'};
}

async function main(){
  const runId=String(Date.now());
  const results:Array<Record<string,unknown>>=[];

  for(let index=0;index<probes.length;index+=1){
    const probe=probes[index]!;
    const syntheticGuestId=guestId(runId,index);
    const eventId=`phase6-1-prod-${runId}-${index+1}`;
    const response=await fetch(PRODUCTION_URL,{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({
        guestId:syntheticGuestId,
        eventId,
        message:probe.message,
        language:probe.language,
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
        pageContext:{section:probe.channel},
      }),
    });

    const payload=await response.json().catch(()=>({})) as Record<string,unknown>;
    const message=typeof payload.message==='string'?payload.message:'';
    const intent=typeof payload.intent==='string'?payload.intent:null;
    const languageCheck=languagePass(probe.language,message);
    const missing=probe.required.filter(pattern=>!pattern.test(message)).map(pattern=>pattern.source);
    const falseTransaction=FALSE_TRANSACTION.test(message);
    const unsafeIntent=intent==='booking'||intent==='order'||intent==='payment';
    const pass=response.status===200
      && message.trim().length>0
      && languageCheck.pass
      && missing.length===0
      && !falseTransaction
      && !unsafeIntent;

    const row={
      id:probe.id,
      channel:probe.channel,
      language:probe.language,
      kind:probe.kind,
      guestId:syntheticGuestId,
      eventId,
      request:probe.message,
      httpStatus:response.status,
      intent,
      response:message,
      missing,
      languageFailure:languageCheck.reason,
      falseTransaction,
      unsafeIntent,
      pass,
    };
    results.push(row);
    console.log(JSON.stringify(row));
    if(!pass){
      console.error(JSON.stringify({kind:'PHASE6_1_PRODUCTION_E2E_FAILED',...row},null,2));
      process.exit(1);
    }
  }

  const englishPrice=results.filter(row=>row.kind==='price'&&row.language==='en');
  const parity=englishPrice.length===3
    && englishPrice.every(row=>String(row.response).includes('300'));

  const summary={
    kind:'PHASE6_1_PRODUCTION_E2E_NATURAL_RESPONSE',
    productionUrl:PRODUCTION_URL,
    total:results.length,
    passed:results.filter(row=>row.pass===true).length,
    failed:results.filter(row=>row.pass!==true).length,
    falseTransactionsDetected:results.filter(row=>row.falseTransaction===true||row.unsafeIntent===true).length,
    englishChannelPriceParity:parity,
    guestIds:results.map(row=>row.guestId),
  };
  console.log(JSON.stringify(summary,null,2));
  if(!parity) process.exit(1);
}

main().catch(error=>{
  console.error('PHASE6_1_PRODUCTION_E2E_CRASH',error instanceof Error?error.message:String(error));
  process.exit(1);
});
