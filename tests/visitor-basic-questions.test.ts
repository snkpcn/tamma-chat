import test from 'node:test';
import assert from 'node:assert/strict';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';
import { withHarness,guestId,brainRequest } from './helpers/canonical-core-harness';
import { VISITOR_BASIC_QUESTIONS } from './fixtures/visitor-basic-questions';
import { classifyVisitorInformation,answerVisitorInformation } from '../netlify/functions/_visitor-information';

for(const channel of ['web','line'] as const) {
  for(const scenario of VISITOR_BASIC_QUESTIONS) {
    test(`${channel}: basic ${scenario.id}: ${scenario.question}`,async()=>{
      await withHarness(async harness=>{
        const result=await processThongthaiChatCore(brainRequest(scenario.question,guestId('basic-'+channel+'-'+scenario.id),channel),'basic-'+scenario.id);
        const message=String((result.payload as any).message);
        assert.ok(message.includes(scenario.mustMention),message);
        assert.doesNotMatch(message,/ยังตอบเรื่องนี้ให้แม่นไม่ได้|ลองอีกครั้งสักครู่|ขอรายละเอียดเพิ่มอีกนิด|ระบบแจ้งเตือน.*สำเร็จ|บันทึกเรื่องไว้แล้ว/);
        if([8,10,14,15,17,18,19,20,21,22,23,24,25,28].includes(scenario.id)) {
          assert.match(message,/ยังไม่มี|ยังไม่|ยังยืนยันไม่ได้|ต้อง.*เช็ก|แนะนำติดต่อ|ประเมิน/);
        }
        assert.equal(harness.modelCallCount(),0,'basic grounded/missing-source questions must not need a model');
        for(const table of ['ops_feedback_events','ops_escalations','bookings','restaurant_table_bookings','restaurant_preorders','payment_requests','ops_notification_outbox']) {
          assert.equal(harness.postsTo(table).length,0,`a visitor question must not create ${table}`);
        }
        if(scenario.id===12)assert.doesNotMatch(message,/• ต้มยำกุ้ง/,'unknown/spicy dishes cannot be proposed as non-spicy child food');
      });
    });
  }
}
for(const message of ['ช่วยจองโต๊ะ 15 คนให้หน่อย','ขอคืนเงินกิจกรรมเพราะฝนตก','ยกเลิกห้องพักให้หน่อย','ช่วยติดต่อทีมงานเรื่องรถเข็น','ที่จอดรถมีของหาย','ลูกบาดเจ็บตอนขี่ม้า','ขอสั่งของฝากส่งกรุงเทพให้หน่อย']) {
  test(`visitor facts yield to an action/incident: ${message}`,()=>assert.equal(classifyVisitorInformation(message),null));
}
test('food browse reads changed live menu instead of embedding fixture examples',async()=>{
  await withHarness(async()=>{
    const answer=await answerVisitorInformation({message:'มีอะไรกินบ้าง นอกจากกาแฟ?',channel:'web'});
    assert.ok(answer?.message.includes('แกงทดสอบ'));
    assert.ok(!answer?.message.includes('ต้มยำกุ้ง'));
    assert.ok(answer?.sourceIds.includes('restaurant_menu_live'));
  },{restaurantMenu:[{menu_item_id:'test-soup',name:'แกงทดสอบ',category_name:'แกง',selling_price:222,ingredient_names:['ฟัก'],is_orderable:true,available_servings:10,source_updated_at:new Date().toISOString()}]});
});
test('configured nightly prices are read but never prove that the accommodation is open',async()=>{
  await withHarness(async()=>{
    const answer=await answerVisitorInformation({message:'เฮือนสเตย์เปิดให้พักแล้วไหม คืนละเท่าไร?',channel:'web'});
    assert.match(answer?.message ?? '',/1234 บาทต่อคืน/);
    assert.match(answer?.message ?? '',/ยังไม่ยืนยันว่าเปิดรับพัก/);
    assert.ok(answer?.sourceIds.includes('stay_service_resources_live'));
  },{serviceResources:[{id:'room-test',code:'stay-test',name:'ห้องทดสอบ',description:'',default_capacity:3,active:true,metadata:{pricePerNight:1234},updated_at:new Date().toISOString()}]});
});

for(const channel of ['web','line'] as const) {
  test(`${channel}: all 28 questions in ONE conversation retain meaning without accidental transactions`,async()=>{
    await withHarness(async harness=>{
      const id=guestId('all-basic-one-conversation-'+channel);
      const history:Array<{role:'user'|'assistant';content:string}>=[];
      for(const scenario of VISITOR_BASIC_QUESTIONS) {
        const result=await processThongthaiChatCore(brainRequest(scenario.question,id,channel,history.slice(-12)),'basic-sequence-'+scenario.id);
        const answer=String((result.payload as any).message);
        assert.ok(answer.includes(scenario.mustMention),`${scenario.id}: ${answer}`);
        assert.doesNotMatch(answer,/ยังตอบเรื่องนี้ให้แม่นไม่ได้|ลองอีกครั้งสักครู่|บันทึกเรื่องไว้แล้ว/);
        history.push({role:'user',content:scenario.question},{role:'assistant',content:answer});
      }
      assert.equal(harness.modelCallCount(),0);
      for(const table of ['ops_feedback_events','ops_escalations','bookings','restaurant_table_bookings','restaurant_preorders','payment_requests'])assert.equal(harness.postsTo(table).length,0,table);
    });
  });
}
