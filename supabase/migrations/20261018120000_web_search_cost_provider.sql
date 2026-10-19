-- Use the existing cost ledger for search credits as well as model tokens.
-- Apply before enabling THONGTHAI_VISITOR_WEB_SEARCH in production.
alter table public.ai_api_cost_events
  drop constraint if exists ai_api_cost_events_provider_check;
alter table public.ai_api_cost_events
  add constraint ai_api_cost_events_provider_check check (provider in ('openai','tavily'));
