// PHASE 2 — SAME-TURN PREFERENCE MERGE
//
// Durable capture happens after request.guestContext is loaded. This test
// proves a newly captured dietary preference affects the SAME customer reply,
// not only the next turn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { withHarness } from './helpers/canonical-core-harness';
import { handler as lineWebhookHandler } from '../netlify/functions/line-webhook';

const SECRET='phase2-same-turn-pref-secret';
type Reply={messages:Array<{type:string;text?:string}>};

function captureReplies(){
  const original=global.fetch;
  const replies:Reply[]=[];
  global.fetch=(async(url:string|URL,init?:RequestInit)=>{
    if(String(url).includes('api.line.me/v2/bot/message/reply')){
      replies.push(JSON.parse(String(init?.body??'{}')) as Reply);
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
  const sig=createHmac('sha256',SECRET).update(body,'utf8').digest('base64');
  return lineWebhookHandler({httpMethod:'POST',headers:{'x-line-signature':sig},body} as never,{} as never);
}

function textOf(r:Reply|undefined){return r?.messages.map(m=>m.text??'').join('\n')??'';}

function row(id:string,name:string,price:number,ingredients:string[],category='ย่าง • ทอด'){
  return {
    menu_item_id:id,
    category_name:category,
    category_sort_order:1,
    sort_order:Number(id.replace(/\D/g,''))||1,
    name,
    selling_price:price,
    description:name,
    is_signature:false,
    ingredient_names:ingredients,
    unavailable_ingredients:[],
    available_servings:20,
    is_orderable:true,
    source_updated_at:new Date().toISOString(),
  };
}

test('full LINE: same-turn "ไม่กินกุ้ง" acknowledgement reflects shrimp immediately', async()=>{
  const old=process.env.LINE_CHANNEL_SECRET;
  process.env.LINE_CHANNEL_SECRET=SECRET;
  try{
    await withHarness(async()=>{
      const cap=captureReplies();
      try{
        await callLine('ไม่กินกุ้ง','same-turn-shrimp-user');
        const t=textOf(cap.replies[0]);
        assert.match(t,/รับทราบ|เลี่ยง/u);
        assert.match(t,/กุ้ง/u,'ack must mention the newly stated shrimp avoidance on the same turn');
        assert.doesNotMatch(t,/บาท/u,'constraint-only turn must not dump menu');
      }finally{cap.restore();}
    });
  }finally{
    if(old===undefined) delete process.env.LINE_CHANNEL_SECRET;
    else process.env.LINE_CHANNEL_SECRET=old;
  }
});

test('full LINE: combined same-turn constraints filter the grounded recommendation immediately', async()=>{
  const old=process.env.LINE_CHANNEL_SECRET;
  process.env.LINE_CHANNEL_SECRET=SECRET;
  try{
    await withHarness(async()=>{
      const cap=captureReplies();
      try{
        await callLine('ไม่กินเผ็ด ไม่กินไก่ ไม่กินกุ้ง มีอะไรแนะนำบ้าง','same-turn-combined-user');
        const t=textOf(cap.replies[0]);
        assert.match(t,/คอหมูทอดสมุนไพร/u);
        assert.match(t,/169\s*บาท/u);
        assert.doesNotMatch(t,/ไก่บ้านทอดสมุนไพร/u);
        assert.doesNotMatch(t,/ต้มยำกุ้ง/u);
        assert.doesNotMatch(t,/ลาบปลาช่อน/u);
      }finally{cap.restore();}
    },{
      restaurantMenu:[
        row('m1','คอหมูทอดสมุนไพร',169,['คอหมู','ตะไคร้','กระเทียม']),
        row('m2','ไก่บ้านทอดสมุนไพร',189,['ไก่บ้าน','ตะไคร้']),
        row('m3','ต้มยำกุ้ง',199,['กุ้ง','พริกสด'],'ต้ม • นึ่ง'),
        row('m4','ลาบปลาช่อน',169,['ปลาช่อน','พริกสด'],'ลาบ'),
      ],
    });
  }finally{
    if(old===undefined) delete process.env.LINE_CHANNEL_SECRET;
    else process.env.LINE_CHANNEL_SECRET=old;
  }
});
