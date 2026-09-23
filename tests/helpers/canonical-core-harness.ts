// Shared test harness for driving the REAL canonical customer-level core
// (processThongthaiChatCore, from netlify/functions/thongthai-chat.ts) end
// to end, for both channel='web' and channel='line', across every domain.
//
// This is NOT a file of hand-constructed SemanticTurn objects. It mocks
// only the two external I/O boundaries the core actually has: Supabase
// REST (the same way tests/create-booking-retry-idempotency.test.ts
// already mocks it for createBooking) and the LLM provider's raw HTTP
// completion endpoint (the same way tests/model-provider-shared-timeout-
// budget.test.ts already mocks it for callPreferredModel). Every layer in
// between -- semantic derivation, dialog policy, task-state merging,
// knowledge routing, tool execution, response composition -- runs for
// real, unmodified, exactly as it does in production.
//
// Caveat this harness cannot remove: what a REAL LLM decides to say or
// which tool it decides to call is a prompt/model-quality question, not
// something offline verification can prove. Each test that needs an LLM
// turn supplies its own scripted completion via `programGeminiReply`,
// modeling what a competent brain SHOULD say for that turn -- this proves
// the surrounding mechanism (state persistence, exactly-once execution,
// idempotency, notification wiring) is correct GIVEN a correct LLM
// decision, not that the real model always makes that decision. That
// remains a live-smoke-test concern, documented as such in
// THONGTHAI_HANDOFF.md.
import { createHash } from 'node:crypto';
import type { GuestAgentStateSnapshot } from '../../netlify/functions/_guest-agent-state-store';
import { encryptPii, piiHash } from '../../netlify/functions/_operations-db';

