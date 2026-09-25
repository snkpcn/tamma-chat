// PHASE 2 — RESTAURANT DIETARY PRECEDENCE OVER LOCAL CONCIERGE
//
// Production smoke 2026-09-25:
// "ไม่กินเผ็ดด้วยนะ"
// and
// "บอกว่าไม่กินเผ็ด ไม่กินไก่ ไม่กินกุ้ง มีอะไรแนะนำบ้าง"
// were swallowed by Local Concierge's generic Isan-food answer before the
// deterministic restaurant dietary responder ran.
//
// These tests lock the intended meaning-first precedence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { withHarness } from './helpers/canonical-core-harness';
import { handler as lineWebhookHandler } from '../netlify/functions/line-webhook';

const SECRET = 'phase2-restaurant-precedence-secret';
type CapturedReply = { messages: Array<{ type:string; text?:string }> };

function installCapture(){
  const original = global.fetch;
  const replies: CapturedReply[] = [];
  global.fetch = (async (url:string|URL, init?:RequestInit) => {
    if (String(url).includes('api.line.me/v2/bot/message/reply')) {
      replies.push(JSON.parse(String(init?.body ?? '{}')) as CapturedReply);
      return new Response('{}', { status:200, headers:{'content-type':'application/json'} });
    }
    return original(url as never, init);
  }) as typeof fetch;
  return { replies, restore:()=>{ global.fetch = original; } };
}

let seq = 0;
function event(text:string, userId:string){
  seq += 1;
  return {
    type:'message',
    replyToken:`reply-${seq}`,
    timestamp:Date.now()+seq,
    source:{type:'user',userId},
    message:{id:`msg-${seq}`,type:'text',text},
  };
}

async function callLine(text:string, userId:string){
  const body = JSON.stringify({ destination:'test', events:[event(text,userId)] });
  const sig = createHmac('sha256', SECRET).update(body,'utf8').digest('base64');
  return lineWebhookHandler(
    { httpMethod:'POST', headers:{'x-line-signature':sig}, body } as never,
    {} as never,
  );
}

function replyText(reply:CapturedReply|undefined){
  return reply?.messages.map(m=>m.text ?? '').join('\n') ?? '';
}

function row(id:string,name:string,price:number,ingredients:string[],category='ย่าง • ทอด'){
  return {
    menu_item_id:id,
    category_name:category,
    category_sort_order:1,
    sort_order:Number(id.replace(/\D/g,'')) || 1,
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

test('full LINE: "ไม่กินเผ็ดด้วยนะ" gets short constraint ack, not Local Concierge generic food-culture copy', async()=>{
  const oldSecret = process.env.LINE_CHANNEL_SECRET;
  process.env.LINE_CHANNEL_SECRET = SECRET;
  try{
    await withHarness(async()=>{
      const capture = installCapture();
      try{
        const user='phase2-precedence-1';
        await callLine('ไม่กินไก่', user);
        await callLine('มีอะไรแนะนำอีก', user);
        await callLine('ไม่กินเผ็ดด้วยนะ', user);

        const t = replyText(capture.replies[2]);
        assert.match(t, /รับทราบ|ไม่เผ็ด/u);
        assert.doesNotMatch(t, /อาหารอีสานแท้|รสจัดจ้าน|อยากให้ทองไทยแนะนำเมนูจากร้านจริงตอนนี้เลยไหม/u);
        assert.doesNotMatch(t, /บาท/u, 'constraint-only turn must not dump menu');
      } finally { capture.restore(); }
    }, {
      restaurantMenu:[
        row('m1','ไก่บ้านทอดสมุนไพร',189,['ไก่บ้าน','ตะไคร้']),
        row('m2','คอหมูทอดสมุนไพร',169,['คอหมู','ตะไคร้']),
        row('m3','ลาบปลาช่อน',169,['ปลาช่อน','พริกสด'],'ลาบ'),
      ],
    });
  } finally {
    if (oldSecret === undefined) delete process.env.LINE_CHANNEL_SECRET;
    else process.env.LINE_CHANNEL_SECRET = oldSecret;
  }
});

test('full LINE: combined no-spicy/no-chicken/no-shrimp + recommendation is answered by grounded restaurant advisor', async()=>{
  const oldSecret = process.env.LINE_CHANNEL_SECRET;
  process.env.LINE_CHANNEL_SECRET = SECRET;
  try{
    await withHarness(async()=>{
      const capture = installCapture();
      try{
        const user='phase2-precedence-2';
        await callLine('บอกว่าไม่กินเผ็ด ไม่กินไก่ ไม่กินกุ้ง มีอะไรแนะนำบ้าง', user);
        const t = replyText(capture.replies[0]);

        assert.match(t, /บาท/u, 'explicit recommendation request should return grounded menu rows');
        assert.doesNotMatch(t, /อาหารอีสานแท้|รสจัดจ้าน|อยากให้ทองไทยแนะนำเมนูจากร้านจริงตอนนี้เลยไหม/u);
        assert.doesNotMatch(t, /ไก่บ้านทอดสมุนไพร/u);
        assert.doesNotMatch(t, /ต้มยำกุ้ง|กุ้ง/u);
        assert.doesNotMatch(t, /ลาบปลาช่อน/u);
        assert.match(t, /คอหมูทอดสมุนไพร/u);
      } finally { capture.restore(); }
    }, {
      restaurantMenu:[
        row('m1','ไก่บ้านทอดสมุนไพร',189,['ไก่บ้าน','ตะไคร้']),
        row('m2','คอหมูทอดสมุนไพร',169,['คอหมู','ตะไคร้']),
        row('m3','ต้มยำกุ้ง',199,['กุ้ง','พริกสด'],'ต้ม • นึ่ง'),
        row('m4','ลาบปลาช่อน',169,['ปลาช่อน','พริกสด'],'ลาบ'),
      ],
    });
  } finally {
    if (oldSecret === undefined) delete process.env.LINE_CHANNEL_SECRET;
    else process.env.LINE_CHANNEL_SECRET = oldSecret;
  }
});
