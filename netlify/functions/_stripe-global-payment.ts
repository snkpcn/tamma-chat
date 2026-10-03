import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {
  linkGlobalPaymentProviderIntent,
  loadGlobalPaymentIntentById,
  loadGlobalPaymentIntentByProviderObject,
  loadMemberGlobalPaymentIntent,
  recordAndApplyGlobalPaymentEvent,
  type MemberGlobalPaymentIntent,
  loadGlobalPaymentMethod,
} from './_global-payments-db';

export const STRIPE_GLOBAL_PROVIDER_CODE='stripe_th';
export const STRIPE_GLOBAL_ADAPTER_KEY='stripe_payment_intents_v1';
const STRIPE_API_BASE='https://api.stripe.com/v1';

type RuntimeEnv={get?:(key:string)=>unknown};
function envValue(name:string):string|undefined{
  const runtime=(globalThis as typeof globalThis&{Netlify?:{env?:RuntimeEnv}}).Netlify?.env;
  const value=runtime?.get?.(name);
  return typeof value==='string'&&value.trim()?value.trim():undefined;
}

export function stripeGlobalReadiness(){
  const secretKey=envValue('STRIPE_SECRET_KEY');
  const webhookSecret=envValue('STRIPE_WEBHOOK_SECRET');
  return{
    ready:Boolean(secretKey&&webhookSecret),
    missing:[
      ...(!secretKey?['STRIPE_SECRET_KEY']:[]),
      ...(!webhookSecret?['STRIPE_WEBHOOK_SECRET']:[]),
    ],
  };
}

function stripeSecretKey():string{
  const value=envValue('STRIPE_SECRET_KEY');
  if(!value)throw new Error('stripe_secret_key_not_configured');
  return value;
}

function stripeWebhookSecret():string{
  const value=envValue('STRIPE_WEBHOOK_SECRET');
  if(!value)throw new Error('stripe_webhook_secret_not_configured');
  return value;
}

async function stripeFetch(path:string,init:RequestInit={}):Promise<Record<string,unknown>>{
  const response=await fetch(STRIPE_API_BASE+path,{
    ...init,
    headers:{
      Authorization:`Bearer ${stripeSecretKey()}`,
      ...(init.headers??{}),
    },
  });
  const body=await response.json().catch(()=>({})) as Record<string,unknown>;
  if(!response.ok){
    const message=body?.error&&typeof body.error==='object'
      ?String((body.error as Record<string,unknown>).code??(body.error as Record<string,unknown>).type??'stripe_api_error')
      :'stripe_api_error';
    throw new Error(message);
  }
  return body;
}

function toForm(input:Record<string,string>):URLSearchParams{
  const form=new URLSearchParams();
  for(const [key,value] of Object.entries(input))form.set(key,value);
  return form;
}

function assertStripeIntentMatchesInternal(
  provider:Record<string,unknown>,
  internal:MemberGlobalPaymentIntent,
):void{
  if(String(provider.id??'')!==internal.providerIntentId&&internal.providerIntentId){
    throw new Error('stripe_provider_intent_mismatch');
  }
  if(String(provider.currency??'').toUpperCase()!==internal.currencyCode){
    throw new Error('stripe_currency_mismatch');
  }
  if(String(provider.amount??'')!==internal.amountMinor){
    throw new Error('stripe_amount_mismatch');
  }
  const metadata=provider.metadata&&typeof provider.metadata==='object'
    ?provider.metadata as Record<string,unknown>:{};
  if(metadata.tamma_intent_id&&String(metadata.tamma_intent_id)!==internal.intentId){
    throw new Error('stripe_metadata_intent_mismatch');
  }
}

