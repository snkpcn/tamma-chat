import assert from 'node:assert/strict';
import test from 'node:test';
import { otopStorySearchText, publicOtopStory, resolveOtopStoreStory } from '../netlify/functions/_otop-store-story';
import { CHAIYAPHUM_OTOP_PRODUCTS } from '../src/data/otop/products/chaiyaphum';

test('publishes only owner-verified public-safe OTOP story metadata', () => {
  assert.equal(publicOtopStory({ storyVerified: false, story: { publicClaimSafe: true, coreValue: 'x' } }), null);
  assert.equal(publicOtopStory({ storyVerified: true, story: { publicClaimSafe: false, coreValue: 'x' } }), null);
  assert.deepEqual(publicOtopStory({
    storyVerified: true,
    story: {
      publicClaimSafe: true,
      originPlace: 'บ้านเขว้า',
      coreValue: 'ผืนผ้าที่เก็บเวลาและฝีมือ',
      storyKeywords: ['ไหม', 'บ้านเขว้า'],
      needsOwnerConfirmation: ['ชื่อช่าง'],
    },
  }), {
    originPlace: 'บ้านเขว้า',
    coreValue: 'ผืนผ้าที่เก็บเวลาและฝีมือ',
    storyKeywords: ['ไหม', 'บ้านเขว้า'],
  });
});

test('search text includes story value and craft context', () => {
  const story = publicOtopStory({
    storyVerified: true,
    story: {
      publicClaimSafe: true,
      coreValue: 'คุณค่าของคนทำ',
      craftProcess: 'มัดลาย ย้อม ทอ',
      whyHere: 'บ้านเขว้า',
    },
  });
  assert.match(otopStorySearchText(story), /คุณค่าของคนทำ/);
  assert.match(otopStorySearchText(story), /มัดลาย ย้อม ทอ/);
  assert.match(otopStorySearchText(story), /บ้านเขว้า/);
});

test('uses live product metadata before the catalog fallback', () => {
  const resolved = resolveOtopStoreStory({
    id: 'db-live',
    name: 'ผ้าไหมมัดหมี่ บ้านเขว้า',
    metadata: {
      provinceId: 'chaiyaphum',
      storyVerified: true,
      story: { publicClaimSafe: true, coreValue: 'คุณค่าที่เจ้าของแก้ในหลังบ้าน' },
    },
  }, CHAIYAPHUM_OTOP_PRODUCTS);
  assert.equal(resolved.source, 'product-metadata');
  assert.equal(resolved.story?.coreValue, 'คุณค่าที่เจ้าของแก้ในหลังบ้าน');
});

test('falls back to one uniquely matched safe catalog story when DB story is not populated yet', () => {
  const resolved = resolveOtopStoreStory({
    id: 'db-fallback',
    name: 'ผ้าไหมมัดหมี่ บ้านเขว้า',
    metadata: { provinceId: 'chaiyaphum' },
  }, CHAIYAPHUM_OTOP_PRODUCTS);
  assert.equal(resolved.source, 'catalog-fallback');
  assert.equal(resolved.catalogProductId, 'chaiyaphum-otop-001');
  assert.equal(resolved.story?.coreValue, CHAIYAPHUM_OTOP_PRODUCTS[0].coreValue);
});

test('never guesses a story when the catalog has no unique match', () => {
  const resolved = resolveOtopStoreStory({
    id: 'db-none',
    name: 'สินค้าที่ไม่รู้จัก',
    metadata: { provinceId: 'chaiyaphum' },
  }, CHAIYAPHUM_OTOP_PRODUCTS);
  assert.deepEqual(resolved, { story: null, source: null, catalogProductId: null });
});
