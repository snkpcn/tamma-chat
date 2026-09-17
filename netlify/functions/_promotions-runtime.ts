import { createRestaurantPreorderWithPromotion, listRestaurantMenu } from './_restaurant-sot';
import type { BrainChannel } from './_thongthai-brain-v3';

export type PromotionCampaignRow = {
  id: string; campaign_code: string; title: string; description: string | null;
  business_scope: string; status: string; promo_type: string;
  start_at: string | null; end_at: string | null; channel_scope: unknown;
  financial_snapshot: unknown; max_redemptions: number | null;
  redemption_count: number; environment: string;
};
export type PromotionItemRow = {
  business_unit: string; entity_id: string; name_snapshot: string; quantity: number;
  promo_price?: number | null; cost_basis?: number | null;
};

function config(): { url: string; key: string } {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase configuration missing');
  return { url: url.replace(/\/$/, ''), key };
}

async function publicDbFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const c = config();
  const response = await fetch(`${c.url}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: c.key, Authorization: `Bearer ${c.key}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`promotions_db_${response.status}:${body.slice(0, 250)}`);
  }
  return response;
}

function cleanArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [];
}

/** Empty channel_scope means unrestricted (owner did not narrow visibility); non-empty must contain this channel. */
export function channelMatches(channelScope: unknown, channel: BrainChannel): boolean {
  const scopes = cleanArray(channelScope);
  return !scopes.length || scopes.includes(channel);
}

export type EligibilityRejectionReason =
  | 'not_found' | 'not_active' | 'not_started' | 'expired' | 'redemption_limit_reached';
export type EligibilityCheck = { ok: true } | { ok: false; reason: EligibilityRejectionReason };

/**
 * Pure customer-visibility gate, independent of channel/items. A promotion
 * only ever becomes visible or redeemable once every one of these holds:
 * status=active, environment=live, now inside [start_at,end_at], and under
 * max_redemptions. draft/pending_review/paused/ended/cancelled/test never pass.
 */
export function checkCampaignEligibility(
  campaign: Pick<PromotionCampaignRow, 'status' | 'environment' | 'start_at' | 'end_at' | 'max_redemptions' | 'redemption_count'> | null,
  nowMs: number,
): EligibilityCheck {
  if (!campaign) return { ok: false, reason: 'not_found' };
  if (campaign.status !== 'active' || campaign.environment !== 'live') return { ok: false, reason: 'not_active' };
  if (campaign.start_at && new Date(campaign.start_at).valueOf() > nowMs) return { ok: false, reason: 'not_started' };
  if (campaign.end_at && new Date(campaign.end_at).valueOf() < nowMs) return { ok: false, reason: 'expired' };
  if (campaign.max_redemptions != null && campaign.redemption_count >= campaign.max_redemptions) return { ok: false, reason: 'redemption_limit_reached' };
  return { ok: true };
}

/** A restaurant promotion item is only available if the live menu still has it orderable with enough stock for the promo's stored quantity. */
export function isRestaurantItemAvailable(
  menuItem: { is_orderable: boolean; available_servings: number } | undefined,
  quantity: number,
): boolean {
  return Boolean(menuItem) && menuItem!.is_orderable && menuItem!.available_servings >= quantity;
}

/** Item/qty fidelity: the preorder must use exactly the promo's stored items, never a re-derived or re-typed list. */
export function preorderItemsFromPromotionItems(items: PromotionItemRow[]): Array<{ name: string; quantity: number }> {
  return items.map(item => ({ name: item.name_snapshot, quantity: item.quantity }));
}

/**
 * The ONLY place a per-item promo price is ever assembled for the payment
 * RPC -- built exclusively from real, currently-stored promotion_items rows
 * fetched fresh inside redeemPromotion. There is no code path from a tool
 * call's args (or any other caller-supplied value) into this map; the brain
 * tool's redeem_promotion args carry no price field at all. A restaurant
 * item with no stored promo_price is simply left out of the map, so the RPC
 * falls back to the live menu price for that line -- never invented, never
 * zero by accident.
 */
export function buildPricingOverride(items: PromotionItemRow[]): Record<string, number> {
  const override: Record<string, number> = {};
  for (const item of items) {
    if (item.business_unit === 'restaurant' && typeof item.promo_price === 'number' && item.promo_price >= 0) {
      override[item.entity_id] = item.promo_price;
    }
  }
  return override;
}

async function fetchEligibleCampaigns(nowIso: string): Promise<PromotionCampaignRow[]> {
  const filter = [
    'status=eq.active',
    'environment=eq.live',
    `or=(start_at.is.null,start_at.lte.${nowIso})`,
  ].join('&');
  const response = await publicDbFetch(
    `promotion_campaigns?${filter}` +
    '&select=id,campaign_code,title,description,business_scope,status,promo_type,start_at,end_at,channel_scope,financial_snapshot,max_redemptions,redemption_count,environment' +
    '&order=created_at.desc',
  );
  const rows = await response.json() as PromotionCampaignRow[];
  const now = new Date(nowIso).valueOf();
  return rows.filter(row => checkCampaignEligibility(row, now).ok);
}

