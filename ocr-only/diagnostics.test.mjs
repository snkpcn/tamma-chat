import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {terminalHttpReason,safeResult,readProviderReason} from './diagnostics.mjs';
import {guardedFetch} from './worker.mjs';

test('HTTP 400 means request rejected, not a proven invalid key',()=>{
 assert.equal(terminalHttpReason(400),'REQUEST_REJECTED');
 assert.equal(terminalHttpReason(401),'AUTHENTICATION_REJECTED');
 assert.equal(terminalHttpReason(403),'ACCESS_REJECTED');
 assert.equal(terminalHttpReason(200),null);
 assert.equal(terminalHttpReason(500),'PROVIDER_SERVER_ERROR');
});

test('each client rejection stops after one mocked call',async()=>{
 for(const status of [400,401,403]){
  const stats={calls:0,httpStatuses:[]};let calls=0;
  const f=guardedFetch(async()=>{calls++;return {status};},stats);
  const url='https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent';
  await f(url,{method:'POST'});await assert.rejects(()=>f(url,{method:'POST'}));
  assert.equal(calls,1);assert.equal(stats.reason,terminalHttpReason(status));
 }
});

test('absent extraction checks are NOT_RUN/null, not false failures',()=>{
 const result=safeResult({status:'REQUEST_REJECTED',providerRequests:1,httpStatuses:[400],
   message:'DO-NOT-PRINT',url:'https://example.invalid/?key=DO-NOT-PRINT'});
 assert.equal(result.validation,'NOT_RUN');
 assert.ok(Object.values(result.checks).every(v=>v===null));
 assert.ok(!JSON.stringify(result).includes('DO-NOT-PRINT'));
 assert.throws(()=>safeResult({status:'KEY_REJECTED',providerRequests:1}));
});

test('completed validations keep actual booleans and reject missing results',()=>{
 const checks={amount:true,date:true,reference:true,bottomNote:false,singleSlip:true};
 assert.deepEqual(safeResult({status:'CHECKS_FAILED',providerRequests:1,checks}).checks,checks);
 assert.equal(safeResult({status:'CHECKS_FAILED',providerRequests:1,checks}).validation,'COMPLETED');
 assert.throws(()=>safeResult({status:'PASS',providerRequests:1}));
});

