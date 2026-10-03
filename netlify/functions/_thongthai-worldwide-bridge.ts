/**
 * Thongthai <-> Worldwide / Backoffice service bridge.
 *
 * Ownership rule:
 * - WW owns country/currency/locale/market/pricing/payment/shipping/customs/checkout/fulfillment.
 * - Existing domain modules own live OTOP product/stock truth.
 * - Thongthai owns ZERO duplicate commerce tables and never invents price,
 *   parcel data, shipping, customs, payment, or fulfillment facts.
 */
import { createHash, randomUUID } from 'node:crypto';
import {
  DOMESTIC_COMMERCE_BASELINE,
  isWorldwideCapabilityEnabled,
  worldwideFeatureSnapshot,
  type WorldwideEnv,
} from './_worldwide-foundation';
import {
  isMarketCapabilityLive,
  type ResolvedMarketContext,
} from './_worldwide-data-core';
import { loadWorldwideMarketContext } from './_worldwide-data-db';
import { loadShippingSettings } from './_member-delivery-db';
import { calculateShippingQuote } from './_member-delivery';
import { listOtopProducts, type OrderableProduct } from './_operations-db';
import { loadExplicitProductPrice } from './_multi-currency-db';
import {
  createGlobalShippingQuote,
  loadGlobalProductShippingProfiles,
  type GlobalProductShippingProfile,
} from './_global-shipping-db';
import { createCustomsComplianceSnapshot } from './_customs-compliance-db';
import { loadGlobalPaymentMethod } from './_global-payments-db';
import { internationalCheckoutMissingCapabilities } from './_international-checkout';
import { getGuestGlobalCommerceStatus } from './_global-fulfillment-db';

export const THONGTHAI_WORLDWIDE_BRIDGE_VERSION = 'thongthai-worldwide-bridge-v2-ww10-2026-10-03';

export const THONGTHAI_BACKOFFICE_READ_LANES = Object.freeze([
  { lane:'restaurant', source:'restaurant live menu + intelligence' },
  { lane:'cafe', source:'Inthanin live menu + branch modifiers' },
  { lane:'activity', source:'service resources + activity offerings + schedules' },
  { lane:'stay', source:'stay resources + schedules' },
  { lane:'otop', source:'OTOP products + inventory + order state' },
  { lane:'promotion', source:'promotion runtime' },
  { lane:'booking', source:'bookings operational state' },
  { lane:'payment', source:'legacy payment requests + WW payment intents' },
  { lane:'membership', source:'customer membership state' },
  { lane:'market', source:'WW country/currency/locale/market core' },
  { lane:'pricing', source:'WW explicit multi-currency product price revisions' },
  { lane:'shipping', source:'domestic shipping settings or WW shipping quote authority' },
  { lane:'customs', source:'WW customs profiles + explicit destination rules + compliance snapshots' },
  { lane:'fulfillment', source:'WW shipment/packages/tracking timeline' },
] as const);

export type ThongthaiMarketRead =
  | {
      status:'ready';
      source:'domestic_baseline'|'worldwide_data_core';
      context:ResolvedMarketContext;
    }
  | {
      status:'not_available';
      reason:string;
      countryCode:string|null;
      worldwide:ReturnType<typeof worldwideFeatureSnapshot>;
    };

function domesticContext(locale:string|null|undefined):ResolvedMarketContext{
  const requested=typeof locale==='string'&&locale.trim()?locale.trim():'th';
  const supported=new Set(['th','en','zh','lo','vi']);
  const canonical=requested.replace(/_/g,'-').split('-')[0]!.toLowerCase();
  const localeCode=supported.has(canonical)?canonical:'th';
  return{
    version:'ww1-global-data-core-2026-10-03',
    marketCode:'TH',
    countryCode:DOMESTIC_COMMERCE_BASELINE.countryCode,
    currencyCode:DOMESTIC_COMMERCE_BASELINE.currencyCode,
    localeCode,
    status:'live',
    isDomestic:true,
    capabilities:{
      catalog:'live',
      storefront:'live',
      pricing:'live',
      payments:'live',
      shipping:'live',
      customs:'disabled',
      checkout:'live',
      fulfillment:'live',
      thongthai:'live',
    },
  };
}

