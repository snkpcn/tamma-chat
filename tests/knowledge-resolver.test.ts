// Phase E core tests: Knowledge Resolver routing, precedence, empty/
// unavailable/unknown distinction, entity resolution, anti-overfetch and
// anti-hallucination guarantees. Network-free -- all sources are injected
// mock adapters (see _knowledge-resolver.ts's header for why: this module
// makes zero real DB calls of its own).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getGroundedFactValue, pickByPrecedence, resolveEntityIdentity, resolveKnowledge,
  type CanonicalCandidate, type GroundedFact, type KnowledgeRequest, type KnowledgeSourceAdapters,
  type KnowledgeSourceType, type SourceResult,
} from '../netlify/functions/_knowledge-resolver';
import type { SemanticDomain } from '../netlify/functions/_semantic-interpreter';

const NOW = new Date('2026-09-18T10:00:00.000Z');

function baseRequest(overrides: Partial<KnowledgeRequest> = {}): KnowledgeRequest {
  return { domain: 'restaurant', intent: 'ask', action: 'ask', entities: {}, constraints: [], needs: [], ...overrides };
}
function fact(key: string, value: unknown, domain: SemanticDomain, sourceId: string, sourceType: KnowledgeSourceType): GroundedFact {
  return { key, value, domain, sourceId, sourceType, authoritative: true, fetchedAt: NOW.toISOString() };
}
function okResult(sourceId: string, sourceType: KnowledgeSourceType, data: GroundedFact[]): SourceResult {
  return { status: 'ok', data, sourceId, sourceType, fetchedAt: NOW.toISOString() };
}
function emptyResult(sourceId: string, sourceType: KnowledgeSourceType): SourceResult {
  return { status: 'empty', sourceId, sourceType, fetchedAt: NOW.toISOString() };
}
function unavailableResult(sourceId: string, sourceType: KnowledgeSourceType, error: string): SourceResult {
  return { status: 'unavailable', sourceId, sourceType, fetchedAt: NOW.toISOString(), error };
}
function spy<T extends (...args: never[]) => unknown>(impl: T): T & { calls: number } {
  const wrapped = ((...args: Parameters<T>) => { wrapped.calls += 1; return impl(...args); }) as T & { calls: number };
  wrapped.calls = 0;
  return wrapped;
}

// [1] restaurant query routes only restaurant source
test('restaurant query routes only the restaurant source, never activity/promotion', async () => {
  const restaurantMenu = spy(async () => okResult('restaurant_menu', 'restaurant_live', [fact('menu:tam_thai', { orderable: true }, 'restaurant', 'restaurant_menu', 'restaurant_live')]));
  const activityCatalog = spy(async () => okResult('activity_catalog', 'activity_live', []));
  const promotionEligibility = spy(async () => okResult('promotions', 'promotion_runtime', []));
  const adapters: KnowledgeSourceAdapters = { restaurant: { menu: restaurantMenu }, activity: { catalog: activityCatalog }, promotion: { eligibility: promotionEligibility } };
  const bundle = await resolveKnowledge(baseRequest({ domain: 'restaurant', needs: ['catalog'] }), adapters, NOW);
  assert.equal(restaurantMenu.calls, 1);
  assert.equal(activityCatalog.calls, 0);
  assert.equal(promotionEligibility.calls, 0);
  assert.equal(bundle.facts[0]?.sourceType, 'restaurant_live');
});

// [2] activity query routes activity source
test('activity query routes only the activity source', async () => {
  const activityCatalog = spy(async () => okResult('activity_catalog', 'activity_live', [fact('activity:horse', { name: 'ขี่ม้า' }, 'activity', 'activity_catalog', 'activity_live')]));
  const restaurantMenu = spy(async () => okResult('restaurant_menu', 'restaurant_live', []));
  const adapters: KnowledgeSourceAdapters = { activity: { catalog: activityCatalog }, restaurant: { menu: restaurantMenu } };
  const bundle = await resolveKnowledge(baseRequest({ domain: 'activity', needs: ['catalog'] }), adapters, NOW);
  assert.equal(activityCatalog.calls, 1);
  assert.equal(restaurantMenu.calls, 0);
  assert.equal(bundle.facts[0]?.sourceType, 'activity_live');
});

