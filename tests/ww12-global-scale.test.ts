import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  resolveWorldwideDbRoute,
  worldwideDbFetch,
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


test('WW-12 replica 5xx falls back once to primary while writes never touch replica',async()=>{
  const originalFetch=globalThis.fetch;
  const calls:Array<{url:string;method:string}>=[];
  try{
    globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=String(input);
      const method=(init?.method??'GET').toUpperCase();
      calls.push({url,method});
      if(url.startsWith('https://replica.example.com/')){
        return new Response('replica unavailable',{status:503});
      }
      return new Response('[]',{status:200,headers:{'Content-Type':'application/json'}});
    }) as typeof fetch;

    const readResponse=await worldwideDbFetch(
      'commerce_markets?select=market_code',
      {},
      {consistency:'eventual',env:configured,operation:'test_replica_fallback'},
    );
    assert.equal(readResponse.status,200);
    assert.equal(calls.length,2);
    assert.match(calls[0]!.url,/^https:\/\/replica\.example\.com\/rest\/v1\//);
    assert.match(calls[1]!.url,/^https:\/\/primary\.example\.com\/rest\/v1\//);

    calls.length=0;
    const writeResponse=await worldwideDbFetch(
      'rpc/test_write',
      {method:'POST',body:'{}'},
      {consistency:'eventual',env:configured,operation:'test_write'},
    );
    assert.equal(writeResponse.status,200);
    assert.equal(calls.length,1);
    assert.match(calls[0]!.url,/^https:\/\/primary\.example\.com\/rest\/v1\//);
    assert.equal(calls[0]!.method,'POST');
  }finally{
    globalThis.fetch=originalFetch;
  }
});


test('WW-12 preserves fail-fast semantics for primary HTTP errors',async()=>{
  const originalFetch=globalThis.fetch;
  try{
    globalThis.fetch=(async()=>new Response('db down',{status:503})) as typeof fetch;
    await assert.rejects(
      worldwideDbFetch(
        'commerce_markets?select=market_code',
        {},
        {consistency:'strong',env:configured,operation:'test_primary_error'},
      ),
      /worldwide_db_http_503:test_primary_error/,
    );
  }finally{
    globalThis.fetch=originalFetch;
  }
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


test('WW-12 exposes only a sanitized scale snapshot in public brain status',()=>{
  const status=read('netlify/functions/thongthai-brain-status.ts');
  assert.match(status,/worldwideDbScaleSnapshot/);
  assert.match(status,/globalScale:/);
  const client=read('netlify/functions/_worldwide-db-client.ts');
  const snapshotStart=client.indexOf('export function worldwideDbScaleSnapshot');
  const snapshotEnd=client.indexOf('function routeConfig',snapshotStart);
  assert.ok(snapshotStart>=0&&snapshotEnd>snapshotStart);
  const snapshotBlock=client.slice(snapshotStart,snapshotEnd);
  assert.match(snapshotBlock,/primaryConfigured/);
  assert.match(snapshotBlock,/replicaConfigured/);
  assert.match(snapshotBlock,/writesAlwaysPrimary:true/);
  assert.doesNotMatch(snapshotBlock,/return\s*\{[^}]*SERVICE_ROLE_KEY|return\s*\{[^}]*key:/s);
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
  assert.match(cert,/process\.env\.CONTEXT[\s\S]{0,120}context!==['\"]production['\"]/);
  assert.match(cert,/live_market_without_current_certification/);
  assert.match(cert,/prelaunch_transaction_capability_exposed/);
  assert.match(cert,/live_payment_method_on_nonlive_market/);
  assert.match(cert,/live_shipping_service_on_nonlive_market/);
  assert.match(cert,/prelaunch_transaction_env_enabled/);
  assert.match(cert,/WW12_GLOBAL_PRODUCTION_CERTIFICATION_PASS/);
  assert.match(cert,/WW12_GLOBAL_PRODUCTION_CERTIFICATION_DEFERRED/);
  assert.doesNotMatch(cert,/method\s*:\s*['\"](?:POST|PATCH|PUT|DELETE)['\"]/i);
  assert.doesNotMatch(cert,/rpc\//i);
});


test('WW-12 runtime certification uses Netlify runtime secrets and exposes only sanitized safety state',()=>{
  const source=read('netlify/functions/ww12-scale-certification.mts');
  assert.match(source,/Netlify\.env\.get\('SUPABASE_URL'\)/);
  assert.match(source,/Netlify\.env\.get\('SUPABASE_SERVICE_ROLE_KEY'\)/);
  assert.match(source,/path:'\/api\/ww12\/certification'/);
  assert.match(source,/prelaunch_transaction_capability_exposed/);
  assert.match(source,/live_market_without_current_certification/);
  assert.match(source,/live_payment_method_on_nonlive_market/);
  assert.match(source,/live_shipping_service_on_nonlive_market/);
  assert.match(source,/Cache-Control':'no-store'/);
  assert.doesNotMatch(source,/return\s+json\([^\n]*(?:SUPABASE_SERVICE_ROLE_KEY|apikey|Authorization)/);
});

test('WW-12 build gate stays after WW-11 and runs final production certification last',()=>{
  const gate=read('scripts/netlify-build-gate.mjs');
  const ww11=gate.indexOf("'audit-ww11'");
  const ww12=gate.indexOf("'audit-ww12'");
  const prod=gate.indexOf("'ww12-production-certification'");
  assert.ok(ww11>=0&&ww12>ww11&&prod>ww12);
});
