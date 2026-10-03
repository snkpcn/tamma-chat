import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const sql=readFileSync(new URL('../supabase/migrations/20261003131726_ww11_country_certification.sql',import.meta.url),'utf8');
const fkIndexSql=readFileSync(new URL('../supabase/migrations/20261003132037_ww11_certification_fk_index.sql',import.meta.url),'utf8');

test('WW-11 creates time-bounded market certification and exact product evidence',()=>{
  for(const table of ['commerce_market_certifications','commerce_market_certification_products']){
    assert.match(sql,new RegExp('create table if not exists public\\.'+table));
    assert.match(sql,new RegExp('alter table public\\.'+table+' enable row level security'));
  }
  assert.match(sql,/price_revision_id uuid not null/);
  assert.match(sql,/shipping_profile_hash text not null/);
  assert.match(sql,/customs_profile_hash text not null/);
  assert.match(sql,/destination_rule_hash text not null/);
  assert.match(sql,/probe_evidence_hash text not null/);
});

test('WW-11 certification requires all launch authorities and no guessed product facts',()=>{
  for(const token of [
    'global_payment_method_not_live',
    'global_shipping_service_not_live',
    'customs_market_policy_not_live',
    'return_policy_not_live',
    'product_price_not_ready',
    'shipping_profile_not_ready',
    'customs_profile_not_verified',
    'destination_rule_not_checkout_ready',
  ]) assert.match(sql,new RegExp(token));
  assert.match(sql,/required_document_codes/);
  assert.match(sql,/decision='allowed'/);
});

test('WW-11 certification consumes real quote/customs proof and is idempotent',()=>{
  assert.match(sql,/certification_shipping_quote_not_valid/);
  assert.match(sql,/certification_shipping_quote_product_set_mismatch/);
  assert.match(sql,/certification_customs_snapshot_not_eligible/);
  assert.match(sql,/certification_customs_product_set_mismatch/);
  assert.match(sql,/market_certification_idempotency_conflict/);
});

test('WW-11 checkout-v2 fails closed at the database boundary without certification',()=>{
  assert.match(sql,/country_certification_required/);
  assert.match(sql,/create constraint trigger otop_country_certification_order_guard/);
  assert.match(sql,/create constraint trigger otop_country_certification_item_guard/);
  assert.match(sql,/deferrable initially deferred/);
  assert.match(sql,/checkout_version<>2/);
});

test('WW-11 certification becomes stale when exact product evidence changes',()=>{
  assert.match(sql,/commerce_shipping_profile_hash_v1/);
  assert.match(sql,/commerce_customs_profile_hash_v1/);
  assert.match(sql,/commerce_destination_rule_hash_v1/);
  assert.match(sql,/cp\.price_revision_id=\(e->>'priceRevisionId'\)::uuid/);
});


test('WW-11 covers the composite market/service foreign key',()=>{
  assert.match(fkIndexSql,/commerce_market_certifications_market_service_idx/);
  assert.match(fkIndexSql,/\(market_code,shipping_service_code\)/);
});
