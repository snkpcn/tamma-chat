-- Lost-property and other customer incidents must be durable operational
-- cases, not transient chat copy. Existing RLS/service-role access remains
-- unchanged; this migration only widens the closed feedback taxonomy.

alter table public.ops_feedback_events
  drop constraint if exists ops_feedback_events_feedback_type_check;

alter table public.ops_feedback_events
  add constraint ops_feedback_events_feedback_type_check
  check (feedback_type in (
    'compliment', 'complaint', 'suggestion', 'safety_issue', 'system_feedback', 'incident'
  ));
