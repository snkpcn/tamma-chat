import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const sql=readFileSync(
  new URL('../supabase/migrations/20261003215717_ww11_first_wave_kr_jp_us_targets.sql',import.meta.url),
  'utf8',
);

test('WW-11 first wave targets South Korea, Japan and United States',()=>{
  for(const country of [
    ["KR","South Korea","KRW","ko"],
    ["JP","Japan","JPY","ja"],
    ["US","United States","USD","en"],
  ]){
    const [market,name,currency,locale]=country;
    assert.match(sql,new RegExp("\\('"+market+"','"+name+"','"+currency+"'"));
    assert.match(sql,new RegExp("\\('"+market+"','"+market+"','"+currency+"','"+locale+"','certification',false"));
  }
});

test('WW-11 first wave adds Korean/Japanese locale and correct currency minor units',()=>{
  assert.match(sql,/\('KRW','South Korean Won','₩',0,true/);
  assert.match(sql,/\('JPY','Japanese Yen','¥',0,true/);
  assert.match(sql,/\('USD','US Dollar','\$',2,true/);
  assert.match(sql,/\('ko','ko','Korean',false,true/);
  assert.match(sql,/\('ja','ja','Japanese',false,true/);
});

test('WW-11 first wave remains fail closed for money, shipping, customs and checkout',()=>{
  for(const capability of ['payments','shipping','customs','checkout','fulfillment']){
    assert.match(sql,new RegExp("\\('"+capability+"','disabled'\\)"));
  }
  assert.doesNotMatch(sql,/insert into public\.commerce_payment_providers/i);
  assert.doesNotMatch(sql,/insert into public\.commerce_shipping_providers/i);
  assert.doesNotMatch(sql,/insert into public\.commerce_customs_market_policies/i);
  assert.doesNotMatch(sql,/insert into public\.commerce_return_policies/i);
  assert.doesNotMatch(sql,/insert into public\.commerce_market_certifications/i);
});

test('WW-11 first wave keeps discovery lanes shadow-only until certification facts exist',()=>{
  for(const capability of ['catalog','storefront','pricing','thongthai']){
    assert.match(sql,new RegExp("\\('"+capability+"','shadow'\\)"));
  }
  assert.doesNotMatch(sql,/\('(?:KR|JP|US)'[^\n]*'live'/);
});