export async function readThongthaiMarketContext(
  countryCode:unknown,
  requestedLocale?:unknown,
  env?:WorldwideEnv,
):Promise<ThongthaiMarketRead>{
  const normalized=typeof countryCode==='string'?countryCode.trim().toUpperCase():'';
  if(normalized===DOMESTIC_COMMERCE_BASELINE.countryCode){
    const loaded=await loadWorldwideMarketContext(normalized,requestedLocale,env)
      .catch(()=>({kind:'disabled' as const}));
    if(loaded.kind==='ready')return{status:'ready',source:'worldwide_data_core',context:loaded.context};
    return{
      status:'ready',
      source:'domestic_baseline',
      context:domesticContext(typeof requestedLocale==='string'?requestedLocale:null),
    };
  }

  const worldwide=worldwideFeatureSnapshot(env);
  const loaded=await loadWorldwideMarketContext(normalized,requestedLocale,env).catch(error=>({
    kind:'unavailable' as const,
    reason:'worldwide_data_error:'+(error instanceof Error?error.message.slice(0,120):'unknown'),
  }));
  if(loaded.kind==='ready')return{status:'ready',source:'worldwide_data_core',context:loaded.context};
  return{
    status:'not_available',
    reason:loaded.kind==='disabled'?'worldwide_data_core_disabled':loaded.reason,
    countryCode:normalized||null,
    worldwide,
  };
}

export type ThongthaiShippingQuoteRead =
  | {
      status:'ready';
      source:'otop_shipping_settings';
      countryCode:'TH';
      currencyCode:'THB';
      policy:{
        domesticBaseFee:number;
        freeShippingThreshold:number|null;
        estimatedMinDays:number;
        estimatedMaxDays:number;
      };
      quote:{
        subtotal:number;
        shippingFee:number;
        total:number;
        freeShipping:boolean;
        estimatedMinDays:number;
        estimatedMaxDays:number;
      }|null;
    }
  | {
      status:'not_available';
      reason:
        | 'invalid_subtotal'
        | 'market_not_ready'
        | 'thongthai_market_capability_not_live'
        | 'shipping_market_capability_not_live'
        | 'worldwide_thongthai_gate_off'
        | 'worldwide_shipping_gate_off'
        | 'global_shipping_package_data_required';
      countryCode:string;
      market?:ResolvedMarketContext;
    };

export function buildThongthaiDomesticShippingRead(
  settings:{
    domesticBaseFee:number;
    freeShippingThreshold:number|null;
    estimatedMinDays:number;
    estimatedMaxDays:number;
  },
  subtotal:number|null,
):Extract<ThongthaiShippingQuoteRead,{status:'ready'}>{
  const quote=subtotal===null?null:calculateShippingQuote(subtotal,settings);
  return{
    status:'ready',
    source:'otop_shipping_settings',
    countryCode:'TH',
    currencyCode:'THB',
    policy:{
      domesticBaseFee:settings.domesticBaseFee,
      freeShippingThreshold:settings.freeShippingThreshold,
      estimatedMinDays:settings.estimatedMinDays,
      estimatedMaxDays:settings.estimatedMaxDays,
    },
    quote,
  };
}

