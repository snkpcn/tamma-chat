import test from 'node:test';
import assert from 'node:assert/strict';
import { VISITOR_PARAPHRASES } from './fixtures/visitor-paraphrases';
import { withHarness,brainRequest,guestId } from './helpers/canonical-core-harness';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';
import { understandVisitorQuestion,clearVisitorQuestionCache } from '../netlify/functions/_visitor-question-understanding';
import { regularArrivalInformation } from '../netlify/functions/_visitor-arrival';

async function enabled(run:()=>Promise<void>) {
 const previous=process.env.THONGTHAI_VISITOR_UNDERSTANDING;process.env.THONGTHAI_VISITOR_UNDERSTANDING='1';clearVisitorQuestionCache();
 try {await run();} finally {if(previous===undefined)delete process.env.THONGTHAI_VISITOR_UNDERSTANDING;else process.env.THONGTHAI_VISITOR_UNDERSTANDING=previous;}
}
async function costContext(harness:any,seed:string) {
 const id=guestId(seed);
 await processThongthaiChatCore(brainRequest('สวัสดี',id),'init-'+seed);
 return {conversationId:id,guestDbId:harness.guestDbId(id) ?? null,channel:'web',eventId:seed,callerLabel:'visitor-question-interpretation'};
}
for(const channel of ['web','line'] as const)for(const scenario of VISITOR_PARAPHRASES) {
 test(`${channel}: paraphrase ${scenario.topic}: ${scenario.question}`,async()=>enabled(async()=>{
  await withHarness(async harness=>{
   harness.programGeminiReply({topic:scenario.topic,scope:scenario.topic==='horse_price'?'activity':'venue',confidence:0.98});
   const result=await processThongthaiChatCore(brainRequest(scenario.question,guestId('paraphrase-'+scenario.question),channel),'paraphrase');
   const answer=String((result.payload as any).message);
   assert.ok(answer.includes(scenario.must),answer);
   assert.doesNotMatch(answer,/ยังตอบเรื่องนี้ให้แม่นไม่ได้|ลองอีกครั้งสักครู่|บันทึกเรื่องไว้แล้ว/);
   assert.ok(harness.modelCallCount()<=1,'interpret once; never pay again for prose');
   for(const table of ['bookings','ops_feedback_events','restaurant_preorders','payment_requests'])assert.equal(harness.postsTo(table).length,0,table);
  });
 }));
}
test('ambiguous/negated/other-species model classification cannot grant dog permission',async()=>{
 for(const question of ['ไม่พาหมานะ จะพาแมวไปได้ไหม','ที่พักรับสุนัขไหม','อินทนิลสาขาขอนแก่นพาหมาไปได้ไหม']) {
  await withHarness(async harness=>{
   harness.programGeminiReply({topic:'dog_policy',scope:question.includes('ที่พัก')?'stay':'venue',confidence:0.99});
   const result=await understandVisitorQuestion({message:question,costContext:await costContext(harness,question)});
   assert.notEqual(result.message,'พาหมาไปได้ไหม?');
  });
 }
});
test('an actual action yields before the interpreter can change it',async()=>{
 await withHarness(async harness=>{
  for(const message of ['ช่วยจองโต๊ะ 15 คนให้หน่อย','ขอคืนเงินกิจกรรมเพราะฝนตก','ช่วยติดต่อทีมเรื่องรถเข็น']) {
   const result=await understandVisitorQuestion({message});assert.equal(result.message,message);
  }
  assert.equal(harness.modelCallCount(),0);
 });
});
test('regular arrival compares the supplied time without asserting live/special-day opening',()=>{
 assert.match(regularArrivalInformation('ไปถึงตอนห้าโมงเย็นยังทันไหม')?.message ?? '',/17:00.*ยังอยู่ในเวลาทำการ/);
 assert.match(regularArrivalInformation('ไปถึงตอน 19:00 ยังทันไหม')?.message ?? '',/เลยเวลาปิด/);
 assert.equal(regularArrivalInformation('พรุ่งนี้ไปถึงตอนห้าโมงเย็นยังทันไหม'),null);
 assert.equal(regularArrivalInformation('ร้านอาหารไปถึงตอนห้าโมงเย็นยังทันไหม'),null);
});

