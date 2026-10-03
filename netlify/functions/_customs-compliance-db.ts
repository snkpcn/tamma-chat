import {isWorldwideCapabilityEnabled,type WorldwideEnv} from './_worldwide-foundation';

type DbConfig={url:string;key:string};
function config():DbConfig|null{
  const runtime=(globalThis as typeof globalThis&{Netlify?:{env?:{get?:(k:string)=>unknown}}}).Netlify?.env;
  const get=(k:string)=>{const v=runtime?.get?.(k);return typeof v==='string'?v:undefined};
  const url=get('SUPABASE_URL'),key=get('SUPABASE_SERVICE_ROLE_KEY');
  return url&&key?{url:url.replace(/\/$/,''),key}:null;
}
async function dbFetch(path:string,init:RequestInit={}){
  const c=config(); if(!c)throw new Error('customs_not_configured');
  const r=await fetch(`${c.url}/rest/v1/${path}`,{...init,headers:{apikey:c.key,Authorization:`Bearer ${c.key}`,'Content-Type':'application/json',...(init.headers??{})}});
  if(!r.ok){const b=await r.text().catch(()=>'');throw new Error(`customs_db_${r.status}:${b.slice(0,240)}`)}
  return r;
}

export async function createCustomsComplianceSnapshot(input:{
  marketCode:string;destinationCountryCode:string;currencyCode:string;
  items:Array<{productId:string;quantity:number}>;
  idempotencyKey:string;environment:'live'|'test';env?:WorldwideEnv;
}):Promise<{kind:'disabled'}|{kind:'ready';snapshotId:string;decision:string;dutyTaxStatus:string}>{
  if(!isWorldwideCapabilityEnabled('customs',input.env))return{kind:'disabled'};
  const r=await dbFetch('rpc/create_commerce_customs_snapshot_v1',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({
    p_market_code:input.marketCode,
    p_destination_country_code:input.destinationCountryCode,
    p_currency_code:input.currencyCode,
    p_items:input.items,
    p_idempotency_key:input.idempotencyKey,
    p_environment:input.environment,
  })});
  const rows=await r.json() as Array<{snapshot_id:string;decision:string;duty_tax_status:string}>;
  const row=rows[0]; if(!row)throw new Error('customs_snapshot_not_created');
  return{kind:'ready',snapshotId:row.snapshot_id,decision:row.decision,dutyTaxStatus:row.duty_tax_status};
}
