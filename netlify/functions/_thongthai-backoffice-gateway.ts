import { decryptPii } from './_operations-db';
import { calculateShippingQuote, safeTrackingUrl } from './_member-delivery';
import { loadShippingSettings } from './_member-delivery-db';
import {
  DOMESTIC_COMMERCE_BASELINE,
  isWorldwideCapabilityEnabled,
  worldwideFeatureSnapshot,
} from './_worldwide-foundation';
import {
  isMarketCapabilityLive,
  normalizeCountryCode,
  type ResolvedMarketContext,
} from './_worldwide-data-core';
import { loadWorldwideMarketContext } from './_worldwide-data-db';

export const THONGTHAI_BACKOFFICE_GATEWAY_VERSION = 'thongthai-backoffice-gateway-v1-2026-10-03';

function envValue(name:string):string|undefined{
  const runtime=(globalThis as typeof globalThis & {
    Netlify?:{env?:{get?:(key:string)=>unknown}};
  }).Netlify?.env;
  const runtimeValue=runtime?.get?.(name);
  if(typeof runtimeValue==='string'&&runtimeValue)return runtimeValue;
  const processValue=process.env[name];
  return typeof processValue==='string'&&processValue?processValue:undefined;
}

function dbConfig():{url:string;key:string}|null{
  const url=envValue('SUPABASE_URL');
  const key=envValue('SUPABASE_SERVICE_ROLE_KEY');
  return url&&key?{url:url.replace(/\/$/,''),key}:null;
}

async function dbFetch(path:string):Promise<Response>{
  const config=dbConfig();
  if(!config)throw new Error('backoffice_not_configured');
  const response=await fetch(`${config.url}/rest/v1/${path}`,{
    headers:{
      apikey:config.key,
      Authorization:`Bearer ${config.key}`,
      'Content-Type':'application/json',
    },
  });
  if(!response.ok){
    const body=await response.text().catch(()=>'');
    throw new Error(`backoffice_db_${response.status}:${body.slice(0,180)}`);
  }
  return response;
}

export type ThongthaiMarketReadout =
  | {
      ok:true;
      source:'ww1_market_core'|'domestic_baseline';
      countryCode:string;
      currencyCode:string;
      localeCode:string|null;
      marketCode:string;
      marketStatus:'live'|'legacy_domestic';
      isDomestic:boolean;
      capabilities:Record<string,string>;
    }
  | {
      ok:false;
      source:'ww1_market_core';
      countryCode:string|null;
      status:'not_available';
      reason:string;
      features:ReturnType<typeof worldwideFeatureSnapshot>;
    };

export async function readThongthaiMarketContext(
  countryInput:unknown,
  requestedLocale:unknown,
):Promise<ThongthaiMarketReadout>{
  const countryCode=normalizeCountryCode(countryInput);
  const features=worldwideFeatureSnapshot();

  // Thailand remains answerable even while WW customer exposure is gated off.
  // This does not duplicate WW data; it exposes the locked domestic baseline
  // that WW-0 itself declares as canonical.
  if(countryCode===DOMESTIC_COMMERCE_BASELINE.countryCode&&!features.capabilities.dataCore){
    return{
      ok:true,
      source:'domestic_baseline',
      countryCode:'TH',
      currencyCode:'THB',
      localeCode:typeof requestedLocale==='string'&&requestedLocale.trim()?requestedLocale.trim():null,
      marketCode:'TH',
      marketStatus:'legacy_domestic',
      isDomestic:true,
      capabilities:{shipping:'live_domestic_legacy',thongthai:'live'},
    };
  }

  const result=await loadWorldwideMarketContext(countryCode,requestedLocale);
  if(result.kind!=='ready'){
    return{
      ok:false,
      source:'ww1_market_core',
      countryCode,
      status:'not_available',
      reason:result.kind==='disabled'?'worldwide_data_core_disabled':result.reason,
      features,
    };
  }
  return{
    ok:true,
    source:'ww1_market_core',
    countryCode:result.context.countryCode,
    currencyCode:result.context.currencyCode,
    localeCode:result.context.localeCode,
    marketCode:result.context.marketCode,
    marketStatus:'live',
    isDomestic:result.context.isDomestic,
    capabilities:{...result.context.capabilities},
  };
}

function foreignShippingReady(context:ResolvedMarketContext):boolean{
  return isWorldwideCapabilityEnabled('globalShipping')
    && isWorldwideCapabilityEnabled('thongthaiWorldwide')
    && isMarketCapabilityLive(context,'shipping')
    && isMarketCapabilityLive(context,'thongthai');
}

