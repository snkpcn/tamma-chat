// PHASE 2 CLOSEOUT — GENERIC PERSISTED PENDING-QUESTION CONTINUITY
//
// This test intentionally exercises the REAL signed LINE webhook with no
// transport chat history. The continuation contract must therefore live in
// server-side guest_agent_state, not in LINE chatHistory and not in a
// phrase-specific responder.
//
// RED proof expected before implementation:
// current main persists active_topic/unresolved_need for the ecosystem
// question, but no structured pending_question contract.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { withHarness, type Harness } from './helpers/canonical-core-harness';
import { handler as lineWebhookHandler } from '../netlify/functions/line-webhook';
import { resolvePendingQuestionAnswer } from '../netlify/functions/_conversation-continuity';

const SECRET='phase2-generic-pending-question-secret';
type CapturedReply={messages:Array<{type:string;text?:string}>};

function installCapture(){
  const original=global.fetch;
  const replies:CapturedReply[]=[];
  global.fetch=(async(url:string|URL,init?:RequestInit)=>{
    if(String(url).includes('api.line.me/v2/bot/message/reply')){
      replies.push(JSON.parse(String(init?.body??'{}')) as CapturedReply);
      return new Response('{}',{status:200,headers:{'content-type':'application/json'}});
    }
    return original(url as never,init);
  }) as typeof fetch;
  return {replies,restore:()=>{global.fetch=original;}};
}

let seq=0;
function evt(text:string,userId:string){
  seq+=1;
  return {
    type:'message',
    replyToken:`reply-${seq}`,
    timestamp:Date.now()+seq,
    source:{type:'user',userId},
    message:{id:`msg-${seq}`,type:'text',text},
  };
}

async function callLine(text:string,userId:string){
  const body=JSON.stringify({destination:'test',events:[evt(text,userId)]});
  const signature=createHmac('sha256',SECRET).update(body,'utf8').digest('base64');
  return lineWebhookHandler({httpMethod:'POST',headers:{'x-line-signature':signature},body} as never,{} as never);
}

function textOf(reply:CapturedReply|undefined){
  return reply?.messages.map(m=>m.text??'').join('\n')??'';
}

function lineGuestId(userId:string):string{
  const hex=createHash('sha256').update('tamma-line:'+userId,'utf8').digest('hex').slice(0,32).split('');
  hex[12]='5';
  hex[16]=((parseInt(hex[16],16)&0x3)|0x8).toString(16);
  const v=hex.join('');
  return `${v.slice(0,8)}-${v.slice(8,12)}-${v.slice(12,16)}-${v.slice(16,20)}-${v.slice(20,32)}`;
}

function stateFor(h:Harness,userId:string):Record<string,unknown>{
  const guestDbId=h.guestDbId(lineGuestId(userId));
  assert.ok(guestDbId,'LINE guest should resolve to canonical guest row');
  return h.getState(guestDbId)?.state ?? {};
}

function menuRow(id:string,name:string,price:number,ingredients:string[]){
  return {
    menu_item_id:id,
    category_name:'อาหารจานหลัก',
    category_sort_order:1,
    sort_order:Number(id.replace(/\D/g,''))||1,
    name,
    selling_price:price,
    description:name,
    is_signature:id==='m1',
    ingredient_names:ingredients,
    unavailable_ingredients:[],
    available_servings:20,
    is_orderable:true,
    source_updated_at:new Date().toISOString(),
  };
}

