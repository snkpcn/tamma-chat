-- WW-4 Multi-Currency
-- Explicit product prices + reference FX + transaction currency evidence.
-- Existing Thailand checkout remains authoritative on otop_products.price / THB.

insert into public.commerce_currencies (
  currency_code, name_en, symbol, minor_unit, active
) values
  ('THB','Thai Baht','฿',2,true),
  ('USD','US Dollar','$',2,true),
  ('EUR','Euro','€',2,true),
  ('GBP','Pound Sterling','£',2,true),
  ('SEK','Swedish Krona','kr',2,true),
  ('CNY','Chinese Yuan','¥',2,true),
  ('LAK','Lao Kip','₭',2,true),
  ('VND','Vietnamese Dong','₫',0,true),
  ('JPY','Japanese Yen','¥',0,true)
on conflict (currency_code) do update set
  name_en=excluded.name_en,
  symbol=excluded.symbol,
  minor_unit=excluded.minor_unit,
  active=excluded.active,
  updated_at=now();

create table if not exists public.commerce_market_currencies (
  market_code text not null
    references public.commerce_markets(market_code) on delete cascade,
  currency_code text not null
    references public.commerce_currencies(currency_code),
  enabled boolean not null default false,
  is_default boolean not null default false,
  display_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (market_code,currency_code),
  check (not is_default or enabled)
);

create unique index if not exists commerce_market_currencies_one_default_uq
  on public.commerce_market_currencies(market_code)
  where is_default and enabled;

create index if not exists commerce_market_currencies_currency_idx
  on public.commerce_market_currencies(currency_code,enabled);

alter table public.commerce_market_currencies enable row level security;
revoke all on table public.commerce_market_currencies from public,anon,authenticated,service_role;
grant select,insert,update,delete on table public.commerce_market_currencies to service_role;

insert into public.commerce_market_currencies (
  market_code,currency_code,enabled,is_default,display_order
) values ('TH','THB',true,true,0)
on conflict (market_code,currency_code) do update set
  enabled=excluded.enabled,
  is_default=excluded.is_default,
  display_order=excluded.display_order,
  updated_at=now();

create table if not exists public.commerce_fx_quotes (
  id uuid primary key default gen_random_uuid(),
  base_currency_code text not null
    references public.commerce_currencies(currency_code),
  quote_currency_code text not null
    references public.commerce_currencies(currency_code),
  rate numeric(24,12) not null check (rate > 0),
  provider text not null check (char_length(provider) between 1 and 120),
  observed_at timestamptz not null,
  expires_at timestamptz null,
  usage_scope text not null default 'reference_only'
    check (usage_scope='reference_only'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (base_currency_code <> quote_currency_code),
  check (expires_at is null or expires_at > observed_at)
);

create index if not exists commerce_fx_quotes_pair_time_idx
  on public.commerce_fx_quotes(base_currency_code,quote_currency_code,observed_at desc);

alter table public.commerce_fx_quotes enable row level security;
revoke all on table public.commerce_fx_quotes from public,anon,authenticated,service_role;
grant select,insert,update,delete on table public.commerce_fx_quotes to service_role;

create table if not exists public.commerce_product_prices (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null
    references public.otop_products(id) on delete cascade,
  currency_code text not null
    references public.commerce_currencies(currency_code),
  amount_minor bigint not null check (amount_minor > 0),
  price_source text not null
    check (price_source in ('domestic_base','manual','fx_assisted')),
  source_currency_code text null
    references public.commerce_currencies(currency_code),
  source_amount_minor bigint null
    check (source_amount_minor is null or source_amount_minor > 0),
  fx_rate numeric(24,12) null
    check (fx_rate is null or fx_rate > 0),
  fx_observed_at timestamptz null,
  active boolean not null default true,
  valid_from timestamptz not null default now(),
  valid_until timestamptz null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valid_until is null or valid_until > valid_from),
  check (
    price_source <> 'fx_assisted'
    or (
      source_currency_code is not null
      and source_amount_minor is not null
      and fx_rate is not null
      and fx_observed_at is not null
    )
  )
);

create unique index if not exists commerce_product_prices_one_active_uq
  on public.commerce_product_prices(product_id,currency_code)
  where active;

create index if not exists commerce_product_prices_lookup_idx
  on public.commerce_product_prices(currency_code,active,valid_from desc);

alter table public.commerce_product_prices enable row level security;
revoke all on table public.commerce_product_prices from public,anon,authenticated,service_role;
grant select,insert,update,delete on table public.commerce_product_prices to service_role;

create or replace function public.sync_otop_domestic_price_v1()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_amount_minor bigint;
begin
  v_amount_minor := round(new.price * 100)::bigint;
  if v_amount_minor <= 0 then
    raise exception 'invalid_domestic_product_price';
  end if;

  update public.commerce_product_prices
  set active=false,
      valid_until=coalesce(valid_until,now()),
      updated_at=now()
  where product_id=new.id
    and currency_code='THB'
    and active
    and (amount_minor <> v_amount_minor or price_source <> 'domestic_base');

  if not exists (
    select 1
    from public.commerce_product_prices p
    where p.product_id=new.id
      and p.currency_code='THB'
      and p.active
      and p.amount_minor=v_amount_minor
      and p.price_source='domestic_base'
  ) then
    insert into public.commerce_product_prices(
      product_id,currency_code,amount_minor,price_source,active,valid_from,metadata
    ) values (
      new.id,'THB',v_amount_minor,'domestic_base',true,now(),
      jsonb_build_object('source','otop_products.price','environment',new.environment)
    );
  end if;
  return new;
