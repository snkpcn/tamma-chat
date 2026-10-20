import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  formatExperienceDiscoveryMessage,
  isExperienceDiscoveryIntent,
} from '../netlify/functions/_experience-discovery';

const CHAT_SOURCE = readFileSync(
  new URL('../netlify/functions/thongthai-chat.ts', import.meta.url),
  'utf8',
);

/** The three phrasings this task names, plus the colloquial LINE variants
 *  the shared matcher is documented to own. */
const DISCOVERY_MESSAGES = [
  'มีกิจกรรมอะไรบ้าง',
  'มีอะไรทำบ้าง',
  'ทำอะไรได้บ้าง',
];

function liveCatalog(names: string[]) {
  return [{
    fact_key:'activity_catalog_live',
    fact_value:{ activities:names.map(name => ({ name, activeInventory:2 })) },
  }];
}

test('the broad-discovery guard is evaluated before the first One-Mind gate', () => {
  const declaration = CHAT_SOURCE.indexOf('const preserveExperienceDiscoveryFastPath =');
  assert.ok(declaration > 0, 'the guard must still be computed');
  assert.equal(
    CHAT_SOURCE.split('const preserveExperienceDiscoveryFastPath =').length - 1, 1,
    'exactly one declaration, reused by both gates',
  );

  // Both One-Mind entry gates, in source order.
  const gates = [...CHAT_SOURCE.matchAll(/if \(process\.env\.THONGTHAI_ONE_MIND_CUTOVER === '1'/gu)]
    .map(match => match.index ?? -1)
    .filter(index => index >= 0);
  assert.ok(gates.length >= 2, `expected both One-Mind gates, found ${gates.length}`);

  assert.ok(
    declaration < gates[0],
    'the guard must be computed BEFORE the first gate, which is where the paid semantic call happens',
  );
  for (const [position, gate] of gates.slice(0, 2).entries()) {
    const condition = CHAT_SOURCE.slice(gate, CHAT_SOURCE.indexOf('{', CHAT_SOURCE.indexOf(') {', gate)));
    assert.match(
      condition, /!preserveExperienceDiscoveryFastPath/u,
      `One-Mind gate ${position + 1} must honour the broad-discovery fast path`,
    );
  }
});

test('the other four first-gate guards keep their exact scope', () => {
  const gate = CHAT_SOURCE.indexOf("if (process.env.THONGTHAI_ONE_MIND_CUTOVER === '1'");
  const condition = CHAT_SOURCE.slice(gate, CHAT_SOURCE.indexOf(') {', gate) + 3);
  for (const guard of [
    '!preserveVerifiedLocationBeforeSupervision',
    '!completeVisitorJourneyBeforeSupervision',
    '!restaurantTopicSwitchBeforePrimary',
    "topLevelSemanticIntent !== 'WEATHER_REQUEST'",
  ]) {
    assert.ok(condition.includes(guard), `${guard} must be unchanged on the first gate`);
  }
  // No guard gained or lost: five conditions plus the cutover flag.
  assert.equal((condition.match(/&&/gu) ?? []).length, 5);
});

test('a discovery turn never reaches a paid provider call', async () => {
  // Any outbound request at all would be either OpenAI or a backend read on
  // the paid path. The deterministic answer needs neither: it is rendered
  // from world facts already loaded for the turn.
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = (async (input: RequestInfo | URL) => {
    calls += 1;
    throw new Error(`unexpected network call to ${String(input)}`);
  }) as typeof fetch;
  try {
    for (const message of DISCOVERY_MESSAGES) {
      assert.equal(isExperienceDiscoveryIntent(message), true, `${message} must match the fast path`);
      const reply = formatExperienceDiscoveryMessage(liveCatalog(['ขี่ม้า', 'ยิงธนู']));
      assert.ok(reply.includes('ขี่ม้า'), 'the verified catalog must drive the answer');
    }
    assert.equal(calls, 0, 'the discovery answer must cost zero calls');
  } finally {
    global.fetch = originalFetch;
  }
});

test('the answer lists only bookable activities from the live catalog', () => {
  const facts = [{
    fact_key:'activity_catalog_live',
    fact_value:{ activities:[
      { name:'ขี่ม้า', activeInventory:3 },
      { name:'ยิงธนู', activeInventory:0 },
      { name:'ATV', activeInventory:1 },
    ] },
  }];
  const reply = formatExperienceDiscoveryMessage(facts);
  assert.ok(reply.includes('ขี่ม้า'));
  assert.ok(reply.includes('ATV'));
  assert.ok(!reply.includes('ยิงธนู'), 'an activity with no inventory must not be offered');
});

test('an empty live catalog says so instead of inventing a category', () => {
  const reply = formatExperienceDiscoveryMessage([{
    fact_key:'activity_catalog_live',
    fact_value:{ activities:[] },
  }]);
  assert.match(reply, /ยังไม่มีรอบกิจกรรมเปิด/u, 'a verified empty catalog must be stated plainly');
  assert.ok(
    !reply.includes('ผจญภัย'),
    'the static adventure catalog name must not stand in for live inventory',
  );
});

test('an all-sold-out catalog is reported as empty, not as unavailable', () => {
  const reply = formatExperienceDiscoveryMessage([{
    fact_key:'activity_catalog_live',
    fact_value:{ activities:[{ name:'ขี่ม้า', activeInventory:0 }] },
  }]);
  assert.match(reply, /ยังไม่มีรอบกิจกรรมเปิด/u);
  assert.ok(!reply.includes('ขี่ม้า'));
  assert.ok(!/เช็กรายการกิจกรรมล่าสุดไม่ได้/u.test(reply), 'the source DID answer; do not claim otherwise');
});

test('an unavailable live catalog hands off instead of answering confidently', () => {
  for (const facts of [
    [],
    [{ fact_key:'something_else', fact_value:{} }],
    [{ fact_key:'activity_catalog_live', fact_value:null }],
    [{ fact_key:'activity_catalog_live', fact_value:{} }],
    [{ fact_key:'activity_catalog_live', fact_value:{ activities:'not-an-array' } }],
  ]) {
    const reply = formatExperienceDiscoveryMessage(facts);
    assert.match(
      reply, /ยังเช็กรายการกิจกรรมล่าสุดไม่ได้/u,
      `an unverified source must say so: ${JSON.stringify(facts)}`,
    );
    assert.match(reply, /แอดมิน/u, 'an unverified activity list must hand off to staff');
    assert.ok(
      !reply.includes('ผจญภัย'),
      'the static adventure catalog name must not imply live availability',
    );
    assert.ok(
      !/ยังไม่มีรอบกิจกรรมเปิด/u.test(reply),
      'an unavailable source must not be reported as a verified empty list',
    );
  }
});

test('restaurant questions are still not stolen by the discovery fast path', () => {
  for (const message of [
    'ร้านอาหารมีอะไรแนะนำ',
    'มีเมนูอะไรบ้าง',
    'กินอะไรดี',
    'ที่ร้านมีอะไรแนะนำบ้าง',
    'อาหารแนะนำมีอะไร',
  ]) {
    assert.equal(
      isExperienceDiscoveryIntent(message), false,
      `${message} belongs to the restaurant responder, not broad discovery`,
    );
  }
});

test('the fast path does not claim unrelated turns', () => {
  for (const message of [
    'ขอจองโต๊ะ 4 คน',
    'ขี่ม้าราคาเท่าไหร่',
    'ห้องพักว่างไหม',
    'ขอเงินคืน',
  ]) {
    assert.equal(isExperienceDiscoveryIntent(message), false, `${message} must not hit the fast path`);
  }
});
