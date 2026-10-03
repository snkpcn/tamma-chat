import {assertInternationalCheckoutEnabled,normalizeCheckoutCode,normalizeInternationalCheckoutItems} from './_international-checkout';
import type {WorldwideEnv} from './_worldwide-foundation';

type DbConfig={url:string;key:string};
function config():DbConfig|null{
  const runtime=(globalThis as typeof globalThis&{Netlify?:{env?:{get?:(k:string)=>unknown}}}).Netlify?.env;
  const get=(k:string)=>{const v=runtime?.get?.(k);return typeof v==='string'?v:undefined};
  const url=get('SUPABASE_URL'),key=get('SUPABASE_SERVICE_ROLE_KEY');
  return url&&key?{url:url.replace(/\/$/,''),key}:null;
}
async function dbFetch(path:string,init:RequestInit={}){
  const c=config(); if(!c)throw new Error('international_checkout_not_configured');
  const r=await fetch(`${c.url}/rest/v1/${path}`,{...init,headers:{apikey:c.key,Authorization:`Bearer ${c.key}`,'Content-Type':'application/json',...(init.headers??{})}});
  if(!r.ok){const b=await r.text().catch(()=>'');throw new Error(`international_checkout_db_${r.status}:${b.slice(0,300)}`)}
  return r;
}

export async function checkoutInternationalOtopOrder(input:{
  authUserId:string;
  items:unknown;
  shippingAddressId:unknown;
  shippingQuoteId:unknown;
  customsSnapshotId:unknown;
  paymentMethodCode:unknown;
  checkoutIdempotencyKey:unknown;
  paymentIdempotencyKey:unknown;
  dutiesAcknowledged:unknown;
  customerNote?:unknown;
  environment?:'live'|'test';
  env?:WorldwideEnv;
}){
  assertInternationalCheckoutEnabled(input.env);
  const items=normalizeInternationalCheckoutItems(input.items);
  const uuid=(value:unknown,name:string)=>{
    const text=typeof value==='string'?value.trim():'';
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text))throw new Error(name);
    return text;
  };
  const paymentMethod=normalizeCheckoutCode(input.paymentMethodCode,64).toLowerCase();
  const checkoutKey=normalizeCheckoutCode(input.checkoutIdempotencyKey,120);
  const paymentKey=normalizeCheckoutCode(input.paymentIdempotencyKey,120);
  if(checkoutKey.length<16||paymentKey.length<16)throw new Error('idempotency_key_required');
  if(input.dutiesAcknowledged!==true)throw new Error('duties_acknowledgement_required');
  const customerNote=typeof input.customerNote==='string'?input.customerNote.trim().slice(0,1000):null;
  const response=await dbFetch('rpc/create_member_otop_order_v2',{
    method:'POST',headers:{Prefer:'return=representation'},
    body:JSON.stringify({
      p_auth_user_id:uuid(input.authUserId,'authentication_required'),
      p_items:items,
      p_shipping_address_id:uuid(input.shippingAddressId,'shipping_address_required'),
      p_shipping_quote_id:uuid(input.shippingQuoteId,'shipping_quote_required'),
      p_customs_snapshot_id:uuid(input.customsSnapshotId,'customs_snapshot_required'),
      p_payment_method_code:paymentMethod,
      p_customer_note:customerNote,
      p_checkout_idempotency_key:checkoutKey,
      p_payment_idempotency_key:paymentKey,
      p_duties_acknowledged:true,
      p_environment:input.environment??'live',
    }),
  });
  const rows=await response.json() as Array<{
    order_id:string;order_code:string;market_code:string;currency_code:string;
    subtotal_minor:string|number;shipping_fee_minor:string|number;total_minor:string|number;
    payment_intent_id:string;payment_intent_code:string;shipping_status:string;
  }>;
  const row=rows[0]; if(!row)throw new Error('international_checkout_not_created');
  return{
    orderId:row.order_id,orderCode:row.order_code,marketCode:row.market_code,currencyCode:row.currency_code,
    subtotalMinor:String(row.subtotal_minor),shippingFeeMinor:String(row.shipping_fee_minor),totalMinor:String(row.total_minor),
    paymentIntentId:row.payment_intent_id,paymentIntentCode:row.payment_intent_code,shippingStatus:row.shipping_status,
  };
}
