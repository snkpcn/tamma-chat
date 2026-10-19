import { createHash } from 'node:crypto';
import { backendFetch } from './_backend-fetch';
import { reserveAiCall, finalizeAiCall, type AiCallContext, type AiCallReservation } from './_ai-cost-ledger';
import { WEB_SEARCH_MODEL } from './_ai-cost-policy';
import type { VisitorInformationAnswer } from './_visitor-information';

type SearchPlan = { query:string; relevant:RegExp; unit:RegExp|null };
type PublicSource = { title:string; url:string; excerpt:string; publishedAt:string|null };
export type VisitorSearchResult = {
  answer:VisitorInformationAnswer|null;
  status:'not_needed'|'backend_required'|'unconfigured'|'budget_blocked'|'found'|'no_match'|'unavailable';
  attempted:boolean; chargedThisTurn:boolean; cached:boolean; checkedAt?:string; sources:PublicSource[];
};
const cache = new Map<string,{expires:number;sources:PublicSource[];checkedAt:string;payer:string}>();
const inFlight = new Map<string,{work:Promise<VisitorSearchResult>;eventId:string}>();
const TTL_MS = 10*60*1000;

// Only fixed topic phrases leave the server: no customer text, chat history,
// booking IDs, phone numbers, dietary/medical details or private backend facts.
function searchPlan(message:string, answer:VisitorInformationAnswer|null):SearchPlan|null {
  if(/แพ้|สารก่อภูมิแพ้|อุบัติเหตุ|บาดเจ็บ|ร้องเรียน|ชำระ|โอนเงิน|เลข.*จอง|ขอคืนเงิน|จองให้|ยกเลิกให้|ส่งเรื่องให้|ติดต่อให้|ของหาย|สกปรก|ใช้งานไม่ได้|เสียหาย|(?:ช่วย|รบกวน|ดำเนินการ).{0,40}(?:จอง|ยกเลิก|คืนเงิน|สั่ง|ติดต่อ|ส่งเรื่อง)/u.test(message))return null;
  const topic=answer?.topic;
  if(topic==='stay_availability'||topic==='shipping'||topic==='product_origin'||topic==='group_tables')return null;
  if(topic==='horse_child_safety'||topic==='horse_weight'||topic==='boat_safety'||topic==='horse_instruction'||topic==='weather_changes')return null;
  const base='"ทำมา-ชาติ" "ตาดโตน" "ชัยภูมิ"';
  const topics:Record<string,[string,RegExp,RegExp|null]>={
    facilities:['สิ่งอำนวยความสะดวก ที่จอดรถ ห้องน้ำ',/ที่จอดรถ|ห้องน้ำ/u,null],
    accessibility:['ทางลาด รถเข็น วีลแชร์',/ทางลาด|รถเข็น|วีลแชร์/u,null],
    restaurant_opening:['ตำมา-ชาติ ร้านอาหาร เปิดบริการ',/ตำมา[-\s]?ชาติ|ร้านอาหาร/u,/ตำมา[-\s]?ชาติ|ร้านอาหาร/u],
    activity_opening:['กิจกรรม ATV ยิงธนู เปิดบริการ',/กิจกรรม|ATV|เอทีวี|ธนู|ขี่ม้า/iu,/กิจกรรม|ATV|เอทีวี|ธนู|ขี่ม้า/iu],
    stay_opening:['เฮือนสเตย์ ที่พัก เปิดบริการ ราคา',/เฮือนสเตย์|ที่พัก/u,/เฮือนสเตย์|ที่พัก/u],
    package:['แพ็กเกจ ที่พัก อาหาร กิจกรรม',/แพ็กเกจ|แพคเกจ/u,/เฮือนสเตย์|ที่พัก/u],
    horse_reference_quote:['ขี่ม้า ราคา ระยะเวลา',/ขี่ม้า/u,/ขี่ม้า/u],
    cafe_menu_reference:['อินทนิล ตาดโตน เมนู ราคา เบเกอรี',/เมนู|ราคา|บาท|เบเกอรี|ขนม/u,/อินทนิ[ลน]|คาเฟ่/u],
    food_browse:['ตำมา-ชาติ ร้านอาหาร เมนู',/เมนู|อาหาร/u,/ตำมา[-\s]?ชาติ|ร้านอาหาร/u],
    product_browse:['ของฝาก สินค้าชุมชน',/ของฝาก|สินค้า|ชุมชน/u,null],
  };
  if(answer && !answer.missingFields.length)return null;
  let entry=topic?topics[topic]:undefined;
  // Additional public venue questions that the current static FAQ lacks.
  if(!answer) {
    const publicTopics:Array<[RegExp,[string,RegExp,RegExp|null]]>=[
      [/ไวไฟ|wifi|wi-fi/iu,['WiFi อินเทอร์เน็ต',/ไวไฟ|wifi|wi-fi|อินเทอร์เน็ต/iu,null]],
      [/ชาร์จ.*รถ|รถ.*ชาร์จ|\bEV\b/iu,['จุดชาร์จรถไฟฟ้า EV',/ชาร์จ|รถไฟฟ้า|\bEV\b/iu,null]],
      [/เบอร์โทร|ติดต่อ.*ร้าน|เพจ.*ร้าน|ช่องทางติดต่อ/u,['เบอร์โทร ติดต่อ เพจ',/โทร|ติดต่อ|เพจ/u,null]],
      [/สนามเด็กเล่น|โซนเด็ก/u,['สนามเด็กเล่น โซนเด็ก',/สนามเด็กเล่น|โซนเด็ก/u,null]],
      [/สูบบุหรี่|สูบ.*บุหรี่/u,['พื้นที่สูบบุหรี่',/สูบบุหรี่/u,null]],
      [/นั่งทำงาน|ปลั๊กไฟ/u,['นั่งทำงาน ปลั๊กไฟ',/นั่งทำงาน|ปลั๊กไฟ/u,null]],
    ];
    entry=publicTopics.find(([pattern])=>pattern.test(message))?.[1];
  }
  if(!entry)return null;
  // A cafe source cannot answer an explicit accommodation/restaurant question.
  let unit=entry[2];
  if(/เฮือนสเตย์|ที่พัก|ห้องพัก/u.test(message))unit=/เฮือนสเตย์|ที่พัก|ห้องพัก/u;
  else if(/ร้านอาหาร|ตำมา[-\s]?ชาติ/u.test(message))unit=/ร้านอาหาร|ตำมา[-\s]?ชาติ/u;
  if(/สาขา(?!\s*ตาดโตน)|สาขาอื่น|ทุกสาขา/u.test(message))return null;
  const unitPhrase=unit?.source.includes('เฮือน')?' เฮือนสเตย์ ที่พัก':unit?.source.includes('ร้านอาหาร')?' ตำมา-ชาติ ร้านอาหาร':'';
  return {query:`${base} ${entry[0]}${unitPhrase}`,relevant:entry[1],unit};
}

