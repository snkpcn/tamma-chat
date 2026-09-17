import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRestaurantAdvisorTurn } from '../netlify/functions/thongthai-chat';
import type { BrainRequest } from '../netlify/functions/_thongthai-brain-v3';

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

test('restaurant follow-up can use prior restaurant context', () => {
  const history = [
    {role:'user' as const, content:'มากัน 3 คน งบไม่เกิน 700 อยากกินอีสานแท้'},
    {role:'assistant' as const, content:'จัดชุดอาหารตำมา-ชาติให้แล้วครับ'},
  ];
  assert.equal(isRestaurantAdvisorTurn(request('ไม่เอาหมูด้วย', history), {agentState:{}}), true);
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
});
