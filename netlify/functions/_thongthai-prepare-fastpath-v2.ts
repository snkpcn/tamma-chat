// Phase 2 Wave A certification redeploy marker — no behavior change.\nimport type { BrainChannel, BrainRequest, BrainResponse } from './_thongthai-brain-v3';
import { listOtopProducts, listServiceResources } from './_operations-db';
import { listRestaurantMenu } from './_restaurant-sot';
import { executeThongthaiTransactionTool } from './_thongthai-agent-transactions';
import {
  extractDate,
  extractDateRange,
  extractDurationMinutes,
  extractPartySize,
  extractTime,
  hasCommitMarker,
  hasCorrectionMarker,
  hasExplicitNoTransactionMarker,
} from './_slot-parsers';

type Family = 'activity' | 'stay' | 'restaurant' | 'otop' | 'cafe';

type ToolSpec = { prepare:string; get:string; confirmation:string };
const TOOLS:Record<Family,ToolSpec> = {
  activity:{prepare:'prepare_activity_booking',get:'get_prepared_activity_booking',confirmation:'ยืนยันจอง'},
  stay:{prepare:'prepare_stay_booking',get:'get_prepared_stay_booking',confirmation:'ยืนยันจอง'},
  restaurant:{prepare:'prepare_restaurant_preorder',get:'get_prepared_restaurant_preorder',confirmation:'ยืนยันสั่ง'},
  otop:{prepare:'prepare_otop_order',get:'get_prepared_otop_order',confirmation:'ยืนยันสั่ง'},
  cafe:{prepare:'prepare_cafe_inquiry',get:'get_prepared_cafe_inquiry',confirmation:'ยืนยันส่งคำถาม'},
};

type TxContext = {
  guestDbId:string;
  channel:BrainChannel;
  environment:'live';
  eventId:string;
  message:string;
  transactionMode:'prepare';
};

function normalize(value:string):string {
  return value.toLowerCase().replace(/[\s\-–—_/().,，]/gu,'');
}

function escapeRegExp(value:string):string {
  return value.replace(/[.*+?^$()|[\]\\]/g,'\\$&');
}

function parse(raw:string):Record<string,unknown>|null {
  try {
    const value=JSON.parse(raw) as Record<string,unknown>;
    return value && typeof value==='object' ? value : null;
  } catch {
    return null;
  }
}

function summary(value:Record<string,unknown>):Record<string,unknown> {
  return value.summary && typeof value.summary==='object' && !Array.isArray(value.summary)
    ? value.summary as Record<string,unknown>
    : {};
}

function contact(message:string):{customerName:string;phone:string}|null {
  const phone=message.match(/(?:เบอร์|โทร)\s*([0-9][0-9\s-]{7,18}[0-9])/u)?.[1]?.replace(/\D/g,'') ?? '';
  const customerName=message.match(
    /(?:^|\s)ชื่อ\s*([^,\n]+?)(?=\s*(?:เบอร์|โทร|อีเมล|email|ที่อยู่|จำนวน|จอง|ยืนยัน|ส่ง|ครับ|ค่ะ|คะ|$))/iu,
  )?.[1]?.trim() ?? '';
  return customerName && phone ? {customerName,phone} : null;
}

function baseResponse(message:string,intent:'booking'|'order'='booking'):BrainResponse {
  return {
    message,
    intent,
    contextUpdates:{},
    journeyAction:{type:'none',journey:null},
    suggestedActions:[],
    responseStyle:'direct',
    semanticMemoryUpdates:[],
    toolCalls:[],
  };
}

