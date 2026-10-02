import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  isCustomerImageRequest,
  selectOtopProductForMedia,
  type MediaCatalogProduct,
} from '../netlify/functions/_thongthai-media';

const products:MediaCatalogProduct[] = [
  {
    sku:'OTOP-NB-003',
    name:'กล้วยกรอบแก้วตรานกกระจิบ',
    images:[{url:'https://example.com/banana.webp',alt:'กล้วยกรอบแก้ว',position:0,primary:true}],
  },
  {
    sku:'OTOP-BK-001',
    name:'ผ้าไหมมัดหมี่ บ้านเขว้า',
    images:[{url:'https://example.com/silk.webp',alt:'ผ้าไหม',position:0,primary:true}],
  },
];

test('media intent selects a live product by a natural partial product name', () => {
  assert.equal(isCustomerImageRequest('ขอดูรูปกล้วยกรอบแก้วหน่อยได้ไหมครับ'),true);
  const selected=selectOtopProductForMedia(products,'ขอดูรูปกล้วยกรอบแก้วหน่อยได้ไหมครับ');
  assert.equal(selected?.sku,'OTOP-NB-003');
});

test('referential image request can resolve one product from recent bounded context', () => {
  const selected=selectOtopProductForMedia(
    products,
    'ขอดูรูปอันนี้หน่อยครับ',
    'ได้ครับ',
    [{role:'assistant',content:'กล้วยกรอบแก้วตรานกกระจิบยังมีสินค้าครับ'}],
  );
  assert.equal(selected?.sku,'OTOP-NB-003');
});

test('customer media contract is wired to LINE, Messenger, Web and Netlify image conversion', () => {
  const line=readFileSync('netlify/functions/_line-webhook-core.ts','utf8');
  const facebook=readFileSync('netlify/functions/facebook-webhook.mts','utf8');
  const web=readFileSync('index.html','utf8');
  const netlify=readFileSync('netlify.toml','utf8');
  assert.match(line,/type LineImageMessage/u);
  assert.match(line,/originalContentUrl:item\.deliveryUrl/u);
  assert.match(facebook,/attachment:\s*\{[\s\S]*type:\s*'image'/u);
  assert.match(web,/function addMediaToStack/u);
  assert.match(web,/addMediaToStack\(stack, aiResult\.media\)/u);
  assert.match(netlify,/\[images\][\s\S]*upaokrprawzhgzeqsdke\.supabase\.co/u);
});
