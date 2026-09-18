// Deterministic promotion discovery/redemption dialog -- a fallback for when
// the LLM brain is unavailable, so a real customer can still see and redeem
// an active promotion without depending on the model generating a
// redeem_promotion tool call. Pure, no I/O (mirrors _restaurant-preorder-dialog.ts),
// so it is fully unit-testable without mocking the network/LLM/DB.
//
// Reuses parseRestaurantPreorderTurn/mergeRestaurantPreorderDraft from the
// restaurant preorder dialog for date/time/name/phone/email extraction --
// same shape, same rules, never re-implemented here.
import {
  mergeRestaurantPreorderDraft, parseRestaurantPreorderTurn,
  type RestaurantPreorderDraft,
} from './_restaurant-preorder-dialog';

export type PromotionListItem = {
  campaignId: string; campaignCode: string; title: string; description: string | null;
  businessScope: string; promoType: string;
  items: Array<{ name: string; quantity: number; businessUnit: string }>;
  normalTotal: number | null; promoTotal: number | null; discountPct: number | null;
  startAt: string | null; endAt: string | null;
  maxRedemptions: number | null; redemptionCount: number;
  requiresDateTime: boolean; automatedHandoff: boolean;
};

export type PendingPromotionRedemption = {
  campaignId: string; campaignCode: string; title: string;
  items: Array<{ name: string; quantity: number }>;
  requiresDateTime: boolean;
  promoTotal: number | null;
  draft: RestaurantPreorderDraft;
};

function emptyDraft(now = new Date()): RestaurantPreorderDraft {
  return { date: null, time: null, customerName: null, phone: null, email: null, acceptedAt: now.toISOString() };
}

export function buildPendingPromotionRedemption(
  promo: PromotionListItem, draft: RestaurantPreorderDraft = emptyDraft(),
): PendingPromotionRedemption {
  return {
    campaignId: promo.campaignId, campaignCode: promo.campaignCode, title: promo.title,
    items: promo.items.map(item => ({ name: item.name, quantity: item.quantity })),
    requiresDateTime: promo.requiresDateTime, promoTotal: promo.promoTotal,
    draft,
  };
}

/** A promotion mention must always be handled here (or by the LLM's redeem_promotion
 *  tool) -- never silently ignored. Excludes "โปรด" (please), an unrelated polite word. */
export function isPromotionMention(message: string): boolean {
  return /โปร(?!ด)/u.test(message);
}

const DISCOVERY_RE = /(มีโปรอะไร|โปรอะไรบ้าง|โปรโมชันอะไร|โปรโมชั่นอะไร|มีโปรโมชัน|มีโปรโมชั่น|วันนี้มีโปร|โปรสำหรับ|โปรวันนี้|ขอดูโปร|เช็คโปร|เช็กโปร|โปรมีอะไรบ้าง|โปรไหนบ้าง|มีโปรไหน)/u;
const ACCEPT_RE = /(เอาโปรนี้|ใช้โปรนี้|รับโปรนี้|เอาสิทธิ์นี้|รับสิทธิ์นี้|รับโปรโมชันนี้|รับโปรโมชั่นนี้|เอาโปรโมชันนี้|เอาโปรโมชั่นนี้)/u;

export function isPromotionDiscoveryIntent(message: string): boolean {
  return DISCOVERY_RE.test(message);
}
export function isPromotionAcceptIntent(message: string): boolean {
  return ACCEPT_RE.test(message);
}

