import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRestaurantAdvisorTurn } from '../netlify/functions/thongthai-chat';
import type { BrainRequest } from '../netlify/functions/_thongthai-brain-v3';
import {
  formatRestaurantSetPrompt,
  mergeRestaurantPreorderDraft,
  missingRestaurantPreorderFields,
  parseRestaurantPreorderTurn,
} from '../netlify/functions/_restaurant-preorder-dialog';

function request(message: string, history: BrainRequest['chatHistory'] = []): BrainRequest {
  return {
    guestId:'00000000-0000-4000-8000-000000000001',
    message,
    language:'th',
    chatHistory:history,
    guestContext:{
      tripDuration:null,
      travelerType:null,
      group:{adults:null,children:null,elderly:null},
      interests:[],
      pace:null,
      budget:null,
      constraints:[],
    },
    journeyContext:{currentPlan:null,savedPlan:null,visitedExperiences:[],favorites:[],journalEntries:[]},
    pageContext:{section:'line'},
  };
}

test('generic first-visit recommendation stays ecosystem-wide, not restaurant-only', () => {
  assert.equal(isRestaurantAdvisorTurn(request('มาครั้งแรก มีอะไรแนะนำ'), {agentState:{}}), false);
});

test('explicit restaurant or food recommendation uses restaurant advisor', () => {
  assert.equal(isRestaurantAdvisorTurn(request('ที่ร้านมีอะไรแนะนำ'), {agentState:{}}), true);
  assert.equal(isRestaurantAdvisorTurn(request('อาหารแนะนำมีอะไรบ้าง'), {agentState:{}}), true);
});

test('colloquial "ร้านมีไรกิน" (อะไร shortened to ไร) is recognized as restaurant discovery', () => {
  assert.equal(isRestaurantAdvisorTurn(request('ร้านมีไรกิน'), {agentState:{}}), true);
  assert.equal(isRestaurantAdvisorTurn(request('มีไรกินมั้ย'), {agentState:{}}), true);
});

test('restaurant follow-up can use prior restaurant context', () => {
  const history = [
    {role:'user' as const, content:'มากัน 3 คน งบไม่เกิน 700 อยากกินอีสานแท้'},
    {role:'assistant' as const, content:'จัดชุดอาหารตำมา-ชาติให้แล้วครับ'},
  ];
  assert.equal(isRestaurantAdvisorTurn(request('ไม่เอาหมูด้วย', history), {agentState:{}}), true);
});

test('restaurant follow-up can use persisted server-side context when transported chat history is empty', () => {
  const runtime = {
    agentState:{
      restaurantAdvisorContext:{
        source:'restaurant_menu_advisor_v1',
        recentMessages:['ร้านมีไรกิน'],
        updatedAt:'2026-09-18T01:20:00.000Z',
      },
    },
  };
  assert.equal(isRestaurantAdvisorTurn(request('มากันสองคน งบ 500'), runtime), true);
  assert.equal(isRestaurantAdvisorTurn(request('ไม่กินหมู'), runtime), true);
  assert.equal(isRestaurantAdvisorTurn(request('ราคาเท่าไร'), runtime), true);
  assert.equal(isRestaurantAdvisorTurn(request('เอาชุดเมื่อกี้'), runtime), true);
});

test('pending preorder keeps date time and name replies inside restaurant flow', () => {
  const runtime = {
    agentState:{
      restaurantProposedSet:{
        source:'restaurant_menu_advisor_v1',
        items:[{name:'ลาบปลาช่อน',quantity:1}],
        total:189,
        budget:700,
        partySize:3,
        createdAt:'2026-09-18T01:20:00.000Z',
        preorderDraft:{
          date:null,time:null,customerName:null,phone:null,email:null,
          acceptedAt:'2026-09-18T01:30:00.000Z',
        },
      },
    },
  };
  assert.equal(isRestaurantAdvisorTurn(request('พรุ่งนี้ 14:00'), runtime), true);
  assert.equal(isRestaurantAdvisorTurn(request('นุ๊ก'), runtime), true);
  assert.equal(isRestaurantAdvisorTurn(request('นุ๊ก 0610169999'), runtime), true);
});

test('restaurant preorder draft requires phone and formats a short contact prompt', () => {
  const draft = mergeRestaurantPreorderDraft(undefined, parseRestaurantPreorderTurn(
    'เอาชุดเมื่อกี้ พรุ่งนี้ 14:00',
    {},
    new Date('2026-09-17T05:00:00.000Z'),
  ), new Date('2026-09-17T05:00:00.000Z'));
  assert.deepEqual(missingRestaurantPreorderFields(draft), ['customerName','phone']);
  assert.match(formatRestaurantSetPrompt({
    source:'restaurant_menu_advisor_v1',
    items:[{name:'ตำลาว',quantity:1}],
    total:79,
    createdAt:'2026-09-17T05:00:00.000Z',
  }, draft), /ขอชื่อผู้สั่ง \+ เบอร์โทร/);

  const completed = mergeRestaurantPreorderDraft(draft, parseRestaurantPreorderTurn('นุ๊ก 0610169999', draft));
  assert.deepEqual(missingRestaurantPreorderFields(completed), []);
  assert.equal(completed.customerName, 'นุ๊ก');
  assert.equal(completed.phone, '0610169999');
});

// Promotion OS Phase 2: a promotion mention must always reach the LLM brain's
// redeem_promotion tool, never this deterministic advisor shortcut -- it has
// no knowledge of active_promotions_live, so it would silently answer a
// generic menu recommendation instead of ever redeeming the promo.
test('a promotion mention is never intercepted by the deterministic restaurant advisor, even with menu item names in it', () => {
  assert.equal(isRestaurantAdvisorTurn(request('เอาโปรตำไทย+ข้าวเหนียวค่ะ พรุ่งนี้ 14:00 ชื่อนุ๊ก'), {agentState:{}}), false);
  assert.equal(isRestaurantAdvisorTurn(request('มีโปรอะไรบ้างไหม'), {agentState:{}}), false);
  assert.equal(isRestaurantAdvisorTurn(request('อยากรับโปรโมชันชุดตำไทย+ข้าวเหนียว'), {agentState:{}}), false);
});

test('a polite "โปรด" (please) message is not mistaken for a promotion mention', () => {
  assert.equal(isRestaurantAdvisorTurn(request('โปรดแนะนำเมนูที่ร้านหน่อยครับ'), {agentState:{}}), true);
});
