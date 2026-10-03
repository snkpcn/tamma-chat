import test from 'node:test';
import assert from 'node:assert/strict';
import {
  globalFulfillmentMissingCapabilities,
  normalizeFulfillmentProviderResult,
  normalizeFulfillmentTrackingEvent,
  normalizeReturnRequest,
} from '../netlify/functions/_global-fulfillment';

const enabled={
  TAMMA_WW_ENABLED:'1',
  TAMMA_WW_GLOBAL_PAYMENTS_ENABLED:'1',
  TAMMA_WW_GLOBAL_SHIPPING_ENABLED:'1',
  TAMMA_WW_CHECKOUT_ENABLED:'1',
  TAMMA_WW_FULFILLMENT_ENABLED:'1',
};

test('WW-9 remains fail-closed until every fulfillment dependency is enabled',()=>{
  assert.deepEqual(globalFulfillmentMissingCapabilities({}),['globalPayments','globalShipping','checkout','fulfillment']);
  assert.deepEqual(globalFulfillmentMissingCapabilities(enabled),[]);
});

test('WW-9 normalizes a provider booking without persisting plaintext tracking in the core shape',()=>{
  const result=normalizeFulfillmentProviderResult({
    providerShipmentId:'ship_123',
    providerAdapterKey:'certified_carrier_v1',
    bookingIdempotencyKey:'ww9:booking:1234567890',
    providerEvidenceHash:'a'.repeat(64),
    packages:[
      {packageIndex:2,trackingNumber:'TRACK-2',trackingUrl:'https://carrier.example/2',labelReference:'label-2',labelFormat:'PDF'},
      {packageIndex:1,trackingNumber:'TRACK-1',trackingUrl:'https://carrier.example/1',labelReference:'label-1',labelFormat:'pdf'},
    ],
  });
  assert.deepEqual(result.packages.map(x=>x.packageIndex),[1,2]);
  assert.equal(result.packages[0].trackingNumber,'TRACK-1');
  assert.equal(result.packages[0].labelFormat,'pdf');
});

test('WW-9 rejects package gaps and non-https tracking links',()=>{
  assert.throws(()=>normalizeFulfillmentProviderResult({
    providerShipmentId:'ship_123',providerAdapterKey:'certified_carrier_v1',
    bookingIdempotencyKey:'ww9:booking:1234567890',providerEvidenceHash:'b'.repeat(64),
    packages:[{packageIndex:2}],
  }),/package_indexes_must_be_contiguous/);
  assert.throws(()=>normalizeFulfillmentProviderResult({
    providerShipmentId:'ship_123',providerAdapterKey:'certified_carrier_v1',
    bookingIdempotencyKey:'ww9:booking:1234567890',providerEvidenceHash:'b'.repeat(64),
    packages:[{packageIndex:1,trackingUrl:'http://carrier.example/1'}],
  }),/invalid_tracking_url/);
});

test('WW-9 accepts only canonical tracking event codes with hash evidence',()=>{
  const event=normalizeFulfillmentTrackingEvent({
    providerEventId:'evt_123',
    eventCode:'out_for_delivery',
    occurredAt:'2026-10-03T07:30:00Z',
    rawEventHash:'c'.repeat(64),
    providerStatus:'courier_out',
  });
  assert.equal(event.eventCode,'OUT_FOR_DELIVERY');
  assert.equal(event.occurredAt,'2026-10-03T07:30:00.000Z');
  assert.throws(()=>normalizeFulfillmentTrackingEvent({
    providerEventId:'evt_124',eventCode:'somewhere',occurredAt:'2026-10-03T07:30:00Z',rawEventHash:'c'.repeat(64),
  }),/invalid_tracking_event_code/);
});

test('WW-9 return requests use explicit resolution and idempotency',()=>{
  assert.deepEqual(normalizeReturnRequest({
    reasonCode:'damaged_item',
    requestedResolution:'replacement',
    idempotencyKey:'ww9:return:12345678901',
  }),{
    reasonCode:'damaged_item',
    requestedResolution:'replacement',
    idempotencyKey:'ww9:return:12345678901',
  });
});
