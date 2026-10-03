import test from 'node:test';
import assert from 'node:assert/strict';

import {
  internationalAddressSnapshot,
  normalizeE164Phone,
  normalizeInternationalAddress,
  wantsInternationalAddressV2,
} from '../netlify/functions/_international-address';

test('WW-2 keeps legacy Thailand requests on Address V1 unless V2 is explicit', () => {
  assert.equal(wantsInternationalAddressV2({ province: 'ชัยภูมิ' }), false);
  assert.equal(wantsInternationalAddressV2({ countryCode: 'TH' }), false);
  assert.equal(wantsInternationalAddressV2({ addressVersion: 2, countryCode: 'TH' }), true);
  assert.equal(wantsInternationalAddressV2({ countryCode: 'SE' }), true);
});

test('WW-2 normalizes Thai local phone to E.164 for Address V2', () => {
  assert.equal(normalizeE164Phone('081-234-5678', 'TH'), '+66812345678');
  assert.equal(normalizeE164Phone('+66 81 234 5678', 'TH'), '+66812345678');
});

test('WW-2 requires E.164 for non-Thai international addresses', () => {
  assert.equal(normalizeE164Phone('+46 70 123 45 67', 'SE'), '+46701234567');
  assert.equal(normalizeE164Phone('070-123-45-67', 'SE'), null);
  assert.equal(normalizeE164Phone('+1234', 'US'), null);
});

test('WW-2 accepts globally-shaped addresses without forcing province or postal code', () => {
  const address = normalizeInternationalAddress({
    addressVersion: 2,
    countryCode: 'SE',
    label: 'Home',
    recipientName: 'Test Guest',
    phone: '+46 70 123 45 67',
    organization: 'Example AB',
    addressLine1: 'Examplegatan 10',
    locality: 'Stockholm',
    administrativeArea: null,
    postalCode: '111 22',
    isDefault: true,
  });
  assert.equal(address.countryCode, 'SE');
  assert.equal(address.phone, '+46701234567');
  assert.equal(address.locality, 'Stockholm');
  assert.equal(address.isDefault, true);
  assert.match(internationalAddressSnapshot(address), /SE/u);
});

test('WW-2 permits countries without postal codes but never permits missing locality', () => {
  const address = normalizeInternationalAddress({
    countryCode: 'AE',
    recipientName: 'Test Guest',
    phone: '+971501234567',
    addressLine1: 'Building 1',
    locality: 'Dubai',
  });
  assert.equal(address.postalCode, null);
  assert.throws(() => normalizeInternationalAddress({
    countryCode: 'SE',
    recipientName: 'Test Guest',
    phone: '+46701234567',
    addressLine1: 'Examplegatan 10',
  }), /locality_required/u);
});

test('WW-2 rejects malformed country codes and local-format non-Thai phones', () => {
  assert.throws(() => normalizeInternationalAddress({
    countryCode: 'SWE',
    recipientName: 'Test Guest',
    phone: '+46701234567',
    addressLine1: 'Examplegatan 10',
    locality: 'Stockholm',
  }), /invalid_country_code/u);
  assert.throws(() => normalizeInternationalAddress({
    countryCode: 'SE',
    recipientName: 'Test Guest',
    phone: '0701234567',
    addressLine1: 'Examplegatan 10',
    locality: 'Stockholm',
  }), /invalid_international_phone/u);
});
