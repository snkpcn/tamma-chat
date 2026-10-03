import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  resolveWorldwideDbRoute,
  worldwideDbScaleSnapshot,
  WW12_GLOBAL_SCALE_VERSION,
} from '../netlify/functions/_worldwide-db-client';

const read=(path:string)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

const configured={
  SUPABASE_URL:'https://primary.example.com',
  SUPABASE_SERVICE_ROLE_KEY:'primary-key',
  SUPABASE_READ_URL:'https://replica.example.com',
  SUPABASE_READ_SERVICE_ROLE_KEY:'replica-key',
  TAMMA_WW_OBSERVABILITY_ENABLED:'1',
};

test('WW-12 routes only explicitly eventual GET/HEAD reads to a configured replica',()=>{
  assert.equal(resolveWorldwideDbRoute({method:'GET',consistency:'eventual',env:configured}),'replica');
  assert.equal(resolveWorldwideDbRoute({method:'HEAD',consistency:'eventual',env:configured}),'replica');
  assert.equal(resolveWorldwideDbRoute({method:'GET',consistency:'strong',env:configured}),'primary');
  for(const method of ['POST','PATCH','PUT','DELETE']){
    assert.equal(resolveWorldwideDbRoute({method,consistency:'eventual',env:configured}),'primary');
  }
});

test('WW-12 falls back to primary when replica configuration is incomplete',()=>{
  assert.equal(resolveWorldwideDbRoute({
    method:'GET',
    consistency:'eventual',
    env:{...configured,SUPABASE_READ_SERVICE_ROLE_KEY:undefined},
  }),'primary');
  const snapshot=worldwideDbScaleSnapshot({
    ...configured,
    SUPABASE_READ_URL:undefined,
    SUPABASE_READ_SERVICE_ROLE_KEY:undefined,
  });
  assert.equal(snapshot.replicaConfigured,false);
  assert.equal(snapshot.writesAlwaysPrimary,true);
  assert.equal(snapshot.version,WW12_GLOBAL_SCALE_VERSION);
});

test('WW-12 uses eventual consistency only for safe reference reads',()=>{
  const market=read('netlify/functions/_worldwide-data-db.ts');
  const price=read('netlify/functions/_multi-currency-db.ts');
  const certification=read('netlify/functions/_country-certification-db.ts');
  const customs=read('netlify/functions/_customs-compliance-db.ts');
  const payments=read('netlify/functions/_global-payments-db.ts');
  const shipping=read('netlify/functions/_global-shipping-db.ts');
  const fulfillment=read('netlify/functions/_global-fulfillment-db.ts');

  assert.match(market,/consistency:'eventual'/);
  for(const source of [price,certification,customs,payments,shipping,fulfillment]){
    assert.match(source,/consistency:'strong'/);
    assert.doesNotMatch(source,/consistency:'eventual'/);
  }
});

test('WW-12 DB client has bounded timeout, safe replica fallback and structured no-PII resource tracing',()=>{
  const source=read('netlify/functions/_worldwide-db-client.ts');
  assert.match(source,/10_000/);
  assert.match(source,/route==='replica'/);
  assert.match(source,/method==='GET'\|\|method==='HEAD'/);
  assert.match(source,/WW12_GLOBAL_SCALE_TRACE/);
  assert.match(source,/resourceName\(input\.path\)/);
  assert.doesNotMatch(source,/console\.log\([^\n]*(?:apikey|Authorization|SERVICE_ROLE_KEY)/);
});

test('WW-12 CDN cache policy accelerates static assets but keeps pages and mutable locale scripts revalidated',()=>{
  const headers=read('_headers');
  for(const page of ['/\n  Cache-Control: no-cache','/index.html\n  Cache-Control: no-cache','/account.html\n  Cache-Control: no-cache','/otop.html\n  Cache-Control: no-cache']){
    assert.ok(headers.includes(page));
  }
  assert.match(headers,/\/assets\/brand\/\*[\s\S]{0,180}s-maxage=86400/);
  assert.match(headers,/\/assets\/chess\/\*[\s\S]{0,180}s-maxage=86400/);
  assert.match(headers,/\/assets\/thongthai\/\*[\s\S]{0,180}s-maxage=86400/);
  assert.match(headers,/\/assets\/styles\/\*[\s\S]{0,180}s-maxage=3600/);
  assert.match(headers,/otop-i18n\.js[\s\S]{0,120}no-cache/);
});

test('WW-12 production certification is read-only and fails unsafe global exposure',()=>{
  const cert=read('scripts/ww12-production-certification.mjs');
  assert.match(cert,/CONTEXT.*production/);
  assert.match(cert,/live_market_without_current_certification/);
  assert.match(cert,/prelaunch_transaction_capability_exposed/);
  assert.match(cert,/live_payment_method_on_nonlive_market/);
  assert.match(cert,/live_shipping_service_on_nonlive_market/);
  assert.match(cert,/WW12_GLOBAL_PRODUCTION_CERTIFICATION_PASS/);
  assert.doesNotMatch(cert,/method\s*:\s*['\"](?:POST|PATCH|PUT|DELETE)['\"]/i);
  assert.doesNotMatch(cert,/rpc\//i);
});

test('WW-12 build gate stays after WW-11 and runs final production certification last',()=>{
  const gate=read('scripts/netlify-build-gate.mjs');
  const ww11=gate.indexOf("'audit-ww11'");
  const ww12=gate.indexOf("'audit-ww12'");
  const prod=gate.indexOf("'ww12-production-certification'");
  assert.ok(ww11>=0&&ww12>ww11&&prod>ww12);
});
