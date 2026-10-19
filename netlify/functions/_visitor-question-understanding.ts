import { createHash } from 'node:crypto';
import { normalizeCustomerText } from './_customer-text';
import { redactSensitiveContent } from './_conversation-context';
import { classifyVisitorInformation } from './_visitor-information';
import { callVisitorQuestionInterpreter } from './_thongthai-model-provider';
import type { AiCallContext } from './_ai-cost-ledger';

export const VISITOR_QUESTION_TOPICS = ['horse_reference_quote','cafe_menu_reference','overview','location','hours','admission','brand_relationship','facilities','accessibility','dog_policy','food_browse','restaurant_opening','menu','child_food','allergy','group_tables','activity_opening','horse_price','horse_instruction','horse_child_safety','horse_weight','boat_safety','weather_changes','stay_opening','stay_availability','package','product_browse','product_origin','shipping'] as const;
type Topic=typeof VISITOR_QUESTION_TOPICS[number];
type Scope='venue'|'cafe'|'restaurant'|'activity'|'stay'|'otop'|'unknown';
type Classification={topic:Topic;scope:Scope;confidence:number};
export type QuestionUnderstanding={message:string;topic:Topic|null;method:'original'|'concepts'|'model'|'cache'|'abstain'|'unavailable';modelAttempted:boolean;httpStatus?:number};
const cache=new Map<string,{classification:Classification;expires:number}>();
let unavailableUntil=0;
let unavailableHttpStatus:number|undefined;
export function clearVisitorQuestionCache():void {cache.clear();unavailableUntil=0;unavailableHttpStatus=undefined;}

// Unambiguous spelling and vocabulary equivalences only. Negation is kept.
export function normalizeVisitorVocabulary(message:string):string {
  return normalizeCustomerText(message).replace(/อินทนิน|อินทะนิล/gu,'อินทนิล')
    .replace(/ทำมาชาติ|ทำมา ชาติ/gu,'ทำมา-ชาติ').replace(/ตำมาชาติ/gu,'ตำมา-ชาติ')
    .replace(/ห้องสุขา|สุขา|ห้องส้วม/gu,'ห้องน้ำ').replace(/ลานจอด|ช่องจอด/gu,'ที่จอดรถ')
    .replace(/วีลเเชร์|วิลแชร์|wheel\s*chair/giu,'วีลแชร์')
    .replace(/ค่าบัตรเข้า|ค่าตั๋วเข้า|ค่าเข้าไป/gu,'ค่าเข้า')
    .replace(/พีนัท|peanuts?/giu,'ถั่วลิสง').replace(/แพคเก็ต|แพ็คเกจ/gu,'แพ็กเกจ')
    .replace(/กทม\.?/gu,'กรุงเทพฯ').replace(/ค่าส่งของ|ค่าขนส่ง/gu,'ค่าส่ง')
    .replace(/มั๊ย|มะ(?=[?？!！\s]|$)|ป่าว|ปะ(?=[?？!！\s]|$)/gu,'ไหม');
}

export function isVisitorInformationOnly(message:string):boolean {
  // This stage cannot consume incidents or current-turn action commitments.
  return !/(?:ช่วย|รบกวน|ดำเนินการ).{0,40}(?:จอง|ยกเลิก|คืนเงิน|สั่ง|ติดต่อ|ส่งเรื่อง|เตรียม)|ขอคืนเงิน|ขอยกเลิก|จองให้|ยกเลิกให้|ติดต่อให้|ส่งเรื่องให้|ขอจอง|ขอสั่ง|ยืนยันจอง|ยืนยันสั่ง|บาดเจ็บ|อุบัติเหตุ|ร้องเรียน|ของหาย|ขโมย|สกปรก/u.test(message);
}

