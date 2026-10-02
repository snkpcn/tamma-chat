create or replace view public.financial_expense_claim_summary as
select
  cl.id,
  cl.claim_type,
  cl.approval_status,
  cl.expense_category,
  cl.counterparty_type,
  cl.counterparty_label,
  cl.claimed_amount,
  cl.approved_amount,
  coalesce(cl.approved_amount, cl.claimed_amount) as expected_settlement_amount,
  coalesce(ls.cash_settled_amount,0)::numeric(14,2) as cash_settled_amount,
  greatest(
    coalesce(cl.approved_amount, cl.claimed_amount)
    - coalesce(ls.cash_settled_amount,0),
    0
  )::numeric(14,2) as outstanding_amount,
  case
    when cl.approval_status in ('rejected','cancelled') then cl.approval_status
    when coalesce(ls.cash_settled_amount,0) <= 0 then 'unpaid'
    when coalesce(ls.cash_settled_amount,0) < coalesce(cl.approved_amount,cl.claimed_amount) then 'partially_paid'
    else 'paid'
  end as payment_status,
  c.local_date as origin_local_date,
  c.environment,
  b.code as branch_code,
  b.name as branch_name,
  cl.description,
  cl.expense_date,
  cl.source_channel,
  cl.source_message_id,
  cl.created_at,
  cl.updated_at,
  coalesce(ev.evidence_count,0)::integer as evidence_count
from public.financial_expense_claims cl
join public.financial_daily_closes c on c.id=cl.origin_daily_close_id
join public.operations_business_branches b on b.id=c.branch_id
left join lateral (
  select coalesce(sum(le.amount),0)::numeric(14,2) as cash_settled_amount
  from public.financial_daily_ledger_entries le
  where le.expense_claim_id=cl.id
    and le.accounting_role='cash_settlement'
    and le.direction='outflow'
) ls on true
left join lateral (
  select count(*)::integer as evidence_count
  from public.financial_daily_close_evidence e
  where e.expense_claim_id=cl.id
) ev on true;
