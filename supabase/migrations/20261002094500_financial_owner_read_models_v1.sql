create or replace view public.financial_daily_close_owner_v1
with (security_invoker=true) as
select
  c.id,
  c.local_date,
  c.environment,
  c.status,
  b.code as branch_code,
  b.name as branch_name,
  b.business_unit_code,
  c.gross_sales,
  c.discounts,
  c.refunds,
  c.net_sales,
  c.payment_cash,
  c.payment_qr,
  c.payment_card,
  c.payment_delivery,
  c.payment_other,
  c.payments_total,
  c.sales_payment_variance,
  c.purchase_cash_outflow,
  c.expense_cash_outflow,
  c.waste_reported_value,
  c.staff_count,
  c.source,
  c.submitted_at,
  c.confirmed_at,
  c.created_at,
  c.updated_at,
  coalesce(er.economic_expense_amount,0)::numeric(14,2) as economic_expense_amount,
  coalesce(er.cash_outflow_amount,0)::numeric(14,2) as ledger_cash_outflow_amount,
  coalesce(er.settlement_outflow_amount,0)::numeric(14,2) as settlement_outflow_amount,
  coalesce(ev.evidence_count,0)::integer as evidence_count,
  coalesce(ev.evidence_needs_review_count,0)::integer as evidence_needs_review_count,
  coalesce(cl.claim_count,0)::integer as claim_count,
  coalesce(cl.claim_needs_review_count,0)::integer as claim_needs_review_count,
  coalesce(cl.claim_outstanding_amount,0)::numeric(14,2) as claim_outstanding_amount,
  coalesce(ad.adjustment_count,0)::integer as adjustment_count
from public.financial_daily_closes c
join public.operations_business_branches b on b.id=c.branch_id
left join public.financial_daily_expense_rollup er on er.daily_close_id=c.id
left join lateral (
  select
    count(*)::integer as evidence_count,
    count(*) filter (
      where e.extraction_status in ('pending','needs_review')
    )::integer as evidence_needs_review_count
  from public.financial_daily_close_evidence e
  where e.daily_close_id=c.id
) ev on true
left join lateral (
  select
    count(*)::integer as claim_count,
    count(*) filter (
      where s.approval_status in ('draft','needs_review')
         or s.payment_status in ('unpaid','partially_paid')
    )::integer as claim_needs_review_count,
    coalesce(sum(s.outstanding_amount),0)::numeric(14,2) as claim_outstanding_amount
  from public.financial_expense_claim_summary s
  where s.origin_local_date=c.local_date
    and s.environment=c.environment
    and s.branch_code=b.code
) cl on true
left join lateral (
  select count(*)::integer as adjustment_count
  from public.financial_daily_close_adjustments a
  where a.daily_close_id=c.id
) ad on true;

create or replace view public.financial_monthly_owner_v1
with (security_invoker=true) as
select
  branch_code,
  branch_name,
  business_unit_code,
  environment,
  date_trunc('month', local_date)::date as month_start,
  count(*)::integer as recorded_days,
  count(*) filter (where status='confirmed')::integer as confirmed_days,
  count(*) filter (where status in ('draft','pending_confirmation'))::integer as open_days,
  sum(gross_sales)::numeric(16,2) as gross_sales,
  sum(discounts)::numeric(16,2) as discounts,
  sum(refunds)::numeric(16,2) as refunds,
  sum(net_sales)::numeric(16,2) as net_sales,
  sum(payments_total)::numeric(16,2) as payments_total,
  sum(abs(sales_payment_variance))::numeric(16,2) as absolute_variance_total,
  sum(economic_expense_amount)::numeric(16,2) as economic_expense_amount,
  sum(ledger_cash_outflow_amount)::numeric(16,2) as ledger_cash_outflow_amount,
  sum(settlement_outflow_amount)::numeric(16,2) as settlement_outflow_amount,
  sum(purchase_cash_outflow)::numeric(16,2) as reported_purchase_cash_outflow,
  sum(expense_cash_outflow)::numeric(16,2) as reported_expense_cash_outflow,
  sum(waste_reported_value)::numeric(16,2) as waste_reported_value,
  sum(evidence_count)::integer as evidence_count,
  sum(evidence_needs_review_count)::integer as evidence_needs_review_count,
  sum(claim_count)::integer as claim_count,
  sum(claim_needs_review_count)::integer as claim_needs_review_count,
  sum(claim_outstanding_amount)::numeric(16,2) as claim_outstanding_amount,
  sum(adjustment_count)::integer as adjustment_count
from public.financial_daily_close_owner_v1
group by branch_code, branch_name, business_unit_code, environment, date_trunc('month', local_date)::date;
