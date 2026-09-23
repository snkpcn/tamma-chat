import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeThai,
  interpretFear,
  interpretExperience,
  interpretHealthConcerns,
  interpretOverallHealthConcern,
  interpretCustomerType,
  prefersGentleIntensity,
  prefersLowWalking,
  mentionsWeatherGroundConcern,
  asksIfSafe,
  mentionsSpeedFear,
  interpretActivityGoal,
  interpretFirmnessPreference,
  mentionsWeightOrSizeConcern,
  mentionsSupportRequest,
  mentionsBrakeQuestion,
  mentionsChildPassengerQuestion,
  wantsIntenseExperience,
} from '../netlify/functions/_semantic-hospitality-interpreter';

test('normalizeThai fixes only unambiguous typos from the owner-supplied list', () => {
  assert.equal(normalizeThai('อยากขี้ม้า'), 'อยากขี่ม้า');
  assert.equal(normalizeThai('เอาทองทัย'), 'เอาทองไทย');
  assert.equal(normalizeThai('เอาทองไท'), 'เอาทองไทย');
  assert.equal(normalizeThai('ทองไทย'), 'ทองไทย', 'must not double-mangle the already-correct spelling');
  assert.equal(normalizeThai('พาราดรนิ่มกว่าใช่ไหม'), 'ภาราดรนิ่มกว่าใช่ไหม');
  assert.equal(normalizeThai('ภาราดอนตัวนี้'), 'ภาราดรตัวนี้');
  assert.equal(normalizeThai('กังวนเรื่องตกม้า'), 'กังวลเรื่องตกม้า');
});

test('interpretFear: concern vs explicit no-concern, correctly disambiguating negation', () => {
  assert.equal(interpretFear('กลัวนิดนึง'), 'concerned');
  assert.equal(interpretFear('ไม่ค่อยมั่นใจ'), 'concerned');
  assert.equal(interpretFear('กังวลนิดนึง'), 'concerned');
  assert.equal(interpretFear('กังวนเรื่องตกม้า'), 'concerned', 'typo กังวน must still be read as concern');
  assert.equal(interpretFear('ไม่กังวลครับ'), 'not_worried');
  assert.equal(interpretFear('ไม่กลัวครับ'), 'not_worried');
  assert.equal(interpretFear('อยากกินข้าว'), null, 'unrelated text must not fabricate a fear signal');
});

test('interpretExperience: beginner vs experienced phrasing', () => {
  assert.equal(interpretExperience('ไม่เคยครับมาคนเดียว'), 'beginner');
  assert.equal(interpretExperience('มือใหม่ครับ'), 'beginner');
  assert.equal(interpretExperience('ครั้งแรกครับ'), 'beginner');
  assert.equal(interpretExperience('ขี่ไม่เป็นครับ'), 'beginner');
  assert.equal(interpretExperience('เคยขี่มาก่อนครับ'), 'experienced');
  assert.equal(interpretExperience('สวัสดีครับ'), null);
});

test('interpretHealthConcerns: per body part, negation disambiguated from positive concern', () => {
  assert.deepEqual(interpretHealthConcerns('ไม่ปวดหลัง'), { back: false });
  assert.deepEqual(interpretHealthConcerns('ปวดหลังครับ'), { back: true });
  assert.deepEqual(interpretHealthConcerns('เข่าไม่ค่อยดี'), { knee: true });
  assert.deepEqual(interpretHealthConcerns('สะโพกไม่มีปัญหา'), { hip: false });
  assert.deepEqual(interpretHealthConcerns('เจ็บไหล่'), { shoulder: true });
  assert.deepEqual(interpretHealthConcerns('ขาไม่ค่อยดี'), { knee: true }, 'leg complaint folds into the knee/mobility bucket');
});

test('interpretOverallHealthConcern: coarse none/present signal matching the existing horse-care flow shape', () => {
  assert.equal(interpretOverallHealthConcern('ไม่กังวลครับ'), 'none');
  assert.equal(interpretOverallHealthConcern('ไม่ปวดหลัง'), 'none');
  assert.equal(interpretOverallHealthConcern('ผมไม่เคยขี่ครับ ไม่กังวลครับ ไม่ปวดหลัง'), 'none');
  assert.equal(interpretOverallHealthConcern('เข่าไม่ค่อยดี'), 'present');
  assert.equal(interpretOverallHealthConcern('กังวลเรื่องทรงตัว'), 'present');
  assert.equal(interpretOverallHealthConcern('สวัสดีครับ'), null);
});

