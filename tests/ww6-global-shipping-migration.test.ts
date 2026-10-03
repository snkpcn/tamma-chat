import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const core=readFileSync('supabase/migrations/20261003051324_ww6_worldwide_shipping_core.sql','utf8');
const indexes=readFileSync('supabase/migrations/20261003051516_ww6_shipping_fk_indexes.sql','utf8');
const profileRpc=readFileSync('supabase/migrations/20261003051520_ww6_shipping_profile_rpc.sql','utf8');
const bridge=readFileSync('netlify/functions/_thongthai-worldwide-bridge.ts','utf8');

test('WW-6 creates server-only shipping provider/zone/service/rate/profile/quote stores',()=>{
  for(const table of [
    'commerce_shipping_providers',
    'commerce_shipping_zones',
    'commerce_shipping_zone_destinations',
    'commerce_market_shipping_services',
    'commerce_shipping_rate_tiers',
    'commerce_product_shipping_profiles',
    'commerce_shipping_quotes',
  ]){
    assert.match(core,new RegExp(`create table if not exists public\\.${table}\\b`,'i'));
    assert.match(core,new RegExp(`alter table public\\.${table} enable row level security`,'i'));
    assert.match(core,new RegExp(`revoke all on table public\\.${table} from public,anon,authenticated,service_role`,'i'));
    assert.match(core,new RegExp(`grant select,insert,update,delete on table public\\.${table} to service_role`,'i'));
  }
});

test('WW-6 maps current Thailand shipping only as legacy_v1 and seeds no global_v2 service/rate',()=>{
  assert.match(core,/'LEGACY_DOMESTIC_STATIC'/u);
  assert.match(core,/'TH_DOMESTIC_STANDARD'/u);
  assert.match(core,/'legacy_v1','domestic_v1','live'/u);
  assert.doesNotMatch(core,/values\s*\([^;]*'global_v2','(?:manual_weight_table|provider_quote)','live',true/iu);
  assert.doesNotMatch(core,/insert into public\.commerce_shipping_rate_tiers[\s\S]*values\s*\(/iu);
});

test('WW-6 product shipping profiles require measured mass and dimensions and are not backfilled by guesswork',()=>{
  assert.match(core,/weight_grams integer not null[\s\S]*between 1 and 100000/u);
  assert.match(core,/length_mm integer not null[\s\S]*between 1 and 3000/u);
  assert.match(core,/width_mm integer not null[\s\S]*between 1 and 3000/u);
  assert.match(core,/height_mm integer not null[\s\S]*between 1 and 3000/u);
  assert.doesNotMatch(core,/insert into public\.commerce_product_shipping_profiles[\s\S]*select/iu);
});

test('WW-6 quote evidence is immutable, idempotent, parcel-based, and excludes duties/tax',()=>{
  assert.match(core,/parcel_snapshot jsonb not null/u);
  assert.match(core,/actual_weight_grams bigint not null/u);
  assert.match(core,/volumetric_weight_grams bigint not null/u);
  assert.match(core,/chargeable_weight_grams bigint not null/u);
  assert.match(core,/duties_tax_scope text not null default 'excluded'/u);
  assert.match(core,/idempotency_key text not null unique/u);
  assert.match(core,/shipping_quote_immutable_field/u);
  assert.match(core,/shipping_quote_idempotency_conflict/u);
});

test('WW-6 authoritative quote RPC requires live market/shipping/currency/provider/zone/service configuration',()=>{
  assert.match(core,/shipping_market_not_live/u);
  assert.match(core,/shipping_capability_not_live/u);
  assert.match(core,/shipping_currency_not_enabled/u);
  assert.match(core,/global_shipping_service_not_ready/u);
  assert.match(core,/p\.active[\s\S]*p\.status='live'/u);
  assert.match(core,/z\.active[\s\S]*z\.status='live'/u);
  assert.match(core,/d\.country_code=v_destination[\s\S]*d\.enabled/u);
});

test('WW-6 global quote RPC never reuses domestic legacy pricing and provider-quote mode needs an adapter',()=>{
  assert.match(core,/legacy_shipping_service_not_global/u);
  assert.match(core,/shipping_provider_quote_adapter_required/u);
  assert.match(core,/rate_mode='manual_weight_table'/u);
  assert.match(core,/shipping_rate_not_configured/u);
});

test('WW-6 quote RPC validates every parcel and chooses a configured weight tier',()=>{
  assert.match(core,/jsonb_array_length\(p_parcels\)<1/u);
  assert.match(core,/jsonb_array_length\(p_parcels\)>20/u);
  assert.match(core,/invalid_parcel_weight/u);
  assert.match(core,/invalid_parcel_dimensions/u);
  assert.match(core,/max_chargeable_weight_grams>=v_chargeable_total/u);
  assert.match(core,/order by r\.max_chargeable_weight_grams,r\.tier_order/u);
});

test('WW-6 quote/profile RPCs are service-role-only with empty search path',()=>{
  for(const source of [core,profileRpc]){
    assert.match(source,/security definer[\s\S]*set search_path=''/iu);
    assert.match(source,/revoke all on function[\s\S]*from public,anon,authenticated/iu);
    assert.match(source,/grant execute on function[\s\S]*to service_role/iu);
  }
});

test('WW-6 advisor follow-up indexes cover shipping quote composite and origin FKs',()=>{
  assert.match(indexes,/commerce_shipping_quotes_service_tier_idx/u);
  assert.match(indexes,/market_code,service_code,rate_tier_order/u);
  assert.match(indexes,/commerce_shipping_quotes_origin_country_idx/u);
});

test('WW-6 Thongthai bridge knows the quote engine exists but refuses to invent parcel data',()=>{
  assert.match(bridge,/global_shipping_package_data_required/u);
  assert.match(bridge,/must not invent package weight/u);
  assert.doesNotMatch(bridge,/global_shipping_quote_source_not_connected/u);
});