function compose(family:Family,value:Record<string,unknown>,mode:'prepared'|'confirmed'|'held'):BrainResponse|null {
  if(value.ok!==true || value.prepared!==true) return null;
  const s=summary(value);
  const exact=typeof value.exact_confirmation_phrase_th==='string' && value.exact_confirmation_phrase_th.trim()
    ? value.exact_confirmation_phrase_th.trim()
    : TOOLS[family].confirmation;

  if(mode==='confirmed'){
    if(family==='cafe') {
      return baseResponse('รับการยืนยันแล้วครับ แต่ตอนนี้ระบบยังไม่เปิดให้ส่งคำถามจริง รายการยังเป็นแบบร่างและยังไม่ได้ส่งให้ทีมคาเฟ่ครับ');
    }
    if(family==='restaurant' || family==='otop') {
      return baseResponse('รับการยืนยันแล้วครับ แต่ตอนนี้ระบบยังไม่เปิดให้ส่งออเดอร์จริง รายการยังเป็นแบบร่างและยังไม่มีการสร้างออเดอร์ครับ','order');
    }
    return baseResponse('รับการยืนยันแล้วครับ แต่ตอนนี้ระบบยังไม่เปิดให้ส่งคำขอจองจริง รายการยังเป็นแบบร่างและยังไม่มีการสร้างการจองครับ');
  }

  if(mode==='held'){
    if(family==='cafe') return baseResponse('ได้ครับ เก็บคำถามแบบร่างไว้ก่อน ยังไม่ได้ส่งให้ทีมคาเฟ่ครับ');
    if(family==='restaurant'||family==='otop') return baseResponse('ได้ครับ เก็บรายการแบบร่างไว้ก่อน ยังไม่ได้สร้างหรือส่งออเดอร์จริงครับ','order');
    return baseResponse('ได้ครับ เก็บรายการแบบร่างไว้ก่อน ยังไม่ได้สร้างหรือส่งคำขอจองจริงครับ');
  }

  const lines:string[]=['เตรียมรายการไว้แล้วครับ (ยังไม่ได้ส่งรายการจริง)'];
  if(family==='stay'){
    if(s.stay) lines.push('• ที่พัก: '+String(s.stay));
    if(s.check_in) lines.push('• เช็กอิน '+String(s.check_in)+(s.check_out?' · เช็กเอาต์ '+String(s.check_out):''));
    if(s.party_size) lines.push('• '+String(s.party_size)+' ท่าน'+(s.quantity?' · '+String(s.quantity)+' ห้อง/หลัง':''));
  } else if(family==='restaurant'){
    const items=Array.isArray(s.items)?s.items:[];
    if(items.length){
      const itemText=items.map(item=>{
        const row=item && typeof item==='object' ? item as Record<string,unknown> : {};
        return String(row.name??'เมนู')+' × '+String(row.quantity??1);
      }).join(', ');
      lines.push('• อาหาร: '+itemText);
    }
    if(s.date) lines.push('• วันที่ '+String(s.date)+(s.time?' เวลา '+String(s.time):''));
    if(s.expected_total!=null) lines.push('• รวม '+String(s.expected_total)+' บาท');
  } else if(family==='otop'){
    if(s.product_name) lines.push('• สินค้า: '+String(s.product_name)+' × '+String(s.quantity??1));
    if(s.expected_total!=null) lines.push('• รวม '+String(s.expected_total)+' บาท');
    if(s.fulfillment_type) lines.push('• รับสินค้า: '+(String(s.fulfillment_type)==='shipping'?'จัดส่ง':'รับที่ร้าน'));
  } else if(family==='cafe'){
    if(s.question) lines.push('• คำถามถึงทีม: '+String(s.question));
  }
  if(s.customer_name) lines.push('• ชื่อ '+String(s.customer_name)+(s.phone?' · โทร '+String(s.phone):''));
  lines.push('หากรายละเอียดถูกต้อง พิมพ์ “'+exact+'” ครับ');
  return baseResponse(lines.join('\n'),family==='restaurant'||family==='otop'?'order':'booking');
}

async function loadPrepared(family:Family,ctx:TxContext):Promise<Record<string,unknown>|null> {
  const value=parse(await executeThongthaiTransactionTool(TOOLS[family].get,{},ctx));
  return value?.ok===true && value.prepared===true ? value : null;
}

function candidateFamilies(message:string):Family[] {
  if(/ยืนยัน\s*ส่ง\s*คำถาม/u.test(message)||/(?:Inthanin|อินทนิล|คาเฟ่|cafe)/iu.test(message)) return ['cafe'];
  if(/OTOP|โอทอป|ของฝาก/iu.test(message)) return ['otop','restaurant'];
  if(/ร้าน|อาหาร|เมนู/u.test(message)) return ['restaurant','otop'];
  if(/ที่พัก|เฮือนสเตย์|โฮมสเตย์|ห้องนอน/u.test(message)) return ['stay','activity'];
  if(/ม้า|ขี่/u.test(message)) return ['activity','stay'];
  if(/สั่ง/u.test(message)) return ['restaurant','otop'];
  if(/จอง/u.test(message)) return ['activity','stay'];
  return ['activity','stay','restaurant','otop','cafe'];
}

