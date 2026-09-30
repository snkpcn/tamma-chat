import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ALL_OTOP_PRODUCTS,
  OTOP_PROVINCES,
  getOtopProductById,
  getOtopProductsByProvince,
} from '../src/data/otop';

test('OTOP province registry contains the 20 unique required province IDs', () => {
  assert.equal(OTOP_PROVINCES.length, 20);
  const ids = OTOP_PROVINCES.map((province) => province.provinceId);
  assert.equal(new Set(ids).size, 20);
  assert.deepEqual(ids, [
    'chaiyaphum', 'khonkaen', 'buriram', 'surin', 'sisaket',
    'nakhonratchasima', 'roiet', 'mahasarakham', 'kalasin', 'sakonnakhon',
    'nakhonphanom', 'mukdahan', 'yasothon', 'amnatcharoen', 'ubonratchathani',
    'udonthani', 'nongkhai', 'buengkan', 'loei', 'nongbualamphu',
  ]);
  assert.equal(OTOP_PROVINCES.find((province) => province.provinceId === 'chaiyaphum')?.productCount, 10);
});

test('Chaiyaphum owns 10 complete, story-only and public-safe products', () => {
  const products = getOtopProductsByProvince('chaiyaphum');
  assert.equal(products.length, 10);
  for (const product of products) {
    assert.equal(product.provinceId, 'chaiyaphum');
    assert.ok(product.id);
    assert.ok(product.productName);
    assert.ok(product.shortDescription);
    assert.ok(product.image);
    assert.equal(product.availableForSale, false);
    assert.equal(product.stockStatus, 'story-only');
    assert.equal(product.publicClaimSafe, true);
    assert.ok(product.needsOwnerConfirmation.length > 0);
  }
  assert.equal(ALL_OTOP_PRODUCTS.some((product) => product.availableForSale), false);
});

test('province and product lookup helpers handle populated, empty and unknown IDs safely', () => {
  assert.equal(getOtopProductsByProvince('chaiyaphum').length, 10);
  assert.deepEqual(getOtopProductsByProvince('khonkaen'), []);
  assert.deepEqual(getOtopProductsByProvince('not-a-province'), []);
  assert.equal(getOtopProductById('chaiyaphum-otop-001')?.productName, 'ผ้าไหมมัดหมี่');
  assert.equal(getOtopProductById('missing-product'), undefined);
});

test('map UI loads by provinceId and renders exact empty-state and story fields', () => {
  const mapSource = readFileSync('assets/scripts/otop-map.js', 'utf8');
  const page = readFileSync('otop-map.html', 'utf8');
  assert.match(mapSource, /data-province-id/u);
  assert.match(mapSource, /provinceId=/u);
  assert.match(mapSource, /product\.shortDescription/u);
  assert.match(mapSource, /product\.imageCaption/u);
  assert.match(mapSource, /product\.category/u);
  assert.match(mapSource, /product\.originPlace/u);
  assert.match(mapSource, /ยังไม่มีสินค้าที่ผ่านการยืนยันสำหรับแสดงในหน้านี้/u);
  assert.doesNotMatch(mapSource, /กำลังเตรียมสินค้า OTOP ของจังหวัดนี้/u);
  assert.match(page, /id="provinceProductGrid"/u);
});