function clean(value:unknown, max:number):string {
  return typeof value==='string'?value.replace(/<[^>]*>/gu,' ').replace(/[\u0000-\u001f\u007f]/gu,' ').replace(/\s+/gu,' ').trim().slice(0,max):'';
}
function publicSource(value:unknown, plan:SearchPlan):PublicSource|null {
  if(!value || typeof value!=='object')return null;
  const row=value as Record<string,unknown>;
  const title=clean(row.title,150),excerpt=clean(row.content,1000);
  let url:URL;try{url=new URL(String(row.url));}catch{return null;}
  if(url.protocol!=='https:' || url.username || url.password)return null;
  // Bounded public sources, never crawl arbitrary URLs or follow redirects.
  if(!['facebook.com','www.facebook.com','wongnai.com','www.wongnai.com','inthanincoffee.com','www.inthanincoffee.com'].includes(url.hostname))return null;
  const text=title+' '+excerpt;
  if(!/ตาดโตน/u.test(text)||!/ชัยภูมิ/u.test(text)||!/ทำมา[-\s]?ชาติ|อินทนิ[ลน]|inthanin/iu.test(text))return null;
  if(!plan.relevant.test(text)||(plan.unit&&!plan.unit.test(text)))return null;
  if(/ignore.{0,20}instructions|system prompt|api[_ -]?key|เพิกเฉย.*คำสั่ง/iu.test(excerpt))return null;
  return {title,url:url.href,excerpt:excerpt.slice(0,400),publishedAt:clean(row.published_date,80)||null};
}

