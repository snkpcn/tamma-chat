import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../otop.html', import.meta.url), 'utf8');
const manifest = JSON.parse(await readFile(new URL('../assets/brand/otop/hero/hero-video-manifest.json', import.meta.url), 'utf8'));

test('OTOP marketplace opens with the locked owner-selected hero film', () => {
  assert.ok(html.includes('id="showcase"'));
  assert.ok(html.includes('id="showcaseVideo"'));
  assert.ok(html.includes('min-height:100svh'));
  assert.ok(html.includes(manifest.variants.desktop.url));
  assert.ok(html.includes(manifest.variants.mobile.url));
  assert.equal(manifest.policy.contentLocked, true);
  assert.equal(manifest.policy.allowRegeneration, false);
  assert.equal(manifest.variants.desktop.durationSeconds, manifest.source.durationSeconds);
  assert.equal(manifest.variants.mobile.durationSeconds, manifest.source.durationSeconds);
});

test('showcase respects reduced motion and has a non-video fallback', () => {
  assert.ok(html.includes('poster="assets/brand/backgrounds/ban-khwao-silk-weaving-4k.webp"'));
  assert.ok(html.includes('prefers-reduced-motion:reduce'));
  assert.ok(html.includes("const reduce=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches"));
});

test('mobile commerce cards keep the product image unobstructed', () => {
  assert.ok(html.includes('.grid{grid-template-columns:1fr;gap:34px}'));
  assert.ok(html.includes('.card{border:0;border-radius:0;background:transparent;overflow:visible;box-shadow:none}'));
  assert.ok(html.includes('.photo{aspect-ratio:1/1;border-radius:20px'));
  assert.ok(html.includes('.cardBody{padding:0 4px}'));
});

test('product detail remains story-first after showcase redesign', () => {
  assert.ok(html.includes('เรื่องของชิ้นนี้'));
  assert.ok(html.includes('VALUE OF THIS PIECE'));
  assert.ok(html.includes("item('วิธีทำ',s.craftProcess,true)"));
  assert.ok(html.includes("item('ทำไมต้องเป็นที่นี่',s.whyHere,true)"));
});
