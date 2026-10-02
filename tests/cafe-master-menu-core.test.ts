import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('cafe master migration contains only core all-branch items and excludes seasonal/LITE rows',()=>{
  const sql=readFileSync('supabase/migrations/20261002160000_cafe_master_menu_core_oat_v1.sql','utf8');
  for(const code of [
    'espresso','americano','es_all_day','cappuccino','cafe_latte','mocha','caramel_macchiato',
    'cocoa','fresh_milk','pink_milk','thai_tea_latte','green_tea_latte','black_tea','lemon_tea','uji_pure_matcha',
  ]){
    assert.equal(sql.includes("'"+code+"'"),true,code+' missing from core master');
  }
  assert.equal(sql.includes('available_all_branches boolean not null default true'),true);
  assert.equal(sql.toLowerCase().includes('no seasonal, lite, fresh-fruit or branch-only items'),true);
  assert.equal(sql.includes('black_coffee_honey'),false);
  assert.equal(sql.includes('fresh_orange'),false);
});

test('Tad Tone oat milk is a branch modifier, not a fake universal master item',()=>{
  const sql=readFileSync('supabase/migrations/20261002160000_cafe_master_menu_core_oat_v1.sql','utf8');
  assert.equal(sql.includes("'inthanin_tadtone'"),true);
  assert.equal(sql.includes("'oat_milk'"),true);
  assert.equal(sql.includes("  15,"),true);
  assert.equal(sql.includes("array['cafe_latte','thai_tea_latte','green_tea_latte','cocoa','fresh_milk','pink_milk']"),true);
  assert.equal(sql.includes("array['hot','iced']"),true);
  assert.equal(sql.includes("('oat_milk','coffee'"),false);
});

test('Thongthai runtime loads cafe live facts and One-Mind has a cafe_live adapter including price',()=>{
  const runtime=readFileSync('netlify/functions/_thongthai-runtime-v3.ts','utf8');
  const adapters=readFileSync('netlify/functions/_dialog-source-adapters.ts','utf8');
  const resolver=readFileSync('netlify/functions/_knowledge-resolver.ts','utf8');
  const sot=readFileSync('netlify/functions/_cafe-sot.ts','utf8');

  assert.equal(runtime.includes("import { loadCafeWorldFacts } from './_cafe-sot';"),true);
  assert.equal(runtime.includes("loadCafeWorldFacts('inthanin_tadtone')"),true);
  assert.equal(adapters.includes("cafe: { facts: request => cafeFactsAdapter() }"),true);
  assert.equal(adapters.includes("sourceType:'cafe_live'"),true);
  assert.equal(resolver.includes("need === 'price'"),true);
  assert.equal(resolver.includes("'cafe_live'"),true);
  assert.equal(sot.includes("fact_key:'cafe_menu_live'"),true);
  assert.equal(sot.includes("masterScope:'corporate_core_all_branches'"),true);
  assert.equal(sot.includes("pricingRule:'base_plus_surcharge'"),true);
});
