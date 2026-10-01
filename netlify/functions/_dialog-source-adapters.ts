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
  listStayBookingOptions,
  listOtopProducts,
  listServiceResources,
  loadLatestBookingStatus,
  loadLatestPaymentStatus,
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
    const fetchedAt = now.toISOString();
    const facts: GroundedFact[] = items.flatMap(item => {
      const base = {
        domain: 'restaurant' as const,
        sourceId: 'restaurant_menu_live',
        sourceType: 'restaurant_live' as const,
        authoritative: true,
        fetchedAt,
        updatedAt: item.source_updated_at,
      };
      return [
        { ...base, key: `menu:${item.menu_item_id}:name`, value: item.name },
        { ...base, key: `menu:${item.menu_item_id}:category`, value: item.category_name },
        { ...base, key: `menu:${item.menu_item_id}:price`, value: item.selling_price },
        { ...base, key: `menu:${item.menu_item_id}:orderable`, value: item.is_orderable },
        { ...base, key: `menu:${item.menu_item_id}:availableServings`, value: item.available_servings },
        { ...base, key: `menu:${item.menu_item_id}:ingredients`, value: item.ingredient_names },
        { ...base, key: `menu:${item.menu_item_id}:unavailableIngredients`, value: item.unavailable_ingredients },
        { ...base, key: `menu:${item.menu_item_id}:signature`, value: item.is_signature },
        { ...base, key: `menu:${item.menu_item_id}:safety`, value: item.safety },
        { ...base, key: `menu:${item.menu_item_id}:customization`, value: item.customization },
        { ...base, key: `menu:${item.menu_item_id}:customization:canRemoveChili`, value: item.customization.canRemoveChili },
        { ...base, key: `menu:${item.menu_item_id}:customization:spiceAdjustable`, value: item.customization.spiceAdjustable },
        { ...base, key: `menu:${item.menu_item_id}:customization:allowedSpiceLevels`, value: item.customization.allowedSpiceLevels },
        { ...base, key: `menu:${item.menu_item_id}:customization:canRemoveFermentedFish`, value: item.customization.canRemoveFermentedFish },
        { ...base, key: `menu:${item.menu_item_id}:customization:canRemoveMsg`, value: item.customization.canRemoveMsg },
        { ...base, key: `menu:${item.menu_item_id}:customization:canReduceOrRemoveSugar`, value: item.customization.canReduceOrRemoveSugar },
        { ...base, key: `menu:${item.menu_item_id}:customization:removableIngredients`, value: item.customization.removableIngredients },
        { ...base, key: `menu:${item.menu_item_id}:customization:addableIngredients`, value: item.customization.addableIngredients },
        { ...base, key: `menu:${item.menu_item_id}:customization:substitutions`, value: item.customization.substitutions },
        { ...base, key: `menu:${item.menu_item_id}:safety:crossContaminationRisk`, value: item.safety.crossContaminationRisk },
        ...Object.entries(item.safety.allergens).map(([allergen, state]) => ({ ...base, key: `menu:${item.menu_item_id}:allergen:${allergen}`, value: state })),
        ...(item.description ? [{ ...base, key: `menu:${item.menu_item_id}:description`, value: item.description }] : []),
      ];
    });
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
      const value = row.fact_value as { activities?: Array<{
        activityCode: string;
        resourceCode: string;
        name: string;
        status?: string;
        inventoryTotal?: number;
        activeInventory?: number;
        notes?: string | null;
        requirements?: string[];
        durations: Array<{ durationMinutes: number; price: number | null; currency?: string; status?: string }>;
        assets: Array<{ code: string; name: string; type: string; metadata?: Record<string, unknown> }>;
      }> };
      const activities = requestedActivityCode
        ? (value.activities ?? []).filter(activity => activity.activityCode === requestedActivityCode)
        : (value.activities ?? []);
      for (const activity of activities) {
        facts.push({ key: `activity:${activity.activityCode}:name`, value: activity.name, domain: 'activity', sourceId: row.fact_key, sourceType: 'activity_live', authoritative: true, fetchedAt: now.toISOString(), updatedAt: row.updated_at });
        facts.push({ key: `activity:${activity.activityCode}:resourceCode`, value: activity.resourceCode, domain: 'activity', sourceId: row.fact_key, sourceType: 'activity_live', authoritative: true, fetchedAt: now.toISOString(), updatedAt: row.updated_at });
        facts.push({ key: `activity:${activity.activityCode}:status`, value: activity.status ?? 'available', domain: 'activity', sourceId: row.fact_key, sourceType: 'activity_live', authoritative: true, fetchedAt: now.toISOString(), updatedAt: row.updated_at });
        facts.push({ key: `activity:${activity.activityCode}:inventoryTotal`, value: Number(activity.inventoryTotal ?? activity.assets.length), domain: 'activity', sourceId: row.fact_key, sourceType: 'activity_live', authoritative: true, fetchedAt: now.toISOString(), updatedAt: row.updated_at });
        facts.push({ key: `activity:${activity.activityCode}:activeInventory`, value: Number(activity.activeInventory ?? activity.assets.length), domain: 'activity', sourceId: row.fact_key, sourceType: 'activity_live', authoritative: true, fetchedAt: now.toISOString(), updatedAt: row.updated_at });
        facts.push({ key: `activity:${activity.activityCode}:assetCount`, value: activity.assets.length, domain: 'activity', sourceId: row.fact_key, sourceType: 'activity_live', authoritative: true, fetchedAt: now.toISOString(), updatedAt: row.updated_at });
        facts.push({ key: `activity:${activity.activityCode}:durationOptions`, value: activity.durations.map(duration => ({
          durationMinutes: duration.durationMinutes,
          price: duration.price,
          currency: duration.currency ?? 'THB',
          status: duration.status ?? activity.status ?? 'available',
        })), domain: 'activity', sourceId: row.fact_key, sourceType: 'activity_live', authoritative: true, fetchedAt: now.toISOString(), updatedAt: row.updated_at });
        if (activity.notes) facts.push({ key: `activity:${activity.activityCode}:notes`, value: activity.notes, domain: 'activity', sourceId: row.fact_key, sourceType: 'activity_live', authoritative: true, fetchedAt: now.toISOString(), updatedAt: row.updated_at });
        if (activity.requirements?.length) facts.push({ key: `activity:${activity.activityCode}:requirements`, value: activity.requirements, domain: 'activity', sourceId: row.fact_key, sourceType: 'activity_live', authoritative: true, fetchedAt: now.toISOString(), updatedAt: row.updated_at });
        for (const duration of activity.durations) {
          facts.push({ key: `activity:${activity.activityCode}:${duration.durationMinutes}min:price`, value: duration.price, domain: 'activity', sourceId: row.fact_key, sourceType: 'activity_live', authoritative: true, fetchedAt: now.toISOString(), updatedAt: row.updated_at });
          facts.push({ key: `activity:${activity.activityCode}:${duration.durationMinutes}min:status`, value: duration.status ?? activity.status ?? 'available', domain: 'activity', sourceId: row.fact_key, sourceType: 'activity_live', authoritative: true, fetchedAt: now.toISOString(), updatedAt: row.updated_at });
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
      const fetchedAt=now.toISOString();
      const facts: GroundedFact[] = rows.flatMap(row => {
        const base={domain:'promotion' as const,sourceId:'promotions_active',sourceType:'promotion_runtime' as const,authoritative:true,fetchedAt,updatedAt:row.updated_at};
        const root:GroundedFact={...base,key:`promo:${row.fact_key}`,value:row.fact_value};
        const raw=row.fact_value && typeof row.fact_value==='object' && !Array.isArray(row.fact_value)
          ? row.fact_value as Record<string,unknown> : {};
        const promotions=Array.isArray(raw.promotions) ? raw.promotions : [];
        const expanded=promotions.flatMap(value=>{
          if(!value||typeof value!=='object'||Array.isArray(value)) return [];
          const promo=value as Record<string,unknown>;
          const id=typeof promo.campaignId==='string'?promo.campaignId.trim():'';
          if(!id) return [];
          const entries:Array<[string,unknown]> = [
            ['name',promo.title],
            ['campaignCode',promo.campaignCode],
            ['description',promo.description],
            ['businessScope',promo.businessScope],
            ['promoType',promo.promoType],
            ['items',promo.items],
            ['normalTotal',promo.normalTotal],
            ['promoTotal',promo.promoTotal],
            ['discountPct',promo.discountPct],
            ['startAt',promo.startAt],
            ['endAt',promo.endAt],
            ['maxRedemptions',promo.maxRedemptions],
            ['redemptionCount',promo.redemptionCount],
            ['requiresDateTime',promo.requiresDateTime],
            ['requiresMembership',promo.requiresMembership],
            ['automatedHandoff',promo.automatedHandoff],
            ['eligible',true],
          ];
          return entries
            .filter(([,v])=>v!==undefined)
            .map(([key,v])=>({...base,key:`promo:${id}:${key}`,value:v}));
        });
        return [root,...expanded];
      });
      return ok('promotions_active', 'promotion_runtime', facts, now);
    } catch (error) { return unavailable('promotions_active', 'promotion_runtime', error, now); }
  };
}

