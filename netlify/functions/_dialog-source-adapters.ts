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
import { loadActivePromotionsWorldFact } from './_promotions-runtime';
import { listOtopProducts } from './_operations-db';
import type { GroundedFact, KnowledgeSourceAdapters, KnowledgeSourceType, SourceResult } from './_knowledge-resolver';

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
async function activityCatalogAdapter(now: Date = new Date()): Promise<SourceResult> {
  try {
    const rows = await loadActivityWorldFacts();
    const facts: GroundedFact[] = [];
    for (const row of rows) {
      const value = row.fact_value as { activities?: Array<{ activityCode: string; resourceCode: string; name: string; durations: Array<{ durationMinutes: number; price: number | null }>; assets: Array<{ code: string; name: string; type: string }> }> };
      for (const activity of value.activities ?? []) {
        facts.push({ key: `activity:${activity.activityCode}:resourceCode`, value: activity.resourceCode, domain: 'activity', sourceId: row.fact_key, sourceType: 'activity_live', authoritative: true, fetchedAt: now.toISOString(), updatedAt: row.updated_at });
        for (const duration of activity.durations) {
          facts.push({ key: `activity:${activity.activityCode}:${duration.durationMinutes}min:price`, value: duration.price, domain: 'activity', sourceId: row.fact_key, sourceType: 'activity_live', authoritative: true, fetchedAt: now.toISOString(), updatedAt: row.updated_at });
        }
        for (const asset of activity.assets) {
          facts.push({ key: `activity_asset:${asset.code}:name`, value: asset.name, domain: 'activity', sourceId: row.fact_key, sourceType: 'activity_live', authoritative: true, fetchedAt: now.toISOString(), updatedAt: row.updated_at });
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
      { key: `otop:${product.sku}:price`, value: product.price, domain: 'otop' as const, sourceId: 'otop_products_live', sourceType: 'otop_live' as const, authoritative: true, fetchedAt: now.toISOString() },
      { key: `otop:${product.sku}:stock`, value: product.stock, domain: 'otop' as const, sourceId: 'otop_products_live', sourceType: 'otop_live' as const, authoritative: true, fetchedAt: now.toISOString() },
    ]);
    return ok('otop_products_live', 'otop_live', facts, now);
  } catch (error) { return unavailable('otop_products_live', 'otop_live', error, now); }
}

/** Builds a real KnowledgeSourceAdapters set for the given channel.
 *  Deliberately partial: only restaurant/activity(catalog)/promotion/otop
 *  are wired today, matching what existing functions cleanly support
 *  read-only. Availability/booking-status/stay/membership/cafe real
 *  adapters need per-request argument mapping (date/resourceCode/
 *  partySize/reference id) beyond a bare KnowledgeRequest and are left for
 *  Phase G's channel migration work, tracked in THONGTHAI_HANDOFF.md. */
export function buildRealKnowledgeSourceAdapters(channel: BrainChannel): KnowledgeSourceAdapters {
  return {
    restaurant: { menu: () => restaurantMenuAdapter() },
    activity: { catalog: () => activityCatalogAdapter() },
    promotion: { eligibility: () => promotionEligibilityAdapter(channel)() },
    otop: { catalog: () => otopCatalogAdapter() },
  };
}
