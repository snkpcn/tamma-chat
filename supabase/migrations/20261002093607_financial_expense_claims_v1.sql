alter table public.financial_daily_ledger_entries
  drop constraint if exists financial_daily_ledger_entries_entry_type_check;

alter table public.financial_daily_ledger_entries
  add constraint financial_daily_ledger_entries_entry_type_check
  check (entry_type = any (array[
    'sales_summary'::text,
    'payment'::text,
    'purchase'::text,
    'expense'::text,
    'reimbursement'::text,
    'cash_advance'::text,
    'vendor_payment'::text,
    'waste'::text,
    'other'::text
  ]));

alter table public.financial_daily_ledger_entries
  add column if not exists accounting_role text not null default 'economic_event'
    check (accounting_role in ('economic_event','cash_settlement','memo'));

alter table public.financial_daily_ledger_entries
  add column if not exists linked_entry_id uuid
    references public.financial_daily_ledger_entries(id) on delete set null;

create table if not exists public.financial_expense_claims (
  id uuid primary key default gen_random_uuid(),
  origin_daily_close_id uuid not null references public.financial_daily_closes(id) on delete restrict,
  claim_type text not null
    check (claim_type in (
      'direct_purchase',
      'employee_reimbursement',
      'employee_advance',
      'owner_purchase',
      'other'
    )),
  approval_status text not null default 'draft'
    check (approval_status in ('draft','needs_review','approved','rejected','cancelled')),
  expense_category text not null default 'other'
    check (expense_category in (
      'ingredients',
      'beverages',
      'packaging',
      'consumables',
      'cleaning',
      'maintenance',
      'utilities',
      'transport',
      'staff',
      'equipment',
      'marketing',
      'fees',
      'petty_cash',
      'other'
    )),
  counterparty_type text not null default 'other'
    check (counterparty_type in ('employee','vendor','owner','platform','other')),
  counterparty_label text,
  claimed_amount numeric(14,2) not null check (claimed_amount >= 0),
  approved_amount numeric(14,2) check (approved_amount is null or approved_amount >= 0),
  description text,
  expense_date date,
  source_channel text not null default 'line'
    check (source_channel in ('line','backoffice','import','system')),
  source_message_id text,
  created_by_hash text,
  approved_by_hash text,
  approved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.financial_daily_ledger_entries
  add column if not exists expense_claim_id uuid
    references public.financial_expense_claims(id) on delete set null;

alter table public.financial_daily_close_evidence
  add column if not exists expense_claim_id uuid
    references public.financial_expense_claims(id) on delete set null;

alter table public.financial_daily_close_evidence
  add column if not exists duplicate_of_evidence_id uuid
    references public.financial_daily_close_evidence(id) on delete set null;

create unique index if not exists financial_expense_claim_source_unique
  on public.financial_expense_claims(source_channel, source_message_id)
  where source_message_id is not null;

create index if not exists financial_expense_claim_close_idx
  on public.financial_expense_claims(origin_daily_close_id, approval_status, created_at);

create index if not exists financial_ledger_claim_idx
  on public.financial_daily_ledger_entries(expense_claim_id, accounting_role, occurred_at);

create index if not exists financial_evidence_claim_idx
  on public.financial_daily_close_evidence(expense_claim_id, evidence_type, created_at);

drop trigger if exists financial_expense_claim_touch_updated_at on public.financial_expense_claims;
create trigger financial_expense_claim_touch_updated_at
before update on public.financial_expense_claims
for each row execute function public.financial_touch_updated_at();

create or replace function public.financial_guard_expense_claim()
returns trigger
language plpgsql
as $$
declare
  close_status text;
begin
  if tg_op = 'DELETE' then
    select status into close_status
    from public.financial_daily_closes
    where id = old.origin_daily_close_id;

    if close_status = 'confirmed' then
      raise exception 'expense claim belongs to a confirmed close and is immutable';
    end if;
    return old;
  end if;

  select status into close_status
  from public.financial_daily_closes
  where id = new.origin_daily_close_id;

  if tg_op = 'INSERT' then
    if close_status = 'confirmed' then
      raise exception 'cannot add expense claim directly to a confirmed close; use adjustment workflow';
    end if;
    return new;
  end if;

  if close_status = 'confirmed' then
    raise exception 'expense claim belongs to a confirmed close and is immutable';
  end if;

  if new.approval_status = 'approved' then
    if new.approved_amount is null then
      new.approved_amount = new.claimed_amount;
    end if;
    if new.approved_at is null then
      new.approved_at = now();
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists financial_expense_claim_guard on public.financial_expense_claims;
create trigger financial_expense_claim_guard
before insert or update or delete on public.financial_expense_claims
for each row execute function public.financial_guard_expense_claim();

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
  coalesce(sum(
    case
      when le.accounting_role='cash_settlement' and le.direction='outflow'
      then le.amount else 0
    end
  ),0)::numeric(14,2) as cash_settled_amount,
  greatest(
    coalesce(cl.approved_amount, cl.claimed_amount)
    - coalesce(sum(
        case
          when le.accounting_role='cash_settlement' and le.direction='outflow'
          then le.amount else 0
        end
      ),0),
    0
  )::numeric(14,2) as outstanding_amount,
  case
    when cl.approval_status in ('rejected','cancelled') then cl.approval_status
    when coalesce(sum(
      case
        when le.accounting_role='cash_settlement' and le.direction='outflow'
        then le.amount else 0
      end
    ),0) <= 0 then 'unpaid'
    when coalesce(sum(
      case
        when le.accounting_role='cash_settlement' and le.direction='outflow'
        then le.amount else 0
      end
    ),0) < coalesce(cl.approved_amount,cl.claimed_amount) then 'partially_paid'
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
  count(distinct ev.id)::integer as evidence_count
from public.financial_expense_claims cl
join public.financial_daily_closes c on c.id=cl.origin_daily_close_id
join public.operations_business_branches b on b.id=c.branch_id
left join public.financial_daily_ledger_entries le on le.expense_claim_id=cl.id
left join public.financial_daily_close_evidence ev on ev.expense_claim_id=cl.id
group by
  cl.id,c.local_date,c.environment,b.code,b.name;

create or replace view public.financial_daily_expense_rollup as
select
  c.id as daily_close_id,
  c.local_date,
  c.environment,
  b.code as branch_code,
  coalesce(sum(
    case
      when le.accounting_role='economic_event'
        and le.entry_type in ('purchase','expense','reimbursement','vendor_payment')
      then le.amount else 0
    end
  ),0)::numeric(14,2) as economic_expense_amount,
  coalesce(sum(
    case
      when le.direction='outflow'
      then le.amount else 0
    end
  ),0)::numeric(14,2) as cash_outflow_amount,
  coalesce(sum(
    case
      when le.accounting_role='cash_settlement'
        and le.entry_type in ('reimbursement','cash_advance','vendor_payment')
      then le.amount else 0
    end
  ),0)::numeric(14,2) as settlement_outflow_amount
from public.financial_daily_closes c
join public.operations_business_branches b on b.id=c.branch_id
left join public.financial_daily_ledger_entries le on le.daily_close_id=c.id
group by c.id,c.local_date,c.environment,b.code;

alter table public.financial_expense_claims enable row level security;
