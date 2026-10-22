-- Target: tamma-chat Supabase project upaokrprawzhgzeqsdke ONLY.
-- Run as a database administrator in that project's SQL Editor.
-- Applies only missing release steps, preserving existing business rows.
-- One transaction: a failed prerequisite/check rolls back all changes.
-- Existing incompatible schemas require investigation; they are not overwritten.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
do $prerequisites$
declare missing text;
begin
  select string_agg(name, ', ') into missing from (values
    ('ai_api_cost_events'), ('ai_response_turns'), ('one_mind_traces')
  ) as prerequisites(name) where to_regclass('public.' || name) is null;
  if missing is not null then raise exception 'Missing base tables: %. Stop and apply the existing cost/observability prerequisites first.', missing; end if;
end;
$prerequisites$;

-- Source: supabase/migrations/20261009090000_customer_turn_monitor_v1.sql
do $release_step$
begin
  if to_regclass('public.thongthai_customer_turn_monitor') is null then
    execute $migration_sql$
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

$migration_sql$;
  end if;
end;
$release_step$;

-- Source: supabase/migrations/20261018120000_web_search_cost_provider.sql
do $release_step$
begin
  if not exists (select 1 from pg_constraint where conrelid=to_regclass('public.ai_api_cost_events') and contype='c' and pg_get_constraintdef(oid) like '%tavily%') then
    execute $migration_sql$
-- Use the existing cost ledger for search credits as well as model tokens.
-- Apply before enabling THONGTHAI_VISITOR_WEB_SEARCH in production.
alter table public.ai_api_cost_events
  drop constraint if exists ai_api_cost_events_provider_check;
alter table public.ai_api_cost_events
  add constraint ai_api_cost_events_provider_check check (provider in ('openai','tavily'));

$migration_sql$;
  end if;
end;
$release_step$;

-- Source: supabase/migrations/20261020120000_customer_turn_claim_v1.sql
do $release_step$
begin
  if not (exists (select 1 from information_schema.columns where table_schema='public' and table_name='customer_turn_outcomes' and column_name='claimed_at')) or not (exists (select 1 from pg_constraint where conrelid=to_regclass('public.customer_turn_outcomes') and contype='c' and pg_get_constraintdef(oid) like '%in_progress%')) then
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='thongthai_customer_turn_monitor' and column_name='context_persisted') then raise exception 'Claim schema is inconsistent with the context monitor. Stop; do not rerun the older view migration.'; end if;
    execute $migration_sql$
-- Turn-level idempotency for the shared LINE/web customer path.
--
-- DO NOT RE-RUN this file after
-- 20261020130000_customer_turn_monitor_context_persisted.sql has been
-- applied. That migration appends context_persisted to
-- thongthai_customer_turn_monitor; the view below does not have it, so
-- re-running this create or replace view fails with "cannot drop columns
-- from view".
--
-- LINE redelivers a webhook when the previous delivery timed out or returned
-- a non-2xx. Before this, a redelivery re-ran the whole turn: tools, state
-- writes and a second reply. The AI cost ledger deduplicated only the paid
-- model call (it replays a completed semantic result), not the turn.
--
-- customer_turn_outcomes already has exactly the right primary key
-- (channel, event_id, environment), so it becomes the claim record too
-- rather than a second parallel dedupe system. A turn now INSERTS an
-- 'in_progress' claim before doing any work and the existing end-of-turn
-- write merges 'completed'/'failed' onto the same row.
--
-- Backward compatibility: 'in_progress' is ADDED to the allowed outcomes, so
-- every existing 'completed'/'failed' row still satisfies the new check.
-- claimed_at is nullable, so existing rows need no backfill. duration_ms is
-- deliberately left not-null: a claim writes 0 and the final write replaces
-- it, which the original constraint already allows.

alter table public.customer_turn_outcomes
  drop constraint if exists customer_turn_outcomes_outcome_check;
alter table public.customer_turn_outcomes
  add constraint customer_turn_outcomes_outcome_check
  check (outcome in ('in_progress','completed','failed'));

alter table public.customer_turn_outcomes
  add column if not exists claimed_at timestamptz;

-- Supports the stale-claim takeover probe (in_progress older than the
-- longest possible in-flight turn).
create index if not exists customer_turn_outcomes_claim_idx
  on public.customer_turn_outcomes (outcome, claimed_at)
  where outcome = 'in_progress';

-- The monitor view's fallback label assumed every row was terminal, so an
-- abandoned in-flight claim would have been reported as
-- 'legacy_or_unclassified' -- an unrelated, misleading bucket. Everything
-- else in this view is unchanged from
-- 20261009090000_customer_turn_monitor_v1.sql.
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
  coalesce(r.final_response_source,
    case
      when o.outcome='failed' then 'backend_failure'
      when o.outcome='in_progress' then 'in_flight_or_abandoned'
      else 'legacy_or_unclassified'
    end) as final_response_source,
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

