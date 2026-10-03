const PRODUCTION_URL = process.env.THONGTHAI_PRODUCTION_URL
  ?? 'https://tamma-chat.netlify.app/.netlify/functions/thongthai-chat';

type Case = {
  id:string;
  language:string;
  message:string;
  accepts:(reply:string)=>boolean;
  forbids?:RegExp[];
};

const cases:Case[] = [
  {
    id:'de-domestic-shipping',
    language:'de-DE',
    message:'Wie hoch sind die Versandkosten innerhalb Thailands bei einem Warenwert von 1.000 Baht? Bitte antworte auf Deutsch.',
    accepts:reply=>/60/u.test(reply) && /(?:Versand|Liefer|Thailand|Baht)/iu.test(reply),
    forbids:[/ครับ|ค่ะ|คะ/u],
  },
  {
    id:'sv-foreign-market',
    language:'sv-SE',
    message:'Kan ni skicka OTOP-produkter till Sverige? Om fraktpriset inte är bekräftat ännu, säg det tydligt. Svara på svenska.',
    accepts:reply=>/(?:Sverige|frakt|skicka|leverans|bekräft)/iu.test(reply),
    forbids:[/ครับ|ค่ะ|คะ/u,/(?:USD|THB|SEK)\s*[0-9]+(?:\.[0-9]+)?\s*(?:flat|fast|fixed)/iu],
  },
  {
    id:'es-foreign-market',
    language:'es-ES',
    message:'¿Pueden enviar productos OTOP a España? Si todavía no hay una tarifa internacional verificada, dímelo claramente en español.',
    accepts:reply=>/(?:España|env[ií]o|enviar|tarifa|verific)/iu.test(reply),
    forbids:[/ครับ|ค่ะ|คะ/u],
  },
  {
    id:'ja-domestic-free-shipping',
    language:'ja-JP',
    message:'タイ国内で商品合計が2,000バーツの場合、送料はいくらですか。日本語で答えてください。',
    accepts:reply=>/2.?000|2000/u.test(reply) && /(?:送料|無料|タイ|バーツ)/u.test(reply),
    forbids:[/ครับ|ค่ะ|คะ/u],
  },
  {
    id:'ar-foreign-market',
    language:'ar',
    message:'هل يمكن شحن منتجات OTOP إلى السويد؟ إذا لم تكن تكلفة الشحن الدولية مؤكدة بعد، فقل ذلك بوضوح وبالعربية.',
    accepts:reply=>/[\u0600-\u06FF]/u.test(reply) && reply.trim().length>20,
    forbids:[/ครับ|ค่ะ|คะ/u],
  },
];

function guestId(index:number):string {
  const tail=(BigInt(Date.now())+BigInt(index)).toString(16).slice(-12).padStart(12,'0');
  return `b6b6b6b6-0303-4b6b-8b6b-${tail}`;
}

async function main(){
  const results:Array<Record<string,unknown>>=[];
  for(let i=0;i<cases.length;i+=1){
    const tc=cases[i]!;
    const gid=guestId(i);
    try{
      const response=await fetch(PRODUCTION_URL,{
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({
          guestId:gid,
          eventId:`worldwide-language-cert-${tc.id}-${Date.now()}`,
          message:tc.message,
          language:tc.language,
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
          pageContext:{section:'web'},
        }),
      });
      const payload=await response.json().catch(()=>({})) as {message?:unknown};
      const reply=typeof payload.message==='string'?payload.message:'';
      const forbidden=(tc.forbids??[]).filter(re=>re.test(reply)).map(re=>re.source);
      const pass=response.status===200 && tc.accepts(reply) && forbidden.length===0;
      const row={id:tc.id,guestId:gid,httpStatus:response.status,reply,forbidden,pass};
      results.push(row);
      console.log(JSON.stringify(row));
    }catch(error){
      const row={id:tc.id,guestId:gid,httpStatus:0,reply:'',pass:false,error:error instanceof Error?error.message:String(error)};
      results.push(row);
      console.log(JSON.stringify(row));
    }
  }
  const failed=results.filter(row=>row.pass!==true);
  console.log(JSON.stringify({
    kind:'THONGTHAI_WORLDWIDE_CUSTOMER_PRODUCTION_CERTIFICATION',
    total:results.length,
    passed:results.length-failed.length,
    failed:failed.length,
    failedCases:failed.map(row=>row.id),
  },null,2));
  if(failed.length)process.exit(1);
}

main().catch(error=>{
  console.error('THONGTHAI_WORLDWIDE_CERT_CRASHED',error instanceof Error?error.message:String(error));
  process.exit(1);
});
