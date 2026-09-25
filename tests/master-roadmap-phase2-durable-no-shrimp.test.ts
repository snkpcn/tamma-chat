// PHASE 2 — DURABLE NO_SHRIMP MUST COVER FRESH + DRIED SHRIMP
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { withHarness, type Harness } from './helpers/canonical-core-harness';
import { handler as lineWebhookHandler } from '../netlify/functions/line-webhook';

const SECRET='phase2-durable-no-shrimp-secret';
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
  return {type:'message',replyToken:`reply-${seq}`,timestamp:Date.now()+seq,source:{type:'user',userId},message:{id:`msg-${seq}`,type:'text',text}};
}
async function callLine(text:string,userId:string){
  const body=JSON.stringify({destination:'test',events:[evt(text,userId)]});
  const signature=createHmac('sha256',SECRET).update(body,'utf8').digest('base64');
  return lineWebhookHandler({httpMethod:'POST',headers:{'x-line-signature':signature},body} as never,{} as never);
}
function lineGuestId(userId:string):string{
  const hex=createHash('sha256').update('tamma-line:'+userId,'utf8').digest('hex').slice(0,32).split('');
  hex[12]='5';
  hex[16]=((parseInt(hex[16],16)&0x3)|0x8).toString(16);
  const v=hex.join('');
  return `${v.slice(0,8)}-${v.slice(8,12)}-${v.slice(12,16)}-${v.slice(16,20)}-${v.slice(20,32)}`;
}
function constraintsOf(h:Harness,userId:string):string[]{
  const gid=h.guestDbId(lineGuestId(userId));
  if(!gid) return [];
  const v=h.getGuestMemory(gid,'constraints');
  return Array.isArray(v)?v as string[]:[];
}
function textOf(r:CapturedReply|undefined){return r?.messages.map(m=>m.text??'').join('\n')??'';}
function row(id:string,name:string,price:number,ingredients:string[]){
  return {
    menu_item_id:id,category_name:'ต้ม • นึ่ง',category_sort_order:1,sort_order:Number(id.replace(/\D/g,''))||1,
    name,selling_price:price,description:name,is_signature:false,ingredient_names:ingredients,
    unavailable_ingredients:[],available_servings:20,is_orderable:true,source_updated_at:new Date().toISOString(),
  };
}

test('full LINE: durable no_shrimp excludes fresh and dried shrimp on later recommendation', async()=>{
  const old=process.env.LINE_CHANNEL_SECRET;
  process.env.LINE_CHANNEL_SECRET=SECRET;
  try{
    await withHarness(async h=>{
      const capture=installCapture();
      try{
        const user='phase2-durable-no-shrimp-user';
        await callLine('ไม่กินกุ้ง',user);
        assert.ok(constraintsOf(h,user).includes('no_shrimp'));

        await callLine('ร้านอาหารมีอะไรแนะนำ',user);
        const t=textOf(capture.replies[1]);
        assert.doesNotMatch(t,/ต้มยำกุ้ง|ข้าวผัดกุ้ง/u);
        assert.match(t,/คอหมูทอดสมุนไพร/u);
      } finally { capture.restore(); }
    },{
      restaurantMenu:[
        row('m1','ต้มยำกุ้ง',199,['กุ้ง','พริกสด']),
        row('m2','ข้าวผัดกุ้ง',159,['กุ้งแห้ง','ข้าว']),
        row('m3','คอหมูทอดสมุนไพร',169,['คอหมู','ตะไคร้']),
      ],
    });
  } finally {
    if(old===undefined) delete process.env.LINE_CHANNEL_SECRET;
    else process.env.LINE_CHANNEL_SECRET=old;
  }
});
