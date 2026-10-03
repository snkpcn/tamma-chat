import {isWorldwideCapabilityEnabled,type WorldwideCapability,type WorldwideEnv} from './_worldwide-foundation';

export const WW9_FULFILLMENT_VERSION='ww9-global-fulfillment-2026-10-03';

const REQUIRED:WorldwideCapability[]=['globalPayments','globalShipping','checkout','fulfillment'];
const CODE_RE=/^[A-Za-z0-9][A-Za-z0-9:_-]{1,199}$/;
const IDEMPOTENCY_RE=/^[A-Za-z0-9][A-Za-z0-9:_-]{15,119}$/;
const HASH_RE=/^[0-9a-f]{64}$/;
const ADAPTER_RE=/^[a-z0-9][a-z0-9_-]{1,63}$/;
const HTTPS_RE=/^https:\/\//i;

export type FulfillmentPackageInput={
  packageIndex:number;
  providerPackageId:string|null;
  trackingNumber:string|null;
  trackingUrl:string|null;
  labelReference:string|null;
  labelFormat:'pdf'|'png'|'zpl'|null;
};

export type FulfillmentProviderResult={
  providerShipmentId:string;
  providerAdapterKey:string;
  bookingIdempotencyKey:string;
  providerEvidenceHash:string;
  packages:FulfillmentPackageInput[];
};

export type FulfillmentTrackingEventCode=
  |'BOOKED'|'LABEL_READY'|'PICKED_UP'|'IN_TRANSIT'|'CUSTOMS_HOLD'
  |'CUSTOMS_RELEASED'|'OUT_FOR_DELIVERY'|'DELIVERED'|'DELIVERY_FAILED'
  |'RETURN_TO_SENDER'|'CANCELLED';

const TRACKING_CODES=new Set<FulfillmentTrackingEventCode>([
  'BOOKED','LABEL_READY','PICKED_UP','IN_TRANSIT','CUSTOMS_HOLD',
  'CUSTOMS_RELEASED','OUT_FOR_DELIVERY','DELIVERED','DELIVERY_FAILED',
  'RETURN_TO_SENDER','CANCELLED',
]);

export function globalFulfillmentMissingCapabilities(env?:WorldwideEnv):WorldwideCapability[]{
  return REQUIRED.filter(capability=>!isWorldwideCapabilityEnabled(capability,env));
}

export function assertGlobalFulfillmentEnabled(env?:WorldwideEnv):void{
  const missing=globalFulfillmentMissingCapabilities(env);
  if(missing.length)throw new Error('global_fulfillment_not_enabled:'+missing.join(','));
}

function text(value:unknown,max:number,code:string):string{
  if(typeof value!=='string')throw new Error(code);
  const out=value.trim();
  if(!out||out.length>max)throw new Error(code);
  return out;
}
function optionalText(value:unknown,max:number):string|null{
  if(value==null||value==='')return null;
  if(typeof value!=='string')throw new Error('invalid_provider_package');
  const out=value.trim();
  if(!out||out.length>max)throw new Error('invalid_provider_package');
  return out;
}

