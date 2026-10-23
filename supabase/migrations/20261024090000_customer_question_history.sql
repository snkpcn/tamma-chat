-- Owner-requested, redacted customer questions for Backoffice review.
-- Separate from cost accounting. No model prompts, assistant replies or attachments.
begin;

create table if not exists public.customer_question_history (
  channel text not null check (char_length(channel) between 1 and 40),
  event_id text not null check (char_length(event_id) between 1 and 180),
  environment text not null default 'live' check (environment in ('live', 'test')),
  conversation_id text check (conversation_id is null or char_length(conversation_id) between 1 and 180),
  question_text text not null check (char_length(question_text) between 1 and 4000),
  text_truncated boolean not null default false,
  occurred_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  primary key (channel, event_id, environment)
);

create index if not exists customer_question_history_time_idx
  on public.customer_question_history (environment, occurred_at desc);
create index if not exists customer_question_history_conversation_idx
  on public.customer_question_history (conversation_id, occurred_at desc);
create index if not exists customer_question_history_expiry_idx
  on public.customer_question_history (expires_at);

alter table public.customer_question_history enable row level security;
revoke all on public.customer_question_history from public, anon, authenticated, service_role;
grant select, insert, delete on public.customer_question_history to service_role;

-- Best-effort cleanup on writes, plus hourly Netlify cleanup even on quiet days.
-- The owner API also excludes expired rows, independently of cleanup timing.
create or replace function public.prune_customer_question_history()
returns trigger language plpgsql set search_path = '' as $$
begin
  delete from public.customer_question_history where expires_at <= now();
  return null;
end;
$$;
revoke all on function public.prune_customer_question_history() from public, anon, authenticated;
drop trigger if exists prune_customer_question_history on public.customer_question_history;
create trigger prune_customer_question_history after insert on public.customer_question_history
  for each statement execute function public.prune_customer_question_history();

comment on table public.customer_question_history is
  'Redacted customer question history, owner-only via backend. Visible for 30 days; expired rows removed on insert and hourly. No pre-release backfill.';
commit;
