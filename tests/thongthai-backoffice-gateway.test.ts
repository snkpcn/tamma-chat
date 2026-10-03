import test from 'node:test';
import assert from 'node:assert/strict';

import {
  readThongthaiMarketContext,
  readThongthaiShippingQuote,
} from '../netlify/functions/_thongthai-backoffice-gateway';

test('Thongthai can still identify the locked Thailand baseline while WW exposure is off', async () => {
  const result=await readThongthaiMarketContext('th','sv-SE',{});
  assert.equal(result.ok,true);
  if(!result.ok)return;
  assert.equal(result.source,'domestic_baseline');
  assert.equal(result.countryCode,'TH');
  assert.equal(result.currencyCode,'THB');
  assert.equal(result.isDomestic,true);
});

test('Thongthai never invents a foreign market when WW data core is disabled', async () => {
  const result=await readThongthaiMarketContext('SE','sv-SE',{});
  assert.equal(result.ok,false);
  if(result.ok)return;
  assert.equal(result.status,'not_available');
  assert.equal(result.reason,'worldwide_data_core_disabled');
});

test('Thongthai foreign shipping fails closed before any quote source is live', async () => {
  const result=await readThongthaiShippingQuote({
    countryCode:'SE',
    subtotal:1200,
    locale:'sv-SE',
    env:{},
  });
  assert.equal(result.ok,false);
  if(result.ok)return;
  assert.equal(result.countryCode,'SE');
  assert.equal(result.status,'not_available');
  assert.equal(result.reason,'worldwide_data_core_disabled');
});

test('invalid destination country is never guessed', async () => {
  const result=await readThongthaiMarketContext('Sweden','sv-SE',{});
  assert.equal(result.ok,false);
  if(result.ok)return;
  assert.equal(result.countryCode,null);
  assert.equal(result.reason,'worldwide_data_core_disabled');
});
