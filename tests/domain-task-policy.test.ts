// Phase E: domain policy registry tests. Proves computeTaskMissingFields
// reuses the REAL existing business logic for restaurant_preorder and
// promotion_redemption (never re-derives it), and applies the code-grounded
// static lists for activity/stay/restaurant booking.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeTaskMissingFields, DOMAIN_TASK_REQUIRED_FIELDS } from '../netlify/functions/_domain-task-policy';
import { createActiveTask } from '../netlify/functions/_task-state';
import { missingRestaurantPreorderFields } from '../netlify/functions/_restaurant-preorder-dialog';
import { missingPromotionFields } from '../netlify/functions/_promotion-dialog';

const NOW = new Date('2026-09-18T10:00:00.000Z');

test('activity_booking missing fields are grounded in createBooking\'s real validation (resourceCode, date, durationMinutes)', () => {
  const empty = createActiveTask({ type: 'activity_booking', sourceChannel: 'web', now: NOW });
  assert.deepEqual(computeTaskMissingFields(empty), ['resourceCode', 'date', 'durationMinutes']);
  const partial = createActiveTask({ type: 'activity_booking', sourceChannel: 'web', initialSlots: { resourceCode: 'activity-horse', date: '2026-09-19' }, now: NOW });
  assert.deepEqual(computeTaskMissingFields(partial), ['durationMinutes']);
  const complete = createActiveTask({ type: 'activity_booking', sourceChannel: 'web', initialSlots: { resourceCode: 'activity-horse', date: '2026-09-19', durationMinutes: 60 }, now: NOW });
  assert.deepEqual(computeTaskMissingFields(complete), []);
});

test('stay_booking and restaurant_booking only require date (createBooking does not hard-enforce anything else for them)', () => {
  const stay = createActiveTask({ type: 'stay_booking', sourceChannel: 'web', now: NOW });
  assert.deepEqual(computeTaskMissingFields(stay), ['date']);
  const restaurantBooking = createActiveTask({ type: 'restaurant_booking', sourceChannel: 'web', initialSlots: { date: '2026-09-19' }, now: NOW });
  assert.deepEqual(computeTaskMissingFields(restaurantBooking), []);
});

test('restaurant_preorder delegates to the REAL missingRestaurantPreorderFields, not a re-derived copy', () => {
  const task = createActiveTask({ type: 'restaurant_preorder', sourceChannel: 'web', initialSlots: { date: '2026-09-19', customerName: 'สมชาย' }, now: NOW });
  const expected = missingRestaurantPreorderFields({ date: '2026-09-19', time: null, customerName: 'สมชาย', phone: null, email: null, acceptedAt: NOW.toISOString() });
  assert.deepEqual(computeTaskMissingFields(task), expected);
  assert.deepEqual(expected, ['time', 'phone']);
});

test('promotion_redemption delegates to the REAL missingPromotionFields, including its requiresDateTime conditional', () => {
  const requiresDateTimeTask = createActiveTask({
    type: 'promotion_redemption', sourceChannel: 'line',
    initialSlots: { campaignId: 'c1', campaignCode: 'PROMO1', title: 'ตำไทย + ข้าวเหนียว', items: [], promoTotal: 99, requiresDateTime: true, customerName: 'สมชาย' },
    now: NOW,
  });
  const expected = missingPromotionFields({
    campaignId: 'c1', campaignCode: 'PROMO1', title: 'ตำไทย + ข้าวเหนียว', items: [], promoTotal: 99, requiresDateTime: true,
    draft: { date: null, time: null, customerName: 'สมชาย', phone: null, email: null, acceptedAt: NOW.toISOString() },
  });
  assert.deepEqual(computeTaskMissingFields(requiresDateTimeTask), expected);
  assert.deepEqual(expected, ['date', 'time']);

  // A promotion that does NOT require date/time (requiresDateTime: false)
  // must not demand it -- proving the conditional real rule is actually
  // reused, not flattened into a static list.
  const noDateTimeTask = createActiveTask({
    type: 'promotion_redemption', sourceChannel: 'line',
    initialSlots: { campaignId: 'c2', campaignCode: 'PROMO2', title: 'OTOP bundle', items: [], promoTotal: 50, requiresDateTime: false, customerName: 'สมหญิง' },
    now: NOW,
  });
  assert.deepEqual(computeTaskMissingFields(noDateTimeTask), []);
});

test('domains with no authored policy yet return [] rather than a guessed rule', () => {
  const membership = createActiveTask({ type: 'membership', sourceChannel: 'web', now: NOW });
  assert.deepEqual(computeTaskMissingFields(membership), []);
  const journey = createActiveTask({ type: 'journey_planning', sourceChannel: 'web', now: NOW });
  assert.deepEqual(computeTaskMissingFields(journey), []);
});

test('DOMAIN_TASK_REQUIRED_FIELDS only lists the three genuinely static domains, not the two conditional ones', () => {
  assert.deepEqual(DOMAIN_TASK_REQUIRED_FIELDS.activity_booking, ['resourceCode', 'date', 'durationMinutes']);
  assert.deepEqual(DOMAIN_TASK_REQUIRED_FIELDS.stay_booking, ['date']);
  assert.deepEqual(DOMAIN_TASK_REQUIRED_FIELDS.restaurant_booking, ['date']);
  assert.equal(DOMAIN_TASK_REQUIRED_FIELDS.restaurant_preorder, undefined, 'restaurant_preorder is conditional/data-dependent, not a static list');
  assert.equal(DOMAIN_TASK_REQUIRED_FIELDS.promotion_redemption, undefined, 'promotion_redemption is conditional on requiresDateTime, not a static list');
});
