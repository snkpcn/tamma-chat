-- Owner approved in chat on 2026-09-29.
-- Canonical OpenAI/API cost history + final-response metadata + dedicated LINE cost team.
-- No raw prompt, raw transcript, model output, contact data, or API key is stored.

create table if not exists public.ai_api_cost_events (
  id uuid primary key default gen_random_uuid(),
  conversation_id text not null check (char_length(conversation_id) between 1 and 180),
  event_id text not null check (char_length(event_id) between 1 and 180),
  channel text not null default 'unknown' check (char_length(channel) between 1 and 40),
  provider text not null default 'openai' check (provider = 'openai'),
  model text not null check (char_length(model) between 1 and 120),
  call_purpose text not null check (char_length(call_purpose) between 1 and 120),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  cached_input_tokens integer not null default 0 check (cached_input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cost_usd numeric(16,9) not null default 0 check (cost_usd >= 0),
  cost_thb numeric(16,6) not null default 0 check (cost_thb >= 0),
  call_index_turn integer not null check (call_index_turn >= 1),
  call_index_conversation integer not null check (call_index_conversation >= 1),
  status text not null default 'completed' check (status in ('completed','failed')),
  latency_ms integer not null default 0 check (latency_ms >= 0),
  environment text not null default 'live' check (environment in ('live','test','certification')),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  schema_version text not null default 'ai-api-cost-events-v1',
  constraint ai_api_cost_events_event_call_unique unique (conversation_id,event_id,call_index_turn)
);

create index if not exists ai_api_cost_events_occurred_idx
  on public.ai_api_cost_events (occurred_at desc);
create index if not exists ai_api_cost_events_conversation_idx
  on public.ai_api_cost_events (conversation_id, occurred_at desc);
create index if not exists ai_api_cost_events_dimension_idx
  on public.ai_api_cost_events (channel, model, call_purpose, occurred_at desc);

alter table public.ai_api_cost_events enable row level security;
revoke all on table public.ai_api_cost_events from public, anon, authenticated, service_role;
grant select, insert, update on table public.ai_api_cost_events to service_role;

create table if not exists public.ai_response_turns (
  id uuid primary key default gen_random_uuid(),
  conversation_id text not null check (char_length(conversation_id) between 1 and 180),
  event_id text not null check (char_length(event_id) between 1 and 180),
  channel text not null default 'unknown' check (char_length(channel) between 1 and 40),
  final_response_source text not null check (char_length(final_response_source) between 1 and 80),
  model_reply_used boolean not null default false,
  grounded_knowledge_supplied boolean not null default false,
  zero_cost_turn boolean not null default false,
  environment text not null default 'live' check (environment in ('live','test','certification')),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  schema_version text not null default 'ai-response-turns-v1',
  constraint ai_response_turns_conversation_event_unique unique (conversation_id,event_id)
);

create index if not exists ai_response_turns_occurred_idx
  on public.ai_response_turns (occurred_at desc);
create index if not exists ai_response_turns_conversation_idx
  on public.ai_response_turns (conversation_id, occurred_at desc);

alter table public.ai_response_turns enable row level security;
revoke all on table public.ai_response_turns from public, anon, authenticated, service_role;
grant select, insert, update on table public.ai_response_turns to service_role;

alter table public.ops_notification_channels
  drop constraint if exists ops_notification_channels_team_code_check;
alter table public.ops_notification_channels
  add constraint ops_notification_channels_team_code_check
  check (team_code = any (array[
    'restaurant'::text,'stay'::text,'activity'::text,'cafe'::text,'otop'::text,
    'all'::text,'owner_general'::text,'ai_cost'::text
  ]));

alter table public.ops_notification_deliveries
  drop constraint if exists ops_notification_deliveries_entity_type_check;
alter table public.ops_notification_deliveries
  add constraint ops_notification_deliveries_entity_type_check
  check (
    entity_type is null
    or entity_type = any (array[
      'booking'::text,'cafe_inquiry'::text,'otop_order'::text,'restaurant_preorder'::text,
      'daily_schedule'::text,'payment_request'::text,'team_settlement'::text,
      'feedback_event'::text,'ai_cost'::text
    ])
  );

alter table public.ops_notification_deliveries
  drop constraint if exists ops_notification_deliveries_delivery_type_check;
alter table public.ops_notification_deliveries
  add constraint ops_notification_deliveries_delivery_type_check
  check (
    delivery_type = any (array[
      'booking_created'::text,'cafe_inquiry_created'::text,'otop_order_created'::text,
      'restaurant_preorder_created'::text,'daily_schedule'::text,'daily_summary'::text,
      'manual_test'::text,'ai_cost_conversation'::text,'ai_cost_daily'::text
    ])
    or delivery_type like 'payment_%'
    or delivery_type like 'settlement_%'
    or delivery_type like 'feedback_%'
  );