export async function readThongthaiShippingQuote(input:{
  countryCode:unknown;
  subtotal?:unknown;
  locale?:unknown;
  env?:WorldwideEnv;
}):Promise<ThongthaiShippingQuoteRead>{
  const countryCode=typeof input.countryCode==='string'?input.countryCode.trim().toUpperCase():'';
  const hasSubtotal=input.subtotal!==undefined&&input.subtotal!==null&&input.subtotal!=='';
  const subtotal=hasSubtotal?Number(input.subtotal):null;
  if(subtotal!==null&&(!Number.isFinite(subtotal)||subtotal<0)){
    return{status:'not_available',reason:'invalid_subtotal',countryCode};
  }

  if(countryCode===DOMESTIC_COMMERCE_BASELINE.countryCode){
    const settings=await loadShippingSettings();
    return buildThongthaiDomesticShippingRead(settings,subtotal);
  }

  const market=await readThongthaiMarketContext(countryCode,input.locale,input.env);
  if(market.status!=='ready')return{status:'not_available',reason:'market_not_ready',countryCode};
  if(!isMarketCapabilityLive(market.context,'thongthai')){
    return{status:'not_available',reason:'thongthai_market_capability_not_live',countryCode,market:market.context};
  }
  if(!isMarketCapabilityLive(market.context,'shipping')){
    return{status:'not_available',reason:'shipping_market_capability_not_live',countryCode,market:market.context};
  }
  if(!isWorldwideCapabilityEnabled('thongthaiWorldwide',input.env)){
    return{status:'not_available',reason:'worldwide_thongthai_gate_off',countryCode,market:market.context};
  }
  if(!isWorldwideCapabilityEnabled('globalShipping',input.env)){
    return{status:'not_available',reason:'worldwide_shipping_gate_off',countryCode,market:market.context};
  }
  // WW-6 safety contract: must not invent package weight or dimensions.
  return{
    status:'not_available',
    reason:'global_shipping_package_data_required',
    countryCode,
    market:market.context,
  };
}

export type ThongthaiWorldwideOfferItem={sku:string;quantity:number};

export function normalizeThongthaiWorldwideOfferItems(value:unknown):ThongthaiWorldwideOfferItem[]{
  if(!Array.isArray(value)||value.length<1||value.length>30)throw new Error('invalid_items');
  const merged=new Map<string,number>();
  for(const raw of value){
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('invalid_items');
    const item=raw as Record<string,unknown>;
    const sku=typeof item.sku==='string'?item.sku.trim().toUpperCase():'';
    const quantity=Number(item.quantity);
    if(!/^[A-Z0-9][A-Z0-9_-]{2,79}$/.test(sku)||!Number.isSafeInteger(quantity)||quantity<1||quantity>99){
      throw new Error('invalid_items');
    }
    const next=(merged.get(sku)??0)+quantity;
    if(next>99)throw new Error('invalid_items');
    merged.set(sku,next);
  }
  return[...merged.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([sku,quantity])=>({sku,quantity}));
}

export function buildThongthaiOfferParcels(
  items:ThongthaiWorldwideOfferItem[],
  products:OrderableProduct[],
  profiles:GlobalProductShippingProfile[],
){
  const profileByProduct=new Map(profiles.map(profile=>[profile.productId,profile]));
  const productBySku=new Map(products.map(product=>[product.sku.toUpperCase(),product]));
  const parcels:Array<{weightGrams:number;lengthMm:number;widthMm:number;heightMm:number}>=[];
  const missingProfiles:string[]=[];
  for(const item of items){
    const product=productBySku.get(item.sku);
    if(!product)continue;
    const profile=profileByProduct.get(product.productId);
    if(!profile){
      missingProfiles.push(item.sku);
      continue;
    }
    if(profile.originCountryCode!==DOMESTIC_COMMERCE_BASELINE.countryCode){
      missingProfiles.push(item.sku);
      continue;
    }
    for(let n=0;n<item.quantity;n+=1){
      parcels.push({
        weightGrams:profile.weightGrams,
        lengthMm:profile.lengthMm,
        widthMm:profile.widthMm,
        heightMm:profile.heightMm,
      });
    }
  }
  return{parcels,missingProfiles:[...new Set(missingProfiles)]};
}

