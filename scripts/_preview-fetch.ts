/** Keep all backend state synthetic while optionally enabling the existing
 * OpenAI Responses transport. Unknown destinations fail closed, including
 * real Supabase projects, LINE and other outbound notification providers. */
export function createPreviewFetch(options:{
  aiEnabled:boolean;
  webSearchEnabled?:boolean;
  mockFetch:typeof fetch;
  networkFetch:typeof fetch;
  kku?:{apiKey:string};
}):typeof fetch {
  return (async(input,init)=>{
    const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
    if(url.origin==='https://example.supabase.co' && url.pathname.startsWith('/rest/v1/')) {
      return options.mockFetch(input,init);
    }
    if(options.webSearchEnabled && url.href==='https://api.tavily.com/search'
        && (init?.method ?? (input instanceof Request?input.method:'GET')).toUpperCase()==='POST') {
      return options.networkFetch(input,{...init,redirect:'error'});
    }
    if(options.aiEnabled && url.href==='https://api.openai.com/v1/responses'
        && (init?.method ?? (input instanceof Request?input.method:'GET')).toUpperCase()==='POST') {
      if(options.kku) {
        // KKU exposes Chat Completions, not Responses. Adapt only this
        // local preview transport; production provider code stays intact.
        const inputBody=init?.body ?? (input instanceof Request?await input.clone().text():null);
        if(typeof inputBody!=='string')throw new Error('preview_model_body_required');
        const body=JSON.parse(inputBody);
        if(!Array.isArray(body.input) || typeof body.model!=='string')throw new Error('preview_model_body_invalid');
        const schema=body.text?.format?.schema;
        const instructions=String(body.instructions ?? '')+(schema?'\nReturn only valid JSON matching this schema:\n'+JSON.stringify(schema):'');
        const response=await options.networkFetch('https://gen.ai.kku.ac.th/api/v1/chat/completions',{
          method:'POST',redirect:'error',signal:init?.signal ?? (input instanceof Request?input.signal:undefined),
          headers:{'Content-Type':'application/json',Authorization:`Bearer ${options.kku.apiKey}`},
          body:JSON.stringify({
            model:body.model,
            messages:[{role:'system',content:instructions},...body.input.map((message:any)=>({
              role:message.role,content:typeof message.content==='string'?message.content:message.content.map((part:any)=>part.text ?? '').join('\n'),
            }))],
            max_tokens:body.max_output_tokens,stream:false,
          }),
        });
        // Do not echo a gateway error body that might contain credentials.
        if(!response.ok)return new Response(JSON.stringify({error:'kku_gateway_request_failed'}),{status:response.status,headers:{'Content-Type':'application/json'}});
        const result=await response.json() as any;
        const content=result.choices?.[0]?.message?.content;
        const text=typeof content==='string'?content:Array.isArray(content)?content.map((part:any)=>part.text ?? '').join(''):'';
        return new Response(JSON.stringify({
          output_text:text,
          ...(result.usage?{usage:{
            input_tokens:result.usage.prompt_tokens,
            output_tokens:result.usage.completion_tokens,
            input_tokens_details:{cached_tokens:result.usage.prompt_tokens_details?.cached_tokens ?? 0},
          }}:{}),
        }),{status:200,headers:{'Content-Type':'application/json'}});
      }
      return options.networkFetch(input,{...init,redirect:'error'});
    }
    throw new Error('preview_outbound_destination_blocked');
  }) as typeof fetch;
}
