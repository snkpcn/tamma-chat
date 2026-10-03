import {
  normalizeCertificationMarket,
  normalizeCertificationPriceRevisions,
  normalizeCertificationProductIds,
} from './_country-certification';

type DbConfig={url:string;key:string};
function config():DbConfig|null{
  const runtime=(globalThis as typeof globalThis&{Netlify?:{env?:{get?:(k:string)=>unknown}}}).Netlify?.env;
  const get=(k:string)=>{const v=runtime?.get?.(k);return typeof v==='string'?v:undefined};
  const url=get('SUPABASE_URL'),key=get('SUPABASE_SERVICE_ROLE_KEY');
  return url&&key?{url:url.replace(/\/$/,''),key}:null;
}
async function dbFetch(path:string,init:RequestInit={}){
  const c=config(); if(!c)throw new Error('country_certification_not_configured');
  const r=await fetch(`${c.url}/rest/v1/${path}`,{
    ...init,
    headers:{apikey:c.key,Authorization:`Bearer ${c.key}`,'Content-Type':'application/json',...(init.headers??{})},
  });
  if(!r.ok){const b=await r.text().catch(()=>'');throw new Error(`country_certification_db_${r.status}:${b.slice(0,320)}`)}
  return r;
}

export async function evaluateCountryCertification(input:{
  marketCode:unknown;
  productIds:unknown;
  environment?:'live'|'test';
}){
  const marketCode=normalizeCertificationMarket(input.marketCode);
  const productIds=normalizeCertificationProductIds(input.productIds);
  const r=await dbFetch('rpc/evaluate_commerce_market_certification_v1',{
    method:'POST',headers:{Prefer:'return=representation'},
    body:JSON.stringify({
      p_market_code:marketCode,
      p_product_ids:productIds,
      p_environment:input.environment??'live',
    }),
  });
  return await r.json() as {
    ready:boolean;marketCode?:string;countryCode?:string;currencyCode?:string;
    environment?:string;productCount?:number;reasons:string[];
  };
}

export async function loadCountryCertificationForOffer(input:{
  marketCode:unknown;
  countryCode:unknown;
  currencyCode:unknown;
  productPriceRevisions:unknown;
  environment?:'live'|'test';
}){
  const marketCode=normalizeCertificationMarket(input.marketCode);
  const countryCode=typeof input.countryCode==='string'?input.countryCode.trim().toUpperCase():'';
  const currencyCode=typeof input.currencyCode==='string'?input.currencyCode.trim().toUpperCase():'';
  if(!/^[A-Z]{2}$/.test(countryCode))throw new Error('invalid_country_code');
  if(!/^[A-Z]{3}$/.test(currencyCode))throw new Error('invalid_currency_code');
  const revisions=normalizeCertificationPriceRevisions(input.productPriceRevisions);
  const r=await dbFetch('rpc/resolve_commerce_market_certification_v1',{
    method:'POST',headers:{Prefer:'return=representation'},
    body:JSON.stringify({
      p_market_code:marketCode,
      p_country_code:countryCode,
      p_currency_code:currencyCode,
      p_product_price_revisions:revisions,
      p_environment:input.environment??'live',
    }),
  });
  const rows=await r.json() as Array<{certification_id:string;certification_code:string;valid_until:string}>;
  const row=rows[0];
  return row
    ?{kind:'ready' as const,certificationId:row.certification_id,certificationCode:row.certification_code,validUntil:row.valid_until}
    :{kind:'not_available' as const,reason:'country_not_certified' as const};
}
