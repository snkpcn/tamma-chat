// Phase F: ONE set of thin, real, READ-ONLY KnowledgeSourceAdapters
// (_knowledge-resolver.ts's injection contract), each wrapping an
// ALREADY-EXISTING function -- never a new/duplicate query against a table
// an existing function already owns. No transaction writes live here.
//
// Not wired into any request handler. This module exists so the shadow
// orchestration path (tests + any future Phase F/G integration point) has
// real adapters available, proving the Dialog Manager's contract actually
// composes with real data shapes -- not just mocks. Still network-bound
// (real Supabase calls), so it is NOT covered by unit tests, matching this
// codebase's existing convention for DB I/O wrappers (loadBrainRuntime,
// persistBrainRuntime, loadConversationContext, etc. are the same).
import type { BrainChannel } from './_thongthai-brain-v3';
import { listRestaurantMenu } from './_restaurant-sot';
import { loadActivityWorldFacts } from './_activity-sot';
import { ACTIVITY_ASSET_ATTRIBUTE_KEYS } from './_activity-catalog-policy';
import { loadActivePromotionsWorldFact } from './_promotions-runtime';
import {
  listBookingOptions,
  listOtopProducts,
  listServiceResources,
  loadLatestBookingStatus,
  loadMembershipStatus,
} from './_operations-db';
import type {
  GroundedFact,
  KnowledgeRequest,
  KnowledgeSourceAdapters,
  KnowledgeSourceType,
  SourceResult,
} from './_knowledge-resolver';

function ok(sourceId: string, sourceType: KnowledgeSourceType, data: GroundedFact[], now: Date): SourceResult {
  const fetchedAt = now.toISOString();
  return data.length ? { status: 'ok', data, sourceId, sourceType, fetchedAt } : { status: 'empty', sourceId, sourceType, fetchedAt };
}
function unavailable(sourceId: string, sourceType: KnowledgeSourceType, error: unknown, now: Date): SourceResult {
  return { status: 'unavailable', sourceId, sourceType, fetchedAt: now.toISOString(), error: error instanceof Error ? error.message.slice(0, 180) : 'unknown' };
}

/** Reuses listRestaurantMenu() exactly -- no duplicate query against
 *  restaurant_menu_live. */
async function restaurantMenuAdapter(now: Date = new Date()): Promise<SourceResult> {
  try {
    const items = await listRestaurantMenu();
    const facts: GroundedFact[] = items.flatMap(item => [
      { key: `menu:${item.menu_item_id}:price`, value: item.selling_price, domain: 'restaurant' as const, sourceId: 'restaurant_menu_live', sourceType: 'restaurant_live' as const, authoritative: true, fetchedAt: now.toISOString() },
      { key: `menu:${item.menu_item_id}:orderable`, value: item.is_orderable, domain: 'restaurant' as const, sourceId: 'restaurant_menu_live', sourceType: 'restaurant_live' as const, authoritative: true, fetchedAt: now.toISOString() },
      { key: `menu:${item.menu_item_id}:name`, value: item.name, domain: 'restaurant' as const, sourceId: 'restaurant_menu_live', sourceType: 'restaurant_live' as const, authoritative: true, fetchedAt: now.toISOString() },
    ]);
    return ok('restaurant_menu_live', 'restaurant_live', facts, now);
  } catch (error) { return unavailable('restaurant_menu_live', 'restaurant_live', error, now); }
}

/** Reuses loadActivityWorldFacts() exactly (now a neutral module, see
 *  _activity-sot.ts's header for why it was extracted). */
