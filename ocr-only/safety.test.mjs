import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {preflight,ocrChildEnvironment} from './guard.mjs';
import {guardedFetch,checksFor} from './worker.mjs';
const fixtures=JSON.parse(readFileSync(new URL('./context-fixtures.json',import.meta.url),'utf8'));
const env=fixtures.valid;
for(const fixture of fixtures.cases)test('context fixture: '+fixture.name,()=>{
 assert.equal(preflight({...env,...fixture.overrides}).status,fixture.status);
});
test('regression: observed checkout ref fails the old branch-name assertion',()=>{
 assert.equal(env.BRANCH,'pull/617/head');
 assert.notEqual(env.BRANCH,'codex/ocr-only-preview-once');
 assert.equal(preflight(env).status,'READY');
});
test('every unexpected credential alias blocks without value disclosure',()=>{
 for(const [keys,status] of [
  [['SUPABASE_SERVICE_ROLE_KEY','SUPABASE_ANON_KEY','SUPABASE_ACCESS_TOKEN','DATABASE_URL','DATABASE_PASSWORD','POSTGRES_URL','POSTGRESQL_URL','PGPASSWORD','PGHOST','DB_PASSWORD'],'BLOCKED_DATABASE_CREDENTIALS'],
  [['LINE_CHANNEL_SECRET','LINE_CHANNEL_ACCESS_TOKEN'],'BLOCKED_LINE_CREDENTIALS'],
  [['OPENAI_API_KEY','GOOGLE_API_KEY','FACEBOOK_APP_SECRET','FACEBOOK_PAGE_ACCESS_TOKEN'],'BLOCKED_OTHER_PROVIDER_CREDENTIALS'],
 ])for(const key of keys){
  const result=preflight({...env,[key]:'DO-NOT-PRINT-SENTINEL'});
  assert.equal(result.status,status,key);
  assert.ok(!JSON.stringify(result).includes('DO-NOT-PRINT-SENTINEL'));
 }
});
test('diagnostics use fixed labels and booleans, never supplied values',()=>{
 const result=preflight({...env,HEAD:'DO-NOT-PRINT-HEAD',BRANCH:'DO-NOT-PRINT-BRANCH',GEMINI_API_KEY:'DO-NOT-PRINT-KEY',LINE_CHANNEL_SECRET:'DO-NOT-PRINT-LINE'});
 assert.equal(result.status,'BLOCKED_HEAD');
 assert.equal(result.checks.head,false);assert.equal(result.checks.checkoutRef,false);
 assert.equal(result.checks.lineCredentialsAbsent,false);
 assert.ok(Object.values(result.checks).every(v=>typeof v==='boolean'));
 assert.ok(!JSON.stringify(result).includes('DO-NOT-PRINT'));
});
test('production rejection happens before any worker or network invocation',()=>{
 const child=spawnSync(process.execPath,[new URL('./run.mjs',import.meta.url).pathname],{
  env:{...env,CONTEXT:'production',LINE_CHANNEL_SECRET:'DO-NOT-PRINT-LINE'},encoding:'utf8',timeout:5000,
 });
 assert.equal(child.status,1);assert.equal(child.stderr,'');
 const result=JSON.parse(child.stdout.trim().replace(/^OCR_ONLY_PREFLIGHT /,''));
 assert.equal(result.status,'BLOCKED_CONTEXT');assert.equal(result.providerRequests,0);
 assert.equal(result.checks.lineCredentialsAbsent,false);
 assert.ok(!child.stdout.includes('DO-NOT-PRINT'));
});
test('child environment strips all except the Gemini credential',()=>{
 assert.deepEqual(ocrChildEnvironment({...env,SUPABASE_URL:'https://fixture.invalid',NETLIFY_AUTH_TOKEN:'fake',HTTPS_PROXY:'fake',NODE_OPTIONS:'fake',WEATHER_API_KEY:'fake'}),{GEMINI_API_KEY:env.GEMINI_API_KEY});
});
test('isolated build config and actual extractor bundle are unchanged',()=>{
 const config=readFileSync(new URL('../netlify.toml',import.meta.url),'utf8');
 assert.match(config,/base = "ocr-only"/);assert.match(config,/publish = "public"/);
 assert.match(config,/functions = "empty-functions"/);
 assert.doesNotMatch(config,/schedule\s*=|\[\[redirects\]\]|\[\[edge_functions\]\]/);
 assert.deepEqual(readdirSync(new URL('./empty-functions',import.meta.url)),['.gitkeep']);
 const manifest=JSON.parse(readFileSync(new URL('./manifest.json',import.meta.url),'utf8'));
 const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
 assert.equal(hash(readFileSync(new URL('./extractor.mjs',import.meta.url))),manifest.bundleSha256);
 assert.equal(hash(readFileSync(new URL('../'+manifest.sourcePath,import.meta.url))),manifest.sourceSha256);
});
const endpoint='https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent';
test('hard limit of one request and redirect rejection',async()=>{
 const s={calls:0,httpStatuses:[]}; let calls=0;
 const f=guardedFetch(async(_u,i)=>{calls++;assert.equal(i.redirect,'error');return {status:200};},s);
 await f(endpoint,{method:'POST'});
 await assert.rejects(()=>f(endpoint,{method:'POST'})); assert.equal(calls,1);
});
test('key rejection stops subsequent calls',async()=>{
 const s={calls:0,httpStatuses:[]};const f=guardedFetch(async()=>({status:403}),s);
 await f(endpoint,{method:'POST'});await assert.rejects(()=>f(endpoint,{method:'POST'}));assert.equal(s.calls,1);
});
test('database, LINE, OpenAI, queries and other models blocked without sending',async()=>{
 for(const url of ['https://example.supabase.co/rest/v1/test','https://api.line.me/message','https://api.openai.com/v1/responses',endpoint+'?key=x',endpoint.replace('3.6','9.9')]){
  const s={calls:0,httpStatuses:[]};const f=guardedFetch(async()=>{assert.fail('network must not run');},s);
  await assert.rejects(()=>f(url,{method:'POST'}));assert.equal(s.calls,0);
 }
});
test('fixture assertions require bottom note and one slip',()=>{
 const e={amount_total:1000,document_date_local:'2026-10-11',reference_number:'TEST-ONLY-0001',visible_payment_note:'ค่าอุปกรณ์ไฟฟ้า ตำมาชาติ งวด 2',payment_document_count:1};
 assert.ok(Object.values(checksFor(e)).every(Boolean));
 assert.equal(checksFor({...e,visible_payment_note:null}).bottomNote,false);
 assert.equal(checksFor({...e,payment_document_count:2}).singleSlip,false);
});