async function existing(message:string,ctx:TxContext):Promise<{family:Family;value:Record<string,unknown>}|null> {
  for(const family of candidateFamilies(message)){
    const value=await loadPrepared(family,ctx);
    if(value) return {family,value};
  }
  return null;
}

export function isPreparedTransactionStatusCheck(message:string):boolean {
  const text=message.trim();
  if(!/[?？]|ใช่ไหม|ใช่มั้ย|หรือเปล่า|รึเปล่า/u.test(text)) return false;
  const namesTransaction=/(?:การจอง|จอง|ออเดอร์|คำสั่งซื้อ|คำถาม|รายการ)/u.test(text);
  const asksExistence=/(?:ยังไม่มี|ยังไม่ได้|ไม่มี|ไม่ได้).{0,60}(?:สร้าง|ส่ง|ทำรายการ|จอง)|(?:สร้าง|ส่ง|ทำรายการ|จอง).{0,60}(?:หรือยัง|ไหม|มั้ย)/u.test(text);
  return namesTransaction && asksExistence;
}

async function initialStayArgs(message:string):Promise<Record<string,unknown>|null> {
  if(!/(?:เฮือนสเตย์|โฮมสเตย์|ที่พัก|ห้องนอน)/u.test(message)) return null;
  const c=contact(message);
  const range=extractDateRange(message);
  const partySize=extractPartySize(message);
  if(!c||!range||!partySize) return null;

  const resources=await listServiceResources('stay');
  const nm=normalize(message);
  const matched=resources
    .filter(row=>typeof row.name==='string' && normalize(row.name).length>=2 && nm.includes(normalize(row.name)))
    .sort((a,b)=>b.name.length-a.name.length);
  if(!matched.length) return null;
  const resource=matched[0];
  return {
    resource_code:resource.code,
    resource_name:resource.name,
    check_in:range.date,
    check_out:range.endDate,
    party_size:partySize,
    quantity:1,
    customer_name:c.customerName,
    phone:c.phone,
    ...(/ผู้สูงอายุ/u.test(message)?{note:'มีผู้สูงอายุร่วมเข้าพัก — กรุณาตรวจสอบการเข้าถึงก่อนยืนยัน'}:{}),
  };
}

async function initialRestaurantArgs(message:string):Promise<Record<string,unknown>|null> {
  if(!/(?:สั่งอาหาร|สั่งเมนู|ร้านตำมา-ชาติ|ร้านอาหาร)/u.test(message)) return null;
  const c=contact(message);
  const date=extractDate(message);
  const time=extractTime(message);
  if(!c||!date||!time) return null;

  const menu=await listRestaurantMenu();
  const nm=normalize(message);
  const matches=menu
    .filter(row=>typeof row.name==='string' && row.name.trim() && nm.includes(normalize(row.name)))
    .sort((a,b)=>b.name.length-a.name.length)
    .filter((row,index,array)=>!array.slice(0,index).some(longer=>normalize(longer.name).includes(normalize(row.name))));
  if(!matches.length) return null;

  const items=matches.slice(0,20).map(row=>{
    const re=new RegExp(escapeRegExp(row.name)+'\\s*(\\d{1,2})\\s*(?:จาน|ที่|ชุด)?','u');
    const quantity=Number(message.match(re)?.[1]??1);
    return {name:row.name,quantity:Number.isInteger(quantity)&&quantity>0?quantity:1};
  });
  return {date,time,items,customer_name:c.customerName,phone:c.phone};
}

