import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewFetch } from '../scripts/_preview-fetch';

test('search preview permits only the configured search POST and never a different URL or method',async()=>{
 let calls=0;
 const networkFetch=(async(_input,init)=>{calls++;assert.equal(init?.redirect,'error');return new Response('{}');}) as typeof fetch;
 const mockFetch=(async()=>new Response('[]')) as typeof fetch;
 const enabled=createPreviewFetch({aiEnabled:false,webSearchEnabled:true,networkFetch,mockFetch});
 await enabled('https://api.tavily.com/search',{method:'POST'});
 for(const url of ['https://api.tavily.com/search?redirect=evil','https://api.tavily.com/usage','https://api.tavily.com.attacker.test/search'])await assert.rejects(enabled(url,{method:'POST'}),/preview_outbound_destination_blocked/);
 await assert.rejects(enabled('https://api.tavily.com/search'),/preview_outbound_destination_blocked/);
 const disabled=createPreviewFetch({aiEnabled:false,networkFetch,mockFetch});
 await assert.rejects(disabled('https://api.tavily.com/search',{method:'POST'}),/preview_outbound_destination_blocked/);
 assert.equal(calls,1);
});

test('AI preview calls OpenAI only and keeps backend writes in the fixture store',async()=>{
  let realCalls=0,mockCalls=0;
  const previewFetch=createPreviewFetch({aiEnabled:true,
    networkFetch:(async(_input,init)=>{realCalls++;assert.equal(init?.redirect,'error');return new Response('{}');}) as typeof fetch,
    mockFetch:(async()=>{mockCalls++;return new Response('[]');}) as typeof fetch,
  });
  await previewFetch('https://api.openai.com/v1/responses',{method:'POST'});
  await previewFetch('https://example.supabase.co/rest/v1/guest_agent_state',{method:'POST'});
  for(const url of ['https://real-project.supabase.co/rest/v1/guests','https://api.line.me/v2/bot/message/push','https://api.openai.com.attacker.test/v1/responses','https://api.openai.com/v1/files']) {
    await assert.rejects(previewFetch(url,{method:'POST'}),/preview_outbound_destination_blocked/);
  }
  assert.equal(realCalls,1);
  assert.equal(mockCalls,1);
});

test('offline preview never forwards model calls even if an inherited key exists',async()=>{
  let calls=0;
  const previewFetch=createPreviewFetch({aiEnabled:false,
    networkFetch:(async()=>{calls++;return new Response('{}');}) as typeof fetch,
    mockFetch:(async()=>new Response('[]')) as typeof fetch,
  });
  await assert.rejects(previewFetch('https://api.openai.com/v1/responses',{method:'POST'}),/preview_outbound_destination_blocked/);
  assert.equal(calls,0);
});

test('KKU preview translates Responses into Chat Completions with the KKU key and preserves usage',async()=>{
  const controller=new AbortController();
  let calls=0;
  const previewFetch=createPreviewFetch({aiEnabled:true,kku:{apiKey:'test-kku-key'},
    mockFetch:(async()=>{throw new Error('model request must not use fixture completion');}) as typeof fetch,
    networkFetch:(async(input,init)=>{
      calls++;
      assert.equal(String(input),'https://gen.ai.kku.ac.th/api/v1/chat/completions');
      assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer test-kku-key');
      assert.equal(init?.redirect,'error');
      assert.equal(init?.signal,controller.signal);
      const payload=JSON.parse(String(init?.body));
      assert.equal(payload.model,'gpt-5.6-terra');
      assert.equal(payload.max_tokens,900);
      assert.equal(payload.stream,false);
      assert.equal(payload.messages[1].content,'ผู้ใหญ่ 2 คน งบ 500 บาท');
      assert.equal(payload.messages[2].content,'อาหารไม่เผ็ดครับ');
      assert.match(payload.messages[0].content,/Return only valid JSON/);
      assert.doesNotMatch(JSON.stringify(payload),/test-kku-key|openai-test-key/);
      return new Response(JSON.stringify({choices:[{message:{content:'{"message":"ได้ครับ"}'}}],usage:{prompt_tokens:100,completion_tokens:20,prompt_tokens_details:{cached_tokens:40}}}));
    }) as typeof fetch,
  });
  const response=await previewFetch('https://api.openai.com/v1/responses',{
    method:'POST',headers:{Authorization:'Bearer openai-test-key'},signal:controller.signal,
    body:JSON.stringify({model:'gpt-5.6-terra',instructions:'Answer using the facts.',input:[
      {role:'user',content:[{type:'input_text',text:'ผู้ใหญ่ 2 คน งบ 500 บาท'}]},
      {role:'assistant',content:[{type:'output_text',text:'อาหารไม่เผ็ดครับ'}]},
    ],max_output_tokens:900,text:{format:{schema:{type:'object'}}}}),
  });
  assert.deepEqual(await response.json(),{output_text:'{"message":"ได้ครับ"}',usage:{input_tokens:100,output_tokens:20,input_tokens_details:{cached_tokens:40}}});
  assert.equal(calls,1);
});

test('KKU errors preserve status without exposing gateway bodies, and absent usage stays absent',async()=>{
  let status=401;
  const previewFetch=createPreviewFetch({aiEnabled:true,kku:{apiKey:'test-only'},
    mockFetch:(async()=>new Response('[]')) as typeof fetch,
    networkFetch:(async()=>status===401?new Response('do-not-echo-key',{status}):new Response(JSON.stringify({choices:[{message:{content:'{}'}}]}))) as typeof fetch,
  });
  const init={method:'POST',body:JSON.stringify({model:'gpt-5.6-terra',input:[]})};
  const failed=await previewFetch('https://api.openai.com/v1/responses',init);
  assert.equal(failed.status,401);
  assert.doesNotMatch(await failed.text(),/do-not-echo-key/);
  status=200;
  const successful=await previewFetch('https://api.openai.com/v1/responses',init);
  assert.equal('usage' in await successful.json(),false);
});
