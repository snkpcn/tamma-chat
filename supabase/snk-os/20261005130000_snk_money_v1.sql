-- SNK MONEY x THONGTHAI  --  runs on the EXISTING SNK LIFE OS database (snk-life-os-private).
--
-- This EXTENDS the existing Money model (financial_accounts, transactions, recurring_transactions,
-- transaction_categories, user_settings, activity_log).  It does not create a competing ledger.
-- Everything is additive/backwards compatible.  Tables are empty today, existing UI keeps working.
--
-- Rules
--  * Internal ledger only.  No bank connection.  A balance is CONFIRMED (owner said so), DERIVED
--    (last confirmed amount + later recorded movements) or UNKNOWN.  UNKNOWN is never 0.
--  * ONE balance path: financial_accounts.current_balance is a pure derivation maintained by
--    finance_i_recompute(), fired by a trigger on every transactions change -- so rows written by the
--    chat engine AND rows edited in the dashboard can never desynchronise.  Clients cannot write the
--    balance columns directly.
--  * The LLM never computes a balance; the Netlify layer only calls the finance_* RPCs below.
--  * RPCs are security definer, owner-scoped (p_owner), service_role only; the chat layer is not a
--    Supabase-authenticated user, so it never runs as the owner through RLS.

-- ================================================================ financial_accounts

alter table public.financial_accounts
  add column if not exists current_balance numeric(14,2) null,
  add column if not exists balance_status text not null default 'UNKNOWN',
  add column if not exists balance_confirmed_at timestamptz null,
  add column if not exists balance_confirmed_amount numeric(14,2) null,
  add column if not exists balance_confirmed_seq bigint null;

alter table public.financial_accounts
  add constraint financial_accounts_balance_status_chk check (balance_status in ('CONFIRMED','DERIVED','UNKNOWN')),
  add constraint financial_accounts_unknown_iff_null_chk check ((balance_status='UNKNOWN')=(current_balance is null)),
  add constraint financial_accounts_balance_range_chk check (current_balance is null or abs(current_balance)<=1000000000);

-- NOTE: no unique index on account names: the live data already holds two same-named accounts that must not be
-- touched.  Name uniqueness for NEW accounts is enforced inside finance_create_account().

-- ================================================================ transactions

alter table public.transactions drop constraint if exists transactions_type_check;
alter table public.transactions
  add constraint transactions_type_check check (type in ('income','expense','transfer','adjustment'));

alter table public.transactions
  add column if not exists seq bigint generated always as identity,
  add column if not exists status text not null default 'CONFIRMED',
  add column if not exists obligation_id uuid null references public.recurring_transactions(id) on delete restrict,
  add column if not exists obligation_due_date date null,
  add column if not exists corrects_id uuid null references public.transactions(id) on delete restrict,
  add column if not exists replaced_by_id uuid null references public.transactions(id) on delete restrict,
  add column if not exists void_reason text null,
  add column if not exists voided_at timestamptz null,
  add column if not exists slip_ref text null,
  add column if not exists file_hash text null,
  add column if not exists source_channel text null,
  add column if not exists source_message_id text null,
  add column if not exists source_group_hash text null,
  add column if not exists idem_key text null,
  add column if not exists confidence numeric(4,3) null,
  add column if not exists created_by_hash text null,
  add column if not exists payee_key text generated always as (lower(trim(merchant))) stored,
  add column if not exists occurred_on date generated always as (((occurred_at at time zone 'Asia/Bangkok'))::date) stored;

alter table public.transactions
  add constraint transactions_status_chk check (status in ('CONFIRMED','PENDING_CLARIFICATION','VOIDED','REVERSED')),
  add constraint transactions_source_channel_chk check (source_channel is null or source_channel in ('line','dashboard','system')),
  add constraint transactions_amount_chk check (amount>=0 and amount<=1000000000 and (type='adjustment' or amount>0)),
  add constraint transactions_transfer_accounts_chk check (type<>'transfer' or (account_id is not null and transfer_account_id is not null and account_id<>transfer_account_id)),
  add constraint transactions_single_account_chk check (type='transfer' or transfer_account_id is null),
  add constraint transactions_adjustment_account_chk check (type<>'adjustment' or account_id is not null),
  add constraint transactions_archived_matches_status_chk check (status not in ('VOIDED','REVERSED') or archived_at is not null);

create unique index if not exists transactions_seq_uq on public.transactions(seq);
create unique index if not exists transactions_owner_idem_uq on public.transactions(owner_id, idem_key) where idem_key is not null;
create index if not exists transactions_owner_account_seq_idx on public.transactions(owner_id, account_id, seq desc);
create index if not exists transactions_transfer_account_idx on public.transactions(transfer_account_id) where transfer_account_id is not null;
create index if not exists transactions_file_hash_idx on public.transactions(owner_id, file_hash) where file_hash is not null;
create index if not exists transactions_slip_ref_idx on public.transactions(owner_id, slip_ref) where slip_ref is not null;
create index if not exists transactions_dupe_idx on public.transactions(owner_id, amount, occurred_on, payee_key) where payee_key is not null;
create index if not exists transactions_owner_status_idx on public.transactions(owner_id, status) where archived_at is null;
create index if not exists transactions_obligation_idx on public.transactions(obligation_id) where obligation_id is not null;
create index if not exists transactions_corrects_idx on public.transactions(corrects_id) where corrects_id is not null;
create index if not exists transactions_replaced_by_idx on public.transactions(replaced_by_id) where replaced_by_id is not null;

-- ================================================================ recurring_transactions (= obligations)

alter table public.recurring_transactions alter column amount drop not null;   -- variable bills: unknown, never 0
alter table public.recurring_transactions drop constraint if exists recurring_transactions_frequency_check;
alter table public.recurring_transactions
  add column if not exists interval_days integer null,
  add column if not exists installments_total integer null,
  add column if not exists installments_paid integer not null default 0,
  add column if not exists end_date date null,
  add column if not exists status text not null default 'ACTIVE',
  add column if not exists reminder_days integer[] not null default array[7,3,1,0],
  add column if not exists last_paid_at timestamptz null,
  add column if not exists source text null;

alter table public.recurring_transactions
  add constraint recurring_transactions_frequency_check check (frequency in ('daily','weekly','monthly','yearly','once','custom_days','installment')),
  add constraint recurring_transactions_status_chk check (status in ('ACTIVE','PAUSED','COMPLETED','CANCELLED')),
  add constraint recurring_transactions_amount_chk check (amount is null or (amount>0 and amount<=1000000000)),
  add constraint recurring_transactions_interval_chk check (interval_days is null or interval_days between 1 and 3660),
  add constraint recurring_transactions_custom_interval_chk check (frequency<>'custom_days' or interval_days is not null),
  add constraint recurring_transactions_installment_chk check (frequency<>'installment' or installments_total is not null),
  add constraint recurring_transactions_installments_range_chk check (installments_total is null or installments_total between 1 and 600);

create index if not exists recurring_transactions_due_idx
  on public.recurring_transactions(owner_id, next_occurrence) where status='ACTIVE' and archived_at is null;

-- ================================================================ new tables

create table if not exists public.finance_obligation_payments(
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  obligation_id uuid not null references public.recurring_transactions(id) on delete restrict,
  due_date date not null,
  transaction_id uuid not null references public.transactions(id) on delete restrict,
  paid_on date not null,
  created_at timestamptz not null default now(),
  unique(obligation_id,due_date)
);
create index if not exists finance_obligation_payments_owner_idx on public.finance_obligation_payments(owner_id, due_date);
create index if not exists finance_obligation_payments_tx_idx on public.finance_obligation_payments(transaction_id);

create table if not exists public.finance_reminder_deliveries(
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  obligation_id uuid not null references public.recurring_transactions(id) on delete restrict,
  due_date date not null,
  days_before integer not null,
  status text not null default 'CLAIMED' check(status in ('CLAIMED','SENT','FAILED')),
  attempts integer not null default 1,
  last_error text null,
  claimed_at timestamptz not null default now(),
  sent_at timestamptz null,
  unique(obligation_id,due_date,days_before)
);
create index if not exists finance_reminder_deliveries_owner_idx on public.finance_reminder_deliveries(owner_id, status);

create table if not exists public.finance_idempotency(
  owner_id uuid not null references auth.users(id) on delete cascade,
  key text not null check(length(key) between 1 and 300),
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(owner_id,key)
);

create table if not exists public.finance_pending_states(
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  actor_hash text not null,
  kind text not null check(length(kind) between 1 and 60),
  payload jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null,
  resolved_at timestamptz null,
  created_at timestamptz not null default now()
);
create index if not exists finance_pending_open_idx on public.finance_pending_states(owner_id, actor_hash, created_at desc) where resolved_at is null;

create table if not exists public.finance_channel_bindings(
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  channel text not null default 'LINE' check(channel='LINE'),
  scope text not null default 'PERSONAL_FINANCE_PRIVATE' check(scope='PERSONAL_FINANCE_PRIVATE'),
  status text not null default 'PENDING' check(status in ('PENDING','ACTIVE','REVOKED','REJECTED')),
  group_id_hash text not null,
  group_id_enc text null,
  group_name text null,                       -- informational label only, never an identity
  code_hash text null,
  code_expires_at timestamptz null,
  failed_attempts integer not null default 0,
  captured_by_event text null,
  verified_by_hash text null,
  created_at timestamptz not null default now(),
  verified_at timestamptz null,
  bound_at timestamptz null,
  revoked_at timestamptz null,
  updated_at timestamptz not null default now()
);
create unique index if not exists finance_bindings_live_group_uq on public.finance_channel_bindings(group_id_hash) where status in ('PENDING','ACTIVE');
create unique index if not exists finance_bindings_single_active_uq on public.finance_channel_bindings(owner_id) where status='ACTIVE';

-- ================================================================ guards

-- Audit rows for finance are append-only (cascading user deletion is still allowed).
create or replace function public.finance_i_activity_guard() returns trigger language plpgsql set search_path=public as $$
begin
  if pg_trigger_depth()>1 then return old; end if;
  if old.metadata->>'domain'='finance' then raise exception 'finance audit rows are append-only'; end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
create or replace trigger finance_activity_guard before update or delete on public.activity_log
  for each row execute function public.finance_i_activity_guard();

