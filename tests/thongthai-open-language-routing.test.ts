import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { isOpenLanguageCustomerTurn } from '../netlify/functions/thongthai-chat';
import { THONGTHAI_READ_ONLY_TOOLS } from '../netlify/functions/_thongthai-agent-tools';

test('open-language routing recognizes arbitrary customer languages even outside the five storefront dictionaries', () => {
  assert.equal(isOpenLanguageCustomerTurn('Können Sie nach Schweden liefern?', 'en'), true);
  assert.equal(isOpenLanguageCustomerTurn('Säljer ni till Sverige?', 'en'), true);
  assert.equal(isOpenLanguageCustomerTurn('日本まで配送できますか？', 'th'), true, 'legacy web metadata may fall back to th but raw Japanese text must still route open-language');
  assert.equal(isOpenLanguageCustomerTurn('¿Cuánto cuesta el envío?', 'en'), true);
  assert.equal(isOpenLanguageCustomerTurn('วันนี้ส่งไปสวีเดนได้ไหมครับ', 'th'), false);
  assert.equal(isOpenLanguageCustomerTurn('12345', 'en'), false);
});

test('open-language route is actually wired to the Saved Agent instead of remaining dead code', () => {
  const source=readFileSync(new URL('../netlify/functions/thongthai-chat.ts',import.meta.url),'utf8');
  assert.match(source,/shouldUseThongthaiAgentForeignLanguagePrimary/u);
  assert.match(source,/const foreignLanguagePrimarySelected/u);
  assert.match(source,/foreignLanguagePrimarySelected \|\| ordinaryPrimarySelected/u);
  assert.match(source,/cafeStateForPrePrimary !== null && !foreignLanguagePrimarySelected/u);
});

test('shipping policy lookup does not force a subtotal before eligibility/policy can be answered', () => {
  const shipping=THONGTHAI_READ_ONLY_TOOLS.find(tool=>tool.name==='get_shipping_quote');
  assert.ok(shipping);
  const required=shipping!.parameters.required as string[];
  assert.deepEqual(required,['country_code']);
});

test('canonical any-language fact tools include location and current weather', () => {
  const names=new Set(THONGTHAI_READ_ONLY_TOOLS.map(tool=>tool.name));
  assert.ok(names.has('get_current_weather'));
  assert.ok(names.has('get_location_info'));
});
