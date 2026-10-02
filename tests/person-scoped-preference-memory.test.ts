import test from 'node:test';
import assert from 'node:assert/strict';
import { extractGuestPreferenceSignal } from '../netlify/functions/_customer-phrase-intelligence';

test('companion cafe preferences never become the customer durable preference',()=>{
  const s=extractGuestPreferenceSignal('วันนี้มากับแฟนครับ ผมชอบกาแฟเข้ม ๆ แต่แฟนไม่กินกาแฟ แล้วเราสองคนไม่ชอบหวานมาก');
  assert.equal(s.travelerType,'couple');
  assert.ok(s.addConstraints.includes('low_sweet'));
  assert.ok(!s.addConstraints.includes('no_coffee'));
  assert.ok(s.removeConstraints.includes('no_coffee'),'explicit self coffee preference clears a stale customer no_coffee flag');
});

test('companion milk avoidance stays companion-scoped',()=>{
  const s=extractGuestPreferenceSignal('แฟนเปลี่ยนใจครับ ไม่เอานมวัวด้วย แต่ไม่ได้แพ้นมนะ');
  assert.ok(!s.addConstraints.includes('no_cow_milk'));
});

test('companion shrimp allergy plus self can-eat does not poison customer allergy memory',()=>{
  const s=extractGuestPreferenceSignal('แฟนแพ้กุ้งครับ แต่ผมกินได้');
  assert.ok(!s.addConstraints.includes('shrimp_allergy'));
  assert.ok(s.removeConstraints.includes('shrimp_allergy'));
  assert.ok(s.removeConstraints.includes('no_shrimp'));
});

test('companion no-spicy plus self spicy correction is separated',()=>{
  const s=extractGuestPreferenceSignal('แฟนไม่กินเผ็ด แต่ผมกินเผ็ดได้ครับ');
  assert.ok(!s.addConstraints.includes('no_spicy'));
  assert.ok(s.removeConstraints.includes('no_spicy'));
});

test('a self-scoped cafe preference still persists normally',()=>{
  const s=extractGuestPreferenceSignal('ของผมไม่ใส่น้ำตาลเลยครับ');
  assert.ok(s.addConstraints.includes('no_sugar'));
});