-- Only the finance engine writes balance columns (clients cannot override the single balance path).
create or replace function public.finance_i_account_guard() returns trigger language plpgsql set search_path=public as $$
begin
  if coalesce(current_setting('snk.finance_engine',true),'')='1' then return new; end if;
  if tg_op='INSERT' then
    if new.current_balance is not null or new.balance_status<>'UNKNOWN' or new.balance_confirmed_seq is not null
       or new.balance_confirmed_amount is not null or new.balance_confirmed_at is not null then
      raise exception 'finance_balance_is_engine_managed';
    end if;
  elsif new.current_balance is distinct from old.current_balance or new.balance_status is distinct from old.balance_status
     or new.balance_confirmed_seq is distinct from old.balance_confirmed_seq
     or new.balance_confirmed_amount is distinct from old.balance_confirmed_amount
     or new.balance_confirmed_at is distinct from old.balance_confirmed_at then
    raise exception 'finance_balance_is_engine_managed';
  end if;
  return new;
end $$;
create or replace trigger finance_account_guard before insert or update on public.financial_accounts
  for each row execute function public.finance_i_account_guard();

-- Ledger rows written by the engine are never hard-deleted; adjustments are confirmation anchors.
create or replace function public.finance_i_tx_guard() returns trigger language plpgsql set search_path=public as $$
begin
  if tg_op='DELETE' then
    if pg_trigger_depth()>1 then return old; end if;       -- cascading user deletion
    if old.source_channel is not null or old.status<>'CONFIRMED' or old.type='adjustment' then
      raise exception 'finance_transactions_are_never_hard_deleted';
    end if;
    return old;
  end if;
  if new.seq is distinct from old.seq then raise exception 'finance_transaction_seq_is_immutable'; end if;
  if old.type='adjustment' and coalesce(current_setting('snk.finance_engine',true),'')<>'1'
     and (new.amount is distinct from old.amount or new.archived_at is distinct from old.archived_at or new.type is distinct from old.type or new.account_id is distinct from old.account_id) then
    raise exception 'finance_adjustments_are_immutable';
  end if;
  return new;
end $$;
create or replace trigger finance_tx_guard before update or delete on public.transactions
  for each row execute function public.finance_i_tx_guard();

-- ================================================================ the single balance derivation

create or replace function public.finance_i_recompute(p_account uuid) returns void language plpgsql security definer set search_path=public as $$
declare a public.financial_accounts%rowtype; v_sum numeric; v_n integer; v_prev text := coalesce(current_setting('snk.finance_engine',true),'');
begin
  perform set_config('snk.finance_engine','1',true);
  select * into a from public.financial_accounts where id=p_account for update;
  if a.id is null or a.balance_confirmed_seq is null then perform set_config('snk.finance_engine',v_prev,true); return; end if;   -- never confirmed => stays UNKNOWN
  select coalesce(sum(
           case when t.account_id=a.id then (case t.type when 'income' then t.amount when 'expense' then -t.amount when 'transfer' then -t.amount else 0 end) else 0 end
         + case when t.type='transfer' and t.transfer_account_id=a.id then t.amount else 0 end),0), count(*)
    into v_sum, v_n
    from public.transactions t
   where t.owner_id=a.owner_id and t.seq>a.balance_confirmed_seq and t.archived_at is null and t.status='CONFIRMED'
     and t.type in ('income','expense','transfer') and (t.account_id=a.id or t.transfer_account_id=a.id);
  update public.financial_accounts
     set current_balance=a.balance_confirmed_amount+v_sum, balance_status=case when v_n>0 then 'DERIVED' else 'CONFIRMED' end
   where id=a.id;
  perform set_config('snk.finance_engine',v_prev,true);   -- hand the flag back exactly as found
end $$;

-- security definer: fires in the dashboard user's session, which may not call the (revoked) internal helpers
create or replace function public.finance_i_tx_recompute() returns trigger language plpgsql security definer set search_path=public as $$
declare v_ids uuid[]; v_id uuid;
begin
  if tg_op in ('INSERT','UPDATE') and new.type='adjustment' and (tg_op='INSERT' or old.type='adjustment') then return null; end if;
  v_ids := array(select distinct x from unnest(array[
      case when tg_op<>'INSERT' then old.account_id end, case when tg_op<>'INSERT' then old.transfer_account_id end,
      case when tg_op<>'DELETE' then new.account_id end, case when tg_op<>'DELETE' then new.transfer_account_id end]) x
    where x is not null order by x);                                    -- stable lock order
  foreach v_id in array v_ids loop perform public.finance_i_recompute(v_id); end loop;
  return null;
end $$;
create or replace trigger finance_tx_b_recompute after insert or update or delete on public.transactions
  for each row execute function public.finance_i_tx_recompute();

-- Rows written outside the engine (the dashboard UI) are still audited.  Trigger name sorts before the
-- recompute trigger, which flips the engine flag.
create or replace function public.finance_i_tx_audit() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if coalesce(current_setting('snk.finance_engine',true),'')='1' then return null; end if;
  insert into public.activity_log(owner_id,entity_type,entity_id,action,description,metadata)
  values(new.owner_id,'transaction',new.id,
    case when tg_op='INSERT' then 'TRANSACTION_CREATED'
         when new.archived_at is not null and old.archived_at is null then 'TRANSACTION_VOIDED' else 'TRANSACTION_EDITED' end,
    'dashboard edit',
    jsonb_build_object('domain','finance','channel','dashboard',
      'before',case when tg_op='UPDATE' then jsonb_build_object('type',old.type,'amount',old.amount,'account_id',old.account_id,'transfer_account_id',old.transfer_account_id,'occurred_at',old.occurred_at,'archived_at',old.archived_at,'category_id',old.category_id) else '{}'::jsonb end,
      'after',jsonb_build_object('type',new.type,'amount',new.amount,'account_id',new.account_id,'transfer_account_id',new.transfer_account_id,'occurred_at',new.occurred_at,'archived_at',new.archived_at,'category_id',new.category_id)));
  return null;
end $$;
create or replace trigger finance_tx_a_audit after insert or update on public.transactions
  for each row execute function public.finance_i_tx_audit();

-- ================================================================ internal helpers (no client can call these)

create or replace function public.finance_i_engine() returns void language sql set search_path=public as $$ select set_config('snk.finance_engine','1',true); $$;

create or replace function public.finance_i_active_group(p_owner uuid) returns text language sql stable set search_path=public as $$
  select group_id_hash from public.finance_channel_bindings where owner_id=p_owner and status='ACTIVE' limit 1;
$$;

create or replace function public.finance_i_audit(
  p_owner uuid, p_action text, p_entity_type text, p_entity_id uuid, p_actor text, p_message text,
  p_before jsonb, p_after jsonb, p_meta jsonb default '{}'::jsonb
) returns void language plpgsql set search_path=public as $$
begin
  insert into public.activity_log(owner_id,entity_type,entity_id,action,description,metadata)
  values(p_owner,p_entity_type,p_entity_id,p_action,p_action,
    jsonb_build_object('domain','finance','channel',coalesce(p_meta->>'channel','LINE'),'actor_hash',nullif(p_actor,''),
      'message_id',nullif(p_message,''),'group_hash',public.finance_i_active_group(p_owner),
      'before',coalesce(p_before,'{}'::jsonb),'after',coalesce(p_after,'{}'::jsonb),'meta',coalesce(p_meta,'{}'::jsonb)));
end $$;

create or replace function public.finance_i_idem_get(p_owner uuid, p_key text) returns jsonb language plpgsql set search_path=public as $$
declare v jsonb;
begin
  if p_key is null or length(trim(p_key))=0 then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text||':'||p_key,7));
  select result into v from public.finance_idempotency where owner_id=p_owner and key=p_key;
  if v is null then return null; end if;
  return v || jsonb_build_object('duplicate',true);
end $$;

create or replace function public.finance_i_idem_put(p_owner uuid, p_key text, p_result jsonb) returns jsonb language plpgsql set search_path=public as $$
begin
  if p_key is not null and length(trim(p_key))>0 then
    insert into public.finance_idempotency(owner_id,key,result) values(p_owner,p_key,p_result) on conflict (owner_id,key) do nothing;
  end if;
  return p_result;
end $$;

-- 'EXPENSE'/'INCOME' (any case) -> 'expense'/'income'; anything else -> null
create or replace function public.finance_i_dir(p text) returns text language sql immutable set search_path=public as $$
  select case lower(coalesce(p,'')) when 'expense' then 'expense' when 'income' then 'income' else null end;
$$;

create or replace function public.finance_i_ensure_category(p_owner uuid, p_name text, p_kind text, p_actor text, p_message text)
returns uuid language plpgsql set search_path=public as $$
declare v_id uuid; v_name text := left(trim(coalesce(p_name,'')),80); v_type text := coalesce(public.finance_i_dir(p_kind),'expense');
begin
  if length(v_name)=0 then return null; end if;
  select id into v_id from public.transaction_categories
   where owner_id=p_owner and lower(trim(name))=lower(v_name) and transaction_type=v_type and archived_at is null limit 1;
  if v_id is not null then return v_id; end if;
  insert into public.transaction_categories(owner_id,name,transaction_type) values(p_owner,v_name,v_type)
  on conflict (owner_id,name,transaction_type) do update set archived_at=null returning id into v_id;
  perform public.finance_i_audit(p_owner,'CATEGORY_CREATED','category',v_id,p_actor,p_message,'{}'::jsonb,jsonb_build_object('name',v_name,'type',v_type));
  return v_id;
end $$;

create or replace function public.finance_i_account_json(p_id uuid) returns jsonb language sql stable set search_path=public as $$
  select case when a.id is null then null else jsonb_build_object(
    'id',a.id,'name',a.name,'kind',upper(a.account_type),'balance',a.current_balance,'balance_status',a.balance_status,
    'balance_confirmed_at',a.balance_confirmed_at,'is_active',(a.is_active and a.archived_at is null)) end
  from (select 1) s left join public.financial_accounts a on a.id=p_id;
$$;