/** Reuses listOtopProducts() exactly and respects the caller's environment.
 * This is critical for certification: test Agent sessions must never read live
 * stock while their transaction tools are constrained to test rows. */
async function otopCatalogAdapter(
  environment: 'live' | 'test' = 'live',
  now: Date = new Date(),
): Promise<SourceResult> {
  const sourceId = environment === 'test' ? 'otop_products_test' : 'otop_products_live';
  try {
    const products = await listOtopProducts(environment);
    const facts: GroundedFact[] = products.flatMap(product => [
      { key: `otop:${product.sku}:name`, value: product.name, domain: 'otop' as const, sourceId, sourceType: 'otop_live' as const, authoritative: true, fetchedAt: now.toISOString() },
      { key: `otop:${product.sku}:description`, value: product.description, domain: 'otop' as const, sourceId, sourceType: 'otop_live' as const, authoritative: true, fetchedAt: now.toISOString() },
      { key: `otop:${product.sku}:price`, value: product.price, domain: 'otop' as const, sourceId, sourceType: 'otop_live' as const, authoritative: true, fetchedAt: now.toISOString() },
      { key: `otop:${product.sku}:stock`, value: product.stock, domain: 'otop' as const, sourceId, sourceType: 'otop_live' as const, authoritative: true, fetchedAt: now.toISOString() },
    ]);
    return ok(sourceId, 'otop_live', facts, now);
  } catch (error) { return unavailable(sourceId, 'otop_live', error, now); }
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
  endDate: string | null;
  resourceCode: string | null;
  durationMinutes: number | null;
  partySize: number | null;
} | null {
  if (request.domain !== 'activity' && request.domain !== 'stay') return null;
  return {
    serviceType: request.domain,
    date: stringValue(request, 'date'),
    endDate: stringValue(request, 'endDate'),
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
    if (args.serviceType === 'stay' && !args.endDate) return unavailable(sourceId, sourceType, new Error('missing_end_date'), now);
    try {
      const options = args.serviceType === 'stay'
        ? await listStayBookingOptions(args.date, args.endDate!, environment, args.resourceCode, args.partySize)
        : await listBookingOptions(args.serviceType, args.date, environment, args.resourceCode, args.durationMinutes, args.partySize);
      const facts: GroundedFact[] = options.flatMap(option => {
        const keyBase = `availability:${option.resourceCode}:${option.startAt}`;
        return [
          { key: `${keyBase}:available`, value: option.available > 0, domain: request.domain, sourceId, sourceType, authoritative: true, fetchedAt: now.toISOString() },
          { key: `${keyBase}:capacity_available`, value: option.available, domain: request.domain, sourceId, sourceType, authoritative: true, fetchedAt: now.toISOString() },
          { key: `${keyBase}:startAt`, value: option.startAt, domain: request.domain, sourceId, sourceType, authoritative: true, fetchedAt: now.toISOString() },
          { key: `${keyBase}:endAt`, value: option.endAt, domain: request.domain, sourceId, sourceType, authoritative: true, fetchedAt: now.toISOString() },
        ];
      });
      if (request.domain === 'stay') {
        // Carry canonical Stay type relationships in the SAME bundle as
        // mutable availability, so the central scope firewall can filter an
        // intentionally broad operational result without relying on renderer
        // keywords or on facts from a different request/bundle.
        const resources = await listServiceResources('stay');
        for (const resource of resources) {
          facts.push({ key:`stay:${resource.code}:name`, value:resource.name, domain:'stay', sourceId, sourceType, authoritative:true, fetchedAt:now.toISOString(), updatedAt:resource.updatedAt });
          const bedrooms = Number(resource.metadata.bedrooms ?? resource.metadata.bedroom_count);
          if (Number.isInteger(bedrooms) && bedrooms > 0) facts.push({ key:`stay:${resource.code}:bedrooms`, value:bedrooms, domain:'stay', sourceId, sourceType, authoritative:true, fetchedAt:now.toISOString(), updatedAt:resource.updatedAt });
          const roomType = [resource.metadata.roomType, resource.metadata.room_type, resource.metadata.accommodation_room_type_code]
            .find((value): value is string => typeof value === 'string' && value.trim().length > 0);
          if (roomType) facts.push({ key:`stay:${resource.code}:roomType`, value:roomType.trim(), domain:'stay', sourceId, sourceType, authoritative:true, fetchedAt:now.toISOString(), updatedAt:resource.updatedAt });
        }
      }
      return ok(sourceId, sourceType, facts, now);
    } catch (error) { return unavailable(sourceId, sourceType, error, now); }
  };
}

