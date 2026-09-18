import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatRestaurantSetPrompt,
  mergeRestaurantPreorderDraft,
  missingRestaurantPreorderFields,
  parseRestaurantPreorderTurn,
  type RestaurantProposedSetState,
} from '../netlify/functions/_restaurant-preorder-dialog';

const NOW = new Date('2026-09-17T18:30:00.000Z'); // 18 Sep 2026 01:30 Bangkok

const set: RestaurantProposedSetState = {
  source:'restaurant_menu_advisor_v1',
  items:[
    {name:'ลาบปลาช่อน',quantity:1},
    {name:'ตำซั่วปลาร้า',quantity:1},
    {name:'ข้าวเหนียว',quantity:2},
  ],
  total:587,
  budget:700,
  partySize:3,
};

test('acceptance turn can start with no preorder fields and asks only for pickup date/time', () => {
  const parsed = parseRestaurantPreorderTurn('เอาชุดนี้', {}, NOW);
  const draft = mergeRestaurantPreorderDraft(undefined, parsed, NOW);
  assert.deepEqual(missingRestaurantPreorderFields(draft), ['date','time','customerName','phone']);
  const copy = formatRestaurantSetPrompt({...set,preorderDraft:draft}, draft);
  assert.match(copy, /ขอวัน \+ เวลารับอาหาร/);
  assert.match(copy, /พรุ่งนี้ 14:00/);
});

test('natural Thai date/time reply is remembered and next prompt asks for name and phone', () => {
  const first = mergeRestaurantPreorderDraft(undefined, parseRestaurantPreorderTurn('เอาชุดนี้', {}, NOW), NOW);
  const parsed = parseRestaurantPreorderTurn('พรุ่งนี้บ่ายสอง', first, NOW);
  const draft = mergeRestaurantPreorderDraft(first, parsed, NOW);
  assert.equal(draft.date, '2026-09-19');
  assert.equal(draft.time, '14:00');
  assert.deepEqual(missingRestaurantPreorderFields(draft), ['customerName','phone']);
  const copy = formatRestaurantSetPrompt({...set,preorderDraft:draft}, draft);
  assert.match(copy, /ขอชื่อผู้สั่ง \+ เบอร์โทร/);
});

test('name-only reply keeps phone pending in preorder draft', () => {
  const current = {
    date:'2026-09-19', time:'14:00', customerName:null, phone:null, email:null,
    acceptedAt:NOW.toISOString(),
  };
  const parsed = parseRestaurantPreorderTurn('นุ๊ก', current, NOW);
  const draft = mergeRestaurantPreorderDraft(current, parsed, NOW);
  assert.equal(draft.customerName, 'นุ๊ก');
  assert.deepEqual(missingRestaurantPreorderFields(draft), ['phone']);
});

test('one natural turn can contain date time name and phone', () => {
  const parsed = parseRestaurantPreorderTurn('เอาชุดนี้ พรุ่งนี้ 14:00 ชื่อ นุ๊ก 081-234-5678', {}, NOW);
  assert.equal(parsed.date, '2026-09-19');
  assert.equal(parsed.time, '14:00');
  assert.equal(parsed.customerName, 'นุ๊ก');
  assert.equal(parsed.phone, '0812345678');
});