async function activityCatalogAdapter(request: KnowledgeRequest, now: Date = new Date()): Promise<SourceResult> {
  try {
    const rows = await loadActivityWorldFacts();
    const facts: GroundedFact[] = [];
    const requestedActivityCode = typeof request.entities.activityCode === 'string'
      ? request.entities.activityCode.trim()
      : null;
    for (const row of rows) {
      const value = row.fact_value as { activities?: Array<{ activityCode: string; resourceCode: string; name: string; durations: Array<{ durationMinutes: number; price: number | null }>; assets: Array<{ code: string; name: string; type: string; metadata?: Record<string, unknown> }> }> };
      const activities = requestedActivityCode
        ? (value.activities ?? []).filter(activity => activity.activityCode === requestedActivityCode)
        : (value.activities ?? []);
      for (const activity of activities) {
        facts.push({ key: `activity:${activity.activityCode}:name`, value: activity.name, domain: 'activity', sourceId: row.fact_key, sourceType: 'activity_live', authoritative: true, fetchedAt: now.toISOString(), updatedAt: row.updated_at });
        facts.push({ key: `activity:${activity.activityCode}:resourceCode`, value: activity.resourceCode, domain: 'activity', sourceId: row.fact_key, sourceType: 'activity_live', authoritative: true, fetchedAt: now.toISOString(), updatedAt: row.updated_at });
        facts.push({ key: `activity:${activity.activityCode}:assetCount`, value: activity.assets.length, domain: 'activity', sourceId: row.fact_key, sourceType: 'activity_live', authoritative: true, fetchedAt: now.toISOString(), updatedAt: row.updated_at });
        for (const duration of activity.durations) {
          facts.push({ key: `activity:${activity.activityCode}:${duration.durationMinutes}min:price`, value: duration.price, domain: 'activity', sourceId: row.fact_key, sourceType: 'activity_live', authoritative: true, fetchedAt: now.toISOString(), updatedAt: row.updated_at });
        }
        for (const asset of activity.assets) {
          const entityId = `activity_asset:${asset.code}`;
          facts.push({ key: `${entityId}:name`, value: asset.name, domain: 'activity', sourceId: row.fact_key, sourceType: 'activity_live', authoritative: true, fetchedAt: now.toISOString(), updatedAt: row.updated_at });
          facts.push({ key: `${entityId}:type`, value: asset.type, domain: 'activity', sourceId: row.fact_key, sourceType: 'activity_live', authoritative: true, fetchedAt: now.toISOString(), updatedAt: row.updated_at });
          // Links a named asset ("ภาราดร") back to its parent activity code,
          // so a customer's asset selection can resolve to the REAL bookable
          // resourceCode authoritatively (see _activity-catalog-policy.ts) --
          // never by assuming the asset id and the booking resourceCode are
          // the same string, which they are not (one resourceCode per
          // ACTIVITY TYPE, not per named asset -- see _operations-db.ts).
          facts.push({ key: `${entityId}:activityCode`, value: activity.activityCode, domain: 'activity', sourceId: row.fact_key, sourceType: 'activity_live', authoritative: true, fetchedAt: now.toISOString(), updatedAt: row.updated_at });
          // Optional structured attributes (temperament, beginner
          // suitability, etc.) -- a fact is emitted ONLY when operations has
          // actually recorded that specific field for this asset; nothing
          // is ever defaulted or invented (see _activity-catalog-policy.ts's
          // ACTIVITY_ASSET_ATTRIBUTE_KEYS header). Key format
          // "<attribute>:<entityId>" matches resolveDialogDecision's
          // existing anti-hallucination comparison check in
          // _dialog-manager.ts.
          const metadata = asset.metadata ?? {};
          for (const attributeKey of ACTIVITY_ASSET_ATTRIBUTE_KEYS) {
            const attributeValue = metadata[attributeKey];
            if (attributeValue === undefined || attributeValue === null) continue;
            facts.push({ key: `${attributeKey}:${entityId}`, value: attributeValue, domain: 'activity', sourceId: row.fact_key, sourceType: 'activity_live', authoritative: true, fetchedAt: now.toISOString(), updatedAt: row.updated_at });
          }
        }
      }
    }
    return ok('activity_catalog_live', 'activity_live', facts, now);
  } catch (error) { return unavailable('activity_catalog_live', 'activity_live', error, now); }
}


/** Reuses loadActivePromotionsWorldFact(channel) exactly -- the real
 *  eligibility filtering (active window, channel scope, redemption limits)
 *  already lives there; this adapter never re-derives it. */
function promotionEligibilityAdapter(channel: BrainChannel): (now?: Date) => Promise<SourceResult> {
  return async (now: Date = new Date()): Promise<SourceResult> => {
    try {
      const rows = await loadActivePromotionsWorldFact(channel);
      const facts: GroundedFact[] = rows.map(row => ({
        key: `promo:${row.fact_key}`, value: row.fact_value, domain: 'promotion', sourceId: 'promotions_active', sourceType: 'promotion_runtime',
        authoritative: true, fetchedAt: now.toISOString(), updatedAt: row.updated_at,
      }));
      return ok('promotions_active', 'promotion_runtime', facts, now);
    } catch (error) { return unavailable('promotions_active', 'promotion_runtime', error, now); }
  };
}