// [3] stay query routes stay source
test('stay query routes only the stay source', async () => {
  const stayCatalog = spy(async () => okResult('service_resources_stay', 'stay_live', [fact('stay:room1', { capacity: 2 }, 'stay', 'service_resources_stay', 'stay_live')]));
  const activityCatalog = spy(async () => okResult('activity_catalog', 'activity_live', []));
  const adapters: KnowledgeSourceAdapters = { stay: { catalog: stayCatalog }, activity: { catalog: activityCatalog } };
  const bundle = await resolveKnowledge(baseRequest({ domain: 'stay', needs: ['catalog'] }), adapters, NOW);
  assert.equal(stayCatalog.calls, 1);
  assert.equal(activityCatalog.calls, 0);
  assert.equal(bundle.facts[0]?.sourceType, 'stay_live');
});

// [4] promotion query routes promotion source
test('promotion query routes only the promotion runtime source', async () => {
  const promotionEligibility = spy(async () => okResult('promotions_active', 'promotion_runtime', [fact('promo:PROMO1', { active: true }, 'promotion', 'promotions_active', 'promotion_runtime')]));
  const restaurantMenu = spy(async () => okResult('restaurant_menu', 'restaurant_live', []));
  const adapters: KnowledgeSourceAdapters = { promotion: { eligibility: promotionEligibility }, restaurant: { menu: restaurantMenu } };
  const bundle = await resolveKnowledge(baseRequest({ domain: 'promotion', needs: ['promotion_eligibility'] }), adapters, NOW);
  assert.equal(promotionEligibility.calls, 1);
  assert.equal(restaurantMenu.calls, 0);
  assert.equal(bundle.facts[0]?.sourceType, 'promotion_runtime');
});

// [5] booking-status query routes operational booking source
test('booking_status need routes to the operational booking source', async () => {
  const bookingLookup = spy(async () => okResult('bookings', 'booking_operational', [fact('booking:BK123:status', 'confirmed', 'activity', 'bookings', 'booking_operational')]));
  const adapters: KnowledgeSourceAdapters = { bookingStatus: { lookup: bookingLookup } };
  const bundle = await resolveKnowledge(baseRequest({ domain: 'activity', needs: ['booking_status'] }), adapters, NOW);
  assert.equal(bookingLookup.calls, 1);
  assert.equal(bundle.facts[0]?.sourceType, 'booking_operational');
});

// [6] payment query routes payment source
test('payment domain routes to the payment operational source', async () => {
  const paymentLookup = spy(async () => okResult('payments', 'payment_operational', [fact('payment:PAY1:status', 'settled', 'payment', 'payments', 'payment_operational')]));
  const adapters: KnowledgeSourceAdapters = { paymentStatus: { lookup: paymentLookup } };
  const bundle = await resolveKnowledge(baseRequest({ domain: 'payment', needs: ['booking_status'] }), adapters, NOW);
  assert.equal(paymentLookup.calls, 1);
  assert.equal(bundle.facts[0]?.sourceType, 'payment_operational');
});

// [7] ecosystem stable query uses Bible/catalog, not mutable inventory
test('ecosystem query routes to Bible, never to a live mutable-inventory adapter', async () => {
  const bibleStablePolicy = spy(async () => okResult('bible', 'bible', [fact('ecosystem:relationship:adventure', { parent: 'thamma-chat' }, 'ecosystem', 'bible', 'bible')]));
  const activityCatalog = spy(async () => okResult('activity_catalog', 'activity_live', []));
  const adapters: KnowledgeSourceAdapters = { bible: { stablePolicy: bibleStablePolicy }, activity: { catalog: activityCatalog } };
  const bundle = await resolveKnowledge(baseRequest({ domain: 'ecosystem', needs: ['catalog'] }), adapters, NOW);
  assert.equal(bibleStablePolicy.calls, 1);
  assert.equal(activityCatalog.calls, 0);
  assert.equal(bundle.facts[0]?.sourceType, 'bible');
});