test('full signed LINE: Thongthai persists a semantic pending question and resolves its own food answer with zero model calls',async()=>{
  const old=process.env.LINE_CHANNEL_SECRET;
  process.env.LINE_CHANNEL_SECRET=SECRET;
  try{
    await withHarness(async h=>{
      const capture=installCapture();
      try{
        const user='phase2-generic-pending-question-user';

        await callLine('แม่เดินไกลไม่ได้',user);
        await callLine('มีอะไรแนะนำ',user);

        const chooser=textOf(capture.replies[1]);
        assert.match(chooser,/อยากเน้นกินข้าว คาเฟ่ หรือกิจกรรมเบา/u);

        const state=stateFor(h,user);
        const pending=state.pending_question as {
          domain?:string;
          kind?:string;
          choices?:Array<{value?:string}>;
        }|undefined;

        // Load-bearing architectural proof: deleting pending-question
        // persistence must make this fail even if a phrase-specific fallback
        // still happens to answer the next message.
        assert.ok(pending,'own clarification/choice question must persist pending_question');
        assert.equal(pending?.domain,'general_recommendation');
        assert.equal(pending?.kind,'preference_choice');
        assert.deepEqual(
          (pending?.choices??[]).map(choice=>choice.value),
          ['restaurant','cafe','light_activity'],
        );

        const modelCallsBefore=h.modelCallCount();
        await callLine('อยากเน้นกินข้าว',user);
        const answer=textOf(capture.replies[2]);

        assert.doesNotMatch(answer,/ขอรายละเอียดเพิ่มอีกนิด|ช่วยต่อให้ตรงเรื่อง/u);
        assert.match(answer,/คอหมูทอดสมุนไพร|ไข่เจียวหมูสับ|ร้านอาหาร|เมนู/u);
        assert.equal(h.modelCallCount(),modelCallsBefore,'pending-choice resolution must be deterministic');

        const stateAfter=stateFor(h,user);
        assert.equal(stateAfter.pending_question,undefined,'resolved question must be cleared');
      } finally { capture.restore(); }
    },{
      restaurantMenu:[
        menuRow('m1','คอหมูทอดสมุนไพร',169,['คอหมู','ตะไคร้']),
        menuRow('m2','ไข่เจียวหมูสับ',99,['ไข่ไก่','หมูสับ']),
      ],
    });
  } finally {
    if(old===undefined) delete process.env.LINE_CHANNEL_SECRET;
    else process.env.LINE_CHANNEL_SECRET=old;
  }
});


test('generic resolver is domain-agnostic: entity choice + Thai-digit party size, with ambiguity rejected',()=>{
  const horse = {
    domain:'horse_selection',
    kind:'entity_choice' as const,
    choices:[
      {value:'horse_thongthai',aliases:['ทองไทย']},
      {value:'horse_pharadon',aliases:['ภาราดร']},
    ],
  };
  assert.equal(resolvePendingQuestionAnswer('เอาทองไทยครับ',horse)?.value,'horse_thongthai');
  assert.equal(resolvePendingQuestionAnswer('ภาราดรดีกว่า',horse)?.value,'horse_pharadon');
  assert.equal(resolvePendingQuestionAnswer('ทองไทยหรือภาราดรดี',horse),null,'must not guess when two offered choices are named');

  assert.equal(
    resolvePendingQuestionAnswer('๔ คนครับ',{domain:'booking',kind:'party_size',slot:'party_size'})?.value,
    4,
  );
});

test('full signed LINE: stale ecosystem pending question yields to a clear horse domain switch and is discarded',async()=>{
  const old=process.env.LINE_CHANNEL_SECRET;
  process.env.LINE_CHANNEL_SECRET=SECRET;
  try{
    await withHarness(async h=>{
      const capture=installCapture();
      try{
        const user='phase2-pending-switch-horse';
        await callLine('แม่เดินไกลไม่ได้',user);
        await callLine('มีอะไรแนะนำ',user);
        const before=stateFor(h,user);
        assert.ok(before.pending_question,'precondition: ecosystem question is pending');

        const modelCallsBefore=h.modelCallCount();
        await callLine('อยากขี่ม้า ไม่เคยเลย กลัวตก',user);
        const horse=textOf(capture.replies[2]);

        assert.match(horse,/ขี่ม้า|ทีมงาน|ช้า/u);
        assert.doesNotMatch(horse,/คาเฟ่|เน้นกินข้าว|ขอรายละเอียดเพิ่มอีกนิด/u);
        assert.equal(h.modelCallCount(),modelCallsBefore,'explicit horse care must remain deterministic');
        assert.equal(stateFor(h,user).pending_question,undefined,'explicit new domain must retire stale pending question');
      } finally { capture.restore(); }
    });
  } finally {
    if(old===undefined) delete process.env.LINE_CHANNEL_SECRET;
    else process.env.LINE_CHANNEL_SECRET=old;
  }
});

