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