// [8] source precedence beats stale conversation value
test('a live promotion_runtime fact beats a stale conversation_memory fact for the same key', () => {
  const stale = fact('promo:PROMO1:total', 90, 'promotion', 'conversation_summary', 'conversation_memory');
  const live = fact('promo:PROMO1:total', 99, 'promotion', 'promotions_active', 'promotion_runtime');
  assert.equal(pickByPrecedence([stale, live])?.value, 99);
  assert.equal(pickByPrecedence([live, stale])?.value, 99, 'precedence must not depend on array order');
});

// [9] current operational status beats task summary
test('an operational booking_operational fact beats a conversation_memory summary fact', () => {
  const summary = fact('booking:BK123:status', 'probably confirmed', 'activity', 'rolling_summary', 'conversation_memory');
  const operational = fact('booking:BK123:status', 'confirmed', 'activity', 'bookings', 'booking_operational');
  assert.equal(pickByPrecedence([summary, operational])?.sourceType, 'booking_operational');
});

// [10] missing fact stays unknown
test('a fact key never grounded by any source is reported unverified, not guessed', () => {
  const bundle = { domain: 'activity' as const, sources: [], facts: [], entities: [], missing: [], warnings: [], freshness: 'live' as const };
  assert.deepEqual(getGroundedFactValue(bundle, 'temperament:horse:paradon'), { status: 'unverified' });
});

// [11] unavailable source != empty source
test('EMPTY and UNAVAILABLE are structurally distinct and never conflated', async () => {
  const activityCatalog = spy(async () => emptyResult('activity_catalog', 'activity_live'));
  const promotionEligibility = spy(async () => unavailableResult('promotions_active', 'promotion_runtime', 'timeout'));
  const bundleActivity = await resolveKnowledge(baseRequest({ domain: 'activity', needs: ['catalog'] }), { activity: { catalog: activityCatalog } }, NOW);
  const bundlePromotion = await resolveKnowledge(baseRequest({ domain: 'promotion', needs: ['promotion_eligibility'] }), { promotion: { eligibility: promotionEligibility } }, NOW);
  assert.equal(bundleActivity.sources[0]?.status, 'empty');
  assert.equal(bundleActivity.missing.length, 0, 'an authoritative empty result is not "missing" information');
  assert.equal(bundlePromotion.sources[0]?.status, 'unavailable');
  assert.equal(bundlePromotion.missing.includes('promotion_eligibility'), true, 'a genuinely failed source IS missing information');
  assert.notEqual(bundleActivity.sources[0]?.status, bundlePromotion.sources[0]?.status);
});

// [12] ambiguous entity resolution does not guess
test('multiple matching canonical candidates resolve as ambiguous, never guessed', () => {
  const candidates: CanonicalCandidate[] = [
    { canonicalId: 'stay:room:deluxe-a', name: 'ห้องดีลักซ์', domain: 'stay' },
    { canonicalId: 'stay:room:deluxe-b', name: 'ห้องดีลักซ์', domain: 'stay' },
  ];
  const resolved = resolveEntityIdentity({ id: 'conv:room:deluxe', name: 'ห้องดีลักซ์', domain: 'stay' }, candidates);
  assert.equal(resolved.canonical, false);
  assert.equal(resolved.ambiguous, true);
  assert.equal(resolved.canonicalId, null);
  assert.deepEqual(resolved.candidates?.sort(), ['stay:room:deluxe-a', 'stay:room:deluxe-b']);
});

