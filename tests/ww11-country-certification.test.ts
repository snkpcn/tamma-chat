import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  normalizeCertificationMarket,
  normalizeCertificationPriceRevisions,
  normalizeCertificationProductIds,
} from '../netlify/functions/_country-certification';

test('WW-11 normalizes a bounded exact certification product set',()=>{
  assert.equal(normalizeCertificationMarket(' se '),'SE');
  assert.deepEqual(normalizeCertificationProductIds([
    '22222222-2222-4222-8222-222222222222',
    '11111111-1111-4111-8111-111111111111',
  ]),[
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
  ]);
  assert.throws(()=>normalizeCertificationProductIds([
    '11111111-1111-4111-8111-111111111111',
    '11111111-1111-4111-8111-111111111111',
  ]),/duplicate_product_ids/);
});

test('WW-11 certification price coverage is exact and duplicate-safe',()=>{
  assert.deepEqual(normalizeCertificationPriceRevisions([{
    productId:'11111111-1111-4111-8111-111111111111',
    priceRevisionId:'22222222-2222-4222-8222-222222222222',
  }]),[{
    productId:'11111111-1111-4111-8111-111111111111',
    priceRevisionId:'22222222-2222-4222-8222-222222222222',
  }]);
});

test('WW-11 DB seam evaluates and resolves certification only',()=>{
  const source=readFileSync(new URL('../netlify/functions/_country-certification-db.ts',import.meta.url),'utf8');
  assert.doesNotMatch(source,/create_member_otop_order|create_commerce_payment_intent|record_commerce_fulfillment_booking/i);
  assert.match(source,/evaluate_commerce_market_certification_v1/);
  assert.match(source,/resolve_commerce_market_certification_v1/);
});

test('WW-11 is wired into Thongthai worldwide checkout readiness',()=>{
  const source=readFileSync(new URL('../netlify/functions/_thongthai-worldwide-bridge.ts',import.meta.url),'utf8');
  assert.match(source,/loadCountryCertificationForOffer/);
  assert.match(source,/certification\.kind==='ready'/);
  assert.match(source,/countryCertification:/);
});
