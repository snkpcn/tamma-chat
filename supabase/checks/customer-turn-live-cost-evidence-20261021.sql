-- Read-only evidence for the synthetic live probes. Missing rows do not mean free.
select conversation_id,event_id,channel,environment,model,call_purpose,
  status,input_tokens,output_tokens,cost_thb,latency_ms,occurred_at
from public.ai_api_cost_events
where conversation_id in ('c64ae030-57a1-441d-bbb2-b1f2854d214a','c300f2e3-7f2a-46fc-abd3-6763cc995355')
order by occurred_at;
