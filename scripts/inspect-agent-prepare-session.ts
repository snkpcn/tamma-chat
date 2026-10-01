const sessionId='sess_0838d363a2bec480006abe3a2d1f6481a08a99353d26b41c56';
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
  const turns=await get(`/agents/sessions/${sessionId}/turns?order=asc&limit=20`);
  const items=await get(`/agents/sessions/${sessionId}/items?order=asc&limit=100`);
  const safeItems=(items.data??[]).map((item:any)=>({
    id:item.id,
    type:item.type,
    role:item.role,
    turn_id:item.turn_id,
    name:item.name,
    arguments:item.arguments,
    status:item.status,
    content:Array.isArray(item.content)?item.content.map((p:any)=>({type:p.type,text:p.text})):undefined,
  }));
  console.log(JSON.stringify({turns:turns.data??[],items:safeItems},null,2));
}
main().catch(e=>{console.error(e instanceof Error?e.message:String(e));process.exit(1);});
