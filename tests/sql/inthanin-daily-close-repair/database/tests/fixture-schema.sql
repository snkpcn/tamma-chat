-- Synthetic, disposable test schema. NEVER apply to production.
-- The functions under test are loaded separately from actual saved definitions.
-- These table/view definitions are deliberately minimal, not a production-schema clone.
create table public.operations_business_branches (
  id uuid primary key,
  code text not null,
  active boolean not null default true
);
create table public.financial_daily_closes (
  id uuid primary key,
  branch_id uuid not null references public.operations_business_branches(id),
  local_date date not null default '2026-10-10',
  environment text not null default 'live',
  status text not null default 'draft',
  revision integer not null default 1,
  net_sales numeric(14,2) not null default 100,
  payments_total numeric(14,2) not null default 100,
  sales_payment_variance numeric(14,2) not null default 0,
  cash_opening_float numeric(14,2) default 20,
  payment_cash numeric(14,2) not null default 100,
  cash_drawer_outflow_amount numeric(14,2) not null default 0,
  cash_counted_closing numeric(14,2) default 120,
  cup_count integer default 10,
  bill_count integer default 5,
  refunds numeric(14,2) not null default 0,
  adjustment_count integer not null default 0,
  submitted_at timestamptz,
  confirmed_at timestamptz,
  confirmed_by_hash text,
  source text default 'line',
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create table public.financial_expense_claims (
  id uuid primary key,
  origin_daily_close_id uuid references public.financial_daily_closes(id),
  approval_status text not null default 'draft',
  claimed_amount numeric(14,2) not null default 10,
  approved_amount numeric(14,2),
  approved_at timestamptz,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create table public.financial_daily_ledger_entries (
  id uuid primary key,
  daily_close_id uuid not null references public.financial_daily_closes(id),
  expense_claim_id uuid references public.financial_expense_claims(id),
  accounting_role text default 'expense',
  direction text default 'outflow',
  amount numeric(14,2) default 10,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create table public.financial_daily_close_evidence (
  id uuid primary key,
  daily_close_id uuid not null references public.financial_daily_closes(id),
  expense_claim_id uuid references public.financial_expense_claims(id),
  evidence_type text default 'pos_close',
  extraction_status text default 'extracted',
  extraction_confidence numeric(5,4) default 0.99,
  match_status text default 'matched',
  extracted_data jsonb default '{"pos_net_sales":"100"}'::jsonb,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create table public.financial_daily_close_adjustments (
  id uuid primary key,
  daily_close_id uuid not null references public.financial_daily_closes(id),
  amount numeric(14,2) default 0
);
-- Synthetic effective view: totals come directly from fixture parent columns.
-- It does not certify actual production view dependencies or writer-path coverage.
create view public.financial_daily_close_effective_v1 as
select d.*, b.code as branch_code
from public.financial_daily_closes d
join public.operations_business_branches b on b.id=d.branch_id;
-- Synthetic claim summary: enough fields to execute actual reconciliation.
create view public.financial_expense_claim_summary as
select c.*, b.code as branch_code, d.environment,
       d.local_date as origin_local_date,
       coalesce(c.approved_amount,c.claimed_amount) as outstanding_amount
from public.financial_expense_claims c
join public.financial_daily_closes d on d.id=c.origin_daily_close_id
join public.operations_business_branches b on b.id=d.branch_id;
