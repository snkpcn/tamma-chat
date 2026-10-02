create table if not exists public.financial_cash_custody_movements (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.operations_business_branches(id),
  daily_close_id uuid null references public.financial_daily_closes(id),
  local_date date not null,
  environment text not null check (environment in ('test','live')),
  movement_type text not null check (movement_type in ('drawer_to_bag','owner_pickup','bag_adjustment')),
  direction text not null check (direction in ('bag_in','bag_out')),
  amount numeric(14,2) not null check (amount > 0),
  source_channel text not null check (source_channel in ('line','backoffice','import','system')),
  source_message_id text null,
  note text null,
  created_by_hash text null,
  created_at timestamptz not null default now()
);

create index if not exists financial_cash_custody_branch_env_date_idx
on public.financial_cash_custody_movements(branch_id,environment,local_date,created_at);

create unique index if not exists financial_cash_custody_source_unique_idx
on public.financial_cash_custody_movements(branch_id,environment,source_channel,source_message_id,movement_type)
where source_message_id is not null;

alter table public.financial_cash_custody_movements enable row level security;

revoke all on public.financial_cash_custody_movements from public;
revoke all on public.financial_cash_custody_movements from anon;
revoke all on public.financial_cash_custody_movements from authenticated;
grant select,insert,update,delete on public.financial_cash_custody_movements to service_role;

create or replace view public.financial_cash_bag_owner_v1
with (security_invoker=true) as
select
  b.code as branch_code,
  b.name as branch_name,
  m.environment,
  coalesce(sum(case when m.direction='bag_in' then m.amount else -m.amount end),0)::numeric(16,2) as bag_balance,
  coalesce(sum(case when m.direction='bag_in' then m.amount else 0 end),0)::numeric(16,2) as total_swept_to_bag,
  coalesce(sum(case when m.direction='bag_out' then m.amount else 0 end),0)::numeric(16,2) as total_owner_pickup,
  max(m.created_at) as last_movement_at
from public.operations_business_branches b
join public.financial_cash_custody_movements m on m.branch_id=b.id
group by b.code,b.name,m.environment;

grant select on public.financial_cash_bag_owner_v1 to service_role;