test('PHASE 2 CLOSEOUT full signed LINE matrix: memory, own-question follow-up, clean domain switches, authority and safety precedence',async()=>{
  const oldSecret=process.env.LINE_CHANNEL_SECRET;
  const oldWeatherKey=process.env.WEATHER_API_KEY;
  const oldLat=process.env.TAMMA_WEATHER_LAT;
  const oldLon=process.env.TAMMA_WEATHER_LON;
  process.env.LINE_CHANNEL_SECRET=SECRET;
  process.env.WEATHER_API_KEY='test-weather-key';
  process.env.TAMMA_WEATHER_LAT='15.80';
  process.env.TAMMA_WEATHER_LON='102.03';

  try{
    await withHarness(async h=>{
      h.programOpsChannel('owner_general');
      h.programOpsChannel('activity');
      const capture=installCapture();
      try{
        const user='phase2-closeout-matrix';
        const safeNames=['คอหมูทอดสมุนไพร','ไข่เจียวหมูสับ','ปลานิลทอดน้ำปลา','ต้มจืดหมูสับ','ข้าวผัดหมู'];

        // 1 — durable mobility memory.
        await callLine('แม่เดินไกลไม่ได้',user);

        // 2 — recommendation shaped by durable memory; own question persisted.
        await callLine('มีอะไรแนะนำ',user);
        const chooser=textOf(capture.replies[1]);
        assert.match(chooser,/เดินน้อย/u);
        assert.match(chooser,/อยากเน้นกินข้าว คาเฟ่ หรือกิจกรรมเบา/u);
        assert.ok(stateFor(h,user).pending_question);

        // 3 — obvious answer to Thongthai's own question, no generic clarify.
        const callsBeforeFood=h.modelCallCount();
        await callLine('อยากเน้นกินข้าว',user);
        const foodStart=textOf(capture.replies[2]);
        assert.doesNotMatch(foodStart,/ขอรายละเอียดเพิ่มอีกนิด|ช่วยต่อให้ตรงเรื่อง/u);
        assert.match(foodStart,/บาท|เมนู|คอหมูทอดสมุนไพร|ไข่เจียวหมูสับ/u);
        assert.equal(h.modelCallCount(),callsBeforeFood);
        assert.equal(stateFor(h,user).pending_question,undefined);

        // 4 — constraint declaration is acknowledgement only, never a menu dump.
        await callLine('ไม่กินเผ็ด ไม่กินไก่ ไม่กินกุ้ง',user);
        const constraintAck=textOf(capture.replies[3]);
        assert.match(constraintAck,/เผ็ด|ไก่|กุ้ง/u);
        assert.doesNotMatch(constraintAck,/\d+\s*บาท/u);

        // 5 — grounded menu obeys all current constraints.
        await callLine('มีอะไรแนะนำบ้าง',user);
        const menu1=textOf(capture.replies[4]);
        assert.ok(safeNames.some(name=>menu1.includes(name)),'must recommend at least one real safe menu row');
        assert.doesNotMatch(menu1,/ไก่ย่าง|กุ้งทอด|ยำพริกสด/u);

        // 6 — another recommendation never blindly repeats the same page.
        await callLine('มีอะไรแนะนำอีก',user);
        const menu2=textOf(capture.replies[5]);
        const shown1=safeNames.filter(name=>menu1.includes(name));
        const shown2=safeNames.filter(name=>menu2.includes(name));
        const honestNoMore=/ไม่มี.*(?:เมนู|ตัวเลือก)|หมดแล้ว|เท่านี้|ยังไม่มี/u.test(menu2);
        assert.ok(honestNoMore || shown2.some(name=>!shown1.includes(name)),'must show an unseen grounded item or honestly say there are no more');

        // 7 — assistant name must not become the horse entity.
        await callLine('ขอโลเคชั่นหน่อยทองไทย',user);
        const location=textOf(capture.replies[6]);
        assert.match(location,/maps\.app\.goo\.gl|พิกัด|แผนที่|นำทาง/u);
        assert.doesNotMatch(location,/เลือกทองไทย|เคยขี่ม้ามาก่อนไหม/u);

        // 8 — weather is explicit current intent, not stale restaurant context.
        h.programWeatherFetch({ok:true,body:{
          weather:[{main:'Rain',description:'light rain'}],
          main:{temp:28},
          rain:{'1h':0.8},
        }});
        await callLine('ตอนนี้ฝนตกไหม',user);
        const weather=textOf(capture.replies[7]);
        assert.match(weather,/ฝน|อากาศ|28/u);
        assert.doesNotMatch(weather,/เมนู|เลือกทองไทย|ขอรายละเอียดเพิ่มอีกนิด/u);

        // 9 — explicit new horse intent cleanly switches domain.
        const callsBeforeHorse=h.modelCallCount();
        await callLine('อยากขี่ม้า ไม่เคยเลย กลัวตก',user);
        const horseCare=textOf(capture.replies[8]);
        assert.match(horseCare,/ขี่ม้า|ทีมงาน|ช้า|กลัว/u);
        assert.doesNotMatch(horseCare,/ชำระเงิน|เลือกระยะเวลา\s*30/u);
        assert.equal(h.modelCallCount(),callsBeforeHorse);

        // 10 — horse-name collision is now correctly interpreted inside horse context.
        await callLine('เอาทองไทย',user);
        const horseChoice=textOf(capture.replies[9]);
        assert.match(horseChoice,/เลือกทองไทย|ทองไทย/u);
        assert.doesNotMatch(horseChoice,/โลเคชั่น|แผนที่/u);

        // 11 — authority boundary overrides the active horse task.
        await callLine('ขอคืนเงินได้ไหม',user);
        const refund=textOf(capture.replies[10]);
        assert.match(refund,/ไม่ยืนยันแทนเจ้าของ|เจ้าของ.*ตรวจสอบ/u);
        assert.doesNotMatch(refund,/เคยขี่ม้ามาก่อนไหม|เลือกระยะเวลา/u);

        // 12 — urgent safety overrides every active task and notifies activity + owner.
        await callLine('พื้นลื่นมาก ตอนเล่น ATV น่ากลัว',user);
        const safety=textOf(capture.replies[11]);
        assert.match(safety,/ทีมกิจกรรม.*เจ้าของ|ความปลอดภัย|ตรวจสอบ/u);
        assert.doesNotMatch(safety,/เลือกระยะเวลา\s*30.*60.*90/u);

        const events=h.postsTo('ops_feedback_events');
        assert.ok(events.some(e=>e.feedback_type==='complaint' && e.business_unit==='general'),'refund must create owner-review event');
        assert.ok(events.some(e=>e.feedback_type==='safety_issue' && e.business_unit==='activity'),'ATV safety must create activity safety event');

        // Durable constraints survived all of the domain turns above.
        const gid=h.guestDbId(lineGuestId(user));
        assert.ok(gid);
        const constraints=h.getGuestMemory(gid!,'constraints');
        assert.ok(Array.isArray(constraints));
        for(const expected of ['limited_walking','no_spicy','no_chicken','no_shrimp']){
          assert.ok((constraints as unknown[]).includes(expected),`durable constraint missing after cross-domain turns: ${expected}`);
        }
      } finally { capture.restore(); }
    },{
      restaurantMenu:[
        menuRow('m1','คอหมูทอดสมุนไพร',169,['คอหมู','ตะไคร้']),
        menuRow('m2','ไข่เจียวหมูสับ',99,['ไข่ไก่','หมูสับ']),
        menuRow('m3','ปลานิลทอดน้ำปลา',189,['ปลานิล','น้ำปลา']),
        menuRow('m4','ต้มจืดหมูสับ',149,['หมูสับ','ผักกาดขาว']),
        menuRow('m5','ข้าวผัดหมู',109,['หมู','ข้าว','ไข่ไก่']),
        menuRow('m6','ไก่ย่าง',159,['ไก่']),
        menuRow('m7','กุ้งทอด',199,['กุ้ง']),
        menuRow('m8','ยำพริกสด',139,['หมู','พริก']),
      ],
    });
  } finally {
    if(oldSecret===undefined) delete process.env.LINE_CHANNEL_SECRET; else process.env.LINE_CHANNEL_SECRET=oldSecret;
    if(oldWeatherKey===undefined) delete process.env.WEATHER_API_KEY; else process.env.WEATHER_API_KEY=oldWeatherKey;
    if(oldLat===undefined) delete process.env.TAMMA_WEATHER_LAT; else process.env.TAMMA_WEATHER_LAT=oldLat;
    if(oldLon===undefined) delete process.env.TAMMA_WEATHER_LON; else process.env.TAMMA_WEATHER_LON=oldLon;
  }
});