function contextTopic(history:Array<{role:string;content:string}>):string {
  // Only the most recent user topic is an antecedent. Older topics must not
  // override a newer explicit subject; assistant claims never establish facts.
  return [...history].reverse().find(turn=>turn.role==='user')?.content ?? '';
}
function explicitScope(text:string):Scope {
  if(/ร้านอาหาร|ตำมา-ชาติ/u.test(text))return 'restaurant';
  if(/อินทนิล|คาเฟ่|กาแฟ/u.test(text))return 'cafe';
  if(/เฮือน|ที่พัก|ห้องพัก/u.test(text))return 'stay';
  if(/ขี่ม้า|ATV|เอทีวี|ยิงธนู|เป็ดน้ำ|กิจกรรม/iu.test(text))return 'activity';
  return 'venue';
}
function knownTopic(text:string):Topic|null {
  const known=classifyVisitorInformation(text);
  if(known)return known;
  if(/เปิดกี่โมง|ปิดวันไหน|เวลาทำการ|เวลาเปิด|เวลาปิด|เปิดวันไหน/u.test(text))return 'hours';
  if(/อยู่(?:ที่|ตรง|แถว)?ไหน|พิกัด|ที่ตั้ง|ไปยังไง|โลเคชั[น่]/u.test(text))return 'location';
  if(/(?:หมา|สุนัข).*(?:ได้ไหม|ได้มั้ย)|พา.*หมา.*ได้/u.test(text))return 'dog_policy';
  if(/ขอเมนู|เมนูกับราคา/u.test(text))return 'menu';
  if(/แพ้.*(?:ถั่ว|กุ้ง|นม|ไข่|ปลา)|ไม่เผ็ด.*เด็ก/u.test(text))return null; // keep the ingredient-aware advisor
  if(/ขี่ม้า.*(?:ราคา|เท่าไร|เท่าไหร่)/u.test(text))return 'horse_price';
  return null;
}

const CANONICAL:Partial<Record<Topic,string>>={
  horse_reference_quote:'ขี่ม้าชั่วโมงครึ่ง 500 บาทใช่ไหม',cafe_menu_reference:'ขอเมนูคาเฟ่อินทนิลกับราคา',overview:'ทำมา-ชาติคืออะไร มีอะไรให้เที่ยวบ้าง?',location:'อยู่ที่ไหน ส่งพิกัดให้หน่อย',hours:'เปิดกี่โมง ปิดวันไหนบ้าง?',
  admission:'ต้องเสียค่าเข้าหรือเปล่า?',brand_relationship:'อินทนิลกับทำมา-ชาติเป็นที่เดียวกันไหม?',facilities:'มีที่จอดรถกับห้องน้ำไหม?',accessibility:'ผู้สูงอายุใช้รถเข็นไปเที่ยวสะดวกไหม?',
  dog_policy:'พาหมาไปได้ไหม?',food_browse:'มีอะไรกินบ้าง นอกจากกาแฟ?',restaurant_opening:'ร้านตำมา-ชาติเปิดแล้วหรือยัง?',menu:'ขอเมนูกับราคาหน่อย',child_food:'มีอาหารไม่เผ็ดสำหรับเด็กไหม?',
  group_tables:'ไปเป็นกลุ่มใหญ่ ต้องจองโต๊ะไหม?',activity_opening:'ตอนนี้มีกิจกรรมอะไรเปิดให้เล่นจริงบ้าง?',horse_price:'ขี่ม้าราคาเท่าไร ได้ขี่กี่นาที?',horse_instruction:'ขี่ม้ามีคนสอนไหม?',horse_child_safety:'เด็กขี่ม้าได้ไหม?',horse_weight:'ขี่ม้ามีจำกัดน้ำหนักหรือเปล่า?',boat_safety:'เป็ดน้ำขึ้นได้กี่คน มีเสื้อชูชีพให้ไหม?',weather_changes:'ถ้าฝนตก จองกิจกรรมไว้แล้วเลื่อนหรือคืนเงินได้ไหม?',stay_opening:'เฮือนสเตย์เปิดให้พักแล้วไหม คืนละเท่าไร?',stay_availability:'คืนนี้มีห้องว่างไหม?',package:'มีแพ็กเกจที่พักรวมอาหารและกิจกรรมไหม?',product_browse:'มีของฝากอะไรขายบ้าง?',product_origin:'สินค้านี้ใครเป็นคนทำ มาจากชุมชนไหน?',shipping:'ส่งของฝากได้ไหม ค่าส่งเท่าไร?',
};

