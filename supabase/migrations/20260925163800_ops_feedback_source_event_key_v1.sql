-- Phase 8 operational polish: make Customer Voice creation idempotent per
-- transport event (LINE message.id / web event id).
--
-- Existing rows remain NULL and are untouched. PostgreSQL unique indexes
-- allow multiple NULLs, so historical feedback is unaffected.
alter table public.ops_feedback_events
  add column if not exists source_event_key text;

create unique index if not exists ops_feedback_events_source_event_key_uq
  on public.ops_feedback_events (source_event_key);
