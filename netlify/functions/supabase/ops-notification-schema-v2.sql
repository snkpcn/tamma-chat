-- Tamma operations LINE notification schema hardening.
-- Keeps one active LINE destination per team and supports all five operating teams.

alter table public.ops_notification_channels
  drop constraint if exists ops_notification_channels_team_code_check;
alter table public.ops_notification_channels
  add constraint ops_notification_channels_team_code_check
  check (team_code = any (array['restaurant'::text, 'stay'::text, 'activity'::text, 'cafe'::text, 'otop'::text, 'all'::text]));

alter table public.ops_notification_channels
  drop constraint if exists ops_notification_channels_service_type_check;
alter table public.ops_notification_channels
  add constraint ops_notification_channels_service_type_check
  check (service_type is null or service_type = any (array['restaurant'::text, 'stay'::text, 'activity'::text, 'cafe'::text, 'otop'::text]));

alter table public.ops_notification_channels
  drop constraint if exists ops_notification_channels_team_unique;
alter table public.ops_notification_channels
  add constraint ops_notification_channels_team_unique unique (team_code, provider);

alter table public.ops_notification_deliveries
  add column if not exists entity_type text,
  add column if not exists entity_id uuid,
  add column if not exists idempotency_key text;

alter table public.ops_notification_deliveries
  drop constraint if exists ops_notification_deliveries_entity_type_check;
alter table public.ops_notification_deliveries
  add constraint ops_notification_deliveries_entity_type_check
  check (entity_type is null or entity_type = any (array['booking'::text, 'cafe_inquiry'::text, 'otop_order'::text, 'daily_schedule'::text]));

create index if not exists ops_notification_deliveries_entity_idx
  on public.ops_notification_deliveries (entity_type, entity_id, created_at desc);

comment on table public.ops_notification_channels is
  'Server-only operational destinations for LINE team notifications. Target IDs are encrypted at rest.';
comment on table public.ops_notification_deliveries is
  'Audit/idempotency log for operational notifications sent by Thongthai.';

-- PostgREST upsert needs a real unique constraint (NULL values remain freely repeatable).
drop index if exists public.ops_notification_deliveries_idempotency_key_unique;
alter table public.ops_notification_deliveries
  drop constraint if exists ops_notification_deliveries_idempotency_unique;
alter table public.ops_notification_deliveries
  add constraint ops_notification_deliveries_idempotency_unique unique (idempotency_key);
