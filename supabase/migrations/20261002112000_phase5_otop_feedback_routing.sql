-- Phase 5 — Business + Incident Router
-- OTOP already has a real ops_notification_channels team_code and order
-- notification path. Customer-voice/incident routing now uses that same team,
-- so widen only the two closed ops_feedback_events enums that previously
-- omitted OTOP. Existing values remain valid.

alter table public.ops_feedback_events
  drop constraint if exists ops_feedback_events_business_unit_check;

alter table public.ops_feedback_events
  add constraint ops_feedback_events_business_unit_check
  check (business_unit in (
    'restaurant', 'activity', 'stay', 'cafe', 'otop',
    'membership', 'system', 'general', 'unknown'
  ));

alter table public.ops_feedback_events
  drop constraint if exists ops_feedback_events_route_target_check;

alter table public.ops_feedback_events
  add constraint ops_feedback_events_route_target_check
  check (route_target in (
    'owner_general', 'restaurant_group', 'activity_group', 'stay_group',
    'cafe_group', 'otop_group', 'admin_group'
  ));
