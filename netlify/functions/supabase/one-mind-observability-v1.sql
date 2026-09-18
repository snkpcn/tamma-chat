-- One-Mind bounded observability traces (Phase K)
-- Existing tamma-customer-data Supabase project ONLY.
--
-- This table deliberately stores NO raw customer text, no response prose,
-- no model output and no contact/payment fields. The envelope is the safe
-- machine-only OneMindTraceEnvelope emitted by _one-mind-observability.ts.
--
-- Retention is 24 hours. Reads must always filter expires_at > now().
-- The trigger opportunistically removes expired rows whenever a new trace is
-- inserted so the table remains bounded without requiring a separate cron job.

create table if not exists public.one_mind_traces (
  id bigint generated always as identity primary key,
  trace_id text not null,
  conversation_key text,
  channel text not null,
  domain text not null,
  intent text not null,
  action text not null,
  dialog_mode text not null,
  degradation_condition text not null,
  composer_mode text,
  state_conflict_retries integer not null default 0
    check (state_conflict_retries >= 0 and state_conflict_retries <= 100),
  total_ms integer not null default 0
    check (total_ms >= 0 and total_ms <= 600000),
  envelope jsonb not null,
  observed_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint one_mind_traces_channel_trace_unique unique (channel, trace_id),
  constraint one_mind_traces_expiry_after_observation check (expires_at > observed_at)
);

create index if not exists one_mind_traces_observed_at_idx
  on public.one_mind_traces (observed_at desc);

create index if not exists one_mind_traces_expires_at_idx
  on public.one_mind_traces (expires_at);

create index if not exists one_mind_traces_conversation_key_idx
  on public.one_mind_traces (conversation_key, observed_at desc)
  where conversation_key is not null;

create index if not exists one_mind_traces_health_idx
  on public.one_mind_traces (degradation_condition, observed_at desc);

alter table public.one_mind_traces enable row level security;

-- No anon/authenticated policies by design.
-- Customer/frontend code must never read this table directly.
-- Service-role server functions are the only intended access path.

create or replace function public.prune_expired_one_mind_traces()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.one_mind_traces
   where expires_at <= now();
  return null;
end;
$$;

drop trigger if exists trg_prune_expired_one_mind_traces on public.one_mind_traces;
create trigger trg_prune_expired_one_mind_traces
after insert on public.one_mind_traces
for each statement
execute function public.prune_expired_one_mind_traces();

comment on table public.one_mind_traces is
'24-hour bounded, pseudonymous machine diagnostics for Thongthai One-Mind; never raw chat transcripts.';

comment on column public.one_mind_traces.envelope is
'Safe OneMindTraceEnvelope only: no raw customer text, response prose, model output, contact or payment data.';
