import { isWorldwideCapabilityEnabled, type WorldwideEnv } from './_worldwide-foundation';
import {worldwideDbFetch} from './_worldwide-db-client';
import {
  normalizePaymentCode,
  normalizePaymentCurrency,
  normalizePaymentIdempotencyKey,
  resolveGlobalPaymentMethod,
  type GlobalMarketPaymentMethod,
  type GlobalPaymentProvider,
} from './_global-payments';

const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function dbFetch(path:string,init:RequestInit={}):Promise<Response>{
  return worldwideDbFetch(path,init,{
    consistency:'strong',
    operation:'global_payment_truth',
  });
}

export type GlobalPaymentMethodLoad=
  | {kind:'disabled'}
  | {kind:'not_available';reason:
      | 'invalid_market'
      | 'invalid_currency'
      | 'payments_capability_not_live'
      | 'market_currency_not_enabled'
      | 'payment_method_not_configured'
      | 'provider_not_live'
      | 'method_not_live'
      | 'legacy_execution_mode'
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


export type MemberGlobalPaymentIntent={
  intentId:string;
  intentCode:string;
  sourceEntityId:string;
  sourceEntityCode:string;
  customerId:string;
  marketCode:string;
  currencyCode:string;
  amountMinor:string;
  capturedAmountMinor:string;
  refundedAmountMinor:string;
  providerCode:string;
  paymentMethodCode:string;
  status:string;
  providerIntentId:string|null;
  idempotencyKey:string;
  environment:'live'|'test';
};

function mapGlobalPaymentIntentRow(row:Record<string,unknown>):MemberGlobalPaymentIntent{
  return{
    intentId:String(row.id),
    intentCode:String(row.intent_code),
    sourceEntityId:String(row.source_entity_id),
    sourceEntityCode:String(row.source_entity_code),
    customerId:String(row.customer_id),
    marketCode:String(row.market_code),
    currencyCode:String(row.currency_code),
    amountMinor:String(row.amount_minor),
    capturedAmountMinor:String(row.captured_amount_minor),
    refundedAmountMinor:String(row.refunded_amount_minor),
    providerCode:String(row.provider_code),
    paymentMethodCode:String(row.payment_method_code),
    status:String(row.status),
    providerIntentId:row.provider_intent_id?String(row.provider_intent_id):null,
    idempotencyKey:String(row.idempotency_key),
    environment:String(row.environment)==='test'?'test':'live',
  };
}

const PAYMENT_INTENT_SELECT=[
  'id','intent_code','source_entity_id','source_entity_code','customer_id',
  'market_code','currency_code','amount_minor','captured_amount_minor','refunded_amount_minor',
  'provider_code','payment_method_code','status','provider_intent_id','idempotency_key','environment',
].join(',');

export async function loadMemberGlobalPaymentIntent(input:{
  authUserId:unknown;
  intentCode:unknown;
  providerCode?:unknown;
}):Promise<MemberGlobalPaymentIntent|null>{
  const authUserId=typeof input.authUserId==='string'?input.authUserId.trim():'';
  if(!UUID_RE.test(authUserId))throw new Error('authentication_required');
  const intentCode=typeof input.intentCode==='string'?input.intentCode.trim().toUpperCase():'';
  if(!/^PI-[A-Z0-9-]{6,80}$/.test(intentCode))throw new Error('invalid_payment_intent_code');
  const providerCode=input.providerCode==null?null:normalizePaymentCode(input.providerCode);
  if(input.providerCode!=null&&!providerCode)throw new Error('invalid_payment_provider');

  const accountRes=await dbFetch(
    'customer_accounts?auth_user_id=eq.'+encodeURIComponent(authUserId)
    +'&member_status=eq.member&select=id&limit=1'
  );
  const accounts=await accountRes.json() as Array<{id:string}>;
  const customerId=accounts[0]?.id;
  if(!customerId)throw new Error('member_profile_required');

  const response=await dbFetch(
    'commerce_payment_intents?intent_code=eq.'+encodeURIComponent(intentCode)
    +'&customer_id=eq.'+encodeURIComponent(customerId)
    +'&source_entity_type=eq.otop_order'
    +(providerCode?'&provider_code=eq.'+encodeURIComponent(providerCode):'')
    +'&select='+PAYMENT_INTENT_SELECT+'&limit=1'
  );
  const rows=await response.json() as Array<Record<string,unknown>>;
  return rows[0]?mapGlobalPaymentIntentRow(rows[0]):null;
}

export async function loadGlobalPaymentIntentById(intentId:unknown):Promise<MemberGlobalPaymentIntent|null>{
  const id=typeof intentId==='string'?intentId.trim():'';
  if(!UUID_RE.test(id))throw new Error('invalid_payment_intent_id');
  const response=await dbFetch(
    'commerce_payment_intents?id=eq.'+encodeURIComponent(id)
    +'&select='+PAYMENT_INTENT_SELECT+'&limit=1'
  );
  const rows=await response.json() as Array<Record<string,unknown>>;
  return rows[0]?mapGlobalPaymentIntentRow(rows[0]):null;
}

export async function loadGlobalPaymentIntentByProviderObject(input:{
  providerCode:unknown;
  providerIntentId:unknown;
}):Promise<MemberGlobalPaymentIntent|null>{
  const providerCode=normalizePaymentCode(input.providerCode);
  const providerIntentId=typeof input.providerIntentId==='string'?input.providerIntentId.trim():'';
  if(!providerCode||!providerIntentId||providerIntentId.length>240)throw new Error('invalid_provider_payment_reference');
  const response=await dbFetch(
    'commerce_payment_intents?provider_code=eq.'+encodeURIComponent(providerCode)
    +'&provider_intent_id=eq.'+encodeURIComponent(providerIntentId)
    +'&select='+PAYMENT_INTENT_SELECT+'&limit=1'
  );
  const rows=await response.json() as Array<Record<string,unknown>>;
  return rows[0]?mapGlobalPaymentIntentRow(rows[0]):null;
}

export async function linkGlobalPaymentProviderIntent(input:{
  intentId:unknown;
  providerIntentId:unknown;
}):Promise<MemberGlobalPaymentIntent>{
  const intentId=typeof input.intentId==='string'?input.intentId.trim():'';
  const providerIntentId=typeof input.providerIntentId==='string'?input.providerIntentId.trim():'';
  if(!UUID_RE.test(intentId))throw new Error('invalid_payment_intent_id');
  if(!providerIntentId||providerIntentId.length>240)throw new Error('invalid_provider_payment_reference');

  const current=await loadGlobalPaymentIntentById(intentId);
  if(!current)throw new Error('payment_intent_not_found');
  if(current.providerIntentId){
    if(current.providerIntentId!==providerIntentId)throw new Error('provider_intent_id_mismatch');
    return current;
  }
  const response=await dbFetch(
    'commerce_payment_intents?id=eq.'+encodeURIComponent(intentId)+'&provider_intent_id=is.null',
    {
      method:'PATCH',
      headers:{Prefer:'return=representation'},
      body:JSON.stringify({provider_intent_id:providerIntentId}),
    },
  );
  const rows=await response.json() as Array<Record<string,unknown>>;
  const row=rows[0];
  if(row)return mapGlobalPaymentIntentRow(row);
  const reread=await loadGlobalPaymentIntentById(intentId);
  if(!reread||reread.providerIntentId!==providerIntentId)throw new Error('provider_intent_link_failed');
  return reread;
}

export async function recordAndApplyGlobalPaymentEvent(input:{
  providerCode:unknown;
  providerEventId:unknown;
  eventType:unknown;
  providerObjectId?:unknown;
  currencyCode?:unknown;
  amountMinor?:unknown;
  moneySemantics:'none'|'intent_total'|'refund_delta';
  signatureVerified:boolean;
  payloadSha256:unknown;
  intentId:unknown;
  newStatus:string;
  metadata?:Record<string,unknown>;
}){
  const providerCode=normalizePaymentCode(input.providerCode);
  if(!providerCode)throw new Error('invalid_payment_provider');
  const providerEventId=typeof input.providerEventId==='string'?input.providerEventId.trim():'';
  const eventType=typeof input.eventType==='string'?input.eventType.trim():'';
  const providerObjectId=typeof input.providerObjectId==='string'?input.providerObjectId.trim():null;
  const payloadSha256=typeof input.payloadSha256==='string'?input.payloadSha256.trim().toLowerCase():'';
  const intentId=typeof input.intentId==='string'?input.intentId.trim():'';
  if(!providerEventId||providerEventId.length>240)throw new Error('invalid_provider_event_id');
  if(!eventType||eventType.length>120)throw new Error('invalid_provider_event_type');
  if(!UUID_RE.test(intentId))throw new Error('invalid_payment_intent_id');
  if(!/^[a-f0-9]{64}$/.test(payloadSha256))throw new Error('invalid_payload_digest');

  let currencyCode:string|null=null;
  let amountMinor:string|null=null;
  if(input.moneySemantics!=='none'){
    currencyCode=normalizePaymentCurrency(input.currencyCode);
    const amount=typeof input.amountMinor==='bigint'
      ?input.amountMinor
      :BigInt(String(input.amountMinor??'0'));
    if(!currencyCode||amount<=0n)throw new Error('provider_event_money_required');
    amountMinor=amount.toString();
  }

  const recorded=await dbFetch('rpc/record_commerce_payment_event_v1',{
    method:'POST',
    headers:{Prefer:'return=representation'},
    body:JSON.stringify({
      p_provider_code:providerCode,
      p_provider_event_id:providerEventId,
      p_event_type:eventType,
      p_provider_object_id:providerObjectId,
      p_currency_code:currencyCode,
      p_amount_minor:amountMinor,
      p_money_semantics:input.moneySemantics,
      p_signature_verified:input.signatureVerified,
      p_payload_sha256:payloadSha256,
      p_metadata:input.metadata??{},
    }),
  });
  const recordedRows=await recorded.json() as Array<{event_id:number;duplicate:boolean;processing_status:string}>;
  const event=recordedRows[0];
  if(!event)throw new Error('payment_event_not_recorded');

  const applied=await dbFetch('rpc/apply_commerce_payment_event_v1',{
    method:'POST',
    headers:{Prefer:'return=representation'},
    body:JSON.stringify({
      p_event_id:event.event_id,
      p_intent_id:intentId,
      p_new_status:input.newStatus,
      p_provider_intent_id:providerObjectId,
    }),
  });
  const appliedRows=await applied.json() as Array<{
    intent_id:string;status:string;captured_amount_minor:string|number;refunded_amount_minor:string|number;
  }>;
  const row=appliedRows[0];
  if(!row)throw new Error('payment_event_not_applied');
  return{
    duplicate:Boolean(event.duplicate),
    intentId:row.intent_id,
    status:row.status,
    capturedAmountMinor:String(row.captured_amount_minor),
    refundedAmountMinor:String(row.refunded_amount_minor),
  };
}
