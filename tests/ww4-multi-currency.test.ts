import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatMinorAmount,
  parseDecimalToMinor,
  referenceFxConversion,
  resolveExplicitProductPrice,
  type ExplicitProductPrice,
} from '../netlify/functions/_multi-currency';
import { loadExplicitProductPrice } from '../netlify/functions/_multi-currency-db';

test('WW-4 converts exact decimal amounts to minor units without float rounding',()=>{
  assert.equal(parseDecimalToMinor('2500.00',2),250000n);
  assert.equal(parseDecimalToMinor('99',2),9900n);
  assert.equal(parseDecimalToMinor('120.000',2),12000n);
  assert.equal(parseDecimalToMinor('5000',0),5000n);
  assert.throws(()=>parseDecimalToMinor('1.239',2),/amount_exceeds_currency_precision/u);
  assert.throws(()=>parseDecimalToMinor('-1.00',2),/invalid_decimal_amount/u);
});

test('WW-4 formats minor units using currency precision deterministically',()=>{
  assert.equal(formatMinorAmount(250000n,2),'2500.00');
  assert.equal(formatMinorAmount(123n,0),'123');
  assert.equal(formatMinorAmount(1n,3),'0.001');
});

test('WW-4 FX conversion is reference-only and half-up at target minor unit',()=>{
  // THB 100.00 * 0.028500 USD/THB = USD 2.85
  assert.equal(referenceFxConversion({
    sourceAmountMinor:10000n,sourceMinorUnit:2,targetMinorUnit:2,rate:'0.028500',
  }),285n);
  // 1.005 rounds half-up to 1.01 in a 2-minor-unit currency.
  assert.equal(referenceFxConversion({
    sourceAmountMinor:100n,sourceMinorUnit:2,targetMinorUnit:2,rate:'1.005',
  }),101n);
});

test('WW-4 checkout price selection uses explicit stored price only',()=>{
  const rows:ExplicitProductPrice[]=[{
    id:'p1',productId:'x',currencyCode:'USD',amountMinor:7900n,minorUnit:2,
    priceSource:'manual',validFrom:'2026-10-01T00:00:00Z',validUntil:null,active:true,
  }];
  const result=resolveExplicitProductPrice('usd',rows,new Date('2026-10-03T00:00:00Z'));
  assert.equal(result.kind,'ready');
  if(result.kind==='ready'){
    assert.equal(result.price.amountMinor,7900n);
    assert.equal(result.price.priceSource,'manual');
  }
});

test('WW-4 missing explicit price fails closed instead of deriving from THB',()=>{
  const result=resolveExplicitProductPrice('SEK',[],new Date('2026-10-03T00:00:00Z'));
  assert.deepEqual(result,{kind:'not_available',reason:'price_not_configured'});
});

test('WW-4 DB price loader is dormant while multiCurrency gate is off',async()=>{
  const result=await loadExplicitProductPrice({
    productId:'00000000-0000-4000-8000-000000000001',
    marketCode:'TH',
    currencyCode:'USD',
    env:{},
  });
  assert.deepEqual(result,{kind:'disabled'});
});