// [13] canonical horse resolution
test('ภาราดร and ทองไทย resolve to canonical activity_assets-shaped ids from a real candidate list', () => {
  const candidates: CanonicalCandidate[] = [
    { canonicalId: 'activity_asset:horse:thongthai', name: 'ทองไทย', domain: 'activity' },
    { canonicalId: 'activity_asset:horse:paradon', name: 'ภาราดร', domain: 'activity' },
    { canonicalId: 'activity_asset:atv:01', name: 'ATV', domain: 'activity' },
    { canonicalId: 'activity_asset:archery:lane1', name: 'ยิงธนู', domain: 'activity' },
  ];
  assert.equal(resolveEntityIdentity({ id: 'conv:horse:paradon', name: 'ภาราดร', domain: 'activity' }, candidates).canonicalId, 'activity_asset:horse:paradon');
  assert.equal(resolveEntityIdentity({ id: 'conv:horse:thongthai', name: 'ทองไทย', domain: 'activity' }, candidates).canonicalId, 'activity_asset:horse:thongthai');
  assert.equal(resolveEntityIdentity({ id: 'conv:atv', name: 'ATV', domain: 'activity' }, candidates).canonicalId, 'activity_asset:atv:01');
  assert.equal(resolveEntityIdentity({ id: 'conv:archery', name: 'ยิงธนู', domain: 'activity' }, candidates).canonicalId, 'activity_asset:archery:lane1');

  const restaurantCandidates: CanonicalCandidate[] = [{ canonicalId: 'restaurant:tamma-chat', name: 'ร้านทำมา-ชาติ', domain: 'restaurant' }];
  assert.equal(resolveEntityIdentity({ id: 'conv:restaurant', name: 'ร้านทำมา-ชาติ', domain: 'restaurant' }, restaurantCandidates).canonicalId, 'restaurant:tamma-chat');
});

// [14] noncanonical entity remains marked noncanonical
test('an entity with no real candidate match stays honestly non-canonical, never fabricated', () => {
  const resolved = resolveEntityIdentity({ id: 'conv:horse:unicorn', name: 'ยูนิคอร์น', domain: 'activity' }, [
    { canonicalId: 'activity_asset:horse:paradon', name: 'ภาราดร', domain: 'activity' },
  ]);
  assert.equal(resolved.canonical, false);
  assert.equal(resolved.ambiguous, false);
  assert.equal(resolved.canonicalId, null);
  assert.equal(resolved.name, 'ยูนิคอร์น', 'the honest conversational name must be retained, not discarded');
});

// [15] provenance metadata included
test('every grounded fact carries sourceId/sourceType/fetchedAt provenance', async () => {
  const bundle = await resolveKnowledge(baseRequest({ domain: 'restaurant', needs: ['catalog'] }), {
    restaurant: { menu: async () => okResult('restaurant_menu', 'restaurant_live', [fact('menu:tam_thai', { price: 60 }, 'restaurant', 'restaurant_menu', 'restaurant_live')]) },
  }, NOW);
  const [f] = bundle.facts;
  assert.ok(f?.sourceId);
  assert.ok(f?.sourceType);
  assert.ok(f?.fetchedAt);
  assert.equal(typeof f?.authoritative, 'boolean');
});

// [16] mutable facts not sourced from Bible
test('no mutable-fact need (price/availability/schedule/inventory/promotion/booking/order/membership) ever routes to Bible for a non-ecosystem domain', async () => {
  const bibleStablePolicy = spy(async () => okResult('bible', 'bible', []));
  const fullAdapters: KnowledgeSourceAdapters = {
    restaurant: { menu: async () => okResult('r', 'restaurant_live', []) },
    activity: { catalog: async () => okResult('a', 'activity_live', []), availability: async () => okResult('a', 'activity_live', []) },
    stay: { catalog: async () => okResult('s', 'stay_live', []), availability: async () => okResult('s', 'stay_live', []) },
    promotion: { eligibility: async () => okResult('p', 'promotion_runtime', []) },
    bookingStatus: { lookup: async () => okResult('b', 'booking_operational', []) },
    orderStatus: { lookup: async () => okResult('o', 'order_operational', []) },
    membership: { status: async () => okResult('m', 'membership_operational', []) },
    otop: { catalog: async () => okResult('ot', 'otop_live', []) },
    cafe: { facts: async () => okResult('c', 'cafe_live', []) },
    bible: { stablePolicy: bibleStablePolicy },
  };
  const domains: SemanticDomain[] = ['restaurant', 'activity', 'stay', 'promotion', 'membership', 'otop', 'cafe'];
  const needs: Array<'price' | 'availability' | 'schedule' | 'inventory' | 'promotion_eligibility' | 'booking_status' | 'order_status' | 'membership_status'> = ['price', 'availability', 'schedule', 'inventory', 'promotion_eligibility', 'booking_status', 'order_status', 'membership_status'];
  for (const domain of domains) {
    for (const need of needs) {
      const bundle = await resolveKnowledge(baseRequest({ domain, needs: [need] }), fullAdapters, NOW);
      for (const source of bundle.sources) assert.notEqual(source.sourceType, 'bible', `domain=${domain} need=${need} must never route to bible`);
    }
  }
  assert.equal(bibleStablePolicy.calls, 0);
});