comment on view public.thongthai_customer_turn_monitor is
'Server-only Thongthai message diagnostics. NULL cost means accounting is unverified; detailed traces expire after 24 hours. outcome=in_progress is a claimed turn that never reported a terminal result.';

$migration_sql$;
  end if;
end;
$release_step$;

-- Source: supabase/migrations/20261020130000_customer_turn_monitor_context_persisted.sql
do $release_step$
begin
  if not (exists (select 1 from information_schema.columns where table_schema='public' and table_name='thongthai_customer_turn_monitor' and column_name='context_persisted')) or not coalesce((select 'security_invoker=true'=any(reloptions) from pg_class where oid=to_regclass('public.thongthai_customer_turn_monitor')),false) then
    execute $migration_sql$
-- Expose whether a turn's conversation transcript was persisted.
--
-- one_mind_traces.envelope now carries state.contextPersisted next to
-- state.persisted. They differ on a legacy_required turn: task state is
-- deliberately not written (persisted=false) but the transcript is
-- (contextPersisted=true), which is what keeps LINE -- which transports no
-- chat history -- from forgetting the conversation. Without this column the
-- monitor showed such a turn as "nothing persisted".
--
-- JSON null when the trace predates the field or comes from a path that
-- does not distinguish the two. The view is otherwise identical to
-- 20261020120000_customer_turn_claim_v1.sql; the new column is appended
-- last so create or replace view keeps every existing column in place.
--
-- ORDER: requires 20261020120000_customer_turn_claim_v1.sql first. Applied
-- before it, this would succeed on the older view and then make the claim
-- migration fail ("cannot drop columns from view"), so it refuses to run.
-- customer_turn_outcomes.claimed_at is the marker that the claim migration
-- has been applied.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'customer_turn_outcomes'
      and column_name = 'claimed_at'
  ) then
    raise exception 'Apply supabase/migrations/20261020120000_customer_turn_claim_v1.sql before 20261020130000_customer_turn_monitor_context_persisted.sql (customer_turn_outcomes.claimed_at is missing)';
  end if;
end
$$;

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
  coalesce(r.final_response_source,
    case
      when o.outcome='failed' then 'backend_failure'
      when o.outcome='in_progress' then 'in_flight_or_abandoned'
      else 'legacy_or_unclassified'
    end) as final_response_source,
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
  o.outcome,o.error_type,o.duration_ms,
  t.envelope #> '{state,contextPersisted}' as context_persisted
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

comment on view public.thongthai_customer_turn_monitor is
'Server-only Thongthai message diagnostics. NULL cost means accounting is unverified; detailed traces expire after 24 hours. outcome=in_progress is a claimed turn that never reported a terminal result. context_persisted=true with state_persisted=false is a legacy_required turn that kept its transcript.';

$migration_sql$;
  end if;
end;
$release_step$;

-- Source: supabase/migrations/20261021120000_line_customer_deliveries.sql
do $release_step$
begin
  if to_regclass('public.line_customer_deliveries') is null then
    execute $migration_sql$
-- A completed AI/business turn may still have an undelivered LINE reply.
-- Store the rendered payload before sending, so redelivery never reruns it.
create table public.line_customer_deliveries (
  event_id text primary key,
  target_hash text not null,
  payload_enc text not null,
  status text not null default 'pending' check (status in ('pending','sending','delivered')),
  mode text not null default 'reply' check (mode in ('reply','reply_uncertain','push')),
  lease_id uuid,
  leased_at timestamptz,
  expires_at timestamptz not null default (now() + interval '24 hours')
);
create index line_customer_deliveries_expiry_idx on public.line_customer_deliveries(expires_at);
alter table public.line_customer_deliveries enable row level security;
revoke all on public.line_customer_deliveries from public, anon, authenticated;
grant select, insert, update on public.line_customer_deliveries to service_role;

create function public.prune_line_customer_deliveries()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.line_customer_deliveries where expires_at < now();
  return null;
end;
$$;
revoke all on function public.prune_line_customer_deliveries() from public, anon, authenticated;
create trigger prune_line_customer_deliveries after insert on public.line_customer_deliveries
for each statement execute function public.prune_line_customer_deliveries();

$migration_sql$;
  end if;
end;
$release_step$;

