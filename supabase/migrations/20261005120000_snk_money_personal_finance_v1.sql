-- SNK MONEY x THONGTHAI: private personal-finance ledger (scope PERSONAL_FINANCE_PRIVATE).
--
-- Boundaries
--  * Internal ledger only.  There is NO bank connection: every balance is either
--    stated by the owner (CONFIRMED), derived from an owner-confirmed balance plus
--    later recorded movements (DERIVED), or UNKNOWN.  UNKNOWN is never 0.
--  * Fully isolated from the business ledgers (financial_*).  No foreign keys,
--    views or functions here read or write business tables.
--  * Server-mediated only: RLS on, every privilege revoked from anon/authenticated,
--    all writes go through security-definer pf_* RPCs granted to service_role.
--  * All arithmetic lives here, in one canonical engine.  The LLM never computes a
--    balance; it only proposes structured intents that the backend validates.

-- ---------------------------------------------------------------- settings

create table if not exists public.pf_settings(
  key text primary key check(length(key) between 1 and 80),
  value jsonb not null,
  updated_at timestamptz not null default now()
);
insert into public.pf_settings(key,value)
values('reminder_days','[7,3,1,0]'::jsonb),('timezone','"Asia/Bangkok"'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------- accounts

create table if not exists public.pf_accounts(
  id uuid primary key default gen_random_uuid(),
  name text not null check(length(trim(name)) between 1 and 80),
  name_key text generated always as (lower(trim(name))) stored,
  kind text not null default 'BANK' check(kind in ('BANK','CASH','WALLET','SAVINGS','CREDIT','POOL','OTHER')),
  balance numeric(14,2) null check(balance is null or abs(balance)<=1000000000),
  balance_status text not null default 'UNKNOWN' check(balance_status in ('CONFIRMED','DERIVED','UNKNOWN')),
  balance_confirmed_at timestamptz null,
  balance_confirmed_amount numeric(14,2) null,
  balance_confirmed_seq bigint null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- UNKNOWN is a real state, not zero: it must carry no number, and a number must carry a status.
  constraint pf_accounts_unknown_iff_null_balance check((balance_status='UNKNOWN')=(balance is null))
);
create unique index if not exists pf_accounts_active_name_uq on public.pf_accounts(name_key) where is_active;

-- ---------------------------------------------------------------- categories

create table if not exists public.pf_categories(
  id uuid primary key default gen_random_uuid(),
  name text not null check(length(trim(name)) between 1 and 80),
  name_key text generated always as (lower(trim(name))) stored,
  kind text not null default 'EXPENSE' check(kind in ('EXPENSE','INCOME','BOTH')),
  is_system boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists pf_categories_name_uq on public.pf_categories(name_key);

insert into public.pf_categories(name,kind,is_system) values
  ('ค่าอาหาร','EXPENSE',true),('ค่าเดินทาง','EXPENSE',true),('ค่าน้ำมัน','EXPENSE',true),
  ('ค่าน้ำ ค่าไฟ','EXPENSE',true),('ค่าโทรศัพท์/อินเทอร์เน็ต','EXPENSE',true),
  ('ประกัน','EXPENSE',true),('ผ่อนชำระ','EXPENSE',true),('สุขภาพ','EXPENSE',true),
  ('ของใช้ในบ้าน','EXPENSE',true),('บันเทิง','EXPENSE',true),('การศึกษา','EXPENSE',true),
  ('ภาษี','EXPENSE',true),('ครอบครัว','EXPENSE',true),('อื่น ๆ','BOTH',true),
  ('ค่าเช่า','INCOME',true),('เงินเดือน','INCOME',true),('ปันผล/ดอกเบี้ย','INCOME',true),
  ('รายได้อื่น ๆ','INCOME',true)
on conflict (name_key) do nothing;

-- ---------------------------------------------------------------- obligations (recurring / one-time / installments)

create table if not exists public.pf_obligations(
  id uuid primary key default gen_random_uuid(),
  title text not null check(length(trim(title)) between 1 and 160),
  title_key text generated always as (lower(trim(title))) stored,
  kind text not null default 'EXPENSE' check(kind in ('EXPENSE','INCOME')),
  amount numeric(14,2) null check(amount is null or (amount>0 and amount<=1000000000)),
  frequency text not null check(frequency in ('ONE_TIME','WEEKLY','MONTHLY','YEARLY','CUSTOM_DAYS','INSTALLMENT')),
  interval_days integer null check(interval_days is null or interval_days between 1 and 3660),
  day_of_month integer null check(day_of_month is null or day_of_month between 1 and 31),
  next_due_date date not null,
  end_date date null,
  installments_total integer null check(installments_total is null or installments_total between 1 and 600),
  installments_paid integer not null default 0 check(installments_paid>=0),
  default_account_id uuid null references public.pf_accounts(id) on delete restrict,
  category_id uuid null references public.pf_categories(id) on delete restrict,
  reminder_days integer[] not null default array[7,3,1,0],
  status text not null default 'ACTIVE' check(status in ('ACTIVE','PAUSED','COMPLETED','CANCELLED')),
  note text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pf_obligations_custom_needs_interval check(frequency<>'CUSTOM_DAYS' or interval_days is not null),
  constraint pf_obligations_installment_needs_total check(frequency<>'INSTALLMENT' or installments_total is not null)
);
create index if not exists pf_obligations_due_idx on public.pf_obligations(next_due_date) where status='ACTIVE';

-- ---------------------------------------------------------------- transactions

create table if not exists public.pf_transactions(
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  kind text not null check(kind in ('EXPENSE','INCOME','TRANSFER','ADJUSTMENT')),
  status text not null default 'CONFIRMED' check(status in ('CONFIRMED','PENDING_CLARIFICATION','VOIDED','REVERSED')),
  amount numeric(14,2) not null check(amount>=0 and amount<=1000000000),
  occurred_on date not null default timezone('Asia/Bangkok',now())::date,
  account_id uuid null references public.pf_accounts(id) on delete restrict,
  to_account_id uuid null references public.pf_accounts(id) on delete restrict,
  category_id uuid null references public.pf_categories(id) on delete restrict,
  payee text null,
  payee_key text generated always as (lower(trim(payee))) stored,
  note text null,
  -- Signed effect actually applied to each account's balance (null = account balance was
  -- unknown, so nothing was applied).  Reversal replays exactly these numbers.
  from_effect numeric(14,2) null,
  to_effect numeric(14,2) null,
  balance_after numeric(14,2) null,
  obligation_id uuid null references public.pf_obligations(id) on delete restrict,
  obligation_due_date date null,
  corrects_id uuid null references public.pf_transactions(id) on delete restrict,
  replaced_by_id uuid null references public.pf_transactions(id) on delete restrict,
  void_reason text null,
  voided_at timestamptz null,
  slip_ref text null,
  file_hash text null,
  source_channel text not null default 'line' check(source_channel in ('line','dashboard','system')),
  source_message_id text null,
  idem_key text null,
  created_by_hash text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pf_tx_transfer_accounts check(kind<>'TRANSFER' or (account_id is not null and to_account_id is not null and account_id<>to_account_id)),
  constraint pf_tx_nontransfer_single_account check(kind='TRANSFER' or to_account_id is null),
  constraint pf_tx_adjustment_has_account check(kind<>'ADJUSTMENT' or account_id is not null),
  constraint pf_tx_positive_amount check(kind='ADJUSTMENT' or amount>0)
);
create unique index if not exists pf_transactions_idem_uq on public.pf_transactions(idem_key) where idem_key is not null;
create unique index if not exists pf_transactions_seq_uq on public.pf_transactions(seq);
create index if not exists pf_transactions_occurred_idx on public.pf_transactions(occurred_on desc, seq desc);
create index if not exists pf_transactions_account_idx on public.pf_transactions(account_id, seq desc);
create index if not exists pf_transactions_file_hash_idx on public.pf_transactions(file_hash) where file_hash is not null;
create index if not exists pf_transactions_slip_ref_idx on public.pf_transactions(slip_ref) where slip_ref is not null;
create index if not exists pf_transactions_dupe_idx on public.pf_transactions(amount, occurred_on, payee_key) where payee_key is not null;

-- A paid due date can only be settled once per obligation.
create table if not exists public.pf_obligation_payments(
  id uuid primary key default gen_random_uuid(),
  obligation_id uuid not null references public.pf_obligations(id) on delete restrict,
  due_date date not null,
  transaction_id uuid not null references public.pf_transactions(id) on delete restrict,
  paid_on date not null,
  created_at timestamptz not null default now(),
  unique(obligation_id,due_date)
);

-- ---------------------------------------------------------------- reminders

create table if not exists public.pf_reminder_deliveries(
  id uuid primary key default gen_random_uuid(),
  obligation_id uuid not null references public.pf_obligations(id) on delete restrict,
  due_date date not null,
  days_before integer not null,
  status text not null default 'CLAIMED' check(status in ('CLAIMED','SENT','FAILED')),
  attempts integer not null default 1,
  last_error text null,
  claimed_at timestamptz not null default now(),
  sent_at timestamptz null,
  unique(obligation_id,due_date,days_before)
);

-- ---------------------------------------------------------------- idempotency + conversation state + audit

create table if not exists public.pf_idempotency(
  key text primary key check(length(key) between 1 and 300),
  result jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.pf_pending_states(
  id uuid primary key default gen_random_uuid(),
  actor_hash text not null,
  kind text not null check(length(kind) between 1 and 60),
  payload jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null,
  resolved_at timestamptz null,
  created_at timestamptz not null default now()
);
create index if not exists pf_pending_open_idx on public.pf_pending_states(actor_hash, created_at desc) where resolved_at is null;

create table if not exists public.pf_audit_events(
  id uuid primary key default gen_random_uuid(),
  action text not null check(length(action) between 1 and 60),
  entity_type text not null check(length(entity_type) between 1 and 60),
  entity_id text null,
  actor_hash text null,
  message_id text null,
  before_data jsonb not null default '{}'::jsonb,
  after_data jsonb not null default '{}'::jsonb,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists pf_audit_entity_idx on public.pf_audit_events(entity_type, entity_id, created_at);
create index if not exists pf_audit_created_idx on public.pf_audit_events(created_at desc);

-- ---------------------------------------------------------------- channel binding

create table if not exists public.pf_channel_bindings(
  id uuid primary key default gen_random_uuid(),
  scope text not null default 'PERSONAL_FINANCE_PRIVATE' check(scope='PERSONAL_FINANCE_PRIVATE'),
  status text not null default 'PENDING' check(status in ('PENDING','ACTIVE','REVOKED','REJECTED')),
  group_id_hash text not null,
  group_id_enc text null,
  code_hash text null,
  code_expires_at timestamptz null,
  failed_attempts integer not null default 0,
  captured_by_event text null,
  verified_by_hash text null,
  created_at timestamptz not null default now(),
  activated_at timestamptz null,
  revoked_at timestamptz null,
  updated_at timestamptz not null default now()
);
-- Exactly one live group per group id, and exactly one ACTIVE finance group overall.
create unique index if not exists pf_bindings_live_group_uq on public.pf_channel_bindings(group_id_hash) where status in ('PENDING','ACTIVE');
create unique index if not exists pf_bindings_single_active_uq on public.pf_channel_bindings((true)) where status='ACTIVE';

-- ---------------------------------------------------------------- immutability guards

create or replace function public.pf_i_audit_guard() returns trigger language plpgsql as $$
begin
  raise exception 'pf ledger and audit rows are append-only';
end $$;

drop trigger if exists pf_audit_no_update on public.pf_audit_events;
create trigger pf_audit_no_update before update or delete on public.pf_audit_events
  for each row execute function public.pf_i_audit_guard();
drop trigger if exists pf_audit_no_truncate on public.pf_audit_events;
create trigger pf_audit_no_truncate before truncate on public.pf_audit_events
  for each statement execute function public.pf_i_audit_guard();

create or replace function public.pf_i_tx_guard() returns trigger language plpgsql as $$
begin
  if tg_op='DELETE' then
    raise exception 'pf_transactions rows are never hard-deleted; void or correct them';
  end if;
  if new.amount is distinct from old.amount
     or new.kind is distinct from old.kind
     or new.to_account_id is distinct from old.to_account_id
     or new.occurred_on is distinct from old.occurred_on
     or new.seq is distinct from old.seq
     or (old.account_id is not null and new.account_id is distinct from old.account_id) then
    raise exception 'pf_transactions money fields are immutable; use a correction';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists pf_tx_guard on public.pf_transactions;
create trigger pf_tx_guard before update or delete on public.pf_transactions
  for each row execute function public.pf_i_tx_guard();
drop trigger if exists pf_tx_no_truncate on public.pf_transactions;
create trigger pf_tx_no_truncate before truncate on public.pf_transactions
  for each statement execute function public.pf_i_audit_guard();

-- ---------------------------------------------------------------- internal helpers (not callable by clients)

create or replace function public.pf_i_audit(
  p_action text, p_entity_type text, p_entity_id text, p_actor text, p_message text,
  p_before jsonb, p_after jsonb, p_meta jsonb default '{}'::jsonb
) returns void language plpgsql as $$
begin
  insert into public.pf_audit_events(action,entity_type,entity_id,actor_hash,message_id,before_data,after_data,meta)
  values(p_action,p_entity_type,p_entity_id,nullif(p_actor,''),nullif(p_message,''),
         coalesce(p_before,'{}'::jsonb),coalesce(p_after,'{}'::jsonb),coalesce(p_meta,'{}'::jsonb));
end $$;

-- Serialises concurrent deliveries of the same logical operation (LINE webhook retries).
create or replace function public.pf_i_idem_get(p_key text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  if p_key is null or length(trim(p_key))=0 then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_key,7));
  select result into v from public.pf_idempotency where key=p_key;
  if v is null then return null; end if;
  return v || jsonb_build_object('duplicate',true);
end $$;

create or replace function public.pf_i_idem_put(p_key text, p_result jsonb) returns jsonb language plpgsql as $$
begin
  if p_key is not null and length(trim(p_key))>0 then
    insert into public.pf_idempotency(key,result) values(p_key,p_result) on conflict (key) do nothing;
  end if;
  return p_result;
end $$;

create or replace function public.pf_i_ensure_category(p_name text, p_kind text, p_actor text, p_message text)
returns uuid language plpgsql as $$
declare v_id uuid; v_name text := left(trim(coalesce(p_name,'')),80);
begin
  if length(v_name)=0 then return null; end if;
  select id into v_id from public.pf_categories where name_key=lower(v_name);
  if v_id is not null then return v_id; end if;
  insert into public.pf_categories(name,kind) values(v_name,case when p_kind in ('EXPENSE','INCOME') then p_kind else 'BOTH' end)
  on conflict (name_key) do nothing returning id into v_id;
  if v_id is null then select id into v_id from public.pf_categories where name_key=lower(v_name); return v_id; end if;
  perform public.pf_i_audit('CATEGORY_CREATED','category',v_id::text,p_actor,p_message,'{}'::jsonb,jsonb_build_object('name',v_name,'kind',p_kind));
  return v_id;
end $$;

-- Applies a signed delta to a known balance.  Unknown balances are left unknown (never invented).
-- Returns the applied delta, or null when nothing was applied.
create or replace function public.pf_i_apply(p_account uuid, p_delta numeric) returns numeric language plpgsql as $$
declare v_balance numeric;
begin
  update public.pf_accounts
     set balance=balance+p_delta, balance_status='DERIVED', updated_at=now()
   where id=p_account and balance is not null
   returning balance into v_balance;
  if v_balance is null then return null; end if;
  return p_delta;
end $$;

create or replace function public.pf_i_account_json(p_id uuid) returns jsonb language sql stable as $$
  select case when a.id is null then null else jsonb_build_object(
    'id',a.id,'name',a.name,'kind',a.kind,'balance',a.balance,'balance_status',a.balance_status,
    'balance_confirmed_at',a.balance_confirmed_at,'is_active',a.is_active) end
  from (select 1) s left join public.pf_accounts a on a.id=p_id;
$$;

create or replace function public.pf_i_tx_json(p_id uuid) returns jsonb language sql stable as $$
  select case when t.id is null then null else jsonb_build_object(
    'id',t.id,'kind',t.kind,'status',t.status,'amount',t.amount,'occurred_on',t.occurred_on,
    'account_id',t.account_id,'account_name',a.name,'to_account_id',t.to_account_id,'to_account_name',b.name,
    'category_id',t.category_id,'category',c.name,'payee',t.payee,'note',t.note,
    'from_effect',t.from_effect,'to_effect',t.to_effect,'balance_after',t.balance_after,
    'obligation_id',t.obligation_id,'corrects_id',t.corrects_id,'replaced_by_id',t.replaced_by_id,
    'void_reason',t.void_reason,'slip_ref',t.slip_ref,'created_at',t.created_at) end
  from (select 1) s
  left join public.pf_transactions t on t.id=p_id
  left join public.pf_accounts a on a.id=t.account_id
  left join public.pf_accounts b on b.id=t.to_account_id
  left join public.pf_categories c on c.id=t.category_id;
$$;

-- Reverses what a transaction applied.  A movement that happened BEFORE the account's latest
-- owner confirmation is already inside the confirmed figure, so it is not replayed.
create or replace function public.pf_i_reverse_effects(p_tx public.pf_transactions) returns jsonb language plpgsql as $$
declare v_acc public.pf_accounts%rowtype; v_out jsonb := '{}'::jsonb;
begin
  if p_tx.account_id is not null and p_tx.from_effect is not null then
    select * into v_acc from public.pf_accounts where id=p_tx.account_id for update;
    if v_acc.balance_confirmed_seq is null or p_tx.seq>v_acc.balance_confirmed_seq then
      perform public.pf_i_apply(p_tx.account_id,-p_tx.from_effect);
      v_out := v_out || jsonb_build_object('account_reversed',true);
    else
      v_out := v_out || jsonb_build_object('account_reversed',false,'reason','confirmed_after');
    end if;
  end if;
  if p_tx.to_account_id is not null and p_tx.to_effect is not null then
    select * into v_acc from public.pf_accounts where id=p_tx.to_account_id for update;
    if v_acc.balance_confirmed_seq is null or p_tx.seq>v_acc.balance_confirmed_seq then
      perform public.pf_i_apply(p_tx.to_account_id,-p_tx.to_effect);
      v_out := v_out || jsonb_build_object('to_account_reversed',true);
    else
      v_out := v_out || jsonb_build_object('to_account_reversed',false,'reason','confirmed_after');
    end if;
  end if;
  return v_out;
end $$;

-- The single posting routine every writer shares.
create or replace function public.pf_i_post_tx(
  p_kind text, p_amount numeric, p_account uuid, p_to_account uuid, p_category uuid,
  p_payee text, p_note text, p_occurred_on date, p_actor text, p_message text, p_idem text,
  p_slip_ref text, p_file_hash text, p_obligation uuid, p_due_date date, p_corrects uuid,
  p_force_confirmed boolean default false
) returns public.pf_transactions language plpgsql as $$
declare
  v_tx public.pf_transactions%rowtype;
  v_from numeric; v_to numeric; v_after numeric; v_status text;
  v_first uuid; v_second uuid; v_lock public.pf_accounts%rowtype;
begin
  if p_kind not in ('EXPENSE','INCOME','TRANSFER') then raise exception 'invalid_transaction_kind'; end if;
  if p_amount is null or p_amount<=0 or p_amount>1000000000 then raise exception 'invalid_amount'; end if;
  if p_kind='TRANSFER' and (p_account is null or p_to_account is null) then raise exception 'transfer_requires_two_accounts'; end if;
  if p_kind='TRANSFER' and p_account=p_to_account then raise exception 'transfer_same_account'; end if;
  if p_account is not null and not exists(select 1 from public.pf_accounts where id=p_account and is_active) then raise exception 'account_not_found'; end if;
  if p_to_account is not null and not exists(select 1 from public.pf_accounts where id=p_to_account and is_active) then raise exception 'account_not_found'; end if;

  -- lock in a stable order so two concurrent transfers cannot deadlock
  v_first := least(coalesce(p_account,p_to_account),coalesce(p_to_account,p_account));
  v_second := greatest(coalesce(p_account,p_to_account),coalesce(p_to_account,p_account));
  if v_first is not null then select * into v_lock from public.pf_accounts where id=v_first for update; end if;
  if v_second is not null and v_second<>v_first then select * into v_lock from public.pf_accounts where id=v_second for update; end if;

  v_status := case when p_kind in ('EXPENSE','INCOME') and p_account is null and not p_force_confirmed then 'PENDING_CLARIFICATION' else 'CONFIRMED' end;

  if v_status='CONFIRMED' and p_account is not null then
    if p_kind='EXPENSE' then v_from := public.pf_i_apply(p_account,-p_amount);
    elsif p_kind='INCOME' then v_from := public.pf_i_apply(p_account,p_amount);
    else v_from := public.pf_i_apply(p_account,-p_amount); v_to := public.pf_i_apply(p_to_account,p_amount);
    end if;
    select balance into v_after from public.pf_accounts where id=p_account;
  end if;

  insert into public.pf_transactions(kind,status,amount,occurred_on,account_id,to_account_id,category_id,payee,note,
    from_effect,to_effect,balance_after,obligation_id,obligation_due_date,corrects_id,slip_ref,file_hash,
    source_message_id,idem_key,created_by_hash)
  values(p_kind,v_status,p_amount,coalesce(p_occurred_on,timezone('Asia/Bangkok',now())::date),p_account,p_to_account,p_category,
    nullif(left(trim(coalesce(p_payee,'')),180),''),nullif(left(trim(coalesce(p_note,'')),1000),''),
    v_from,v_to,v_after,p_obligation,p_due_date,p_corrects,nullif(trim(coalesce(p_slip_ref,'')),''),nullif(trim(coalesce(p_file_hash,'')),''),
    nullif(p_message,''),nullif(p_idem,''),nullif(p_actor,''))
  returning * into v_tx;

  perform public.pf_i_audit('TRANSACTION_CREATED','transaction',v_tx.id::text,p_actor,p_message,'{}'::jsonb,
    public.pf_i_tx_json(v_tx.id),jsonb_build_object('corrects',p_corrects));
  return v_tx;
end $$;

-- Next due date after `cur`.  Month-based rules keep the intended day-of-month, clamped to month end.
create or replace function public.pf_i_next_due(p_frequency text, p_cur date, p_interval integer, p_dom integer)
returns date language plpgsql immutable as $$
declare v_month date; v_last integer;
begin
  if p_frequency='WEEKLY' then return p_cur+7; end if;
  if p_frequency='CUSTOM_DAYS' then return p_cur+greatest(coalesce(p_interval,1),1); end if;
  if p_frequency in ('MONTHLY','INSTALLMENT','YEARLY') then
    v_month := (date_trunc('month',p_cur)+case when p_frequency='YEARLY' then interval '12 months' else interval '1 month' end)::date;
    v_last := extract(day from (v_month+interval '1 month'-interval '1 day'))::integer;
    return v_month+(least(coalesce(p_dom,extract(day from p_cur)::integer),v_last)-1);
  end if;
  return null;
end $$;

-- ---------------------------------------------------------------- accounts API

create or replace function public.pf_create_account(p_name text, p_kind text, p_actor text, p_message text, p_idem text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_prev jsonb; v_id uuid; v_name text := left(trim(coalesce(p_name,'')),80); v_kind text := upper(coalesce(nullif(trim(p_kind),''),'BANK'));
begin
  v_prev := public.pf_i_idem_get(p_idem); if v_prev is not null then return v_prev; end if;
  if length(v_name)=0 then raise exception 'account_name_required'; end if;
  if v_kind not in ('BANK','CASH','WALLET','SAVINGS','CREDIT','POOL','OTHER') then v_kind := 'OTHER'; end if;
  select id into v_id from public.pf_accounts where name_key=lower(v_name) and is_active;
  if v_id is not null then
    return public.pf_i_idem_put(p_idem,jsonb_build_object('ok',true,'created',false,'account',public.pf_i_account_json(v_id)));
  end if;
  insert into public.pf_accounts(name,kind) values(v_name,v_kind) returning id into v_id;
  perform public.pf_i_audit('ACCOUNT_CREATED','account',v_id::text,p_actor,p_message,'{}'::jsonb,public.pf_i_account_json(v_id));
  return public.pf_i_idem_put(p_idem,jsonb_build_object('ok',true,'created',true,'account',public.pf_i_account_json(v_id)));
end $$;

create or replace function public.pf_create_category(p_name text, p_kind text, p_actor text, p_message text, p_idem text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_prev jsonb; v_id uuid; v_existed boolean; v_name text := left(trim(coalesce(p_name,'')),80);
begin
  v_prev := public.pf_i_idem_get(p_idem); if v_prev is not null then return v_prev; end if;
  if length(v_name)=0 then raise exception 'category_name_required'; end if;
  v_existed := exists(select 1 from public.pf_categories where name_key=lower(v_name));
  v_id := public.pf_i_ensure_category(v_name,upper(coalesce(p_kind,'BOTH')),p_actor,p_message);
  return public.pf_i_idem_put(p_idem,jsonb_build_object('ok',true,'created',not v_existed,
    'category',(select jsonb_build_object('id',id,'name',name,'kind',kind) from public.pf_categories where id=v_id)));
end $$;

create or replace function public.pf_get_accounts() returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'accounts',coalesce(jsonb_agg(public.pf_i_account_json(a.id) order by a.created_at),'[]'::jsonb),
    'known_total',coalesce(sum(a.balance) filter (where a.balance_status in ('CONFIRMED','DERIVED')),0),
    'known_count',count(*) filter (where a.balance_status in ('CONFIRMED','DERIVED')),
    'unknown_count',count(*) filter (where a.balance_status='UNKNOWN'))
  from public.pf_accounts a where a.is_active;
$$;

create or replace function public.pf_get_balance(p_account uuid) returns jsonb language sql stable security definer set search_path=public as $$
  select coalesce(public.pf_i_account_json(p_account),jsonb_build_object('error','account_not_found'));
$$;

-- Owner states the real balance.  The ledger records an ADJUSTMENT for the gap; it never fabricates an expense/income.
create or replace function public.pf_set_balance(p_account uuid, p_amount numeric, p_actor text, p_message text, p_idem text, p_note text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_prev jsonb; v_acc public.pf_accounts%rowtype; v_delta numeric; v_tx public.pf_transactions%rowtype; v_before jsonb;
begin
  v_prev := public.pf_i_idem_get(p_idem); if v_prev is not null then return v_prev; end if;
  if p_amount is null or abs(p_amount)>1000000000 then raise exception 'invalid_amount'; end if;
  select * into v_acc from public.pf_accounts where id=p_account and is_active for update;
  if v_acc.id is null then raise exception 'account_not_found'; end if;
  v_before := public.pf_i_account_json(v_acc.id);
  v_delta := case when v_acc.balance is null then null else p_amount-v_acc.balance end;

  insert into public.pf_transactions(kind,status,amount,account_id,note,from_effect,balance_after,source_message_id,idem_key,created_by_hash)
  values('ADJUSTMENT','CONFIRMED',abs(coalesce(v_delta,0)),v_acc.id,nullif(left(trim(coalesce(p_note,'')),1000),''),v_delta,p_amount,nullif(p_message,''),nullif(p_idem,''),nullif(p_actor,''))
  returning * into v_tx;

  update public.pf_accounts
     set balance=p_amount, balance_status='CONFIRMED', balance_confirmed_at=now(), balance_confirmed_amount=p_amount,
         balance_confirmed_seq=v_tx.seq, updated_at=now()
   where id=v_acc.id;

  perform public.pf_i_audit(case when v_acc.balance is null then 'BALANCE_SET' else 'BALANCE_ADJUSTED' end,'account',v_acc.id::text,p_actor,p_message,v_before,public.pf_i_account_json(v_acc.id),
    jsonb_build_object('delta',v_delta,'adjustment_tx',v_tx.id,'previous_status',v_acc.balance_status));
  return public.pf_i_idem_put(p_idem,jsonb_build_object('ok',true,'account',public.pf_i_account_json(v_acc.id),
    'previous_balance',v_acc.balance,'previous_status',v_acc.balance_status,'delta',v_delta,'adjustment_id',v_tx.id));
end $$;

-- ---------------------------------------------------------------- transactions API

create or replace function public.pf_record_transaction(
  p_kind text, p_amount numeric, p_account uuid, p_to_account uuid, p_category_name text,
  p_payee text, p_note text, p_occurred_on date, p_actor text, p_message text, p_idem text,
  p_slip_ref text, p_file_hash text, p_unassigned_ok boolean default false
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_prev jsonb; v_cat uuid; v_tx public.pf_transactions%rowtype; v_kind text := upper(coalesce(p_kind,''));
begin
  v_prev := public.pf_i_idem_get(p_idem); if v_prev is not null then return v_prev; end if;
  v_cat := public.pf_i_ensure_category(p_category_name,case when v_kind in ('EXPENSE','INCOME') then v_kind else 'BOTH' end,p_actor,p_message);
  v_tx := public.pf_i_post_tx(v_kind,p_amount,p_account,p_to_account,v_cat,p_payee,p_note,p_occurred_on,p_actor,p_message,p_idem,p_slip_ref,p_file_hash,null,null,null,coalesce(p_unassigned_ok,false));
  return public.pf_i_idem_put(p_idem,jsonb_build_object('ok',true,'transaction',public.pf_i_tx_json(v_tx.id),
    'account',public.pf_i_account_json(v_tx.account_id),'to_account',public.pf_i_account_json(v_tx.to_account_id)));
end $$;

create or replace function public.pf_assign_account(p_tx uuid, p_account uuid, p_actor text, p_message text, p_idem text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_prev jsonb; v_tx public.pf_transactions%rowtype; v_eff numeric; v_after numeric; v_before jsonb;
begin
  v_prev := public.pf_i_idem_get(p_idem); if v_prev is not null then return v_prev; end if;
  select * into v_tx from public.pf_transactions where id=p_tx for update;
  if v_tx.id is null then return jsonb_build_object('ok',false,'error','transaction_not_found'); end if;
  if v_tx.status<>'PENDING_CLARIFICATION' then return jsonb_build_object('ok',false,'error','not_pending'); end if;
  if not exists(select 1 from public.pf_accounts where id=p_account and is_active) then return jsonb_build_object('ok',false,'error','account_not_found'); end if;
  perform 1 from public.pf_accounts where id=p_account for update;
  v_before := public.pf_i_tx_json(v_tx.id);
  v_eff := public.pf_i_apply(p_account,case when v_tx.kind='EXPENSE' then -v_tx.amount else v_tx.amount end);
  select balance into v_after from public.pf_accounts where id=p_account;
  update public.pf_transactions set account_id=p_account,status='CONFIRMED',from_effect=v_eff,balance_after=v_after where id=v_tx.id;
  perform public.pf_i_audit('TRANSACTION_ACCOUNT_ASSIGNED','transaction',v_tx.id::text,p_actor,p_message,v_before,public.pf_i_tx_json(v_tx.id));
  return public.pf_i_idem_put(p_idem,jsonb_build_object('ok',true,'transaction',public.pf_i_tx_json(v_tx.id),'account',public.pf_i_account_json(p_account)));
end $$;

-- Owner accepts that this spending is not tied to any tracked account.
create or replace function public.pf_confirm_unassigned(p_tx uuid, p_actor text, p_message text, p_idem text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_prev jsonb; v_tx public.pf_transactions%rowtype; v_before jsonb;
begin
  v_prev := public.pf_i_idem_get(p_idem); if v_prev is not null then return v_prev; end if;
  select * into v_tx from public.pf_transactions where id=p_tx for update;
  if v_tx.id is null or v_tx.status<>'PENDING_CLARIFICATION' then return jsonb_build_object('ok',false,'error','not_pending'); end if;
  v_before := public.pf_i_tx_json(v_tx.id);
  update public.pf_transactions set status='CONFIRMED' where id=v_tx.id;
  perform public.pf_i_audit('TRANSACTION_CONFIRMED_UNASSIGNED','transaction',v_tx.id::text,p_actor,p_message,v_before,public.pf_i_tx_json(v_tx.id));
  return public.pf_i_idem_put(p_idem,jsonb_build_object('ok',true,'transaction',public.pf_i_tx_json(v_tx.id)));
end $$;

create or replace function public.pf_void_transaction(p_tx uuid, p_reason text, p_actor text, p_message text, p_idem text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_prev jsonb; v_tx public.pf_transactions%rowtype; v_before jsonb; v_rev jsonb;
begin
  v_prev := public.pf_i_idem_get(p_idem); if v_prev is not null then return v_prev; end if;
  select * into v_tx from public.pf_transactions where id=p_tx for update;
  if v_tx.id is null then return jsonb_build_object('ok',false,'error','transaction_not_found'); end if;
  if v_tx.status in ('VOIDED','REVERSED') then return jsonb_build_object('ok',false,'error','already_voided','transaction',public.pf_i_tx_json(v_tx.id)); end if;
  if v_tx.kind='ADJUSTMENT' then return jsonb_build_object('ok',false,'error','cannot_void_adjustment'); end if;
  v_before := public.pf_i_tx_json(v_tx.id);
  v_rev := public.pf_i_reverse_effects(v_tx);
  update public.pf_transactions set status='VOIDED',void_reason=left(coalesce(p_reason,''),400),voided_at=now() where id=v_tx.id;
  -- a voided obligation payment re-opens that due date
  if v_tx.obligation_id is not null and v_tx.obligation_due_date is not null then
    delete from public.pf_obligation_payments where transaction_id=v_tx.id;
    update public.pf_obligations set next_due_date=least(next_due_date,v_tx.obligation_due_date),
      installments_paid=greatest(installments_paid-1,0),
      status=case when status='COMPLETED' then 'ACTIVE' else status end, updated_at=now()
     where id=v_tx.obligation_id;
  end if;
  perform public.pf_i_audit('TRANSACTION_VOIDED','transaction',v_tx.id::text,p_actor,p_message,v_before,public.pf_i_tx_json(v_tx.id),
    jsonb_build_object('reason',p_reason,'reversal',v_rev));
  return public.pf_i_idem_put(p_idem,jsonb_build_object('ok',true,'transaction',public.pf_i_tx_json(v_tx.id),'reversal',v_rev,
    'account',public.pf_i_account_json(v_tx.account_id),'to_account',public.pf_i_account_json(v_tx.to_account_id)));
end $$;

-- High-risk bulk action (caller must have obtained explicit confirmation).  Atomic: one transaction,
-- every row goes through pf_void_transaction so each void keeps its own audit trail.
create or replace function public.pf_count_range(p_from date, p_to date) returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object('count',count(*),'total',coalesce(sum(amount),0))
    from public.pf_transactions
   where occurred_on between p_from and p_to and kind in ('EXPENSE','INCOME','TRANSFER') and status in ('CONFIRMED','PENDING_CLARIFICATION');
$$;

create or replace function public.pf_void_range(p_from date, p_to date, p_reason text, p_actor text, p_message text, p_idem text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_prev jsonb; r record; v_n integer := 0; v_res jsonb;
begin
  v_prev := public.pf_i_idem_get(p_idem); if v_prev is not null then return v_prev; end if;
  for r in select id from public.pf_transactions
            where occurred_on between p_from and p_to and kind in ('EXPENSE','INCOME','TRANSFER') and status in ('CONFIRMED','PENDING_CLARIFICATION')
            order by seq desc loop
    v_res := public.pf_void_transaction(r.id,p_reason,p_actor,p_message,p_idem||':'||r.id::text);
    if (v_res->>'ok')::boolean then v_n := v_n+1; end if;
  end loop;
  perform public.pf_i_audit('TRANSACTION_VOIDED','transaction_range',p_from::text||'..'||p_to::text,p_actor,p_message,'{}'::jsonb,
    jsonb_build_object('voided',v_n),jsonb_build_object('reason',p_reason,'bulk',true));
  return public.pf_i_idem_put(p_idem,jsonb_build_object('ok',true,'voided',v_n));
end $$;

-- Wrong amount / account / kind: reverse the original and post the replacement, linked both ways.
create or replace function public.pf_correct_transaction(
  p_tx uuid, p_kind text, p_amount numeric, p_account uuid, p_to_account uuid, p_category_name text,
  p_payee text, p_note text, p_occurred_on date, p_actor text, p_message text, p_idem text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_prev jsonb; v_old public.pf_transactions%rowtype; v_new public.pf_transactions%rowtype; v_cat uuid;
  v_before jsonb; v_kind text; v_rev jsonb;
begin
  v_prev := public.pf_i_idem_get(p_idem); if v_prev is not null then return v_prev; end if;
  select * into v_old from public.pf_transactions where id=p_tx for update;
  if v_old.id is null then return jsonb_build_object('ok',false,'error','transaction_not_found'); end if;
  if v_old.status not in ('CONFIRMED','PENDING_CLARIFICATION') then return jsonb_build_object('ok',false,'error','already_voided'); end if;
  if v_old.kind='ADJUSTMENT' then return jsonb_build_object('ok',false,'error','cannot_correct_adjustment'); end if;
  v_before := public.pf_i_tx_json(v_old.id);
  v_kind := upper(coalesce(nullif(p_kind,''),v_old.kind));
  v_cat := case when nullif(trim(coalesce(p_category_name,'')),'') is not null
                then public.pf_i_ensure_category(p_category_name,v_kind,p_actor,p_message) else v_old.category_id end;
  v_rev := public.pf_i_reverse_effects(v_old);
  v_new := public.pf_i_post_tx(v_kind,coalesce(p_amount,v_old.amount),
      case when v_kind='TRANSFER' then coalesce(p_account,v_old.account_id) else coalesce(p_account,v_old.account_id) end,
      case when v_kind='TRANSFER' then coalesce(p_to_account,v_old.to_account_id) else null end,
      v_cat,coalesce(p_payee,v_old.payee),coalesce(p_note,v_old.note),coalesce(p_occurred_on,v_old.occurred_on),
      p_actor,p_message,p_idem,v_old.slip_ref,v_old.file_hash,v_old.obligation_id,v_old.obligation_due_date,v_old.id,false);
  update public.pf_transactions set status='REVERSED',replaced_by_id=v_new.id,voided_at=now(),void_reason='corrected' where id=v_old.id;
  if v_old.obligation_id is not null then
    update public.pf_obligation_payments set transaction_id=v_new.id where transaction_id=v_old.id;
  end if;
  perform public.pf_i_audit('TRANSACTION_EDITED','transaction',v_old.id::text,p_actor,p_message,v_before,public.pf_i_tx_json(v_new.id),
    jsonb_build_object('replacement',v_new.id,'reversal',v_rev,'edit','correction'));
  return public.pf_i_idem_put(p_idem,jsonb_build_object('ok',true,'original',public.pf_i_tx_json(v_old.id),'transaction',public.pf_i_tx_json(v_new.id),
    'account',public.pf_i_account_json(v_new.account_id),'to_account',public.pf_i_account_json(v_new.to_account_id)));
end $$;

-- Relabel only (category / note / payee): no balance effect, so an in-place audited update.
create or replace function public.pf_update_transaction_meta(
  p_tx uuid, p_category_name text, p_note text, p_payee text, p_actor text, p_message text, p_idem text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_prev jsonb; v_tx public.pf_transactions%rowtype; v_before jsonb; v_cat uuid;
begin
  v_prev := public.pf_i_idem_get(p_idem); if v_prev is not null then return v_prev; end if;
  select * into v_tx from public.pf_transactions where id=p_tx for update;
  if v_tx.id is null then return jsonb_build_object('ok',false,'error','transaction_not_found'); end if;
  if v_tx.status in ('VOIDED','REVERSED') then return jsonb_build_object('ok',false,'error','already_voided'); end if;
  v_before := public.pf_i_tx_json(v_tx.id);
  v_cat := case when nullif(trim(coalesce(p_category_name,'')),'') is not null
                then public.pf_i_ensure_category(p_category_name,case when v_tx.kind in ('EXPENSE','INCOME') then v_tx.kind else 'BOTH' end,p_actor,p_message) else v_tx.category_id end;
  update public.pf_transactions set category_id=v_cat,
      note=coalesce(nullif(left(trim(coalesce(p_note,'')),1000),''),note),
      payee=coalesce(nullif(left(trim(coalesce(p_payee,'')),180),''),payee)
   where id=v_tx.id;
  perform public.pf_i_audit('TRANSACTION_EDITED','transaction',v_tx.id::text,p_actor,p_message,v_before,public.pf_i_tx_json(v_tx.id));
  return public.pf_i_idem_put(p_idem,jsonb_build_object('ok',true,'transaction',public.pf_i_tx_json(v_tx.id)));
end $$;

create or replace function public.pf_get_recent_transactions(p_limit integer default 10, p_include_voided boolean default false)
returns jsonb language sql stable security definer set search_path=public as $$
  select coalesce(jsonb_agg(public.pf_i_tx_json(t.id) order by t.seq desc),'[]'::jsonb)
  from (select id,seq from public.pf_transactions
         where (p_include_voided or status in ('CONFIRMED','PENDING_CLARIFICATION'))
         order by seq desc limit least(greatest(coalesce(p_limit,10),1),100)) t;
$$;

-- Duplicate slip detection: file hash, bank reference, then amount+date+payee.
create or replace function public.pf_find_duplicate_slip(p_file_hash text, p_slip_ref text, p_amount numeric, p_date date, p_payee text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_id uuid; v_reason text;
begin
  if nullif(trim(coalesce(p_file_hash,'')),'') is not null then
    select id into v_id from public.pf_transactions where file_hash=trim(p_file_hash) and status in ('CONFIRMED','PENDING_CLARIFICATION') order by seq desc limit 1;
    if v_id is not null then v_reason := 'file_hash'; end if;
  end if;
  if v_id is null and nullif(trim(coalesce(p_slip_ref,'')),'') is not null then
    select id into v_id from public.pf_transactions where slip_ref=trim(p_slip_ref) and status in ('CONFIRMED','PENDING_CLARIFICATION') order by seq desc limit 1;
    if v_id is not null then v_reason := 'slip_ref'; end if;
  end if;
  if v_id is null and p_amount is not null and p_date is not null and nullif(trim(coalesce(p_payee,'')),'') is not null then
    select id into v_id from public.pf_transactions
     where amount=p_amount and occurred_on=p_date and payee_key=lower(trim(p_payee)) and status in ('CONFIRMED','PENDING_CLARIFICATION')
     order by seq desc limit 1;
    if v_id is not null then v_reason := 'amount_date_payee'; end if;
  end if;
  if v_id is null then return jsonb_build_object('duplicate',false); end if;
  return jsonb_build_object('duplicate',true,'reason',v_reason,'transaction',public.pf_i_tx_json(v_id));
end $$;

-- ---------------------------------------------------------------- obligations API

create or replace function public.pf_i_obligation_json(p_id uuid) returns jsonb language sql stable as $$
  select case when o.id is null then null else jsonb_build_object(
    'id',o.id,'title',o.title,'kind',o.kind,'amount',o.amount,'frequency',o.frequency,'interval_days',o.interval_days,
    'day_of_month',o.day_of_month,'next_due_date',o.next_due_date,'end_date',o.end_date,
    'installments_total',o.installments_total,'installments_paid',o.installments_paid,
    'default_account_id',o.default_account_id,'default_account_name',a.name,'category',c.name,
    'reminder_days',to_jsonb(o.reminder_days),'status',o.status,'note',o.note) end
  from (select 1) s
  left join public.pf_obligations o on o.id=p_id
  left join public.pf_accounts a on a.id=o.default_account_id
  left join public.pf_categories c on c.id=o.category_id;
$$;

create or replace function public.pf_create_obligation(
  p_title text, p_kind text, p_amount numeric, p_frequency text, p_interval_days integer, p_day_of_month integer,
  p_first_due date, p_end_date date, p_installments_total integer, p_default_account uuid, p_category_name text,
  p_reminder_days integer[], p_note text, p_actor text, p_message text, p_idem text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_prev jsonb; v_id uuid; v_kind text := upper(coalesce(nullif(p_kind,''),'EXPENSE')); v_freq text := upper(coalesce(p_frequency,''));
  v_cat uuid; v_days integer[]; v_dom integer; v_title text := left(trim(coalesce(p_title,'')),160);
begin
  v_prev := public.pf_i_idem_get(p_idem); if v_prev is not null then return v_prev; end if;
  if length(v_title)=0 then raise exception 'obligation_title_required'; end if;
  if v_kind not in ('EXPENSE','INCOME') then raise exception 'invalid_obligation_kind'; end if;
  if v_freq not in ('ONE_TIME','WEEKLY','MONTHLY','YEARLY','CUSTOM_DAYS','INSTALLMENT') then raise exception 'invalid_frequency'; end if;
  if p_first_due is null then raise exception 'first_due_required'; end if;
  if p_amount is not null and (p_amount<=0 or p_amount>1000000000) then raise exception 'invalid_amount'; end if;
  if p_default_account is not null and not exists(select 1 from public.pf_accounts where id=p_default_account and is_active) then raise exception 'account_not_found'; end if;

  -- Duplicate prevention: the same live obligation (title+frequency+amount) is returned, not created again.
  select id into v_id from public.pf_obligations
   where title_key=lower(v_title) and frequency=v_freq and kind=v_kind and amount is not distinct from p_amount and status in ('ACTIVE','PAUSED')
   order by created_at limit 1;
  if v_id is not null then
    return public.pf_i_idem_put(p_idem,jsonb_build_object('ok',true,'created',false,'obligation',public.pf_i_obligation_json(v_id)));
  end if;

  v_days := coalesce(p_reminder_days,(select array(select jsonb_array_elements_text(value)::integer from public.pf_settings where key='reminder_days')));
  if v_days is null or cardinality(v_days)=0 then v_days := array[7,3,1,0]; end if;
  if exists(select 1 from unnest(v_days) d where d<0 or d>60) then raise exception 'invalid_reminder_days'; end if;
  v_dom := case when v_freq in ('MONTHLY','INSTALLMENT','YEARLY') then coalesce(p_day_of_month,extract(day from p_first_due)::integer) else p_day_of_month end;
  v_cat := public.pf_i_ensure_category(p_category_name,v_kind,p_actor,p_message);

  insert into public.pf_obligations(title,kind,amount,frequency,interval_days,day_of_month,next_due_date,end_date,installments_total,
    default_account_id,category_id,reminder_days,note)
  values(v_title,v_kind,p_amount,v_freq,p_interval_days,v_dom,p_first_due,p_end_date,p_installments_total,p_default_account,v_cat,v_days,
    nullif(left(trim(coalesce(p_note,'')),1000),''))
  returning id into v_id;
  perform public.pf_i_audit('RECURRING_CREATED','obligation',v_id::text,p_actor,p_message,'{}'::jsonb,public.pf_i_obligation_json(v_id));
  return public.pf_i_idem_put(p_idem,jsonb_build_object('ok',true,'created',true,'obligation',public.pf_i_obligation_json(v_id)));
end $$;

-- p_patch keys: title, amount, next_due_date, end_date, status, reminder_days, default_account_id, category, note, interval_days, day_of_month
create or replace function public.pf_update_obligation(p_id uuid, p_patch jsonb, p_actor text, p_message text, p_idem text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_prev jsonb; v_o public.pf_obligations%rowtype; v_before jsonb; v_cat uuid; v_days integer[];
begin
  v_prev := public.pf_i_idem_get(p_idem); if v_prev is not null then return v_prev; end if;
  select * into v_o from public.pf_obligations where id=p_id for update;
  if v_o.id is null then return jsonb_build_object('ok',false,'error','obligation_not_found'); end if;
  v_before := public.pf_i_obligation_json(v_o.id);
  v_cat := case when p_patch ? 'category' then public.pf_i_ensure_category(p_patch->>'category',v_o.kind,p_actor,p_message) else v_o.category_id end;
  v_days := case when p_patch ? 'reminder_days' then array(select jsonb_array_elements_text(p_patch->'reminder_days')::integer) else v_o.reminder_days end;
  if exists(select 1 from unnest(v_days) d where d<0 or d>60) then raise exception 'invalid_reminder_days'; end if;
  if p_patch ? 'status' and (p_patch->>'status') not in ('ACTIVE','PAUSED','COMPLETED','CANCELLED') then raise exception 'invalid_status'; end if;
  update public.pf_obligations set
    title=coalesce(nullif(left(trim(p_patch->>'title'),160),''),title),
    amount=case when p_patch ? 'amount' then nullif(p_patch->>'amount','')::numeric else amount end,
    next_due_date=coalesce((p_patch->>'next_due_date')::date,next_due_date),
    end_date=case when p_patch ? 'end_date' then nullif(p_patch->>'end_date','')::date else end_date end,
    status=coalesce(p_patch->>'status',status),
    reminder_days=v_days,
    default_account_id=case when p_patch ? 'default_account_id' then nullif(p_patch->>'default_account_id','')::uuid else default_account_id end,
    category_id=v_cat,
    note=case when p_patch ? 'note' then nullif(left(trim(p_patch->>'note'),1000),'') else note end,
    interval_days=case when p_patch ? 'interval_days' then nullif(p_patch->>'interval_days','')::integer else interval_days end,
    day_of_month=case when p_patch ? 'day_of_month' then nullif(p_patch->>'day_of_month','')::integer else day_of_month end,
    updated_at=now()
   where id=v_o.id;
  perform public.pf_i_audit('RECURRING_EDITED','obligation',v_o.id::text,p_actor,p_message,v_before,public.pf_i_obligation_json(v_o.id));
  return public.pf_i_idem_put(p_idem,jsonb_build_object('ok',true,'obligation',public.pf_i_obligation_json(v_o.id)));
end $$;

-- "จ่ายแล้ว": records the payment, resolves THIS due date and advances to the next one.
-- When the account (or a variable amount) is not known the call changes nothing and says what is missing.
create or replace function public.pf_mark_due_paid(
  p_obligation uuid, p_account uuid, p_amount numeric, p_paid_on date, p_actor text, p_message text, p_idem text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_prev jsonb; v_o public.pf_obligations%rowtype; v_acc uuid; v_amt numeric; v_tx public.pf_transactions%rowtype;
  v_next date; v_paid integer; v_status text; v_before jsonb;
begin
  v_prev := public.pf_i_idem_get(p_idem); if v_prev is not null then return v_prev; end if;
  select * into v_o from public.pf_obligations where id=p_obligation for update;
  if v_o.id is null then return jsonb_build_object('ok',false,'error','obligation_not_found'); end if;
  if v_o.status<>'ACTIVE' then return jsonb_build_object('ok',false,'error','obligation_not_active','obligation',public.pf_i_obligation_json(v_o.id)); end if;
  v_acc := coalesce(p_account,v_o.default_account_id);
  v_amt := coalesce(p_amount,v_o.amount);
  if v_amt is null then return jsonb_build_object('ok',false,'error','amount_required','obligation',public.pf_i_obligation_json(v_o.id)); end if;
  if v_acc is null then return jsonb_build_object('ok',false,'error','account_required','obligation',public.pf_i_obligation_json(v_o.id)); end if;
  if exists(select 1 from public.pf_obligation_payments where obligation_id=v_o.id and due_date=v_o.next_due_date) then
    return jsonb_build_object('ok',false,'error','already_paid','obligation',public.pf_i_obligation_json(v_o.id));
  end if;
  v_before := public.pf_i_obligation_json(v_o.id);
  v_tx := public.pf_i_post_tx(v_o.kind,v_amt,v_acc,null,v_o.category_id,v_o.title,'obligation:'||v_o.title,coalesce(p_paid_on,timezone('Asia/Bangkok',now())::date),
          p_actor,p_message,p_idem,null,null,v_o.id,v_o.next_due_date,null,false);
  insert into public.pf_obligation_payments(obligation_id,due_date,transaction_id,paid_on)
  values(v_o.id,v_o.next_due_date,v_tx.id,coalesce(p_paid_on,timezone('Asia/Bangkok',now())::date));

  v_paid := v_o.installments_paid+1;
  if v_o.frequency='ONE_TIME' then v_next := v_o.next_due_date; v_status := 'COMPLETED';
  else
    v_next := public.pf_i_next_due(v_o.frequency,v_o.next_due_date,v_o.interval_days,v_o.day_of_month);
    v_status := 'ACTIVE';
    if v_o.frequency='INSTALLMENT' and v_paid>=v_o.installments_total then v_status := 'COMPLETED'; end if;
    if v_o.end_date is not null and v_next>v_o.end_date then v_status := 'COMPLETED'; end if;
  end if;
  update public.pf_obligations set next_due_date=v_next,installments_paid=v_paid,status=v_status,updated_at=now() where id=v_o.id;
  perform public.pf_i_audit('PAYMENT_MARKED_PAID','obligation',v_o.id::text,p_actor,p_message,v_before,public.pf_i_obligation_json(v_o.id),
    jsonb_build_object('transaction',v_tx.id,'paid_due_date',v_o.next_due_date));
  return public.pf_i_idem_put(p_idem,jsonb_build_object('ok',true,'paid_due_date',v_o.next_due_date,'transaction',public.pf_i_tx_json(v_tx.id),
    'obligation',public.pf_i_obligation_json(v_o.id),'account',public.pf_i_account_json(v_acc)));
end $$;

-- Occurrences (including overdue ones) up to p_to, projected without touching state.
create or replace function public.pf_list_upcoming(p_from date, p_to date, p_limit integer default 60)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  v_out jsonb := '[]'::jsonb; o public.pf_obligations%rowtype; v_due date; v_n integer; v_paid integer;
  v_today date := coalesce(p_from,timezone('Asia/Bangkok',now())::date);
begin
  for o in select * from public.pf_obligations where status='ACTIVE' and next_due_date<=p_to order by next_due_date loop
    v_due := o.next_due_date; v_n := 0; v_paid := o.installments_paid;
    while v_due<=p_to and v_n<24 loop
      if o.end_date is not null and v_due>o.end_date then exit; end if;
      if o.frequency='INSTALLMENT' and v_paid>=o.installments_total then exit; end if;
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'obligation_id',o.id,'title',o.title,'kind',o.kind,'amount',o.amount,'due_date',v_due,
        'days_until',v_due-v_today,'overdue',v_due<v_today,'frequency',o.frequency,
        'default_account_id',o.default_account_id,'projected',v_n>0));
      exit when o.frequency='ONE_TIME';
      v_due := public.pf_i_next_due(o.frequency,v_due,o.interval_days,o.day_of_month);
      v_n := v_n+1; v_paid := v_paid+1;
    end loop;
  end loop;
  return coalesce((select jsonb_agg(e order by (e->>'due_date'), (e->>'title')) from (select e from jsonb_array_elements(v_out) e limit least(greatest(coalesce(p_limit,60),1),300)) s),'[]'::jsonb);
end $$;

-- Forecast is always labelled as a forecast.  It never edits or replaces the current balance.
create or replace function public.pf_forecast(p_to date) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_items jsonb; v_out numeric; v_in numeric; v_known numeric; v_unknown integer; v_known_count integer; v_unknown_amt integer;
begin
  v_items := public.pf_list_upcoming(timezone('Asia/Bangkok',now())::date,p_to,300);
  select coalesce(sum((e->>'amount')::numeric) filter (where e->>'kind'='EXPENSE'),0),
         coalesce(sum((e->>'amount')::numeric) filter (where e->>'kind'='INCOME'),0),
         count(*) filter (where e->>'amount' is null)
    into v_out,v_in,v_unknown_amt from jsonb_array_elements(v_items) e;
  select coalesce(sum(balance),0),count(*) filter (where balance_status='UNKNOWN'),count(*) filter (where balance_status<>'UNKNOWN')
    into v_known,v_unknown,v_known_count from public.pf_accounts where is_active;
  return jsonb_build_object('forecast',true,'to',p_to,'known_balance_total',v_known,'known_account_count',v_known_count,
    'unknown_account_count',v_unknown,'upcoming_outflow',v_out,'upcoming_inflow',v_in,'items_without_amount',v_unknown_amt,
    'projected_known_balance',v_known+v_in-v_out,'partial',(v_unknown>0 or v_unknown_amt>0),'items',v_items);
end $$;

create or replace function public.pf_get_summary(p_from date, p_to date) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_income numeric; v_expense numeric; v_cnt integer; v_pending integer; v_cats jsonb;
begin
  select coalesce(sum(amount) filter (where kind='INCOME'),0),coalesce(sum(amount) filter (where kind='EXPENSE'),0),count(*)
    into v_income,v_expense,v_cnt
    from public.pf_transactions where occurred_on between p_from and p_to and kind in ('INCOME','EXPENSE') and status in ('CONFIRMED','PENDING_CLARIFICATION');
  select count(*) into v_pending from public.pf_transactions where status='PENDING_CLARIFICATION';
  select coalesce(jsonb_agg(jsonb_build_object('category',coalesce(c.name,'ไม่ระบุหมวด'),'kind',x.kind,'total',x.total) order by x.total desc),'[]'::jsonb) into v_cats
    from (select category_id,kind,sum(amount) total from public.pf_transactions
           where occurred_on between p_from and p_to and kind in ('INCOME','EXPENSE') and status in ('CONFIRMED','PENDING_CLARIFICATION')
           group by category_id,kind) x left join public.pf_categories c on c.id=x.category_id;
  return jsonb_build_object('from',p_from,'to',p_to,'income',v_income,'expense',v_expense,'net',v_income-v_expense,
    'transaction_count',v_cnt,'pending_clarification_count',v_pending,'by_category',v_cats);
end $$;

-- ---------------------------------------------------------------- reminders

-- Claims due reminders atomically so concurrent / repeated cron runs never double-send.
-- Each (obligation, due date, threshold) is delivered once; a failed or abandoned claim may be retried (max 3).
create or replace function public.pf_claim_reminders(p_today date, p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  o public.pf_obligations%rowtype; v_until integer; v_thr integer; v_row public.pf_reminder_deliveries%rowtype;
  v_out jsonb := '[]'::jsonb; v_n integer := 0;
begin
  for o in select * from public.pf_obligations where status='ACTIVE' order by next_due_date for update skip locked loop
    exit when v_n>=p_limit;
    continue when cardinality(o.reminder_days)=0;   -- owner turned reminders off for this item
    v_until := o.next_due_date-p_today;
    if v_until<0 then
      continue when v_until<-7;   -- overdue nags stop after a week; the item stays visible on the dashboard
      v_thr := v_until;
    else
      select min(d) into v_thr from unnest(o.reminder_days) d where d>=v_until;
      continue when v_thr is null;
    end if;
    if exists(select 1 from public.pf_obligation_payments where obligation_id=o.id and due_date=o.next_due_date) then continue; end if;
    v_row := null;
    insert into public.pf_reminder_deliveries(obligation_id,due_date,days_before) values(o.id,o.next_due_date,v_thr)
    on conflict (obligation_id,due_date,days_before) do nothing returning * into v_row;
    if v_row.id is null then
      update public.pf_reminder_deliveries set status='CLAIMED',attempts=attempts+1,claimed_at=now()
       where obligation_id=o.id and due_date=o.next_due_date and days_before=v_thr and attempts<3
         and ((status='FAILED') or (status='CLAIMED' and claimed_at<now()-interval '15 minutes'))
       returning * into v_row;
    end if;
    if v_row.id is null then continue; end if;
    v_n := v_n+1;
    v_out := v_out || jsonb_build_array(jsonb_build_object('delivery_id',v_row.id,'obligation_id',o.id,'title',o.title,'kind',o.kind,
      'amount',o.amount,'due_date',o.next_due_date,'days_until',v_until,'threshold',v_thr,'overdue',v_until<0,
      'default_account',(select name from public.pf_accounts where id=o.default_account_id)));
  end loop;
  return v_out;
end $$;

create or replace function public.pf_finish_reminder(p_delivery uuid, p_ok boolean, p_error text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_row public.pf_reminder_deliveries%rowtype;
begin
  update public.pf_reminder_deliveries
     set status=case when p_ok then 'SENT' else 'FAILED' end,
         sent_at=case when p_ok then now() else sent_at end,
         last_error=case when p_ok then null else left(coalesce(p_error,'unknown'),300) end
   where id=p_delivery returning * into v_row;
  if v_row.id is null then return jsonb_build_object('ok',false,'error','delivery_not_found'); end if;
  perform public.pf_i_audit(case when p_ok then 'REMINDER_SENT' else 'REMINDER_FAILED' end,'obligation',v_row.obligation_id::text,null,null,'{}'::jsonb,
    jsonb_build_object('due_date',v_row.due_date,'days_before',v_row.days_before,'attempts',v_row.attempts),jsonb_build_object('error',p_error));
  return jsonb_build_object('ok',true,'status',v_row.status);
end $$;

-- ---------------------------------------------------------------- conversation state (clarifications)

create or replace function public.pf_pending_set(p_actor text, p_kind text, p_payload jsonb, p_ttl_minutes integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  update public.pf_pending_states set resolved_at=now() where actor_hash=p_actor and resolved_at is null;
  insert into public.pf_pending_states(actor_hash,kind,payload,expires_at)
  values(p_actor,p_kind,coalesce(p_payload,'{}'::jsonb),now()+make_interval(mins=>least(greatest(coalesce(p_ttl_minutes,15),1),240)))
  returning id into v_id;
  return jsonb_build_object('ok',true,'id',v_id);
end $$;

create or replace function public.pf_pending_get(p_actor text) returns jsonb language sql stable security definer set search_path=public as $$
  select coalesce((select jsonb_build_object('id',id,'kind',kind,'payload',payload,'expires_at',expires_at)
    from public.pf_pending_states where actor_hash=p_actor and resolved_at is null and expires_at>now() order by created_at desc limit 1),'null'::jsonb);
$$;

create or replace function public.pf_pending_clear(p_actor text) returns jsonb language plpgsql security definer set search_path=public as $$
begin
  update public.pf_pending_states set resolved_at=now() where actor_hash=p_actor and resolved_at is null;
  return jsonb_build_object('ok',true);
end $$;

-- ---------------------------------------------------------------- audit entry point for the application layer

create or replace function public.pf_log_audit(p_action text, p_entity_type text, p_entity_id text, p_actor text, p_message text, p_meta jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  perform public.pf_i_audit(p_action,p_entity_type,p_entity_id,p_actor,p_message,'{}'::jsonb,'{}'::jsonb,coalesce(p_meta,'{}'::jsonb));
  return jsonb_build_object('ok',true);
end $$;

-- ---------------------------------------------------------------- settings API

create or replace function public.pf_get_settings() returns jsonb language sql stable security definer set search_path=public as $$
  select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) from public.pf_settings;
$$;

create or replace function public.pf_set_reminder_days(p_days integer[], p_actor text, p_message text)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if p_days is null or cardinality(p_days)=0 or exists(select 1 from unnest(p_days) d where d<0 or d>60) then raise exception 'invalid_reminder_days'; end if;
  perform public.pf_i_audit('PERMISSION_CHANGED','settings','reminder_days',p_actor,p_message,
    (select jsonb_build_object('reminder_days',value) from public.pf_settings where key='reminder_days'),jsonb_build_object('reminder_days',to_jsonb(p_days)));
  update public.pf_settings set value=to_jsonb(p_days),updated_at=now() where key='reminder_days';
  return jsonb_build_object('ok',true,'reminder_days',p_days);
end $$;

-- ---------------------------------------------------------------- channel binding API

create or replace function public.pf_binding_lookup(p_group_hash text) returns jsonb language sql stable security definer set search_path=public as $$
  select coalesce((select jsonb_build_object('id',id,'status',status,'failed_attempts',failed_attempts,'has_code',code_hash is not null,
    'other_group_active',exists(select 1 from public.pf_channel_bindings x where x.status='ACTIVE' and x.group_id_hash<>p_group_hash))
    from public.pf_channel_bindings where group_id_hash=p_group_hash and status in ('PENDING','ACTIVE') limit 1),
    jsonb_build_object('status','NONE','other_group_active',exists(select 1 from public.pf_channel_bindings x where x.status='ACTIVE')));
$$;

-- A join event is only ever captured as PENDING.  Capturing grants no permission.
create or replace function public.pf_binding_capture(p_group_hash text, p_group_enc text, p_event_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_row public.pf_channel_bindings%rowtype;
begin
  if nullif(trim(coalesce(p_group_hash,'')),'') is null then raise exception 'group_hash_required'; end if;
  select * into v_row from public.pf_channel_bindings where group_id_hash=p_group_hash and status in ('PENDING','ACTIVE');
  if v_row.id is not null then return jsonb_build_object('ok',true,'created',false,'status',v_row.status); end if;
  insert into public.pf_channel_bindings(group_id_hash,group_id_enc,captured_by_event) values(p_group_hash,p_group_enc,p_event_id) returning * into v_row;
  perform public.pf_i_audit('BINDING_PENDING','binding',v_row.id::text,null,p_event_id,'{}'::jsonb,jsonb_build_object('status','PENDING'));
  return jsonb_build_object('ok',true,'created',true,'status','PENDING');
end $$;

-- Operator-side: mint a one-time code for a pending group (shown once, stored only as a hash).
create or replace function public.pf_binding_issue_code(p_group_hash text, p_ttl_minutes integer default 30)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_code text; v_row public.pf_channel_bindings%rowtype;
begin
  select * into v_row from public.pf_channel_bindings where group_id_hash=p_group_hash and status='PENDING' for update;
  if v_row.id is null then return jsonb_build_object('ok',false,'error','no_pending_binding'); end if;
  -- gen_random_uuid() is CSPRNG-backed (random() is not): derive six digits from it
  v_code := 'SNK-'||lpad((('x'||substr(replace(gen_random_uuid()::text,'-',''),1,8))::bit(32)::bigint % 1000000)::text,6,'0');
  update public.pf_channel_bindings set code_hash=encode(sha256(convert_to(v_code,'utf8')),'hex'),
    code_expires_at=now()+make_interval(mins=>least(greatest(p_ttl_minutes,1),240)),failed_attempts=0,updated_at=now() where id=v_row.id;
  perform public.pf_i_audit('BINDING_CODE_ISSUED','binding',v_row.id::text,null,null,'{}'::jsonb,'{}'::jsonb);
  return jsonb_build_object('ok',true,'code',v_code);
end $$;

-- Activation requires a PENDING row AND (trusted owner user id, decided by the caller, OR a valid one-time code).
create or replace function public.pf_binding_activate(p_group_hash text, p_actor text, p_owner_verified boolean, p_code text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_row public.pf_channel_bindings%rowtype; v_ok boolean := false; v_how text;
begin
  select * into v_row from public.pf_channel_bindings where group_id_hash=p_group_hash and status in ('PENDING','ACTIVE') for update;
  if v_row.id is null then return jsonb_build_object('ok',false,'error','no_pending_binding'); end if;
  if v_row.status='ACTIVE' then return jsonb_build_object('ok',true,'already_active',true); end if;
  if exists(select 1 from public.pf_channel_bindings where status='ACTIVE') then
    perform public.pf_i_audit('BINDING_REJECTED','binding',v_row.id::text,p_actor,null,'{}'::jsonb,'{}'::jsonb,jsonb_build_object('reason','another_group_active'));
    return jsonb_build_object('ok',false,'error','another_group_active');
  end if;
  if v_row.failed_attempts>=5 then return jsonb_build_object('ok',false,'error','locked'); end if;
  if coalesce(p_owner_verified,false) then v_ok := true; v_how := 'owner_user';
  elsif nullif(trim(coalesce(p_code,'')),'') is not null and v_row.code_hash is not null and v_row.code_expires_at>now()
        and v_row.code_hash=encode(sha256(convert_to(upper(trim(p_code)),'utf8')),'hex') then v_ok := true; v_how := 'one_time_code';
  end if;
  if not v_ok then
    update public.pf_channel_bindings set failed_attempts=failed_attempts+1,updated_at=now() where id=v_row.id;
    perform public.pf_i_audit('BINDING_REJECTED','binding',v_row.id::text,p_actor,null,'{}'::jsonb,'{}'::jsonb,jsonb_build_object('reason','not_verified'));
    return jsonb_build_object('ok',false,'error','not_verified');
  end if;
  update public.pf_channel_bindings set status='ACTIVE',verified_by_hash=nullif(p_actor,''),activated_at=now(),code_hash=null,code_expires_at=null,updated_at=now() where id=v_row.id;
  perform public.pf_i_audit('GROUP_BOUND','binding',v_row.id::text,p_actor,null,jsonb_build_object('status','PENDING'),jsonb_build_object('status','ACTIVE'),jsonb_build_object('method',v_how));
  return jsonb_build_object('ok',true,'method',v_how);
end $$;

create or replace function public.pf_binding_revoke(p_group_hash text, p_actor text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_row public.pf_channel_bindings%rowtype;
begin
  update public.pf_channel_bindings set status='REVOKED',revoked_at=now(),updated_at=now()
   where group_id_hash=p_group_hash and status in ('PENDING','ACTIVE') returning * into v_row;
  if v_row.id is null then return jsonb_build_object('ok',false,'error','no_binding'); end if;
  perform public.pf_i_audit('GROUP_UNBOUND','binding',v_row.id::text,p_actor,null,'{}'::jsonb,jsonb_build_object('status','REVOKED'));
  return jsonb_build_object('ok',true);
end $$;

-- Where reminders may be delivered: only the single ACTIVE verified group.
create or replace function public.pf_binding_active_target() returns jsonb language sql stable security definer set search_path=public as $$
  select coalesce((select jsonb_build_object('id',id,'group_id_enc',group_id_enc,'group_id_hash',group_id_hash)
    from public.pf_channel_bindings where status='ACTIVE' limit 1),'null'::jsonb);
$$;

-- ---------------------------------------------------------------- dashboard views (read-only, server-mediated)

create or replace view public.pf_account_balances_summary_v1 with (security_invoker=true) as
select a.id,a.name,a.kind,a.balance,a.balance_status,a.balance_confirmed_at,
       (a.balance_status='UNKNOWN') as is_unknown
  from public.pf_accounts a where a.is_active;

create or replace view public.pf_recent_transactions_summary_v1 with (security_invoker=true) as
select t.id,t.seq,t.kind,t.status,t.amount,t.occurred_on,a.name as account_name,b.name as to_account_name,
       c.name as category,t.payee,t.note,t.created_at
  from public.pf_transactions t
  left join public.pf_accounts a on a.id=t.account_id
  left join public.pf_accounts b on b.id=t.to_account_id
  left join public.pf_categories c on c.id=t.category_id
 where t.status in ('CONFIRMED','PENDING_CLARIFICATION')
 order by t.seq desc limit 100;

create or replace view public.pf_upcoming_obligations_summary_v1 with (security_invoker=true) as
select o.id,o.title,o.kind,o.amount,o.frequency,o.next_due_date,
       (o.next_due_date-timezone('Asia/Bangkok',now())::date) as days_until,
       (o.next_due_date<timezone('Asia/Bangkok',now())::date) as overdue,
       a.name as default_account_name,o.installments_paid,o.installments_total
  from public.pf_obligations o left join public.pf_accounts a on a.id=o.default_account_id
 where o.status='ACTIVE' order by o.next_due_date;

create or replace view public.pf_month_cashflow_summary_v1 with (security_invoker=true) as
select date_trunc('month',t.occurred_on)::date as month,
       coalesce(sum(t.amount) filter (where t.kind='INCOME'),0) as income,
       coalesce(sum(t.amount) filter (where t.kind='EXPENSE'),0) as expense,
       coalesce(sum(t.amount) filter (where t.kind='INCOME'),0)-coalesce(sum(t.amount) filter (where t.kind='EXPENSE'),0) as net,
       count(*) filter (where t.status='PENDING_CLARIFICATION') as pending_clarification
  from public.pf_transactions t
 where t.kind in ('INCOME','EXPENSE') and t.status in ('CONFIRMED','PENDING_CLARIFICATION')
 group by 1 order by 1 desc;

-- ---------------------------------------------------------------- RLS + grants

do $$
declare t text;
begin
  foreach t in array array['pf_settings','pf_accounts','pf_categories','pf_obligations','pf_transactions','pf_obligation_payments',
    'pf_reminder_deliveries','pf_idempotency','pf_pending_states','pf_audit_events','pf_channel_bindings'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select on public.%I to service_role',t);
    execute format('create policy %I on public.%I as restrictive for all to public using (false) with check (false)',t||'_no_direct_client_access',t);
  end loop;
end $$;

revoke all on public.pf_account_balances_summary_v1,public.pf_recent_transactions_summary_v1,
  public.pf_upcoming_obligations_summary_v1,public.pf_month_cashflow_summary_v1 from public,anon,authenticated;
grant select on public.pf_account_balances_summary_v1,public.pf_recent_transactions_summary_v1,
  public.pf_upcoming_obligations_summary_v1,public.pf_month_cashflow_summary_v1 to service_role;

-- Public RPCs: service_role only.  Internal helpers (pf_i_*) are callable by nobody directly.
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
            where n.nspname='public' and p.proname like 'pf\_%' loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',r.sig);
    if r.proname not like 'pf\_i\_%' then
      execute format('grant execute on function %s to service_role',r.sig);
    end if;
  end loop;
end $$;
