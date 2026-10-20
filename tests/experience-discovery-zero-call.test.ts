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

/** Broad-discovery phrasings that, WITHOUT the fast-path guard, reach a
 *  paid visitor path under THONGTHAI_VISITOR_UNDERSTANDING /
 *  THONGTHAI_VISITOR_WEB_SEARCH: the first five reach the visitor
 *  interpreter (OpenAI), the last reaches the activity_opening web search
 *  (Tavily). DISCOVERY_MESSAGES above resolve through knownTopic and never
 *  reach either path, so they cannot detect a missing guard. */
const PAID_PATH_DISCOVERY_MESSAGES = [
  'ที่นี่มีอะไรให้เล่นบ้างไหม',
  'แถวนี้มีอะไรเที่ยวดีไหม',
  'ประสบการณ์ที่นี่มีอะไรบ้างไหม',
  'มีกิจกรรมอะไรให้เด็กเล่นไหม',
  'ที่ทำมา-ชาติมีอะไรทำบ้างไหม',
  'กิจกรรมเปิดยัง',
];

/** Non-discovery visitor questions that DO pay with the flags on: proof
 *  that the counter below sees a paid call when one happens. */
const PAID_CONTROL_MESSAGES = ['ที่นี่เหมาะกับคนแก่ไหม', 'มี wifi ไหม'];

async function paidCallsForTurn(message: string, understanding: '0' | '1'): Promise<string[]> {
  const { withHarness, brainRequest, guestId } = await import('./helpers/canonical-core-harness');
  const { processThongthaiChatCore } = await import('../netlify/functions/thongthai-chat');
  const { clearVisitorSearchCacheForTests } = await import('../netlify/functions/_visitor-web-search');
  const keys = ['THONGTHAI_VISITOR_UNDERSTANDING', 'THONGTHAI_VISITOR_WEB_SEARCH', 'TAVILY_API_KEY'] as const;
  const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.THONGTHAI_VISITOR_UNDERSTANDING = understanding;
  process.env.THONGTHAI_VISITOR_WEB_SEARCH = understanding;
  process.env.TAVILY_API_KEY = 'test-key';
  clearVisitorSearchCacheForTests();
  try {
    return await withHarness(async harness => {
      const paid: string[] = [];
      global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(typeof input === 'string' ? input : (input as Request).url ?? input);
        if (/api\.openai\.com|api\.tavily\.com/u.test(url)) paid.push(url);
        return harness.fetchMock(input, init);
      }) as typeof fetch;
      await processThongthaiChatCore(
        brainRequest(message, guestId(`zero-call-${understanding}-${message}`), 'line') as never,
        `zero-call-${understanding}-${message}`,
      );
      return paid;
    });
  } finally {
    clearVisitorSearchCacheForTests();
    for (const key of keys) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  }
}

test('a whole discovery turn makes no paid call, THONGTHAI_VISITOR_UNDERSTANDING off AND on', async () => {
  // Drives the real core end to end with Supabase and both providers
  // mocked, counting every request to OpenAI or Tavily for the WHOLE turn
  // (visitor interpretation, web search, One-Mind semantic, composer).
  // Verified to fail when the guard is removed from either paid visitor
  // path: each message below then pays exactly one call.
  for (const understanding of ['0', '1'] as const) {
    for (const message of [...DISCOVERY_MESSAGES, ...PAID_PATH_DISCOVERY_MESSAGES]) {
      assert.equal(isExperienceDiscoveryIntent(message), true, `${message} must be broad discovery`);
      assert.deepEqual(
        await paidCallsForTurn(message, understanding), [],
        `THONGTHAI_VISITOR_UNDERSTANDING=${understanding}: "${message}" must cost nothing`,
      );
    }
  }
});

test('the paid-call counter does see a paid visitor call when one happens', async () => {
  // Without this, the zero-call assertion above could pass vacuously.
  for (const message of PAID_CONTROL_MESSAGES) {
    assert.equal(isExperienceDiscoveryIntent(message), false);
    const paid = await paidCallsForTurn(message, '1');
    assert.ok(paid.length > 0, `"${message}" is not discovery and must reach a paid path with the flags on`);
  }
});

test('the broad-discovery guard is declared above the turn first paid path', () => {
  const declaration = CHAT_SOURCE.indexOf('const preserveExperienceDiscoveryFastPath =');
  const visitorUnderstanding = CHAT_SOURCE.indexOf("process.env.THONGTHAI_VISITOR_UNDERSTANDING==='1'");
  const visitorSearch = CHAT_SOURCE.indexOf("callerLabel:'visitor-web-search'");
  assert.ok(declaration > 0 && visitorUnderstanding > 0 && visitorSearch > 0);
  assert.ok(
    declaration < visitorUnderstanding,
    'the guard must be evaluated before the paid visitor interpretation',
  );
  assert.ok(declaration < visitorSearch, 'and before the paid search credit');
  // Both PAID visitor paths must actually consult it.
  assert.match(
    CHAT_SOURCE.slice(visitorUnderstanding - 200, visitorUnderstanding + 40),
    /!preserveExperienceDiscoveryFastPath/u,
    'the paid visitor interpretation must honour the fast path',
  );
  assert.match(
    CHAT_SOURCE.slice(visitorSearch - 400, visitorSearch),
    /!preserveExperienceDiscoveryFastPath/u,
    'the paid web search must honour the fast path',
  );
});

test('the FREE visitor answer is deliberately not gated by the fast path', () => {
  // isExperienceDiscoveryIntent claims any message containing "กิจกรรม"
  // (see hasDiscoveryShape in _experience-discovery.ts), which is far wider
  // than broad discovery. Gating the deterministic answerVisitorInformation
  // on it regressed 8 cases in tests/visitor-basic-questions.test.ts --
  // questions like "มีแพ็กเกจที่พักรวมอาหารและกิจกรรมไหม" lost their real
  // answer and got the generic catalog blurb instead. Only paid paths may
  // be skipped.
  const call = CHAT_SOURCE.indexOf('await answerVisitorInformation({');
  assert.ok(call > 0, 'the free visitor answer must still be reachable');
  const assignment = CHAT_SOURCE.slice(CHAT_SOURCE.lastIndexOf('let visitorInformation', call), call);
  assert.ok(
    !assignment.includes('preserveExperienceDiscoveryFastPath'),
    'the free deterministic visitor answer must not be gated on broad discovery',
  );
});

test('the discovery answer itself reaches no provider', async () => {
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