do $verify_release$
declare failures text;
begin
  select string_agg(name, ', ') into failures from (
-- Read-only. Run against the Supabase project actually used by production.
-- PASS establishes schema prerequisites, not that this branch is deployed.
with checks(name, ready) as (
  select 'turn_claim_claimed_at', exists (
    select 1 from information_schema.columns where table_schema='public'
      and table_name='customer_turn_outcomes' and column_name='claimed_at'
  )
  union all select 'turn_claim_in_progress_constraint', exists (
    select 1 from pg_constraint where conrelid=to_regclass('public.customer_turn_outcomes')
      and contype='c' and pg_get_constraintdef(oid) like '%in_progress%'
  )
  union all select 'monitor_context_persisted', exists (
    select 1 from information_schema.columns where table_schema='public'
      and table_name='thongthai_customer_turn_monitor' and column_name='context_persisted'
  )
  union all select 'monitor_security_invoker', coalesce((
    select 'security_invoker=true'=any(reloptions) from pg_class
      where oid=to_regclass('public.thongthai_customer_turn_monitor')
  ), false)
  union all select 'web_search_provider_constraint', exists (
    select 1 from pg_constraint where conrelid=to_regclass('public.ai_api_cost_events')
      and contype='c' and pg_get_constraintdef(oid) like '%tavily%'
  )
  union all select 'delivery_outbox_columns', (select count(*)=8 from information_schema.columns
    where table_schema='public' and table_name='line_customer_deliveries'
      and column_name in ('event_id','target_hash','payload_enc','status','mode','lease_id','leased_at','expires_at'))
  union all select 'delivery_outbox_rls', coalesce((select relrowsecurity from pg_class
    where oid=to_regclass('public.line_customer_deliveries')),false)
  union all select 'delivery_outbox_expiry_trigger', exists (select 1 from pg_trigger
    where tgrelid=to_regclass('public.line_customer_deliveries')
      and tgname='prune_line_customer_deliveries' and tgenabled <> 'D')
  union all select 'private_tables_and_view_access', not exists (
    select 1 from (values ('customer_turn_outcomes'),('line_customer_deliveries'),('thongthai_customer_turn_monitor')) t(name)
    cross join (values ('anon'),('authenticated')) r(name)
    where to_regclass('public.'||t.name) is null
      or coalesce(has_table_privilege(r.name,to_regclass('public.'||t.name),'SELECT,INSERT,UPDATE,DELETE'),true)
  )
  union all select 'service_role_delivery_access', coalesce(has_table_privilege('service_role',
    to_regclass('public.line_customer_deliveries'),'SELECT'),false)
    and coalesce(has_table_privilege('service_role',to_regclass('public.line_customer_deliveries'),'INSERT'),false)
    and coalesce(has_table_privilege('service_role',to_regclass('public.line_customer_deliveries'),'UPDATE'),false)
)
select name, ready from checks order by name
  ) checks where not ready;
  if failures is not null then raise exception 'Release preflight failed: %. All release changes will roll back.', failures; end if;
end;
$verify_release$;
notify pgrst, 'reload schema';
commit;

-- Success: all ten rows must show ready = true.
-- Read-only. Run against the Supabase project actually used by production.
-- PASS establishes schema prerequisites, not that this branch is deployed.
with checks(name, ready) as (
  select 'turn_claim_claimed_at', exists (
    select 1 from information_schema.columns where table_schema='public'
      and table_name='customer_turn_outcomes' and column_name='claimed_at'
  )
  union all select 'turn_claim_in_progress_constraint', exists (
    select 1 from pg_constraint where conrelid=to_regclass('public.customer_turn_outcomes')
      and contype='c' and pg_get_constraintdef(oid) like '%in_progress%'
  )
  union all select 'monitor_context_persisted', exists (
    select 1 from information_schema.columns where table_schema='public'
      and table_name='thongthai_customer_turn_monitor' and column_name='context_persisted'
  )
  union all select 'monitor_security_invoker', coalesce((
    select 'security_invoker=true'=any(reloptions) from pg_class
      where oid=to_regclass('public.thongthai_customer_turn_monitor')
  ), false)
  union all select 'web_search_provider_constraint', exists (
    select 1 from pg_constraint where conrelid=to_regclass('public.ai_api_cost_events')
      and contype='c' and pg_get_constraintdef(oid) like '%tavily%'
  )
  union all select 'delivery_outbox_columns', (select count(*)=8 from information_schema.columns
    where table_schema='public' and table_name='line_customer_deliveries'
      and column_name in ('event_id','target_hash','payload_enc','status','mode','lease_id','leased_at','expires_at'))
  union all select 'delivery_outbox_rls', coalesce((select relrowsecurity from pg_class
    where oid=to_regclass('public.line_customer_deliveries')),false)
  union all select 'delivery_outbox_expiry_trigger', exists (select 1 from pg_trigger
    where tgrelid=to_regclass('public.line_customer_deliveries')
      and tgname='prune_line_customer_deliveries' and tgenabled <> 'D')
  union all select 'private_tables_and_view_access', not exists (
    select 1 from (values ('customer_turn_outcomes'),('line_customer_deliveries'),('thongthai_customer_turn_monitor')) t(name)
    cross join (values ('anon'),('authenticated')) r(name)
    where to_regclass('public.'||t.name) is null
      or coalesce(has_table_privilege(r.name,to_regclass('public.'||t.name),'SELECT,INSERT,UPDATE,DELETE'),true)
  )
  union all select 'service_role_delivery_access', coalesce(has_table_privilege('service_role',
    to_regclass('public.line_customer_deliveries'),'SELECT'),false)
    and coalesce(has_table_privilege('service_role',to_regclass('public.line_customer_deliveries'),'INSERT'),false)
    and coalesce(has_table_privilege('service_role',to_regclass('public.line_customer_deliveries'),'UPDATE'),false)
)
select name, ready from checks order by name;