test('interpretation cache reuses topics for standalone questions without importing unrelated history',async()=>{
 clearVisitorQuestionCache();
 await withHarness(async harness=>{
  const ctx=await costContext(harness,'cache-1');
  harness.programGeminiReply({topic:'product_browse',scope:'otop',confidence:0.97});
  const first=await understandVisitorQuestion({message:'อยากหิ้วของกลับบ้าน มีไรน่าซื้อมั่ง',costContext:ctx});
  const second=await understandVisitorQuestion({message:'อยากหิ้วของกลับบ้าน มีไรน่าซื้อมั่ง',costContext:{...ctx,eventId:'cache-2'}});
  assert.equal(first.method,'model');assert.equal(second.method,'cache');assert.equal(harness.modelCallCount(),1);
  harness.programGeminiReply({topic:'product_browse',scope:'otop',confidence:0.97});
  await understandVisitorQuestion({message:'อยากหิ้วของกลับบ้าน มีไรน่าซื้อมั่ง',history:[{role:'user',content:'มีของฝากที่ไม่ใช่อาหารไหม'}],costContext:{...ctx,eventId:'cache-3'}});
  assert.equal(harness.modelCallCount(),1,'standalone questions ignore unrelated history and can reuse their interpretation');
 });
});
test('dog/horse follow-ups use recent context; a new explicit topic wins over old context',async()=>enabled(async()=>{
 await withHarness(async harness=>{
  const dog=await processThongthaiChatCore(brainRequest('แล้วพาเข้าไปข้างในได้ไหม',guestId('dog-followup'),'web',[
   {role:'user',content:'พาหมาไปได้ไหม'},{role:'assistant',content:'โซน Outdoor ครับ'},
  ]),'dog-followup');
  assert.match(String((dog.payload as any).message),/ไม่นำเข้า.*ห้องแอร์/);
  const price=await processThongthaiChatCore(brainRequest('แล้วกี่บาทอะ',guestId('horse-followup'),'web',[
   {role:'user',content:'อยากลองขี่ม้า'},{role:'assistant',content:'อยากทราบรายละเอียดอะไรครับ'},
  ]),'horse-followup');
  assert.match(String((price.payload as any).message),/300 บาท/);
  const switched=await processThongthaiChatCore(brainRequest('ค่าบัตรเข้าไปเดินเล่นเท่าไหร่',guestId('topic-switch'),'web',[
   {role:'user',content:'อยากลองขี่ม้า'},{role:'assistant',content:'ขี่ม้าครับ'},
  ]),'topic-switch');
  assert.match(String((switched.payload as any).message),/ค่าเข้า/);
  assert.doesNotMatch(String((switched.payload as any).message),/300 บาท/);
  assert.equal(harness.modelCallCount(),0);
 });
}));
test('uncertain, invalid and outage interpretations preserve the original question',async()=>{
 for(const reply of [{topic:'confirm_booking',scope:'activity',confidence:1},{topic:'hours',scope:'venue',confidence:0.4},null]) {
  clearVisitorQuestionCache();
  await withHarness(async harness=>{
   if(reply)harness.programGeminiReply(reply);
   const message='ไปถึงตอนห้าโมงเย็นยังทันไหม';
   const result=await understandVisitorQuestion({message,costContext:await costContext(harness,'abstain-'+JSON.stringify(reply))});
   assert.equal(result.message,message);assert.equal(result.method,reply?'abstain':'unavailable');
  });
 }
});
test('a model cannot reinterpret restaurant hours as overall venue hours',async()=>{
 await withHarness(async harness=>{
  harness.programGeminiReply({topic:'hours',scope:'venue',confidence:0.99});
  const message='ร้านอาหารเข้าไปกินตอนห้าโมงเย็นจะทันไหม';
  const result=await understandVisitorQuestion({message,costContext:await costContext(harness,'scope-hours')});
  assert.equal(result.message,message);
 });
});

