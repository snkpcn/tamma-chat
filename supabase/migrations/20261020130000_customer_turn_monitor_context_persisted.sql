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