export async function searchMissingVisitorInformation(input:{
  message:string;answer:VisitorInformationAnswer|null;context:AiCallContext;
}):Promise<VisitorSearchResult> {
  const plan=searchPlan(input.message,input.answer);
  const unknownAnswer:VisitorInformationAnswer={topic:'public_lookup',domain:'ecosystem',message:'ตอนนี้ยังไม่มีข้อมูลยืนยันเรื่องนี้สำหรับทำมา-ชาติ ตาดโตนครับ จึงยังรับรองรายละเอียดให้ไม่ได้ ควรตรวจสอบกับร้านก่อนเดินทางครับ',sourceIds:[],usedFactKeys:[],missingFields:['venue.public_information']};
  const empty=(status:VisitorSearchResult['status']):VisitorSearchResult=>({answer:input.answer ?? (plan?unknownAnswer:null),status,attempted:false,chargedThisTurn:false,cached:false,sources:[]});
  if(!plan)return empty(input.answer?.missingFields.length?'backend_required':'not_needed');
  const enabled=process.env.THONGTHAI_VISITOR_WEB_SEARCH==='1';
  const key=process.env.TAVILY_API_KEY?.trim();
  if(!enabled||!key)return {...empty('unconfigured'),answer:input.answer};
  const hash=createHash('sha256').update(plan.query).digest('hex');
  const payer=JSON.stringify([input.context.conversationId,input.context.eventId]);
  const render=(sources:PublicSource[],checkedAt:string,attempted:boolean,cached:boolean,chargedThisTurn=attempted):VisitorSearchResult=>{
    if(!sources.length)return {...empty('no_match'),attempted,chargedThisTurn,cached,checkedAt};
    const base=input.answer ?? {topic:'public_lookup' as const,domain:'ecosystem' as const,message:'',sourceIds:[],usedFactKeys:[],missingFields:['venue.public_information']};
    const section='พบข้อมูลเผยแพร่บนเว็บที่ตรงกับทำมา-ชาติ ตาดโตนครับ (ยังไม่ใช่การยืนยันสถานะล่าสุดจากร้าน)\n'
      +sources.map(source=>`• ${source.title}\nข้อความจากแหล่งข้อมูล: “${source.excerpt}”\n${source.url}${source.publishedAt?`\nวันที่เผยแพร่ตามแหล่งข้อมูล: ${source.publishedAt}`:''}`).join('\n\n')
      +`\nค้นเมื่อ ${checkedAt.slice(0,10)} ข้อมูลอาจเปลี่ยนได้ ควรยืนยันราคา เวลาเปิด และเงื่อนไขก่อนเดินทางครับ`;
    return {status:'found',attempted,chargedThisTurn,cached,checkedAt,sources,answer:{...base,
      message:[base.message,section].filter(Boolean).join('\n\n'),sourceIds:[...base.sourceIds,...sources.map(source=>source.url)],
      usedFactKeys:[...base.usedFactKeys,'web:public_reference'],
    }};
  };
  const hit=cache.get(hash);
  if(hit && hit.expires>Date.now())return render(hit.sources,hit.checkedAt,false,true,hit.payer===payer);
  // Dedupe concurrent work only within one conversation, preserving its ledger.
  const flightKey=input.context.conversationId+':'+hash;
  const pending=inFlight.get(flightKey);
  if(pending){const result=await pending.work;const chargedThisTurn=pending.eventId===input.context.eventId&&result.chargedThisTurn;return result.status==='found'?render(result.sources,result.checkedAt!,false,true,chargedThisTurn):{...empty(result.status),cached:true,chargedThisTurn};}
  const work=(async()=>{
    let reservation:AiCallReservation;
    try {
      const reserved=await reserveAiCall({...input.context,callerLabel:'visitor-web-search'},WEB_SEARCH_MODEL,[],0);
      if(reserved.kind==='replay') {
        const prior=JSON.parse(reserved.output);
        return render(prior.sources,prior.checkedAt,false,true,true);
      }
      reservation=reserved;
    } catch {return empty('budget_blocked');}
    let completed=false;
    try {
      const response=await backendFetch('https://api.tavily.com/search',{
        method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},
        body:JSON.stringify({query:plan.query,topic:'general',search_depth:'basic',max_results:5,
          auto_parameters:false,include_answer:false,include_raw_content:false,include_images:false,
          include_usage:true,include_domains:['facebook.com','wongnai.com','inthanincoffee.com']}),
      },3500);
      if(!response.ok)throw new Error('search_provider_unavailable');
      const body=await response.json() as {results?:unknown[]};
      if(!Array.isArray(body.results))throw new Error('invalid_search_results');
      const sources=body.results.slice(0,5).map(row=>publicSource(row,plan)).filter((row):row is PublicSource=>!!row).slice(0,2);
      const checkedAt=new Date().toISOString();
      const payload=JSON.stringify({sources,checkedAt});
      await finalizeAiCall(reservation,null,payload,true);completed=true;
      // No-result caching prevents repeated paid searches for the same topic.
      if(cache.size>=100)cache.delete(cache.keys().next().value!);
      cache.set(hash,{expires:Date.now()+TTL_MS,sources,checkedAt,payer});
      return render(sources,checkedAt,true,false);
    } catch {
      return {...empty('unavailable'),attempted:true,chargedThisTurn:true};
    } finally {
      // A timeout/HTTP failure may still have consumed a credit; retain reserve.
      if(!completed)await finalizeAiCall(reservation,null,null,false).catch(()=>{});
    }
  })();
  inFlight.set(flightKey,{work,eventId:input.context.eventId});
  try{return await work;}finally{inFlight.delete(flightKey);}
}

export function clearVisitorSearchCacheForTests():void {cache.clear();inFlight.clear();}