async function itemsForCampaigns(campaignIds: string[]): Promise<Map<string, PromotionItemRow[]>> {
  const map = new Map<string, PromotionItemRow[]>();
  if (!campaignIds.length) return map;
  const idFilter = campaignIds.map(id => `"${id}"`).join(',');
  const response = await publicDbFetch(
    `promotion_items?campaign_id=in.(${idFilter})&select=campaign_id,business_unit,entity_id,name_snapshot,quantity`,
  );
  const rows = await response.json() as Array<PromotionItemRow & { campaign_id: string }>;
  for (const row of rows) {
    const list = map.get(row.campaign_id) ?? [];
    list.push(row);
    map.set(row.campaign_id, list);
  }
  return map;
}

/**
 * Never-invented, real-time eligible promotions for the customer's channel.
 * status=active + environment=live + inside [start_at,end_at] + channel_scope match +
 * under max_redemptions + every restaurant item still orderable in real stock.
 * Draft/pending_review/paused/ended/cancelled/test never reach here.
 */
export async function loadActivePromotionsWorldFact(
  channel: BrainChannel,
): Promise<Array<{ fact_key: string; category: string; fact_value: unknown; source: string; updated_at: string }>> {
  try {
    const nowIso = new Date().toISOString();
    const campaigns = (await fetchEligibleCampaigns(nowIso)).filter(row => channelMatches(row.channel_scope, channel));
    const itemMap = await itemsForCampaigns(campaigns.map(row => row.id));
    let restaurantMenu: Awaited<ReturnType<typeof listRestaurantMenu>> | null = null;
    const eligible: Array<Record<string, unknown>> = [];
    for (const campaign of campaigns) {
      const items = itemMap.get(campaign.id) ?? [];
      if (!items.length) continue;
      let allAvailable = true;
      for (const item of items) {
        if (item.business_unit === 'restaurant') {
          if (!restaurantMenu) restaurantMenu = await listRestaurantMenu();
          const menuItem = restaurantMenu.find(m => m.menu_item_id === item.entity_id || m.name === item.name_snapshot);
          if (!isRestaurantItemAvailable(menuItem, item.quantity)) { allAvailable = false; break; }
        }
      }
      if (!allAvailable) continue;
      const snapshot = campaign.financial_snapshot && typeof campaign.financial_snapshot === 'object'
        ? campaign.financial_snapshot as Record<string, unknown> : {};
      eligible.push({
        campaignId: campaign.id, campaignCode: campaign.campaign_code, title: campaign.title,
        description: campaign.description, businessScope: campaign.business_scope, promoType: campaign.promo_type,
        items: items.map(item => ({ name: item.name_snapshot, quantity: item.quantity, businessUnit: item.business_unit })),
        normalTotal: snapshot.normalTotal ?? null, promoTotal: snapshot.promoTotal ?? null,
        discountPct: snapshot.discountPct ?? null,
        startAt: campaign.start_at, endAt: campaign.end_at,
        maxRedemptions: campaign.max_redemptions, redemptionCount: campaign.redemption_count,
        requiresDateTime: campaign.business_scope === 'restaurant',
        automatedHandoff: campaign.business_scope === 'restaurant',
      });
    }
    return [{
      fact_key: 'active_promotions_live', category: 'operations',
      fact_value: { promotions: eligible }, source: 'promotion_campaigns+promotion_items', updated_at: nowIso,
    }];
  } catch (error) {
    console.error('PROMOTIONS_WORLD_FACT_ERROR', error instanceof Error ? error.message.slice(0, 220) : 'unknown');
    return [];
  }
}

export type RedeemPromotionResult = {
  campaignId: string; campaignCode: string; status: 'redeemed' | 'reserved'; businessScope: string;
  preorder?: { id: string; preorderCode: string; items: Array<{ name: string; quantity: number }> };
  note: string;
};

function eligibilityRejectionError(reason: EligibilityRejectionReason): Error {
  const map: Record<EligibilityRejectionReason, string> = {
    not_found: 'promotion_not_found',
    not_active: 'promotion_not_active',
    not_started: 'promotion_not_started',
    expired: 'promotion_expired',
    redemption_limit_reached: 'promotion_redemption_limit_reached',
  };
  return new Error(map[reason]);
}

/**
 * Reuses the real restaurant order path (createRestaurantPreorderWithPromotion,
 * itself a thin promo-priced sibling of createRestaurantPreorder) for
 * restaurant-scope promos, with the promo's exact stored items/qty and real
 * promo price -- never a parallel order system, never an invented amount.
 * Re-checks every eligibility rule server-side (never trusts the LLM's
 * earlier read of world facts). Non-restaurant scopes (including
 * cross_business, where multi-entity settlement split is not implemented)
 * only record a reserved redemption for staff follow-up -- never a
 * fabricated completed booking.
 */