export type HarnessCatalog = {
  activityOfferings?: Array<Record<string, unknown>>;
  activityAssets?: Array<Record<string, unknown>>;
  restaurantMenu?: Array<Record<string, unknown>>;
  otopProducts?: Array<Record<string, unknown>>;
  promotionCampaigns?: Array<Record<string, unknown>>;
  promotionItems?: Array<Record<string, unknown>>;
  worldFacts?: Array<Record<string, unknown>>;
  serviceResources?: Array<Record<string, unknown>>;
  serviceSchedules?: Array<Record<string, unknown>>;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function decodeQuery(url: string): URLSearchParams {
  const qIndex = url.indexOf('?');
  return new URLSearchParams(qIndex >= 0 ? url.slice(qIndex + 1) : '');
}

/** A minimal, realistic default catalog -- enough for every domain's
 *  discovery/read-only questions to get a real, non-empty, honest answer
 *  instead of "no data" purely because the mock is empty. Individual
 *  tests may override specific slices via `catalog` when a scenario
 *  needs different data (e.g. an unknown-fact test that deliberately
 *  omits temperament). */
export function defaultCatalog(): Required<HarnessCatalog> {
  return {
    activityOfferings: [
      { activity_code: 'horse', activity_name: 'ขี่ม้า', duration_minutes: 60, price: 500, currency: 'THB', metadata: {} },
      { activity_code: 'atv', activity_name: 'ATV', duration_minutes: 30, price: 400, currency: 'THB', metadata: {} },
    ],
    activityAssets: [
      { activity_code: 'horse', asset_code: 'horse-pharadon', name: 'ภาราดร', asset_type: 'horse', metadata: {} },
      { activity_code: 'horse', asset_code: 'horse-thongthai', name: 'ทองไทย', asset_type: 'horse', metadata: {} },
    ],
    restaurantMenu: [
      {
        menu_item_id: 'menu-padthai', category_name: 'อาหารจานหลัก', category_sort_order: 1, sort_order: 1,
        name: 'ผัดไทย', selling_price: 120, description: 'ผัดไทยกุ้งสด', is_signature: true,
        ingredient_names: ['กุ้ง', 'เส้นจันท์', 'ถั่วงอก'], unavailable_ingredients: [], available_servings: 20,
        is_orderable: true, source_updated_at: new Date().toISOString(),
      },
      {
        menu_item_id: 'menu-tomyum', category_name: 'อาหารจานหลัก', category_sort_order: 1, sort_order: 2,
        name: 'ต้มยำกุ้ง', selling_price: 180, description: 'ต้มยำกุ้งน้ำข้น', is_signature: true,
        ingredient_names: ['กุ้ง', 'เห็ด', 'ตะไคร้'], unavailable_ingredients: [], available_servings: 15,
        is_orderable: true, source_updated_at: new Date().toISOString(),
      },
      {
        menu_item_id: 'menu-moo-pad', category_name: 'อาหารจานหลัก', category_sort_order: 1, sort_order: 3,
        name: 'ข้าวผัดหมู', selling_price: 90, description: 'ข้าวผัดหมูใส่ไข่', is_signature: false,
        ingredient_names: ['หมู', 'ข้าว', 'ไข่'], unavailable_ingredients: [], available_servings: 25,
        is_orderable: true, source_updated_at: new Date().toISOString(),
      },
    ],
    otopProducts: [
      { sku: 'otop-honey', name: 'น้ำผึ้งป่า', description: 'น้ำผึ้งป่าแท้ 100%', price: 250, stock_qty: 30 },
      { sku: 'otop-scarf', name: 'ผ้าพันคอทอมือ', description: 'ผ้าพันคอทอมือลายพื้นเมือง', price: 350, stock_qty: 12 },
    ],
    promotionCampaigns: [
      {
        id: 'promo-otop-10', campaign_code: 'OTOP10', title: 'ลดของฝาก 10%',
        description: 'ลดราคาของฝากทุกชิ้น 10%', business_scope: 'otop', status: 'active', promo_type: 'discount',
        start_at: null, end_at: null, channel_scope: 'all', financial_snapshot: { discountPct: 10 },
        max_redemptions: 100, redemption_count: 0, environment: 'live',
      },
    ],
    promotionItems: [
      { campaign_id: 'promo-otop-10', business_unit: 'otop', entity_id: 'otop-honey', name_snapshot: 'น้ำผึ้งป่า', quantity: 1 },
    ],
    worldFacts: [
      { fact_key: 'stay_checkin_time', category: 'stay', fact_value: '14:00', source: 'world_facts', updated_at: new Date().toISOString() },
      { fact_key: 'stay_checkout_time', category: 'stay', fact_value: '12:00', source: 'world_facts', updated_at: new Date().toISOString() },
      { fact_key: 'stay_room_service_hours', category: 'stay', fact_value: '10:00-22:00', source: 'world_facts', updated_at: new Date().toISOString() },
      { fact_key: 'cafe_hours', category: 'cafe', fact_value: '07:00-18:00', source: 'world_facts', updated_at: new Date().toISOString() },
      { fact_key: 'cafe_latte_price', category: 'cafe', fact_value: 65, source: 'world_facts', updated_at: new Date().toISOString() },
    ],
    serviceResources: [
      { id: 'res-room-a', code: 'stay-hueun', name: 'เฮือนสเตย์', metadata: {} },
    ],
    serviceSchedules: [],
  };
}

export type HarnessGeminiReply = {
  message: string; intent?: string; toolCalls?: unknown[]; contextUpdates?: Record<string, unknown>;
  /** Passed straight through into the raw completion JSON -- lets a test
   *  script a proposal-generation turn (e.g. the brain proposing a
   *  restaurant set, or clearing an unresolved need) the same way the
   *  real model would via its own agentStateUpdate field. */
  agentStateUpdate?: Record<string, unknown>;
};

export type Harness = {
  fetchMock: typeof fetch;
  /** Queue one scripted LLM completion for the NEXT call to the model
   *  provider. If the queue is empty, a safe generic "conversation" reply
   *  is returned (never a hallucinated business fact). */
  programGeminiReply: (reply: HarnessGeminiReply) => void;
  /** Script the NEXT call to the OpenWeatherMap endpoint
   *  (_weather-provider.ts's getWeatherForTammaLocation) -- ok:true + body
   *  for a scripted success, ok:false for a scripted provider error. THIS
   *  is required for any test that wants a real "weather succeeded" path
   *  through the full processThongthaiChatCore pipeline: setting
   *  `global.fetch` yourself before calling withHarness does NOT work --
   *  withHarness unconditionally installs its own fetchMock for the whole
   *  run, and that mock's default for any unrecognized domain (which an
   *  unprogrammed OpenWeatherMap call would otherwise hit) returns an
   *  empty successful list, silently masking a "weather succeeded but with
   *  no real data" state that looks like success in a loose assertion. If
   *  nothing is programmed, an OpenWeatherMap call is answered with
   *  ok:false (a provider error) rather than that misleading empty-success
   *  default. */
  programWeatherFetch: (response: { ok: boolean; body?: unknown }) => void;
  /** Makes the NEXT (and every subsequent) LINE push to this team's bound
   *  group fail with a real HTTP error -- for testing sendTeamMessage's
   *  own failure path (_ops-notifications.ts throws, the caller must
   *  degrade honestly) without needing a real LINE outage. The team must
   *  already be bound via programOpsChannel; this only affects that one
   *  team's channel, never other bound teams. */
  programLinePushFailure: (teamCode: string) => void;
  /** Binds a fake LINE group to a team code (_ops-notifications.ts's
   *  OpsTeamCode) for the duration of this harness run -- without this, no
   *  team has a bound channel, `sendTeamMessage` returns 'not_bound', and
   *  any Service Mind feedback notification correctly (and honestly)
   *  degrades to "will route" wording rather than "routed" wording. Use
   *  this in a test that specifically wants to prove the "notification
   *  actually sent" path. Uses the REAL encryptPii/piiHash
   *  (_operations-db.ts) so _ops-notifications.ts's own decryption of the
   *  stored channel round-trips correctly, exactly like production. */
  /** `sharedTargetId`, when given, binds this team to that EXACT physical
   *  LINE target instead of its own default `line-group-<teamCode>` --
   *  lets a test set up two different team codes bound to the SAME real
   *  LINE group, for proving _ops-notifications.ts's own "never double-
   *  send to the same physical group" dedup. */
  programOpsChannel: (teamCode: string, sharedTargetId?: string) => void;
  /** Directly inspect/seed a guest's persisted state row -- useful for
   *  stale-state tests that need to start from an already-existing task. */
  getState: (guestDbId: string) => GuestAgentStateSnapshot | undefined;
  setState: (guestDbId: string, state: Record<string, unknown>, updatedAt?: string) => void;
  /** Directly seed/inspect a guest's booking_sessions row (the LEGACY LINE
   *  booking flow's own state, _operations-db.ts's loadLineBookingSession/
   *  saveLineBookingSession -- a SEPARATE table from guest_agent_state).
   *  Essential for any test proving behavior when a stale/leftover session
   *  already exists for a guest, not just a brand-new one -- a real
   *  production incident (see THONGTHAI_HANDOFF.md's "Horse UX Production
   *  Gap" entry) was invisible to every test until this existed, because
   *  every prior test implicitly started with an empty booking_sessions
   *  table (the unmodeled-GET-returns-[] default silently matches "no
   *  session", not "real production state"). */
  getBookingSession: (guestDbId: string) => Record<string, unknown> | undefined;
  setBookingSession: (guestDbId: string, row: Record<string, unknown>) => void;
  /** Every POST body sent to a given table, in order -- for asserting
   *  "exactly once" write counts (bookings, restaurant_preorders,
   *  promotion_redemptions, otop_orders, ops_notification-shaped writes). */
  postsTo: (table: string) => Array<Record<string, unknown>>;
  /** The INTERNAL guest_agent_state row id (e.g. "guest-1-2d3094a5") for a
   *  guest identified by their external request.guestId (the UUID from
   *  guestId(seed)) -- these are NOT the same string (see loadCustomerMemory's
   *  guest-row creation), and reverse-engineering the internal id from
   *  postsTo('guest_agent_state')'s last entry breaks the moment more than
   *  one guest has written state in the same test (a real trap: it silently
   *  returns a DIFFERENT guest's id with no error). Use this instead of
   *  guessing whenever a test needs getState/setState for a specific guest. */
  guestDbId: (anonymousId: string) => string | undefined;
  /** The current (POST + any PATCH merges applied) ops_feedback_events row
   *  for a given event id, as returned by postsTo('ops_feedback_events')'s
   *  row id -- lets a test assert on notification_status/notification_error
   *  after dispatch, not just the initial insert body. */
  feedbackEventRow: (id: string) => Record<string, unknown> | undefined;
  restaurantId: string;
};

export function createHarness(catalogOverrides: HarnessCatalog = {}): Harness {
  const catalog: Required<HarnessCatalog> = { ...defaultCatalog(), ...catalogOverrides };
  const RESTAURANT_ID = 'restaurant-tamma-chart-1';
  const guests = new Map<string, { id: string; anonymous_id: string; last_seen_at: string }>();
  const guestIdentities = new Map<string, string>(); // `${provider}:${providerUserKey}` -> guestDbId
  const agentState = new Map<string, GuestAgentStateSnapshot>();
  const bookingSessions = new Map<string, Record<string, unknown>>(); // guest_id -> booking_sessions row (legacy LINE booking flow)
  const customerAccounts = new Map<string, { id: string; guest_id: string }>();
  const posts = new Map<string, Array<Record<string, unknown>>>();
  const geminiQueue: HarnessGeminiReply[] = [];
  let weatherFetchResponse: { ok: boolean; body: unknown } | null = null;
  const feedbackEvents = new Map<string, Record<string, unknown>>(); // id -> row (ops_feedback_events)
  const opsChannels = new Map<string, { id: string; team_code: string; target_id_enc: string; target_id_hash: string; enabled: boolean }>(); // team_code -> channel
  const failingPushTeamCodes = new Set<string>(); // team_code -> LINE push should fail for this team's bound target
  const opsDeliveries = new Map<string, { id: string; status: string }>(); // idempotency_key -> delivery
  let feedbackEventSeq = 0;
  let opsDeliverySeq = 0;
  const restaurantPreorders = new Map<string, Record<string, unknown>>(); // id -> row (tamma_chart_os.restaurant_preorders)
  const restaurantPreorderItems = new Map<string, Array<Record<string, unknown>>>(); // id -> item rows
  const restaurantPreorderIdempotency = new Map<string, string>(); // idempotency_key -> id
  let guestSeq = 0;
  let bookingSeq = 0;
  let genericSeq = 0;
  let restaurantPreorderSeq = 0;

  function recordPost(table: string, body: Record<string, unknown>) {
    const list = posts.get(table) ?? [];
    list.push(body);
    posts.set(table, list);
  }

  /** Real preorder creation is create_restaurant_preorder_v2/_v3 -- a
   *  Postgres RPC that resolves menu items -> prices itself, computes the
   *  total, and is idempotent on p_idempotency_key (see _restaurant-sot.ts).
   *  Mirrors that: resolves prices from the SAME catalog.restaurantMenu the
   *  rest of this harness already serves, and returns duplicate:true with
   *  the ORIGINAL row on a repeated key instead of creating a second one --
   *  this is what a test asserts "exactly once" against. */
  function createRestaurantPreorderRpc(
    body: Record<string, unknown>,
    promotionCampaignId: string | null,
    pricingOverride: Record<string, number> | null,
  ): { id: string; preorderCode: string; totalAmount: number; normalTotalAmount?: number; discountAmount?: number; status: string; duplicate: boolean } {
    const idempotencyKey = String(body.p_idempotency_key ?? '');
    const existingId = restaurantPreorderIdempotency.get(idempotencyKey);
    if (existingId) {
      const row = restaurantPreorders.get(existingId)!;
      return {
        id: row.id as string, preorderCode: row.preorder_code as string,
        totalAmount: row.total_amount as number,
        normalTotalAmount: row.normal_total_amount as number | undefined,
        discountAmount: row.discount_amount as number | undefined,
        status: row.status as string, duplicate: true,
      };
    }
    restaurantPreorderSeq += 1;
    const id = `preorder-${restaurantPreorderSeq}`;
    const rawItems = Array.isArray(body.p_items) ? body.p_items as Array<{ menuItemId?: string; quantity?: number }> : [];
    const menuById = new Map(catalog.restaurantMenu.map(item => [String(item.menu_item_id), item]));
    const resolvedItems = rawItems.map(item => {
      const menu = menuById.get(String(item.menuItemId));
      const override = pricingOverride?.[String(item.menuItemId)];
      const unitPrice = typeof override === 'number' ? override : (typeof menu?.selling_price === 'number' ? menu.selling_price : 0);
      const quantity = typeof item.quantity === 'number' ? item.quantity : 1;
      return { menu_name: (menu?.name as string | undefined) ?? String(item.menuItemId), quantity, unit_price: unitPrice, line_total: unitPrice * quantity };
    });
    const normalTotal = resolvedItems.reduce((sum, item) => {
      const menu = menuById.get(String((rawItems[resolvedItems.indexOf(item)] ?? {}).menuItemId));
      return sum + (typeof menu?.selling_price === 'number' ? menu.selling_price * item.quantity : item.line_total);
    }, 0);
    const totalAmount = resolvedItems.reduce((sum, item) => sum + item.line_total, 0);
    const row: Record<string, unknown> = {
      id, restaurant_id: body.p_restaurant_id, preorder_code: `RP-TEST-${String(restaurantPreorderSeq).padStart(4, '0')}`,
      guest_id: body.p_guest_id ?? null, customer_name: body.p_customer_name, phone: body.p_phone || null, email: body.p_email || null,
      requested_for: body.p_requested_for, source_channel: body.p_source_channel, customer_note: body.p_customer_note || null,
      status: 'pending', total_amount: totalAmount, environment: body.p_environment,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      promotion_campaign_id: promotionCampaignId, promotion_redemption_id: null,
      normal_total_amount: promotionCampaignId ? normalTotal : null,
      discount_amount: promotionCampaignId ? Math.max(0, normalTotal - totalAmount) : 0,
      pricing_source: promotionCampaignId ? 'promotion' : 'menu',
    };
    restaurantPreorders.set(id, row);
    restaurantPreorderItems.set(id, resolvedItems);
    restaurantPreorderIdempotency.set(idempotencyKey, id);
    recordPost('restaurant_preorders_rpc', body);
    return {
      id, preorderCode: row.preorder_code as string, totalAmount,
      normalTotalAmount: promotionCampaignId ? normalTotal : undefined,
      discountAmount: promotionCampaignId ? (row.discount_amount as number) : undefined,
      status: 'pending', duplicate: false,
    };
  }

  function ensureGuestByAnonymousId(anonymousId: string) {
    let guest = guests.get(anonymousId);
    if (!guest) {
      guestSeq += 1;
      guest = { id: `guest-${guestSeq}-${anonymousId.slice(0, 8)}`, anonymous_id: anonymousId, last_seen_at: new Date().toISOString() };
      guests.set(anonymousId, guest);
    }
    return guest;
  }

  const fetchMock = (async (url: string | URL, init: RequestInit = {}) => {
    const u = String(url);
    const method = (init.method ?? 'GET').toUpperCase();
    const path = u.replace(/^https?:\/\/[^/]+\/rest\/v1\//, '').replace(/^https?:\/\/[^/]+\//, '');
    const query = decodeQuery(u);

    // --- LLM provider (Gemini) ---
    if (u.includes('generativelanguage.googleapis.com')) {
      const reply = geminiQueue.shift() ?? { message: 'ขอโทษนะครับ ตอนนี้ทองไทยยังไม่มีข้อมูลที่ยืนยันได้สำหรับเรื่องนี้ครับ', intent: 'conversation' };
      return jsonResponse({ candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }] });
    }

    // --- weather provider (OpenWeatherMap, _weather-provider.ts) ---
    // See programWeatherFetch's own doc comment: this must NOT fall
    // through to the generic "unknown GET -> empty list" default below --
    // an empty list is `ok:true`, and getWeatherForTammaLocation would
    // read that as a real (if data-less) success rather than the honest
    // "nothing programmed" case.
    if (u.includes('api.openweathermap.org')) {
      if (!weatherFetchResponse) return jsonResponse({}, 500);
      return jsonResponse(weatherFetchResponse.body ?? {}, weatherFetchResponse.ok ? 200 : 500);
    }

    // --- LINE push (_ops-notifications.ts's linePush, used by
    // sendTeamMessage once a channel is bound via programOpsChannel) ---
    // always succeeds in tests -- a test asserting an actual LINE-push
    // FAILURE is not a scenario this harness needs to model today.
    if (u.includes('api.line.me/v2/bot/message/push')) {
      const body = JSON.parse(String(init.body ?? '{}')) as { to?: string };
      const failing = [...failingPushTeamCodes].some(team => body.to === `line-group-${team}`);
      if (failing) return new Response(JSON.stringify({ message: 'mocked push failure' }), { status: 500 });
      return jsonResponse({});
    }

    // --- ops_notification_channels (_ops-notifications.ts's
    // channelForTeam/currentBindingForTarget) -- only populated via
    // programOpsChannel; unbound by default (matching this feature's real
    // pre-migration/pre-deploy state honestly). ---
    if (path.startsWith('ops_notification_channels') && method === 'GET') {
      const teamCode = query.get('team_code')?.replace('eq.', '');
      const targetHash = query.get('target_id_hash')?.replace('eq.', '');
      const channel = teamCode
        ? opsChannels.get(teamCode)
        : [...opsChannels.values()].find(c => c.target_id_hash === targetHash);
      return jsonResponse(channel ? [channel] : []);
    }
    // bindLineTeamChannel's own write path (_ops-notifications.ts) --
    // upserts by (team_code, provider). Recorded via recordPost so tests
    // can assert on the exact team_code a "ผูกทีม ..." command actually
    // wrote, not just its reply text; also updates the SAME opsChannels
    // map programOpsChannel uses, so a bind-then-notify test sees the
    // newly-bound channel exactly like the real table would.
    if (path.startsWith('ops_notification_channels') && method === 'POST') {
      const body = JSON.parse(String(init.body ?? '{}')) as { team_code: string; target_id_enc: string; target_id_hash: string; display_name?: string; enabled?: boolean };
      recordPost('ops_notification_channels', body);
      opsChannels.set(body.team_code, {
        id: `ops-channel-${body.team_code}`, team_code: body.team_code,
        target_id_enc: body.target_id_enc, target_id_hash: body.target_id_hash, enabled: body.enabled ?? true,
      });
      return jsonResponse([]);
    }
    if (path.startsWith('ops_notification_channels') && method === 'PATCH') {
      const body = JSON.parse(String(init.body ?? '{}')) as { team_code?: string; target_id_enc?: string; target_id_hash?: string; enabled?: boolean };
      recordPost('ops_notification_channels', body);
      if (body.team_code) {
        const existing = opsChannels.get(body.team_code);
        opsChannels.set(body.team_code, {
          id: existing?.id ?? `ops-channel-${body.team_code}`, team_code: body.team_code,
          target_id_enc: body.target_id_enc ?? existing?.target_id_enc ?? '', target_id_hash: body.target_id_hash ?? existing?.target_id_hash ?? '',
          enabled: body.enabled ?? existing?.enabled ?? true,
        });
      }
      return jsonResponse([]);
    }
    if (path.startsWith('ops_notification_channels') && method === 'DELETE') {
      return jsonResponse([]);
    }

    // --- ops_notification_deliveries (_ops-notifications.ts's
    // beginDelivery/finishDelivery -- idempotency-keyed delivery ledger) ---
    //
    // entity_type/delivery_type are checked against the REAL production
    // CHECK constraints (ops_notification_deliveries_entity_type_check /
    // _delivery_type_check, see supabase/migrations/2026092309*_ops_
    // notification_deliveries_feedback_v1.sql) -- a real production
    // incident this closes: this mock previously accepted ANY entity_type/
    // delivery_type unconditionally, so no test in this suite could ever
    // have caught that every feedback notification was rejected in
    // production by a check_violation on exactly this insert. Keep this
    // list in sync with the live constraint if either ever changes.
    if (path.startsWith('ops_notification_deliveries')) {
      if (method === 'POST') {
        const body = JSON.parse(String(init.body ?? '{}')) as {
          idempotency_key: string; status?: string; entity_type?: string | null; delivery_type?: string;
        };
        const entityType = body.entity_type ?? null;
        const validEntityType = entityType === null || [
          'booking', 'cafe_inquiry', 'otop_order', 'restaurant_preorder', 'daily_schedule', 'payment_request', 'team_settlement', 'feedback_event',
        ].includes(entityType);
        const deliveryType = body.delivery_type ?? '';
        const validDeliveryType = [
          'booking_created', 'cafe_inquiry_created', 'otop_order_created', 'restaurant_preorder_created', 'daily_schedule', 'daily_summary', 'manual_test',
        ].includes(deliveryType) || deliveryType.startsWith('payment_') || deliveryType.startsWith('settlement_') || deliveryType.startsWith('feedback_');
        if (!validEntityType || !validDeliveryType) {
          return new Response(JSON.stringify({ code: '23514', message: `check_violation: entity_type=${entityType} delivery_type=${deliveryType}` }), { status: 400 });
        }
        if (opsDeliveries.has(body.idempotency_key)) return jsonResponse([]); // on_conflict ignore-duplicates
        opsDeliverySeq += 1;
        const row = { id: `ops-delivery-${opsDeliverySeq}`, status: body.status ?? 'pending' };
        opsDeliveries.set(body.idempotency_key, row);
        return jsonResponse([row]);
      }
      if (method === 'GET') {
        const key = query.get('idempotency_key')?.replace('eq.', '') ?? '';
        const row = opsDeliveries.get(key);
        return jsonResponse(row ? [row] : []);
      }
      if (method === 'PATCH') {
        const idParam = query.get('id')?.replace('eq.', '') ?? '';
        const body = JSON.parse(String(init.body ?? '{}')) as { status?: string };
        for (const [key, row] of opsDeliveries.entries()) {
          if (row.id === idParam) opsDeliveries.set(key, { ...row, status: body.status ?? row.status });
        }
        return jsonResponse([]);
      }
    }

    // --- ops_feedback_events (Service Mind -- see
    // _service-mind-feedback-events.ts, _ops-notifications.ts's
    // notifyFeedbackEvent). Real table is prepared but NOT applied (see
    // THONGTHAI_HANDOFF.md); modeled here so tests can assert the exact
    // event a classified feedback message produces. ---
    if (path.startsWith('ops_feedback_events')) {
      if (method === 'POST') {
        const body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
        feedbackEventSeq += 1;
        const row = { id: `feedback-event-${feedbackEventSeq}`, environment: 'test', ...body };
        feedbackEvents.set(row.id, row);
        recordPost('ops_feedback_events', body);
        return jsonResponse([row]);
      }
      if (method === 'GET') {
        const idParam = query.get('id')?.replace('eq.', '') ?? '';
        const row = feedbackEvents.get(idParam);
        return jsonResponse(row ? [row] : []);
      }
      if (method === 'PATCH') {
        const idParam = query.get('id')?.replace('eq.', '') ?? '';
        const existing = feedbackEvents.get(idParam);
        if (existing) {
          const body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
          feedbackEvents.set(idParam, { ...existing, ...body });
        }
        return jsonResponse([]);
      }
    }

    // --- guest_identities ---
    if (path.startsWith('guest_identities') && method === 'GET') {
      const provider = query.get('provider')?.replace('eq.', '') ?? '';
      const key = query.get('provider_user_key')?.replace('eq.', '') ?? '';
      const guestDbId = guestIdentities.get(`${provider}:${key}`);
      return jsonResponse(guestDbId ? [{ guest_id: guestDbId }] : []);
    }
    if (path.startsWith('guest_identities') && method === 'POST') {
      const body = JSON.parse(String(init.body ?? '{}')) as { provider?: string; provider_user_key?: string; guest_id?: string };
      if (body.provider && body.provider_user_key && body.guest_id) {
        guestIdentities.set(`${body.provider}:${body.provider_user_key}`, body.guest_id);
      }
      return jsonResponse([]);
    }

    // --- guests ---
    if (path.startsWith('guests') && method === 'GET') {
      const anonymousId = query.get('anonymous_id')?.replace('eq.', '') ?? '';
      const guest = guests.get(anonymousId);
      return jsonResponse(guest ? [guest] : []);
    }
    if (path.startsWith('guests') && method === 'POST') {
      const body = JSON.parse(String(init.body ?? '{}')) as { anonymous_id: string };
      const guest = ensureGuestByAnonymousId(body.anonymous_id);
      return jsonResponse([{ id: guest.id }]);
    }
    if (path.startsWith('guests') && method === 'PATCH') return jsonResponse([]);

    // --- guest_memory / guest_semantic_memory / journeys (read-only history) ---
    if (path.startsWith('guest_memory') && method === 'GET') return jsonResponse([]);
    if (path.startsWith('guest_memory') && method === 'POST') { recordPost('guest_memory', JSON.parse(String(init.body ?? '[]'))); return jsonResponse([]); }
    if (path.startsWith('guest_semantic_memory') && method === 'GET') return jsonResponse([]);
    if (path.startsWith('guest_semantic_memory') && method === 'POST') { recordPost('guest_semantic_memory', JSON.parse(String(init.body ?? '{}'))); return jsonResponse([]); }
    if (path.startsWith('journeys') && method === 'GET') return jsonResponse([]);
    if (path.startsWith('journeys') && method === 'POST') return jsonResponse([]);
    if (path.startsWith('guest_events') && method === 'POST') return jsonResponse([]);

    // --- guest_agent_state (taskState + conversationContext CAS store) ---
    if (path.startsWith('guest_agent_state') && method === 'GET') {
      const guestId = query.get('guest_id')?.replace('eq.', '') ?? '';
      const snapshot = agentState.get(guestId);
      return jsonResponse(snapshot?.exists ? [{ state: snapshot.state, updated_at: snapshot.updatedAt }] : []);
    }
    if (path.startsWith('guest_agent_state') && method === 'POST') {
      const body = JSON.parse(String(init.body ?? '{}')) as { guest_id: string; state?: Record<string, unknown> };
      const existing = agentState.get(body.guest_id);
      const nextState = { ...(existing?.state ?? {}), ...(body.state ?? {}) };
      const nextSnapshot: GuestAgentStateSnapshot = { exists: true, state: nextState, updatedAt: new Date().toISOString() };
      agentState.set(body.guest_id, nextSnapshot);
      recordPost('guest_agent_state', body);
      return jsonResponse([{ state: nextSnapshot.state, updated_at: nextSnapshot.updatedAt }]);
    }
    // Real compareAndSwapGuestAgentState (_guest-agent-state-store.ts) uses
    // PATCH once a row already exists -- guest_id + updated_at=eq.<CAS
    // token> as the filter, body already carries the FULLY MERGED next
    // state (the client computes the merge, not this store). Mirrors real
    // PostgREST CAS semantics: token matches -> apply and return the row;
    // token stale -> return an empty array (the real client reads that as
    // 'conflict' and reloads/retries). Without this branch every write
    // after a guest's first ever write silently vanishes (falls through to
    // the generic "unmodeled write" fallback below, which never touches
    // the `agentState` map) -- turn-2-onward state changes would appear to
    // succeed but never actually persist.
    if (path.startsWith('guest_agent_state') && method === 'PATCH') {
      const guestIdParam = query.get('guest_id')?.replace('eq.', '') ?? '';
      const expectedUpdatedAt = query.get('updated_at')?.replace('eq.', '') ?? '';
      const existing = agentState.get(guestIdParam);
      if (!existing?.exists || existing.updatedAt !== expectedUpdatedAt) return jsonResponse([]);
      const body = JSON.parse(String(init.body ?? '{}')) as { state?: Record<string, unknown>; updated_at?: string };
      const nextSnapshot: GuestAgentStateSnapshot = {
        exists: true,
        state: body.state ?? existing.state,
        updatedAt: body.updated_at ?? new Date().toISOString(),
      };
      agentState.set(guestIdParam, nextSnapshot);
      recordPost('guest_agent_state', { guest_id: guestIdParam, ...body });
      return jsonResponse([{ state: nextSnapshot.state, updated_at: nextSnapshot.updatedAt }]);
    }

    // --- booking_sessions (legacy LINE booking flow's own state --
    // _operations-db.ts's loadLineBookingSession/saveLineBookingSession,
    // a SEPARATE table from guest_agent_state) ---
    if (path.startsWith('booking_sessions') && method === 'GET') {
      const guestId = query.get('guest_id')?.replace('eq.', '') ?? '';
      const row = bookingSessions.get(guestId);
      return jsonResponse(row ? [row] : []);
    }
    if (path.startsWith('booking_sessions') && method === 'POST') {
      const body = JSON.parse(String(init.body ?? '{}')) as { guest_id?: string };
      if (body.guest_id) {
        const existing = bookingSessions.get(body.guest_id) ?? {};
        bookingSessions.set(body.guest_id, { ...existing, ...body });
      }
      recordPost('booking_sessions', body);
      return jsonResponse([]);
    }

    // --- community_offerings / world_facts ---
    if (path.startsWith('community_offerings')) return jsonResponse([]);
    if (path.startsWith('world_facts') && method === 'GET') return jsonResponse(catalog.worldFacts);

    // --- activity ---
    if (path.startsWith('activity_offerings') && method === 'GET') return jsonResponse(catalog.activityOfferings);
    if (path.startsWith('activity_assets') && method === 'GET') return jsonResponse(catalog.activityAssets);

    // --- restaurant ---
    if (path.startsWith('restaurants') && method === 'GET') return jsonResponse([{ id: RESTAURANT_ID }]);
    if (path.startsWith('restaurant_menu_live') && method === 'GET') return jsonResponse(catalog.restaurantMenu);
    if (path.startsWith('restaurant_menu_intelligence_profiles') && method === 'GET') return jsonResponse([]);
    // Real preorder CREATION is an RPC (create_restaurant_preorder_v2 for
    // plain orders, _v3 for promotion-priced ones -- see _restaurant-sot.ts
    // createRestaurantPreorder/createRestaurantPreorderWithPromotion), never
    // a direct INSERT on restaurant_preorders. restaurant_preorders/
    // restaurant_preorder_items are only ever READ afterward (by id, for
    // the staff-notification message) -- see preorderById/preorderItems.
    if (path.startsWith('rpc/create_restaurant_preorder_v2') && method === 'POST') {
      const body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
      return jsonResponse(createRestaurantPreorderRpc(body, null, null));
    }
    if (path.startsWith('rpc/create_restaurant_preorder_v3') && method === 'POST') {
      const body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
      const override = (body.p_pricing_override ?? {}) as Record<string, number>;
      return jsonResponse(createRestaurantPreorderRpc(
        body, typeof body.p_promotion_campaign_id === 'string' ? body.p_promotion_campaign_id : null, override,
      ));
    }
    if (path.startsWith('restaurant_preorders') && method === 'GET') {
      const id = query.get('id')?.replace('eq.', '') ?? '';
      const row = restaurantPreorders.get(id);
      return jsonResponse(row ? [row] : []);
    }
    if (path.startsWith('restaurant_preorder_items') && method === 'GET') {
      const preorderId = query.get('preorder_id')?.replace('eq.', '') ?? '';
      return jsonResponse(restaurantPreorderItems.get(preorderId) ?? []);
    }

    // --- otop ---
    if (path.startsWith('otop_products') && method === 'GET') return jsonResponse(catalog.otopProducts);
    if (path.startsWith('otop_orders') && method === 'POST') {
      const body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
      genericSeq += 1;
      recordPost('otop_orders', body);
      return jsonResponse([{ id: `otop-order-${genericSeq}`, order_code: `OT-TEST-${String(genericSeq).padStart(4, '0')}`, ...body }]);
    }

    // --- promotions ---
    if (path.startsWith('promotion_campaigns') && method === 'GET') {
      if (u.includes('id=eq.')) {
        const id = query.get('id')?.replace('eq.', '') ?? '';
        return jsonResponse(catalog.promotionCampaigns.filter(c => c.id === id));
      }
      return jsonResponse(catalog.promotionCampaigns);
    }
    if (path.startsWith('promotion_campaigns') && method === 'PATCH') { recordPost('promotion_campaigns_patch', JSON.parse(String(init.body ?? '{}'))); return jsonResponse([]); }
    if (path.startsWith('promotion_items') && method === 'GET') return jsonResponse(catalog.promotionItems);
    if (path.startsWith('promotion_redemptions') && method === 'POST') {
      const body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
      genericSeq += 1;
      recordPost('promotion_redemptions', body);
      return jsonResponse([{ id: `redemption-${genericSeq}`, ...body }]);
    }

    // --- stay / activity booking execution (createBooking's own needs) ---
    if (path.startsWith('service_resources') && method === 'GET') return jsonResponse(catalog.serviceResources);
    if (path.startsWith('service_schedules') && method === 'GET') return jsonResponse(catalog.serviceSchedules);
    if (path.startsWith('bookings') && method === 'GET') return jsonResponse([]);
    if (path.startsWith('bookings') && method === 'POST') {
      const body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
      bookingSeq += 1;
      const row = { id: `booking-row-${bookingSeq}`, booking_code: `BK-TEST-${String(bookingSeq).padStart(4, '0')}`, status: 'requested', ...body };
      recordPost('bookings', body);
      return jsonResponse([row]);
    }
    if (path.startsWith('booking_allocations') && method === 'POST') { recordPost('booking_allocations', JSON.parse(String(init.body ?? '[]'))); return jsonResponse([]); }

    // --- customer accounts / membership ---
    if (path.startsWith('customer_accounts') && method === 'GET') {
      const guestId = query.get('guest_id')?.replace('eq.', '') ?? '';
      const account = customerAccounts.get(guestId);
      return jsonResponse(account ? [account] : []);
    }
    if (path.startsWith('customer_accounts') && (method === 'POST' || method === 'PATCH')) {
      const body = JSON.parse(String(init.body ?? '{}')) as { guest_id?: string };
      if (body.guest_id) {
        genericSeq += 1;
        customerAccounts.set(body.guest_id, { id: `cust-${genericSeq}`, guest_id: body.guest_id });
      }
      recordPost('customer_accounts', body);
      return jsonResponse([{ id: `cust-${genericSeq || 1}` }]);
    }

    // --- cafe / booking status / order status (no deterministic adapter today; safe empty) ---
    if (path.startsWith('cafe_inquiries') && method === 'POST') { recordPost('cafe_inquiries', JSON.parse(String(init.body ?? '{}'))); return jsonResponse([{ id: 'cafe-inquiry-1' }]); }

    // Fallback: unknown GET -> empty list (never invents data); unknown
    // write -> a generic accepted row (keeps the pipeline from crashing on
    // a write path this harness hasn't modeled yet, while every write this
    // harness DOES care about for a given test is captured via postsTo).
    if (method === 'GET') return jsonResponse([]);
    return jsonResponse([{ id: `unmodeled-${path}` }]);
  }) as typeof fetch;

  return {
    fetchMock,
    programGeminiReply: reply => { geminiQueue.push(reply); },
    programWeatherFetch: response => { weatherFetchResponse = { ok: response.ok, body: response.body ?? {} }; },
    programLinePushFailure: teamCode => { failingPushTeamCodes.add(teamCode); },
    programOpsChannel: (teamCode, sharedTargetId) => {
      const targetId = sharedTargetId ?? `line-group-${teamCode}`;
      const targetEnc = encryptPii(targetId);
      const targetHash = piiHash(targetId);
      if (!targetEnc || !targetHash) throw new Error('programOpsChannel: encryption not configured (call inside withHarness)');
      opsChannels.set(teamCode, { id: `ops-channel-${teamCode}`, team_code: teamCode, target_id_enc: targetEnc, target_id_hash: targetHash, enabled: true });
    },
    getState: guestDbId => agentState.get(guestDbId),
    setState: (guestDbId, state, updatedAt) => { agentState.set(guestDbId, { exists: true, state, updatedAt: updatedAt ?? new Date().toISOString() }); },
    getBookingSession: guestDbId => bookingSessions.get(guestDbId),
    setBookingSession: (guestDbId, row) => { bookingSessions.set(guestDbId, { guest_id: guestDbId, ...row }); },
    postsTo: table => posts.get(table) ?? [],
    guestDbId: anonymousId => guests.get(anonymousId)?.id,
    feedbackEventRow: id => feedbackEvents.get(id),
    restaurantId: RESTAURANT_ID,
  };
}

