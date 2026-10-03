-- WW-5 Global Payment Core
-- Provider-neutral global payment intent/event infrastructure.
-- Existing domestic payment_requests + owner PromptPay remain untouched.

create table if not exists public.commerce_payment_providers (
  provider_code text primary key
    check (provider_code ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
  display_name text not null
    check (char_length(display_name) between 1 and 120),
  adapter_key text not null unique
    check (adapter_key ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
  status text not null default 'draft'
    check (status in ('draft','certification','live','suspended')),
  active boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.commerce_market_payment_methods (
  market_code text not null
    references public.commerce_markets(market_code) on delete cascade,
  provider_code text not null
    references public.commerce_payment_providers(provider_code),
  currency_code text not null
    references public.commerce_currencies(currency_code),
  payment_method_code text not null
    check (payment_method_code ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
  execution_mode text not null
    check (execution_mode in ('legacy_v1','global_v2')),
  status text not null default 'draft'
    check (status in ('draft','certification','live','suspended')),
  enabled boolean not null default false,
  priority integer not null default 100
    check (priority between 0 and 10000),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (market_code,provider_code,currency_code,payment_method_code)
);

create index if not exists commerce_market_payment_methods_provider_idx
  on public.commerce_market_payment_methods(provider_code,status,enabled);
create index if not exists commerce_market_payment_methods_currency_idx
  on public.commerce_market_payment_methods(currency_code,status,enabled);

alter table public.commerce_payment_providers enable row level security;
alter table public.commerce_market_payment_methods enable row level security;
revoke all on table public.commerce_payment_providers from public,anon,authenticated,service_role;
revoke all on table public.commerce_market_payment_methods from public,anon,authenticated,service_role;
grant select,insert,update,delete on table public.commerce_payment_providers to service_role;
grant select,insert,update,delete on table public.commerce_market_payment_methods to service_role;

insert into public.commerce_payment_providers(
  provider_code,display_name,adapter_key,status,active,metadata
) values (
  'legacy_promptpay_owner',
  'Owner PromptPay QR (legacy v1)',
  'legacy_promptpay_v1',
  'live',
  true,
  jsonb_build_object(
    'execution_owner','payment_requests',
    'credential_storage','existing_server_configuration',
    'ww5_global_v2_eligible',false
  )
)
on conflict (provider_code) do update set
  display_name=excluded.display_name,
  adapter_key=excluded.adapter_key,
  status=excluded.status,
  active=excluded.active,
  metadata=excluded.metadata,
  updated_at=now();

insert into public.commerce_market_payment_methods(
  market_code,provider_code,currency_code,payment_method_code,
  execution_mode,status,enabled,priority,metadata
) values (
  'TH','legacy_promptpay_owner','THB','promptpay_owner_qr',
  'legacy_v1','live',true,0,
  jsonb_build_object(
    'transaction_engine','payment_requests',
    'global_v2_intent_creation',false
  )
)
on conflict (market_code,provider_code,currency_code,payment_method_code)
do update set
  execution_mode=excluded.execution_mode,
  status=excluded.status,
  enabled=excluded.enabled,
  priority=excluded.priority,
  metadata=excluded.metadata,
  updated_at=now();

create table if not exists public.commerce_payment_intents (
  id uuid primary key default gen_random_uuid(),
  intent_code text not null unique default (
    'PI-' || to_char(now(),'YYMMDD') || '-' ||
    upper(substr(replace(gen_random_uuid()::text,'-',''),1,8))
  ),
  source_entity_type text not null
    check (source_entity_type ~ '^[a-z][a-z0-9_]{1,63}$'),
  source_entity_id uuid not null,
  source_entity_code text not null
    check (char_length(source_entity_code) between 1 and 120),
  customer_id uuid null
    references public.customer_accounts(id) on delete set null,
  market_code text not null
    references public.commerce_markets(market_code),
  currency_code text not null
    references public.commerce_currencies(currency_code),
  amount_minor bigint not null
    check (amount_minor > 0),
  captured_amount_minor bigint not null default 0
    check (captured_amount_minor >= 0),
  refunded_amount_minor bigint not null default 0
    check (refunded_amount_minor >= 0),
  provider_code text not null,
  payment_method_code text not null,
  execution_mode text not null default 'global_v2'
    check (execution_mode='global_v2'),
  status text not null default 'created'
    check (status in (
      'created','requires_action','processing','authorized','captured',
      'failed','cancelled','partially_refunded','refunded'
    )),
  provider_intent_id text null
    check (provider_intent_id is null or char_length(provider_intent_id) between 1 and 240),
  idempotency_key text not null unique
    check (
      char_length(idempotency_key) between 16 and 120
      and idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9:_-]{15,119}$'
    ),
  environment text not null default 'live'
    check (environment in ('live','test')),
  authorized_at timestamptz null,
  captured_at timestamptz null,
  failed_at timestamptz null,
  cancelled_at timestamptz null,
  refunded_at timestamptz null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (
    market_code,provider_code,currency_code,payment_method_code
  ) references public.commerce_market_payment_methods(
    market_code,provider_code,currency_code,payment_method_code
  ),
  check (captured_amount_minor <= amount_minor),
  check (refunded_amount_minor <= captured_amount_minor)
);

create unique index if not exists commerce_payment_intents_provider_intent_uq
  on public.commerce_payment_intents(provider_code,provider_intent_id)
  where provider_intent_id is not null;
create index if not exists commerce_payment_intents_source_idx
  on public.commerce_payment_intents(source_entity_type,source_entity_id,created_at desc);
create index if not exists commerce_payment_intents_customer_idx
  on public.commerce_payment_intents(customer_id,created_at desc)
  where customer_id is not null;
create index if not exists commerce_payment_intents_status_idx
  on public.commerce_payment_intents(environment,status,created_at desc);

alter table public.commerce_payment_intents enable row level security;
revoke all on table public.commerce_payment_intents from public,anon,authenticated,service_role;
grant select,insert,update,delete on table public.commerce_payment_intents to service_role;

create table if not exists public.commerce_payment_events (
  id bigint generated by default as identity primary key,
  provider_code text not null
    references public.commerce_payment_providers(provider_code),
  provider_event_id text not null
    check (char_length(provider_event_id) between 1 and 240),
  event_type text not null
    check (
      char_length(event_type) between 1 and 120
      and event_type ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'
    ),
  provider_object_id text null
    check (provider_object_id is null or char_length(provider_object_id) between 1 and 240),
  currency_code text null
    references public.commerce_currencies(currency_code),
  amount_minor bigint null
    check (amount_minor is null or amount_minor > 0),
  money_semantics text not null default 'none'
    check (money_semantics in ('none','intent_total','refund_delta')),
  signature_verified boolean not null default false,
  payload_sha256 text not null
    check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  processing_status text not null default 'received'
    check (processing_status in ('received','processed','rejected')),
  intent_id uuid null
    references public.commerce_payment_intents(id) on delete set null,
  applied_status text null
    check (
      applied_status is null
      or applied_status in (
        'created','requires_action','processing','authorized','captured',
        'failed','cancelled','partially_refunded','refunded'
      )
    ),
  metadata jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz null,
  unique (provider_code,provider_event_id),
  check (
    (money_semantics='none' and currency_code is null and amount_minor is null)
    or
    (money_semantics in ('intent_total','refund_delta')
      and currency_code is not null and amount_minor is not null)
  )
);

create index if not exists commerce_payment_events_intent_idx
  on public.commerce_payment_events(intent_id,received_at desc)
  where intent_id is not null;
create index if not exists commerce_payment_events_processing_idx
  on public.commerce_payment_events(processing_status,received_at asc);

alter table public.commerce_payment_events enable row level security;
revoke all on table public.commerce_payment_events from public,anon,authenticated,service_role;
revoke all on sequence public.commerce_payment_events_id_seq from public,anon,authenticated,service_role;
grant select,insert,update,delete on table public.commerce_payment_events to service_role;
grant usage,select on sequence public.commerce_payment_events_id_seq to service_role;

create or replace function public.commerce_payment_intent_update_guard()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if old.source_entity_type is distinct from new.source_entity_type
     or old.source_entity_id is distinct from new.source_entity_id
     or old.source_entity_code is distinct from new.source_entity_code
     or old.market_code is distinct from new.market_code
     or old.currency_code is distinct from new.currency_code
     or old.amount_minor is distinct from new.amount_minor
     or old.provider_code is distinct from new.provider_code
     or old.payment_method_code is distinct from new.payment_method_code
     or old.execution_mode is distinct from new.execution_mode
     or old.idempotency_key is distinct from new.idempotency_key
     or old.environment is distinct from new.environment then
    raise exception 'payment_intent_immutable_field';
  end if;

  if old.provider_intent_id is not null
     and new.provider_intent_id is distinct from old.provider_intent_id then
    raise exception 'provider_intent_id_immutable';
  end if;

  if old.status is distinct from new.status and not (
    (old.status='created' and new.status in (
      'requires_action','processing','authorized','captured','failed','cancelled'
    ))
    or (old.status='requires_action' and new.status in (
      'processing','authorized','captured','failed','cancelled'
    ))
    or (old.status='processing' and new.status in (
      'requires_action','authorized','captured','failed','cancelled'
    ))
    or (old.status='authorized' and new.status in ('captured','failed','cancelled'))
    or (old.status='captured' and new.status in ('partially_refunded','refunded'))
    or (old.status='partially_refunded' and new.status in ('partially_refunded','refunded'))
  ) then
    raise exception 'invalid_payment_intent_transition:%->%',old.status,new.status;
  end if;

  new.updated_at:=now();
  return new;
end;
$$;

revoke all on function public.commerce_payment_intent_update_guard()
  from public,anon,authenticated;
grant execute on function public.commerce_payment_intent_update_guard()
  to service_role;

drop trigger if exists commerce_payment_intent_update_guard
  on public.commerce_payment_intents;
create trigger commerce_payment_intent_update_guard
before update on public.commerce_payment_intents
for each row execute function public.commerce_payment_intent_update_guard();

create or replace function public.create_commerce_payment_intent_v1(
  p_source_entity_type text,
  p_source_entity_id uuid,
  p_source_entity_code text,
  p_customer_id uuid,
  p_market_code text,
  p_currency_code text,
  p_amount_minor bigint,
  p_provider_code text,
  p_payment_method_code text,
  p_idempotency_key text,
  p_environment text default 'live'
)
returns table(intent_id uuid,intent_code text,status text)
language plpgsql
security definer
set search_path=''
as $$
declare
  v_market text:=upper(trim(p_market_code));
  v_currency text:=upper(trim(p_currency_code));
  v_provider text:=lower(trim(p_provider_code));
  v_method text:=lower(trim(p_payment_method_code));
  v_existing public.commerce_payment_intents%rowtype;
begin
  if p_source_entity_type is null
     or p_source_entity_type !~ '^[a-z][a-z0-9_]{1,63}$' then
    raise exception 'invalid_source_entity_type';
  end if;
  if p_source_entity_id is null then raise exception 'invalid_source_entity_id'; end if;
  if p_source_entity_code is null
     or char_length(trim(p_source_entity_code)) not between 1 and 120 then
    raise exception 'invalid_source_entity_code';
  end if;
  if p_amount_minor is null or p_amount_minor<=0 then
    raise exception 'invalid_payment_amount_minor';
  end if;
  if p_environment not in ('live','test') then raise exception 'invalid_environment'; end if;
  if p_idempotency_key is null
     or char_length(p_idempotency_key) not between 16 and 120
     or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{15,119}$' then
    raise exception 'invalid_payment_idempotency_key';
  end if;
  if p_customer_id is not null and not exists (
    select 1 from public.customer_accounts c where c.id=p_customer_id
  ) then raise exception 'customer_not_found'; end if;
  if not exists (
    select 1 from public.commerce_markets m
    where m.market_code=v_market and m.status='live'
  ) then raise exception 'payment_market_not_live'; end if;
  if not exists (
    select 1 from public.commerce_market_capabilities c
    where c.market_code=v_market and c.capability='payments' and c.state='live'
  ) then raise exception 'payments_capability_not_live'; end if;
  if not exists (
    select 1 from public.commerce_market_currencies c
    where c.market_code=v_market and c.currency_code=v_currency and c.enabled
  ) then raise exception 'payment_currency_not_enabled'; end if;
  if not exists (
    select 1 from public.commerce_payment_providers p
    where p.provider_code=v_provider and p.status='live' and p.active
  ) then raise exception 'payment_provider_not_live'; end if;
  if not exists (
    select 1 from public.commerce_market_payment_methods pm
    where pm.market_code=v_market
      and pm.provider_code=v_provider
      and pm.currency_code=v_currency
      and pm.payment_method_code=v_method
      and pm.execution_mode='global_v2'
      and pm.status='live'
      and pm.enabled
  ) then raise exception 'global_payment_method_not_ready'; end if;

  insert into public.commerce_payment_intents(
    source_entity_type,source_entity_id,source_entity_code,customer_id,
    market_code,currency_code,amount_minor,provider_code,payment_method_code,
    execution_mode,status,idempotency_key,environment
  ) values (
    p_source_entity_type,p_source_entity_id,trim(p_source_entity_code),p_customer_id,
    v_market,v_currency,p_amount_minor,v_provider,v_method,
    'global_v2','created',p_idempotency_key,p_environment
  )
  on conflict (idempotency_key) do nothing
  returning * into v_existing;

  if not found then
    select * into v_existing
    from public.commerce_payment_intents i
    where i.idempotency_key=p_idempotency_key
    limit 1;
    if not found then raise exception 'payment_intent_idempotency_lookup_failed'; end if;
    if v_existing.source_entity_type<>p_source_entity_type
       or v_existing.source_entity_id<>p_source_entity_id
       or v_existing.market_code<>v_market
       or v_existing.currency_code<>v_currency
       or v_existing.amount_minor<>p_amount_minor
       or v_existing.provider_code<>v_provider
       or v_existing.payment_method_code<>v_method
       or v_existing.environment<>p_environment then
      raise exception 'payment_intent_idempotency_conflict';
    end if;
  end if;

  return query select v_existing.id,v_existing.intent_code,v_existing.status;
end;
$$;

revoke all on function public.create_commerce_payment_intent_v1(
  text,uuid,text,uuid,text,text,bigint,text,text,text,text
) from public,anon,authenticated;
grant execute on function public.create_commerce_payment_intent_v1(
  text,uuid,text,uuid,text,text,bigint,text,text,text,text
) to service_role;

create or replace function public.record_commerce_payment_event_v1(
  p_provider_code text,
  p_provider_event_id text,
  p_event_type text,
  p_provider_object_id text,
  p_currency_code text,
  p_amount_minor bigint,
  p_money_semantics text,
  p_signature_verified boolean,
  p_payload_sha256 text,
  p_metadata jsonb default '{}'::jsonb
)
returns table(event_id bigint,duplicate boolean,processing_status text)
language plpgsql
security definer
set search_path=''
as $$
declare
  v_provider text:=lower(trim(p_provider_code));
  v_currency text:=case when p_currency_code is null then null else upper(trim(p_currency_code)) end;
  v_event public.commerce_payment_events%rowtype;
begin
  if not exists (
    select 1 from public.commerce_payment_providers p where p.provider_code=v_provider
  ) then raise exception 'payment_provider_not_found'; end if;
  if p_provider_event_id is null or char_length(p_provider_event_id) not between 1 and 240 then
    raise exception 'invalid_provider_event_id';
  end if;
  if p_event_type is null or char_length(p_event_type) not between 1 and 120
     or p_event_type !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$' then
    raise exception 'invalid_provider_event_type';
  end if;
  if p_payload_sha256 is null or p_payload_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid_payload_digest';
  end if;
  if p_money_semantics not in ('none','intent_total','refund_delta') then
    raise exception 'invalid_money_semantics';
  end if;
  if p_money_semantics='none' then
    if v_currency is not null or p_amount_minor is not null then
      raise exception 'provider_event_money_semantics_invalid';
    end if;
  else
    if v_currency is null or p_amount_minor is null or p_amount_minor<=0 then
      raise exception 'provider_event_money_required';
    end if;
    if not exists (
      select 1 from public.commerce_currencies c
      where c.currency_code=v_currency and c.active
    ) then raise exception 'provider_event_currency_not_active'; end if;
  end if;

  insert into public.commerce_payment_events(
    provider_code,provider_event_id,event_type,provider_object_id,
    currency_code,amount_minor,money_semantics,signature_verified,
    payload_sha256,processing_status,metadata
  ) values (
    v_provider,p_provider_event_id,p_event_type,p_provider_object_id,
    v_currency,p_amount_minor,p_money_semantics,coalesce(p_signature_verified,false),
    p_payload_sha256,
    case when coalesce(p_signature_verified,false) then 'received' else 'rejected' end,
    coalesce(p_metadata,'{}'::jsonb)
  )
  on conflict (provider_code,provider_event_id) do nothing
  returning * into v_event;

  if found then
    return query select v_event.id,false,v_event.processing_status;
    return;
  end if;

  select * into v_event
  from public.commerce_payment_events e
  where e.provider_code=v_provider and e.provider_event_id=p_provider_event_id
  limit 1;
  if not found then raise exception 'payment_event_idempotency_lookup_failed'; end if;

  if v_event.payload_sha256<>p_payload_sha256
     or v_event.event_type<>p_event_type
     or v_event.money_semantics<>p_money_semantics
     or v_event.currency_code is distinct from v_currency
     or v_event.amount_minor is distinct from p_amount_minor then
    raise exception 'provider_event_id_conflict';
  end if;

  return query select v_event.id,true,v_event.processing_status;
end;
$$;

revoke all on function public.record_commerce_payment_event_v1(
  text,text,text,text,text,bigint,text,boolean,text,jsonb
) from public,anon,authenticated;
grant execute on function public.record_commerce_payment_event_v1(
  text,text,text,text,text,bigint,text,boolean,text,jsonb
) to service_role;

-- The initial WW-5 migration included apply_commerce_payment_event_v1.
-- Its table-column qualification is corrected by the next migration
-- 20261003044532_ww5_apply_event_alias_fix.sql.
