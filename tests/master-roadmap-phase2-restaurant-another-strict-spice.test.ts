// PHASE 2 STABILIZATION — "อีก" SEMANTICS + STRICT NO-SPICY FILTER
//
// Owner production smoke after PR #79 proved routing was fixed but exposed the
// next product-level gap:
// - "มีอะไรแนะนำอีก" repeated the same top recommendations.
// - strict "ไม่เผ็ด" still allowed sauce/dish names that are spicy-risk by
//   convention when curated spice metadata is absent (e.g. จิ้มแจ่ว,
//   เสือร้องไห้).
//
// These tests prove both semantics without relying on the LLM.
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

function item(name: string, id: string): RestaurantAdvisorItem {
  return {
    id,
    name,
    category: 'อาหาร',
    price: 100,
    signature: false,
    orderable: true,
    availableServings: 10,
    ingredients: [],
    unavailableIngredients: [],
    profile: normalizeRestaurantProfile({ spiceLevel: 0, mealRoles: ['main'] }),
  };
}

test('no_spicy hard-excludes unverified spicy-risk sauces/dishes even when spiceLevel defaults to 0', () => {
  const rows: RestaurantAdvisorItem[] = [
    item('คอหมูย่างจิ้มแจ่ว', 'jaew'),
    item('เสือร้องไห้', 'tiger'),
    item('ลาบหมู', 'larb'),
    item('น้ำตกหมู', 'namtok'),
    item('ต้มแซ่บกระดูกอ่อน', 'tomsaeb'),
    item('หมูทอดกระเทียม', 'safe-1'),
    item('แกงจืดเต้าหู้หมูสับ', 'safe-2'),
  ];
  const advice = adviseRestaurantMenu(rows, {
    query: 'มีอะไรแนะนำ',
    constraints: ['no_spicy'],
  }) as { recommendations: Array<{ name: string }> };

  const names = advice.recommendations.map(row => row.name);
  assert.deepEqual(names.sort(), ['หมูทอดกระเทียม', 'แกงจืดเต้าหู้หมูสับ'].sort());
});

const CHANNEL_SECRET = 'phase2-restaurant-another-secret';
type CapturedReply = { messages: Array<{ type: string; text?: string }> };

function installLineReplyCapture(): { restore: () => void; replies: CapturedReply[] } {
  const original = global.fetch;
  const replies: CapturedReply[] = [];
  global.fetch = (async (url: string | URL, init?: RequestInit) => {
    if (String(url).includes('api.line.me/v2/bot/message/reply')) {
      replies.push(JSON.parse(String(init?.body ?? '{}')) as CapturedReply);
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return original(url as never, init);
  }) as typeof fetch;
  return { restore: () => { global.fetch = original; }, replies };
}

let seq = 0;
function event(text: string, userId: string) {
  seq += 1;
  return {
    type: 'message',
    replyToken: `reply-${seq}`,
    timestamp: Date.now() + seq,
    source: { type: 'user', userId },
    message: { id: `msg-${seq}`, type: 'text', text },
  };
}

async function callLine(text: string, userId: string) {
  const body = JSON.stringify({ destination: 'test', events: [event(text, userId)] });
  const signature = createHmac('sha256', CHANNEL_SECRET).update(body, 'utf8').digest('base64');
  return lineWebhookHandler(
    { httpMethod: 'POST', headers: { 'x-line-signature': signature }, body } as never,
    {} as never,
  );
}

function textOf(reply: CapturedReply | undefined): string {
  return reply?.messages.map(row => row.text ?? '').join('\n') ?? '';
}

function bulletNames(message: string): string[] {
  return message
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('• '))
    .map(line => line.replace(/^•\s*/u, '').split(' — ')[0].trim());
}

function menuRow(id: string, name: string, price: number) {
  return {
    menu_item_id: id,
    category_name: 'อาหารจานหลัก',
    category_sort_order: 1,
    sort_order: Number(id.replace(/\D/g, '')) || 1,
    name,
    selling_price: price,
    description: name,
    is_signature: id === 'm1',
    ingredient_names: ['หมู'],
    unavailable_ingredients: [],
    available_servings: 20,
    is_orderable: true,
    source_updated_at: new Date().toISOString(),
  };
}

test('full LINE: "มีอะไรแนะนำอีก" returns remaining grounded options, never repeats the first top-3', async () => {
  const oldSecret = process.env.LINE_CHANNEL_SECRET;
  process.env.LINE_CHANNEL_SECRET = CHANNEL_SECRET;
  try {
    await withHarness(async () => {
      const capture = installLineReplyCapture();
      try {
        const user = 'phase2-restaurant-another-user';
        await callLine('กินไม่เผ็ด แพ้กุ้ง', user);
        await callLine('ร้านอาหารมีอะไรแนะนำ', user);
        const first = textOf(capture.replies[1]);
        const firstNames = bulletNames(first);
        assert.equal(firstNames.length, 3, 'first recommendation should show top 3');

        await callLine('มีอะไรแนะนำอีก', user);
        const second = textOf(capture.replies[2]);
        const secondNames = bulletNames(second);

        assert.ok(secondNames.length >= 1 && secondNames.length <= 2, 'follow-up should show remaining shortlist items only');
        for (const name of secondNames) {
          assert.ok(!firstNames.includes(name), `follow-up repeated prior recommendation: ${name}`);
        }
        assert.doesNotMatch(second, /ขอรายละเอียดเพิ่มอีกนิด|ช่วยต่อให้ตรงเรื่อง/u);
      } finally {
        capture.restore();
      }
    }, {
      restaurantMenu: [
        menuRow('m1', 'หมูทอดกระเทียม', 129),
        menuRow('m2', 'แกงจืดเต้าหู้หมูสับ', 139),
        menuRow('m3', 'ผัดผักรวม', 109),
        menuRow('m4', 'ไข่เจียวหมูสับ', 99),
        menuRow('m5', 'ข้าวผัดหมู', 119),
        menuRow('m6', 'ผักลวก', 79),
      ],
    });
  } finally {
    if (oldSecret === undefined) delete process.env.LINE_CHANNEL_SECRET;
    else process.env.LINE_CHANNEL_SECRET = oldSecret;
  }
});