test('a paid interpretation followed by a free fact renderer cannot be logged as a zero-cost turn',async()=>enabled(async()=>{
 await withHarness(async harness=>{
  const actual=global.fetch;const patches:Array<{url:URL;body:any}>=[];
  global.fetch=(async(input,init)=>{
   const url=new URL(String(input));
   if(url.pathname.endsWith('/ai_response_turns') && init?.method==='PATCH')patches.push({url,body:JSON.parse(String(init.body))});
   return actual(input,init);
  }) as typeof fetch;
  try {
   harness.programGeminiReply({topic:'hours',scope:'venue',confidence:0.99});
   const response=await processThongthaiChatCore(brainRequest('ไปถึงตอนห้าโมงเย็นยังทันไหม',guestId('provenance-paid-interpretation')),'paid-hours');
   assert.match(String((response.payload as any).message),/17:00/);
   assert.equal(harness.modelCallCount(),1);
   assert.ok(patches.some(patch=>patch.url.searchParams.get('event_id')==='eq.paid-hours' && patch.body.zero_cost_turn===false));
  } finally {global.fetch=actual;}
 });
}));

test('a time-only follow-up uses the previous hours question and evaluates the new time',async()=>enabled(async()=>{
 await withHarness(async harness=>{
  harness.programGeminiReply({topic:'hours',scope:'venue',confidence:0.98});
  const result=await processThongthaiChatCore(brainRequest('แล้วหนึ่งทุ่มล่ะ',guestId('time-followup'),'web',[
   {role:'user',content:'ไปถึงตอนห้าโมงเย็นยังทันไหม'},
   {role:'assistant',content:'เวลาปกติปิด 18:00 ครับ'},
  ]),'time-followup');
  assert.match(String((result.payload as any).message),/19:00.*เลยเวลาปิด/);
  assert.equal(harness.modelCallCount(),1);
 });
}));

test('401 cannot trigger a second paid model attempt or repeated authentication requests',async()=>enabled(async()=>{
 await withHarness(async harness=>{
  const actual=global.fetch;let requests=0;
  global.fetch=(async(input,init)=>{
   if(String(input)==='https://api.openai.com/v1/responses') {requests++;return new Response('{"error":"unauthorized"}',{status:401});}
   return actual(input,init);
  }) as typeof fetch;
  try {
   const id=guestId('auth-unavailable');
   const first=await processThongthaiChatCore(brainRequest('ไปถึงตอนห้าโมงเย็นยังทันไหม',id),'auth-1');
   assert.match(String((first.payload as any).message),/ระบุหัวข้อ/);
   await processThongthaiChatCore(brainRequest('อยากหิ้วของกลับบ้าน มีไรน่าซื้อมั่ง',id),'auth-2');
   assert.equal(requests,1);
   assert.equal(harness.postsTo('bookings').length,0);
  } finally {global.fetch=actual;clearVisitorQuestionCache();}
 });
}));

for(const channel of ['web','line'] as const) {
 test(`${channel}: the alternative-wording corpus also works as one continuous conversation`,async()=>enabled(async()=>{
  await withHarness(async harness=>{
   const id=guestId('paraphrase-sequence-'+channel);const history:Array<{role:'user'|'assistant';content:string}>=[];
   const actual=global.fetch;let current:typeof VISITOR_PARAPHRASES[number];
   global.fetch=(async(input,init)=>{
    if(String(input)==='https://api.openai.com/v1/responses' && JSON.parse(String(init?.body)).text?.format?.name==='thongthai_visitor_question') {
     harness.programGeminiReply({topic:current.topic,scope:current.topic==='horse_price'?'activity':'venue',confidence:0.98});
    }
    return actual(input,init);
   }) as typeof fetch;
   try {
    for(const [index,scenario] of VISITOR_PARAPHRASES.entries()) {
     current=scenario;
     const result=await processThongthaiChatCore(brainRequest(scenario.question,id,channel,history.slice(-12)),'paraphrase-sequence-'+index);
     const answer=String((result.payload as any).message);
     assert.ok(answer.includes(scenario.must),`${index+1}: ${answer}`);
     history.push({role:'user',content:scenario.question},{role:'assistant',content:answer});
    }
    for(const table of ['bookings','ops_feedback_events','restaurant_preorders','payment_requests'])assert.equal(harness.postsTo(table).length,0);
   } finally {global.fetch=actual;}
  });
 }));
}