export function normalizeFulfillmentProviderResult(value:unknown):FulfillmentProviderResult{
  if(!value||typeof value!=='object')throw new Error('invalid_provider_result');
  const raw=value as Record<string,unknown>;
  const providerShipmentId=text(raw.providerShipmentId,200,'invalid_provider_shipment_id');
  const providerAdapterKey=text(raw.providerAdapterKey,64,'invalid_provider_adapter_key').toLowerCase();
  if(!ADAPTER_RE.test(providerAdapterKey))throw new Error('invalid_provider_adapter_key');
  const bookingIdempotencyKey=text(raw.bookingIdempotencyKey,120,'idempotency_key_required');
  if(!IDEMPOTENCY_RE.test(bookingIdempotencyKey))throw new Error('idempotency_key_required');
  const providerEvidenceHash=text(raw.providerEvidenceHash,64,'provider_evidence_hash_required').toLowerCase();
  if(!HASH_RE.test(providerEvidenceHash))throw new Error('provider_evidence_hash_required');
  if(!Array.isArray(raw.packages)||raw.packages.length<1||raw.packages.length>100)throw new Error('invalid_packages');

  const seen=new Set<number>();
  const packages=raw.packages.map((entry,index)=>{
    if(!entry||typeof entry!=='object')throw new Error('invalid_provider_package');
    const item=entry as Record<string,unknown>;
    const packageIndex=Number(item.packageIndex);
    if(!Number.isSafeInteger(packageIndex)||packageIndex<1||packageIndex>100||seen.has(packageIndex)){
      throw new Error('invalid_provider_package');
    }
    seen.add(packageIndex);
    const providerPackageId=optionalText(item.providerPackageId,200);
    const trackingNumber=optionalText(item.trackingNumber,300);
    const trackingUrl=optionalText(item.trackingUrl,1000);
    if(trackingUrl&&!HTTPS_RE.test(trackingUrl))throw new Error('invalid_tracking_url');
    const labelReference=optionalText(item.labelReference,500);
    const format=optionalText(item.labelFormat,8)?.toLowerCase()??null;
    if(format&&!['pdf','png','zpl'].includes(format))throw new Error('invalid_label_format');
    return{packageIndex,providerPackageId,trackingNumber,trackingUrl,labelReference,labelFormat:format as FulfillmentPackageInput['labelFormat']};
  }).sort((a,b)=>a.packageIndex-b.packageIndex);

  packages.forEach((item,index)=>{
    if(item.packageIndex!==index+1)throw new Error('package_indexes_must_be_contiguous');
  });
  return{providerShipmentId,providerAdapterKey,bookingIdempotencyKey,providerEvidenceHash,packages};
}

export function normalizeFulfillmentTrackingEvent(value:unknown){
  if(!value||typeof value!=='object')throw new Error('invalid_tracking_event');
  const raw=value as Record<string,unknown>;
  const providerEventId=text(raw.providerEventId,200,'invalid_provider_event_id');
  if(!CODE_RE.test(providerEventId))throw new Error('invalid_provider_event_id');
  const eventCode=text(raw.eventCode,40,'invalid_tracking_event_code').toUpperCase() as FulfillmentTrackingEventCode;
  if(!TRACKING_CODES.has(eventCode))throw new Error('invalid_tracking_event_code');
  const occurredAt=text(raw.occurredAt,80,'tracking_event_time_required');
  const time=new Date(occurredAt);
  if(Number.isNaN(time.valueOf()))throw new Error('tracking_event_time_required');
  const rawEventHash=text(raw.rawEventHash,64,'raw_event_hash_required').toLowerCase();
  if(!HASH_RE.test(rawEventHash))throw new Error('raw_event_hash_required');
  const providerStatus=optionalText(raw.providerStatus,200);
  const customerMessage=optionalText(raw.customerMessage,500);
  const metadata=raw.metadata==null?{}:raw.metadata;
  if(!metadata||typeof metadata!=='object'||Array.isArray(metadata))throw new Error('invalid_event_metadata');
  return{providerEventId,eventCode,occurredAt:time.toISOString(),rawEventHash,providerStatus,customerMessage,metadata};
}

export function normalizeReturnRequest(value:unknown){
  if(!value||typeof value!=='object')throw new Error('invalid_return_request');
  const raw=value as Record<string,unknown>;
  const reasonCode=text(raw.reasonCode,64,'invalid_return_reason').toLowerCase();
  if(!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(reasonCode))throw new Error('invalid_return_reason');
  const requestedResolution=text(raw.requestedResolution,40,'invalid_return_resolution').toLowerCase();
  if(!['refund','replacement','store_credit','return_only'].includes(requestedResolution)){
    throw new Error('invalid_return_resolution');
  }
  const idempotencyKey=text(raw.idempotencyKey,120,'idempotency_key_required');
  if(!IDEMPOTENCY_RE.test(idempotencyKey))throw new Error('idempotency_key_required');
  return{reasonCode,requestedResolution,idempotencyKey};
}
