-- Exact saved production trigger bindings; fixture tables are synthetic.
create trigger financial_daily_close_guard before delete or update on public.financial_daily_closes for each row execute function public.financial_guard_daily_close();
create trigger financial_daily_closes_touch_updated_at before update on public.financial_daily_closes for each row execute function public.financial_touch_updated_at();
create trigger financial_daily_entries_guard before insert or delete or update on public.financial_daily_ledger_entries for each row execute function public.financial_guard_close_child_mutation();
create trigger financial_daily_entries_touch_updated_at before update on public.financial_daily_ledger_entries for each row execute function public.financial_touch_updated_at();
create trigger financial_daily_evidence_guard before insert or delete or update on public.financial_daily_close_evidence for each row execute function public.financial_guard_close_child_mutation();
create trigger financial_expense_claim_guard before insert or delete or update on public.financial_expense_claims for each row execute function public.financial_guard_expense_claim();
create trigger financial_expense_claim_touch_updated_at before update on public.financial_expense_claims for each row execute function public.financial_touch_updated_at();
create trigger financial_daily_adjustment_guard before insert or delete or update on public.financial_daily_close_adjustments for each row execute function public.financial_guard_adjustment();