create or replace function public.financial_record_cash_sweep_v1(
  p_daily_close_id uuid,
  p_amount numeric,
  p_actor_hash text,
  p_source text default 'backoffice'
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_branch_id uuid;
  v_date date;
  v_env text;
  v_status text;
  v_movement_id uuid;
  v_ledger_id uuid;
  v_balance numeric(16,2);
begin
  if p_amount is null or p_amount<=0 then raise exception 'cash_sweep_amount_required'; end if;
  if p_source not in ('line','backoffice','import','system') then raise exception 'invalid_cash_custody_source'; end if;

  select branch_id,local_date,environment,status
  into v_branch_id,v_date,v_env,v_status
  from public.financial_daily_closes
  where id=p_daily_close_id
  for update;

  if v_branch_id is null then raise exception 'daily_close_not_found'; end if;
  if v_env<>'test' then raise exception 'cash_custody_test_only'; end if;
  if v_status='confirmed' then raise exception 'confirmed_daily_close_is_immutable'; end if;

  select id into v_movement_id
  from public.financial_cash_custody_movements
  where branch_id=v_branch_id and environment=v_env
    and source_channel=p_source
    and source_message_id='cash-sweep:'||p_daily_close_id::text
    and movement_type='drawer_to_bag'
  limit 1;

  if v_movement_id is null then
    insert into public.financial_cash_custody_movements(
      branch_id,daily_close_id,local_date,environment,movement_type,direction,
      amount,source_channel,source_message_id,note,created_by_hash
    )
    values(
      v_branch_id,p_daily_close_id,v_date,v_env,'drawer_to_bag','bag_in',
      p_amount,p_source,'cash-sweep:'||p_daily_close_id::text,
      'Daily drawer excess moved to weekly owner-pickup bag',
      nullif(trim(coalesce(p_actor_hash,'')),'')
    )
    returning id into v_movement_id;

    insert into public.financial_daily_ledger_entries(
      daily_close_id,entry_type,accounting_role,amount,direction,payment_method,
      description,source_channel,source_message_id,source_item_key,metadata
    )
    values(
      p_daily_close_id,'other','memo',p_amount,'outflow','cash',
      'Cash sweep from drawer to weekly owner-pickup bag',
      p_source,'cash-sweep:'||p_daily_close_id::text,'drawer_to_bag',
      jsonb_build_object(
        'movement_type','drawer_to_bag',
        'custody_account','weekly_cash_bag',
        'is_expense',false,
        'custody_movement_id',v_movement_id
      )
    )
    returning id into v_ledger_id;
  end if;

  select coalesce(sum(case when direction='bag_in' then amount else -amount end),0)
  into v_balance
  from public.financial_cash_custody_movements
  where branch_id=v_branch_id and environment=v_env;

  return jsonb_build_object(
    'ok',true,'movement_id',v_movement_id,'ledger_entry_id',v_ledger_id,
    'amount',p_amount,'bag_balance',v_balance,
    'reconciliation',public.financial_reconcile_daily_close_v1(p_daily_close_id)
  );
end;
$$;

create or replace function public.financial_record_cash_bag_pickup_v1(
  p_branch_code text,
  p_amount numeric,
  p_actor_hash text,
  p_source text default 'backoffice',
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_branch_id uuid;
  v_balance numeric(16,2);
  v_movement_id uuid;
  v_date date:=timezone('Asia/Bangkok',now())::date;
begin
  if p_amount is null or p_amount<=0 then raise exception 'cash_pickup_amount_required'; end if;
  if p_source not in ('line','backoffice','import','system') then raise exception 'invalid_cash_custody_source'; end if;

  select id into v_branch_id
  from public.operations_business_branches
  where code=p_branch_code and active=true
  limit 1;
  if v_branch_id is null then raise exception 'branch_not_found'; end if;

  select coalesce(sum(case when direction='bag_in' then amount else -amount end),0)
  into v_balance
  from public.financial_cash_custody_movements
  where branch_id=v_branch_id and environment='test';

  if p_amount>v_balance then raise exception 'cash_pickup_exceeds_bag_balance'; end if;

  insert into public.financial_cash_custody_movements(
    branch_id,daily_close_id,local_date,environment,movement_type,direction,
    amount,source_channel,source_message_id,note,created_by_hash
  )
  values(
    v_branch_id,null,v_date,'test','owner_pickup','bag_out',
    p_amount,p_source,null,nullif(trim(coalesce(p_note,'')),''),
    nullif(trim(coalesce(p_actor_hash,'')),'')
  )
  returning id into v_movement_id;

  return jsonb_build_object(
    'ok',true,'movement_id',v_movement_id,'amount',p_amount,
    'previous_bag_balance',v_balance,'bag_balance',v_balance-p_amount
  );
end;
$$;

revoke all on function public.financial_record_cash_sweep_v1(uuid,numeric,text,text) from public;
revoke all on function public.financial_record_cash_sweep_v1(uuid,numeric,text,text) from anon;
revoke all on function public.financial_record_cash_sweep_v1(uuid,numeric,text,text) from authenticated;
grant execute on function public.financial_record_cash_sweep_v1(uuid,numeric,text,text) to service_role;

revoke all on function public.financial_record_cash_bag_pickup_v1(text,numeric,text,text,text) from public;
revoke all on function public.financial_record_cash_bag_pickup_v1(text,numeric,text,text,text) from anon;
revoke all on function public.financial_record_cash_bag_pickup_v1(text,numeric,text,text,text) from authenticated;
grant execute on function public.financial_record_cash_bag_pickup_v1(text,numeric,text,text,text) to service_role;

insert into public.financial_cash_custody_movements(
  branch_id,daily_close_id,local_date,environment,movement_type,direction,
  amount,source_channel,source_message_id,note,created_by_hash
)
select
  c.branch_id,c.id,c.local_date,c.environment,'drawer_to_bag','bag_in',
  260,'system','cash-sweep:'||c.id::text,
  'Backfilled from owner-confirmed 2026-10-02 cash handling: cash sales 400 - cash purchases 140',
  'f6215f26b0741ab14635bfaae3c90184f03836129ec21c9c285bcb187edcc228'
from public.financial_daily_closes c
where c.id='8294e840-1b8c-4a7c-a549-8745f8c099ff'::uuid
and not exists (
  select 1 from public.financial_cash_custody_movements m
  where m.daily_close_id=c.id and m.movement_type='drawer_to_bag'
);
