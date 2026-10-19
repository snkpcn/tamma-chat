-- Server-only per-message provenance, spend and failures. Costs remain NULL
-- when a non-zero-cost response has no cost events: missing logs are not free.
create table if not exists public.customer_turn_outcomes (
  channel text not null,
  event_id text not null,
  conversation_id text,
  environment text not null default 'live',
  outcome text not null check (outcome in ('completed','failed')),
  error_type text,
  duration_ms integer not null check (duration_ms >= 0),
  occurred_at timestamptz not null default now(),
  primary key (channel,event_id,environment)
);
create index if not exists customer_turn_outcomes_time_idx on public.customer_turn_outcomes(occurred_at desc);
alter table public.customer_turn_outcomes enable row level security;
revoke all on public.customer_turn_outcomes from public,anon,authenticated;
grant select,insert,update on public.customer_turn_outcomes to service_role;

create or replace function public.prune_customer_turn_outcomes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.customer_turn_outcomes where occurred_at < now()-interval '24 hours';
  return null;
end;
$$;
drop trigger if exists prune_customer_turn_outcomes on public.customer_turn_outcomes;
create trigger prune_customer_turn_outcomes after insert on public.customer_turn_outcomes
for each statement execute function public.prune_customer_turn_outcomes();

create or replace view public.thongthai_customer_turn_monitor
with (security_invoker = true) as
with costs as (
  select conversation_id, event_id, channel, environment,
    count(*) as ai_calls,
    sum(cost_thb) as cost_thb,
    sum(input_tokens) as input_tokens,
    sum(output_tokens) as output_tokens,
    count(*) filter (where status = 'failed') as failed_ai_calls,
    array_agg(distinct model) as models
  from public.ai_api_cost_events
  group by conversation_id, event_id, channel, environment
)
select coalesce(r.conversation_id,o.conversation_id) as conversation_id,
  coalesce(r.event_id,o.event_id) as event_id,coalesce(r.channel,o.channel) as channel,
  coalesce(r.environment,o.environment) as environment,coalesce(r.occurred_at,o.occurred_at) as occurred_at,
  coalesce(r.final_response_source,case when o.outcome='failed' then 'backend_failure' else 'legacy_or_unclassified' end) as final_response_source,
  r.model_reply_used, r.grounded_knowledge_supplied,
  case when c.ai_calls is not null then c.cost_thb
       when r.zero_cost_turn then 0::numeric else null end as cost_thb,
  (c.ai_calls is not null or coalesce(r.zero_cost_turn,false)) as cost_accounting_available,
  coalesce(c.ai_calls, 0) as recorded_ai_calls,
  coalesce(c.failed_ai_calls, 0) as failed_ai_calls,
  c.models, c.input_tokens, c.output_tokens,
  t.domain, t.intent, t.degradation_condition, t.state_conflict_retries,
  t.total_ms,
  t.envelope #> '{knowledge,sources}' as knowledge_sources,
  t.envelope #> '{knowledge,usedFactKeys}' as used_fact_keys,
  t.envelope #> '{degradation,reasonCodes}' as failure_reasons,
  t.envelope #> '{state,persisted}' as state_persisted,
  (t.trace_id is not null) as detailed_trace_available,
  o.outcome,o.error_type,o.duration_ms
from public.ai_response_turns r
full outer join public.customer_turn_outcomes o
  on o.event_id=r.event_id and o.channel=r.channel and o.environment=r.environment
left join costs c on c.conversation_id=coalesce(r.conversation_id,o.conversation_id)
  and c.event_id=coalesce(r.event_id,o.event_id) and c.channel=coalesce(r.channel,o.channel)
  and c.environment=coalesce(r.environment,o.environment)
left join public.one_mind_traces t
  on t.trace_id = coalesce(r.event_id,o.event_id) and t.channel = coalesce(r.channel,o.channel)
  and coalesce(r.environment,o.environment) = 'live' and t.expires_at > now();

revoke all on public.thongthai_customer_turn_monitor from public, anon, authenticated;
grant select on public.thongthai_customer_turn_monitor to service_role;
grant select on public.one_mind_traces to service_role;

comment on view public.thongthai_customer_turn_monitor is
'Server-only Thongthai message diagnostics. NULL cost means accounting is unverified; detailed traces expire after 24 hours.';
