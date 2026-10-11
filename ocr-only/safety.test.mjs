import test from 'node:test';
import assert from 'node:assert/strict';
import {preflight} from './run.mjs';
import {guardedFetch,checksFor} from './worker.mjs';
const env={CONTEXT:'deploy-preview',BRANCH:'codex/ocr-only-preview-once',SITE_ID:'8c1f4d60-68c9-4940-9152-89e9c967e22c',NETLIFY:'true',GEMINI_API_KEY:'synthetic-local-test-token'};
test('fail closed on context and production credentials',()=>{
 assert.equal(preflight(env),null);
 assert.equal(preflight({...env,CONTEXT:'production'}),'BLOCKED_CONTEXT');
 for(const key of ['SUPABASE_SERVICE_ROLE_KEY','LINE_CHANNEL_SECRET','LINE_CHANNEL_ACCESS_TOKEN','OPENAI_API_KEY','DATABASE_URL'])assert.equal(preflight({...env,[key]:'fake'}),'BLOCKED_CREDENTIALS');
 assert.equal(preflight({...env,GEMINI_API_KEY:''}),'BLOCKED_MISSING_GEMINI');
});
const endpoint='https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent';
test('hard limit of two requests and redirect rejection',async()=>{
 const s={calls:0,httpStatuses:[]}; let calls=0;
 const f=guardedFetch(async(_u,i)=>{calls++;assert.equal(i.redirect,'error');return {status:200};},s);
 await f(endpoint,{method:'POST'});await f(endpoint,{method:'POST'});
 await assert.rejects(()=>f(endpoint,{method:'POST'})); assert.equal(calls,2);
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
