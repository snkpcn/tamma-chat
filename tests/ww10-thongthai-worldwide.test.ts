import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  isForeignLanguageCustomerMessage,
  shouldUseThongthaiAgentForeignLanguagePrimary,
} from '../netlify/functions/_thongthai-agent-primary';
import {THONGTHAI_READ_ONLY_TOOLS} from '../netlify/functions/_thongthai-agent-tools';

const read=(path:string)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('WW-10 keeps one canonical bridge instead of duplicating commerce authorities',()=>{
  const bridge=read('netlify/functions/_thongthai-worldwide-bridge.ts');
  assert.doesNotMatch(bridge,/\bdbFetch\b|\/rest\/v1\//);
  for(const authority of [
    'listOtopProducts',
    'loadExplicitProductPrice',
    'loadGlobalProductShippingProfiles',
    'createGlobalShippingQuote',
    'createCustomsComplianceSnapshot',
    'loadGlobalPaymentMethod',
    'getGuestGlobalCommerceStatus',
  ]) assert.match(bridge,new RegExp(authority));
  assert.doesNotMatch(bridge,/checkoutInternationalOtopOrder|createGlobalPaymentIntent|createInternationalReturnRequest/);
});

test('WW-10 worldwide tool is read-only and production has no new international commit tool',()=>{
  const names=THONGTHAI_READ_ONLY_TOOLS.map(tool=>tool.name);
  assert.ok(names.includes('get_worldwide_offer'));
  assert.equal(names.filter(name=>name==='get_worldwide_offer').length,1);
  assert.ok(!names.some(name=>/^(?:create|commit|refund|capture)_/i.test(name)));

  const tools=read('netlify/functions/_thongthai-agent-tools.ts');
  assert.match(tools,/name: 'get_worldwide_offer'/);
  assert.doesNotMatch(tools,/name: 'commit_worldwide|name: 'create_international_order|name: 'refund_global/);
});

test('WW-10 global status is guest-owned and does not expose address or contact PII',()=>{
  const source=read('netlify/functions/_global-fulfillment-db.ts');
  const start=source.indexOf('export async function getGuestGlobalCommerceStatus');
  assert.ok(start>=0);
  const block=source.slice(start);
  assert.match(block,/customer_accounts\?guest_id=eq\./);
  assert.match(block,/otop_orders\?customer_id=eq\./);
  assert.match(block,/checkout_version=eq\.2/);
  assert.doesNotMatch(block,/shipping_address_snapshot_v2|shipping_recipient_name_enc|shipping_phone_enc/);
});

test('WW-10 foreign-language routing is script-agnostic but never turns language into destination',()=>{
  for(const message of [
    'Can you ship this to Sweden?',
    'Können Sie das nach Schweden liefern?',
    '可以寄到瑞典吗？',
    'ສົ່ງໄປສະວີເດັນໄດ້ບໍ?',
    'Kan ni skicka till Sverige?',
  ]) assert.equal(isForeignLanguageCustomerMessage(message),true);
  assert.equal(isForeignLanguageCustomerMessage('ส่งไปสวีเดนได้ไหมครับ'),false);

  const before={
    enabled:process.env.THONGTHAI_AGENT_PRIMARY_ENABLED,
    channels:process.env.THONGTHAI_AGENT_PRIMARY_CHANNELS,
  };
  try{
    delete process.env.THONGTHAI_AGENT_PRIMARY_ENABLED;
    delete process.env.THONGTHAI_AGENT_PRIMARY_CHANNELS;
    assert.equal(shouldUseThongthaiAgentForeignLanguagePrimary({
      guestKey:'guest-ww10',
      guestDbId:'11111111-1111-4111-8111-111111111111',
      channel:'facebook',
      explicitTransactionIntent:false,
      weatherRequest:false,
      locationRequest:false,
    }),false,'master Agent routing must remain gated by runtime config');
  }finally{
    if(before.enabled===undefined)delete process.env.THONGTHAI_AGENT_PRIMARY_ENABLED;
    else process.env.THONGTHAI_AGENT_PRIMARY_ENABLED=before.enabled;
    if(before.channels===undefined)delete process.env.THONGTHAI_AGENT_PRIMARY_CHANNELS;
    else process.env.THONGTHAI_AGENT_PRIMARY_CHANNELS=before.channels;
  }
});

test('WW-10 Agent profile says country, language, quote and order are separate facts',()=>{
  const profile=read('netlify/functions/_thongthai-agent-profile.ts');
  assert.match(profile,/get_worldwide_offer/);
  assert.match(profile,/Never infer destination country, shipping country, market, or payment currency from language alone/);
  assert.match(profile,/checkout ready" is not the same as "order placed"/);
  assert.match(profile,/Never invent a rate, carrier, customs amount, tax, delivery time, conversion, or market availability/);
});

test('WW-10 restores the real WW-9 audit and is chained after it in Netlify',()=>{
  const pkg=JSON.parse(read('package.json')) as {scripts:Record<string,string>};
  assert.match(pkg.scripts['audit:ww9']??'',/ww9-global-fulfillment\.test\.ts/);
  assert.doesNotMatch(pkg.scripts['audit:ww9']??'',/DIAGNOSTIC_SKIP/);
  assert.match(pkg.scripts['audit:ww10']??'',/ww10-thongthai-worldwide\.test\.ts/);

  const gate=read('scripts/netlify-build-gate.mjs');
  const ww9=gate.indexOf("'audit-ww9'");
  const ww10=gate.indexOf("'audit-ww10'");
  assert.ok(ww9>=0&&ww10>ww9);
});

test('WW-10 saved production Agent sync is triggered by canonical profile/tool changes',()=>{
  const workflow=read('.github/workflows/thongthai-production-agent-sync.yml');
  assert.match(workflow,/netlify\/functions\/_thongthai-agent-profile\.ts/);
  assert.match(workflow,/netlify\/functions\/_thongthai-agent-tools\.ts/);
  assert.match(workflow,/npm run agent:thongthai:production/);
});


test('WW-10 routes foreign and worldwide fact turns to one Saved Agent voice without bypassing transaction safety',()=>{
  const chat=read('netlify/functions/thongthai-chat.ts');
  assert.match(chat,/THONGTHAI_PRIORITY_WORLDWIDE_READ_RE/);
  assert.match(chat,/const openLanguageOrWorldwidePriority/);
  assert.match(chat,/isForeignLanguageCustomerMessage\(request\.message\)/);
  assert.match(chat,/cafeStateForPrePrimary !== null && !openLanguageOrWorldwidePriority/);
  assert.match(chat,/!explicitTransactionIntent && THONGTHAI_PRIORITY_WORLDWIDE_READ_RE\.test/);
  assert.match(chat,/const readOnlyPrimaryAgentEligible = !phase3SemanticLearningEligible/);
  assert.match(chat,/openLanguageOrWorldwidePriority[\s\S]*shouldUseThongthaiAgentPrimary/);
});
