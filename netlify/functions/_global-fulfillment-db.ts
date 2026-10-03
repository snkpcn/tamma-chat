import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {
  assertGlobalFulfillmentEnabled,
  normalizeFulfillmentProviderResult,
  normalizeFulfillmentTrackingEvent,
  normalizeReturnRequest,
} from './_global-fulfillment';
import type {WorldwideEnv} from './_worldwide-foundation';

type DbConfig={url:string;key:string};
type RuntimeEnv={get?:(key:string)=>unknown};

function runtimeEnv():RuntimeEnv|undefined{
  return (globalThis as typeof globalThis&{Netlify?:{env?:RuntimeEnv}}).Netlify?.env;
}
function envValue(key:string):string|undefined{
  const value=runtimeEnv()?.get?.(key);
  return typeof value==='string'&&value.trim()?value:process.env[key];
}
function config():DbConfig|null{
  const url=envValue('SUPABASE_URL');
  const key=envValue('SUPABASE_SERVICE_ROLE_KEY');
  return url&&key?{url:url.replace(/\/$/,''),key}:null;
}
async function dbFetch(path:string,init:RequestInit={}){
  const c=config(); if(!c)throw new Error('global_fulfillment_not_configured');
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
    throw new Error(`global_fulfillment_db_${response.status}:${body.slice(0,400)}`);
  }
  return response;
}

function trackingPiiKey():Buffer{
  const raw=envValue('CUSTOMER_PII_ENCRYPTION_KEY');
  if(!raw)throw new Error('tracking_encryption_not_configured');
  const padded=raw+'='.repeat((4-(raw.length%4))%4);
  const key=Buffer.from(padded.replace(/-/g,'+').replace(/_/g,'/'),'base64');
  if(key.length!==32)throw new Error('tracking_encryption_key_invalid');
  return key;
}
function encryptTrackingNumber(value:string|null|undefined):string|null{
  const text=value?.trim();
  if(!text)return null;
  const iv=randomBytes(12);
  const cipher=createCipheriv('aes-256-gcm',trackingPiiKey(),iv);
  const encrypted=Buffer.concat([cipher.update(text,'utf8'),cipher.final()]);
  const tag=cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}
