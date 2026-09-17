-- Hotfix: allow settlement notification delivery records in the shared ops delivery log.
-- Applied to production Supabase on 2026-09-17 after team-settlements-v1 exposed
-- legacy CHECK constraints that rejected entity_type='team_settlement' and
-- delivery_type='settlement_%'. Keep all previously-supported values intact.

alter table public.ops_notification_deliveries
  drop constraint if exists ops_notification_deliveries_entity_type_check;

alter table public.ops_notification_deliveries
  add constraint ops_notification_deliveries_entity_type_check
  check (
    entity_type is null
    or entity_type in (
      'booking',
      'cafe_inquiry',
      'otop_order',
      'restaurant_preorder',
      'daily_schedule',
      'payment_request',
      'team_settlement'
    )
  );

alter table public.ops_notification_deliveries
  drop constraint if exists ops_notification_deliveries_delivery_type_check;

alter table public.ops_notification_deliveries
  add constraint ops_notification_deliveries_delivery_type_check
  check (
    delivery_type in (
      'booking_created',
      'cafe_inquiry_created',
      'otop_order_created',
      'restaurant_preorder_created',
      'daily_schedule',
      'daily_summary',
      'manual_test'
    )
    or delivery_type like 'payment_%'
    or delivery_type like 'settlement_%'
  );