async function initialOtopArgs(message:string):Promise<Record<string,unknown>|null> {
  if(!/(?:OTOP|โอทอป|ของฝาก|สั่งซื้อ|จัดส่ง)/iu.test(message)) return null;
  const c=contact(message);
  if(!c) return null;
  const products=await listOtopProducts('live');
  const nm=normalize(message);
  const product=products
    .filter(row=>nm.includes(normalize(row.name)))
    .sort((a,b)=>b.name.length-a.name.length)[0];
  if(!product) return null;

  const re=new RegExp(escapeRegExp(product.name)+'\\s*(\\d{1,2})\\s*(?:ชิ้น|ชุด|ผืน)?','u');
  const generic=message.match(/(\d{1,2})\s*(?:ชิ้น|ชุด|ผืน)/u);
  const quantity=Number(message.match(re)?.[1]??generic?.[1]??1);
  const fulfillmentType=/(?:จัดส่ง|ส่งถึง|ส่งไป|ที่อยู่)/u.test(message)?'shipping'
    : /(?:รับที่ร้าน|มารับ|pickup)/iu.test(message)?'pickup'
      : null;
  if(!fulfillmentType) return null;
  const shippingAddress=fulfillmentType==='shipping'
    ? message.match(/ที่อยู่\s*(.+?)(?=\s*(?:ยืนยัน|ครับ|ค่ะ|คะ|$))/u)?.[1]?.trim() ?? ''
    : '';
  if(fulfillmentType==='shipping'&&!shippingAddress) return null;
  return {
    sku:product.sku,
    quantity:Number.isInteger(quantity)&&quantity>0?quantity:1,
    fulfillment_type:fulfillmentType,
    ...(shippingAddress?{shipping_address:shippingAddress}:{}),
    customer_name:c.customerName,
    phone:c.phone,
  };
}

function initialCafeArgs(message:string):Record<string,unknown>|null {
  if(!/(?:Inthanin|อินทนิล|คาเฟ่|cafe)/iu.test(message)
      || !/(?:ส่งคำถาม|ส่งเรื่อง|ให้ทีม|ฝากทีม)/u.test(message)) return null;
  const c=contact(message);
  if(!c) return null;
  const beforeName=message.split(/\sชื่อ\s/u)[0]?.trim() ?? '';
  const question=beforeName
    .replace(/^.*?(?:ส่งคำถาม|ส่งเรื่อง|ฝากเรื่อง)\s*(?:ให้ทีม\s*)?(?:Inthanin\s*Café|Inthanin|อินทนิล|คาเฟ่)?\s*(?:ว่า|เรื่อง)?\s*/iu,'')
    .trim();
  if(question.length<3) return null;
  return {question,customer_name:c.customerName,phone:c.phone};
}

async function correctedArgs(family:Family,value:Record<string,unknown>,message:string):Promise<Record<string,unknown>|null> {
  const s=summary(value);
  if(family==='activity'){
    const date=extractDate(message) ?? (typeof s.date==='string'?s.date:null);
    const time=extractTime(message) ?? (typeof s.time==='string'?s.time:null);
    const duration=extractDurationMinutes(message) ?? Number(s.duration_minutes);
    const party=extractPartySize(message) ?? Number(s.party_size);
    const asset=typeof s.asset_name==='string'?s.asset_name:'';
    if(!date||!time||!asset||!Number.isInteger(duration)||!Number.isInteger(party)) return null;
    return {
      activity_code:'horse',asset_name:asset,date,time,
      duration_minutes:duration,party_size:party,
      customer_name:String(s.customer_name??''),phone:String(s.phone??''),
    };
  }
  if(family==='stay'){
    const range=extractDateRange(message);
    const single=extractDate(message);
    const checkIn=range?.date
      ?? (/(?:วันเข้า|เช็กอิน|check.?in)/iu.test(message)&&single?single:String(s.check_in??''));
    const checkOut=range?.endDate
      ?? (/(?:วันออก|เช็กเอาต์|check.?out)/iu.test(message)&&single?single:String(s.check_out??''));
    const party=extractPartySize(message) ?? Number(s.party_size);
    if(!checkIn||!checkOut||!Number.isInteger(party)) return null;
    return {
      resource_code:String(s.resource_code??''),
      ...(s.stay?{resource_name:String(s.stay)}:{}),
      check_in:checkIn,check_out:checkOut,party_size:party,
      quantity:Number(s.quantity??1),
      customer_name:String(s.customer_name??''),phone:String(s.phone??''),
    };
  }
  if(family==='restaurant'){
    const items=Array.isArray(s.items)
      ? s.items.map(item=>item && typeof item==='object'?{...(item as Record<string,unknown>)}:null).filter(Boolean) as Record<string,unknown>[]
      : [];
    const quantity=message.match(/(\d{1,2})\s*(?:จาน|ที่|ชุด)/u)?.[1];
    if(quantity&&items.length===1) items[0].quantity=Number(quantity);
    const date=extractDate(message) ?? String(s.date??'');
    const time=extractTime(message) ?? String(s.time??'');
    if(!items.length||!date||!time) return null;
    return {
      date,time,
      items:items.map(item=>({name:String(item.name??''),quantity:Number(item.quantity??1)})),
      customer_name:String(s.customer_name??''),phone:String(s.phone??''),
    };
  }
  if(family==='otop'){
    const quantity=Number(message.match(/(\d{1,2})\s*(?:ชิ้น|ชุด|ผืน)/u)?.[1] ?? s.quantity);
    if(!Number.isInteger(quantity)||quantity<1) return null;
    return {
      sku:String(s.sku??''),quantity,
      fulfillment_type:String(s.fulfillment_type??''),
      ...(s.shipping_address?{shipping_address:String(s.shipping_address)}:{}),
      customer_name:String(s.customer_name??''),phone:String(s.phone??''),
    };
  }

  const oldQuestion=String(s.question??'');
  if(!oldQuestion) return null;
  const nextTime=extractTime(message);
  let question=oldQuestion;
  if(nextTime){
    const timeRe=/(?:[01]\d|2[0-3]):[0-5]\d/u;
    question=timeRe.test(oldQuestion) ? oldQuestion.replace(timeRe,nextTime) : oldQuestion+' · แก้เวลาเป็น '+nextTime;
  } else {
    question=oldQuestion+' · แก้ไขล่าสุด: '+message.replace(/ยืนยัน\s*ส่ง\s*คำถาม/u,'').trim();
  }
  return {
    question,
    customer_name:String(s.customer_name??''),
    phone:String(s.phone??''),
    ...(s.email?{email:String(s.email)}:{}),
  };
}

