import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  callPreferredModel,
  resetGeminiCircuitForTests,
} from '../netlify/functions/_thongthai-model-provider';

function response(body:unknown,status:number){
  return new Response(JSON.stringify(body),{status});
}

test('Phase 5.13+: stable gemini-3.1-flash-lite is attempted before slower 3.5 fallbacks can consume the shared budget',async()=>{
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
    if(urls.length<=3) return response({},429);
    return response({candidates:[{content:{parts:[{text:'{"ok":true}'}]}}]},200);
  }) as typeof fetch;

  try{
    const out=await callPreferredModel('system',[{role:'user',content:'hi'}],'semantic-interpreter');
    assert.equal(out,'{"ok":true}');
    assert.equal(urls.length,4);
    assert.match(urls[3]!,/gemini-3\.1-flash-lite:generateContent/);
    assert.ok(!urls.some(url=>url.includes('gemini-3.5-flash:generateContent')));
    assert.ok(!urls.some(url=>url.includes('gemini-3.5-flash-lite:generateContent')));
    assert.ok(!urls.some(url=>url.includes('api.openai.com')));
  }finally{
    global.fetch=originalFetch;
    resetGeminiCircuitForTests();
    if(originalGemini===undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY=originalGemini;
    if(originalOpenAI===undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY=originalOpenAI;
    if(originalPaid===undefined) delete process.env.THONGTHAI_ALLOW_PAID_FALLBACK; else process.env.THONGTHAI_ALLOW_PAID_FALLBACK=originalPaid;
  }
});
