import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('cafe dynamic slots are normalized rows and sync back to legacy prices JSON',()=>{
  const sql=readFileSync('supabase/migrations/20261002163500_cafe_dynamic_price_slots_v1.sql','utf8');
  assert.equal(sql.includes('create table if not exists public.cafe_menu_price_slots'),true);
  assert.equal(sql.includes('unique(menu_code,slot_code)'),true);
  assert.equal(sql.includes('label_th text not null'),true);
  assert.equal(sql.includes('label_en text not null'),true);
  assert.equal(sql.includes('sort_order integer not null'),true);
  assert.equal(sql.includes('cafe_sync_menu_prices_v1'),true);
  assert.equal(sql.includes('after insert or update or delete'),true);
});

test('cafe source of truth exposes dynamic slot labels and prices to Thongthai',()=>{
  const source=readFileSync('netlify/functions/_cafe-sot.ts','utf8');
  assert.equal(source.includes('CafeMenuPriceSlot'),true);
  assert.equal(source.includes('cafe_menu_price_slots?active=eq.true'),true);
  assert.equal(source.includes('slots:item.slots.map'),true);
  assert.equal(source.includes('labelTh:slot.label_th'),true);
  assert.equal(source.includes('price:slot.price'),true);
});
