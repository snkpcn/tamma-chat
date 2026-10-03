import {isWorldwideCapabilityEnabled,type WorldwideEnv} from './_worldwide-foundation';
import {worldwideDbFetch} from './_worldwide-db-client';

async function dbFetch(path:string,init:RequestInit={}){
  return worldwideDbFetch(path,init,{
    consistency:'strong',
    operation:'customs_transaction_truth',
  });
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