/** Reuses listOtopProducts() exactly. */
async function otopCatalogAdapter(now: Date = new Date()): Promise<SourceResult> {
  try {
    const products = await listOtopProducts('live');
    const facts: GroundedFact[] = products.flatMap(product => [
      { key: `otop:${product.sku}:name`, value: product.name, domain: 'otop' as const, sourceId: 'otop_products_live', sourceType: 'otop_live' as const, authoritative: true, fetchedAt: now.toISOString() },
      { key: `otop:${product.sku}:description`, value: product.description, domain: 'otop' as const, sourceId: 'otop_products_live', sourceType: 'otop_live' as const, authoritative: true, fetchedAt: now.toISOString() },
      { key: `otop:${product.sku}:price`, value: product.price, domain: 'otop' as const, sourceId: 'otop_products_live', sourceType: 'otop_live' as const, authoritative: true, fetchedAt: now.toISOString() },
      { key: `otop:${product.sku}:stock`, value: product.stock, domain: 'otop' as const, sourceId: 'otop_products_live', sourceType: 'otop_live' as const, authoritative: true, fetchedAt: now.toISOString() },
    ]);
    return ok('otop_products_live', 'otop_live', facts, now);
  } catch (error) { return unavailable('otop_products_live', 'otop_live', error, now); }
}