// [17] no unnecessary cross-domain queries
test('a single-need request never triggers more than the one adapter it needs, across ALL registered adapters', async () => {
  const calls: string[] = [];
  const tracker = (label: string) => async (): Promise<SourceResult> => { calls.push(label); return okResult(label, 'restaurant_live', []); };
  const adapters: KnowledgeSourceAdapters = {
    restaurant: { menu: tracker('restaurant.menu') },
    activity: { catalog: tracker('activity.catalog'), availability: tracker('activity.availability') },
    stay: { catalog: tracker('stay.catalog') },
    promotion: { eligibility: tracker('promotion.eligibility') },
    otop: { catalog: tracker('otop.catalog') },
    cafe: { facts: tracker('cafe.facts') },
    bible: { stablePolicy: tracker('bible.stablePolicy') },
  };
  await resolveKnowledge(baseRequest({ domain: 'restaurant', needs: ['catalog'] }), adapters, NOW);
  assert.deepEqual(calls, ['restaurant.menu']);
});

// [18] current promo excludes inactive/noneligible campaigns
test('the resolver trusts the promotion adapter\'s already-filtered eligibility result exactly, adding/removing nothing', async () => {
  const activePromoOnly = [fact('promo:PROMO1', { active: true, campaignCode: 'PROMO1' }, 'promotion', 'promotions_active', 'promotion_runtime')];
  const bundle = await resolveKnowledge(baseRequest({ domain: 'promotion', needs: ['promotion_eligibility'] }), {
    promotion: { eligibility: async () => okResult('promotions_active', 'promotion_runtime', activePromoOnly) },
  }, NOW);
  assert.deepEqual(bundle.facts, activePromoOnly);
});

// [19] live menu/orderability grounding
test('menu orderability is grounded exactly as the source reports it, never altered', async () => {
  const menuFacts = [
    fact('menu:tam_thai:orderable', true, 'restaurant', 'restaurant_menu', 'restaurant_live'),
    fact('menu:som_tam:orderable', false, 'restaurant', 'restaurant_menu', 'restaurant_live'),
  ];
  const bundle = await resolveKnowledge(baseRequest({ domain: 'restaurant', needs: ['catalog'] }), { restaurant: { menu: async () => okResult('restaurant_menu', 'restaurant_live', menuFacts) } }, NOW);
  assert.equal(getGroundedFactValue(bundle, 'menu:tam_thai:orderable').status === 'known' && getGroundedFactValue(bundle, 'menu:tam_thai:orderable').value, true);
  assert.equal(getGroundedFactValue(bundle, 'menu:som_tam:orderable').status === 'known' && getGroundedFactValue(bundle, 'menu:som_tam:orderable').value, false);
});

// [20] no price invention when activity price is null/unconfigured
test('a null (unconfigured) activity price is grounded as null -- known-null, not unverified, and never a fabricated number', async () => {
  const bundle = await resolveKnowledge(baseRequest({ domain: 'activity', needs: ['price'] }), {
    activity: { catalog: async () => okResult('activity_offerings', 'activity_live', [fact('activity:horse:90min:price', null, 'activity', 'activity_offerings', 'activity_live')]) },
  }, NOW);
  const result = getGroundedFactValue(bundle, 'activity:horse:90min:price');
  assert.equal(result.status, 'known', 'a source explicitly reporting null IS a grounded answer, not an unverified one');
  assert.equal(result.status === 'known' && result.value, null);
});
