import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  isCustomerImageRequest,
  selectOtopProductForMedia,
  resolveRequestedCustomerMedia,
  type MediaCatalogProduct,
} from '../netlify/functions/_thongthai-media';
import { withHarness } from './helpers/canonical-core-harness';

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

test('media resolver reads only the live catalog shape and returns a transport-safe JPEG URL', async () => {
  await withHarness(async () => {
    const result=await resolveRequestedCustomerMedia({
      customerMessage:'ขอดูรูปกล้วยกรอบแก้วหน่อยครับ',
      assistantMessage:'มีครับ',
      language:'th',
      chatHistory:[],
    });
    assert.ok(result);
    assert.equal(result?.media.length,1);
    assert.equal(result?.media[0]?.sku,'OTOP-NB-003');
    assert.match(result?.media[0]?.url ?? '',/\.webp$/u);
    assert.match(result?.media[0]?.deliveryUrl ?? '',/\/\.netlify\/images\?/u);
    assert.match(result?.media[0]?.deliveryUrl ?? '',/fm=jpg/u);
    assert.match(result?.overrideMessage ?? '',/ให้เบิ่ง/u);
  },{
    otopProducts:[{
      sku:'OTOP-NB-003',
      name:'กล้วยกรอบแก้วตรานกกระจิบ',
      active:true,
      verified:true,
      environment:'live',
      otop_product_images:[{
        public_url:'https://example.supabase.co/storage/v1/object/public/otop-products/banana.webp',
        alt_text:'กล้วยกรอบแก้ว',
        sort_order:0,
        is_primary:true,
      }],
    }],
  });
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