export type ThongthaiShippingReadout =
  | {
      ok:true;
      countryCode:'TH';
      currencyCode:'THB';
      source:'otop_shipping_settings';
      shippingFee:number|null;
      subtotal:number|null;
      total:number|null;
      freeShipping:boolean|null;
      domesticBaseFee:number;
      freeShippingThreshold:number|null;
      estimatedMinDays:number;
      estimatedMaxDays:number;
    }
  | {
      ok:false;
      countryCode:string|null;
      source:'worldwide_shipping';
      status:'not_available';
      reason:string;
      market?:ThongthaiMarketReadout;
    };

export async function readThongthaiShippingQuote(input:{
  countryCode:unknown;
  subtotal?:unknown;
  locale?:unknown;
}):Promise<ThongthaiShippingReadout>{
  const countryCode=normalizeCountryCode(input.countryCode);
  if(countryCode==='TH'){
    const settings=await loadShippingSettings();
    const subtotalNumber=Number(input.subtotal);
    const hasSubtotal=Number.isFinite(subtotalNumber)&&subtotalNumber>=0;
    const quote=hasSubtotal?calculateShippingQuote(subtotalNumber,settings):null;
    return{
      ok:true,
      countryCode:'TH',
      currencyCode:'THB',
      source:'otop_shipping_settings',
      shippingFee:quote?.shippingFee??null,
      subtotal:quote?.subtotal??null,
      total:quote?.total??null,
      freeShipping:quote?.freeShipping??null,
      domesticBaseFee:settings.domesticBaseFee,
      freeShippingThreshold:settings.freeShippingThreshold,
      estimatedMinDays:settings.estimatedMinDays,
      estimatedMaxDays:settings.estimatedMaxDays,
    };
  }

  const market=await readThongthaiMarketContext(countryCode,input.locale);
  if(!market.ok){
    return{
      ok:false,
      countryCode,
      source:'worldwide_shipping',
      status:'not_available',
      reason:market.reason,
      market,
    };
  }

  // WW-0/WW-1/WW-2 deliberately do not provide foreign rates. Keep this
  // fail-closed until the separate WW shipping project publishes a canonical
  // quote source. Thongthai can already explain market readiness without
  // inventing a rate.
  const raw=await loadWorldwideMarketContext(countryCode,input.locale);
  if(raw.kind!=='ready'||!foreignShippingReady(raw.context)){
    return{
      ok:false,
      countryCode,
      source:'worldwide_shipping',
      status:'not_available',
      reason:'international_shipping_not_live',
      market,
    };
  }
  return{
    ok:false,
    countryCode,
    source:'worldwide_shipping',
    status:'not_available',
    reason:'global_shipping_quote_source_not_connected',
    market,
  };
}

export type ThongthaiOtopOrderStatus = {
  ok:boolean;
  orderCode?:string;
  orderStatus?:string|null;
  shippingStatus?:string|null;
  carrierName?:string|null;
  trackingNumber?:string|null;
  trackingUrl?:string|null;
  shippingFee?:number|null;
  total?:number|null;
  shippedAt?:string|null;
  deliveredAt?:string|null;
  createdAt?:string|null;
  error?:string;
};

export async function readThongthaiOtopOrderStatus(
  guestDbId:string|null,
  orderCode?:unknown,
  environment:'live'|'test'='live',
):Promise<ThongthaiOtopOrderStatus>{
  if(!guestDbId)return{ok:false,error:'guest_required'};
  const code=typeof orderCode==='string'&&orderCode.trim()?orderCode.trim().slice(0,80):null;
  const filters=[
    `guest_id=eq.${encodeURIComponent(guestDbId)}`,
    `environment=eq.${encodeURIComponent(environment)}`,
    ...(code?[`order_code=eq.${encodeURIComponent(code)}`]:[]),
  ].join('&');
  const response=await dbFetch(
    `otop_orders?${filters}`
    +'&select=order_code,status,shipping_status,carrier_name,tracking_number_enc,tracking_url,shipping_fee,total_amount,shipped_at,delivered_at,created_at'
    +'&order=created_at.desc&limit=1',
  );
  const rows=await response.json() as Array<Record<string,unknown>>;
  const row=rows[0];
  if(!row)return{ok:false,error:'order_not_found'};
  return{
    ok:true,
    orderCode:String(row.order_code??''),
    orderStatus:typeof row.status==='string'?row.status:null,
    shippingStatus:typeof row.shipping_status==='string'?row.shipping_status:null,
    carrierName:typeof row.carrier_name==='string'?row.carrier_name:null,
    trackingNumber:typeof row.tracking_number_enc==='string'?decryptPii(row.tracking_number_enc):null,
    trackingUrl:safeTrackingUrl(row.tracking_url),
    shippingFee:Number.isFinite(Number(row.shipping_fee))?Number(row.shipping_fee):null,
    total:Number.isFinite(Number(row.total_amount))?Number(row.total_amount):null,
    shippedAt:typeof row.shipped_at==='string'?row.shipped_at:null,
    deliveredAt:typeof row.delivered_at==='string'?row.delivered_at:null,
    createdAt:typeof row.created_at==='string'?row.created_at:null,
  };
}
