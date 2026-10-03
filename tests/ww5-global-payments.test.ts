import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertGlobalPaymentEventMatchesIntent,
  canTransitionGlobalPaymentIntent,
  normalizePaymentCode,
  normalizePaymentIdempotencyKey,
  resolveGlobalPaymentMethod,
  type GlobalMarketPaymentMethod,
  type GlobalPaymentProvider,
} from '../netlify/functions/_global-payments';
import { loadGlobalPaymentMethod } from '../netlify/functions/_global-payments-db';

const providers:GlobalPaymentProvider[]=[
  {providerCode:'legacy_promptpay_owner',adapterKey:'legacy_promptpay_v1',status:'live',active:true},
  {providerCode:'provider_x',adapterKey:'provider_x_v1',status:'live',active:true},
];

const methods:GlobalMarketPaymentMethod[]=[
  {
    marketCode:'TH',providerCode:'legacy_promptpay_owner',currencyCode:'THB',
    paymentMethodCode:'promptpay_owner_qr',executionMode:'legacy_v1',
    status:'live',enabled:true,priority:0,
  },
  {
    marketCode:'SE',providerCode:'provider_x',currencyCode:'SEK',
    paymentMethodCode:'card',executionMode:'global_v2',
    status:'live',enabled:true,priority:10,
  },
];

test('WW-5 normalizes provider/method codes and strong idempotency keys',()=>{
  assert.equal(normalizePaymentCode(' Card '),'card');
  assert.equal(normalizePaymentCode('CARD VISA'),null);
  assert.equal(normalizePaymentIdempotencyKey('order:1234567890abcdef'),'order:1234567890abcdef');
  assert.equal(normalizePaymentIdempotencyKey('too-short'),null);
});

test('WW-5 keeps legacy PromptPay outside the global v2 intent engine',()=>{
  const result=resolveGlobalPaymentMethod({
    marketCode:'TH',currencyCode:'THB',requestedMethod:'promptpay_owner_qr',
    providers,methods,
  });
  assert.deepEqual(result,{kind:'not_available',reason:'legacy_execution_mode'});
});

test('WW-5 resolves an explicitly configured live global provider method',()=>{
  const result=resolveGlobalPaymentMethod({
    marketCode:'SE',currencyCode:'SEK',requestedMethod:'card',providers,methods,
  });
  assert.equal(result.kind,'ready');
  if(result.kind==='ready'){
    assert.equal(result.provider.providerCode,'provider_x');
    assert.equal(result.method.executionMode,'global_v2');
  }
});

test('WW-5 payment intent state machine rejects unsafe backwards transitions',()=>{
  assert.equal(canTransitionGlobalPaymentIntent('created','requires_action'),true);
  assert.equal(canTransitionGlobalPaymentIntent('authorized','captured'),true);
  assert.equal(canTransitionGlobalPaymentIntent('captured','refunded'),true);
  assert.equal(canTransitionGlobalPaymentIntent('captured','created'),false);
  assert.equal(canTransitionGlobalPaymentIntent('refunded','captured'),false);
});

test('WW-5 provider events must be verified and must match provider/currency/amount',()=>{
  const intent={
    marketCode:'SE',currencyCode:'SEK',amountMinor:10000n,
    capturedAmountMinor:0n,refundedAmountMinor:0n,
    providerCode:'provider_x',paymentMethodCode:'card',status:'processing' as const,
  };
  assert.doesNotThrow(()=>assertGlobalPaymentEventMatchesIntent(intent,{
    providerCode:'provider_x',currencyCode:'SEK',amountMinor:10000n,moneySemantics:'intent_total',signatureVerified:true,
  }));
  assert.throws(()=>assertGlobalPaymentEventMatchesIntent(intent,{
    providerCode:'provider_x',currencyCode:'USD',amountMinor:10000n,moneySemantics:'intent_total',signatureVerified:true,
  }),/provider_event_currency_mismatch/u);
  assert.throws(()=>assertGlobalPaymentEventMatchesIntent(intent,{
    providerCode:'provider_x',currencyCode:'SEK',amountMinor:9999n,moneySemantics:'intent_total',signatureVerified:true,
  }),/provider_event_amount_mismatch/u);
  assert.throws(()=>assertGlobalPaymentEventMatchesIntent(intent,{
    providerCode:'provider_x',currencyCode:'SEK',amountMinor:10000n,moneySemantics:'intent_total',signatureVerified:false,
  }),/provider_event_signature_not_verified/u);
});

test('WW-5 DB loader is dormant when globalPayments gate is off',async()=>{
  const result=await loadGlobalPaymentMethod({
    marketCode:'TH',currencyCode:'THB',requestedMethod:'promptpay_owner_qr',env:{},
  });
  assert.deepEqual(result,{kind:'disabled'});
});


test('WW-5 refund delta cannot exceed captured amount',()=>{
  const intent={
    marketCode:'SE',currencyCode:'SEK',amountMinor:10000n,
    capturedAmountMinor:10000n,refundedAmountMinor:2500n,
    providerCode:'provider_x',paymentMethodCode:'card',status:'captured' as const,
  };
  assert.doesNotThrow(()=>assertGlobalPaymentEventMatchesIntent(intent,{
    providerCode:'provider_x',currencyCode:'SEK',amountMinor:2500n,
    moneySemantics:'refund_delta',signatureVerified:true,
  }));
  assert.throws(()=>assertGlobalPaymentEventMatchesIntent(intent,{
    providerCode:'provider_x',currencyCode:'SEK',amountMinor:8000n,
    moneySemantics:'refund_delta',signatureVerified:true,
  }),/refund_exceeds_capture/u);
});
