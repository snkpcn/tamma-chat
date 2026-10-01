const SESSION_ID='sess_0360552c185c27e6006abe4aa4956881a38f6535c003f17281';
const key=process.env.OPENAI_API_KEY?.trim();
if(!key) throw new Error('OPENAI_API_KEY missing');
const headers={Authorization:`Bearer ${key}`,'OpenAI-Beta':'agents=v1'};

async function get(path:string){
  const r=await fetch(`https://api.openai.com/v1${path}`,{headers});
  const t=await r.text();
  if(!r.ok) throw new Error(`${r.status} ${t.slice(0,400)}`);
  return t?JSON.parse(t):{};
}

async function main(){
  const session=await get(`/agents/sessions/${SESSION_ID}`);
  const turns=await get(`/agents/sessions/${SESSION_ID}/turns?order=asc&limit=20`);
  const items=await get(`/agents/sessions/${SESSION_ID}/items?order=asc&limit=100`);
  console.log(JSON.stringify({
    session,
    turns:(turns.data??[]).map((t:any)=>({
      id:t.id,status:t.status,created_at:t.created_at,started_at:t.started_at,completed_at:t.completed_at,usage:t.usage,error:t.error,
    })),
    items:(items.data??[]).map((item:any)=>({
      id:item.id,type:item.type,role:item.role,turn_id:item.turn_id,name:item.name,arguments:item.arguments,
      status:item.status,output:item.output,error:item.error,
      content:Array.isArray(item.content)?item.content.map((p:any)=>({type:p.type,text:p.text})):undefined,
    })),
  },null,2));
}
main().catch(e=>{console.error(e instanceof Error?e.message:String(e));process.exit(1);});