export async function createStripePaymentSessionForMember(input:{
  authUserId:unknown;
  intentCode:unknown;
}){
  const internal=await loadMemberGlobalPaymentIntent({
    authUserId:input.authUserId,
    intentCode:input.intentCode,
    providerCode:STRIPE_GLOBAL_PROVIDER_CODE,
  });
  if(!internal)throw new Error('payment_intent_not_found');
  if(['captured','refunded','cancelled','failed'].includes(internal.status)){
    throw new Error('payment_intent_not_payable');
  }
  const readiness=await loadGlobalPaymentMethod({
    marketCode:internal.marketCode,
    currencyCode:internal.currencyCode,
    requestedMethod:internal.paymentMethodCode,
  });
  if(readiness.kind!=='ready'||readiness.provider.providerCode!==STRIPE_GLOBAL_PROVIDER_CODE){
    throw new Error('stripe_payment_method_not_live');
  }

  let provider:Record<string,unknown>;
  if(internal.providerIntentId){
    provider=await stripeFetch('/payment_intents/'+encodeURIComponent(internal.providerIntentId));
    assertStripeIntentMatchesInternal(provider,internal);
  }else{
    const form=toForm({
      amount:internal.amountMinor,
      currency:internal.currencyCode.toLowerCase(),
      'payment_method_types[]':'card',
      'metadata[tamma_intent_id]':internal.intentId,
      'metadata[tamma_intent_code]':internal.intentCode,
      'metadata[tamma_order_code]':internal.sourceEntityCode,
      description:`Tamma-Chat ${internal.sourceEntityCode}`,
    });
    provider=await stripeFetch('/payment_intents',{
      method:'POST',
      headers:{
        'Content-Type':'application/x-www-form-urlencoded',
        'Idempotency-Key':`tamma-${internal.intentId}`,
      },
      body:form.toString(),
    });
    const providerIntentId=String(provider.id??'');
    if(!/^pi_[A-Za-z0-9_]+$/.test(providerIntentId))throw new Error('stripe_invalid_payment_intent');
    await linkGlobalPaymentProviderIntent({intentId:internal.intentId,providerIntentId});
    assertStripeIntentMatchesInternal(provider,{...internal,providerIntentId});
  }

  const clientSecret=typeof provider.client_secret==='string'?provider.client_secret:null;
  if(!clientSecret)throw new Error('stripe_client_secret_unavailable');
  return{
    intentCode:internal.intentCode,
    provider:'stripe',
    providerIntentId:String(provider.id),
    currencyCode:internal.currencyCode,
    amountMinor:internal.amountMinor,
    status:String(provider.status??'requires_payment_method'),
    clientSecret,
  };
}

export function verifyStripeWebhookSignature(
  rawBody:string,
  signatureHeader:string,
  secret:string,
  nowMs=Date.now(),
  toleranceSeconds=300,
):boolean{
  if(!rawBody||!signatureHeader||!secret)return false;
  const parts=signatureHeader.split(',').map(part=>part.trim());
  const timestampText=parts.find(part=>part.startsWith('t='))?.slice(2);
  const signatures=parts.filter(part=>part.startsWith('v1=')).map(part=>part.slice(3));
  const timestamp=Number(timestampText);
  if(!Number.isSafeInteger(timestamp)||signatures.length<1)return false;
  if(Math.abs(Math.floor(nowMs/1000)-timestamp)>toleranceSeconds)return false;
  const expected=createHmac('sha256',secret).update(`${timestamp}.${rawBody}`,'utf8').digest();
  return signatures.some(signature=>{
    if(!/^[a-f0-9]{64}$/i.test(signature))return false;
    const actual=Buffer.from(signature,'hex');
    return actual.length===expected.length&&timingSafeEqual(actual,expected);
  });
}

type StripeNormalizedEvent={
  providerEventId:string;
  eventType:string;
  providerObjectId:string;
  internalIntentId:string|null;
  currencyCode:string|null;
  amountMinor:bigint|null;
  moneySemantics:'none'|'intent_total'|'refund_delta';
  newStatus:'processing'|'captured'|'failed'|'cancelled'|'partially_refunded'|'refunded'|null;
};

function positiveBigInt(value:unknown):bigint|null{
  if(typeof value==='number'&&Number.isSafeInteger(value)&&value>0)return BigInt(value);
  if(typeof value==='string'&&/^\d+$/.test(value)&&BigInt(value)>0n)return BigInt(value);
  return null;
}

