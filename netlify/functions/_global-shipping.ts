export const WW6_GLOBAL_SHIPPING_VERSION='ww6-worldwide-shipping-2026-10-03';

export type ShippingExecutionMode='legacy_v1'|'global_v2';
export type ShippingRateMode='domestic_v1'|'manual_weight_table'|'provider_quote';
export type ShippingConfigStatus='draft'|'certification'|'live'|'suspended';

export type ShippingProvider={
  providerCode:string;
  adapterKey:string;
  status:ShippingConfigStatus;
  active:boolean;
};

export type ShippingService={
  marketCode:string;
  serviceCode:string;
  providerCode:string;
  zoneCode:string;
  currencyCode:string;
  executionMode:ShippingExecutionMode;
  rateMode:ShippingRateMode;
  status:ShippingConfigStatus;
  enabled:boolean;
  priority:number;
  estimatedMinDays:number;
  estimatedMaxDays:number;
  volumetricDivisorCm3PerKg:number|null;
};

export type ShippingParcel={
  weightGrams:number;
  lengthMm:number;
  widthMm:number;
  heightMm:number;
};

export type ShippingParcelEvidence=ShippingParcel&{
  volumetricWeightGrams:number;
  chargeableWeightGrams:number;
};

export type ShippingRateTier={
  tierOrder:number;
  maxChargeableWeightGrams:number;
  amountMinor:bigint;
};

export type ShippingServiceResolution=
  |{kind:'ready';provider:ShippingProvider;service:ShippingService}
  |{kind:'not_available';reason:
      |'shipping_service_not_configured'
      |'shipping_service_not_live'
      |'shipping_provider_not_live'
      |'legacy_execution_mode'
    }
  |{kind:'invalid';reason:'ambiguous_shipping_service'};

const CODE_RE=/^[A-Z0-9][A-Z0-9_-]{1,63}$/;

export function normalizeShippingCode(value:unknown):string|null{
  if(typeof value!=='string')return null;
  const code=value.trim().toUpperCase();
  return CODE_RE.test(code)?code:null;
}

function positiveInteger(value:unknown,max:number):number|null{
  const n=Number(value);
  return Number.isSafeInteger(n)&&n>0&&n<=max?n:null;
}

export function normalizeShippingParcel(value:unknown):ShippingParcel{
  const input=value&&typeof value==='object'?value as Record<string,unknown>:{};
  const weightGrams=positiveInteger(input.weightGrams,100_000);
  const lengthMm=positiveInteger(input.lengthMm,3_000);
  const widthMm=positiveInteger(input.widthMm,3_000);
  const heightMm=positiveInteger(input.heightMm,3_000);
  if(weightGrams===null)throw new Error('invalid_parcel_weight');
  if(lengthMm===null||widthMm===null||heightMm===null)throw new Error('invalid_parcel_dimensions');
  return{weightGrams,lengthMm,widthMm,heightMm};
}

export function calculateParcelChargeableWeight(
  parcel:ShippingParcel,
  volumetricDivisorCm3PerKg:number|null,
):ShippingParcelEvidence{
  const divisor=volumetricDivisorCm3PerKg===null?null:Number(volumetricDivisorCm3PerKg);
  if(divisor!==null&&(!Number.isSafeInteger(divisor)||divisor<1||divisor>100_000)){
    throw new Error('invalid_volumetric_divisor');
  }
  const volumeMm3=BigInt(parcel.lengthMm)*BigInt(parcel.widthMm)*BigInt(parcel.heightMm);
  const volumetricWeightGrams=divisor===null
    ?0
    :Number((volumeMm3+BigInt(divisor)-1n)/BigInt(divisor));
  if(!Number.isSafeInteger(volumetricWeightGrams))throw new Error('parcel_volume_out_of_range');
  return{
    ...parcel,
    volumetricWeightGrams,
    chargeableWeightGrams:Math.max(parcel.weightGrams,volumetricWeightGrams),
  };
}

export function calculateShipmentChargeableWeight(
  parcels:ShippingParcel[],
  volumetricDivisorCm3PerKg:number|null,
):{parcels:ShippingParcelEvidence[];actualWeightGrams:number;volumetricWeightGrams:number;chargeableWeightGrams:number}{
  if(!Array.isArray(parcels)||parcels.length<1||parcels.length>20)throw new Error('invalid_parcel_count');
  const evidence=parcels.map(parcel=>calculateParcelChargeableWeight(parcel,volumetricDivisorCm3PerKg));
  const sum=(key:keyof Pick<ShippingParcelEvidence,'weightGrams'|'volumetricWeightGrams'|'chargeableWeightGrams'>)=>
    evidence.reduce((total,parcel)=>total+parcel[key],0);
  const actualWeightGrams=sum('weightGrams');
  const volumetricWeightGrams=sum('volumetricWeightGrams');
  const chargeableWeightGrams=sum('chargeableWeightGrams');
  if(!Number.isSafeInteger(chargeableWeightGrams)||chargeableWeightGrams<=0){
    throw new Error('shipment_weight_out_of_range');
  }
  return{parcels:evidence,actualWeightGrams,volumetricWeightGrams,chargeableWeightGrams};
}

export function resolveManualShippingRate(
  chargeableWeightGrams:number,
  tiers:ShippingRateTier[],
):ShippingRateTier|null{
  if(!Number.isSafeInteger(chargeableWeightGrams)||chargeableWeightGrams<=0){
    throw new Error('invalid_chargeable_weight');
  }
  const usable=tiers
    .filter(tier=>
      Number.isSafeInteger(tier.maxChargeableWeightGrams)
      &&tier.maxChargeableWeightGrams>0
      &&tier.amountMinor>0n
      &&tier.maxChargeableWeightGrams>=chargeableWeightGrams
    )
    .sort((a,b)=>a.maxChargeableWeightGrams-b.maxChargeableWeightGrams||a.tierOrder-b.tierOrder);
  return usable[0]??null;
}

export function resolveGlobalShippingService(input:{
  marketCode:string;
  currencyCode:string;
  requestedServiceCode?:string|null;
  providers:ShippingProvider[];
  services:ShippingService[];
}):ShippingServiceResolution{
  const requested=input.requestedServiceCode?normalizeShippingCode(input.requestedServiceCode):null;
  const candidates=input.services
    .filter(service=>
      service.marketCode===input.marketCode
      &&service.currencyCode===input.currencyCode
      &&service.enabled
      &&(!requested||service.serviceCode===requested)
    )
    .sort((a,b)=>a.priority-b.priority);

  if(!candidates.length)return{kind:'not_available',reason:'shipping_service_not_configured'};
  const live=candidates.filter(service=>service.status==='live');
  if(!live.length)return{kind:'not_available',reason:'shipping_service_not_live'};
  const global=live.filter(service=>service.executionMode==='global_v2');
  if(!global.length)return{kind:'not_available',reason:'legacy_execution_mode'};

  const usable=global.map(service=>({
    service,
    provider:input.providers.find(provider=>provider.providerCode===service.providerCode),
  })).filter((row):row is {service:ShippingService;provider:ShippingProvider}=>
    !!row.provider&&row.provider.active&&row.provider.status==='live'
  );
  if(!usable.length)return{kind:'not_available',reason:'shipping_provider_not_live'};
  if(!requested&&usable.length>1&&usable[0]!.service.priority===usable[1]!.service.priority){
    return{kind:'invalid',reason:'ambiguous_shipping_service'};
  }
  return{kind:'ready',provider:usable[0]!.provider,service:usable[0]!.service};
}
