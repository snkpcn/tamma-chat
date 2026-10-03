import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  THONGTHAI_BACKOFFICE_READ_LANES,
  buildThongthaiDomesticShippingRead,
  buildThongthaiOfferParcels,
  normalizeThongthaiWorldwideOfferItems,
  readThongthaiMarketContext,
  readThongthaiShippingQuote,
  readThongthaiWorldwideOffer,
  type ThongthaiWorldwideDeps,
} from '../netlify/functions/_thongthai-worldwide-bridge';
import {
  THONGTHAI_READ_ONLY_TOOLS,
  executeThongthaiReadOnlyTool,
} from '../netlify/functions/_thongthai-agent-tools';
import { buildProductionSemanticInterpreterPrompt, emptySemanticContext } from '../netlify/functions/_semantic-interpreter';

const WW10_ENABLED = {
  TAMMA_WW_ENABLED:'1',
  TAMMA_WW_ADDRESS_V2_ENABLED:'1',
  TAMMA_WW_MULTI_CURRENCY_ENABLED:'1',
  TAMMA_WW_GLOBAL_PAYMENTS_ENABLED:'1',
  TAMMA_WW_GLOBAL_SHIPPING_ENABLED:'1',
  TAMMA_WW_CUSTOMS_ENABLED:'1',
  TAMMA_WW_CHECKOUT_ENABLED:'1',
  TAMMA_WW_THONGTHAI_ENABLED:'1',
};

const MARKET = {
  version:'ww1-global-data-core-2026-10-03' as const,
  marketCode:'SE',
  countryCode:'SE',
  currencyCode:'SEK',
  localeCode:'en',
  status:'live' as const,
  isDomestic:false,
  capabilities:{
    catalog:'live' as const,
    storefront:'live' as const,
    pricing:'live' as const,
    payments:'live' as const,
    shipping:'live' as const,
    customs:'live' as const,
    checkout:'live' as const,
    fulfillment:'live' as const,
    thongthai:'live' as const,
  },
};

function readyDeps(overrides:Partial<ThongthaiWorldwideDeps>={}):ThongthaiWorldwideDeps{
  const deps={
    readMarket:async()=>({status:'ready' as const,source:'worldwide_data_core' as const,context:MARKET}),
    listProducts:async()=>[{
      productId:'11111111-1111-4111-8111-111111111111',
      sku:'TEST001',
      name:'Test craft',
      description:null,
      price:100,
      stock:5,
    }],
    loadPrice:async()=>({kind:'ready' as const,price:{
      id:'22222222-2222-4222-8222-222222222222',
      productId:'11111111-1111-4111-8111-111111111111',
      currencyCode:'SEK',
      amountMinor:12500n,
      minorUnit:2,
      priceSource:'manual' as const,
      validFrom:'2026-10-03T00:00:00.000Z',
      validUntil:null,
      active:true,
    }}),
    loadProfiles:async()=>({kind:'ready' as const,profiles:[{
      productId:'11111111-1111-4111-8111-111111111111',
      originCountryCode:'TH',
      weightGrams:800,
      lengthMm:300,
      widthMm:200,
      heightMm:100,
      shipsSeparately:false,
    }]}),
    createShippingQuote:async()=>({kind:'ready' as const,quote:{
      quoteId:'33333333-3333-4333-8333-333333333333',
      quoteCode:'SQ-WW10-TEST',
      marketCode:'SE',
      originCountryCode:'TH',
      destinationCountryCode:'SE',
      currencyCode:'SEK',
      amountMinor:'25000',
      providerCode:'WW10_TEST',
      serviceCode:'STANDARD',
      zoneCode:'SE',
      actualWeightGrams:1600,
      volumetricWeightGrams:2400,
      chargeableWeightGrams:2400,
      estimatedMinDays:5,
      estimatedMaxDays:9,
      expiresAt:'2026-10-03T12:00:00.000Z',
    }}),
    createCustomsSnapshot:async()=>({
      kind:'ready' as const,
      snapshotId:'44444444-4444-4444-8444-444444444444',
      decision:'eligible',
      dutyTaxStatus:'not_calculated',
    }),
    loadPaymentMethod:async()=>({kind:'ready' as const,provider:{
      providerCode:'ww10_pay',
      adapterKey:'ww10_pay_v1',
      status:'live' as const,
      active:true,
    },method:{
      marketCode:'SE',
      providerCode:'ww10_pay',
      currencyCode:'SEK',
      paymentMethodCode:'card',
      executionMode:'global_v2' as const,
      status:'live' as const,
      enabled:true,
      priority:1,
    }}),
    getGlobalStatus:async()=>null,
    loadCertification:async()=>({kind:'ready' as const,certificationId:'55555555-5555-4555-8555-555555555555',certificationCode:'MC-WW11-TEST',validUntil:'2026-11-03T00:00:00.000Z'}),
    ...overrides,
  };
  return deps as unknown as ThongthaiWorldwideDeps;
}

