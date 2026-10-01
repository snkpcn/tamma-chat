import assert from 'node:assert/strict';
import test from 'node:test';
import { otopStorySearchText, publicOtopStory } from '../netlify/functions/_otop-store-story';

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
