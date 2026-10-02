alter table public.ops_notification_channels
  drop constraint if exists ops_notification_channels_team_code_check;

alter table public.ops_notification_channels
  add constraint ops_notification_channels_team_code_check
  check (team_code = any (array[
    'restaurant'::text,
    'stay'::text,
    'activity'::text,
    'cafe'::text,
    'cafe_test'::text,
    'otop'::text,
    'all'::text,
    'owner_general'::text,
    'ai_cost'::text
  ]));
