import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {
  normalizeStripeWebhookEvent,
  verifyStripeWebhookSignature,
} from '../netlify/functions/_stripe-global-payment';

test('WW-11 Stripe webhook signature verifies exact raw body inside tolerance',()=>{
  const raw=JSON.stringify({id:'evt_test',type:'payment_intent.processing',data:{object:{id:'pi_test'}}});
  const secret='whsec_test_only_not_a_real_secret';
  const timestamp=1791086400;
  const signature=createHmac('sha256',secret).update(`${timestamp}.${raw}`).digest('hex');
  const header=`t=${timestamp},v1=${signature}`;
  assert.equal(verifyStripeWebhookSignature(raw,header,secret,timestamp*1000),true);
  assert.equal(verifyStripeWebhookSignature(raw+'x',header,secret,timestamp*1000),false);
  assert.equal(verifyStripeWebhookSignature(raw,header,secret,(timestamp+301)*1000),false);
});

test('WW-11 Stripe succeeded event maps to exact captured money evidence',()=>{
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
  assert.equal(event.providerObjectId,'pi_123');
  assert.equal(event.currencyCode,'JPY');
  assert.equal(event.amountMinor,12500n);
  assert.equal(event.moneySemantics,'intent_total');
  assert.equal(event.newStatus,'captured');
});

test('WW-11 Stripe refund event maps only refund delta evidence',()=>{
  const event=normalizeStripeWebhookEvent({
    id:'evt_refund',
    type:'refund.created',
    data:{object:{id:'re_123',payment_intent:'pi_123',currency:'usd',amount:250}},
  });
  assert.ok(event);
  assert.equal(event.providerObjectId,'pi_123');
  assert.equal(event.currencyCode,'USD');
  assert.equal(event.amountMinor,250n);
  assert.equal(event.moneySemantics,'refund_delta');
  assert.equal(event.newStatus,null);
});

test('WW-11 Stripe adapter keeps provider secrets server-side and never persists client secret',()=>{
  const source=readFileSync(new URL('../netlify/functions/_stripe-global-payment.ts',import.meta.url),'utf8');
  const db=readFileSync(new URL('../netlify/functions/_global-payments-db.ts',import.meta.url),'utf8');
  assert.match(source,/STRIPE_SECRET_KEY/);
  assert.match(source,/STRIPE_WEBHOOK_SECRET/);
  assert.match(source,/stripe-signature|verifyStripeWebhookSignature/);
  assert.match(source,/client_secret/);
  assert.doesNotMatch(source,/sk_live_[A-Za-z0-9]+|whsec_[A-Za-z0-9]{16,}/);
  assert.doesNotMatch(db,/client_secret/);
  assert.match(source,/Idempotency-Key/);
  assert.match(source,/payment_method_types\[\]/);
  assert.match(source,/loadGlobalPaymentMethod/);
  assert.match(source,/stripe_payment_method_not_live/);
});

test('WW-11 Stripe endpoints use modern Netlify Request handlers and member ownership',()=>{
  const session=readFileSync(new URL('../netlify/functions/stripe-payment-session.mts',import.meta.url),'utf8');
  const webhook=readFileSync(new URL('../netlify/functions/stripe-webhook.mts',import.meta.url),'utf8');
  assert.match(session,/authUserFromBearer/);
  assert.match(session,/createStripePaymentSessionForMember/);
  assert.match(session,/path:'\/api\/payments\/stripe\/session'/);
  assert.match(webhook,/await req\.text\(\)/);
  assert.match(webhook,/stripe-signature/);
  assert.match(webhook,/path:'\/api\/payments\/stripe\/webhook'/);
});
