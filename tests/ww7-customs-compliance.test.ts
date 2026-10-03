import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateCustomsCompliance,normalizeClassificationCode} from '../netlify/functions/_customs-compliance';
import {createCustomsComplianceSnapshot} from '../netlify/functions/_customs-compliance-db';

test('WW-7 validates tariff/classification codes without guessing',()=>{
  assert.equal(normalizeClassificationCode('5007 20'),'500720');
  assert.equal(normalizeClassificationCode('12345'),null);
  assert.equal(normalizeClassificationCode('ABC123'),null);
});

test('WW-7 missing profile/rule fails closed to review_required',()=>{
  assert.deepEqual(evaluateCustomsCompliance([{productId:'p1',quantity:1,profile:null,rule:null}]).decision,'review_required');
});

test('WW-7 explicit prohibited destination wins over other states',()=>{
  const result=evaluateCustomsCompliance([{
    productId:'p1',quantity:1,
    profile:{productId:'p1',originCountryCode:'TH',classificationSystem:'HS',classificationCode:'500720',customsDescription:'woven silk fabric',verificationStatus:'verified'},
    rule:{productId:'p1',countryCode:'SE',decision:'prohibited',status:'live',enabled:true},
  }]);
  assert.equal(result.decision,'prohibited');
});

test('WW-7 eligible requires verified profile and live explicit allow rule',()=>{
  const result=evaluateCustomsCompliance([{
    productId:'p1',quantity:2,
    profile:{productId:'p1',originCountryCode:'TH',classificationSystem:'HS',classificationCode:'500720',customsDescription:'woven silk fabric',verificationStatus:'verified'},
    rule:{productId:'p1',countryCode:'SE',decision:'allowed',status:'live',enabled:true},
  }]);
  assert.deepEqual(result,{decision:'eligible',reasons:[]});
});

test('WW-7 DB compliance engine is dormant while customs gate is off',async()=>{
  const out=await createCustomsComplianceSnapshot({
    marketCode:'SE',destinationCountryCode:'SE',currencyCode:'SEK',
    items:[{productId:'00000000-0000-4000-8000-000000000001',quantity:1}],
    idempotencyKey:'ww7:test:1234567890abcdef',environment:'test',env:{},
  });
  assert.deepEqual(out,{kind:'disabled'});
});