end;
$$;

revoke all on function public.sync_otop_domestic_price_v1() from public,anon,authenticated;
grant execute on function public.sync_otop_domestic_price_v1() to service_role;

drop trigger if exists sync_otop_domestic_price_v1 on public.otop_products;
create trigger sync_otop_domestic_price_v1
after insert or update of price on public.otop_products
for each row execute function public.sync_otop_domestic_price_v1();

insert into public.commerce_product_prices(
  product_id,currency_code,amount_minor,price_source,active,valid_from,metadata
)
select
  p.id,'THB',round(p.price*100)::bigint,'domestic_base',true,
  coalesce(p.updated_at,p.created_at,now()),
  jsonb_build_object('source','ww4_backfill_otop_products.price','environment',p.environment)
from public.otop_products p
where p.price > 0
on conflict do nothing;

alter table public.otop_orders
  add column if not exists market_code text not null default 'TH',
  add column if not exists currency_code text not null default 'THB',
  add column if not exists pricing_source text not null default 'domestic_v1';

alter table public.otop_orders
  drop constraint if exists otop_orders_market_code_fkey;
alter table public.otop_orders
  add constraint otop_orders_market_code_fkey
  foreign key (market_code) references public.commerce_markets(market_code);

alter table public.otop_orders
  drop constraint if exists otop_orders_currency_code_fkey;
alter table public.otop_orders
  add constraint otop_orders_currency_code_fkey
  foreign key (currency_code) references public.commerce_currencies(currency_code);

alter table public.otop_orders
  drop constraint if exists otop_orders_pricing_source_check;
alter table public.otop_orders
  add constraint otop_orders_pricing_source_check
  check (pricing_source in ('domestic_v1','multi_currency_v1'));

alter table public.otop_orders
  drop constraint if exists otop_orders_domestic_price_contract_check;
alter table public.otop_orders
  add constraint otop_orders_domestic_price_contract_check
  check (
    pricing_source <> 'domestic_v1'
    or (market_code='TH' and currency_code='THB')
  );

create index if not exists otop_orders_market_currency_idx
  on public.otop_orders(market_code,currency_code,created_at desc);

alter table public.otop_order_items
  add column if not exists currency_code text not null default 'THB',
  add column if not exists price_revision_id uuid null;

alter table public.otop_order_items
  drop constraint if exists otop_order_items_currency_code_fkey;
alter table public.otop_order_items
  add constraint otop_order_items_currency_code_fkey
  foreign key (currency_code) references public.commerce_currencies(currency_code);

alter table public.otop_order_items
  drop constraint if exists otop_order_items_price_revision_id_fkey;
alter table public.otop_order_items
  add constraint otop_order_items_price_revision_id_fkey
  foreign key (price_revision_id) references public.commerce_product_prices(id) on delete set null;

create index if not exists otop_order_items_price_revision_idx
  on public.otop_order_items(price_revision_id)
  where price_revision_id is not null;

alter table public.payment_requests
  drop constraint if exists payment_requests_currency_fkey;
alter table public.payment_requests
  add constraint payment_requests_currency_fkey
  foreign key (currency) references public.commerce_currencies(currency_code);

create or replace function public.create_payment_for_otop_order()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_status text;
begin
  if new.currency_code <> 'THB' then
    raise exception 'global_payment_not_enabled';
  end if;

  v_status := case when coalesce(new.total_amount,0)>0 then 'awaiting_payment' else 'quote_required' end;

  insert into public.payment_requests(
    entity_type,entity_id,entity_code,guest_id,customer_id,team_code,
    amount,currency,method,status,source_channel,environment,quoted_at
  ) values (
    'otop_order',new.id,new.order_code,new.guest_id,
    coalesce(new.customer_id,public.payment_customer_for_guest(new.guest_id)),
    'otop',
    case when coalesce(new.total_amount,0)>0 then new.total_amount else null end,
    new.currency_code,
    'promptpay_owner_qr',
    v_status,
    new.source_channel,
    new.environment,
    case when coalesce(new.total_amount,0)>0 then now() else null end
  )
  on conflict (entity_type,entity_id) do nothing;
  return new;
end;
$$;

revoke all on function public.create_payment_for_otop_order() from public,anon,authenticated;
grant execute on function public.create_payment_for_otop_order() to service_role;

create or replace function public.sync_otop_payment_amount()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if new.currency_code <> 'THB' then
    raise exception 'global_payment_not_enabled';
  end if;

  if (
    new.total_amount is distinct from old.total_amount
    or new.currency_code is distinct from old.currency_code
  ) and coalesce(new.total_amount,0)>0 then
    update public.payment_requests
    set amount=new.total_amount,
        currency=new.currency_code,
        status=case when status in ('quote_required','awaiting_payment') then 'awaiting_payment' else status end,
        quoted_at=coalesce(quoted_at,now())
    where entity_type='otop_order'
      and entity_id=new.id
      and status<>'verified';
  end if;

  if new.status='cancelled' and old.status is distinct from new.status then
    update public.payment_requests
    set status='cancelled'
    where entity_type='otop_order'
      and entity_id=new.id
      and status in ('quote_required','awaiting_payment','proof_submitted','rejected');
  end if;
  return new;
end;
$$;

revoke all on function public.sync_otop_payment_amount() from public,anon,authenticated;
grant execute on function public.sync_otop_payment_amount() to service_role;

drop trigger if exists sync_payment_after_otop_order_update on public.otop_orders;
create trigger sync_payment_after_otop_order_update
after update of total_amount,status,currency_code on public.otop_orders
for each row execute function public.sync_otop_payment_amount();
