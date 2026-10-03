import { isWorldwideCapabilityEnabled, type WorldwideEnv } from './_worldwide-foundation';
import {
  normalizePaymentCode,
  normalizePaymentCurrency,
  normalizePaymentIdempotencyKey,
  resolveGlobalPaymentMethod,
  type GlobalMarketPaymentMethod,
  type GlobalPaymentProvider,
  type PaymentMethodResolution,
} from './_global-payments';

const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type DbConfig={url:string;key:string};

function config():DbConfig|null{
  const runtime=(globalThis as typeof globalThis & {
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
  if(!c)throw new Error('global_payment_not_configured');
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
    throw new Error(`global_payment_db_${response.status}:${body.slice(0,240)}`);
  }
  return response;
}

export type GlobalPaymentMethodLoad=
  | {kind:'disabled'}
  | {kind:'not_available';reason:
      | 'invalid_market'
      | 'invalid_currency'
      | 'payments_capability_not_live'
      | 'market_currency_not_enabled'
      | PaymentMethodResolution extends {kind:'not_available';reason:infer R}?R&string:never
    }
  | {kind:'invalid';reason:'ambiguous_payment_method'}
  | {kind:'ready';provider:GlobalPaymentProvider;method:GlobalMarketPaymentMethod};

export async function loadGlobalPaymentMethod(input:{
  marketCode:unknown;
  currencyCode:unknown;
  requestedMethod?:unknown;
  env?:WorldwideEnv;
}):Promise<GlobalPaymentMethodLoad>{
  if(!isWorldwideCapabilityEnabled('globalPayments',input.env))return {kind:'disabled'};
  const marketCode=typeof input.marketCode==='string'?input.marketCode.trim().toUpperCase():'';
  if(!/^[A-Z0-9][A-Z0-9_-]{1,23}$/.test(marketCode))return {kind:'not_available',reason:'invalid_market'};
  const currencyCode=normalizePaymentCurrency(input.currencyCode);
  if(!currencyCode)return {kind:'not_available',reason:'invalid_currency'};
  const requestedMethod=input.requestedMethod===undefined||input.requestedMethod===null
    ? null
    : normalizePaymentCode(input.requestedMethod);
  if(input.requestedMethod!==undefined&&input.requestedMethod!==null&&!requestedMethod){
    return {kind:'not_available',reason:'payment_method_not_configured'};
  }

  const [capabilityRes,currencyRes,methodsRes]=await Promise.all([
    dbFetch(
      'commerce_market_capabilities?market_code=eq.'+encodeURIComponent(marketCode)
      +'&capability=eq.payments&state=eq.live&select=market_code&limit=1'
    ),
    dbFetch(
      'commerce_market_currencies?market_code=eq.'+encodeURIComponent(marketCode)
      +'&currency_code=eq.'+encodeURIComponent(currencyCode)
      +'&enabled=eq.true&select=market_code,currency_code&limit=1'
    ),
    dbFetch(
      'commerce_market_payment_methods?market_code=eq.'+encodeURIComponent(marketCode)
      +'&currency_code=eq.'+encodeURIComponent(currencyCode)
      +'&enabled=eq.true'
      +(requestedMethod?'&payment_method_code=eq.'+encodeURIComponent(requestedMethod):'')
      +'&select=market_code,provider_code,currency_code,payment_method_code,execution_mode,status,enabled,priority'
      +'&order=priority.asc'
    ),
  ]);

  const [capabilities,currencies,methodRows]=await Promise.all([
    capabilityRes.json() as Promise<Array<{market_code:string}>>,
    currencyRes.json() as Promise<Array<{market_code:string;currency_code:string}>>,
    methodsRes.json() as Promise<Array<{
      market_code:string;provider_code:string;currency_code:string;payment_method_code:string;
      execution_mode:GlobalMarketPaymentMethod['executionMode'];
      status:GlobalMarketPaymentMethod['status'];enabled:boolean;priority:number;
    }>>,
  ]);
  if(!capabilities[0])return {kind:'not_available',reason:'payments_capability_not_live'};
  if(!currencies[0])return {kind:'not_available',reason:'market_currency_not_enabled'};

  const providerCodes=[...new Set(methodRows.map(row=>row.provider_code))];
  const providers:GlobalPaymentProvider[]=[];
  if(providerCodes.length){
    const providerRes=await dbFetch(
      'commerce_payment_providers?provider_code=in.('
      +providerCodes.map(code=>encodeURIComponent(code)).join(',')
      +')&select=provider_code,adapter_key,status,active'
    );
    const rows=await providerRes.json() as Array<{
      provider_code:string;adapter_key:string;status:GlobalPaymentProvider['status'];active:boolean;
    }>;
    providers.push(...rows.map(row=>({
      providerCode:row.provider_code,
      adapterKey:row.adapter_key,
      status:row.status,
      active:row.active,
    })));
  }

  const methods=methodRows.map(row=>({
    marketCode:row.market_code,
    providerCode:row.provider_code,
    currencyCode:row.currency_code,
    paymentMethodCode:row.payment_method_code,
    executionMode:row.execution_mode,
    status:row.status,
    enabled:row.enabled,
    priority:Number(row.priority),
  }));

  return resolveGlobalPaymentMethod({
    marketCode,
    currencyCode,
    requestedMethod,
    providers,
    methods,
  });
}

export type CreateGlobalPaymentIntentInput={
  sourceEntityType:string;
  sourceEntityId:string;
  sourceEntityCode:string;
  customerId?:string|null;
  marketCode:string;
  currencyCode:string;
  amountMinor:bigint;
  providerCode:string;
  paymentMethodCode:string;
  idempotencyKey:string;
  environment:'live'|'test';
};

export async function createGlobalPaymentIntent(
  input:CreateGlobalPaymentIntentInput,
  env?:WorldwideEnv,
):Promise<{kind:'disabled'}|{kind:'created';intentId:string;intentCode:string;status:string}>{
  if(!isWorldwideCapabilityEnabled('globalPayments',env))return {kind:'disabled'};
  if(!UUID_RE.test(input.sourceEntityId))throw new Error('invalid_source_entity_id');
  if(input.customerId&&!UUID_RE.test(input.customerId))throw new Error('invalid_customer_id');
  const idempotencyKey=normalizePaymentIdempotencyKey(input.idempotencyKey);
  if(!idempotencyKey)throw new Error('invalid_payment_idempotency_key');
  const currencyCode=normalizePaymentCurrency(input.currencyCode);
  if(!currencyCode)throw new Error('invalid_currency');
  if(input.amountMinor<=0n||input.amountMinor>BigInt(Number.MAX_SAFE_INTEGER)){
    throw new Error('invalid_payment_amount_minor');
  }

  const response=await dbFetch('rpc/create_commerce_payment_intent_v1',{
    method:'POST',
    headers:{Prefer:'return=representation'},
    body:JSON.stringify({
      p_source_entity_type:input.sourceEntityType,
      p_source_entity_id:input.sourceEntityId,
      p_source_entity_code:input.sourceEntityCode,
      p_customer_id:input.customerId??null,
      p_market_code:input.marketCode,
      p_currency_code:currencyCode,
      p_amount_minor:input.amountMinor.toString(),
      p_provider_code:input.providerCode,
      p_payment_method_code:input.paymentMethodCode,
      p_idempotency_key:idempotencyKey,
      p_environment:input.environment,
    }),
  });
  const rows=await response.json() as Array<{intent_id:string;intent_code:string;status:string}>;
  const row=rows[0];
  if(!row)throw new Error('global_payment_intent_not_created');
  return {kind:'created',intentId:row.intent_id,intentCode:row.intent_code,status:row.status};
}