export type ThongthaiWorldwideDeps={
  readMarket:typeof readThongthaiMarketContext;
  listProducts:typeof listOtopProducts;
  loadPrice:typeof loadExplicitProductPrice;
  loadProfiles:typeof loadGlobalProductShippingProfiles;
  createShippingQuote:typeof createGlobalShippingQuote;
  createCustomsSnapshot:typeof createCustomsComplianceSnapshot;
  loadPaymentMethod:typeof loadGlobalPaymentMethod;
  getGlobalStatus:typeof getGuestGlobalCommerceStatus;
};

const DEFAULT_DEPS:ThongthaiWorldwideDeps={
  readMarket:readThongthaiMarketContext,
  listProducts:listOtopProducts,
  loadPrice:loadExplicitProductPrice,
  loadProfiles:loadGlobalProductShippingProfiles,
  createShippingQuote:createGlobalShippingQuote,
  createCustomsSnapshot:createCustomsComplianceSnapshot,
  loadPaymentMethod:loadGlobalPaymentMethod,
  getGlobalStatus:getGuestGlobalCommerceStatus,
};

function toolIdempotencyKey(prefix:string,seed:string,payload:unknown):string{
  const digest=createHash('sha256').update(seed+'|'+JSON.stringify(payload),'utf8').digest('hex').slice(0,32);
  return `ww10:${prefix}:${digest}`;
}