create or replace function public.finance_i_tx_json(p_id uuid) returns jsonb language sql stable set search_path=public as $$
  select case when t.id is null then null else jsonb_build_object(
    'id',t.id,'kind',upper(t.type),'status',t.status,'amount',t.amount,'occurred_on',t.occurred_on,
    'account_id',t.account_id,'account_name',a.name,'to_account_id',t.transfer_account_id,'to_account_name',b.name,
    'category_id',t.category_id,'category',coalesce(c.name,t.category),'payee',t.merchant,'note',t.notes,
    'obligation_id',t.obligation_id,'corrects_id',t.corrects_id,'replaced_by_id',t.replaced_by_id,
    'void_reason',t.void_reason,'slip_ref',t.slip_ref,'created_at',t.created_at) end
  from (select 1) s
  left join public.transactions t on t.id=p_id
  left join public.financial_accounts a on a.id=t.account_id
  left join public.financial_accounts b on b.id=t.transfer_account_id
  left join public.transaction_categories c on c.id=t.category_id;
$$;

create or replace function public.finance_i_freq_out(p text) returns text language sql immutable set search_path=public as $$
  select case p when 'once' then 'ONE_TIME' when 'custom_days' then 'CUSTOM_DAYS' else upper(p) end;
$$;
create or replace function public.finance_i_freq_in(p text) returns text language sql immutable set search_path=public as $$
  select case upper(coalesce(p,'')) when 'ONE_TIME' then 'once' when 'CUSTOM_DAYS' then 'custom_days' when 'INSTALLMENT' then 'installment'
    when 'WEEKLY' then 'weekly' when 'MONTHLY' then 'monthly' when 'YEARLY' then 'yearly' when 'DAILY' then 'daily' else null end;
$$;

create or replace function public.finance_i_obligation_json(p_id uuid) returns jsonb language sql stable set search_path=public as $$
  select case when o.id is null then null else jsonb_build_object(
    'id',o.id,'title',o.title,'kind',upper(o.type),'amount',o.amount,'frequency',public.finance_i_freq_out(o.frequency),'interval_days',o.interval_days,
    'day_of_month',o.due_day,'next_due_date',o.next_occurrence,'end_date',o.end_date,
    'installments_total',o.installments_total,'installments_paid',o.installments_paid,
    'default_account_id',o.account_id,'default_account_name',a.name,'category',c.name,
    'reminder_days',to_jsonb(o.reminder_days),'status',o.status,'note',o.notes) end
  from (select 1) s
  left join public.recurring_transactions o on o.id=p_id
  left join public.financial_accounts a on a.id=o.account_id
  left join public.transaction_categories c on c.id=o.category_id;
$$;

create or replace function public.finance_i_next_due(p_frequency text, p_cur date, p_interval integer, p_dom integer)
returns date language plpgsql immutable set search_path=public as $$
declare v_month date; v_last integer;
begin
  if p_frequency='daily' then return p_cur+1; end if;
  if p_frequency='weekly' then return p_cur+7; end if;
  if p_frequency='custom_days' then return p_cur+greatest(coalesce(p_interval,1),1); end if;
  if p_frequency in ('monthly','installment','yearly') then
    v_month := (date_trunc('month',p_cur)+case when p_frequency='yearly' then interval '12 months' else interval '1 month' end)::date;
    v_last := extract(day from (v_month+interval '1 month'-interval '1 day'))::integer;
    return v_month+(least(coalesce(p_dom,extract(day from p_cur)::integer),v_last)-1);
  end if;
  return null;
end $$;

-- The single posting routine every chat writer shares.  Balances are NOT touched here: the AFTER trigger
-- on transactions derives them, exactly as it does for rows written from the dashboard.
create or replace function public.finance_i_post_tx(
  p_owner uuid, p_kind text, p_amount numeric, p_account uuid, p_to_account uuid, p_category uuid, p_category_name text,
  p_payee text, p_note text, p_occurred_on date, p_actor text, p_message text, p_idem text,
  p_slip_ref text, p_file_hash text, p_obligation uuid, p_due_date date, p_corrects uuid, p_force_confirmed boolean default false
) returns public.transactions language plpgsql set search_path=public as $$
declare
  v_tx public.transactions%rowtype; v_type text := lower(coalesce(p_kind,'')); v_status text;
  v_first uuid; v_second uuid; v_day date := coalesce(p_occurred_on,timezone('Asia/Bangkok',now())::date);
  v_cat_name text;
begin
  perform public.finance_i_engine();
  if v_type not in ('expense','income','transfer') then raise exception 'invalid_transaction_kind'; end if;
  if p_amount is null or p_amount<=0 or p_amount>1000000000 then raise exception 'invalid_amount'; end if;
  if v_type='transfer' and (p_account is null or p_to_account is null) then raise exception 'transfer_requires_two_accounts'; end if;
  if v_type='transfer' and p_account=p_to_account then raise exception 'transfer_same_account'; end if;
  if p_account is not null and not exists(select 1 from public.financial_accounts where id=p_account and owner_id=p_owner and is_active and archived_at is null) then raise exception 'account_not_found'; end if;
  if p_to_account is not null and not exists(select 1 from public.financial_accounts where id=p_to_account and owner_id=p_owner and is_active and archived_at is null) then raise exception 'account_not_found'; end if;

  v_first := least(coalesce(p_account,p_to_account),coalesce(p_to_account,p_account));      -- stable lock order
  v_second := greatest(coalesce(p_account,p_to_account),coalesce(p_to_account,p_account));
  if v_first is not null then perform 1 from public.financial_accounts where id=v_first for update; end if;
  if v_second is not null and v_second<>v_first then perform 1 from public.financial_accounts where id=v_second for update; end if;

  v_status := case when v_type in ('expense','income') and p_account is null and not p_force_confirmed then 'PENDING_CLARIFICATION' else 'CONFIRMED' end;
  select name into v_cat_name from public.transaction_categories where id=p_category;

  insert into public.transactions(owner_id,type,status,amount,occurred_at,account_id,transfer_account_id,category_id,category,description,merchant,notes,
    obligation_id,obligation_due_date,corrects_id,slip_ref,file_hash,source_channel,source_message_id,source_group_hash,idem_key,created_by_hash)
  values(p_owner,v_type,v_status,p_amount,((v_day::timestamp+interval '12 hours') at time zone 'Asia/Bangkok'),p_account,p_to_account,p_category,v_cat_name,
    coalesce(nullif(left(trim(coalesce(p_payee,'')),180),''),v_cat_name),
    nullif(left(trim(coalesce(p_payee,'')),180),''),nullif(left(trim(coalesce(p_note,'')),1000),''),
    p_obligation,p_due_date,p_corrects,nullif(trim(coalesce(p_slip_ref,'')),''),nullif(trim(coalesce(p_file_hash,'')),''),
    'line',nullif(p_message,''),public.finance_i_active_group(p_owner),nullif(p_idem,''),nullif(p_actor,''))
  returning * into v_tx;

  perform public.finance_i_audit(p_owner,'TRANSACTION_CREATED','transaction',v_tx.id,p_actor,p_message,'{}'::jsonb,
    public.finance_i_tx_json(v_tx.id),jsonb_build_object('corrects',p_corrects));
  return v_tx;
end $$;

-- ================================================================ accounts API