export function normalizeStripeWebhookEvent(event:unknown):StripeNormalizedEvent|null{
  if(!event||typeof event!=='object')return null;
  const root=event as Record<string,unknown>;
  const id=typeof root.id==='string'?root.id:'';
  const type=typeof root.type==='string'?root.type:'';
  const data=root.data&&typeof root.data==='object'?root.data as Record<string,unknown>:{};
  const object=data.object&&typeof data.object==='object'?data.object as Record<string,unknown>:{};
  if(!id||!type||!object.id)return null;
  const metadata=object.metadata&&typeof object.metadata==='object'?object.metadata as Record<string,unknown>:{};
  const internalIntentId=typeof metadata.tamma_intent_id==='string'?metadata.tamma_intent_id:null;

  if(type==='payment_intent.succeeded'){
    return{
      providerEventId:id,eventType:type,providerObjectId:String(object.id),internalIntentId,
      currencyCode:String(object.currency??'').toUpperCase(),
      amountMinor:positiveBigInt(object.amount_received)??positiveBigInt(object.amount),
      moneySemantics:'intent_total',newStatus:'captured',
    };
  }
  if(type==='payment_intent.processing'){
    return{providerEventId:id,eventType:type,providerObjectId:String(object.id),internalIntentId,currencyCode:null,amountMinor:null,moneySemantics:'none',newStatus:'processing'};
  }
  if(type==='payment_intent.payment_failed'){
    return{providerEventId:id,eventType:type,providerObjectId:String(object.id),internalIntentId,currencyCode:null,amountMinor:null,moneySemantics:'none',newStatus:'failed'};
  }
  if(type==='payment_intent.canceled'){
    return{providerEventId:id,eventType:type,providerObjectId:String(object.id),internalIntentId,currencyCode:null,amountMinor:null,moneySemantics:'none',newStatus:'cancelled'};
  }
  if(type==='refund.created'){
    const providerObjectId=typeof object.payment_intent==='string'?object.payment_intent:'';
    const amount=positiveBigInt(object.amount);
    const currency=typeof object.currency==='string'?object.currency.toUpperCase():'';
    if(!providerObjectId||!amount||!/^[A-Z]{3}$/.test(currency))return null;
    return{
      providerEventId:id,eventType:type,providerObjectId,internalIntentId:null,
      currencyCode:currency,amountMinor:amount,moneySemantics:'refund_delta',newStatus:null,
    };
  }
  return null;
}

async function resolveStripeInternalIntent(event:StripeNormalizedEvent):Promise<MemberGlobalPaymentIntent|null>{
  if(event.internalIntentId){
    const byId=await loadGlobalPaymentIntentById(event.internalIntentId);
    if(byId&&byId.providerCode===STRIPE_GLOBAL_PROVIDER_CODE)return byId;
  }
  return await loadGlobalPaymentIntentByProviderObject({
    providerCode:STRIPE_GLOBAL_PROVIDER_CODE,
    providerIntentId:event.providerObjectId,
  });
}

export async function processStripeWebhook(input:{
  rawBody:string;
  signatureHeader:string;
  nowMs?:number;
}){
  const secret=stripeWebhookSecret();
  if(!verifyStripeWebhookSignature(input.rawBody,input.signatureHeader,secret,input.nowMs)){
    throw new Error('stripe_webhook_signature_invalid');
  }
  let parsed:unknown;
  try{parsed=JSON.parse(input.rawBody)}catch{throw new Error('stripe_webhook_json_invalid')}
  const normalized=normalizeStripeWebhookEvent(parsed);
  if(!normalized)return{handled:false,reason:'event_not_used' as const};

  const intent=await resolveStripeInternalIntent(normalized);
  if(!intent)throw new Error('stripe_internal_intent_not_found');
  if(intent.providerCode!==STRIPE_GLOBAL_PROVIDER_CODE)throw new Error('stripe_internal_provider_mismatch');
  if(intent.providerIntentId&&intent.providerIntentId!==normalized.providerObjectId){
    throw new Error('stripe_provider_intent_mismatch');
  }

  let newStatus=normalized.newStatus;
  if(normalized.moneySemantics==='refund_delta'){
    const captured=BigInt(intent.capturedAmountMinor);
    const refunded=BigInt(intent.refundedAmountMinor);
    const delta=normalized.amountMinor??0n;
    if(captured<=0n||delta<=0n||refunded+delta>captured)throw new Error('stripe_refund_amount_invalid');
    newStatus=refunded+delta===captured?'refunded':'partially_refunded';
  }
  if(!newStatus)throw new Error('stripe_event_status_unresolved');

  const payloadSha256=createHash('sha256').update(input.rawBody,'utf8').digest('hex');
  const applied=await recordAndApplyGlobalPaymentEvent({
    providerCode:STRIPE_GLOBAL_PROVIDER_CODE,
    providerEventId:normalized.providerEventId,
    eventType:normalized.eventType,
    providerObjectId:normalized.providerObjectId,
    currencyCode:normalized.currencyCode,
    amountMinor:normalized.amountMinor,
    moneySemantics:normalized.moneySemantics,
    signatureVerified:true,
    payloadSha256,
    intentId:intent.intentId,
    newStatus,
    metadata:{source:'stripe_webhook'},
  });
  return{handled:true,...applied};
}