export async function redeemPromotion(input: {
  guestDbId: string; channel: BrainChannel; campaignId: string;
  date?: string | null; time?: string | null;
  customerName: string; phone?: string | null; email?: string | null; note?: string | null;
}): Promise<RedeemPromotionResult> {
  const campaignRes = await publicDbFetch(
    `promotion_campaigns?id=eq.${input.campaignId}&select=id,campaign_code,title,business_scope,status,promo_type,start_at,end_at,channel_scope,financial_snapshot,max_redemptions,redemption_count,environment&limit=1`,
  );
  const campaign = (await campaignRes.json() as PromotionCampaignRow[])[0] ?? null;
  const eligibility = checkCampaignEligibility(campaign, Date.now());
  if (eligibility.ok === false) throw eligibilityRejectionError(eligibility.reason);
  if (!channelMatches(campaign!.channel_scope, input.channel)) throw new Error('promotion_channel_not_allowed');

  const itemsRes = await publicDbFetch(`promotion_items?campaign_id=eq.${campaign!.id}&select=business_unit,entity_id,name_snapshot,quantity,promo_price,cost_basis`);
  const items = await itemsRes.json() as PromotionItemRow[];
  if (!items.length) throw new Error('promotion_has_no_items');

  const snapshot = campaign!.financial_snapshot && typeof campaign!.financial_snapshot === 'object'
    ? campaign!.financial_snapshot as Record<string, unknown> : {};

  let result: RedeemPromotionResult;
  if (campaign!.business_scope === 'restaurant') {
    if (!input.date || !input.time) throw new Error('promotion_requires_date_time');
    const created = await createRestaurantPreorderWithPromotion({
      guestDbId: input.guestDbId, channel: input.channel,
      date: input.date, time: input.time,
      items: preorderItemsFromPromotionItems(items),
      customerName: input.customerName, phone: input.phone, email: input.email,
      note: [input.note, `PROMO:${campaign!.campaign_code}`].filter(Boolean).join(' | '),
      promotionCampaignId: campaign!.id,
      pricingOverride: buildPricingOverride(items),
    });
    if (created.duplicate) {
      // The preorder already existed (same idempotency key) -- skip inserting a
      // second promotion_redemptions row and skip incrementing redemption_count
      // again. This is what makes a duplicate webhook delivery or a repeated
      // tool call safe: no double charge, no double-counted redemption.
      return {
        campaignId: campaign!.id, campaignCode: campaign!.campaign_code, status: 'redeemed',
        businessScope: campaign!.business_scope,
        preorder: { id: created.id, preorderCode: created.preorderCode, items: created.items },
        note: 'duplicate_redemption_request_returned_existing_preorder_no_new_charge_created',
      };
    }
    await publicDbFetch('promotion_redemptions', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        campaign_id: campaign!.id, guest_id: input.guestDbId, source_channel: input.channel,
        related_entity_type: 'restaurant_preorder', related_entity_id: created.id,
        normal_total: created.normalTotalAmount, promo_total: created.totalAmount,
        cost_total: snapshot.costTotal ?? null, gross_profit: snapshot.grossProfit ?? null, margin_pct: snapshot.marginPct ?? null,
        status: 'redeemed', environment: 'live',
      }),
    });
    result = {
      campaignId: campaign!.id, campaignCode: campaign!.campaign_code, status: 'redeemed', businessScope: campaign!.business_scope,
      preorder: { id: created.id, preorderCode: created.preorderCode, items: created.items },
      note: `preorder_created_at_real_promo_price; normalTotal=${created.normalTotalAmount} promoTotal=${created.totalAmount} discount=${created.discountAmount}`,
    };
  } else {
    await publicDbFetch('promotion_redemptions', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        campaign_id: campaign!.id, guest_id: input.guestDbId, source_channel: input.channel,
        related_entity_type: null, related_entity_id: null,
        normal_total: snapshot.normalTotal ?? null, promo_total: snapshot.promoTotal ?? null,
        cost_total: snapshot.costTotal ?? null, gross_profit: snapshot.grossProfit ?? null, margin_pct: snapshot.marginPct ?? null,
        status: 'reserved', environment: 'live',
      }),
    });
    result = {
      campaignId: campaign!.id, campaignCode: campaign!.campaign_code, status: 'reserved', businessScope: campaign!.business_scope,
      note: 'no_automated_order_flow_for_this_business_scope_yet; recorded_for_staff_followup_only',
    };
  }
  await publicDbFetch(`promotion_campaigns?id=eq.${campaign!.id}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ redemption_count: campaign!.redemption_count + 1 }),
  });
  return result;
}
