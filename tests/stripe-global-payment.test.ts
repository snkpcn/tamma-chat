import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {
  normalizeStripeWebhookEvent,
  verifyStripeWebhookSignature,
} from '../netlify/functions/_stripe-global-payment';

test('Stripe webhook signature verifier accepts a current valid v1 HMAC and rejects tampering',()=>{
  const secret='whsec_test_secret';
  const raw='{"id":"evt_1","type":"payment_intent.succeeded"}';
  const timestamp=1_800_000_000;
  const sig=createHmac('sha256',secret).update(timestamp+'.'+raw).digest('hex');
  const header='t='+timestamp+',v1='+sig;
  assert.equal(verifyStripeWebhookSignature(raw,header,secret,timestamp*1000),true);
  assert.equal(verifyStripeWebhookSignature(raw+'x',header,secret,timestamp*1000),false);
  assert.equal(verifyStripeWebhookSignature(raw,header,secret,(timestamp+301)*1000),false);
});

test('Stripe payment_intent.succeeded maps to exact captured total evidence',()=>{
  const event=normalizeStripeWebhookEvent({
    id:'evt_success',
    type:'payment_intent.succeeded',
    data:{object:{
      id:'pi_123',
      currency:'jpy',
      amount:12500,
      amount_received:12500,
      metadata:{tamma_intent_id:'11111111-1111-4111-8111-111111111111'},
    }},
  });
  assert.ok(event);
  assert.equal(event?.providerObjectId,'pi_123');
  assert.equal(event?.currencyCode,'JPY');
  assert.equal(event?.amountMinor,12500n);
  assert.equal(event?.moneySemantics,'intent_total');
  assert.equal(event?.newStatus,'captured');
});

test('Stripe refund event maps to refund_delta against its payment intent',()=>{
  const event=normalizeStripeWebhookEvent({
    id:'evt_refund',
    type:'refund.created',
    data:{object:{id:'re_1',payment_intent:'pi_123',currency:'usd',amount:500}},
  });
  assert.ok(event);
  assert.equal(event?.providerObjectId,'pi_123');
  assert.equal(event?.currencyCode,'USD');
  assert.equal(event?.amountMinor,500n);
  assert.equal(event?.moneySemantics,'refund_delta');
  assert.equal(event?.newStatus,null);
});

test('Stripe endpoints keep session authenticated and webhook signature verified',()=>{
  const session=readFileSync(new URL('../netlify/functions/stripe-payment-session.mts',import.meta.url),'utf8');
  const webhook=readFileSync(new URL('../netlify/functions/stripe-webhook.mts',import.meta.url),'utf8');
  assert.match(session,/authUserFromBearer/);
  assert.match(session,/stripeGlobalReadiness/);
  assert.match(session,/createStripePaymentSessionForMember/);
  assert.match(webhook,/stripe-signature/);
  assert.match(webhook,/processStripeWebhook/);
  assert.doesNotMatch(webhook,/Authorization:\s*Bearer|authUserFromBearer/);
});

test('Stripe adapter never stores secret keys in source',()=>{
  const adapter=readFileSync(new URL('../netlify/functions/_stripe-global-payment.ts',import.meta.url),'utf8');
  assert.match(adapter,/STRIPE_SECRET_KEY/);
  assert.match(adapter,/STRIPE_WEBHOOK_SECRET/);
  assert.doesNotMatch(adapter,/sk_live_[A-Za-z0-9]+|whsec_[A-Za-z0-9]{8,}/);
});
