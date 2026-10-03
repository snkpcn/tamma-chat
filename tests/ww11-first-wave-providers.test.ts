import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const sql=readFileSync(
  new URL('../supabase/migrations/20261003220444_ww11_first_wave_stripe_dhl_certification.sql',import.meta.url),
  'utf8',
);

test('WW-11 first wave selects Stripe Thailand for card presentment without enabling it',()=>{
  assert.match(sql,/'stripe_th'/);
  assert.match(sql,/'stripe_payment_intents_v1'/);
  assert.match(sql,/'merchantCountry','TH'/);
  assert.match(sql,/'settlementCurrency','THB'/);
  assert.match(sql,/jsonb_build_array\('KRW','JPY','USD'\)/);
  for(const row of [
    "('KR','stripe_th','KRW','card','global_v2','certification',false",
    "('JP','stripe_th','JPY','card','global_v2','certification',false",
    "('US','stripe_th','USD','card','global_v2','certification',false",
  ]) assert.ok(sql.includes(row));
});

test('WW-11 first wave selects DHL Express MyDHL but leaves carrier inactive',()=>{
  assert.match(sql,/'DHL_EXPRESS'/);
  assert.match(sql,/'dhl_express_mydhl_v1'/);
  assert.match(sql,/'POST \/rates'/);
  assert.match(sql,/'certification',\s*false/);
  assert.match(sql,/'DHL_TH_FIRST_WAVE'/);
  for(const country of ['KR','JP','US']){
    assert.match(sql,new RegExp("'DHL_TH_FIRST_WAVE','"+country+"',true"));
  }
});

test('WW-11 provider config stores credential names only, never credentials',()=>{
  assert.match(sql,/STRIPE_SECRET_KEY/);
  assert.match(sql,/STRIPE_WEBHOOK_SECRET/);
  assert.match(sql,/DHL_EXPRESS_API_USERNAME/);
  assert.match(sql,/DHL_EXPRESS_API_PASSWORD/);
  assert.match(sql,/DHL_EXPRESS_ACCOUNT_NUMBER/);
  assert.doesNotMatch(sql,/sk_live_[A-Za-z0-9]+|whsec_[A-Za-z0-9]+/);
});

test('WW-11 provider selection cannot make checkout live by itself',()=>{
  assert.doesNotMatch(sql,/status='live'/);
  assert.doesNotMatch(sql,/'live',\s*true/);
  assert.doesNotMatch(sql,/insert into public\.commerce_market_shipping_services/i);
});