async function stayCatalogAdapter(_request: KnowledgeRequest, now: Date = new Date()): Promise<SourceResult> {
  const sourceId = 'stay_service_resources_live';
  try {
    const resources = await listServiceResources('stay');
    const facts: GroundedFact[] = resources.flatMap(resource => {
      const base: GroundedFact[] = [
        { key: `stay:${resource.code}:name`, value: resource.name, domain: 'stay' as const, sourceId, sourceType: 'stay_live' as const, authoritative: true, fetchedAt: now.toISOString(), updatedAt: resource.updatedAt },
        { key: `stay:${resource.code}:description`, value: resource.description, domain: 'stay' as const, sourceId, sourceType: 'stay_live' as const, authoritative: true, fetchedAt: now.toISOString(), updatedAt: resource.updatedAt },
        { key: `stay:${resource.code}:capacity`, value: resource.defaultCapacity, domain: 'stay' as const, sourceId, sourceType: 'stay_live' as const, authoritative: true, fetchedAt: now.toISOString(), updatedAt: resource.updatedAt },
      ];
      const bedrooms = Number(resource.metadata.bedrooms ?? resource.metadata.bedroom_count);
      if (Number.isInteger(bedrooms) && bedrooms > 0) base.push({ key:`stay:${resource.code}:bedrooms`, value:bedrooms, domain:'stay', sourceId, sourceType:'stay_live', authoritative:true, fetchedAt:now.toISOString(), updatedAt:resource.updatedAt });
      const roomType = [resource.metadata.roomType, resource.metadata.room_type, resource.metadata.accommodation_room_type_code]
        .find((value): value is string => typeof value === 'string' && value.trim().length > 0);
      if (roomType) base.push({ key:`stay:${resource.code}:roomType`, value:roomType.trim(), domain:'stay', sourceId, sourceType:'stay_live', authoritative:true, fetchedAt:now.toISOString(), updatedAt:resource.updatedAt });
      const amenities = Array.isArray(resource.metadata.amenities)
        ? resource.metadata.amenities.filter((value): value is string => typeof value === 'string' && value.trim().length > 0).map(value => value.trim())
        : [];
      if (amenities.length) base.push({ key:`stay:${resource.code}:amenities`, value:[...new Set(amenities)], domain:'stay', sourceId, sourceType:'stay_live', authoritative:true, fetchedAt:now.toISOString(), updatedAt:resource.updatedAt });
      const price = Number(resource.metadata.pricePerNight ?? resource.metadata.price_per_night ?? resource.metadata.price);
      if (Number.isFinite(price) && price >= 0) base.push({ key:`stay:${resource.code}:price`, value:price, domain:'stay', sourceId, sourceType:'stay_live', authoritative:true, fetchedAt:now.toISOString(), updatedAt:resource.updatedAt });
      return base;
    });
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

function paymentStatusAdapter(guestDbId: string | null | undefined) {
  return async (request: KnowledgeRequest, now: Date = new Date()): Promise<SourceResult> => {
    const sourceId = 'payments_operational';
    if (!guestDbId) return unavailable(sourceId, 'payment_operational', new Error('guest_identity_required'), now);
    try {
      const code = stringValue(request, 'paymentCode')
        ?? stringValue(request, 'entityCode')
        ?? stringValue(request, 'bookingCode')
        ?? stringValue(request, 'orderCode');
      const payment = await loadLatestPaymentStatus(guestDbId, code);
      if (!payment) return { status:'empty', sourceId, sourceType:'payment_operational', fetchedAt:now.toISOString() };
      const base = `payment:${payment.entityCode}`;
      return ok(sourceId, 'payment_operational', [
        { key:`${base}:paymentCode`, value:payment.paymentCode, domain:'payment', sourceId, sourceType:'payment_operational', authoritative:true, fetchedAt:now.toISOString(), updatedAt:payment.updatedAt },
        { key:`${base}:status`, value:payment.status, domain:'payment', sourceId, sourceType:'payment_operational', authoritative:true, fetchedAt:now.toISOString(), updatedAt:payment.updatedAt },
        { key:`${base}:amount`, value:payment.amount, domain:'payment', sourceId, sourceType:'payment_operational', authoritative:true, fetchedAt:now.toISOString(), updatedAt:payment.updatedAt },
        { key:`${base}:currency`, value:payment.currency, domain:'payment', sourceId, sourceType:'payment_operational', authoritative:true, fetchedAt:now.toISOString(), updatedAt:payment.updatedAt },
        { key:`${base}:method`, value:payment.method, domain:'payment', sourceId, sourceType:'payment_operational', authoritative:true, fetchedAt:now.toISOString(), updatedAt:payment.updatedAt },
        { key:`${base}:sourceChannel`, value:payment.sourceChannel, domain:'payment', sourceId, sourceType:'payment_operational', authoritative:true, fetchedAt:now.toISOString(), updatedAt:payment.updatedAt },
      ], now);
    } catch (error) { return unavailable(sourceId, 'payment_operational', error, now); }
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
    paymentStatus: { lookup: request => paymentStatusAdapter(options.guestDbId)(request) },
    membership: { status: request => membershipStatusAdapter(options.guestDbId)(request) },
    otop: { catalog: request => otopCatalogAdapter(environment) },
  };
}
