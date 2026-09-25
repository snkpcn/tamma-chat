// PHASE 2 STABILIZATION — RESTAURANT CATEGORY CONTINUITY
//
// Production smoke after PR #80:
// guest context = food + dietary constraints
// follow-up = "มีอะไรแนะนำอีก"
// wrong result = Singha Draft + น้ำกระเจี๊ยบ
//
// The recommender must preserve FOOD scope unless the customer explicitly
// asks for drinks/dessert (or a vague follow-up inherits such a recent scope).
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

function advisorItem(
  id: string,
  name: string,
  category: string,
  price = 100,
): RestaurantAdvisorItem {
  return {
    id, name, category, price,
    signature: false,
    orderable: true,
    availableServings: 20,
    ingredients: [],
    unavailableIngredients: [],
    profile: normalizeRestaurantProfile({ spiceLevel: 0, mealRoles: ['main'] }),
  };
}

test('restaurant advisor defaults generic recommendations to FOOD, not drinks/dessert', () => {
  const items = [
    advisorItem('f1', 'หมูทอดกระเทียม', 'ย่าง • ทอด'),
    advisorItem('f2', 'แกงจืดเต้าหู้หมูสับ', 'ต้ม • นึ่ง'),
    advisorItem('d1', 'Singha Draft (แก้ว)', 'เบียร์สด'),
    advisorItem('d2', 'น้ำกระเจี๊ยบ', 'น้ำสมุนไพร'),
    advisorItem('x1', 'กล้วยบวชชี', 'ของหวาน'),
  ];

  const food = adviseRestaurantMenu(items, { query: 'ร้านอาหารมีอะไรแนะนำ' }) as { recommendations: Array<{ name:string }> };
  assert.deepEqual(
    food.recommendations.map(row => row.name).sort(),
    ['หมูทอดกระเทียม', 'แกงจืดเต้าหู้หมูสับ'].sort(),
  );

  const drink = adviseRestaurantMenu(items, { query: 'มีเครื่องดื่มอะไรแนะนำ' }) as { recommendations: Array<{ name:string }> };
  assert.deepEqual(
    drink.recommendations.map(row => row.name).sort(),
    ['Singha Draft (แก้ว)', 'น้ำกระเจี๊ยบ'].sort(),
  );

  const dessert = adviseRestaurantMenu(items, { query: 'มีของหวานอะไรแนะนำ' }) as { recommendations: Array<{ name:string }> };
  assert.deepEqual(dessert.recommendations.map(row => row.name), ['กล้วยบวชชี']);
});

test('vague follow-up inherits recent drink scope when the customer was actually discussing drinks', () => {
  const items = [
    advisorItem('f1', 'หมูทอดกระเทียม', 'ย่าง • ทอด'),
    advisorItem('d1', 'Singha Draft (แก้ว)', 'เบียร์สด'),
    advisorItem('d2', 'น้ำกระเจี๊ยบ', 'น้ำสมุนไพร'),
  ];
  const advice = adviseRestaurantMenu(items, {
    query: 'มีอะไรแนะนำอีก',
    recentMessages: ['มีเครื่องดื่มอะไรแนะนำ'],
  }) as { recommendations: Array<{ name:string }> };
  assert.deepEqual(advice.recommendations.map(row => row.name).sort(), ['Singha Draft (แก้ว)', 'น้ำกระเจี๊ยบ'].sort());
});

const CHANNEL_SECRET = 'phase2-restaurant-food-scope-secret';
type CapturedReply = { messages: Array<{ type:string; text?:string }> };

function installCapture(): { replies: CapturedReply[]; restore: () => void } {
  const original = global.fetch;
  const replies: CapturedReply[] = [];
  global.fetch = (async (url: string | URL, init?: RequestInit) => {
    if (String(url).includes('api.line.me/v2/bot/message/reply')) {
      replies.push(JSON.parse(String(init?.body ?? '{}')) as CapturedReply);
      return new Response('{}', { status:200, headers:{'content-type':'application/json'} });
    }
    return original(url as never, init);
  }) as typeof fetch;
  return { replies, restore: () => { global.fetch = original; } };
}

let seq = 0;
function lineEvent(text: string, userId: string) {
  seq += 1;
  return {
    type:'message',
    replyToken:`reply-${seq}`,
    timestamp:Date.now()+seq,
    source:{type:'user',userId},
    message:{id:`msg-${seq}`,type:'text',text},
  };
}

async function callLine(text: string, userId: string) {
  const body = JSON.stringify({ destination:'test', events:[lineEvent(text,userId)] });
  const signature = createHmac('sha256', CHANNEL_SECRET).update(body,'utf8').digest('base64');
  return lineWebhookHandler(
    { httpMethod:'POST', headers:{'x-line-signature':signature}, body } as never,
    {} as never,
  );
}

function replyText(reply: CapturedReply | undefined): string {
  return reply?.messages.map(m => m.text ?? '').join('\n') ?? '';
}

function menuNames(message: string): string[] {
  return message.split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('• '))
    .map(line => line.replace(/^•\s*/u,'').split(' — ')[0].trim());
}

function row(
  id:string,
  name:string,
  category:string,
  price:number,
  ingredients:string[] = ['หมู'],
) {
  return {
    menu_item_id:id,
    category_name:category,
    category_sort_order:1,
    sort_order:Number(id.replace(/\D/g,'')) || 1,
    name,
    selling_price:price,
    description:name,
    is_signature:id==='f1',
    ingredient_names:ingredients,
    unavailable_ingredients:[],
    available_servings:20,
    is_orderable:true,
    source_updated_at:new Date().toISOString(),
  };
}

test('full LINE: food follow-up never drifts into beer/herbal drinks', async () => {
  const oldSecret = process.env.LINE_CHANNEL_SECRET;
  process.env.LINE_CHANNEL_SECRET = CHANNEL_SECRET;
  try {
    await withHarness(async () => {
      const capture = installCapture();
      try {
        const user = 'phase2-food-scope-user';
        await callLine('กินไม่เผ็ด แพ้กุ้ง', user);
        await callLine('ร้านอาหารมีอะไรแนะนำ', user);
        const first = menuNames(replyText(capture.replies[1]));
        assert.equal(first.length, 3);

        await callLine('มีอะไรแนะนำอีก', user);
        const secondText = replyText(capture.replies[2]);
        const second = menuNames(secondText);

        assert.ok(second.length >= 1, 'there is one more safe food item in the catalog');
        assert.doesNotMatch(secondText, /Singha|เบียร์|น้ำกระเจี๊ยบ/u);
        for (const name of second) assert.ok(!first.includes(name), `repeated previous food recommendation: ${name}`);
      } finally {
        capture.restore();
      }
    }, {
      restaurantMenu:[
        row('f1','หมูทอดกระเทียม','ย่าง • ทอด',129),
        row('f2','แกงจืดเต้าหู้หมูสับ','ต้ม • นึ่ง',139),
        row('f3','ผัดผักรวม','ข้าว • เส้น • เคียง',109),
        row('f4','ไข่เจียวหมูสับ','ข้าว • เส้น • เคียง',99),
        row('d1','Singha Draft (แก้ว)','เบียร์สด',99),
        row('d2','น้ำกระเจี๊ยบ','น้ำสมุนไพร',49),
        row('x1','กล้วยบวชชี','ของหวาน',69),
      ],
    });
  } finally {
    if (oldSecret === undefined) delete process.env.LINE_CHANNEL_SECRET;
    else process.env.LINE_CHANNEL_SECRET = oldSecret;
  }
});
