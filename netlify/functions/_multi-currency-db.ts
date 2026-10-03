import { isWorldwideCapabilityEnabled, type WorldwideEnv } from './_worldwide-foundation';
import {worldwideDbFetch} from './_worldwide-db-client';
import { normalizeCurrencyCode } from './_worldwide-data-core';
import {
  resolveExplicitProductPrice,
  type ExplicitProductPrice,
  type PriceResolution,
} from './_multi-currency';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function dbFetch(path:string):Promise<Response>{
  return worldwideDbFetch(path,{}, {
    consistency:'strong',
    operation:'multi_currency_price_truth',
  });
}

export type MultiCurrencyPriceLoad =
  | { kind:'disabled' }
  | { kind:'not_available'; reason:
      | 'invalid_product_id'
      | 'invalid_currency'
      | 'market_currency_not_enabled'
      | 'pricing_capability_not_live'
      | 'currency_inactive'
      | 'price_not_configured'
      | 'price_not_current'
    }
  | { kind:'invalid'; reason:'ambiguous_active_price' }
  | { kind:'ready'; price:ExplicitProductPrice };

export async function loadExplicitProductPrice(input:{
  productId:unknown;
  marketCode:unknown;
  currencyCode:unknown;
  env?:WorldwideEnv;
}):Promise<MultiCurrencyPriceLoad>{
  if(!isWorldwideCapabilityEnabled('multiCurrency',input.env)) return {kind:'disabled'};
  const productId=typeof input.productId==='string'&&UUID_RE.test(input.productId)?input.productId:null;
  if(!productId)return {kind:'not_available',reason:'invalid_product_id'};
  const marketCode=typeof input.marketCode==='string'?input.marketCode.trim().toUpperCase():'';
  const currencyCode=normalizeCurrencyCode(input.currencyCode);
  if(!currencyCode)return {kind:'not_available',reason:'invalid_currency'};

  const [marketCurrencyRes,capabilityRes,currencyRes,priceRes]=await Promise.all([
    dbFetch(
      'commerce_market_currencies?market_code=eq.'+encodeURIComponent(marketCode)
      +'&currency_code=eq.'+encodeURIComponent(currencyCode)
      +'&enabled=eq.true&select=market_code,currency_code&limit=1'
    ),
    dbFetch(
      'commerce_market_capabilities?market_code=eq.'+encodeURIComponent(marketCode)
      +'&capability=eq.pricing&state=eq.live&select=market_code&limit=1'
    ),
    dbFetch(
      'commerce_currencies?currency_code=eq.'+encodeURIComponent(currencyCode)
      +'&active=eq.true&select=currency_code,minor_unit&limit=1'
    ),
    dbFetch(
      'commerce_product_prices?product_id=eq.'+encodeURIComponent(productId)
      +'&currency_code=eq.'+encodeURIComponent(currencyCode)
      +'&active=eq.true'
      +'&select=id,product_id,currency_code,amount_minor,price_source,valid_from,valid_until,active'
      +'&order=valid_from.desc'
    ),
  ]);

  const [marketCurrencies,capabilities,currencies,prices]=await Promise.all([
    marketCurrencyRes.json() as Promise<Array<{market_code:string;currency_code:string}>>,
    capabilityRes.json() as Promise<Array<{market_code:string}>>,
    currencyRes.json() as Promise<Array<{currency_code:string;minor_unit:number}>>,
    priceRes.json() as Promise<Array<{
      id:string;product_id:string;currency_code:string;amount_minor:number|string;
      price_source:ExplicitProductPrice['priceSource'];valid_from:string;valid_until:string|null;active:boolean;
    }>>,
  ]);
  if(!marketCurrencies[0])return {kind:'not_available',reason:'market_currency_not_enabled'};
  if(!capabilities[0])return {kind:'not_available',reason:'pricing_capability_not_live'};
  const currency=currencies[0];
  if(!currency)return {kind:'not_available',reason:'currency_inactive'};

  const resolved=resolveExplicitProductPrice(currencyCode,prices.map(row=>{
    const amountMinor=typeof row.amount_minor==='number'
      ? (Number.isSafeInteger(row.amount_minor)?BigInt(row.amount_minor):null)
      : /^\d+$/.test(String(row.amount_minor))?BigInt(String(row.amount_minor)):null;
    if(amountMinor===null)throw new Error('multi_currency_amount_out_of_range');
    return {
    id:row.id,
    productId:row.product_id,
    currencyCode:row.currency_code,
    amountMinor,
    minorUnit:Number(currency.minor_unit),
    priceSource:row.price_source,
    validFrom:row.valid_from,
    validUntil:row.valid_until,
    active:row.active,
  };
  }));

  return resolved;
}