function normalizeThai(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Resolves a message to exactly one promotion by campaign code or title/item-name
 *  mention. Returns null (never guesses) when zero or more than one match. */
export function matchPromotionByText(message: string, promotions: PromotionListItem[]): PromotionListItem | null {
  const text = normalizeThai(message);
  const byCode = promotions.find(promo => text.includes(promo.campaignCode.toLowerCase()));
  if (byCode) return byCode;
  const matches = promotions.filter(promo => {
    const title = normalizeThai(promo.title);
    if (title && text.includes(title)) return true;
    return promo.items.some(item => {
      const name = normalizeThai(item.name);
      return name.length >= 2 && text.includes(name);
    });
  });
  return matches.length === 1 ? matches[0] : null;
}

export function formatPromotionListMessage(promotions: PromotionListItem[]): string {
  if (!promotions.length) return 'ตอนนี้ทำมา-ชาติยังไม่มีโปรโมชั่นพิเศษเปิดใช้งานครับ';
  const lines = ['ตอนนี้มีโปรโมชั่นดังนี้ครับ', ''];
  for (const promo of promotions) {
    const itemLine = promo.items.map(item => `${item.name} x${item.quantity}`).join(' + ');
    lines.push(`💡 ${promo.title}`);
    if (itemLine) lines.push(itemLine);
    if (promo.promoTotal != null && promo.normalTotal != null) {
      lines.push(`ราคาพิเศษ ${Math.round(promo.promoTotal)} บาท (จากปกติ ${Math.round(promo.normalTotal)} บาท)`);
    }
    lines.push('');
  }
  lines.push('สนใจรับโปรไหนแจ้งชื่อโปรหรือพิมพ์ "เอาโปรนี้" พร้อมวันเวลาได้เลยครับ');
  return lines.join('\n').replace(/\n{3,}/gu, '\n\n').trim();
}

export function formatPromotionClarificationMessage(promotions: PromotionListItem[]): string {
  const titles = promotions.map(promo => `• ${promo.title}`).join('\n');
  return `ตอนนี้มีหลายโปรครับ อยากรับโปรไหนบอกชื่อโปรได้เลย\n${titles}`;
}

export function missingPromotionFields(pending: PendingPromotionRedemption): Array<'date' | 'time' | 'customerName'> {
  const missing: Array<'date' | 'time' | 'customerName'> = [];
  if (pending.requiresDateTime) {
    if (!pending.draft.date) missing.push('date');
    if (!pending.draft.time) missing.push('time');
  }
  if (!pending.draft.customerName) missing.push('customerName');
  return missing;
}

export function formatPromotionRedeemPrompt(pending: PendingPromotionRedemption): string {
  const missing = missingPromotionFields(pending);
  const itemLine = pending.items.map(item => `${item.name} x${item.quantity}`).join(' + ');
  const lines = [`💡 ${pending.title}`];
  if (itemLine) lines.push(itemLine);
  if (pending.promoTotal != null) lines.push(`ราคาพิเศษ ${Math.round(pending.promoTotal)} บาท`);
  lines.push('');
  if (missing.includes('date') || missing.includes('time')) {
    lines.push('ขอวัน + เวลารับอาหารครับ เช่น "พรุ่งนี้ 14:00"');
  } else if (missing.includes('customerName')) {
    lines.push('ขอชื่อผู้รับสิทธิ์โปรโมชันครับ');
  }
  return lines.join('\n');
}

/** Reads a possibly-untrusted agentState value back into a typed pending redemption,
 *  or null if the shape doesn't match -- defensive against a stale/corrupted state row. */
export function parsePendingPromotionRedemption(value: unknown): PendingPromotionRedemption | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.campaignId !== 'string' || typeof raw.campaignCode !== 'string' || typeof raw.title !== 'string') return null;
  const rawItems = Array.isArray(raw.items) ? raw.items : [];
  const items = rawItems
    .map(item => item && typeof item === 'object' ? item as Record<string, unknown> : {})
    .map(item => ({ name: typeof item.name === 'string' ? item.name : '', quantity: typeof item.quantity === 'number' ? item.quantity : 1 }))
    .filter((item): item is { name: string; quantity: number } => Boolean(item.name));
  if (!items.length) return null;
  const rawDraft = raw.draft && typeof raw.draft === 'object' ? raw.draft as Record<string, unknown> : {};
  const draft: RestaurantPreorderDraft = {
    date: typeof rawDraft.date === 'string' ? rawDraft.date : null,
    time: typeof rawDraft.time === 'string' ? rawDraft.time : null,
    customerName: typeof rawDraft.customerName === 'string' ? rawDraft.customerName : null,
    phone: typeof rawDraft.phone === 'string' ? rawDraft.phone : null,
    email: typeof rawDraft.email === 'string' ? rawDraft.email : null,
    acceptedAt: typeof rawDraft.acceptedAt === 'string' ? rawDraft.acceptedAt : new Date().toISOString(),
  };
  return {
    campaignId: raw.campaignId, campaignCode: raw.campaignCode, title: raw.title, items,
    requiresDateTime: raw.requiresDateTime === true,
    promoTotal: typeof raw.promoTotal === 'number' ? raw.promoTotal : null,
    draft,
  };
}

export type PromotionFallbackDecision =
  | { kind: 'not_promo_related' }
  | { kind: 'no_promotions' }
  | { kind: 'list'; promotions: PromotionListItem[] }
  | { kind: 'clarify'; promotions: PromotionListItem[] }
  | { kind: 'start_redemption'; pending: PendingPromotionRedemption };

/**
 * Pure decision core for the deterministic promo fallback -- given the raw
 * message and the real, already-eligibility-filtered promotion list (from
 * active_promotions_live), decides what to do next. Never invents a
 * promotion, price, or item: every field in the returned pending redemption
 * traces back to a `promotions` entry the caller supplied.
 */
export function decidePromotionFallback(message: string, promotions: PromotionListItem[]): PromotionFallbackDecision {
  if (!isPromotionMention(message)) return { kind: 'not_promo_related' };
  const matched = matchPromotionByText(message, promotions);
  const wantsToAccept = isPromotionAcceptIntent(message) || Boolean(matched);

  if (wantsToAccept) {
    const target = matched ?? (promotions.length === 1 ? promotions[0] : null);
    if (!target) return promotions.length ? { kind: 'clarify', promotions } : { kind: 'no_promotions' };
    const parsed = parseRestaurantPreorderTurn(message, {});
    const draft = mergeRestaurantPreorderDraft(undefined, parsed);
    return { kind: 'start_redemption', pending: buildPendingPromotionRedemption(target, draft) };
  }

  return promotions.length ? { kind: 'list', promotions } : { kind: 'no_promotions' };
}
