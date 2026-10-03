import {isWorldwideCapabilityEnabled,type WorldwideCapability,type WorldwideEnv} from './_worldwide-foundation';

export const WW8_CHECKOUT_VERSION='ww8-international-checkout-2026-10-03';

export type InternationalCheckoutItem={sku:string;quantity:number};

const SKU_RE=/^[A-Z0-9][A-Z0-9_-]{2,79}$/;

export function normalizeInternationalCheckoutItems(value:unknown):InternationalCheckoutItem[]{
  if(!Array.isArray(value)||value.length<1||value.length>30)throw new Error('invalid_items');
  const merged=new Map<string,number>();
  for(const raw of value){
    if(!raw||typeof raw!=='object')throw new Error('invalid_items');
    const item=raw as Record<string,unknown>;
    const sku=typeof item.sku==='string'?item.sku.trim().toUpperCase():'';
    const quantity=Number(item.quantity);
    if(!SKU_RE.test(sku)||!Number.isSafeInteger(quantity)||quantity<1||quantity>99){
      throw new Error('invalid_items');
    }
    const next=(merged.get(sku)??0)+quantity;
    if(next>99)throw new Error('invalid_items');
    merged.set(sku,next);
  }
  return [...merged.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([sku,quantity])=>({sku,quantity}));
}

const REQUIRED_CAPABILITIES:WorldwideCapability[]=[
  'addressV2','multiCurrency','globalPayments','globalShipping','customs','checkout',
];

export function internationalCheckoutMissingCapabilities(env?:WorldwideEnv):WorldwideCapability[]{
  return REQUIRED_CAPABILITIES.filter(capability=>!isWorldwideCapabilityEnabled(capability,env));
}

export function assertInternationalCheckoutEnabled(env?:WorldwideEnv):void{
  const missing=internationalCheckoutMissingCapabilities(env);
  if(missing.length)throw new Error('international_checkout_not_enabled:'+missing.join(','));
}

export function normalizeCheckoutCode(value:unknown,max=120):string{
  if(typeof value!=='string')throw new Error('invalid_checkout_code');
  const text=value.trim();
  if(!text||text.length>max||!/^[A-Za-z0-9][A-Za-z0-9:_-]*$/.test(text))throw new Error('invalid_checkout_code');
  return text;
}
