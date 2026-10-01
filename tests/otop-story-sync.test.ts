import assert from 'node:assert/strict';
import test from 'node:test';
import { CHAIYAPHUM_OTOP_PRODUCTS } from '../src/data/otop/products/chaiyaphum';
import { matchOtopStory, normalizeOtopProductName, storyMetadataFromCatalog } from '../src/data/otop/story-sync';

test('normalizes product names without losing Thai product meaning', () => {
  assert.equal(normalizeOtopProductName('ผ้าไหมมัดหมี่ บ้านเขว้า'), 'ผ้าไหมมัดหมี่บ้านเขว้า');
});

test('matches a live product with an origin suffix to one unique catalog story', () => {
  const match = matchOtopStory(
    { id: 'db-1', name: 'ผ้าไหมมัดหมี่ บ้านเขว้า', metadata: { provinceId: 'chaiyaphum' } },
    CHAIYAPHUM_OTOP_PRODUCTS,
  );
  assert.equal(match.ambiguous, false);
  assert.equal(match.product?.id, 'chaiyaphum-otop-001');
  assert.ok(match.score >= 20);
});

test('catalogProductId wins over fuzzy name matching', () => {
  const match = matchOtopStory(
    { id: 'db-2', name: 'สินค้าเปลี่ยนชื่อแล้ว', metadata: { provinceId: 'chaiyaphum', catalogProductId: 'chaiyaphum-otop-009' } },
    CHAIYAPHUM_OTOP_PRODUCTS,
  );
  assert.equal(match.product?.id, 'chaiyaphum-otop-009');
  assert.equal(match.score, 100);
});

test('story backfill preserves unrelated metadata and writes public gates', () => {
  const story = CHAIYAPHUM_OTOP_PRODUCTS[0];
  const metadata = storyMetadataFromCatalog({ image: 'keep.webp', other: 7 }, story);
  assert.equal(metadata.image, 'keep.webp');
  assert.equal(metadata.other, 7);
  assert.equal(metadata.catalogProductId, story.id);
  assert.equal(metadata.storyVerified, true);
  assert.equal((metadata.story as any).coreValue, story.coreValue);
  assert.equal((metadata.story as any).publicClaimSafe, true);
});