export async function runPrepareOnlyMultiVerticalFastPath(
  request:BrainRequest,
  guestDbId:string,
  channel:BrainChannel,
  eventId:string,
):Promise<BrainResponse|null> {
  const ctx:TxContext={
    guestDbId,channel,environment:'live',eventId,
    message:request.message,transactionMode:'prepare',
  };
  const cafeConfirm=/ยืนยัน\s*ส่ง\s*คำถาม/u.test(request.message);
  const statusCheck=isPreparedTransactionStatusCheck(request.message);
  if(hasCommitMarker(request.message)||cafeConfirm||hasExplicitNoTransactionMarker(request.message)||statusCheck){
    const found=await existing(request.message,ctx);
    if(found){
      if(statusCheck) return compose(found.family,found.value,'held');
      if(hasExplicitNoTransactionMarker(request.message)) return compose(found.family,found.value,'held');
      if(hasCorrectionMarker(request.message)){
        const args=await correctedArgs(found.family,found.value,request.message);
        if(args){
          const value=parse(await executeThongthaiTransactionTool(TOOLS[found.family].prepare,args,ctx));
          if(value) return compose(found.family,value,'prepared');
        }
      }
      return compose(found.family,found.value,'confirmed');
    }
  }

  const stayArgs=await initialStayArgs(request.message);
  if(stayArgs){
    const value=parse(await executeThongthaiTransactionTool('prepare_stay_booking',stayArgs,ctx));
    if(value) return compose('stay',value,'prepared');
  }

  const restaurantArgs=await initialRestaurantArgs(request.message);
  if(restaurantArgs){
    const value=parse(await executeThongthaiTransactionTool('prepare_restaurant_preorder',restaurantArgs,ctx));
    if(value) return compose('restaurant',value,'prepared');
  }

  const otopArgs=await initialOtopArgs(request.message);
  if(otopArgs){
    const value=parse(await executeThongthaiTransactionTool('prepare_otop_order',otopArgs,ctx));
    if(value) return compose('otop',value,'prepared');
  }

  const cafeArgs=initialCafeArgs(request.message);
  if(cafeArgs){
    const value=parse(await executeThongthaiTransactionTool('prepare_cafe_inquiry',cafeArgs,ctx));
    if(value) return compose('cafe',value,'prepared');
  }

  return null;
}