function canonicalMessage(text:string,classification:Classification,history:Array<{role:string;content:string}>):string|null {
  const {topic,scope}=classification;
  const prior=contextTopic(history);
  const evidence=text+' '+prior;
  if(/สาขา(?!\s*ตาดโตน)|สาขาอื่น|ทุกสาขา/u.test(text))return null;
  // Never turn denied allergy/dog permission or an unrelated unit into a
  // positive generic answer. Unsupported scopes stay with the main brain.
  if(topic==='dog_policy' && (!/หมา|สุนัข/u.test(evidence) || /แมว|กระต่าย|นก|ไม่พา|ไม่ได้พา|ไม่เอา/u.test(text) || (['restaurant','stay'].includes(scope) || ['restaurant','stay'].includes(explicitScope(text)))))return null;
  if(topic==='hours' && (!['venue','cafe'].includes(scope) || !['venue','cafe'].includes(explicitScope(text))))return null;
  if(topic==='allergy') {
    if(!/แพ้(?!น้อย|ไม่)/u.test(text) || /ไม่ได้แพ้|ไม่แพ้/u.test(text))return null;
    return text+' มีเมนูไหนกินได้บ้าง';
  }
  if(topic==='child_food' && (!/เด็ก|ลูก|น้อง|ขวบ/u.test(evidence) || !/ไม่เผ็ด|ไม่กินเผ็ด|รสอ่อน|จืด/u.test(evidence) || /กินเผ็ดได้|เอาเผ็ด/u.test(text)))return null;
  if(topic==='horse_price' && !/ขี่ม้า|ขี้ม้า|ม้า/u.test(evidence))return null;
  const base=CANONICAL[topic];if(!base)return null;
  const thaiNumbers:Record<string,number>={หนึ่ง:1,สอง:2,สาม:3,สี่:4,ห้า:5,หก:6,เจ็ด:7,แปด:8,เก้า:9,สิบ:10,สิบเอ็ด:11,สิบสอง:12,สิบสาม:13,สิบสี่:14,สิบห้า:15,สิบหก:16,สิบเจ็ด:17,สิบแปด:18,สิบเก้า:19,ยี่สิบ:20};
  const tokens=Object.keys(thaiNumbers).sort((a,b)=>b.length-a.length).join('|');
  const numberBefore=(unit:string)=>{const token=text.match(new RegExp(`(${tokens}|[0-9]{1,2})\\s*(?:${unit})`,'u'))?.[1];return token?String(thaiNumbers[token] ?? Number(token)):undefined;};
  const size=numberBefore('คน|ท่าน');
  const age=numberBefore('ขวบ|ปี');
  if(topic==='group_tables' && size)return `ไปประมาณ ${size} คน ต้องจองโต๊ะไหม?`;
  if(topic==='horse_child_safety' && age)return `เด็กอายุ ${age} ขวบขี่ม้าได้ไหม?`;
  if(topic==='stay_availability') {
    // Do not invent a date from a vague request. The caller asks for it.
    const when=/คืนนี้|วันนี้/u.test(text)?'คืนนี้':/พรุ่งนี้/u.test(text)?'พรุ่งนี้':'';
    return `${when}มีห้องว่าง${size?`สำหรับ ${size} คน`:''}ไหม?`;
  }
  if(topic==='location' && scope==='cafe')return 'อินทนิล สาขาตาดโตน '+base;
  if(topic==='hours' && scope==='cafe')return 'อินทนิล สาขาตาดโตน '+base;
  if(topic==='facilities') {
    const parts=[/จอด|รถยนต์|รถส่วนตัว/u.test(text)?'ที่จอดรถ':'',/ห้องน้ำ|ทำธุระ|ปัสสาวะ/u.test(text)?'ห้องน้ำ':''].filter(Boolean);
    return parts.length?`มี${parts.join('กับ')}ไหม?`:base;
  }
  // Retain original dietary restrictions rather than replacing them by an
  // unconstrained menu request. The existing advisor parses those words.
  if(topic==='menu' && scope==='cafe')return text+' ขอเมนูคาเฟ่อินทนิลกับราคา';
  if(topic==='menu' || topic==='child_food' || topic==='cafe_menu_reference')return text+' '+base;
  return base;
}