create or replace function public.finance_create_account(p_owner uuid, p_name text, p_kind text, p_actor text, p_message text, p_idem text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_prev jsonb; v_id uuid; v_name text := left(trim(coalesce(p_name,'')),80); v_kind text := lower(coalesce(nullif(trim(p_kind),''),'bank'));
begin
  perform public.finance_i_engine();
  v_prev := public.finance_i_idem_get(p_owner,p_idem); if v_prev is not null then return v_prev; end if;
  if length(v_name)=0 then raise exception 'account_name_required'; end if;
  v_kind := case v_kind when 'savings' then 'bank' when 'pool' then 'other' else v_kind end;      -- UI account types
  if v_kind not in ('bank','cash','credit','wallet','other') then v_kind := 'other'; end if;
  select id into v_id from public.financial_accounts where owner_id=p_owner and lower(trim(name))=lower(v_name) and archived_at is null order by created_at limit 1;
  if v_id is not null then
    return public.finance_i_idem_put(p_owner,p_idem,jsonb_build_object('ok',true,'created',false,'account',public.finance_i_account_json(v_id)));
  end if;
  insert into public.financial_accounts(owner_id,name,account_type) values(p_owner,v_name,v_kind) returning id into v_id;
  perform public.finance_i_audit(p_owner,'ACCOUNT_CREATED','account',v_id,p_actor,p_message,'{}'::jsonb,public.finance_i_account_json(v_id));
  return public.finance_i_idem_put(p_owner,p_idem,jsonb_build_object('ok',true,'created',true,'account',public.finance_i_account_json(v_id)));
end $$;

create or replace function public.finance_create_category(p_owner uuid, p_name text, p_kind text, p_actor text, p_message text, p_idem text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_prev jsonb; v_id uuid; v_existed boolean; v_name text := left(trim(coalesce(p_name,'')),80); v_type text := coalesce(public.finance_i_dir(p_kind),'expense');
begin
  perform public.finance_i_engine();
  v_prev := public.finance_i_idem_get(p_owner,p_idem); if v_prev is not null then return v_prev; end if;
  if length(v_name)=0 then raise exception 'category_name_required'; end if;
  v_existed := exists(select 1 from public.transaction_categories where owner_id=p_owner and lower(trim(name))=lower(v_name) and transaction_type=v_type and archived_at is null);
  v_id := public.finance_i_ensure_category(p_owner,v_name,v_type,p_actor,p_message);
  return public.finance_i_idem_put(p_owner,p_idem,jsonb_build_object('ok',true,'created',not v_existed,
    'category',(select jsonb_build_object('id',id,'name',name,'kind',upper(transaction_type)) from public.transaction_categories where id=v_id)));
end $$;

create or replace function public.finance_get_accounts(p_owner uuid) returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'accounts',coalesce(jsonb_agg(public.finance_i_account_json(a.id) order by a.created_at),'[]'::jsonb),
    'known_total',coalesce(sum(a.current_balance) filter (where a.balance_status in ('CONFIRMED','DERIVED')),0),
    'known_count',count(*) filter (where a.balance_status in ('CONFIRMED','DERIVED')),
    'unknown_count',count(*) filter (where a.balance_status='UNKNOWN'))
  from public.financial_accounts a where a.owner_id=p_owner and a.is_active and a.archived_at is null;
$$;

create or replace function public.finance_get_balance(p_owner uuid, p_account uuid) returns jsonb language sql stable security definer set search_path=public as $$
  select coalesce((select public.finance_i_account_json(id) from public.financial_accounts where id=p_account and owner_id=p_owner),jsonb_build_object('error','account_not_found'));
$$;

-- Owner states the real balance.  The gap is recorded as an ADJUSTMENT (never a fabricated income/expense).
create or replace function public.finance_set_balance(p_owner uuid, p_account uuid, p_amount numeric, p_actor text, p_message text, p_idem text, p_note text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_prev jsonb; v_acc public.financial_accounts%rowtype; v_delta numeric; v_tx public.transactions%rowtype; v_before jsonb;
begin
  perform public.finance_i_engine();
  v_prev := public.finance_i_idem_get(p_owner,p_idem); if v_prev is not null then return v_prev; end if;
  if p_amount is null or abs(p_amount)>1000000000 then raise exception 'invalid_amount'; end if;
  select * into v_acc from public.financial_accounts where id=p_account and owner_id=p_owner and is_active and archived_at is null for update;
  if v_acc.id is null then raise exception 'account_not_found'; end if;
  v_before := public.finance_i_account_json(v_acc.id);
  v_delta := case when v_acc.current_balance is null then null else p_amount-v_acc.current_balance end;

  insert into public.transactions(owner_id,type,status,amount,account_id,description,notes,source_channel,source_message_id,source_group_hash,idem_key,created_by_hash,category)
  values(p_owner,'adjustment','CONFIRMED',abs(coalesce(v_delta,0)),v_acc.id,'OWNER_RECONCILIATION',nullif(left(trim(coalesce(p_note,'')),1000),''),
         'line',nullif(p_message,''),public.finance_i_active_group(p_owner),nullif(p_idem,''),nullif(p_actor,''),'OWNER_RECONCILIATION')
  returning * into v_tx;

  update public.financial_accounts
     set current_balance=p_amount, balance_status='CONFIRMED', balance_confirmed_at=now(), balance_confirmed_amount=p_amount, balance_confirmed_seq=v_tx.seq
   where id=v_acc.id;

  perform public.finance_i_audit(p_owner,case when v_acc.current_balance is null then 'BALANCE_SET' else 'BALANCE_ADJUSTED' end,'account',v_acc.id,p_actor,p_message,
    v_before,public.finance_i_account_json(v_acc.id),
    jsonb_build_object('delta',v_delta,'adjustment_tx',v_tx.id,'previous_status',v_acc.balance_status,'reason','OWNER_RECONCILIATION',
                       'previous_balance',v_acc.current_balance,'new_balance',p_amount));
  return public.finance_i_idem_put(p_owner,p_idem,jsonb_build_object('ok',true,'account',public.finance_i_account_json(v_acc.id),
    'previous_balance',v_acc.current_balance,'previous_status',v_acc.balance_status,'delta',v_delta,'adjustment_id',v_tx.id));
end $$;

-- ================================================================ transactions API

create or replace function public.finance_record_transaction(
  p_owner uuid, p_kind text, p_amount numeric, p_account uuid, p_to_account uuid, p_category_name text,
  p_payee text, p_note text, p_occurred_on date, p_actor text, p_message text, p_idem text,
  p_slip_ref text, p_file_hash text, p_unassigned_ok boolean default false
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_prev jsonb; v_cat uuid; v_tx public.transactions%rowtype; v_kind text := upper(coalesce(p_kind,''));
begin
  perform public.finance_i_engine();
  v_prev := public.finance_i_idem_get(p_owner,p_idem); if v_prev is not null then return v_prev; end if;
  v_cat := public.finance_i_ensure_category(p_owner,p_category_name,v_kind,p_actor,p_message);
  v_tx := public.finance_i_post_tx(p_owner,v_kind,p_amount,p_account,p_to_account,v_cat,p_category_name,p_payee,p_note,p_occurred_on,p_actor,p_message,p_idem,p_slip_ref,p_file_hash,null,null,null,coalesce(p_unassigned_ok,false));
  return public.finance_i_idem_put(p_owner,p_idem,jsonb_build_object('ok',true,'transaction',public.finance_i_tx_json(v_tx.id),
    'account',public.finance_i_account_json(v_tx.account_id),'to_account',public.finance_i_account_json(v_tx.transfer_account_id)));
end $$;

create or replace function public.finance_assign_account(p_owner uuid, p_tx uuid, p_account uuid, p_actor text, p_message text, p_idem text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_prev jsonb; v_tx public.transactions%rowtype; v_before jsonb;
begin
  perform public.finance_i_engine();
  v_prev := public.finance_i_idem_get(p_owner,p_idem); if v_prev is not null then return v_prev; end if;
  select * into v_tx from public.transactions where id=p_tx and owner_id=p_owner for update;
  if v_tx.id is null then return jsonb_build_object('ok',false,'error','transaction_not_found'); end if;
  if v_tx.status<>'PENDING_CLARIFICATION' then return jsonb_build_object('ok',false,'error','not_pending'); end if;
  if not exists(select 1 from public.financial_accounts where id=p_account and owner_id=p_owner and is_active and archived_at is null) then return jsonb_build_object('ok',false,'error','account_not_found'); end if;
  perform 1 from public.financial_accounts where id=p_account for update;
  v_before := public.finance_i_tx_json(v_tx.id);
  update public.transactions set account_id=p_account,status='CONFIRMED' where id=v_tx.id;     -- trigger derives the balance
  perform public.finance_i_audit(p_owner,'TRANSACTION_EDITED','transaction',v_tx.id,p_actor,p_message,v_before,public.finance_i_tx_json(v_tx.id),jsonb_build_object('edit','account_assigned'));
  return public.finance_i_idem_put(p_owner,p_idem,jsonb_build_object('ok',true,'transaction',public.finance_i_tx_json(v_tx.id),'account',public.finance_i_account_json(p_account)));
end $$;

create or replace function public.finance_confirm_unassigned(p_owner uuid, p_tx uuid, p_actor text, p_message text, p_idem text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_prev jsonb; v_tx public.transactions%rowtype; v_before jsonb;
begin
  perform public.finance_i_engine();
  v_prev := public.finance_i_idem_get(p_owner,p_idem); if v_prev is not null then return v_prev; end if;
  select * into v_tx from public.transactions where id=p_tx and owner_id=p_owner for update;
  if v_tx.id is null or v_tx.status<>'PENDING_CLARIFICATION' then return jsonb_build_object('ok',false,'error','not_pending'); end if;
  v_before := public.finance_i_tx_json(v_tx.id);
  update public.transactions set status='CONFIRMED' where id=v_tx.id;
  perform public.finance_i_audit(p_owner,'TRANSACTION_EDITED','transaction',v_tx.id,p_actor,p_message,v_before,public.finance_i_tx_json(v_tx.id),jsonb_build_object('edit','confirmed_unassigned'));
  return public.finance_i_idem_put(p_owner,p_idem,jsonb_build_object('ok',true,'transaction',public.finance_i_tx_json(v_tx.id)));
end $$;

create or replace function public.finance_void_transaction(p_owner uuid, p_tx uuid, p_reason text, p_actor text, p_message text, p_idem text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_prev jsonb; v_tx public.transactions%rowtype; v_before jsonb; v_acc public.financial_accounts%rowtype; v_rev jsonb := '{}'::jsonb;
begin
  perform public.finance_i_engine();
  v_prev := public.finance_i_idem_get(p_owner,p_idem); if v_prev is not null then return v_prev; end if;
  select * into v_tx from public.transactions where id=p_tx and owner_id=p_owner for update;
  if v_tx.id is null then return jsonb_build_object('ok',false,'error','transaction_not_found'); end if;
  if v_tx.status in ('VOIDED','REVERSED') then return jsonb_build_object('ok',false,'error','already_voided','transaction',public.finance_i_tx_json(v_tx.id)); end if;
  if v_tx.type='adjustment' then return jsonb_build_object('ok',false,'error','cannot_void_adjustment'); end if;
  v_before := public.finance_i_tx_json(v_tx.id);
  -- a movement recorded BEFORE the account's latest owner confirmation is already inside the confirmed figure
  if v_tx.account_id is not null then
    select * into v_acc from public.financial_accounts where id=v_tx.account_id;
    v_rev := jsonb_build_object('account_reversed',(v_acc.balance_confirmed_seq is not null and v_tx.seq>v_acc.balance_confirmed_seq and v_tx.status='CONFIRMED'));
    if v_acc.balance_confirmed_seq is not null and v_tx.seq<=v_acc.balance_confirmed_seq then v_rev := v_rev || jsonb_build_object('reason','confirmed_after'); end if;
  end if;
  update public.transactions set status='VOIDED',void_reason=left(coalesce(p_reason,''),400),voided_at=now(),archived_at=now() where id=v_tx.id;   -- trigger derives the balance
  if v_tx.obligation_id is not null and v_tx.obligation_due_date is not null then      -- a voided payment re-opens that due date
    delete from public.finance_obligation_payments where transaction_id=v_tx.id;
    update public.recurring_transactions set next_occurrence=least(coalesce(next_occurrence,v_tx.obligation_due_date),v_tx.obligation_due_date),
      installments_paid=greatest(installments_paid-1,0), status=case when status='COMPLETED' then 'ACTIVE' else status end
     where id=v_tx.obligation_id and owner_id=p_owner;
  end if;
  perform public.finance_i_audit(p_owner,'TRANSACTION_VOIDED','transaction',v_tx.id,p_actor,p_message,v_before,public.finance_i_tx_json(v_tx.id),jsonb_build_object('reason',p_reason,'reversal',v_rev));
  return public.finance_i_idem_put(p_owner,p_idem,jsonb_build_object('ok',true,'transaction',public.finance_i_tx_json(v_tx.id),'reversal',v_rev,
    'account',public.finance_i_account_json(v_tx.account_id),'to_account',public.finance_i_account_json(v_tx.transfer_account_id)));
end $$;

create or replace function public.finance_correct_transaction(
  p_owner uuid, p_tx uuid, p_kind text, p_amount numeric, p_account uuid, p_to_account uuid, p_category_name text,
  p_payee text, p_note text, p_occurred_on date, p_actor text, p_message text, p_idem text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_prev jsonb; v_old public.transactions%rowtype; v_new public.transactions%rowtype; v_cat uuid; v_before jsonb; v_kind text; v_catname text;
begin
  perform public.finance_i_engine();
  v_prev := public.finance_i_idem_get(p_owner,p_idem); if v_prev is not null then return v_prev; end if;
  select * into v_old from public.transactions where id=p_tx and owner_id=p_owner for update;
  if v_old.id is null then return jsonb_build_object('ok',false,'error','transaction_not_found'); end if;
  if v_old.status not in ('CONFIRMED','PENDING_CLARIFICATION') then return jsonb_build_object('ok',false,'error','already_voided'); end if;
  if v_old.type='adjustment' then return jsonb_build_object('ok',false,'error','cannot_correct_adjustment'); end if;
  v_before := public.finance_i_tx_json(v_old.id);
  v_kind := lower(coalesce(nullif(p_kind,''),v_old.type));
  if nullif(trim(coalesce(p_category_name,'')),'') is not null then
    v_cat := public.finance_i_ensure_category(p_owner,p_category_name,v_kind,p_actor,p_message); v_catname := p_category_name;
  else v_cat := v_old.category_id; end if;
  -- retire the original first (its idempotency/audit stay), then post the replacement; both effects are derived
  update public.transactions set status='REVERSED',voided_at=now(),void_reason='corrected',archived_at=now() where id=v_old.id;
  v_new := public.finance_i_post_tx(p_owner,v_kind,coalesce(p_amount,v_old.amount),coalesce(p_account,v_old.account_id),
      case when v_kind='transfer' then coalesce(p_to_account,v_old.transfer_account_id) else null end,
      v_cat,v_catname,coalesce(p_payee,v_old.merchant),coalesce(p_note,v_old.notes),coalesce(p_occurred_on,v_old.occurred_on),
      p_actor,p_message,p_idem,v_old.slip_ref,v_old.file_hash,v_old.obligation_id,v_old.obligation_due_date,v_old.id,false);
  update public.transactions set replaced_by_id=v_new.id where id=v_old.id;
  if v_old.obligation_id is not null then update public.finance_obligation_payments set transaction_id=v_new.id where transaction_id=v_old.id; end if;
  perform public.finance_i_audit(p_owner,'TRANSACTION_EDITED','transaction',v_old.id,p_actor,p_message,v_before,public.finance_i_tx_json(v_new.id),
    jsonb_build_object('replacement',v_new.id,'edit','correction'));
  return public.finance_i_idem_put(p_owner,p_idem,jsonb_build_object('ok',true,'original',public.finance_i_tx_json(v_old.id),'transaction',public.finance_i_tx_json(v_new.id),
    'account',public.finance_i_account_json(v_new.account_id),'to_account',public.finance_i_account_json(v_new.transfer_account_id)));
end $$;

create or replace function public.finance_update_transaction_meta(
  p_owner uuid, p_tx uuid, p_category_name text, p_note text, p_payee text, p_actor text, p_message text, p_idem text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_prev jsonb; v_tx public.transactions%rowtype; v_before jsonb; v_cat uuid; v_catname text;
begin
  perform public.finance_i_engine();
  v_prev := public.finance_i_idem_get(p_owner,p_idem); if v_prev is not null then return v_prev; end if;
  select * into v_tx from public.transactions where id=p_tx and owner_id=p_owner for update;
  if v_tx.id is null then return jsonb_build_object('ok',false,'error','transaction_not_found'); end if;
  if v_tx.status in ('VOIDED','REVERSED') then return jsonb_build_object('ok',false,'error','already_voided'); end if;
  v_before := public.finance_i_tx_json(v_tx.id);
  if nullif(trim(coalesce(p_category_name,'')),'') is not null then
    v_cat := public.finance_i_ensure_category(p_owner,p_category_name,case when v_tx.type in ('income','expense') then v_tx.type else 'expense' end,p_actor,p_message);
    v_catname := p_category_name;
  else v_cat := v_tx.category_id; v_catname := v_tx.category; end if;
  update public.transactions set category_id=v_cat,category=v_catname,
      notes=coalesce(nullif(left(trim(coalesce(p_note,'')),1000),''),notes),
      merchant=coalesce(nullif(left(trim(coalesce(p_payee,'')),180),''),merchant)
   where id=v_tx.id;
  perform public.finance_i_audit(p_owner,'TRANSACTION_EDITED','transaction',v_tx.id,p_actor,p_message,v_before,public.finance_i_tx_json(v_tx.id),jsonb_build_object('edit','meta'));
  return public.finance_i_idem_put(p_owner,p_idem,jsonb_build_object('ok',true,'transaction',public.finance_i_tx_json(v_tx.id)));
end $$;

create or replace function public.finance_get_recent_transactions(p_owner uuid, p_limit integer default 10, p_include_voided boolean default false)
returns jsonb language sql stable security definer set search_path=public as $$
  select coalesce(jsonb_agg(public.finance_i_tx_json(t.id) order by t.seq desc),'[]'::jsonb)
  from (select id,seq from public.transactions
         where owner_id=p_owner and (p_include_voided or status in ('CONFIRMED','PENDING_CLARIFICATION')) and (p_include_voided or archived_at is null)
         order by seq desc limit least(greatest(coalesce(p_limit,10),1),100)) t;
$$;

create or replace function public.finance_find_duplicate_slip(p_owner uuid, p_file_hash text, p_slip_ref text, p_amount numeric, p_date date, p_payee text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_id uuid; v_reason text;
begin
  if nullif(trim(coalesce(p_file_hash,'')),'') is not null then
    select id into v_id from public.transactions where owner_id=p_owner and file_hash=trim(p_file_hash) and archived_at is null and status in ('CONFIRMED','PENDING_CLARIFICATION') order by seq desc limit 1;
    if v_id is not null then v_reason := 'file_hash'; end if;
  end if;
  if v_id is null and nullif(trim(coalesce(p_slip_ref,'')),'') is not null then
    select id into v_id from public.transactions where owner_id=p_owner and slip_ref=trim(p_slip_ref) and archived_at is null and status in ('CONFIRMED','PENDING_CLARIFICATION') order by seq desc limit 1;
    if v_id is not null then v_reason := 'slip_ref'; end if;
  end if;
  if v_id is null and p_amount is not null and p_date is not null and nullif(trim(coalesce(p_payee,'')),'') is not null then
    select id into v_id from public.transactions
     where owner_id=p_owner and amount=p_amount and occurred_on=p_date and payee_key=lower(trim(p_payee)) and archived_at is null and status in ('CONFIRMED','PENDING_CLARIFICATION')
     order by seq desc limit 1;
    if v_id is not null then v_reason := 'amount_date_payee'; end if;
  end if;
  if v_id is null then return jsonb_build_object('duplicate',false); end if;
  return jsonb_build_object('duplicate',true,'reason',v_reason,'transaction',public.finance_i_tx_json(v_id));
end $$;

-- High-risk bulk action: the caller must already hold the owner's explicit confirmation.
create or replace function public.finance_count_range(p_owner uuid, p_from date, p_to date) returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object('count',count(*),'total',coalesce(sum(amount),0)) from public.transactions
   where owner_id=p_owner and occurred_on between p_from and p_to and type in ('income','expense','transfer') and status in ('CONFIRMED','PENDING_CLARIFICATION') and archived_at is null;
$$;

create or replace function public.finance_void_range(p_owner uuid, p_from date, p_to date, p_reason text, p_actor text, p_message text, p_idem text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_prev jsonb; r record; v_n integer := 0; v_res jsonb;
begin
  perform public.finance_i_engine();
  v_prev := public.finance_i_idem_get(p_owner,p_idem); if v_prev is not null then return v_prev; end if;
  for r in select id from public.transactions
            where owner_id=p_owner and occurred_on between p_from and p_to and type in ('income','expense','transfer') and status in ('CONFIRMED','PENDING_CLARIFICATION') and archived_at is null
            order by seq desc loop
    v_res := public.finance_void_transaction(p_owner,r.id,p_reason,p_actor,p_message,p_idem||':'||r.id::text);
    if (v_res->>'ok')::boolean then v_n := v_n+1; end if;
  end loop;
  perform public.finance_i_audit(p_owner,'TRANSACTION_VOIDED','transaction_range',null,p_actor,p_message,'{}'::jsonb,
    jsonb_build_object('voided',v_n,'from',p_from,'to',p_to),jsonb_build_object('reason',p_reason,'bulk',true));
  return public.finance_i_idem_put(p_owner,p_idem,jsonb_build_object('ok',true,'voided',v_n));
end $$;

-- ================================================================ obligations API (recurring_transactions)

create or replace function public.finance_create_obligation(
  p_owner uuid, p_title text, p_kind text, p_amount numeric, p_frequency text, p_interval_days integer, p_day_of_month integer,
  p_first_due date, p_end_date date, p_installments_total integer, p_default_account uuid, p_category_name text,
  p_reminder_days integer[], p_note text, p_actor text, p_message text, p_idem text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_prev jsonb; v_id uuid; v_type text := coalesce(public.finance_i_dir(nullif(p_kind,'')),'expense'); v_freq text := public.finance_i_freq_in(p_frequency);
  v_cat uuid; v_days integer[]; v_dom integer; v_title text := left(trim(coalesce(p_title,'')),160); v_set jsonb;
begin
  perform public.finance_i_engine();
  v_prev := public.finance_i_idem_get(p_owner,p_idem); if v_prev is not null then return v_prev; end if;
  if length(v_title)=0 then raise exception 'obligation_title_required'; end if;
  if p_kind is not null and p_kind<>'' and public.finance_i_dir(p_kind) is null then raise exception 'invalid_obligation_kind'; end if;
  if v_freq is null then raise exception 'invalid_frequency'; end if;
  if p_first_due is null then raise exception 'first_due_required'; end if;
  if p_amount is not null and (p_amount<=0 or p_amount>1000000000) then raise exception 'invalid_amount'; end if;
  if p_default_account is not null and not exists(select 1 from public.financial_accounts where id=p_default_account and owner_id=p_owner and archived_at is null) then raise exception 'account_not_found'; end if;

  select id into v_id from public.recurring_transactions
   where owner_id=p_owner and lower(trim(title))=lower(v_title) and frequency=v_freq and type=v_type and amount is not distinct from p_amount
     and status in ('ACTIVE','PAUSED') and archived_at is null order by created_at limit 1;
  if v_id is not null then
    return public.finance_i_idem_put(p_owner,p_idem,jsonb_build_object('ok',true,'created',false,'obligation',public.finance_i_obligation_json(v_id)));
  end if;

  select value into v_set from public.user_settings where owner_id=p_owner and key='finance.reminder_days';
  v_days := coalesce(p_reminder_days,case when v_set is not null and jsonb_typeof(v_set)='array' then array(select jsonb_array_elements_text(v_set)::integer) end);
  if v_days is null or cardinality(v_days)=0 then v_days := array[7,3,1,0]; end if;
  if exists(select 1 from unnest(v_days) d where d<0 or d>60) then raise exception 'invalid_reminder_days'; end if;
  v_dom := case when v_freq in ('monthly','installment','yearly') then coalesce(p_day_of_month,extract(day from p_first_due)::integer) else p_day_of_month end;
  v_cat := public.finance_i_ensure_category(p_owner,p_category_name,v_type,p_actor,p_message);

  insert into public.recurring_transactions(owner_id,title,type,amount,frequency,next_occurrence,due_day,interval_days,end_date,installments_total,
    account_id,category_id,reminder_days,notes,source)
  values(p_owner,v_title,v_type,p_amount,v_freq,p_first_due,v_dom,p_interval_days,p_end_date,p_installments_total,p_default_account,v_cat,v_days,
    nullif(left(trim(coalesce(p_note,'')),1000),''),'line')
  returning id into v_id;
  perform public.finance_i_audit(p_owner,'RECURRING_CREATED','obligation',v_id,p_actor,p_message,'{}'::jsonb,public.finance_i_obligation_json(v_id));
  return public.finance_i_idem_put(p_owner,p_idem,jsonb_build_object('ok',true,'created',true,'obligation',public.finance_i_obligation_json(v_id)));
end $$;

-- p_patch keys: title, amount, next_due_date, end_date, status, reminder_days, default_account_id, category, note, interval_days, day_of_month
create or replace function public.finance_update_obligation(p_owner uuid, p_id uuid, p_patch jsonb, p_actor text, p_message text, p_idem text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_prev jsonb; v_o public.recurring_transactions%rowtype; v_before jsonb; v_cat uuid; v_days integer[]; v_status text;
begin
  perform public.finance_i_engine();
  v_prev := public.finance_i_idem_get(p_owner,p_idem); if v_prev is not null then return v_prev; end if;
  select * into v_o from public.recurring_transactions where id=p_id and owner_id=p_owner for update;
  if v_o.id is null then return jsonb_build_object('ok',false,'error','obligation_not_found'); end if;
  v_before := public.finance_i_obligation_json(v_o.id);
  v_cat := case when p_patch ? 'category' then public.finance_i_ensure_category(p_owner,p_patch->>'category',v_o.type,p_actor,p_message) else v_o.category_id end;
  v_days := case when p_patch ? 'reminder_days' then array(select jsonb_array_elements_text(p_patch->'reminder_days')::integer) else v_o.reminder_days end;
  if exists(select 1 from unnest(v_days) d where d<0 or d>60) then raise exception 'invalid_reminder_days'; end if;
  v_status := coalesce(p_patch->>'status',v_o.status);
  if v_status not in ('ACTIVE','PAUSED','COMPLETED','CANCELLED') then raise exception 'invalid_status'; end if;
  update public.recurring_transactions set
    title=coalesce(nullif(left(trim(p_patch->>'title'),160),''),title),
    amount=case when p_patch ? 'amount' then nullif(p_patch->>'amount','')::numeric else amount end,
    next_occurrence=coalesce((p_patch->>'next_due_date')::date,next_occurrence),
    end_date=case when p_patch ? 'end_date' then nullif(p_patch->>'end_date','')::date else end_date end,
    status=v_status, is_active=(v_status='ACTIVE'),
    reminder_days=v_days,
    account_id=case when p_patch ? 'default_account_id' then nullif(p_patch->>'default_account_id','')::uuid else account_id end,
    category_id=v_cat,
    notes=case when p_patch ? 'note' then nullif(left(trim(p_patch->>'note'),1000),'') else notes end,
    interval_days=case when p_patch ? 'interval_days' then nullif(p_patch->>'interval_days','')::integer else interval_days end,
    due_day=case when p_patch ? 'day_of_month' then nullif(p_patch->>'day_of_month','')::integer else due_day end
   where id=v_o.id;
  perform public.finance_i_audit(p_owner,'RECURRING_EDITED','obligation',v_o.id,p_actor,p_message,v_before,public.finance_i_obligation_json(v_o.id));
  return public.finance_i_idem_put(p_owner,p_idem,jsonb_build_object('ok',true,'obligation',public.finance_i_obligation_json(v_o.id)));
end $$;

create or replace function public.finance_mark_due_paid(
  p_owner uuid, p_obligation uuid, p_account uuid, p_amount numeric, p_paid_on date, p_actor text, p_message text, p_idem text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_prev jsonb; v_o public.recurring_transactions%rowtype; v_acc uuid; v_amt numeric; v_tx public.transactions%rowtype;
  v_next date; v_paid integer; v_status text; v_before jsonb; v_day date := coalesce(p_paid_on,timezone('Asia/Bangkok',now())::date); v_due date;
begin
  perform public.finance_i_engine();
  v_prev := public.finance_i_idem_get(p_owner,p_idem); if v_prev is not null then return v_prev; end if;
  select * into v_o from public.recurring_transactions where id=p_obligation and owner_id=p_owner for update;
  if v_o.id is null then return jsonb_build_object('ok',false,'error','obligation_not_found'); end if;
  if v_o.status<>'ACTIVE' or not v_o.is_active or v_o.archived_at is not null then return jsonb_build_object('ok',false,'error','obligation_not_active','obligation',public.finance_i_obligation_json(v_o.id)); end if;
  v_due := v_o.next_occurrence;
  v_acc := coalesce(p_account,v_o.account_id);
  v_amt := coalesce(p_amount,v_o.amount);
  if v_amt is null then return jsonb_build_object('ok',false,'error','amount_required','obligation',public.finance_i_obligation_json(v_o.id)); end if;
  if v_acc is null then return jsonb_build_object('ok',false,'error','account_required','obligation',public.finance_i_obligation_json(v_o.id)); end if;
  if exists(select 1 from public.finance_obligation_payments where obligation_id=v_o.id and due_date=v_due) then
    return jsonb_build_object('ok',false,'error','already_paid','obligation',public.finance_i_obligation_json(v_o.id));
  end if;
  v_before := public.finance_i_obligation_json(v_o.id);
  v_tx := public.finance_i_post_tx(p_owner,v_o.type,v_amt,v_acc,null,v_o.category_id,null,v_o.title,'obligation:'||v_o.title,v_day,
          p_actor,p_message,p_idem,null,null,v_o.id,v_due,null,false);
  insert into public.finance_obligation_payments(owner_id,obligation_id,due_date,transaction_id,paid_on) values(p_owner,v_o.id,v_due,v_tx.id,v_day);

  v_paid := v_o.installments_paid+1;
  if v_o.frequency='once' then v_next := v_due; v_status := 'COMPLETED';
  else
    v_next := public.finance_i_next_due(v_o.frequency,v_due,v_o.interval_days,v_o.due_day);
    v_status := 'ACTIVE';
    if v_o.frequency='installment' and v_paid>=v_o.installments_total then v_status := 'COMPLETED'; end if;
    if v_o.end_date is not null and v_next>v_o.end_date then v_status := 'COMPLETED'; end if;
  end if;
  update public.recurring_transactions set next_occurrence=v_next,installments_paid=v_paid,status=v_status,is_active=(v_status='ACTIVE'),last_paid_at=now() where id=v_o.id;
  perform public.finance_i_audit(p_owner,'PAYMENT_MARKED_PAID','obligation',v_o.id,p_actor,p_message,v_before,public.finance_i_obligation_json(v_o.id),
    jsonb_build_object('transaction',v_tx.id,'paid_due_date',v_due));
  return public.finance_i_idem_put(p_owner,p_idem,jsonb_build_object('ok',true,'paid_due_date',v_due,'transaction',public.finance_i_tx_json(v_tx.id),
    'obligation',public.finance_i_obligation_json(v_o.id),'account',public.finance_i_account_json(v_acc)));
end $$;

create or replace function public.finance_list_upcoming(p_owner uuid, p_from date, p_to date, p_limit integer default 60)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  v_out jsonb := '[]'::jsonb; o public.recurring_transactions%rowtype; v_due date; v_n integer; v_paid integer;
  v_today date := coalesce(p_from,timezone('Asia/Bangkok',now())::date);
begin
  for o in select * from public.recurring_transactions
            where owner_id=p_owner and status='ACTIVE' and is_active and archived_at is null and next_occurrence is not null and next_occurrence<=p_to
            order by next_occurrence loop
    v_due := o.next_occurrence; v_n := 0; v_paid := o.installments_paid;
    while v_due<=p_to and v_n<24 loop
      if o.end_date is not null and v_due>o.end_date then exit; end if;
      if o.frequency='installment' and v_paid>=o.installments_total then exit; end if;
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'obligation_id',o.id,'title',o.title,'kind',upper(o.type),'amount',o.amount,'due_date',v_due,
        'days_until',v_due-v_today,'overdue',v_due<v_today,'frequency',public.finance_i_freq_out(o.frequency),
        'default_account_id',o.account_id,'projected',v_n>0));
      exit when o.frequency='once';
      v_due := public.finance_i_next_due(o.frequency,v_due,o.interval_days,o.due_day);
      v_n := v_n+1; v_paid := v_paid+1;
    end loop;
  end loop;
  return coalesce((select jsonb_agg(e order by (e->>'due_date'), (e->>'title')) from (select e from jsonb_array_elements(v_out) e limit least(greatest(coalesce(p_limit,60),1),300)) s),'[]'::jsonb);
end $$;

-- A forecast is labelled as one and never edits or replaces the current balance.
create or replace function public.finance_forecast(p_owner uuid, p_to date) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_items jsonb; v_out numeric; v_in numeric; v_known numeric; v_unknown integer; v_known_count integer; v_unknown_amt integer;
begin
  v_items := public.finance_list_upcoming(p_owner,timezone('Asia/Bangkok',now())::date,p_to,300);
  select coalesce(sum((e->>'amount')::numeric) filter (where e->>'kind'='EXPENSE'),0),
         coalesce(sum((e->>'amount')::numeric) filter (where e->>'kind'='INCOME'),0),
         count(*) filter (where e->>'amount' is null)
    into v_out,v_in,v_unknown_amt from jsonb_array_elements(v_items) e;
  select coalesce(sum(current_balance),0),count(*) filter (where balance_status='UNKNOWN'),count(*) filter (where balance_status<>'UNKNOWN')
    into v_known,v_unknown,v_known_count from public.financial_accounts where owner_id=p_owner and is_active and archived_at is null;
  return jsonb_build_object('forecast',true,'to',p_to,'known_balance_total',v_known,'known_account_count',v_known_count,
    'unknown_account_count',v_unknown,'upcoming_outflow',v_out,'upcoming_inflow',v_in,'items_without_amount',v_unknown_amt,
    'projected_known_balance',v_known+v_in-v_out,'partial',(v_unknown>0 or v_unknown_amt>0),'items',v_items);
end $$;

create or replace function public.finance_get_summary(p_owner uuid, p_from date, p_to date) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_income numeric; v_expense numeric; v_cnt integer; v_pending integer; v_cats jsonb;
begin
  select coalesce(sum(amount) filter (where type='income'),0),coalesce(sum(amount) filter (where type='expense'),0),count(*)
    into v_income,v_expense,v_cnt
    from public.transactions where owner_id=p_owner and occurred_on between p_from and p_to and type in ('income','expense') and archived_at is null and status in ('CONFIRMED','PENDING_CLARIFICATION');
  select count(*) into v_pending from public.transactions where owner_id=p_owner and status='PENDING_CLARIFICATION' and archived_at is null;
  select coalesce(jsonb_agg(jsonb_build_object('category',coalesce(x.cname,'ไม่ระบุหมวด'),'kind',upper(x.type),'total',x.total) order by x.total desc),'[]'::jsonb) into v_cats
    from (select coalesce(c.name,t.category) cname,t.type,sum(t.amount) total from public.transactions t left join public.transaction_categories c on c.id=t.category_id
           where t.owner_id=p_owner and t.occurred_on between p_from and p_to and t.type in ('income','expense') and t.archived_at is null and t.status in ('CONFIRMED','PENDING_CLARIFICATION')
           group by 1,2) x;
  return jsonb_build_object('from',p_from,'to',p_to,'income',v_income,'expense',v_expense,'net',v_income-v_expense,
    'transaction_count',v_cnt,'pending_clarification_count',v_pending,'by_category',v_cats);
end $$;

-- ================================================================ reminders

create or replace function public.finance_claim_reminders(p_owner uuid, p_today date, p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  o public.recurring_transactions%rowtype; v_until integer; v_thr integer; v_row public.finance_reminder_deliveries%rowtype;
  v_out jsonb := '[]'::jsonb; v_n integer := 0;
begin
  perform public.finance_i_engine();
  for o in select * from public.recurring_transactions
            where owner_id=p_owner and status='ACTIVE' and is_active and archived_at is null and next_occurrence is not null
            order by next_occurrence for update skip locked loop
    exit when v_n>=p_limit;
    continue when cardinality(o.reminder_days)=0;                 -- owner turned reminders off for this item
    v_until := o.next_occurrence-p_today;
    if v_until<0 then
      continue when v_until<-7;                                   -- overdue nags stop after a week
      v_thr := v_until;
    else
      select min(d) into v_thr from unnest(o.reminder_days) d where d>=v_until;
      continue when v_thr is null;
    end if;
    if exists(select 1 from public.finance_obligation_payments where obligation_id=o.id and due_date=o.next_occurrence) then continue; end if;
    v_row := null;
    insert into public.finance_reminder_deliveries(owner_id,obligation_id,due_date,days_before) values(p_owner,o.id,o.next_occurrence,v_thr)
    on conflict (obligation_id,due_date,days_before) do nothing returning * into v_row;
    if v_row.id is null then
      update public.finance_reminder_deliveries set status='CLAIMED',attempts=attempts+1,claimed_at=now()
       where obligation_id=o.id and due_date=o.next_occurrence and days_before=v_thr and attempts<3
         and ((status='FAILED') or (status='CLAIMED' and claimed_at<now()-interval '15 minutes'))
       returning * into v_row;
    end if;
    if v_row.id is null then continue; end if;
    v_n := v_n+1;
    v_out := v_out || jsonb_build_array(jsonb_build_object('delivery_id',v_row.id,'obligation_id',o.id,'title',o.title,'kind',upper(o.type),
      'amount',o.amount,'due_date',o.next_occurrence,'days_until',v_until,'threshold',v_thr,'overdue',v_until<0,
      'default_account',(select name from public.financial_accounts where id=o.account_id)));
  end loop;
  return v_out;
end $$;

create or replace function public.finance_finish_reminder(p_owner uuid, p_delivery uuid, p_ok boolean, p_error text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_row public.finance_reminder_deliveries%rowtype;
begin
  perform public.finance_i_engine();
  update public.finance_reminder_deliveries
     set status=case when p_ok then 'SENT' else 'FAILED' end,
         sent_at=case when p_ok then now() else sent_at end,
         last_error=case when p_ok then null else left(coalesce(p_error,'unknown'),300) end
   where id=p_delivery and owner_id=p_owner returning * into v_row;
  if v_row.id is null then return jsonb_build_object('ok',false,'error','delivery_not_found'); end if;
  perform public.finance_i_audit(p_owner,case when p_ok then 'REMINDER_SENT' else 'REMINDER_FAILED' end,'obligation',v_row.obligation_id,null,null,'{}'::jsonb,
    jsonb_build_object('due_date',v_row.due_date,'days_before',v_row.days_before,'attempts',v_row.attempts),jsonb_build_object('error',p_error));
  return jsonb_build_object('ok',true,'status',v_row.status);
end $$;

-- ================================================================ conversation state, audit entry point, settings

create or replace function public.finance_pending_set(p_owner uuid, p_actor text, p_kind text, p_payload jsonb, p_ttl_minutes integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  update public.finance_pending_states set resolved_at=now() where owner_id=p_owner and actor_hash=p_actor and resolved_at is null;
  insert into public.finance_pending_states(owner_id,actor_hash,kind,payload,expires_at)
  values(p_owner,p_actor,p_kind,coalesce(p_payload,'{}'::jsonb),now()+make_interval(mins=>least(greatest(coalesce(p_ttl_minutes,15),1),240)))
  returning id into v_id;
  return jsonb_build_object('ok',true,'id',v_id);
end $$;

create or replace function public.finance_pending_get(p_owner uuid, p_actor text) returns jsonb language sql stable security definer set search_path=public as $$
  select coalesce((select jsonb_build_object('id',id,'kind',kind,'payload',payload,'expires_at',expires_at)
    from public.finance_pending_states where owner_id=p_owner and actor_hash=p_actor and resolved_at is null and expires_at>now() order by created_at desc limit 1),'null'::jsonb);
$$;

create or replace function public.finance_pending_clear(p_owner uuid, p_actor text) returns jsonb language plpgsql security definer set search_path=public as $$
begin
  update public.finance_pending_states set resolved_at=now() where owner_id=p_owner and actor_hash=p_actor and resolved_at is null;
  return jsonb_build_object('ok',true);
end $$;

create or replace function public.finance_log_audit(p_owner uuid, p_action text, p_entity_type text, p_entity_id text, p_actor text, p_message text, p_meta jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  perform public.finance_i_audit(p_owner,p_action,p_entity_type,case when p_entity_id ~* '^[0-9a-f-]{36}$' then p_entity_id::uuid end,p_actor,p_message,'{}'::jsonb,'{}'::jsonb,coalesce(p_meta,'{}'::jsonb));
  return jsonb_build_object('ok',true);
end $$;

create or replace function public.finance_get_settings(p_owner uuid) returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object('reminder_days',coalesce((select value from public.user_settings where owner_id=p_owner and key='finance.reminder_days'),'[7,3,1,0]'::jsonb),'timezone','"Asia/Bangkok"'::jsonb);
$$;

create or replace function public.finance_set_reminder_days(p_owner uuid, p_days integer[], p_actor text, p_message text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_old jsonb;
begin
  perform public.finance_i_engine();
  if p_days is null or cardinality(p_days)=0 or exists(select 1 from unnest(p_days) d where d<0 or d>60) then raise exception 'invalid_reminder_days'; end if;
  select value into v_old from public.user_settings where owner_id=p_owner and key='finance.reminder_days';
  insert into public.user_settings(owner_id,key,value) values(p_owner,'finance.reminder_days',to_jsonb(p_days))
  on conflict (owner_id,key) do update set value=excluded.value,updated_at=now();
  perform public.finance_i_audit(p_owner,'PERMISSION_CHANGED','settings',null,p_actor,p_message,jsonb_build_object('reminder_days',v_old),jsonb_build_object('reminder_days',to_jsonb(p_days)),jsonb_build_object('setting','finance.reminder_days'));
  return jsonb_build_object('ok',true,'reminder_days',p_days);
end $$;

-- ================================================================ channel binding API

create or replace function public.finance_binding_lookup(p_owner uuid, p_group_hash text) returns jsonb language sql stable security definer set search_path=public as $$
  select coalesce((select jsonb_build_object('id',id,'status',status,'failed_attempts',failed_attempts,'has_code',code_hash is not null,
    'other_group_active',exists(select 1 from public.finance_channel_bindings x where x.owner_id=p_owner and x.status='ACTIVE' and x.group_id_hash<>p_group_hash))
    from public.finance_channel_bindings where group_id_hash=p_group_hash and status in ('PENDING','ACTIVE') limit 1),
    jsonb_build_object('status','NONE','other_group_active',exists(select 1 from public.finance_channel_bindings x where x.owner_id=p_owner and x.status='ACTIVE')));
$$;

-- A join event is only ever captured as PENDING; capturing grants no permission.
create or replace function public.finance_binding_capture(p_owner uuid, p_group_hash text, p_group_enc text, p_event_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_row public.finance_channel_bindings%rowtype;
begin
  perform public.finance_i_engine();
  if nullif(trim(coalesce(p_group_hash,'')),'') is null then raise exception 'group_hash_required'; end if;
  select * into v_row from public.finance_channel_bindings where group_id_hash=p_group_hash and status in ('PENDING','ACTIVE');
  if v_row.id is not null then return jsonb_build_object('ok',true,'created',false,'status',v_row.status); end if;
  insert into public.finance_channel_bindings(owner_id,group_id_hash,group_id_enc,captured_by_event) values(p_owner,p_group_hash,p_group_enc,p_event_id) returning * into v_row;
  perform public.finance_i_audit(p_owner,'GROUP_PENDING','binding',v_row.id,null,p_event_id,'{}'::jsonb,jsonb_build_object('status','PENDING'));
  return jsonb_build_object('ok',true,'created',true,'status','PENDING');
end $$;

-- Operator-side only: mint a one-time code for a pending group (hash stored, plaintext shown once).
create or replace function public.finance_binding_issue_code(p_owner uuid, p_group_hash text, p_ttl_minutes integer default 30)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_code text; v_row public.finance_channel_bindings%rowtype;
begin
  select * into v_row from public.finance_channel_bindings where owner_id=p_owner and group_id_hash=p_group_hash and status='PENDING' for update;
  if v_row.id is null then return jsonb_build_object('ok',false,'error','no_pending_binding'); end if;
  v_code := 'SNK-'||lpad((('x'||substr(replace(gen_random_uuid()::text,'-',''),1,8))::bit(32)::bigint % 1000000)::text,6,'0');   -- CSPRNG-derived
  update public.finance_channel_bindings set code_hash=encode(sha256(convert_to(v_code,'utf8')),'hex'),
    code_expires_at=now()+make_interval(mins=>least(greatest(p_ttl_minutes,1),240)),failed_attempts=0,updated_at=now() where id=v_row.id;
  perform public.finance_i_engine();
  perform public.finance_i_audit(p_owner,'GROUP_CODE_ISSUED','binding',v_row.id,null,null,'{}'::jsonb,'{}'::jsonb);
  return jsonb_build_object('ok',true,'code',v_code);
end $$;

create or replace function public.finance_binding_activate(p_owner uuid, p_group_hash text, p_actor text, p_owner_verified boolean, p_code text, p_group_name text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_row public.finance_channel_bindings%rowtype; v_ok boolean := false; v_how text;
begin
  perform public.finance_i_engine();
  select * into v_row from public.finance_channel_bindings where owner_id=p_owner and group_id_hash=p_group_hash and status in ('PENDING','ACTIVE') for update;
  if v_row.id is null then return jsonb_build_object('ok',false,'error','no_pending_binding'); end if;
  if v_row.status='ACTIVE' then return jsonb_build_object('ok',true,'already_active',true); end if;
  if exists(select 1 from public.finance_channel_bindings where owner_id=p_owner and status='ACTIVE') then
    perform public.finance_i_audit(p_owner,'GROUP_BIND_REJECTED','binding',v_row.id,p_actor,null,'{}'::jsonb,'{}'::jsonb,jsonb_build_object('reason','another_group_active'));
    return jsonb_build_object('ok',false,'error','another_group_active');
  end if;
  if v_row.failed_attempts>=5 then return jsonb_build_object('ok',false,'error','locked'); end if;
  if coalesce(p_owner_verified,false) then v_ok := true; v_how := 'owner_user';
  elsif nullif(trim(coalesce(p_code,'')),'') is not null and v_row.code_hash is not null and v_row.code_expires_at>now()
        and v_row.code_hash=encode(sha256(convert_to(upper(trim(p_code)),'utf8')),'hex') then v_ok := true; v_how := 'one_time_code';
  end if;
  if not v_ok then
    update public.finance_channel_bindings set failed_attempts=failed_attempts+1,updated_at=now() where id=v_row.id;
    perform public.finance_i_audit(p_owner,'GROUP_BIND_REJECTED','binding',v_row.id,p_actor,null,'{}'::jsonb,'{}'::jsonb,jsonb_build_object('reason','not_verified'));
    return jsonb_build_object('ok',false,'error','not_verified');
  end if;
  update public.finance_channel_bindings set status='ACTIVE',verified_by_hash=nullif(p_actor,''),verified_at=now(),bound_at=now(),
    group_name=nullif(left(trim(coalesce(p_group_name,'')),120),''),code_hash=null,code_expires_at=null,updated_at=now() where id=v_row.id;
  perform public.finance_i_audit(p_owner,'GROUP_BOUND','binding',v_row.id,p_actor,null,jsonb_build_object('status','PENDING'),jsonb_build_object('status','ACTIVE'),jsonb_build_object('method',v_how));
  return jsonb_build_object('ok',true,'method',v_how);
end $$;

create or replace function public.finance_binding_revoke(p_owner uuid, p_group_hash text, p_actor text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_row public.finance_channel_bindings%rowtype;
begin
  perform public.finance_i_engine();
  update public.finance_channel_bindings set status='REVOKED',revoked_at=now(),updated_at=now()
   where owner_id=p_owner and group_id_hash=p_group_hash and status in ('PENDING','ACTIVE') returning * into v_row;
  if v_row.id is null then return jsonb_build_object('ok',false,'error','no_binding'); end if;
  perform public.finance_i_audit(p_owner,'GROUP_UNBOUND','binding',v_row.id,p_actor,null,'{}'::jsonb,jsonb_build_object('status','REVOKED'));
  return jsonb_build_object('ok',true);
end $$;

-- The only place reminders may be delivered: the single ACTIVE verified group.
create or replace function public.finance_binding_active_target(p_owner uuid) returns jsonb language sql stable security definer set search_path=public as $$
  select coalesce((select jsonb_build_object('id',id,'group_id_enc',group_id_enc,'group_id_hash',group_id_hash)
    from public.finance_channel_bindings where owner_id=p_owner and status='ACTIVE' limit 1),'null'::jsonb);
$$;

-- ================================================================ dashboard views (owner-scoped through RLS)

create or replace view public.finance_account_balances_v1 with (security_invoker=true) as
select a.id,a.owner_id,a.name,a.account_type,a.currency,a.current_balance,a.balance_status,a.balance_confirmed_at,
       (a.balance_status='UNKNOWN') as is_unknown
  from public.financial_accounts a where a.is_active and a.archived_at is null;

create or replace view public.finance_month_cashflow_v1 with (security_invoker=true) as
select t.owner_id,date_trunc('month',t.occurred_on)::date as month,
       coalesce(sum(t.amount) filter (where t.type='income'),0) as income,
       coalesce(sum(t.amount) filter (where t.type='expense'),0) as expense,
       coalesce(sum(t.amount) filter (where t.type='income'),0)-coalesce(sum(t.amount) filter (where t.type='expense'),0) as net,
       count(*) filter (where t.status='PENDING_CLARIFICATION') as pending_clarification
  from public.transactions t
 where t.type in ('income','expense') and t.archived_at is null and t.status in ('CONFIRMED','PENDING_CLARIFICATION')
 group by 1,2;

create or replace view public.finance_upcoming_v1 with (security_invoker=true) as
select o.id,o.owner_id,o.title,o.type,o.amount,o.frequency,o.next_occurrence as due_date,
       (o.next_occurrence-timezone('Asia/Bangkok',now())::date) as days_until,
       (o.next_occurrence<timezone('Asia/Bangkok',now())::date) as overdue,
       a.name as account_name,o.installments_paid,o.installments_total
  from public.recurring_transactions o left join public.financial_accounts a on a.id=o.account_id
 where o.status='ACTIVE' and o.is_active and o.archived_at is null and o.next_occurrence is not null;

create or replace view public.finance_recent_transactions_v1 with (security_invoker=true) as
select t.id,t.owner_id,t.seq,t.type,t.status,t.amount,t.occurred_at,t.occurred_on,a.name as account_name,b.name as to_account_name,
       coalesce(c.name,t.category) as category,t.merchant,t.description,t.created_at
  from public.transactions t
  left join public.financial_accounts a on a.id=t.account_id
  left join public.financial_accounts b on b.id=t.transfer_account_id
  left join public.transaction_categories c on c.id=t.category_id
 where t.archived_at is null and t.status in ('CONFIRMED','PENDING_CLARIFICATION');

-- ================================================================ RLS + grants for the new tables

do $$
declare t text;
begin
  foreach t in array array['finance_obligation_payments','finance_reminder_deliveries','finance_idempotency','finance_pending_states','finance_channel_bindings'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select on public.%I to service_role',t);   -- writes only through the RPCs
  end loop;
  -- the owner may READ (never write) payments, reminder history and the group binding from the dashboard
  foreach t in array array['finance_obligation_payments','finance_reminder_deliveries','finance_channel_bindings'] loop
    execute format('grant select on public.%I to authenticated',t);
    execute format('create policy %I on public.%I for select to authenticated using (owner_id = auth.uid())',t||'_owner_read',t);
  end loop;
  foreach t in array array['finance_idempotency','finance_pending_states'] loop
    execute format('create policy %I on public.%I as restrictive for all to public using (false) with check (false)',t||'_no_client_access',t);
  end loop;
end $$;

revoke all on public.finance_account_balances_v1,public.finance_month_cashflow_v1,public.finance_upcoming_v1,public.finance_recent_transactions_v1 from public,anon;
grant select on public.finance_account_balances_v1,public.finance_month_cashflow_v1,public.finance_upcoming_v1,public.finance_recent_transactions_v1 to authenticated,service_role;

-- Public RPCs: service_role only.  Internal helpers (finance_i_*) and trigger functions: nobody.
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
            where n.nspname='public' and p.proname like 'finance\_%' loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',r.sig);
    if r.proname not like 'finance\_i\_%' then
      execute format('grant execute on function %s to service_role',r.sig);
    end if;
  end loop;
end $$;
