import test from 'node:test';
import assert from 'node:assert/strict';
import { cafeGroundedAnswer } from '../netlify/functions/thongthai-chat';
import type { CafeMasterMenuItem, CafeBranchModifier } from '../netlify/functions/_cafe-sot';
import { brainRequest, guestId } from './helpers/canonical-core-harness';

const items:CafeMasterMenuItem[]=[
  {
    code:'americano',category:'coffee',name_th:'อเมริกาโน่',name_en:'Americano',
    prices:{hot:40,iced:60},available_all_branches:true,active:true,
    source:'test',source_verified_at:'2026-10-02',metadata:{},updated_at:'2026-10-02T00:00:00Z',
    slots:[
      {id:'1',menu_code:'americano',slot_code:'hot',label_th:'ร้อน',label_en:'Hot',price:40,active:true,sort_order:10,metadata:{},updated_at:'2026-10-02T00:00:00Z'},
      {id:'2',menu_code:'americano',slot_code:'iced',label_th:'เย็น',label_en:'Iced',price:60,active:true,sort_order:20,metadata:{},updated_at:'2026-10-02T00:00:00Z'},
    ],
  },
  {
    code:'cafe_latte',category:'coffee',name_th:'คาเฟ่ลาเต้',name_en:'Cafe Latte',
    prices:{hot:60,iced:75,frappe:85},available_all_branches:true,active:true,
    source:'test',source_verified_at:'2026-10-02',metadata:{},updated_at:'2026-10-02T00:00:00Z',
    slots:[
      {id:'3',menu_code:'cafe_latte',slot_code:'hot',label_th:'ร้อน',label_en:'Hot',price:60,active:true,sort_order:10,metadata:{},updated_at:'2026-10-02T00:00:00Z'},
      {id:'4',menu_code:'cafe_latte',slot_code:'iced',label_th:'เย็น',label_en:'Iced',price:75,active:true,sort_order:20,metadata:{},updated_at:'2026-10-02T00:00:00Z'},
      {id:'5',menu_code:'cafe_latte',slot_code:'frappe',label_th:'ปั่น',label_en:'Frappe',price:85,active:true,sort_order:30,metadata:{},updated_at:'2026-10-02T00:00:00Z'},
    ],
  },
  {
    code:'thai_tea_latte',category:'tea',name_th:'ชาไทยลาเต้',name_en:'Thai Tea Latte',
    prices:{hot:50,iced:60,frappe:70},available_all_branches:true,active:true,
    source:'test',source_verified_at:'2026-10-02',metadata:{},updated_at:'2026-10-02T00:00:00Z',
    slots:[
      {id:'6',menu_code:'thai_tea_latte',slot_code:'hot',label_th:'ร้อน',label_en:'Hot',price:50,active:true,sort_order:10,metadata:{},updated_at:'2026-10-02T00:00:00Z'},
      {id:'7',menu_code:'thai_tea_latte',slot_code:'iced',label_th:'เย็น',label_en:'Iced',price:60,active:true,sort_order:20,metadata:{},updated_at:'2026-10-02T00:00:00Z'},
      {id:'8',menu_code:'thai_tea_latte',slot_code:'frappe',label_th:'ปั่น',label_en:'Frappe',price:70,active:true,sort_order:30,metadata:{},updated_at:'2026-10-02T00:00:00Z'},
    ],
  },
];

const modifiers:CafeBranchModifier[]=[
  {
    modifier_code:'oat_milk',name_th:'นมโอ๊ต',name_en:'Oat Milk',surcharge:15,
    applies_to:['cafe_latte','thai_tea_latte'],styles:['hot','iced'],active:true,
    source:'test',source_verified_at:'2026-10-02',metadata:{},updated_at:'2026-10-02T00:00:00Z',
  },
];

function req(message:string){
  return brainRequest(message,guestId('cafe-live-price'));
}

test('owner screenshot regression: Americano style question returns verified hot/iced prices',()=>{
  const r=cafeGroundedAnswer(req('อเมริกาโน่มีแบบไหนบ้าง') as any,items,modifiers);
  assert.ok(r);
  assert.equal(r?.grounded,true);
  assert.match(r!.answer,/อเมริกาโน่/u);
  assert.match(r!.answer,/ร้อน 40 บาท/u);
  assert.match(r!.answer,/เย็น 60 บาท/u);
  assert.doesNotMatch(r!.answer,/ยังไม่มีข้อมูล|ไม่ขอเดา/u);
});

test('owner screenshot regression: iced latte price is answered directly from live slot',()=>{
  const r=cafeGroundedAnswer(req('ลาเต้เย็นกี่บาทครับ') as any,items,modifiers);
  assert.ok(r);
  assert.equal(r?.answer,'คาเฟ่ลาเต้ เย็น 75 บาทครับ');
});

test('oat milk price is base slot plus branch modifier',()=>{
  const r=cafeGroundedAnswer(req('ลาเต้เย็นนมโอ๊ตเท่าไหร่ครับ') as any,items,modifiers);
  assert.ok(r);
  assert.match(r!.answer,/รวม 90 บาท/u);
  assert.match(r!.answer,/75 บาท.*15 บาท/u);
});

test('specific tea latte beats generic latte alias',()=>{
  const r=cafeGroundedAnswer(req('ชาไทยลาเต้เย็นเท่าไหร่') as any,items,modifiers);
  assert.ok(r);
  assert.match(r!.answer,/ชาไทยลาเต้ เย็น 60 บาท/u);
  assert.doesNotMatch(r!.answer,/คาเฟ่ลาเต้/u);
});

test('frappe oat milk is not guessed when modifier is only enabled hot/iced',()=>{
  const r=cafeGroundedAnswer(req('ลาเต้ปั่นนมโอ๊ตเท่าไหร่') as any,items,modifiers);
  assert.ok(r);
  assert.match(r!.answer,/ไม่ได้เปิดตัวเลือกนมโอ๊ต/u);
  assert.doesNotMatch(r!.answer,/100 บาท/u);
});
