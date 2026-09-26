import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  callPreferredModel,
  resetGeminiCircuitForTests,
} from '../netlify/functions/_thongthai-model-provider';

function response(body:unknown,status:number){
  return new Response(JSON.stringify(body),{status});
}

test('Phase 5.13 RED: exhausted current free Gemini models fall through to stable free gemini-3.1-flash-lite before any paid provider',async()=>{
  const originalFetch=global.fetch;
  const originalGemini=process.env.GEMINI_API_KEY;
  const originalOpenAI=process.env.OPENAI_API_KEY;
  const originalPaid=process.env.THONGTHAI_ALLOW_PAID_FALLBACK;
  process.env.GEMINI_API_KEY='test-key';
  process.env.OPENAI_API_KEY='paid-key-that-must-not-be-used';
  delete process.env.THONGTHAI_ALLOW_PAID_FALLBACK;
  resetGeminiCircuitForTests();

  const urls:string[]=[];
  global.fetch=(async(url:RequestInfo|URL)=>{
    urls.push(String(url));
    if(urls.length<=5) return response({},429);
    return response({candidates:[{content:{parts:[{text:'{"ok":true}'}]}}]},200);
  }) as typeof fetch;

  try{
    const out=await callPreferredModel('system',[{role:'user',content:'hi'}],'semantic-interpreter');
    assert.equal(out,'{"ok":true}');
    assert.equal(urls.length,6);
    assert.match(urls[5]!,/gemini-3\.1-flash-lite:generateContent/);
    assert.ok(!urls.some(url=>url.includes('api.openai.com')));
  }finally{
    global.fetch=originalFetch;
    resetGeminiCircuitForTests();
    if(originalGemini===undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY=originalGemini;
    if(originalOpenAI===undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY=originalOpenAI;
    if(originalPaid===undefined) delete process.env.THONGTHAI_ALLOW_PAID_FALLBACK; else process.env.THONGTHAI_ALLOW_PAID_FALLBACK=originalPaid;
  }
});
