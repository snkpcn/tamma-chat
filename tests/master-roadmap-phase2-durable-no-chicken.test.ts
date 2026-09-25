// PHASE 2 DURABLE DIETARY MEMORY — NO_CHICKEN LOAD-BEARING PROOF
//
// Owner production smoke (2026-09-25) exposed a real safety gap:
// after "ไม่กินไก่" had fallen out of short restaurant message history,
// a later "มีอะไรแนะนำอีก" recommended "ไก่บ้านทอดสมุนไพร".
//
// This test proves two separate invariants:
// 1) "ไม่กินไก่" is persisted to durable guest_memory as no_chicken;
// 2) the restaurant advisor must enforce no_chicken from durable constraints
//    even when curated profile.proteinTags is absent and only raw ingredients
//    reveal chicken.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { withHarness, type Harness } from './helpers/canonical-core-harness';
import { handler as lineWebhookHandler } from '../netlify/functions/line-webhook';

const SECRET = 'phase2-durable-no-chicken-secret';
type CapturedReply = { messages: Array<{ type: string; text?: string }> };

function installCapture() {
  const original = global.fetch;
  const replies: CapturedReply[] = [];
  global.fetch = (async (url: string | URL, init?: RequestInit) => {
    if (String(url).includes('api.line.me/v2/bot/message/reply')) {
      replies.push(JSON.parse(String(init?.body ?? '{}')) as CapturedReply);
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return original(url as never, init);
  }) as typeof fetch;
  return { replies, restore: () => { global.fetch = original; } };
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
  const signature = createHmac('sha256', SECRET).update(body, 'utf8').digest('base64');
  return lineWebhookHandler(
    { httpMethod: 'POST', headers: { 'x-line-signature': signature }, body } as never,
    {} as never,
  );
}

function lineGuestId(userId: string): string {
  const hex = createHash('sha256').update('tamma-line:' + userId, 'utf8').digest('hex').slice(0, 32).split('');
  hex[12] = '5';
  const variant = parseInt(hex[16], 16);
  hex[16] = ((variant & 0x3) | 0x8).toString(16);
  const value = hex.join('');
  return `${value.slice(0,8)}-${value.slice(8,12)}-${value.slice(12,16)}-${value.slice(16,20)}-${value.slice(20,32)}`;
}

function constraintsOf(harness: Harness, userId: string): string[] {
  const guestDbId = harness.guestDbId(lineGuestId(userId));
  if (!guestDbId) return [];
  const value = harness.getGuestMemory(guestDbId, 'constraints');
  return Array.isArray(value) ? value as string[] : [];
}

function replyText(reply: CapturedReply | undefined): string {
  return reply?.messages.map(m => m.text ?? '').join('\n') ?? '';
}

function row(id: string, name: string, price: number, ingredients: string[]) {
  return {
    menu_item_id: id,
    category_name: 'ย่าง • ทอด',
    category_sort_order: 1,
    sort_order: Number(id.replace(/\D/g,'')) || 1,
    name,
    selling_price: price,
    description: name,
    is_signature: id === 'm1',
    ingredient_names: ingredients,
    unavailable_ingredients: [],
    available_servings: 20,
    is_orderable: true,
    source_updated_at: new Date().toISOString(),
  };
}

test('full LINE: durable no_chicken memory excludes raw chicken even without curated profile tags', async () => {
  const oldSecret = process.env.LINE_CHANNEL_SECRET;
  process.env.LINE_CHANNEL_SECRET = SECRET;
  try {
    await withHarness(async harness => {
      const capture = installCapture();
      try {
        const user = 'phase2-durable-no-chicken-user';

        await callLine('ไม่กินไก่', user);
        assert.ok(constraintsOf(harness, user).includes('no_chicken'), 'no_chicken must persist in guest_memory');

        await callLine('ร้านอาหารมีอะไรแนะนำ', user);
        const recommendation = replyText(capture.replies[1]);

        assert.doesNotMatch(recommendation, /ไก่บ้านทอดสมุนไพร/u, 'durable no_chicken must exclude raw chicken ingredient');
        assert.match(recommendation, /คอหมูทอดสมุนไพร|ไข่เจียวหมูสับ/u);
      } finally {
        capture.restore();
      }
    }, {
      restaurantMenu: [
        row('m1', 'ไก่บ้านทอดสมุนไพร', 189, ['ไก่บ้าน','ตะไคร้','กระเทียม']),
        row('m2', 'คอหมูทอดสมุนไพร', 169, ['คอหมู','ตะไคร้','กระเทียม']),
        row('m3', 'ไข่เจียวหมูสับ', 99, ['ไข่ไก่','หมูสับ']),
      ],
    });
  } finally {
    if (oldSecret === undefined) delete process.env.LINE_CHANNEL_SECRET;
    else process.env.LINE_CHANNEL_SECRET = oldSecret;
  }
});
