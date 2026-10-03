import test from 'node:test';
import assert from 'node:assert/strict';
import {internationalCheckoutMissingCapabilities,normalizeInternationalCheckoutItems} from '../netlify/functions/_international-checkout';
import {checkoutInternationalOtopOrder} from '../netlify/functions/_international-checkout-db';

test('WW-8 normalizes and combines checkout SKUs deterministically',()=>{
  assert.deepEqual(normalizeInternationalCheckoutItems([
    {sku:'otop-nb-003',quantity:1},{sku:'OTOP-NB-003',quantity:2},{sku:'OTOP-BK-001',quantity:1},
  ]),[
    {sku:'OTOP-BK-001',quantity:1},{sku:'OTOP-NB-003',quantity:3},
  ]);
});

test('WW-8 requires every upstream worldwide capability before checkout',()=>{
  assert.deepEqual(internationalCheckoutMissingCapabilities({}),[
    'addressV2','multiCurrency','globalPayments','globalShipping','customs','checkout',
  ]);
});

test('WW-8 DB checkout is dormant while worldwide gates are off',async()=>{
  await assert.rejects(()=>checkoutInternationalOtopOrder({
    authUserId:'00000000-0000-4000-8000-000000000001',
    items:[{sku:'OTOP-BK-001',quantity:1}],
    shippingAddressId:'00000000-0000-4000-8000-000000000002',
    shippingQuoteId:'00000000-0000-4000-8000-000000000003',
    customsSnapshotId:'00000000-0000-4000-8000-000000000004',
    paymentMethodCode:'card',
    checkoutIdempotencyKey:'ww8:checkout:1234567890abcdef',
    paymentIdempotencyKey:'ww8:payment:1234567890abcdef',
    dutiesAcknowledged:true,
    env:{},
  }),/international_checkout_not_enabled/u);
});
