import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  addressSnapshot,
  calculateShippingQuote,
  normalizeMemberAddress,
  normalizeThaiPhone,
  safeTrackingUrl,
  shippingStatusLabel,
} from '../netlify/functions/_member-delivery';
import { normalizeStoreItems } from '../netlify/functions/_member-delivery-db';

test('member delivery normalizes Thai phone numbers without retaining formatting noise', () => {
  assert.equal(normalizeThaiPhone('081-234-5678'), '0812345678');
  assert.equal(normalizeThaiPhone('+66 81 234 5678'), '0812345678');
  assert.equal(normalizeThaiPhone('1234'), null);
});

test('member address requires a complete domestic delivery identity', () => {
  const address = normalizeMemberAddress({
    label: 'บ้าน', recipientName: 'สมชาย ใจดี', phone: '081-234-5678',
    addressLine1: '99 หมู่ 1', subdistrict: 'ในเมือง', district: 'เมืองชัยภูมิ',
    province: 'ชัยภูมิ', postalCode: '36000', deliveryInstructions: 'โทรก่อนถึง',
    isDefault: true,
  });
  assert.equal(address.phone, '0812345678');
  assert.equal(address.isDefault, true);
  assert.match(addressSnapshot(address), /99 หมู่ 1/u);
  assert.match(addressSnapshot(address), /36000/u);
  assert.throws(() => normalizeMemberAddress({ ...address, postalCode: '3600' }), /invalid_postal_code/u);
});

test('shipping quote is authoritative and applies configurable free-shipping threshold', () => {
  const settings = {
    enabled: true, domesticBaseFee: 60, freeShippingThreshold: 1500,
    estimatedMinDays: 2, estimatedMaxDays: 5,
  };
  assert.deepEqual(calculateShippingQuote(120, settings), {
    subtotal: 120, shippingFee: 60, total: 180, freeShipping: false,
    estimatedMinDays: 2, estimatedMaxDays: 5,
  });
  assert.equal(calculateShippingQuote(1500, settings).shippingFee, 0);
  assert.throws(() => calculateShippingQuote(120, { ...settings, enabled: false }), /shipping_temporarily_unavailable/u);
});

test('cart normalization combines duplicate SKUs and rejects invalid quantities', () => {
  assert.deepEqual(normalizeStoreItems([
    { sku: 'otop-nb-003', quantity: 1 },
    { sku: 'OTOP-NB-003', quantity: 2 },
  ]), [{ sku: 'OTOP-NB-003', quantity: 3 }]);
  assert.throws(() => normalizeStoreItems([{ sku: 'OTOP-NB-003', quantity: 0 }]), /invalid_items/u);
});

test('tracking links are HTTPS-only and delivery labels are customer-facing Thai', () => {
  assert.equal(safeTrackingUrl('http://carrier.example/ABC'), null);
  assert.equal(safeTrackingUrl('javascript:alert(1)'), null);
  assert.equal(safeTrackingUrl('https://carrier.example/ABC'), 'https://carrier.example/ABC');
  assert.equal(shippingStatusLabel('shipped'), 'ส่งแล้ว');
});

test('delivery migration keeps PII server-side, enables RLS and creates atomic checkout', () => {
  const sql = readFileSync('supabase/migrations/20260930070935_member_delivery_e2e.sql', 'utf8');
  assert.match(sql, /create table if not exists public\.customer_addresses/u);
  assert.match(sql, /alter table public\.customer_addresses enable row level security/u);
  assert.match(sql, /revoke all on table public\.customer_addresses from public, anon, authenticated/u);
  assert.match(sql, /create_member_otop_order_v1/u);
  assert.match(sql, /checkout_idempotency_key/u);
  assert.match(sql, /sync_otop_shipping_after_payment/u);
  assert.match(sql, /shipping_recipient_name_enc/u);
  assert.match(sql, /shipping_quote_changed/u);
  assert.match(sql, /jsonb_typeof\(elem->'quantity'\) <> 'number'/u);
});

test('customer and store pages expose member address book, live catalog and authenticated checkout', () => {
  const account = readFileSync('account.html', 'utf8');
  const store = readFileSync('otop.html', 'utf8');
  assert.match(account, /สมุดที่อยู่จัดส่ง/u);
  assert.match(account, /customer-addresses/u);
  assert.match(account, /tamma_auth_session/u);
  assert.match(store, /\.netlify\/functions\/otop-store/u);
  assert.match(store, /ยืนยันคำสั่งซื้อ/u);
  assert.match(store, /id="provinceSelect"/u);
  assert.match(store, /id="search"/u);
  assert.match(store, /id="productDialog"/u);
  assert.match(store, /function openProduct\(sku\)/u);
  assert.match(store, /function addToCart\(sku,quantity=1\)/u);
  assert.match(store, /history\.replaceState/u);
  assert.match(store, /function productImages\(p\)/u);
  assert.match(store, /class="detailThumb/u);
  assert.match(store, /id="showcase"/u);
  assert.match(store, /function renderShowcase/u);
  assert.match(store, /id="detailStory"/u);
  assert.match(store, /story\.coreValue/u);
  assert.match(store, /story\.craftProcess/u);
  assert.match(store, /\.detailThumbs\{position:relative/u);
  assert.doesNotMatch(store, /ban-khwao-silk-weaving-4k\.webp/u);
  assert.doesNotMatch(store, /Sandbox/u);
});

test('live OTOP catalog exposes the ordered four-image gallery from backoffice', () => {
  const catalog = readFileSync('netlify/functions/_member-delivery-db.ts', 'utf8');
  assert.match(catalog, /otop_product_images\(public_url,alt_text,sort_order,is_primary\)/u);
  assert.match(catalog, /\.slice\(0, 4\)/u);
  assert.match(catalog, /Number\(b\.primary\) - Number\(a\.primary\)/u);
  assert.match(catalog, /ALL_OTOP_PRODUCTS/u);
  assert.match(catalog, /storyBySku/u);
  assert.match(catalog, /coreValue: story\.coreValue/u);
  assert.match(catalog, /craftProcess: story\.craftProcess/u);
});

test('OTOP staff can move shipping through the operational LINE group', () => {
  const operations = readFileSync('netlify/functions/_ops-notifications.ts', 'utf8');
  assert.match(operations, /พร้อมส่ง\\s\+/u);
  assert.match(operations, /จัดส่งสำเร็จ/u);
  assert.match(operations, /tracking_number_enc/u);
  assert.match(operations, /shippingStatusLabel/u);
});
