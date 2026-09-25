// PHASE 2 FINAL RESTAURANT QUALITY — strict ingredient safety + unseen paging
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  adviseRestaurantMenu,
  normalizeRestaurantProfile,
  type RestaurantAdvisorItem,
} from '../netlify/functions/_restaurant-intelligence';
import { withHarness } from './helpers/canonical-core-harness';
import { handler as lineWebhookHandler } from '../netlify/functions/line-webhook';

function item(
  id: string,
  name: string,
  category: string,
  opts: {
    ingredients?: string[];
    mealRoles?: string[];
    proteinTags?: string[];
    spiceLevel?: number;
  } = {},
): RestaurantAdvisorItem {
  return {
    id,
    name,
    category,
    price: 100,
    signature: false,
    orderable: true,
    availableServings: 20,
    ingredients: opts.ingredients ?? [],
    unavailableIngredients: [],
    profile: normalizeRestaurantProfile({
      spiceLevel: opts.spiceLevel ?? 0,
      mealRoles: opts.mealRoles ?? [],
      proteinTags: opts.proteinTags ?? [],
      beginnerFriendly: true,
    }),
  };
}

test('strict no_spicy excludes authoritative raw chilli ingredients even when profile spiceLevel is low', () => {
  const advice = adviseRestaurantMenu([
    item('safe', 'คอหมูทอดสมุนไพร', 'ย่าง • ทอด', {
      ingredients: ['คอหมู','กระเทียม','ตะไคร้'],
      mealRoles: ['main','protein','grill_or_fry'],
      proteinTags: ['pork'],
      spiceLevel: 1,
    }),
    item('chilli-1', 'ไข่เจียวสมุนไพร', 'ข้าว • เส้น • เคียง', {
      ingredients: ['ไข่ไก่','พริกสด','หอมแดง'],
      mealRoles: ['side'],
      proteinTags: ['egg'],
      spiceLevel: 0,
    }),
    item('chilli-2', 'ปลานิลทอดสมุนไพร', 'เมนูปลา', {
      ingredients: ['ปลานิล','พริกแห้ง','ตะไคร้'],
      mealRoles: ['main','protein'],
      proteinTags: ['fish'],
      spiceLevel: 1,
    }),
  ], { query:'มีอะไรแนะนำ', constraints:['no_spicy'] }) as { recommendations:Array<{name:string}> };

  assert.deepEqual(advice.recommendations.map(row => row.name), ['คอหมูทอดสมุนไพร']);
});

test('generic recommendation ranks substantive main/protein ahead of bare side', () => {
  const advice = adviseRestaurantMenu([
    item('side', 'ขนมจีน', 'ข้าว • เส้น • เคียง', {
      mealRoles:['side'],
      proteinTags:[],
      spiceLevel:0,
    }),
    item('main', 'คอหมูทอดสมุนไพร', 'ย่าง • ทอด', {
      mealRoles:['main','protein','grill_or_fry'],
      proteinTags:['pork'],
      spiceLevel:1,
    }),
  ], { query:'ร้านอาหารมีอะไรแนะนำ', constraints:['no_spicy'] }) as { recommendations:Array<{name:string}> };

  assert.equal(advice.recommendations[0]?.name, 'คอหมูทอดสมุนไพร');
});

const SECRET='phase2-final-restaurant-quality-secret';
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

function replyText(reply:CapturedReply|undefined){
  return reply?.messages.map(m=>m.text??'').join('\n')??'';
}

function names(message:string){
  return message.split('\n')
    .map(line=>line.trim())
    .filter(line=>line.startsWith('• '))
    .map(line=>line.replace(/^•\s*/u,'').split(' — ')[0].trim());
}

function row(id:string,name:string,price:number){
  return {
    menu_item_id:id,
    category_name:'ย่าง • ทอด',
    category_sort_order:1,
    sort_order:Number(id.replace(/\D/g,''))||1,
    name,
    selling_price:price,
    description:name,
    is_signature:false,
    ingredient_names:['หมู'],
    unavailable_ingredients:[],
    available_servings:20,
    is_orderable:true,
    source_updated_at:new Date().toISOString(),
  };
}

test('full LINE: consecutive "อีก" pages unseen grounded recommendations and then stops honestly', async()=>{
  const oldSecret=process.env.LINE_CHANNEL_SECRET;
  process.env.LINE_CHANNEL_SECRET=SECRET;
  try{
    await withHarness(async()=>{
      const capture=installCapture();
      try{
        const user='phase2-final-restaurant-paging';
        await callLine('กินไม่เผ็ด แพ้กุ้ง',user);
        await callLine('ร้านอาหารมีอะไรแนะนำ',user);
        const first=names(replyText(capture.replies[1]));
        assert.equal(first.length,3);

        await callLine('มีอะไรแนะนำอีก',user);
        const second=names(replyText(capture.replies[2]));
        assert.equal(second.length,2);
        for(const name of second) assert.ok(!first.includes(name),`second page repeated ${name}`);

        await callLine('มีอะไรแนะนำอีก',user);
        const third=replyText(capture.replies[3]);
        assert.equal(names(third).length,0);
        assert.match(third,/เมนูที่ผ่านเงื่อนไขและยืนยันได้มีเท่านี้ก่อน/u);
      }finally{
        capture.restore();
      }
    },{
      restaurantMenu:[
        row('m1','หมูทอดสมุนไพร',129),
        row('m2','หมูทอดกระเทียม',139),
        row('m3','หมูย่างสมุนไพร',149),
        row('m4','หมูนึ่งสมุนไพร',159),
        row('m5','หมูอบสมุนไพร',169),
      ],
    });
  }finally{
    if(oldSecret===undefined) delete process.env.LINE_CHANNEL_SECRET;
    else process.env.LINE_CHANNEL_SECRET=oldSecret;
  }
});