/** Installs the harness as global.fetch and the required env vars for the
 *  duration of `run`, restoring everything afterward -- the same
 *  try/finally pattern already established in this repo's other
 *  fetch-mocked tests. */
export async function withHarness<T>(
  run: (harness: Harness) => Promise<T>,
  catalogOverrides: HarnessCatalog = {},
): Promise<T> {
  const originalFetch = global.fetch;
  const originalEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    CUSTOMER_PII_ENCRYPTION_KEY: process.env.CUSTOMER_PII_ENCRYPTION_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    THONGTHAI_ONE_MIND_CUTOVER: process.env.THONGTHAI_ONE_MIND_CUTOVER,
    LINE_CHANNEL_ACCESS_TOKEN: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  };
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  process.env.CUSTOMER_PII_ENCRYPTION_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  // Only actually exercised when a test programs a bound ops channel (see
  // programOpsChannel) -- linePush (_ops-notifications.ts) throws if this
  // is unset, so it must be present even though most tests never bind a
  // channel and never reach it.
  process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-line-channel-access-token';
  // netlify.toml's [build.environment] only applies to Netlify's own
  // build/deploy -- it does NOT carry into a local `node --test` run, so
  // without setting this explicitly here the entire One-Mind cutover
  // block in thongthai-chat.ts's handler is silently skipped and this
  // harness would never be testing what production actually runs.
  process.env.THONGTHAI_ONE_MIND_CUTOVER = '1';
  const harness = createHarness(catalogOverrides);
  global.fetch = harness.fetchMock;
  try {
    return await run(harness);
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

/** Real request.guestId values are validated as UUIDs downstream
 *  (loadCustomerMemory/resolveCanonicalGuestId etc. all reject anything
 *  that doesn't match UUID_RE), so test guest ids must be REAL,
 *  RFC4122-shaped UUIDs, not arbitrary strings. Deterministic from a
 *  short readable seed via sha256, mirroring how the real code derives a
 *  stable UUID-shaped id from a LINE user id (see line-webhook.ts's own
 *  lineGuestId). */
export function guestId(seed: string): string {
  const hex = createHash('sha256').update('test-guest:' + seed, 'utf8').digest('hex').slice(0, 32).split('');
  hex[12] = '4';
  const variant = parseInt(hex[16], 16);
  hex[16] = ((variant & 0x3) | 0x8).toString(16);
  const value = hex.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`;
}

export function brainRequest(
  message: string,
  guestDbId: string,
  channel: 'web' | 'line' = 'web',
  /** Prior turns to send as request.chatHistory -- the real client sends
   *  the whole visible conversation on every request (this pipeline has
   *  no server-side chat-history store), so a test proving multi-turn
   *  behavior (e.g. a domain switch across turns) must populate this
   *  itself; it's empty by default because most tests are single-turn. */
  history: Array<{ role: 'user' | 'assistant'; content: string }> = [],
): {
  guestId: string; message: string; language: 'th'; chatHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  guestContext: { tripDuration: null; travelerType: null; group: { adults: null; children: null; elderly: null }; interests: never[]; pace: null; budget: null; constraints: never[] };
  journeyContext: { currentPlan: null; savedPlan: null; visitedExperiences: never[]; favorites: never[]; journalEntries: never[] };
  pageContext: { section: string };
} {
  return {
    guestId: guestDbId, message, language: 'th', chatHistory: history,
    guestContext: { tripDuration: null, travelerType: null, group: { adults: null, children: null, elderly: null }, interests: [], pace: null, budget: null, constraints: [] },
    journeyContext: { currentPlan: null, savedPlan: null, visitedExperiences: [], favorites: [], journalEntries: [] },
    pageContext: { section: channel },
  };
}
