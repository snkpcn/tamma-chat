import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('cafe master migration contains only core all-branch items and excludes seasonal/LITE rows',()=>{
  const sql=readFileSync('supabase/migrations/20261002160000_cafe_master_menu_core_oat_v1.sql','utf8');
  for(const code of [
    'espresso','americano','es_all_day','cappuccino','cafe_latte','mocha','caramel_macchiato',
    'cocoa','fresh_milk','pink_milk','thai_tea_latte','green_tea_latte','black_tea','lemon_tea','uji_pure_matcha',
  ]){
    assert.match(sql,new RegExp("'"+code+"'"));
  }
  assert.match(sql,/available_all_branches boolean not null default true/);
  assert.match(sql,/no seasonal, LITE, fresh-fruit or branch-only items/i);
  assert.doesNotMatch(sql,/black_coffee_honey/);
  assert.doesNotMatch(sql,/fresh_orange/);
});

test('Tad Tone oat milk is a branch modifier, not a fake universal master item',()=>{
  const sql=readFileSync('supabase/migrations/20261002160000_cafe_master_menu_core_oat_v1.sql','utf8');
  assert.match(sql,/'inthanin_tadtone'/);
  assert.match(sql,/'oat_milk'/);
  assert.match(sql,/surcharge[sS]*15/);
  assert.match(sql,/array['cafe_latte','thai_tea_latte','green_tea_latte','cocoa','fresh_milk','pink_milk']/);
  assert.match(sql,/array['hot','iced']/);
  assert.doesNotMatch(sql,/('oat_milk','coffee'/);
});

test('Thongthai runtime loads cafe live facts and One-Mind has a cafe_live adapter including price',()=>{
  const runtime=readFileSync('netlify/functions/_thongthai-runtime-v3.ts','utf8');
  const adapters=readFileSync('netlify/functions/_dialog-source-adapters.ts','utf8');
  const resolver=readFileSync('netlify/functions/_knowledge-resolver.ts','utf8');
  const sot=readFileSync('netlify/functions/_cafe-sot.ts','utf8');

  assert.match(runtime,/loadCafeWorldFacts/);
  assert.match(runtime,/loadCafeWorldFacts('inthanin_tadtone')/);
  assert.match(adapters,/cafe:s*{s*facts:/);
  assert.match(adapters,/sourceType:'cafe_live'/);
  assert.match(resolver,/need === 'price'/);
  assert.match(resolver,/cafe_live/);
  assert.match(sot,/fact_key:'cafe_menu_live'/);
  assert.match(sot,/masterScope:'corporate_core_all_branches'/);
  assert.match(sot,/pricingRule:'base_plus_surcharge'/);
});
