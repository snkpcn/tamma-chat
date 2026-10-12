create table if not exists public.operations_business_branches (
  id uuid primary key default gen_random_uuid(),
  business_unit_code text not null references public.operations_business_units(code) on update cascade on delete restrict,
  code text not null unique,
  name text not null,
  timezone text not null default 'Asia/Bangkok',
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.operations_business_branches (
  business_unit_code, code, name, timezone, active, metadata
)
values (
  'inthanin',
  'inthanin_tadtone',
  'Inthanin Café ตาดโตน',
  'Asia/Bangkok',
  true,
  '{"financial_os_phase":"phase1"}'::jsonb
)
on conflict (code) do update
set business_unit_code=excluded.business_unit_code,
    name=excluded.name,
    timezone=excluded.timezone,
    active=excluded.active,
    metadata=public.operations_business_branches.metadata || excluded.metadata,
    updated_at=now();

create table if not exists public.financial_daily_closes (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.operations_business_branches(id) on delete restrict,
  local_date date not null,
  environment text not null default 'test' check (environment in ('live','test')),
  status text not null default 'draft'
    check (status in ('draft','pending_confirmation','confirmed','void')),

  gross_sales numeric(14,2) not null default 0 check (gross_sales >= 0),
  discounts numeric(14,2) not null default 0 check (discounts >= 0),
  refunds numeric(14,2) not null default 0 check (refunds >= 0),

  payment_cash numeric(14,2) not null default 0 check (payment_cash >= 0),
  payment_qr numeric(14,2) not null default 0 check (payment_qr >= 0),
  payment_card numeric(14,2) not null default 0 check (payment_card >= 0),
  payment_delivery numeric(14,2) not null default 0 check (payment_delivery >= 0),
  payment_other numeric(14,2) not null default 0 check (payment_other >= 0),

  purchase_cash_outflow numeric(14,2) not null default 0 check (purchase_cash_outflow >= 0),
  expense_cash_outflow numeric(14,2) not null default 0 check (expense_cash_outflow >= 0),
  waste_reported_value numeric(14,2) not null default 0 check (waste_reported_value >= 0),
  staff_count integer check (staff_count is null or staff_count >= 0),

  net_sales numeric(14,2) generated always as
    (gross_sales - discounts - refunds) stored,
  payments_total numeric(14,2) generated always as
    (payment_cash + payment_qr + payment_card + payment_delivery + payment_other) stored,
  sales_payment_variance numeric(14,2) generated always as
    ((payment_cash + payment_qr + payment_card + payment_delivery + payment_other)
      - (gross_sales - discounts - refunds)) stored,

  notes text,
  source text not null default 'line'
    check (source in ('line','backoffice','import','system')),
  submitted_by_hash text,
  confirmed_by_hash text,
  opened_at timestamptz not null default now(),
  submitted_at timestamptz,
  confirmed_at timestamptz,
  revision integer not null default 1 check (revision >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (branch_id, local_date, environment)
);

comment on column public.financial_daily_closes.purchase_cash_outflow is
  'Cash paid for purchases during the day. This is cash flow / procurement, NOT automatic same-day COGS.';
comment on column public.financial_daily_closes.waste_reported_value is
  'Reported waste value for operations review. It is not automatically treated as accounting expense until cost basis is verified.';

create table if not exists public.financial_daily_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  daily_close_id uuid not null references public.financial_daily_closes(id) on delete cascade,
  entry_type text not null
    check (entry_type in ('sales_summary','payment','purchase','expense','waste','other')),
  category text,
  amount numeric(14,2) not null default 0 check (amount >= 0),
  direction text not null default 'noncash'
    check (direction in ('inflow','outflow','noncash')),
  payment_method text
    check (payment_method is null or payment_method in ('cash','qr','card','delivery','other')),
  description text,
  source_channel text not null default 'line'
    check (source_channel in ('line','backoffice','import','system')),
  source_message_id text,
  source_item_key text not null default 'main',
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists financial_daily_ledger_source_unique
  on public.financial_daily_ledger_entries(source_channel, source_message_id, source_item_key)
  where source_message_id is not null;

create table if not exists public.financial_daily_close_evidence (
  id uuid primary key default gen_random_uuid(),
  daily_close_id uuid not null references public.financial_daily_closes(id) on delete cascade,
  ledger_entry_id uuid references public.financial_daily_ledger_entries(id) on delete set null,
  evidence_type text not null
    check (evidence_type in (
      'pos_close','purchase_receipt','transfer_slip','expense_receipt',
      'waste_photo','stock_photo','other'
    )),
  source_channel text not null default 'line'
    check (source_channel in ('line','backoffice','import','system')),
  source_message_id text,
  image_sha256 text,
  storage_bucket text,
  storage_path text,
  mime_type text,
  extraction_status text not null default 'pending'
    check (extraction_status in ('pending','extracted','needs_review','rejected')),
  extracted_data jsonb not null default '{}'::jsonb,
  extraction_confidence numeric(5,4)
    check (extraction_confidence is null or (extraction_confidence >= 0 and extraction_confidence <= 1)),
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists financial_daily_evidence_source_unique
  on public.financial_daily_close_evidence(source_channel, source_message_id)
  where source_message_id is not null;

create table if not exists public.financial_daily_close_adjustments (
  id uuid primary key default gen_random_uuid(),
  daily_close_id uuid not null references public.financial_daily_closes(id) on delete restrict,
  adjustment_type text not null
    check (adjustment_type in ('correction','late_entry','reclassification','reversal')),
  field_name text,
  amount_delta numeric(14,2),
  old_value jsonb,
  new_value jsonb,
  reason text not null,
  created_by_hash text,
  source_channel text not null default 'backoffice'
    check (source_channel in ('line','backoffice','import','system')),
  source_message_id text,
  created_at timestamptz not null default now()
);

create index if not exists financial_daily_closes_branch_date_idx
  on public.financial_daily_closes(branch_id, environment, local_date desc);
create index if not exists financial_daily_closes_status_idx
  on public.financial_daily_closes(environment, status, local_date desc);
create index if not exists financial_daily_entries_close_idx
  on public.financial_daily_ledger_entries(daily_close_id, entry_type, occurred_at);
create index if not exists financial_daily_evidence_close_idx
  on public.financial_daily_close_evidence(daily_close_id, evidence_type, created_at);
create index if not exists financial_daily_adjustments_close_idx
  on public.financial_daily_close_adjustments(daily_close_id, created_at);

create or replace function public.financial_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists operations_business_branches_touch_updated_at on public.operations_business_branches;
create trigger operations_business_branches_touch_updated_at
before update on public.operations_business_branches
for each row execute function public.financial_touch_updated_at();

drop trigger if exists financial_daily_closes_touch_updated_at on public.financial_daily_closes;
create trigger financial_daily_closes_touch_updated_at
before update on public.financial_daily_closes
for each row execute function public.financial_touch_updated_at();

drop trigger if exists financial_daily_entries_touch_updated_at on public.financial_daily_ledger_entries;
create trigger financial_daily_entries_touch_updated_at
before update on public.financial_daily_ledger_entries
for each row execute function public.financial_touch_updated_at();

create or replace function public.financial_guard_daily_close()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'confirmed' then
      raise exception 'confirmed daily close is immutable; use an adjustment';
    end if;
    return old;
  end if;

  if old.status = 'confirmed' then
    raise exception 'confirmed daily close is immutable; use an adjustment';
  end if;

  if new.status = 'confirmed' and new.confirmed_at is null then
    new.confirmed_at = now();
  end if;

  return new;
end;
$$;

drop trigger if exists financial_daily_close_guard on public.financial_daily_closes;
create trigger financial_daily_close_guard
before update or delete on public.financial_daily_closes
for each row execute function public.financial_guard_daily_close();

create or replace function public.financial_guard_close_child_mutation()
returns trigger
language plpgsql
as $$
declare
  close_status text;
  close_id uuid;
begin
  close_id := case when tg_op = 'DELETE' then old.daily_close_id else new.daily_close_id end;

  select status into close_status
  from public.financial_daily_closes
  where id = close_id;

  if close_status = 'confirmed' then
    raise exception 'confirmed daily close children are immutable; use an adjustment';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists financial_daily_entries_guard on public.financial_daily_ledger_entries;
create trigger financial_daily_entries_guard
before insert or update or delete on public.financial_daily_ledger_entries
for each row execute function public.financial_guard_close_child_mutation();

drop trigger if exists financial_daily_evidence_guard on public.financial_daily_close_evidence;
create trigger financial_daily_evidence_guard
before insert or update or delete on public.financial_daily_close_evidence
for each row execute function public.financial_guard_close_child_mutation();

create or replace function public.financial_guard_adjustment()
returns trigger
language plpgsql
as $$
declare
  close_status text;
begin
  if tg_op in ('UPDATE','DELETE') then
    raise exception 'financial adjustments are append-only';
  end if;

  select status into close_status
  from public.financial_daily_closes
  where id = new.daily_close_id;

  if close_status is distinct from 'confirmed' then
    raise exception 'adjustments are allowed only after a daily close is confirmed';
  end if;

  return new;
end;
$$;

drop trigger if exists financial_daily_adjustment_guard on public.financial_daily_close_adjustments;
create trigger financial_daily_adjustment_guard
before insert or update or delete on public.financial_daily_close_adjustments
for each row execute function public.financial_guard_adjustment();

create or replace view public.financial_daily_close_summary as
select
  c.id,
  c.local_date,
  c.environment,
  c.status,
  b.code as branch_code,
  b.name as branch_name,
  b.business_unit_code,
  u.name as business_unit_name,
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
  (select count(*)::integer from public.financial_daily_ledger_entries e where e.daily_close_id=c.id) as ledger_entry_count,
  (select count(*)::integer from public.financial_daily_close_evidence ev where ev.daily_close_id=c.id) as evidence_count,
  (select count(*)::integer from public.financial_daily_close_adjustments a where a.daily_close_id=c.id) as adjustment_count
from public.financial_daily_closes c
join public.operations_business_branches b on b.id=c.branch_id
join public.operations_business_units u on u.code=b.business_unit_code;

alter table public.operations_business_branches enable row level security;
alter table public.financial_daily_closes enable row level security;
alter table public.financial_daily_ledger_entries enable row level security;
alter table public.financial_daily_close_evidence enable row level security;
alter table public.financial_daily_close_adjustments enable row level security;
