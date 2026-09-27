// Phase E: domain policy registry for ActiveTask required/missing fields.
// Phase D deliberately kept `requiredFields` OUT of _task-state.ts's core
// (no per-domain business logic in the generic container). This module is
// where that policy is actually authored -- ONE rule source, reusing the
// REAL existing business logic wherever it already exists
// (missingRestaurantPreorderFields, missingPromotionFields) rather than
// re-deriving a second copy of it. For the two domains with no existing
// dedicated "missing fields" function (activity/stay/restaurant BOOKING,
// as opposed to restaurant PREORDER), the required list below is grounded
// directly in createBooking's real validation in _operations-db.ts:
//   - CreateBookingInput.date is non-optional on the type itself.
//   - serviceType === 'activity' hard-throws activity_resource_required
//     and activity_duration_required if resourceCode/durationMinutes are
//     missing.
//   - Stay execution rejects a missing/invalid endDate and an unresolved
//     resource cannot be a safe customer selection. Party size is required
//     by the Stay business flow before a request is submitted.
import { missingPromotionFields, type PendingPromotionRedemption } from './_promotion-dialog';
import { missingRestaurantPreorderFields, type RestaurantPreorderDraft } from './_restaurant-preorder-dialog';
import type { ActiveTask, ActiveTaskType } from './_task-state';

const ACTIVITY_BOOKING_REQUIRED = ['resourceCode', 'date', 'durationMinutes'] as const;
const STAY_BOOKING_REQUIRED = ['resourceCode', 'date', 'endDate', 'partySize'] as const;
const RESTAURANT_BOOKING_REQUIRED = ['date', 'time', 'partySize', 'customerName', 'phone'] as const;

function missingFromStaticList(slots: Record<string, unknown>, required: readonly string[]): string[] {
  return required.filter(field => slots[field] === null || slots[field] === undefined || slots[field] === '');
}

function taskSlotsToRestaurantPreorderDraft(task: ActiveTask): RestaurantPreorderDraft {
  return {
    date: typeof task.slots.date === 'string' ? task.slots.date : null,
    time: typeof task.slots.time === 'string' ? task.slots.time : null,
    customerName: typeof task.slots.customerName === 'string' ? task.slots.customerName : null,
    phone: typeof task.slots.phone === 'string' ? task.slots.phone : null,
    email: typeof task.slots.email === 'string' ? task.slots.email : null,
    acceptedAt: task.createdAt,
  };
}

function taskSlotsToPendingPromotionRedemption(task: ActiveTask): PendingPromotionRedemption {
  return {
    campaignId: typeof task.slots.campaignId === 'string' ? task.slots.campaignId : '',
    campaignCode: typeof task.slots.campaignCode === 'string' ? task.slots.campaignCode : '',
    title: typeof task.slots.title === 'string' ? task.slots.title : '',
    items: Array.isArray(task.slots.items) ? task.slots.items as PendingPromotionRedemption['items'] : [],
    // Defaults to true (the safer assumption -- ask rather than silently
    // skip a real date/time requirement) if the source promotion's own
    // requiresDateTime flag was never carried into slots.
    requiresDateTime: task.slots.requiresDateTime !== false,
    promoTotal: typeof task.slots.promoTotal === 'number' ? task.slots.promoTotal : null,
    draft: taskSlotsToRestaurantPreorderDraft(task),
  };
}

/** Single entry point: given a task's CURRENT slots, what is still missing?
 *  Reuses real business logic for the two domains that already have it;
 *  uses a code-grounded static list (see file header) for the three that
 *  don't. Returns [] for domains with no authored policy yet (membership,
 *  otop_order, cafe_inquiry, journey_planning) -- deliberately NOT guessed. */
function hasValidRestaurantPreorderItems(task: ActiveTask): boolean {
  if (!Array.isArray(task.slots.items) || task.slots.items.length === 0) return false;
  return task.slots.items.every(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const row = item as Record<string, unknown>;
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    const quantity = Number(row.quantity);
    return Boolean(name) && Number.isInteger(quantity) && quantity >= 1 && quantity <= 50;
  });
}

export function computeTaskMissingFields(task: ActiveTask): string[] {
  switch (task.type) {
    case 'restaurant_preorder': {
      const missing = missingRestaurantPreorderFields(taskSlotsToRestaurantPreorderDraft(task));
      return hasValidRestaurantPreorderItems(task) ? missing : ['items', ...missing];
    }
    case 'promotion_redemption':
      return missingPromotionFields(taskSlotsToPendingPromotionRedemption(task));
    case 'activity_booking':
      return missingFromStaticList(task.slots, ACTIVITY_BOOKING_REQUIRED);
    case 'stay_booking':
      return missingFromStaticList(task.slots, STAY_BOOKING_REQUIRED);
    case 'restaurant_booking':
      return missingFromStaticList(task.slots, RESTAURANT_BOOKING_REQUIRED);
    default:
      return [];
  }
}

/** The required-field NAME lists themselves, for callers (e.g. _task-state.ts's
 *  mergeTaskSlots) that want a static requiredFields array up front rather
 *  than a post-hoc missing-fields computation. Only defined for the three
 *  domains with a genuinely static (non-conditional) real rule; the other
 *  two (restaurant_preorder, promotion_redemption) are conditional on task
 *  data (e.g. a promotion's requiresDateTime) and so are only available via
 *  computeTaskMissingFields above, not as a fixed list. */
export const DOMAIN_TASK_REQUIRED_FIELDS: Partial<Record<ActiveTaskType, readonly string[]>> = {
  activity_booking: ACTIVITY_BOOKING_REQUIRED,
  stay_booking: STAY_BOOKING_REQUIRED,
  restaurant_booking: RESTAURANT_BOOKING_REQUIRED,
};
