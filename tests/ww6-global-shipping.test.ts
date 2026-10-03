import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateParcelChargeableWeight,
  calculateShipmentChargeableWeight,
  normalizeShippingParcel,
  resolveGlobalShippingService,
  resolveManualShippingRate,
  type ShippingProvider,
  type ShippingService,
} from '../netlify/functions/_global-shipping';
import {createGlobalShippingQuote} from '../netlify/functions/_global-shipping-db';

test('WW-6 validates real parcel measurements instead of guessing',()=>{
  assert.deepEqual(normalizeShippingParcel({
    weightGrams:800,lengthMm:200,widthMm:150,heightMm:100,
  }),{weightGrams:800,lengthMm:200,widthMm:150,heightMm:100});
  assert.throws(()=>normalizeShippingParcel({
    weightGrams:0,lengthMm:200,widthMm:150,heightMm:100,
  }),/invalid_parcel_weight/u);
  assert.throws(()=>normalizeShippingParcel({
    weightGrams:800,lengthMm:null,widthMm:150,heightMm:100,
  }),/invalid_parcel_dimensions/u);
});

test('WW-6 volumetric chargeable weight is deterministic integer math',()=>{
  const parcel={weightGrams:1000,lengthMm:400,widthMm:300,heightMm:200};
  const out=calculateParcelChargeableWeight(parcel,5000);
  // 40x30x20 cm = 24,000 cm3 / 5,000 = 4.8 kg => 4,800 g
  assert.equal(out.volumetricWeightGrams,4800);
  assert.equal(out.chargeableWeightGrams,4800);
  const actualOnly=calculateParcelChargeableWeight(parcel,null);
  assert.equal(actualOnly.chargeableWeightGrams,1000);
});

test('WW-6 multi-parcel shipment sums chargeable weight parcel-by-parcel',()=>{
  const out=calculateShipmentChargeableWeight([
    {weightGrams:1000,lengthMm:400,widthMm:300,heightMm:200},
    {weightGrams:2000,lengthMm:200,widthMm:200,heightMm:200},
  ],5000);
  assert.equal(out.actualWeightGrams,3000);
  assert.equal(out.volumetricWeightGrams,6400);
  assert.equal(out.chargeableWeightGrams,6800);
});

test('WW-6 manual rate table picks smallest tier that fits chargeable weight',()=>{
  const tier=resolveManualShippingRate(6800,[
    {tierOrder:1,maxChargeableWeightGrams:5000,amountMinor:1000n},
    {tierOrder:2,maxChargeableWeightGrams:10000,amountMinor:1800n},
    {tierOrder:3,maxChargeableWeightGrams:20000,amountMinor:3000n},
  ]);
  assert.equal(tier?.tierOrder,2);
  assert.equal(resolveManualShippingRate(25000,[{
    tierOrder:1,maxChargeableWeightGrams:20000,amountMinor:3000n,
  }]),null);
});

test('WW-6 keeps domestic static shipping outside global_v2 engine',()=>{
  const providers:ShippingProvider[]=[{
    providerCode:'LEGACY_DOMESTIC_STATIC',adapterKey:'legacy_domestic_static_v1',
    status:'live',active:true,
  }];
  const services:ShippingService[]=[{
    marketCode:'TH',serviceCode:'TH_DOMESTIC_STANDARD',
    providerCode:'LEGACY_DOMESTIC_STATIC',zoneCode:'TH_DOMESTIC',currencyCode:'THB',
    executionMode:'legacy_v1',rateMode:'domestic_v1',status:'live',enabled:true,priority:0,
    estimatedMinDays:2,estimatedMaxDays:5,volumetricDivisorCm3PerKg:null,
  }];
  assert.deepEqual(resolveGlobalShippingService({
    marketCode:'TH',currencyCode:'THB',providers,services,
  }),{kind:'not_available',reason:'legacy_execution_mode'});
});

test('WW-6 resolves only an explicitly live global provider/service',()=>{
  const providers:ShippingProvider[]=[{
    providerCode:'PROVIDER_X',adapterKey:'provider_x_v1',status:'live',active:true,
  }];
  const services:ShippingService[]=[{
    marketCode:'SE',serviceCode:'SE_STANDARD',
    providerCode:'PROVIDER_X',zoneCode:'TH_TO_SE',currencyCode:'SEK',
    executionMode:'global_v2',rateMode:'manual_weight_table',
    status:'live',enabled:true,priority:10,
    estimatedMinDays:5,estimatedMaxDays:9,volumetricDivisorCm3PerKg:5000,
  }];
  const result=resolveGlobalShippingService({
    marketCode:'SE',currencyCode:'SEK',requestedServiceCode:'SE_STANDARD',
    providers,services,
  });
  assert.equal(result.kind,'ready');
});

test('WW-6 DB quote engine is dormant while globalShipping gate is off',async()=>{
  const result=await createGlobalShippingQuote({
    marketCode:'SE',
    destinationCountryCode:'SE',
    currencyCode:'SEK',
    parcels:[{weightGrams:1000,lengthMm:200,widthMm:200,heightMm:200}],
    idempotencyKey:'ww6:test:1234567890abcdef',
    environment:'test',
    env:{},
  });
  assert.deepEqual(result,{kind:'disabled'});
});