function concepts(text:string,history:Array<{role:string;content:string}>):Classification|null {
  const scope=explicitScope(text);
  let topic=knownTopic(text);
  if(!topic && /ที่นี่|ทำมา-ชาติ/u.test(text) && /มีไร|เที่ยวไร|น่าไป|เป็นที่แบบไหน|แนวไหน/u.test(text))topic='overview';
  if(!topic && /จ่าย|เสียเงิน|ฟรี|บัตร/u.test(text) && /เข้า|เดินเล่น|ชมสวน/u.test(text))topic='admission';
  if(!topic && /จอด/u.test(text) && /รถ|ไหน|ไหม/u.test(text))topic='facilities';
  if(!topic && /หมา|สุนัข/u.test(text) && /พา|รับ|เข้า/u.test(text) && /ไหม|ได้|มั้ย/u.test(text))topic='dog_policy';
  if(!topic && /รถเข็น|วีลแชร์/u.test(text) && /ทาง|ลำบาก|เข็น|ไป/u.test(text))topic='accessibility';
  if(!topic && /ที่พัก|ห้อง|นอน/u.test(text) && /ว่าง|เหลือ|มีไหม/u.test(text))topic='stay_availability';
  if(!topic && /ขี่ม้า|ขี้ม้า/u.test(text) && /บาท|เท่าไหร่|เท่าไร|กี่นาที|ค่าขี่/u.test(text))topic='horse_price';
  if(!topic && /ของฝาก|ส่งของ/u.test(text) && /ส่ง|ขนส่ง|ค่าส่ง/u.test(text))topic='shipping';
  if(!topic && /ของฝาก|โอทอป|OTOP/iu.test(text) && /ซื้อไร|มีไร|ขายไร|อะไรขาย/u.test(text))topic='product_browse';
  if(!topic && /อินทนิล/u.test(text) && /ทำมา-ชาติ/u.test(text) && /อยู่ใน|เดียว|เกี่ยว|ต่าง/u.test(text))topic='brand_relationship';
  if(!topic && /แล้ว|ล่ะ|ละ|อันนั้น|ที่ว่า/u.test(text)) {
    const prior=contextTopic(history);
    if(/หมา|สุนัข/u.test(prior) && /พา|เข้า|ได้ไหม|ได้มั้ย/u.test(text))topic='dog_policy';
    if(/ขี่ม้า/u.test(prior) && /กี่บาท|ราคา|กี่นาที/u.test(text))topic='horse_price';
  }
  return topic?{topic,scope,confidence:1}:null;
}

