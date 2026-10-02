import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DOMESTIC_COMMERCE_BASELINE,
  WORLDWIDE_CAPABILITY_ENV,
  WORLDWIDE_MASTER_ENV,
  explicitFeatureFlag,
  isWorldwideCapabilityEnabled,
  worldwideFeatureSnapshot,
} from '../netlify/functions/_worldwide-foundation';
import {
  calculateShippingQuote,
  normalizeMemberAddress,
} from '../netlify/functions/_member-delivery';

test('WW-0 master switch is fail-closed and domestic baseline stays TH/THB', () => {
  const snapshot = worldwideFeatureSnapshot({});
  assert.equal(snapshot.master, false);
  assert.equal(snapshot.anyWorldwideExposure, false);
  assert.deepEqual(snapshot.domesticBaseline, { countryCode: 'TH', currencyCode: 'THB' });
  assert.deepEqual(DOMESTIC_COMMERCE_BASELINE, { countryCode: 'TH', currencyCode: 'THB' });
  assert.ok(Object.values(snapshot.capabilities).every(value => value === false));
});

test('WW-0 capability switches can never bypass the master kill switch', () => {
  const env = {
    [WORLDWIDE_MASTER_ENV]: '0',
    ...Object.fromEntries(Object.values(WORLDWIDE_CAPABILITY_ENV).map(name => [name, '1'])),
  };
  for (const capability of Object.keys(WORLDWIDE_CAPABILITY_ENV) as Array<keyof typeof WORLDWIDE_CAPABILITY_ENV>) {
    assert.equal(isWorldwideCapabilityEnabled(capability, env), false);
  }
  assert.equal(worldwideFeatureSnapshot(env).anyWorldwideExposure, false);
});

test('WW-0 rollout is capability-by-capability after master enablement', () => {
  const env = {
    [WORLDWIDE_MASTER_ENV]: 'true',
    [WORLDWIDE_CAPABILITY_ENV.dataCore]: '1',
    [WORLDWIDE_CAPABILITY_ENV.storefront]: 'yes',
    [WORLDWIDE_CAPABILITY_ENV.checkout]: '0',
  };
  const snapshot = worldwideFeatureSnapshot(env);
  assert.equal(snapshot.master, true);
  assert.equal(snapshot.capabilities.dataCore, true);
  assert.equal(snapshot.capabilities.storefront, true);
  assert.equal(snapshot.capabilities.checkout, false);
  assert.equal(snapshot.capabilities.globalPayments, false);
  assert.equal(snapshot.capabilities.globalShipping, false);
  assert.equal(snapshot.anyWorldwideExposure, true);
});

test('WW-0 feature parser only accepts explicit truthy values', () => {
  assert.equal(explicitFeatureFlag('1'), true);
  assert.equal(explicitFeatureFlag('TRUE'), true);
  assert.equal(explicitFeatureFlag(' on '), true);
  assert.equal(explicitFeatureFlag('yes'), true);
  assert.equal(explicitFeatureFlag('0'), false);
  assert.equal(explicitFeatureFlag('false'), false);
  assert.equal(explicitFeatureFlag('enabled'), false);
  assert.equal(explicitFeatureFlag(undefined), false);
});

test('WW-0 preserves current Thai address normalization contract', () => {
  const address = normalizeMemberAddress({
    label: 'บ้าน',
    recipientName: 'ทดสอบ ลูกค้า',
    phone: '+66 81 234 5678',
    addressLine1: '123 หมู่ 1',
    subdistrict: 'ในเมือง',
    district: 'เมือง',
    province: 'ชัยภูมิ',
    postalCode: '36000',
    isDefault: true,
  });
  assert.equal(address.phone, '0812345678');
  assert.equal(address.province, 'ชัยภูมิ');
  assert.equal(address.postalCode, '36000');
  assert.equal(address.isDefault, true);
});

test('WW-0 preserves current domestic shipping quote behavior', () => {
  const settings = {
    enabled: true,
    domesticBaseFee: 60,
    freeShippingThreshold: 1500,
    estimatedMinDays: 2,
    estimatedMaxDays: 5,
  };
  assert.deepEqual(calculateShippingQuote(1000, settings), {
    subtotal: 1000,
    shippingFee: 60,
    total: 1060,
    freeShipping: false,
    estimatedMinDays: 2,
    estimatedMaxDays: 5,
  });
  assert.deepEqual(calculateShippingQuote(1500, settings), {
    subtotal: 1500,
    shippingFee: 0,
    total: 1500,
    freeShipping: true,
    estimatedMinDays: 2,
    estimatedMaxDays: 5,
  });
});
