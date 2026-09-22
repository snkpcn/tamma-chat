import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  formatExperienceDiscoveryMessage,
  isExperienceDiscoveryIntent,
} from '../netlify/functions/_experience-discovery';

test('recognizes the exact broad discovery phrases customers use in LINE', () => {
  assert.equal(isExperienceDiscoveryIntent('มีประสบการณ์อะไรบ้าง'), true);
  assert.equal(isExperienceDiscoveryIntent('มีอะไรทำบ้าง'), true);
  assert.equal(isExperienceDiscoveryIntent('มีกิจกรรมอะไรบ้าง'), true);
  assert.equal(isExperienceDiscoveryIntent('ที่นี่มีอะไรให้ทำบ้าง'), true);
});

test('understands colloquial Thai and small typos instead of requiring an exact phrase', () => {
  assert.equal(isExperienceDiscoveryIntent('มีไรทำมั่ง'), true);
  assert.equal(isExperienceDiscoveryIntent('มีไรทำมั้ง'), true);
  assert.equal(isExperienceDiscoveryIntent('มีรัยทำมั่งครับ'), true);
  assert.equal(isExperienceDiscoveryIntent('มีอารัยทำบ้าง'), true);
  assert.equal(isExperienceDiscoveryIntent('มีไลทำมั่ง'), true);
  assert.equal(isExperienceDiscoveryIntent('มีอะไลทำบ้างง'), true);
});

test('punctuation, spacing and polite endings do not break discovery intent', () => {
  assert.equal(isExperienceDiscoveryIntent('มีอะไร ทำบ้างครับ?'), true);
  assert.equal(isExperienceDiscoveryIntent('ที่นี่ มีอะไรให้ทำมั่งคะ'), true);
  assert.equal(isExperienceDiscoveryIntent('มีกิจกรรมอะไรบ้างหน่อยครับ'), true);
});

test('first-visit generic recommendation stays ecosystem-wide', () => {
  assert.equal(isExperienceDiscoveryIntent('มาครั้งแรก มีอะไรแนะนำ'), true);
});

test('restaurant-specific recommendation is not hijacked by ecosystem discovery', () => {
  assert.equal(isExperienceDiscoveryIntent('ที่ร้านมีอะไรแนะนำ'), false);
  assert.equal(isExperienceDiscoveryIntent('อาหารแนะนำมีอะไรบ้าง'), false);
});

test('discovery copy uses live active activity names when inventory exists', () => {
  const message = formatExperienceDiscoveryMessage([{
    fact_key:'activity_catalog_live',
    fact_value:{
      activities:[
        { name:'ขี่ม้า', activeInventory:2 },
        { name:'ATV', activeInventory:3 },
        { name:'ยิงธนู', activeInventory:1 },
      ],
    },
  }]);

  assert.match(message, /ตำมา-ชาติ/);
  assert.match(message, /ทำมา-ชาติ เฮือนสเตย์/);
  assert.match(message, /ขี่ม้า \/ ATV \/ ยิงธนู/);
  assert.match(message, /เดินชมพื้นที่กลาง/);
  assert.match(message, /ชมพระอาทิตย์ตก/);
  assert.doesNotMatch(message, /คิดช้ากว่าปกติ/);
  assert.doesNotMatch(message, /ลองส่งอีกครั้ง/);
});

test('inactive activity inventory is not advertised as currently playable', () => {
  const message = formatExperienceDiscoveryMessage([{
    fact_key:'activity_catalog_live',
    fact_value:{
      activities:[
        { name:'ขี่ม้า', activeInventory:0 },
        { name:'ATV', activeInventory:0 },
      ],
    },
  }]);

  assert.match(message, /ทำมา-ชาติ ผจญภัย/);
  assert.doesNotMatch(message, /ขี่ม้า \/ ATV/);
});


test('gateway preserves broad experience discovery fast path when One-Mind cutover is enabled', () => {
  const source = readFileSync('netlify/functions/thongthai-chat.ts', 'utf8');
  assert.match(
    source,
    /const preserveExperienceDiscoveryFastPath = isExperienceDiscoveryIntent\(request\.message\);/,
  );
  assert.match(
    source,
    /THONGTHAI_ONE_MIND_CUTOVER === '1' && !preserveExperienceDiscoveryFastPath/,
  );
});

test('gateway answers discovery before broad activity routing can swallow it', () => {
  const source = readFileSync('netlify/functions/thongthai-chat.ts', 'utf8');
  assert.ok(
    source.indexOf('const experienceDiscovery = deterministicExperienceDiscoveryResponse(request, runtime);')
      < source.indexOf('const deterministicActivity = await deterministicActivityResponse('),
  );
});
