-- ============================================================================
-- APPLIED directly to tamma-customer-data (project upaokrprawzhgzeqsdke) via
-- the Supabase MCP tool on 2026-09-23, under explicit owner authorization
-- from the "PROOF-FIRST SYSTEM FIX ONLY" task (Task 3: fix owner group
-- notification). This file is kept as the reviewed record of that change,
-- matching this repo's migration convention.
--
-- THE BUG, found by querying REAL production ops_feedback_events rows (not
-- guessed): EVERY feedback notification since the Feedback Operations
-- feature was built has failed at the database layer, entirely
-- independent of the owner_general binding work done in prior rounds.
-- notifyFeedbackEvent (netlify/functions/_ops-notifications.ts) calls
-- sendTeamMessage with `entityType: 'feedback_event'` and
-- `deliveryType: 'feedback_' + feedback_type` (e.g. 'feedback_system_
-- feedback', 'feedback_complaint'). beginDelivery inserts a row into
-- ops_notification_deliveries BEFORE ever attempting the actual LINE push
-- (an idempotency-reservation pattern) -- and that insert was rejected by
-- TWO CHECK constraints that were never extended when the feedback
-- feature was built:
--   ops_notification_deliveries_entity_type_check -- allowed only
--     booking/cafe_inquiry/otop_order/restaurant_preorder/daily_schedule/
--     payment_request/team_settlement (or NULL). 'feedback_event' was
--     never added.
--   ops_notification_deliveries_delivery_type_check -- allowed only a
--     fixed list (booking_created, daily_schedule, ...) plus a
--     payment_%/settlement_% prefix pattern. No feedback_% pattern
--     existed at all.
-- Confirmed directly from a real row's notification_error column:
--   "Ops notification DB request failed 400: {"code":"23514",...
--   feedback_system_feedback, line, pending, null, {..."
-- -- this is Postgres check_violation on the INSERT itself, so the LINE
-- push for a feedback notification was NEVER EVEN ATTEMPTED, regardless
-- of whether owner_general was bound. This is why the owner group
-- received nothing after every prior round's feedback-pipeline fix --
-- none of those rounds could have found this without querying the real
-- notification_error text, which none of them did.
--
-- THE FIX IS PURELY ADDITIVE: widens both CHECK constraints to also
-- accept the feedback shapes, alongside everything they already allowed.
-- A CHECK constraint cannot be altered in place in Postgres, so this
-- drops and immediately recreates each one with the same shape plus the
-- new allowance -- existing rows (13 booking_created, 35 daily_schedule,
-- 20 payment_*, 3 restaurant_preorder_created, 4 settlement_*, all
-- already satisfying the broader constraint) are unaffected; verified
-- via direct query before and after.
-- ============================================================================

ALTER TABLE public.ops_notification_deliveries
  DROP CONSTRAINT IF EXISTS ops_notification_deliveries_entity_type_check;

ALTER TABLE public.ops_notification_deliveries
  ADD CONSTRAINT ops_notification_deliveries_entity_type_check
  CHECK (
    entity_type IS NULL
    OR entity_type = ANY (ARRAY[
      'booking'::text,
      'cafe_inquiry'::text,
      'otop_order'::text,
      'restaurant_preorder'::text,
      'daily_schedule'::text,
      'payment_request'::text,
      'team_settlement'::text,
      'feedback_event'::text
    ])
  );

ALTER TABLE public.ops_notification_deliveries
  DROP CONSTRAINT IF EXISTS ops_notification_deliveries_delivery_type_check;

ALTER TABLE public.ops_notification_deliveries
  ADD CONSTRAINT ops_notification_deliveries_delivery_type_check
  CHECK (
    delivery_type = ANY (ARRAY[
      'booking_created'::text,
      'cafe_inquiry_created'::text,
      'otop_order_created'::text,
      'restaurant_preorder_created'::text,
      'daily_schedule'::text,
      'daily_summary'::text,
      'manual_test'::text
    ])
    OR delivery_type LIKE 'payment_%'
    OR delivery_type LIKE 'settlement_%'
    OR delivery_type LIKE 'feedback_%'
  );
