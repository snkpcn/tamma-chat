import {isWorldwideCapabilityEnabled,type WorldwideEnv} from './_worldwide-foundation';
import {
  normalizeShippingCode,
  normalizeShippingParcel,
  type ShippingParcel,
} from './_global-shipping';

type DbConfig={url:string;key:string};

function config():DbConfig|null{
  const runtime=(globalThis as typeof globalThis&{
    Netlify?:{env?:{get?:(key:string)=>unknown}};
  }).Netlify?.env;
  const get=(name:string):string|undefined=>{
    const value=runtime?.get?.(name);
    return typeof value==='string'?value:undefined;
  };
  const url=get('SUPABASE_URL');
  const key=get('SUPABASE_SERVICE_ROLE_KEY');
  return url&&key?{url:url.replace(/\/$/,''),key}:null;
}

async function dbFetch(path:string,init:RequestInit={}):Promise<Response>{
  const c=config();
  if(!c)throw new Error('global_shipping_not_configured');
  const response=await fetch(`${c.url}/rest/v1/${path}`,{
    ...init,
    headers:{
      apikey:c.key,
      Authorization:`Bearer ${c.key}`,
      'Content-Type':'application/json',
      ...(init.headers??{}),
    },
  });
  if(!response.ok){
    const body=await response.text().catch(()=>'');
    throw new Error(`global_shipping_db_${response.status}:${body.slice(0,240)}`);
  }
  return response;
}

export type GlobalShippingQuoteResult=
  |{kind:'disabled'}
  |{kind:'ready';quote:{
      quoteId:string;
      quoteCode:string;
      marketCode:string;
      originCountryCode:string;
      destinationCountryCode:string;
      currencyCode:string;
      amountMinor:string;
      providerCode:string;
      serviceCode:string;
      zoneCode:string;
      actualWeightGrams:number;
      volumetricWeightGrams:number;
      chargeableWeightGrams:number;
      estimatedMinDays:number;
      estimatedMaxDays:number;
      expiresAt:string;
    }};

export async function createGlobalShippingQuote(input:{
  marketCode:unknown;
  destinationCountryCode:unknown;
  currencyCode:unknown;
  serviceCode?:unknown;
  parcels:unknown;
  idempotencyKey:unknown;
  environment:'live'|'test';
  env?:WorldwideEnv;
}):Promise<GlobalShippingQuoteResult>{
  if(!isWorldwideCapabilityEnabled('globalShipping',input.env))return{kind:'disabled'};

  const marketCode=normalizeShippingCode(input.marketCode);
  if(!marketCode)throw new Error('invalid_shipping_market');
  const destinationCountryCode=typeof input.destinationCountryCode==='string'
    ?input.destinationCountryCode.trim().toUpperCase():'';
  if(!/^[A-Z]{2}$/.test(destinationCountryCode))throw new Error('invalid_destination_country');
  const currencyCode=typeof input.currencyCode==='string'?input.currencyCode.trim().toUpperCase():'';
  if(!/^[A-Z]{3}$/.test(currencyCode))throw new Error('invalid_shipping_currency');
  const serviceCode=input.serviceCode===undefined||input.serviceCode===null||input.serviceCode===''
    ?null:normalizeShippingCode(input.serviceCode);
  if(input.serviceCode&&!serviceCode)throw new Error('invalid_shipping_service');
  if(!Array.isArray(input.parcels))throw new Error('invalid_parcel_count');
  const parcels:ShippingParcel[]=input.parcels.map(normalizeShippingParcel);
  if(parcels.length<1||parcels.length>20)throw new Error('invalid_parcel_count');
  const idempotencyKey=typeof input.idempotencyKey==='string'?input.idempotencyKey.trim():'';
  if(!/^[A-Za-z0-9][A-Za-z0-9:_-]{15,119}$/.test(idempotencyKey)){
    throw new Error('invalid_shipping_idempotency_key');
  }

  const response=await dbFetch('rpc/create_commerce_shipping_quote_v1',{
    method:'POST',
    headers:{Prefer:'return=representation'},
    body:JSON.stringify({
      p_market_code:marketCode,
      p_destination_country_code:destinationCountryCode,
      p_currency_code:currencyCode,
      p_service_code:serviceCode,
      p_parcels:parcels,
      p_idempotency_key:idempotencyKey,
      p_environment:input.environment,
    }),
  });
  const rows=await response.json() as Array<{
    quote_id:string;quote_code:string;market_code:string;origin_country_code:string;
    destination_country_code:string;currency_code:string;amount_minor:string|number;
    provider_code:string;service_code:string;zone_code:string;
    actual_weight_grams:number;volumetric_weight_grams:number;chargeable_weight_grams:number;
    estimated_min_days:number;estimated_max_days:number;expires_at:string;
  }>;
  const row=rows[0];
  if(!row)throw new Error('global_shipping_quote_not_created');
  return{kind:'ready',quote:{
    quoteId:row.quote_id,
    quoteCode:row.quote_code,
    marketCode:row.market_code,
    originCountryCode:row.origin_country_code,
    destinationCountryCode:row.destination_country_code,
    currencyCode:row.currency_code,
    amountMinor:String(row.amount_minor),
    providerCode:row.provider_code,
    serviceCode:row.service_code,
    zoneCode:row.zone_code,
    actualWeightGrams:Number(row.actual_weight_grams),
    volumetricWeightGrams:Number(row.volumetric_weight_grams),
    chargeableWeightGrams:Number(row.chargeable_weight_grams),
    estimatedMinDays:Number(row.estimated_min_days),
    estimatedMaxDays:Number(row.estimated_max_days),
    expiresAt:row.expires_at,
  }};
}


export type GlobalProductShippingProfile={
  productId:string;
  originCountryCode:string;
  weightGrams:number;
  lengthMm:number;
  widthMm:number;
  heightMm:number;
  shipsSeparately:boolean;
};

const PRODUCT_UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * WW-10 read seam: return only canonical WW-6 product parcel profiles.
 * No dimensions or weights are inferred here. Missing profiles stay missing.
 */
export async function loadGlobalProductShippingProfiles(input:{
  productIds:unknown;
  env?:WorldwideEnv;
}):Promise<{kind:'disabled'}|{kind:'ready';profiles:GlobalProductShippingProfile[]}>{
  if(!isWorldwideCapabilityEnabled('globalShipping',input.env))return{kind:'disabled'};
  if(!Array.isArray(input.productIds))throw new Error('invalid_product_ids');
  const ids=[...new Set(input.productIds
    .filter((value):value is string=>typeof value==='string'&&PRODUCT_UUID_RE.test(value))
    .map(value=>value.toLowerCase()))];
  if(ids.length<1||ids.length>30)throw new Error('invalid_product_ids');
  const response=await dbFetch(
    'commerce_product_shipping_profiles?product_id=in.('
    +ids.join(',')
    +')&active=eq.true'
    +'&select=product_id,origin_country_code,weight_grams,length_mm,width_mm,height_mm,ships_separately'
  );
  const rows=await response.json() as Array<{
    product_id:string;origin_country_code:string;weight_grams:number;
    length_mm:number;width_mm:number;height_mm:number;ships_separately:boolean;
  }>;
  return{kind:'ready',profiles:rows.map(row=>({
    productId:row.product_id,
    originCountryCode:row.origin_country_code,
    weightGrams:Number(row.weight_grams),
    lengthMm:Number(row.length_mm),
    widthMm:Number(row.width_mm),
    heightMm:Number(row.height_mm),
    shipsSeparately:Boolean(row.ships_separately),
  }))};
}
