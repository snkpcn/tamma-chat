import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  callPreferredModel,
  resetGeminiCircuitForTests,
} from '../netlify/functions/_thongthai-model-provider';

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status });
}

test('Phase 5.12 RED: exhausted newer free Gemini models fall through to stable free gemini-3.1-flash-lite before paid OpenAI',async()=>{
  const originalFetch=global.fetch;
  const originalGemini=process.env.GEMINI_API_KEY;
  const originalOpenAI=process.env.OPENAI_API_KEY;
  const originalPaid=process.env.THONGTHAI_ALLOW_PAID_FALLBACK;
  process.env.GEMINI_API_KEY='test-gemini-key';
  process.env.OPENAI_API_KEY='test-openai-key';
  delete process.env.THONGTHAI_ALLOW_PAID_FALLBACK;
  resetGeminiCircuitForTests();

  const urls:string[]=[];
  global.fetch=(async(url:RequestInfo|URL)=>{
    const value=String(url);
    urls.push(value);
    if(value.includes('gemini-3.1-flash-lite:generateContent')){
      return jsonResponse({candidates:[{content:{parts:[{text:'{"ok":true}'}]}}]},200);
    }
    if(value.includes('generativelanguage.googleapis.com')){
      return jsonResponse({},429);
    }
    throw new Error('paid provider must not be called');
  }) as typeof fetch;

  try{
    const result=await callPreferredModel('system',[{role:'user',content:'hi'}],'test');
    assert.equal(result,'{"ok":true}');
    assert.ok(urls.some(url=>url.includes('gemini-3.1-flash-lite:generateContent')));
    assert.ok(!urls.some(url=>url.includes('api.openai.com')));
    const lastGemini=urls.filter(url=>url.includes('generativelanguage.googleapis.com')).at(-1) ?? '';
    assert.match(lastGemini,/gemini-3\.1-flash-lite:generateContent/);
  }finally{
    global.fetch=originalFetch;
    resetGeminiCircuitForTests();
    if(originalGemini===undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY=originalGemini;
    if(originalOpenAI===undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY=originalOpenAI;
    if(originalPaid===undefined) delete process.env.THONGTHAI_ALLOW_PAID_FALLBACK; else process.env.THONGTHAI_ALLOW_PAID_FALLBACK=originalPaid;
  }
});

test('Phase 5.12: shared provider budget and paid fallback gate remain intact',()=>{
  const fs=require('node:fs') as typeof import('node:fs');
  const source=fs.readFileSync(new URL('../netlify/functions/_thongthai-model-provider.ts',import.meta.url),'utf8');
  assert.match(source,/TOTAL_PROVIDER_BUDGET_MS = 7_000/);
  assert.match(source,/THONGTHAI_ALLOW_PAID_FALLBACK !== '1'/);
});