function requestValue(request: KnowledgeRequest, key: string): unknown {
  return request.entities[key] ?? request.task?.slots?.[key];
}
function stringValue(request: KnowledgeRequest, key: string): string | null {
  const value = requestValue(request, key);
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function numberValue(request: KnowledgeRequest, key: string): number | null {
  const value = Number(requestValue(request, key));
  return Number.isFinite(value) ? value : null;
}

/** Pure request shaping used by both the real adapter and network-free tests. */
export function bookingAvailabilityArgs(request: KnowledgeRequest): {
  serviceType: 'activity' | 'stay';
  date: string | null;
  resourceCode: string | null;
  durationMinutes: number | null;
  partySize: number | null;
} | null {
  if (request.domain !== 'activity' && request.domain !== 'stay') return null;
  return {
    serviceType: request.domain,
    date: stringValue(request, 'date'),
    resourceCode: stringValue(request, 'resourceCode'),
    durationMinutes: numberValue(request, 'durationMinutes'),
    partySize: numberValue(request, 'partySize'),
  };
}

function availabilityAdapter(environment: 'live' | 'test' = 'live') {
  return async (request: KnowledgeRequest, now: Date = new Date()): Promise<SourceResult> => {
    const args = bookingAvailabilityArgs(request);
    const sourceType: KnowledgeSourceType = request.domain === 'stay' ? 'stay_live' : 'activity_live';
    const sourceId = request.domain === 'stay' ? 'stay_booking_options_live' : 'activity_booking_options_live';
    if (!args?.date) return unavailable(sourceId, sourceType, new Error('missing_date'), now);
    try {
      const options = await listBookingOptions(
        args.serviceType,
        args.date,
        environment,
        args.resourceCode,
        args.durationMinutes,
        args.partySize,
      );
      const facts: GroundedFact[] = options.flatMap(option => {
        const keyBase = `availability:${option.resourceCode}:${option.startAt}`;
        return [
          { key: `${keyBase}:available`, value: option.available > 0, domain: request.domain, sourceId, sourceType, authoritative: true, fetchedAt: now.toISOString() },
          { key: `${keyBase}:capacity_available`, value: option.available, domain: request.domain, sourceId, sourceType, authoritative: true, fetchedAt: now.toISOString() },
          { key: `${keyBase}:startAt`, value: option.startAt, domain: request.domain, sourceId, sourceType, authoritative: true, fetchedAt: now.toISOString() },
          { key: `${keyBase}:endAt`, value: option.endAt, domain: request.domain, sourceId, sourceType, authoritative: true, fetchedAt: now.toISOString() },
        ];
      });
      return ok(sourceId, sourceType, facts, now);
    } catch (error) { return unavailable(sourceId, sourceType, error, now); }
  };
}

async function stayCatalogAdapter(_request: KnowledgeRequest, now: Date = new Date()): Promise<SourceResult> {
  const sourceId = 'stay_service_resources_live';
  try {
    const resources = await listServiceResources('stay');
    const facts: GroundedFact[] = resources.flatMap(resource => [
      { key: `stay:${resource.code}:name`, value: resource.name, domain: 'stay' as const, sourceId, sourceType: 'stay_live' as const, authoritative: true, fetchedAt: now.toISOString(), updatedAt: resource.updatedAt },
      { key: `stay:${resource.code}:description`, value: resource.description, domain: 'stay' as const, sourceId, sourceType: 'stay_live' as const, authoritative: true, fetchedAt: now.toISOString(), updatedAt: resource.updatedAt },
      { key: `stay:${resource.code}:capacity`, value: resource.defaultCapacity, domain: 'stay' as const, sourceId, sourceType: 'stay_live' as const, authoritative: true, fetchedAt: now.toISOString(), updatedAt: resource.updatedAt },
    ]);
    return ok(sourceId, 'stay_live', facts, now);
  } catch (error) { return unavailable(sourceId, 'stay_live', error, now); }
}

function bookingStatusAdapter(guestDbId: string | null | undefined) {
  return async (request: KnowledgeRequest, now: Date = new Date()): Promise<SourceResult> => {
    const sourceId = 'bookings_operational';
    if (!guestDbId) return unavailable(sourceId, 'booking_operational', new Error('guest_identity_required'), now);
    try {
      const bookingCode = stringValue(request, 'bookingCode');
      const booking = await loadLatestBookingStatus(guestDbId, bookingCode);
      if (!booking) return { status: 'empty', sourceId, sourceType: 'booking_operational', fetchedAt: now.toISOString() };
      return ok(sourceId, 'booking_operational', [
        { key: `booking:${booking.bookingCode}:status`, value: booking.status, domain: request.domain, sourceId, sourceType: 'booking_operational', authoritative: true, fetchedAt: now.toISOString(), updatedAt: booking.updatedAt },
        { key: `booking:${booking.bookingCode}:contact_status`, value: booking.contactStatus, domain: request.domain, sourceId, sourceType: 'booking_operational', authoritative: true, fetchedAt: now.toISOString(), updatedAt: booking.updatedAt },
        { key: `booking:${booking.bookingCode}:startAt`, value: booking.startAt, domain: request.domain, sourceId, sourceType: 'booking_operational', authoritative: true, fetchedAt: now.toISOString(), updatedAt: booking.updatedAt },
      ], now);
    } catch (error) { return unavailable(sourceId, 'booking_operational', error, now); }
  };
}

function membershipStatusAdapter(guestDbId: string | null | undefined) {
  return async (request: KnowledgeRequest, now: Date = new Date()): Promise<SourceResult> => {
    const sourceId = 'customer_membership_operational';
    if (!guestDbId) return unavailable(sourceId, 'membership_operational', new Error('guest_identity_required'), now);
    try {
      const membership = await loadMembershipStatus(guestDbId);
      if (!membership) return { status: 'empty', sourceId, sourceType: 'membership_operational', fetchedAt: now.toISOString() };
      return ok(sourceId, 'membership_operational', [
        { key: 'membership:status', value: membership.memberStatus, domain: request.domain, sourceId, sourceType: 'membership_operational', authoritative: true, fetchedAt: now.toISOString() },
        { key: 'membership:profile_completed', value: Boolean(membership.profileCompletedAt), domain: request.domain, sourceId, sourceType: 'membership_operational', authoritative: true, fetchedAt: now.toISOString() },
      ], now);
    } catch (error) { return unavailable(sourceId, 'membership_operational', error, now); }
  };
}

export type RealKnowledgeAdapterOptions = {
  guestDbId?: string | null;
  environment?: 'live' | 'test';
};

/** Builds the read-only source set used by the One-Mind shadow
 * orchestrator. Every adapter wraps an existing canonical data-access
 * function; none performs a transactional write. */
export function buildRealKnowledgeSourceAdapters(
  channel: BrainChannel,
  options: RealKnowledgeAdapterOptions = {},
): KnowledgeSourceAdapters {
  const environment = options.environment ?? 'live';
  return {
    restaurant: { menu: request => restaurantMenuAdapter() },
    activity: {
      catalog: request => activityCatalogAdapter(request),
      availability: request => availabilityAdapter(environment)(request),
    },
    stay: {
      catalog: request => stayCatalogAdapter(request),
      availability: request => availabilityAdapter(environment)(request),
    },
    promotion: { eligibility: request => promotionEligibilityAdapter(channel)() },
    bookingStatus: { lookup: request => bookingStatusAdapter(options.guestDbId)(request) },
    membership: { status: request => membershipStatusAdapter(options.guestDbId)(request) },
    otop: { catalog: request => otopCatalogAdapter() },
  };
}
