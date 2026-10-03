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