export async function understandVisitorQuestion(input:{message:string;history?:Array<{role:string;content:string}>;costContext?:AiCallContext;allowModel?:boolean}):Promise<QuestionUnderstanding> {
  const original:QuestionUnderstanding={message:input.message,topic:null,method:'original',modelAttempted:false};
  if(!isVisitorInformationOnly(input.message) || input.message.length>500)return original;
  const text=normalizeVisitorVocabulary(input.message);const history=input.history ?? [];
  // Preserve already-supported wording and its complete entities/context.
  if(knownTopic(input.message) || /แพ้.*(?:ถั่ว|กุ้ง|นม|ไข่|ปลา)|ไม่เผ็ด.*เด็ก/u.test(input.message))return original;
  const concept=concepts(text,history);
  if(concept) {
    const message=canonicalMessage(text,concept,history);
    if(message)return {...original,message,topic:concept.topic,method:'concepts'};
  }
  // A small interpretation call only for a visitor question or an explicit
  // contextual follow-up, never every casual statement/customer message.
  if(input.allowModel===false || !input.costContext || !process.env.OPENAI_API_KEY
      || !/(?:ไหม|มั้ย|หรือ|เหรอ|หรอ|เท่า|กี่|ไหน|อะไร|มีไร|ยัง|ทัน|รึ|\?|ล่ะ|ละ$)/u.test(text)
      || !/ทำมา|ตำมา|ร้าน|คาเฟ่|กาแฟ|อินทนิล|เที่ยว|เดินเล่น|เข้าชม|ม้า|เอทีวี|ATV|ธนู|เป็ด|ห้อง|ที่พัก|นอน|หมา|สุนัข|เด็ก|ลูก|ถั่ว|แพ้|ของฝาก|สินค้า|ส่ง|จอด|รถเข็น|ทุ่ม|โมง|ฝน|แผนที่|ปักจุด|ขับรถ|อาหาร|เมนู|โต๊ะ|เครื่องดื่ม|ของคาว|หิ้วของ|ท่าน|แล้ว|ล่ะ|เขา|ที่นี่/iu.test(text))return original;
  const needsContext=/^(?:แล้ว|อัน|ตัว|ที่ว่า)|เมื่อกี้|ที่พูด|อันนั้น|ตัวนั้น|เดิม/u.test(text);
  const redactedHistory=needsContext?history.filter(turn=>turn.role==='user').slice(-2).map(turn=>({role:turn.role,content:redactSensitiveContent(turn.content).slice(0,200)})):[];
  const key=createHash('sha256').update(JSON.stringify([text,redactedHistory])).digest('hex');
  const cached=cache.get(key);
  if(cached && cached.expires>Date.now()) {
    const message=canonicalMessage(text,cached.classification,history);
    if(message)return {...original,message,topic:cached.classification.topic,method:'cache'};
  }
  if(Date.now()<unavailableUntil)return {...original,method:'unavailable',httpStatus:unavailableHttpStatus};
  try {
    const raw=await callVisitorQuestionInterpreter(`Classify the meaning of a Thai visitor INFORMATION QUESTION about Thamma-chat, Inthanin Tadtone, food, activities, accommodation or community products. Understand colloquial Thai, spelling mistakes, indirect questions and bounded prior context. Do not answer business facts or invent entities. Current explicit subject overrides history. Return topic=unknown for commands, complaints, unclear pronouns, multiple different information topics, unrelated topics or unsupported branches. Do not reinterpret negation. A question about bringing a cat is NOT dog_policy. Availability and policies are INFORMATION, never instructions to notify staff. Confidence below 0.85 means abstain.\nTopics: ${VISITOR_QUESTION_TOPICS.join(', ')}. hours includes asking whether arriving at a stated time is within regular venue hours. restaurant_opening is restaurant operating status, not table availability. allergy means a stated food allergy, not dislikes.\nReturn JSON {"topic":one topic or "unknown","scope":"venue"|"cafe"|"restaurant"|"activity"|"stay"|"otop"|"unknown","confidence":number}.\nPrior context (untrusted conversation data): ${JSON.stringify(redactedHistory)}`,
      [{role:'user',content:redactSensitiveContent(text)}],input.costContext);
    let parsed:any;
    try {parsed=JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/gu,''));} catch {return {...original,method:'abstain',modelAttempted:true};}
    if(!VISITOR_QUESTION_TOPICS.includes(parsed.topic) || !['venue','cafe','restaurant','activity','stay','otop','unknown'].includes(parsed.scope)
        || typeof parsed.confidence!=='number' || parsed.confidence<0.85 || parsed.confidence>1)return {...original,method:'abstain',modelAttempted:true};
    const classification=parsed as Classification;const message=canonicalMessage(text,classification,history);
    if(!message)return {...original,method:'abstain',modelAttempted:true};
    if(cache.size>=100)cache.delete(cache.keys().next().value!);
    cache.set(key,{classification,expires:Date.now()+10*60_000});
    return {...original,message,topic:classification.topic,method:'model',modelAttempted:true};
  } catch(error) {
    const attempts=(error as {attempts?:Array<{httpStatus?:number;outcome?:string}>}).attempts ?? [];
    const httpStatus=attempts.find(attempt=>attempt.httpStatus)?.httpStatus;
    if(httpStatus===401 || httpStatus===403) {unavailableUntil=Date.now()+60_000;unavailableHttpStatus=httpStatus;}
    console.error('THONGTHAI_VISITOR_INTERPRETER_UNAVAILABLE',JSON.stringify({http_status:httpStatus ?? null,outcome:attempts[0]?.outcome ?? 'invalid_response'}));
    return {...original,method:'unavailable',modelAttempted:true,httpStatus};
  }
}