test('Thongthai bridge owns no duplicate WW or shipping database', () => {
  const source=readFileSync(new URL('../netlify/functions/_thongthai-worldwide-bridge.ts',import.meta.url),'utf8');
  assert.doesNotMatch(source,/fetch\s*\(/u);
  assert.doesNotMatch(source,/\b(?:dbFetch|chartDbFetch|publicDbFetch)\b|\/rest\/v1\//u);
  for(const authority of [
    'loadWorldwideMarketContext','loadExplicitProductPrice','loadGlobalProductShippingProfiles',
    'createGlobalShippingQuote','createCustomsComplianceSnapshot','loadGlobalPaymentMethod',
    'getGuestGlobalCommerceStatus',
  ]) assert.match(source,new RegExp(authority));
});

test('Thongthai has a bounded read seam for every customer-facing backoffice lane', () => {
  const lanes=new Set(THONGTHAI_BACKOFFICE_READ_LANES.map(item=>item.lane));
  assert.deepEqual([...lanes].sort(),[
    'activity','booking','cafe','certification','customs','fulfillment','market','membership','otop','payment',
    'pricing','promotion','restaurant','shipping','stay',
  ]);
  const tools=new Set(THONGTHAI_READ_ONLY_TOOLS.map(tool=>tool.name));
  for(const name of [
    'recommend_restaurant_menu','get_cafe_menu','get_activity_catalog','get_stay_catalog',
    'get_otop_catalog','get_active_promotions','get_booking_status','get_order_status',
    'get_payment_status','get_membership_status','get_market_context','get_shipping_quote',
    'get_worldwide_offer',
  ]) assert.ok(tools.has(name),`missing Thongthai read tool: ${name}`);
});

test('Thailand stays usable when WW flags are off and language does not redefine market', async () => {
  const market=await readThongthaiMarketContext('TH','sv-SE',{});
  assert.equal(market.status,'ready');
  if(market.status!=='ready') return;
  assert.equal(market.context.countryCode,'TH');
  assert.equal(market.context.currencyCode,'THB');
  assert.equal(market.context.isDomestic,true);
  assert.equal(market.context.localeCode,'th');
});

test('foreign market and subtotal-only shipping fail closed while WW is not enabled', async () => {
  const market=await readThongthaiMarketContext('SE','sv',{});
  assert.equal(market.status,'not_available');

  const shipping=await readThongthaiShippingQuote({
    countryCode:'SE',
    subtotal:1200,
    locale:'sv',
    env:{},
  });
  assert.deepEqual(shipping,{
    status:'not_available',
    reason:'market_not_ready',
    countryCode:'SE',
  });
});

test('foreign shipping eligibility checks market truth before asking for a subtotal', async () => {
  const shipping=await readThongthaiShippingQuote({
    countryCode:'SE',
    locale:'sv',
    env:{},
  });
  assert.deepEqual(shipping,{
    status:'not_available',
    reason:'market_not_ready',
    countryCode:'SE',
  });

  const tool=THONGTHAI_READ_ONLY_TOOLS.find(item=>item.name==='get_shipping_quote');
  assert.ok(tool);
  assert.deepEqual(tool.parameters.required,['country_code']);
});

test('Thailand shipping policy can be represented without subtotal and quote stays null', () => {
  const shipping=buildThongthaiDomesticShippingRead({
    domesticBaseFee:60,
    freeShippingThreshold:1500,
    estimatedMinDays:1,
    estimatedMaxDays:3,
  },null);
  assert.equal(shipping.countryCode,'TH');
  assert.equal(shipping.currencyCode,'THB');
  assert.equal(shipping.quote,null);
  assert.deepEqual(shipping.policy,{
    domesticBaseFee:60,
    freeShippingThreshold:1500,
    estimatedMinDays:1,
    estimatedMaxDays:3,
  });
});

test('worldwide offer normalizes duplicate SKUs without inferring destination from locale', async () => {
  assert.deepEqual(normalizeThongthaiWorldwideOfferItems([
    {sku:'test001',quantity:1},{sku:'TEST001',quantity:1},
  ]),[{sku:'TEST001',quantity:2}]);

  let requestedCountry='';
  const deps=readyDeps({
    readMarket:async(countryCode)=>{
      requestedCountry=String(countryCode);
      return {status:'ready',source:'worldwide_data_core',context:MARKET};
    },
  });
  const offer=await readThongthaiWorldwideOffer({
    countryCode:'SE',
    locale:'de-DE',
    items:[{sku:'TEST001',quantity:2}],
    environment:'test',
    idempotencySeed:'ww10-unit-test-seed',
    env:WW10_ENABLED,
  },deps);
  assert.equal(requestedCountry,'SE');
  assert.equal(offer.status,'ready');
  if(offer.status!=='ready'||offer.scope!=='international')assert.fail('expected ready international offer');
  assert.equal(offer.market.countryCode,'SE');
  assert.equal(offer.market.currencyCode,'SEK');
  assert.equal(offer.pricing.status,'ready');
  assert.equal(offer.shipping.status,'ready');
  assert.equal(offer.customs.status,'ready');
  assert.equal(offer.payment.status,'ready');
  assert.equal(offer.checkoutReadiness.status,'ready');
  assert.equal(offer.checkoutReadiness.dutiesAndTaxesIncluded,false);
});

test('worldwide offer derives parcels only from canonical profiles and never guesses missing measurements', async () => {
  const product={productId:'11111111-1111-4111-8111-111111111111',sku:'TEST001',name:'Test craft',description:null,price:100,stock:5};
  const built=buildThongthaiOfferParcels(
    [{sku:'TEST001',quantity:2}],
    [product],
    [{
      productId:product.productId,originCountryCode:'TH',weightGrams:800,
      lengthMm:300,widthMm:200,heightMm:100,shipsSeparately:false,
    }],
  );
  assert.equal(built.parcels.length,2);
  assert.deepEqual(built.parcels[0],{weightGrams:800,lengthMm:300,widthMm:200,heightMm:100});

  const missing=await readThongthaiWorldwideOffer({
    countryCode:'SE',
    items:[{sku:'TEST001',quantity:1}],
    environment:'test',
    idempotencySeed:'ww10-missing-profile',
    env:WW10_ENABLED,
  },readyDeps({loadProfiles:async()=>({kind:'ready',profiles:[]}) as never}));
  assert.equal(missing.status,'partial');
  if(missing.status!=='partial'||missing.scope!=='international')assert.fail('expected partial international offer');
  assert.equal(missing.shipping.status,'not_available');
  assert.equal(missing.shipping.reason,'shipping_profile_required');
});

test('Agent market tool never infers country from customer language', async () => {
  const result=JSON.parse(await executeThongthaiReadOnlyTool('get_market_context',{
    country_code:'TH',
    locale:'de-DE',
  },{
    guestDbId:null,
    channel:'facebook',
    environment:'live',
  }));
  assert.equal(result.status,'ready');
  assert.equal(result.context.countryCode,'TH');
  assert.equal(result.context.currencyCode,'THB');
});

test('semantic supervisor is instructed to reply in the current customer language', () => {
  const prompt=buildProductionSemanticInterpreterPrompt(
    emptySemanticContext(),
    'Können Sie nach Schweden liefern?',
  );
  assert.match(prompt,/SAME language as the CURRENT customer message/u);
  assert.match(prompt,/Never infer country, market, currency, shipping destination, or payment method from the language used/u);
});


test('WW-11 country certification blocks checkout readiness even when WW-4/5/6/7 are otherwise ready', async()=>{
  const offer=await readThongthaiWorldwideOffer({
    countryCode:'SE',
    items:[{sku:'TEST001',quantity:1}],
    environment:'test',
    idempotencySeed:'ww11-uncertified-offer',
    env:WW10_ENABLED,
  },readyDeps({
    loadCertification:async()=>({kind:'not_available' as const,reason:'country_not_certified' as const}),
  }));
  assert.equal(offer.status,'partial');
  assert.equal(offer.checkoutReadiness.status,'not_ready');
  assert.deepEqual(offer.checkoutReadiness.countryCertification,{
    status:'not_ready',
    reason:'country_not_certified',
  });
});