test('interpretCustomerType: elderly companion and child, with age when stated', () => {
  assert.deepEqual(interpretCustomerType('แม่อยากขี่ม้า เข่าไม่ค่อยดี'), { kind: 'elderly', ageYears: null });
  assert.deepEqual(interpretCustomerType('พ่ออยากลองATV'), { kind: 'elderly', ageYears: null });
  assert.deepEqual(interpretCustomerType('เด็ก 8 ขวบอยากขี่'), { kind: 'child', ageYears: 8 });
  assert.deepEqual(interpretCustomerType('เด็กขึ้นได้ไหม'), { kind: 'child', ageYears: null });
  assert.equal(interpretCustomerType('แม่ครัวทำอาหารเก่งมาก'), null, 'must never false-positive on the compound noun แม่ครัว');
  assert.equal(interpretCustomerType('แม่บ้านดูแลดี'), null, 'must never false-positive on the compound noun แม่บ้าน');
  assert.deepEqual(interpretCustomerType('ลูก 8 ขวบอยากขี่'), { kind: 'child', ageYears: 8 }, 'ลูก (one\'s own child) must be recognized, not only เด็ก');
  assert.equal(interpretCustomerType('ลูกค้าต้องการอะไร'), null, 'must never false-positive on the compound noun ลูกค้า');
  assert.equal(interpretCustomerType('ลูกทีมดูแลดี'), null, 'must never false-positive on the compound noun ลูกทีม');
  assert.deepEqual(interpretCustomerType('พาแม่ไป อยากได้เดินน้อย'), { kind: 'elderly', ageYears: null }, 'พา...ไป phrasing must be recognized, not only พา...มา');
});

test('prefersLowWalking', () => {
  assert.equal(prefersLowWalking('อยากได้เดินน้อย'), true);
  assert.equal(prefersLowWalking('ไม่อยากเดินเยอะ'), true);
  assert.equal(prefersLowWalking('อยากขี่ม้า'), false);
});

test('prefersGentleIntensity / mentionsWeatherGroundConcern / asksIfSafe / mentionsSpeedFear', () => {
  assert.equal(prefersGentleIntensity('เอาแบบไม่โหดนะ'), true);
  assert.equal(prefersGentleIntensity('เอาแบบชิลๆ'), true);
  assert.equal(prefersGentleIntensity('อยากขี่ม้า'), false);
  assert.equal(mentionsWeatherGroundConcern('ฝนตกเมื่อกี้ ขี่ม้าได้ไหม'), true);
  assert.equal(mentionsWeatherGroundConcern('พื้นลื่นไหม'), true);
  assert.equal(asksIfSafe('ปลอดภัยไหม'), true);
  assert.equal(asksIfSafe('ขอแบบปลอดภัยที่สุด'), true);
  assert.equal(asksIfSafe('อยากขี่ม้า'), false);
  assert.equal(mentionsSpeedFear('กลัวเร็ว'), true);
  assert.equal(mentionsSpeedFear('ขอช้าๆ'.replace('ๆ', ' ๆ')), true);
});

test('interpretActivityGoal: photo-only vs touch-only vs no goal stated', () => {
  assert.equal(interpretActivityGoal('ขอถ่ายรูปกับม้าเฉย ๆ ได้ไหม'), 'photo_only');
  assert.equal(interpretActivityGoal('ขอแค่ถ่ายรูป'), 'photo_only');
  assert.equal(interpretActivityGoal('ดูม้าเฉย ๆ ได้ไหม'), 'touch_only');
  assert.equal(interpretActivityGoal('ให้อาหารม้าได้ไหม'), 'touch_only');
  assert.equal(interpretActivityGoal('อยากขี่ม้า'), null);
});

test('interpretFirmnessPreference: softer vs firmer horse preference', () => {
  assert.equal(interpretFirmnessPreference('เอาตัวนิ่มกว่า'), 'softer');
  assert.equal(interpretFirmnessPreference('เอาตัวที่ขี่แน่นกว่า'), 'firmer');
  assert.equal(interpretFirmnessPreference('อยากขี่ม้า'), null);
});

test('mentionsWeightOrSizeConcern / mentionsSupportRequest / mentionsBrakeQuestion / mentionsChildPassengerQuestion / wantsIntenseExperience', () => {
  assert.equal(mentionsWeightOrSizeConcern('ผมตัวใหญ่ ขี่ได้ไหม'), true);
  assert.equal(mentionsWeightOrSizeConcern('น้ำหนักเยอะ ขี่ได้ไหม'), true);
  assert.equal(mentionsWeightOrSizeConcern('อยากขี่ม้า'), false);
  assert.equal(mentionsSupportRequest('ให้คนจูงได้ไหม'), true);
  assert.equal(mentionsSupportRequest('มีคนจูงไหม'), true);
  assert.equal(mentionsBrakeQuestion('ถ้าเบรกไม่เป็นทำไง'), true);
  assert.equal(mentionsChildPassengerQuestion('เด็กซ้อน ATV ได้ไหม'), true);
  assert.equal(mentionsChildPassengerQuestion('ซ้อนเฉย ๆ ได้ไหม'), true);
  assert.equal(wantsIntenseExperience('อยากมันส์ ๆ เร็ว ๆ'), true);
  assert.equal(wantsIntenseExperience('รถแรงไหม'), true);
});
