-- Disposable synthetic fixture only. Never apply this file to a live database.
-- Exercise the stricter invoker/role contract, rather than historical view defaults.
alter view public.financial_daily_close_effective_v1 set (security_invoker=true);
alter view public.financial_expense_claim_summary set (security_invoker=true);
alter view public.financial_daily_expense_rollup set (security_invoker=true);
revoke all on public.financial_expense_claim_summary,public.financial_daily_expense_rollup from public,anon,authenticated;
grant all on public.financial_expense_claim_summary,public.financial_daily_expense_rollup to service_role;

-- Match explicit trigger-helper settings and their existing effective ACLs.
alter function public.financial_touch_updated_at() set search_path to pg_catalog,public;
alter function public.financial_guard_adjustment() set search_path to pg_catalog,public;
grant execute on function public.financial_guard_daily_close(),public.financial_guard_close_child_mutation(),public.financial_guard_expense_claim(),public.financial_touch_updated_at(),public.financial_guard_adjustment() to public,anon,authenticated,service_role;
