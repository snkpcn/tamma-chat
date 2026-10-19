import test from 'node:test';
import assert from 'node:assert/strict';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';
import { answerVisitorInformation,classifyVisitorInformation } from '../netlify/functions/_visitor-information';
import { withHarness,brainRequest,guestId } from './helpers/canonical-core-harness';
import { USER_VENUE_FACTS,CAFE_PRICE_REFERENCES } from '../netlify/functions/_user-supplied-venue-facts';

for(const channel of ['web','line'] as const)for(const [question,pattern] of [
 ['ต้องเสียค่าเข้าหรือเปล่า?',/คาเฟ่.*ได้ฟรี.*เฉพาะอาหาร/s],
 ['มีที่จอดรถกับห้องน้ำไหม?',/ด้านหน้าร้าน.*ใกล้ทางลาด.*หมุนรถเข็น.*ราวจับ/s],
 ['ผู้สูงอายุใช้รถเข็นไปเที่ยวสะดวกไหม?',/ทางลาด.*ห้องน้ำ.*แต่ละโซนยังต้องเช็ก/s],
 ['ลาเต้เย็นกี่บาท',/ราคาอ้างอิง.*รอยืนยัน|ราคาอ้างอิง.*รอการยืนยัน/s],
 ['เพิ่มช็อตอูจิกี่บาท',/เพิ่มช็อต.*25 บาท/s],
 ['มีครัวซองต์กับเค้กไหม',/ครัวซองต์.*หมุนเวียน/s],
 ['มีอะไรกินบ้าง นอกจากกาแฟ?',/ตำไทย.*ตำลาว.*คอหมูย่าง/s],
] as const) {
 test(`${channel}: supplied cafe facts: ${question}`,async()=>{
  await withHarness(async harness=>{
   const result=await processThongthaiChatCore(brainRequest(question,guestId('supplied-'+question),channel),'supplied');
   assert.match(String((result.payload as any).message),pattern);
   assert.equal(harness.modelCallCount(),0);
   for(const table of ['bookings','restaurant_preorders','payment_requests'])assert.equal(harness.postsTo(table).length,0);
  });
 });
}
test('cafe facilities do not establish every-zone access, wheelchair loan or free activities',async()=>{
 const access=await answerVisitorInformation({message:'ผู้สูงอายุใช้รถเข็นไปเที่ยวสะดวกไหม?',channel:'web'});
 assert.ok(access?.sourceIds.includes(USER_VENUE_FACTS.sourceId));
 assert.ok(access?.missingFields.includes('venue.all_zone_accessibility'));
 assert.ok(access?.missingFields.includes('venue.wheelchair_loan'));
 assert.doesNotMatch(access?.message ?? '',/ทุกโซนสะดวก|มีรถเข็นให้ยืม|ปลอดภัยแน่นอน/);
 const stay=await answerVisitorInformation({message:'ที่พักมีห้องน้ำไหม?',channel:'web'});
 assert.match(stay?.message ?? '',/ยังไม่มีข้อมูลแยก/);
});
test('a live cafe price overrides the unconfirmed reference',async()=>{
 await withHarness(async()=>{
  const actual=global.fetch;
  global.fetch=(async(input,init)=>{
   if(String(input).includes('/rest/v1/cafe_master_menu_items?'))return new Response(JSON.stringify([{code:'cafe_latte',name_th:'ลาเต้',name_en:'Latte',category:'coffee',prices:{iced:89},active:true,available_all_branches:true,source:'branch',source_verified_at:new Date().toISOString(),updated_at:new Date().toISOString(),metadata:{}}]),{headers:{'content-type':'application/json'}});
   return actual(input,init);
  }) as typeof fetch;
  try {
   const result=await answerVisitorInformation({message:'ลาเต้เย็นกี่บาท',channel:'web'});
   assert.match(result?.message ?? '',/89 บาท/);
   assert.doesNotMatch(result?.message ?? '',/70 บาท|ราคาอ้างอิง/);
   assert.ok(result?.sourceIds.includes('cafe_menu_live'));
  } finally {global.fetch=actual;}
 });
});
test('longer aliases do not confuse Thai tea latte with coffee latte; separate requested drinks remain separate',async()=>{
 await withHarness(async()=>{
  const tea=await answerVisitorInformation({message:'ชาไทยลาเต้เย็นราคาเท่าไหร่',channel:'web'});
  assert.match(tea?.message ?? '',/ชาไทยลาเต้: เย็น 60 บาท/);
  assert.doesNotMatch(tea?.message ?? '',/เย็น 70 บาท/);
  const both=await answerVisitorInformation({message:'คาปูชิโน่กับลาเต้เย็นราคาเท่าไหร่',channel:'web'});
  assert.match(both?.message ?? '',/คาปูชิโน่/);assert.match(both?.message ?? '',/ลาเต้/);
 });
});
test('unverified references never become allergen guarantees or prices of another branch',async()=>{
 assert.notEqual(classifyVisitorInformation('แพ้ถั่ว กินเค้กนี้ได้ไหม'),'cafe_menu_reference');
 await withHarness(async()=>{
  const other=await answerVisitorInformation({message:'อินทนิลสาขาสุเทพลาเต้เย็นกี่บาท',channel:'web'});
  assert.match(other?.message ?? '',/ยังยืนยันราคาของสาขาที่ถามไม่ได้/);
  assert.doesNotMatch(other?.message ?? '',/70 บาท/);
 });
 assert.equal(USER_VENUE_FACTS.horseReference.durationMinutes,90);
 assert.equal(USER_VENUE_FACTS.horseReference.priceThb,500);
 assert.equal(CAFE_PRICE_REFERENCES.find(item=>item.code==='americano')?.prices.blended,undefined);
});

test('the supplied 500-baht/90-minute riding quote cannot replace a different live offering',async()=>{
 await withHarness(async()=>{
  const reference=await answerVisitorInformation({message:'ขี่ม้าชั่วโมงครึ่ง 500 บาทใช่ไหม',channel:'web'});
  assert.match(reference?.message ?? '',/90 นาที.*500 บาท.*ยังไม่ตรง/s);
  assert.ok(reference?.missingFields.includes('horse.current_90_minute_offering'));
  const generic=await processThongthaiChatCore(brainRequest('ขี่ม้าราคาเท่าไร ได้ขี่กี่นาที?',guestId('live-horse-price')),'live-price');
  assert.match(String((generic.payload as any).message),/30 นาที 300 บาท/);
  assert.doesNotMatch(String((generic.payload as any).message),/90 นาที/);
 });
});
