-- Atomic inbound Messenger webhook dedupe.
-- Prevents concurrent Meta retries for the same message mid from both
-- reaching the core and sending duplicate customer replies.

create table if not exists public.facebook_webhook_event_claims (
  conversation_id text not null check (char_length(conversation_id) between 1 and 180),
  event_id text not null check (char_length(event_id) between 1 and 180),
  claimed_at timestamptz not null default now(),
  primary key (conversation_id, event_id)
);

create index if not exists facebook_webhook_event_claims_claimed_at_idx
  on public.facebook_webhook_event_claims (claimed_at desc);

alter table public.facebook_webhook_event_claims enable row level security;
revoke all on table public.facebook_webhook_event_claims from public, anon, authenticated, service_role;
grant select, insert on table public.facebook_webhook_event_claims to service_role;
