-- Turn-level idempotency for the shared LINE/web customer path.
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
