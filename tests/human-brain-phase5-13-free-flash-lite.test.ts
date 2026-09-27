import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  callPreferredModel,
  OPENAI_SEMANTIC_PRIMARY_MODEL,
} from '../netlify/functions/_thongthai-model-provider';

test('Human Conversation Recovery: provider path is one bounded OpenAI semantic-supervisor call with no Gemini fallback chain', async () => {
  const originalFetch=global.fetch;
  const originalOpenAI=process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY='test-openai-key';
  const urls:string[]=[];
  const models:string[]=[];
  global.fetch=(async(url:RequestInfo|URL,init?:RequestInit)=>{
    urls.push(String(url));
    models.push(JSON.parse(String(init?.body ?? '{}')).model);
    return new Response(JSON.stringify({output_text:'{"ok":true}'}),{status:200});
  }) as typeof fetch;

  try{
    const out=await callPreferredModel('system',[{role:'user',content:'hi'}],'semantic-interpreter');
    assert.equal(out,'{"ok":true}');
    assert.equal(urls.length,1);
    assert.match(urls[0]!,/api\.openai\.com\/v1\/responses/);
    assert.equal(models[0],OPENAI_SEMANTIC_PRIMARY_MODEL);
    assert.ok(!urls.some(url=>url.includes('googleapis.com')));
  }finally{
    global.fetch=originalFetch;
    if(originalOpenAI===undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY=originalOpenAI;
  }
});