function decryptTrackingNumber(value:string|null|undefined):string|null{
  if(!value)return null;
  const [version,ivRaw,tagRaw,dataRaw]=value.split('.');
  if(version!=='v1'||!ivRaw||!tagRaw||!dataRaw)return null;
  try{
    const decipher=createDecipheriv('aes-256-gcm',trackingPiiKey(),Buffer.from(ivRaw,'base64url'));
    decipher.setAuthTag(Buffer.from(tagRaw,'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataRaw,'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }catch{
    return null;
  }
}

const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function uuid(value:unknown,code:string){
  const out=typeof value==='string'?value.trim():'';
  if(!UUID_RE.test(out))throw new Error(code);
  return out;
}

export async function recordGlobalFulfillmentBooking(input:{
  orderId:unknown;
  providerResult:unknown;
  environment?:'live'|'test';
  env?:WorldwideEnv;
}){
  assertGlobalFulfillmentEnabled(input.env);
  const orderId=uuid(input.orderId,'order_required');
  const provider=normalizeFulfillmentProviderResult(input.providerResult);
  const packages=provider.packages.map(item=>({
    packageIndex:item.packageIndex,
    providerPackageId:item.providerPackageId,
    trackingNumberEnc:item.trackingNumber?encryptTrackingNumber(item.trackingNumber):null,
    trackingUrl:item.trackingUrl,
    labelReference:item.labelReference,
    labelFormat:item.labelFormat,
  }));
  const response=await dbFetch('rpc/record_commerce_fulfillment_booking_v1',{
    method:'POST',
    headers:{Prefer:'return=representation'},
    body:JSON.stringify({
      p_order_id:orderId,
      p_provider_shipment_id:provider.providerShipmentId,
      p_provider_adapter_key:provider.providerAdapterKey,
      p_packages:packages,
      p_booking_idempotency_key:provider.bookingIdempotencyKey,
      p_provider_evidence_hash:provider.providerEvidenceHash,
      p_environment:input.environment??'live',
    }),
  });
  const rows=await response.json() as Array<Record<string,unknown>>;
  const row=rows[0]; if(!row)throw new Error('fulfillment_booking_not_recorded');
  return{
    shipmentId:String(row.shipment_id),
    shipmentCode:String(row.shipment_code),
    providerCode:String(row.provider_code),
    serviceCode:String(row.service_code),
    shipmentStatus:String(row.shipment_status),
    packageCount:Number(row.package_count),
  };
}

export async function applyGlobalFulfillmentTrackingEvent(input:{
  shipmentId:unknown;
  event:unknown;
  environment?:'live'|'test';
  env?:WorldwideEnv;
}){
  assertGlobalFulfillmentEnabled(input.env);
  const shipmentId=uuid(input.shipmentId,'shipment_required');
  const event=normalizeFulfillmentTrackingEvent(input.event);
  const response=await dbFetch('rpc/apply_commerce_fulfillment_tracking_event_v1',{
    method:'POST',
    headers:{Prefer:'return=representation'},
    body:JSON.stringify({
      p_shipment_id:shipmentId,
      p_provider_event_id:event.providerEventId,
      p_event_code:event.eventCode,
      p_occurred_at:event.occurredAt,
      p_provider_status:event.providerStatus,
      p_customer_message:event.customerMessage,
      p_raw_event_hash:event.rawEventHash,
      p_metadata:event.metadata,
      p_environment:input.environment??'live',
    }),
  });
  const rows=await response.json() as Array<Record<string,unknown>>;
  const row=rows[0]; if(!row)throw new Error('tracking_event_not_recorded');
  return{
    trackingEventId:String(row.tracking_event_id),
    shipmentStatus:String(row.shipment_status),
    stateApplied:Boolean(row.state_applied),
    orderShippingStatus:String(row.order_shipping_status),
  };
}

export async function createInternationalReturnRequest(input:{
  authUserId:unknown;
  orderId:unknown;
  request:unknown;
  environment?:'live'|'test';
  env?:WorldwideEnv;
}){
  assertGlobalFulfillmentEnabled(input.env);
  const authUserId=uuid(input.authUserId,'authentication_required');
  const orderId=uuid(input.orderId,'order_required');
  const request=normalizeReturnRequest(input.request);
  const response=await dbFetch('rpc/create_commerce_return_request_v1',{
    method:'POST',
    headers:{Prefer:'return=representation'},
    body:JSON.stringify({
      p_auth_user_id:authUserId,
      p_order_id:orderId,
      p_reason_code:request.reasonCode,
      p_requested_resolution:request.requestedResolution,
      p_idempotency_key:request.idempotencyKey,
      p_environment:input.environment??'live',
    }),
  });
  const rows=await response.json() as Array<Record<string,unknown>>;
  const row=rows[0]; if(!row)throw new Error('return_request_not_created');
  return{
    returnId:String(row.return_id),
    returnCode:String(row.return_code),
    status:String(row.status),
    requestedResolution:String(row.requested_resolution),
    policyTermsCode:String(row.policy_terms_code),
  };
}

export async function getMemberGlobalFulfillment(authUserId:unknown,orderCode:unknown){
  const userId=uuid(authUserId,'authentication_required');
  const code=typeof orderCode==='string'?orderCode.trim().toUpperCase():'';
  if(!/^OR-[A-Z0-9-]{6,40}$/.test(code))throw new Error('invalid_order_code');

  const accountRes=await dbFetch(
    `customer_accounts?auth_user_id=eq.${encodeURIComponent(userId)}&member_status=eq.member&select=id&limit=1`,
  );
  const accounts=await accountRes.json() as Array<{id:string}>;
  if(!accounts[0])throw new Error('member_profile_required');

  const orderRes=await dbFetch(
    `otop_orders?order_code=eq.${encodeURIComponent(code)}&customer_id=eq.${accounts[0].id}&checkout_version=eq.2`
    +'&select=id,order_code,shipping_status,market_code,destination_country_code,environment&limit=1',
  );
  const orders=await orderRes.json() as Array<Record<string,unknown>>;
  const order=orders[0]; if(!order)throw new Error('order_not_found');

  const shipmentRes=await dbFetch(
    `commerce_fulfillment_shipments?order_id=eq.${order.id}&select=id,shipment_code,provider_code,service_code,shipment_status,booked_at,shipped_at,delivered_at,updated_at&limit=1`,
  );
  const shipments=await shipmentRes.json() as Array<Record<string,unknown>>;
  const shipment=shipments[0];
  if(!shipment)return{orderCode:code,shippingStatus:String(order.shipping_status),shipment:null};

  const [packageRes,eventRes]=await Promise.all([
    dbFetch(`commerce_fulfillment_packages?shipment_id=eq.${shipment.id}&select=package_index,provider_package_id,tracking_number_enc,tracking_url,label_reference,label_format,package_status&order=package_index.asc`),
    dbFetch(`commerce_fulfillment_tracking_events?shipment_id=eq.${shipment.id}&select=provider_event_id,event_code,provider_status,customer_message,occurred_at,state_applied&order=occurred_at.asc,received_at.asc`),
  ]);
  const packages=await packageRes.json() as Array<Record<string,unknown>>;
  const events=await eventRes.json() as Array<Record<string,unknown>>;
  return{
    orderCode:code,
    shippingStatus:String(order.shipping_status),
    marketCode:String(order.market_code),
    destinationCountryCode:String(order.destination_country_code),
    shipment:{
      ...shipment,
      packages:packages.map(pkg=>({
        packageIndex:Number(pkg.package_index),
        providerPackageId:pkg.provider_package_id?String(pkg.provider_package_id):null,
        trackingNumber:pkg.tracking_number_enc?decryptTrackingNumber(String(pkg.tracking_number_enc)):null,
        trackingUrl:pkg.tracking_url?String(pkg.tracking_url):null,
        labelReference:pkg.label_reference?String(pkg.label_reference):null,
        labelFormat:pkg.label_format?String(pkg.label_format):null,
        packageStatus:String(pkg.package_status),
      })),
      events,
    },
  };
}


export async function getGuestGlobalCommerceStatus(input:{
  guestDbId:unknown;
  code?:unknown;
  environment?:'live'|'test';
}){
  const guestId=uuid(input.guestDbId,'guest_identity_required');
  const environment=input.environment??'live';
  const code=typeof input.code==='string'?input.code.trim().toUpperCase():'';
  if(code&&!/^(?:OR|PI)-[A-Z0-9-]{6,80}$/.test(code))throw new Error('invalid_global_reference_code');

  const accountRes=await dbFetch(
    `customer_accounts?guest_id=eq.${encodeURIComponent(guestId)}&select=id&limit=1`,
  );
  const accounts=await accountRes.json() as Array<{id:string}>;
  const account=accounts[0];
  if(!account)return null;

  let forcedOrderId:string|null=null;
  if(code.startsWith('PI-')){
    const paymentLookup=await dbFetch(
      `commerce_payment_intents?intent_code=eq.${encodeURIComponent(code)}&environment=eq.${environment}`
      +'&source_entity_type=eq.otop_order&select=source_entity_id&limit=1',
    );
    const payments=await paymentLookup.json() as Array<{source_entity_id:string}>;
    forcedOrderId=payments[0]?.source_entity_id??null;
    if(!forcedOrderId)return null;
  }

  const orderPath=
    `otop_orders?customer_id=eq.${encodeURIComponent(account.id)}&checkout_version=eq.2&environment=eq.${environment}`
    +(forcedOrderId?`&id=eq.${encodeURIComponent(forcedOrderId)}`:'')
    +(code.startsWith('OR-')?`&order_code=eq.${encodeURIComponent(code)}`:'')
    +'&select=id,order_code,status,shipping_status,market_code,destination_country_code,currency_code,'
    +'subtotal_minor,shipping_fee_minor,total_minor,payment_intent_id,customs_snapshot_id,created_at,updated_at'
    +'&order=created_at.desc&limit=1';
  const orderRes=await dbFetch(orderPath);
  const orders=await orderRes.json() as Array<Record<string,unknown>>;
  const order=orders[0];
  if(!order)return null;

  const orderId=String(order.id);
  const paymentIntentId=order.payment_intent_id?String(order.payment_intent_id):null;
  const customsSnapshotId=order.customs_snapshot_id?String(order.customs_snapshot_id):null;

  const [shipmentRes,paymentRes,customsRes]=await Promise.all([
    dbFetch(
      `commerce_fulfillment_shipments?order_id=eq.${encodeURIComponent(orderId)}`
      +'&select=id,shipment_code,provider_code,service_code,shipment_status,booked_at,shipped_at,delivered_at,returned_at,updated_at&limit=1',
    ),
    paymentIntentId
      ?dbFetch(
        `commerce_payment_intents?id=eq.${encodeURIComponent(paymentIntentId)}`
        +'&select=intent_code,status,amount_minor,captured_amount_minor,refunded_amount_minor,provider_code,payment_method_code,updated_at&limit=1',
      )
      :Promise.resolve(new Response('[]',{status:200,headers:{'Content-Type':'application/json'}})),
    customsSnapshotId
      ?dbFetch(
        `commerce_customs_compliance_snapshots?id=eq.${encodeURIComponent(customsSnapshotId)}`
        +'&select=decision,duty_tax_status,reasons,updated_at&limit=1',
      )
      :Promise.resolve(new Response('[]',{status:200,headers:{'Content-Type':'application/json'}})),
  ]);
  const shipments=await shipmentRes.json() as Array<Record<string,unknown>>;
  const payments=await paymentRes.json() as Array<Record<string,unknown>>;
  const customsRows=await customsRes.json() as Array<Record<string,unknown>>;
  const shipment=shipments[0]??null;

  let packages:Array<Record<string,unknown>>=[];
  let events:Array<Record<string,unknown>>=[];
  if(shipment?.id){
    const [packageRes,eventRes]=await Promise.all([
      dbFetch(
        `commerce_fulfillment_packages?shipment_id=eq.${shipment.id}`
        +'&select=package_index,provider_package_id,tracking_number_enc,tracking_url,package_status&order=package_index.asc',
      ),
      dbFetch(
        `commerce_fulfillment_tracking_events?shipment_id=eq.${shipment.id}`
        +'&select=event_code,provider_status,customer_message,occurred_at,state_applied&order=occurred_at.asc,received_at.asc',
      ),
    ]);
    const packageRows=await packageRes.json() as Array<Record<string,unknown>>;
    packages=packageRows.map(pkg=>({
      packageIndex:Number(pkg.package_index),
      providerPackageId:pkg.provider_package_id?String(pkg.provider_package_id):null,
      trackingNumber:pkg.tracking_number_enc?decryptTrackingNumber(String(pkg.tracking_number_enc)):null,
      trackingUrl:pkg.tracking_url?String(pkg.tracking_url):null,
      packageStatus:String(pkg.package_status),
    }));
    events=await eventRes.json() as Array<Record<string,unknown>>;
  }

  const payment=payments[0]??null;
  const customs=customsRows[0]??null;
  return{
    order:{
      orderId,
      orderCode:String(order.order_code),
      status:String(order.status),
      shippingStatus:order.shipping_status?String(order.shipping_status):null,
      marketCode:String(order.market_code),
      destinationCountryCode:String(order.destination_country_code),
      currencyCode:String(order.currency_code),
      subtotalMinor:order.subtotal_minor==null?null:String(order.subtotal_minor),
      shippingFeeMinor:order.shipping_fee_minor==null?null:String(order.shipping_fee_minor),
      totalMinor:order.total_minor==null?null:String(order.total_minor),
      createdAt:String(order.created_at),
      updatedAt:String(order.updated_at),
    },
    payment:payment?{
      intentCode:String(payment.intent_code),
      status:String(payment.status),
      amountMinor:String(payment.amount_minor),
      capturedAmountMinor:String(payment.captured_amount_minor),
      refundedAmountMinor:String(payment.refunded_amount_minor),
      providerCode:String(payment.provider_code),
      paymentMethodCode:String(payment.payment_method_code),
      updatedAt:String(payment.updated_at),
    }:null,
    customs:customs?{
      decision:String(customs.decision),
      dutyTaxStatus:String(customs.duty_tax_status),
      reasons:customs.reasons,
      updatedAt:String(customs.updated_at),
    }:null,
    fulfillment:shipment?{
      shipmentId:String(shipment.id),
      shipmentCode:String(shipment.shipment_code),
      providerCode:String(shipment.provider_code),
      serviceCode:String(shipment.service_code),
      shipmentStatus:String(shipment.shipment_status),
      bookedAt:String(shipment.booked_at),
      shippedAt:shipment.shipped_at?String(shipment.shipped_at):null,
      deliveredAt:shipment.delivered_at?String(shipment.delivered_at):null,
      returnedAt:shipment.returned_at?String(shipment.returned_at):null,
      updatedAt:String(shipment.updated_at),
      packages,
      events,
    }:null,
  };
}
