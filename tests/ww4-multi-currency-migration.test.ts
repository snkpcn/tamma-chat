import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const core=readFileSync('supabase/migrations/20261003042445_ww4_multi_currency_core.sql','utf8');
const indexes=readFileSync('supabase/migrations/20261003042706_ww4_multi_currency_fk_indexes.sql','utf8');
const rpc=readFileSync('supabase/migrations/20261003042747_ww4_price_revision_rpc.sql','utf8');
const delivery=readFileSync('netlify/functions/_member-delivery-db.ts','utf8');

test('WW-4 creates server-only market currency, FX and explicit product-price stores',()=>{
  for(const table of ['commerce_market_currencies','commerce_fx_quotes','commerce_product_prices']){
    assert.match(core,new RegExp(`create table if not exists public\\.${table}\\b`,'i'));
    assert.match(core,new RegExp(`alter table public\\.${table} enable row level security`,'i'));
    assert.match(core,new RegExp(`revoke all on table public\\.${table} from public,anon,authenticated,service_role`,'i'));
    assert.match(core,new RegExp(`grant select,insert,update,delete on table public\\.${table} to service_role`,'i'));
  }
});

test('WW-4 seeds currency references without enabling foreign transaction currencies for TH market',()=>{
  for(const code of ['THB','USD','EUR','GBP','SEK','CNY','LAK','VND','JPY']){
    assert.match(core,new RegExp(`\\('${code}'`));
  }
  assert.match(core,/values \('TH','THB',true,true,0\)/u);
  assert.doesNotMatch(core,/values \('TH','(?:USD|EUR|GBP|SEK|CNY|LAK|VND|JPY)',true/u);
});

test('WW-4 keeps FX quotes reference-only and explicit price rows transaction-authoritative',()=>{
  assert.match(core,/usage_scope text not null default 'reference_only'/u);
  assert.match(core,/check \(usage_scope='reference_only'\)/u);
  assert.match(core,/amount_minor bigint not null check \(amount_minor > 0\)/u);
  assert.match(core,/price_source in \('domestic_base','manual','fx_assisted'\)/u);
  assert.match(core,/commerce_product_prices_one_active_uq/u);
});

test('WW-4 preserves domestic price ownership and syncs THB revisions from otop_products.price',()=>{
  assert.match(core,/sync_otop_domestic_price_v1/u);
  assert.match(core,/round\(new\.price \* 100\)::bigint/u);
  assert.match(core,/currency_code='THB'/u);
  assert.match(rpc,/domestic_thb_price_owned_by_otop_products/u);
});

test('WW-4 order and line-item transaction evidence has explicit market/currency fields',()=>{
  assert.match(core,/add column if not exists market_code text not null default 'TH'/u);
  assert.match(core,/add column if not exists currency_code text not null default 'THB'/u);
  assert.match(core,/pricing_source text not null default 'domestic_v1'/u);
  assert.match(core,/alter table public\.otop_order_items[\s\S]*currency_code text not null default 'THB'/u);
  assert.match(core,/price_revision_id uuid null/u);
});

test('WW-4 does not silently enable non-THB payment before WW-5',()=>{
  assert.match(core,/if new\.currency_code <> 'THB' then[\s\S]*global_payment_not_enabled/u);
  assert.doesNotMatch(core,/drop constraint if exists payment_requests_currency_check/u);
  assert.doesNotMatch(core,/drop constraint if exists payment_requests_method_check/u);
  assert.match(core,/method,[\s\S]*'promptpay_owner_qr'/u);
});

test('WW-4 safe price revision RPC is service-role-only and version-preserving',()=>{
  assert.match(rpc,/security definer[\s\S]*set search_path=''/iu);
  assert.match(rpc,/update public\.commerce_product_prices[\s\S]*active=false/u);
  assert.match(rpc,/insert into public\.commerce_product_prices/u);
  assert.match(rpc,/revoke all on function[\s\S]*from public,anon,authenticated/iu);
  assert.match(rpc,/grant execute on function[\s\S]*to service_role/iu);
});

test('WW-4 advisor follow-up indexes cover newly introduced currency FKs',()=>{
  for(const name of [
    'commerce_fx_quotes_quote_currency_idx',
    'commerce_product_prices_source_currency_idx',
    'otop_order_items_currency_idx',
    'otop_orders_currency_idx',
    'payment_requests_currency_idx',
  ]) assert.match(indexes,new RegExp(`create index if not exists ${name}\\b`,'i'));
});

test('WW-4 current domestic catalog and checkout explicitly expose THB without changing pricing source',()=>{
  assert.match(delivery,/currencyCode: 'THB'/u);
  assert.match(delivery,/select=id,sku,name,description,price,stock_qty/u);
  assert.match(delivery,/subtotal \+= Number\(product\.price\) \* item\.quantity/u);
});
