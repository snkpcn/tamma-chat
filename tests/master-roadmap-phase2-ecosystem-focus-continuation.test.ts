// PHASE 2 — OWN-QUESTION CONTINUITY FOR ECOSYSTEM FOCUS CHOICE
//
// Production smoke 2026-09-25:
// Thongthai asked:
//   "อยากเน้นกินข้าว คาเฟ่ หรือกิจกรรมเบา ๆ ครับ?"
// Customer answered:
//   "อยากเน้นกินข้าว"
// Actual:
//   generic "ขอรายละเอียดเพิ่มอีกนิดครับ จะได้ช่วยต่อให้ตรงเรื่อง"
//
// LINE sends no chat history, so the bot must persist the unresolved branch
// question and resolve the customer's next answer from server state.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { withHarness } from './helpers/canonical-core-harness';
import { handler as lineWebhookHandler } from '../netlify/functions/line-webhook';

const SECRET='phase2-ecosystem-focus-continuation-secret';
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

function row(id:string,name:string,price:number,ingredients:string[]){
  return {
    menu_item_id:id,
    category_name:'ย่าง • ทอด',
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

async function establishMobilityChoice(user:string){
  await callLine('แม่เดินไกลไม่ได้',user);
  await callLine('มีอะไรแนะนำ',user);
}

test('full LINE: own prompt -> "อยากเน้นกินข้าว" continues into grounded restaurant recommendations',async()=>{
  const old=process.env.LINE_CHANNEL_SECRET;
  process.env.LINE_CHANNEL_SECRET=SECRET;
  try{
    await withHarness(async()=>{
      const capture=installCapture();
      try{
        const user='phase2-focus-food';
        await establishMobilityChoice(user);
        const chooser=textOf(capture.replies[1]);
        assert.match(chooser,/อยากเน้นกินข้าว คาเฟ่ หรือกิจกรรมเบา/u);

        await callLine('อยากเน้นกินข้าว',user);
        const answer=textOf(capture.replies[2]);

        assert.doesNotMatch(answer,/ขอรายละเอียดเพิ่มอีกนิด|ช่วยต่อให้ตรงเรื่อง/u);
        assert.match(answer,/บาท/u,'food branch should use grounded menu rows');
        assert.match(answer,/คอหมูทอดสมุนไพร|ไข่เจียวหมูสับ/u);
      } finally { capture.restore(); }
    },{
      restaurantMenu:[
        row('m1','คอหมูทอดสมุนไพร',169,['คอหมู','ตะไคร้']),
        row('m2','ไข่เจียวหมูสับ',99,['ไข่ไก่','หมูสับ']),
      ],
    });
  } finally {
    if(old===undefined) delete process.env.LINE_CHANNEL_SECRET;
    else process.env.LINE_CHANNEL_SECRET=old;
  }
});

test('full LINE: own prompt -> cafe branch answers specifically, never generic clarification',async()=>{
  const old=process.env.LINE_CHANNEL_SECRET;
  process.env.LINE_CHANNEL_SECRET=SECRET;
  try{
    await withHarness(async()=>{
      const capture=installCapture();
      try{
        const user='phase2-focus-cafe';
        await establishMobilityChoice(user);
        await callLine('เอาคาเฟ่',user);
        const answer=textOf(capture.replies[2]);
        assert.match(answer,/Inthanin|คาเฟ่/u);
        assert.match(answer,/กาแฟ|ชา|เครื่องดื่ม/u);
        assert.doesNotMatch(answer,/ขอรายละเอียดเพิ่มอีกนิด|ช่วยต่อให้ตรงเรื่อง/u);
      } finally { capture.restore(); }
    });
  } finally {
    if(old===undefined) delete process.env.LINE_CHANNEL_SECRET;
    else process.env.LINE_CHANNEL_SECRET=old;
  }
});

test('full LINE: own prompt -> light-activity branch answers specifically, never generic clarification',async()=>{
  const old=process.env.LINE_CHANNEL_SECRET;
  process.env.LINE_CHANNEL_SECRET=SECRET;
  try{
    await withHarness(async()=>{
      const capture=installCapture();
      try{
        const user='phase2-focus-activity';
        await establishMobilityChoice(user);
        await callLine('กิจกรรมเบา ๆ',user);
        const answer=textOf(capture.replies[2]);
        assert.match(answer,/ขี่ม้า|ยิงธนู|ชมวิว/u);
        assert.doesNotMatch(answer,/ขอรายละเอียดเพิ่มอีกนิด|ช่วยต่อให้ตรงเรื่อง/u);
      } finally { capture.restore(); }
    });
  } finally {
    if(old===undefined) delete process.env.LINE_CHANNEL_SECRET;
    else process.env.LINE_CHANNEL_SECRET=old;
  }
});

test('full LINE: direct "อยากเน้นกินข้าว" without prior state still gets a specific food question',async()=>{
  const old=process.env.LINE_CHANNEL_SECRET;
  process.env.LINE_CHANNEL_SECRET=SECRET;
  try{
    await withHarness(async()=>{
      const capture=installCapture();
      try{
        await callLine('อยากเน้นกินข้าว','phase2-direct-food-focus');
        const answer=textOf(capture.replies[0]);
        assert.match(answer,/เผ็ด|แพ้อาหาร|ปลาร้า/u);
        assert.doesNotMatch(answer,/ขอรายละเอียดเพิ่มอีกนิด|ช่วยต่อให้ตรงเรื่อง/u);
      } finally { capture.restore(); }
    });
  } finally {
    if(old===undefined) delete process.env.LINE_CHANNEL_SECRET;
    else process.env.LINE_CHANNEL_SECRET=old;
  }
});