export async function readThongthaiWorldwideOffer(input:{
  countryCode:unknown;
  items:unknown;
  locale?:unknown;
  serviceCode?:unknown;
  environment?:'live'|'test';
  idempotencySeed?:string;
  env?:WorldwideEnv;
},deps:ThongthaiWorldwideDeps=DEFAULT_DEPS){
  const countryCode=typeof input.countryCode==='string'?input.countryCode.trim().toUpperCase():'';
  if(!/^[A-Z]{2}$/.test(countryCode))return{status:'not_available' as const,reason:'invalid_country_code',countryCode};
  let items:ThongthaiWorldwideOfferItem[];
  try{items=normalizeThongthaiWorldwideOfferItems(input.items)}
  catch{return{status:'not_available' as const,reason:'invalid_items',countryCode}}

  const environment=input.environment??'live';
  const products=await deps.listProducts(environment);
  const productBySku=new Map(products.map(product=>[product.sku.toUpperCase(),product]));
  const missingSkus=items.filter(item=>!productBySku.has(item.sku)).map(item=>item.sku);
  if(missingSkus.length)return{status:'not_available' as const,reason:'product_not_available',countryCode,missingSkus};
  const stockShortages=items
    .filter(item=>(productBySku.get(item.sku)?.stock??0)<item.quantity)
    .map(item=>({sku:item.sku,requested:item.quantity,available:productBySku.get(item.sku)?.stock??0}));
  if(stockShortages.length)return{status:'not_available' as const,reason:'insufficient_stock',countryCode,stockShortages};

  if(countryCode===DOMESTIC_COMMERCE_BASELINE.countryCode){
    const subtotal=items.reduce((sum,item)=>sum+(productBySku.get(item.sku)!.price*item.quantity),0);
    const shipping=await readThongthaiShippingQuote({countryCode:'TH',subtotal,locale:input.locale,env:input.env});
    return{
      status:'ready' as const,
      scope:'domestic' as const,
      market:domesticContext(typeof input.locale==='string'?input.locale:null),
      items:items.map(item=>({
        sku:item.sku,
        name:productBySku.get(item.sku)!.name,
        quantity:item.quantity,
        unitPrice:productBySku.get(item.sku)!.price,
        currencyCode:'THB',
      })),
      subtotal,
      shipping,
      customs:{status:'not_applicable' as const},
      payment:{status:'domestic_payment_path' as const},
      checkoutReadiness:{status:'use_domestic_checkout' as const},
    };
  }

  const market=await deps.readMarket(countryCode,input.locale,input.env);
  if(market.status!=='ready')return{status:'not_available' as const,reason:'market_not_ready',countryCode,market};
  if(!isMarketCapabilityLive(market.context,'thongthai')){
    return{status:'not_available' as const,reason:'thongthai_market_capability_not_live',countryCode,market:market.context};
  }
  if(!isWorldwideCapabilityEnabled('thongthaiWorldwide',input.env)){
    return{status:'not_available' as const,reason:'worldwide_thongthai_gate_off',countryCode,market:market.context};
  }

  const requestedProducts=items.map(item=>productBySku.get(item.sku)!);
  const priceLoads=await Promise.all(requestedProducts.map(product=>deps.loadPrice({
    productId:product.productId,
    marketCode:market.context.marketCode,
    currencyCode:market.context.currencyCode,
    env:input.env,
  })));
  const priceFailures=priceLoads
    .map((result,index)=>({result,sku:items[index]!.sku}))
    .filter(row=>row.result.kind!=='ready');
  const pricing=priceFailures.length
    ?{status:'not_available' as const,reason:'explicit_market_price_not_ready',failures:priceFailures.map(row=>({sku:row.sku,kind:row.result.kind,reason:'reason' in row.result?row.result.reason:row.result.kind}))}
    :{
      status:'ready' as const,
      currencyCode:market.context.currencyCode,
      minorUnit:(priceLoads[0] as Extract<typeof priceLoads[number],{kind:'ready'}>).price.minorUnit,
      lines:items.map((item,index)=>{
        const price=(priceLoads[index] as Extract<typeof priceLoads[number],{kind:'ready'}>).price;
        return{sku:item.sku,name:requestedProducts[index]!.name,quantity:item.quantity,unitPriceMinor:price.amountMinor.toString(),priceRevisionId:price.id,priceSource:price.priceSource};
      }),
      subtotalMinor:items.reduce((sum,item,index)=>{
        const price=(priceLoads[index] as Extract<typeof priceLoads[number],{kind:'ready'}>).price;
        return sum+(price.amountMinor*BigInt(item.quantity));
      },0n).toString(),
    };

  const profilesLoad=await deps.loadProfiles({productIds:requestedProducts.map(product=>product.productId),env:input.env});
  let shipping:Record<string,unknown>;
  if(profilesLoad.kind!=='ready'){
    shipping={status:'not_available',reason:'worldwide_shipping_gate_off'};
  }else{
    const built=buildThongthaiOfferParcels(items,requestedProducts,profilesLoad.profiles);
    if(built.missingProfiles.length){
      shipping={status:'not_available',reason:'shipping_profile_required',missingSkus:built.missingProfiles};
    }else if(built.parcels.length>20){
      shipping={status:'not_available',reason:'parcel_count_exceeds_quote_limit',parcelCount:built.parcels.length};
    }else if(!isMarketCapabilityLive(market.context,'shipping')){
      shipping={status:'not_available',reason:'shipping_market_capability_not_live'};
    }else{
      const seed=input.idempotencySeed?.trim()||randomUUID();
      try{
        const quote=await deps.createShippingQuote({
          marketCode:market.context.marketCode,
          destinationCountryCode:market.context.countryCode,
          currencyCode:market.context.currencyCode,
          serviceCode:input.serviceCode,
          parcels:built.parcels,
          idempotencyKey:toolIdempotencyKey('shipping',seed,{countryCode,items,serviceCode:input.serviceCode??null}),
          environment,
          env:input.env,
        });
        shipping=quote.kind==='ready'
          ?{status:'ready',quote:quote.quote,dutiesTaxScope:'excluded'}
          :{status:'not_available',reason:'worldwide_shipping_gate_off'};
      }catch(error){
        shipping={status:'not_available',reason:'shipping_quote_unavailable',detail:error instanceof Error?error.message.slice(0,120):'unknown'};
      }
    }
  }

  let customs:Record<string,unknown>;
  if(!isMarketCapabilityLive(market.context,'customs')){
    customs={status:'not_available',reason:'customs_market_capability_not_live'};
  }else if(!isWorldwideCapabilityEnabled('customs',input.env)){
    customs={status:'not_available',reason:'worldwide_customs_gate_off'};
  }else{
    const seed=input.idempotencySeed?.trim()||randomUUID();
    try{
      const snapshot=await deps.createCustomsSnapshot({
        marketCode:market.context.marketCode,
        destinationCountryCode:market.context.countryCode,
        currencyCode:market.context.currencyCode,
        items:items.map((item,index)=>({productId:requestedProducts[index]!.productId,quantity:item.quantity})),
        idempotencyKey:toolIdempotencyKey('customs',seed,{countryCode,items}),
        environment,
        env:input.env,
      });
      customs=snapshot.kind==='ready'
        ?{status:'ready',snapshotId:snapshot.snapshotId,decision:snapshot.decision,dutyTaxStatus:snapshot.dutyTaxStatus,dutiesCalculated:false}
        :{status:'not_available',reason:'worldwide_customs_gate_off'};
    }catch(error){
      customs={status:'not_available',reason:'customs_snapshot_unavailable',detail:error instanceof Error?error.message.slice(0,120):'unknown'};
    }
  }

  let payment:Record<string,unknown>;
  try{
    const method=await deps.loadPaymentMethod({
      marketCode:market.context.marketCode,
      currencyCode:market.context.currencyCode,
      env:input.env,
    });
    payment=method.kind==='ready'
      ?{status:'ready',providerCode:method.provider.providerCode,paymentMethodCode:method.method.paymentMethodCode}
      :{status:'not_available',reason:'reason' in method?method.reason:method.kind};
  }catch(error){
    payment={status:'not_available',reason:'payment_method_unavailable',detail:error instanceof Error?error.message.slice(0,120):'unknown'};
  }

  const missingCheckoutCapabilities=internationalCheckoutMissingCapabilities(input.env);
  const checkoutReady=
    isMarketCapabilityLive(market.context,'checkout')
    &&pricing.status==='ready'
    &&shipping.status==='ready'
    &&customs.status==='ready'
    &&customs.decision==='eligible'
    &&payment.status==='ready'
    &&missingCheckoutCapabilities.length===0;

  const status=pricing.status==='ready'&&shipping.status==='ready'&&customs.status==='ready'&&payment.status==='ready'
    ?'ready' as const
    :'partial' as const;
  return{
    status,
    scope:'international' as const,
    market:market.context,
    items,
    pricing,
    shipping,
    customs,
    payment,
    checkoutReadiness:{
      status:checkoutReady?'ready' as const:'not_ready' as const,
      missingWorldwideCapabilities:missingCheckoutCapabilities,
      marketCheckoutCapability:market.context.capabilities.checkout,
      dutiesAndTaxesIncluded:false,
    },
  };
}

export async function readThongthaiGlobalCommerceStatus(input:{
  guestDbId:unknown;
  code?:unknown;
  environment?:'live'|'test';
  env?:WorldwideEnv;
},deps:ThongthaiWorldwideDeps=DEFAULT_DEPS){
  if(!isWorldwideCapabilityEnabled('thongthaiWorldwide',input.env)){
    return{status:'not_available' as const,reason:'worldwide_thongthai_gate_off'};
  }
  try{
    const result=await deps.getGlobalStatus({
      guestDbId:input.guestDbId,
      code:input.code,
      environment:input.environment??'live',
    });
    return result
      ?{status:'ready' as const,scope:'international' as const,...result}
      :{status:'not_found' as const};
  }catch(error){
    return{
      status:'not_available' as const,
      reason:error instanceof Error?error.message.split(':')[0]:'global_status_unavailable',
    };
  }
}