test('actual extractor sends documented request; legacy mock body methods are not read',async()=>{
 const oldFetch=globalThis.fetch,oldError=console.error;
 const oldGemini=process.env.GEMINI_API_KEY,oldOpenAI=process.env.OPENAI_API_KEY;
 const stats={calls:0,httpStatuses:[]};let bodyReads=0;
 const bytes=Buffer.from(readFileSync(new URL('./synthetic-slip.base64',import.meta.url),'utf8'),'base64');
 const manifest=JSON.parse(readFileSync(new URL('./manifest.json',import.meta.url),'utf8'));
 try{
  process.env.GEMINI_API_KEY='synthetic-test-only';delete process.env.OPENAI_API_KEY;
  console.error=()=>{};
  globalThis.fetch=guardedFetch(async(url,init)=>{
   assert.equal(String(url),'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent');
   assert.equal(init.method,'POST');assert.equal(init.redirect,'error');
   assert.deepEqual(init.headers,{'Content-Type':'application/json','x-goog-api-key':'synthetic-test-only'});
   const body=JSON.parse(init.body);
   assert.deepEqual(Object.keys(body).sort(),['contents','generationConfig']);
   assert.equal(body.contents.length,1);assert.equal(body.contents[0].role,'user');
   assert.equal(body.contents[0].parts.length,2);
   assert.equal(typeof body.contents[0].parts[0].text,'string');
   assert.deepEqual(Object.keys(body.contents[0].parts[1]),['inline_data']);
   const inline=body.contents[0].parts[1].inline_data;
   assert.equal(inline.mime_type,'image/png');
   const sent=Buffer.from(inline.data,'base64');assert.deepEqual(sent,bytes);
   assert.equal(createHash('sha256').update(sent).digest('hex'),manifest.fixtureSha256);
   assert.equal(sent.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
   assert.ok(Buffer.byteLength(init.body)<20*1024*1024);
   assert.deepEqual(body.generationConfig,{responseMimeType:'application/json',maxOutputTokens:1400});
   return {status:400,ok:false,json:async()=>{bodyReads++;throw new Error('body must not be read');},text:async()=>{bodyReads++;throw new Error('body must not be read');}};
  },stats);
  const {extractFinancialEvidence}=await import('./extractor.mjs');
  await assert.rejects(()=>extractFinancialEvidence(bytes,'image/png'),/financial_evidence_extraction_unavailable/);
  assert.equal(stats.calls,1);assert.deepEqual(stats.httpStatuses,[400]);
  assert.equal(stats.reason,'REQUEST_REJECTED');assert.equal(bodyReads,0);
 }finally{
  globalThis.fetch=oldFetch;console.error=oldError;
  if(oldGemini===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=oldGemini;
  if(oldOpenAI===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldOpenAI;
 }
});

const endpoint='https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent';
test('one total request even with concurrent attempts',async()=>{
 const stats={calls:0,httpStatuses:[]};let calls=0;
 const f=guardedFetch(async()=>{calls++;await Promise.resolve();return new Response('{}');},stats);
 await Promise.allSettled([f(endpoint,{method:'POST'}),f(endpoint,{method:'POST'}),
   f(endpoint.replace('3.6','3.5'),{method:'POST'})]);
 assert.equal(calls,1);assert.equal(stats.calls,1);
});
test('only exact Google ErrorInfo enums survive, never arbitrary strings',async()=>{
 const body={error:{message:'DO-NOT-PRINT key=secret',details:[{
  '@type':'type.googleapis.com/google.rpc.ErrorInfo',domain:'googleapis.com',reason:'API_KEY_INVALID',
  metadata:{key:'DO-NOT-PRINT'}}]}};
 assert.equal(await readProviderReason(new Response(JSON.stringify(body))),'API_KEY_INVALID');
 body.error.details[0].reason='DO-NOT-PRINT';
 assert.equal(await readProviderReason(new Response(JSON.stringify(body))),null);
 assert.equal(await readProviderReason(new Response('DO-NOT-PRINT')),null);
 assert.equal(await readProviderReason(new Response('x'.repeat(65537))),null);
 const safe=safeResult({status:'REQUEST_REJECTED',providerRequests:1,providerReason:'DO-NOT-PRINT',httpStatuses:[400]});
 assert.equal(safe.providerReason,null);assert.ok(!JSON.stringify(safe).includes('DO-NOT-PRINT'));
 assert.throws(()=>safeResult({status:'PROVIDER_FAILED',providerRequests:2}));
});
test('real extractor retry and fallback paths cannot dispatch a second request',async()=>{
 const originalFetch=globalThis.fetch,originalError=console.error;
 const gemini=process.env.GEMINI_API_KEY,openai=process.env.OPENAI_API_KEY;
 try{
  process.env.GEMINI_API_KEY='synthetic-only';delete process.env.OPENAI_API_KEY;console.error=()=>{};
  const {extractFinancialEvidence}=await import('./extractor.mjs');
  for(const mode of ['server','rate-limit','transport','invalid-json','empty']){
   const stats={calls:0,httpStatuses:[]};let calls=0;
   globalThis.fetch=guardedFetch(async()=>{calls++;
    if(mode==='transport')throw new Error('DO-NOT-PRINT');
    return new Response(mode==='invalid-json'?'invalid':'{}',
      {status:mode==='server'?503:mode==='rate-limit'?429:200});
   },stats);
   await assert.rejects(()=>extractFinancialEvidence(Buffer.from('synthetic'),'image/png'));
   assert.equal(calls,1,mode);assert.equal(stats.calls,1,mode);
   if(mode==='server')assert.equal(stats.reason,'PROVIDER_SERVER_ERROR');
   if(mode==='rate-limit')assert.equal(stats.reason,'RATE_LIMITED');
   if(mode==='transport')assert.equal(stats.reason,'TRANSPORT_FAILED');
  }
 }finally{
  globalThis.fetch=originalFetch;console.error=originalError;
  if(gemini===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=gemini;
  if(openai===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=openai;
 }
});
